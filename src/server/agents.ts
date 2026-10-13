import "server-only";
import { all, get, json, run, tx } from "./db";
import { newId, randomToken, sha256 } from "./crypto";
import { audit, type Actor } from "./audit";
import { createAlert, emitWebhook } from "./notify";
import { getOrg } from "./orgs";
import type { Agent, AgentMode, AgentStatus, AgentToken, Environment, Org } from "@/lib/types";

export { PLATFORMS } from "@/lib/platforms";

export function listAgents(orgId: string): Agent[] {
  return all<Agent>("SELECT * FROM agents WHERE org_id = ? ORDER BY created_at ASC", orgId);
}

export function getAgent(orgId: string, id: string): Agent | undefined {
  return get<Agent>("SELECT * FROM agents WHERE org_id = ? AND id = ?", orgId, id);
}

export interface AgentInput {
  name: string;
  platform: string;
  purpose: string;
  environment: Environment;
  mode: AgentMode;
  ownerUserId: string | null;
  handlesPrivateData: boolean;
  checkResponses: boolean;
  parentAgentId?: string | null;
}

export function createAgent(org: Org, actor: Actor, input: AgentInput, now: number): Agent {
  const id = newId("agt");
  run(
    `INSERT INTO agents (id, org_id, name, platform, purpose, owner_user_id, environment, mode, status, handles_private_data, check_responses, parent_agent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    id,
    org.id,
    input.name,
    input.platform,
    input.purpose,
    input.ownerUserId,
    input.environment,
    input.mode,
    input.handlesPrivateData ? 1 : 0,
    input.checkResponses ? 1 : 0,
    input.parentAgentId ?? null,
    now,
  );
  audit(org.id, actor, "agent.registered", { type: "agent", id }, { name: input.name, platform: input.platform, environment: input.environment, mode: input.mode }, now);
  return getAgent(org.id, id)!;
}

export function updateAgent(org: Org, actor: Actor, id: string, input: Omit<AgentInput, "parentAgentId">, now: number): void {
  const before = getAgent(org.id, id);
  if (!before) throw new Error("Agent not found.");
  run(
    "UPDATE agents SET name = ?, platform = ?, purpose = ?, owner_user_id = ?, environment = ?, mode = ?, handles_private_data = ?, check_responses = ? WHERE org_id = ? AND id = ?",
    input.name,
    input.platform,
    input.purpose,
    input.ownerUserId,
    input.environment,
    input.mode,
    input.handlesPrivateData ? 1 : 0,
    input.checkResponses ? 1 : 0,
    org.id,
    id,
  );
  const changes: Record<string, unknown> = {};
  if (before.mode !== input.mode) changes.mode = `${before.mode} → ${input.mode}`;
  if (before.environment !== input.environment) changes.environment = `${before.environment} → ${input.environment}`;
  if (before.name !== input.name) changes.name = input.name;
  audit(org.id, actor, "agent.updated", { type: "agent", id }, changes, now);
}

/**
 * Permanently removes an agent. Activity history stays for the audit trail;
 * tokens and tool links are removed. Prefer kill for an emergency stop.
 */
export function deleteAgent(org: Org, actor: Actor, id: string, now: number): void {
  const agent = getAgent(org.id, id);
  if (!agent) throw new Error("Agent not found.");
  tx(() => {
    run("UPDATE approvals SET status = 'rejected', decided_at = ? WHERE org_id = ? AND agent_id = ? AND status = 'pending'", now, org.id, id);
    run(
      `UPDATE events SET status = 'rejected', reason = 'The agent was deleted.',
         money_state = CASE WHEN money_state = 'reserved' THEN 'released' ELSE money_state END
       WHERE org_id = ? AND agent_id = ? AND status IN ('pending', 'approved')`,
      org.id,
      id,
    );
    const tokens = run("DELETE FROM agent_tokens WHERE org_id = ? AND agent_id = ?", org.id, id);
    run("DELETE FROM agent_tools WHERE org_id = ? AND agent_id = ?", org.id, id);
    run("DELETE FROM agents WHERE org_id = ? AND id = ?", org.id, id);
    audit(org.id, actor, "agent.deleted", { type: "agent", id }, { name: agent.name, tokens_removed: tokens }, now);
  });
}

/**
 * Pause, resume or kill. Kill is the kill switch: the agent is blocked at every
 * checkpoint, every token it holds is revoked (which removes its vault access),
 * and anything it left waiting for approval is rejected.
 */
export function setAgentStatus(org: Org, actor: Actor, id: string, status: AgentStatus, reason: string, now: number, live = true): Agent {
  const agent = getAgent(org.id, id);
  if (!agent) throw new Error("Agent not found.");
  tx(() => {
    run("UPDATE agents SET status = ?, status_reason = ?, status_changed_at = ? WHERE org_id = ? AND id = ?", status, reason || null, now, org.id, id);
    if (status === "killed") {
      const revoked = run("UPDATE agent_tokens SET revoked_at = ? WHERE org_id = ? AND agent_id = ? AND revoked_at IS NULL", now, org.id, id);
      const rejected = run("UPDATE approvals SET status = 'rejected', decided_at = ? WHERE org_id = ? AND agent_id = ? AND status = 'pending'", now, org.id, id);
      run(
        `UPDATE events SET status = 'rejected', reason = 'The agent was stopped with the kill switch.',
           money_state = CASE WHEN money_state = 'reserved' THEN 'released' ELSE money_state END
         WHERE org_id = ? AND agent_id = ? AND status IN ('pending', 'approved')`,
        org.id,
        id,
      );
      audit(org.id, actor, "agent.killed", { type: "agent", id }, { name: agent.name, reason, tokens_revoked: revoked, approvals_rejected: rejected }, now);
    } else {
      audit(org.id, actor, status === "paused" ? "agent.paused" : "agent.resumed", { type: "agent", id }, { name: agent.name, reason, from: agent.status }, now);
    }
  });
  if (status === "killed") {
    emitWebhook(org, "agent.killed", { agent_id: id, name: agent.name, reason, by: actor.label }, now, live);
    createAlert(org, { kind: "agent.killed", severity: "critical", title: `${agent.name} was stopped`, body: `Kill switch used by ${actor.label}. ${reason}`.trim(), agentId: id }, now, live);
  }
  return getAgent(org.id, id)!;
}

// --- tokens ------------------------------------------------------------------

type TokenRow = Omit<AgentToken, "scopes"> & { scopes: string };
const parseToken = (r: TokenRow): AgentToken => ({ ...r, scopes: json<string[]>(r.scopes, ["*"]) });

export function listTokens(orgId: string, agentId: string): AgentToken[] {
  return all<TokenRow>(
    "SELECT id, org_id, agent_id, name, prefix, scopes, expires_at, revoked_at, last_used_at, created_at FROM agent_tokens WHERE org_id = ? AND agent_id = ? ORDER BY created_at DESC",
    orgId,
    agentId,
  ).map(parseToken);
}

/** Returns the plaintext token once. Only its hash is stored. */
export function createToken(
  org: Org,
  actor: Actor,
  agentId: string,
  input: { name: string; scopes: string[]; expiresInDays: number | null },
  now: number,
): { token: string; id: string } {
  if (!getAgent(org.id, agentId)) throw new Error("Agent not found.");
  const token = `ag_${randomToken(30)}`;
  const id = newId("tok");
  const scopes = input.scopes.length ? input.scopes : ["*"];
  run(
    "INSERT INTO agent_tokens (id, org_id, agent_id, name, prefix, token_hash, scopes, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    org.id,
    agentId,
    input.name,
    token.slice(0, 9),
    sha256(token),
    JSON.stringify(scopes),
    input.expiresInDays ? now + input.expiresInDays * 86_400_000 : null,
    now,
  );
  audit(org.id, actor, "token.created", { type: "agent", id: agentId }, { token_id: id, name: input.name, scopes, expires_in_days: input.expiresInDays }, now);
  return { token, id };
}

export function revokeToken(org: Org, actor: Actor, tokenId: string, now: number): void {
  const row = get<{ agent_id: string; name: string }>("SELECT agent_id, name FROM agent_tokens WHERE org_id = ? AND id = ?", org.id, tokenId);
  if (!row) throw new Error("Token not found.");
  run("UPDATE agent_tokens SET revoked_at = ? WHERE org_id = ? AND id = ? AND revoked_at IS NULL", now, org.id, tokenId);
  audit(org.id, actor, "token.revoked", { type: "agent", id: row.agent_id }, { token_id: tokenId, name: row.name }, now);
}

export type TokenAuth =
  | { ok: true; org: Org; agent: Agent; token: AgentToken }
  | { ok: false; status: number; code: string; message: string };

export function authenticateToken(bearer: string | null, now: number): TokenAuth {
  const plaintext = bearer?.replace(/^Bearer\s+/i, "").trim();
  if (!plaintext) return { ok: false, status: 401, code: "missing_token", message: "Send your AgentGuard agent token as a Bearer token." };
  const row = get<TokenRow>("SELECT * FROM agent_tokens WHERE token_hash = ?", sha256(plaintext));
  if (!row) return { ok: false, status: 401, code: "invalid_token", message: "This agent token is not recognised." };
  const token = parseToken(row);
  if (token.revoked_at) return { ok: false, status: 401, code: "token_revoked", message: "This agent token has been revoked." };
  if (token.expires_at && token.expires_at < now) return { ok: false, status: 401, code: "token_expired", message: "This agent token has expired." };
  const agent = getAgent(token.org_id, token.agent_id);
  if (!agent) return { ok: false, status: 401, code: "invalid_token", message: "This agent no longer exists." };
  run("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?", now, token.id);
  return { ok: true, org: getOrg(token.org_id), agent, token };
}

export const agentActor = (agent: Agent): Actor => ({ type: "agent", id: agent.id, label: agent.name });

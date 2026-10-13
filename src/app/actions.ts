"use server";

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { createAgent, createToken, deleteAgent, getAgent, revokeToken, setAgentStatus, updateAgent, type AgentInput } from "@/server/agents";
import { endSession, requireRole, startSession, type Session } from "@/server/auth";
import { decideAndExecute } from "@/server/execution";
import { createLimit, deleteLimit, setLimitEnabled, updateLimit } from "@/server/limits";
import { deleteMcpServer, saveMcpServer } from "@/server/mcp";
import { acknowledgeAlerts } from "@/server/notify";
import { renameOrg } from "@/server/orgs";
import { createRule, deleteRule, replayRule, setRuleEnabled, updateRule, type RuleInput } from "@/server/rules";
import { runScenario } from "@/server/scenarios";
import { ensureSeeded } from "@/server/seed";
import { updateSettings } from "@/server/settings";
import { installTemplate, uninstallTemplate } from "@/server/templates";
import { classifyTool, declareTool, deleteTool, removeAgentTool, setToolPermission } from "@/server/tools";
import { addMember, changeRole, checkPassword, createApiKey, removeMember, revokeApiKey, signUp, userActor } from "@/server/users";
import { deleteCredential, saveCredential, setKeysRotated } from "@/server/vault";
import { audit } from "@/server/audit";
import type { AgentMode, AgentStatus, Connection, Environment, LimitKind, LimitPeriod, LimitScope, Role, RuleEffect, ToolPermission } from "@/lib/types";

// Every action re-checks the caller's session and role itself. Rendering a form
// only on a protected page is not a security boundary.

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
// A switch posts a hidden "false" plus "true" when checked, so every value is inspected.
const flag = (form: FormData, key: string) => form.getAll(key).some((v) => v === "on" || v === "true");
const fail = (err: unknown): ActionState => ({ ok: false, message: err instanceof Error ? err.message : "Something went wrong." });

async function act(min: Role, success: string | null, fn: (session: Session, now: number) => Promise<ActionState | void> | ActionState | void): Promise<ActionState> {
  try {
    const session = await requireRole(min);
    const result = await fn(session, Date.now());
    refresh();
    return result ?? { ok: true, message: success ?? undefined };
  } catch (err) {
    // Redirects are thrown; let them through.
    unstable_rethrow(err);
    return fail(err);
  }
}

// --- sign in -------------------------------------------------------------------

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await ensureSeeded();
    const user = checkPassword(str(form, "email"), String(form.get("password") ?? ""), Date.now());
    await startSession(user.id);
  } catch (err) {
    return fail(err);
  }
  redirect("/overview");
}

export async function signupAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    await ensureSeeded();
    const user = signUp({ orgName: str(form, "organization"), name: str(form, "name"), email: str(form, "email"), password: String(form.get("password") ?? "") }, Date.now());
    await startSession(user.id);
  } catch (err) {
    return fail(err);
  }
  redirect("/overview");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

// --- agents --------------------------------------------------------------------

function agentInput(form: FormData): Omit<AgentInput, "parentAgentId"> {
  const name = str(form, "name");
  if (!name) throw new Error("Give the agent a name.");
  return {
    name,
    platform: str(form, "platform") || "Custom code",
    purpose: str(form, "purpose"),
    environment: (str(form, "environment") || "production") as Environment,
    mode: (str(form, "mode") || "observe") as AgentMode,
    ownerUserId: str(form, "owner") || null,
    handlesPrivateData: flag(form, "handles_private_data"),
    checkResponses: flag(form, "check_responses"),
  };
}

export async function createAgentAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id = "";
  const result = await act("admin", null, ({ org, user }, now) => {
    id = createAgent(org, userActor(user), { ...agentInput(form), parentAgentId: str(form, "parent") || null }, now).id;
  });
  if (result?.ok && id) redirect(`/agents/${id}?new=1`);
  return result;
}

export async function updateAgentAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Saved.", ({ org, user }, now) => updateAgent(org, userActor(user), str(form, "id"), agentInput(form), now));
}

export async function setAgentStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const status = str(form, "status") as AgentStatus;
  const message = status === "killed" ? "The agent is stopped. Its tokens are revoked and its pending requests rejected." : status === "paused" ? "The agent is paused." : "The agent is active again.";
  return act("admin", message, ({ org, user }, now) => {
    if (!["active", "paused", "killed"].includes(status)) throw new Error("Unknown status.");
    setAgentStatus(org, userActor(user), str(form, "id"), status, str(form, "reason"), now);
  });
}

export async function deleteAgentAction(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await act("admin", "Agent deleted.", ({ org, user }, now) => deleteAgent(org, userActor(user), str(form, "id"), now));
  if (result?.ok) redirect("/agents");
  return result;
}

export async function createTokenAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", null, ({ org, user }, now) => {
    const scopes = str(form, "scopes").split(/[\s,]+/).filter(Boolean);
    const days = Number(str(form, "expires"));
    const { token } = createToken(org, userActor(user), str(form, "agent"), { name: str(form, "name") || "Token", scopes, expiresInDays: days > 0 ? days : null }, now);
    return { ok: true, data: { token } };
  });
}

export async function revokeTokenAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Token revoked.", ({ org, user }, now) => revokeToken(org, userActor(user), str(form, "id"), now));
}

// --- tools ---------------------------------------------------------------------

export async function classifyToolAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Classified.", ({ org, user }, now) => classifyTool(org, userActor(user), str(form, "id"), str(form, "action"), now));
}

export async function setToolPermissionAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", null, ({ org, user }, now) => setToolPermission(org, userActor(user), str(form, "agent"), str(form, "tool"), str(form, "permission") as ToolPermission, now));
}

export async function declareToolAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Added to the agent's inventory.", ({ org, user }, now) => {
    const name = str(form, "name");
    if (!name) throw new Error("Give the tool a name.");
    if (!getAgent(org.id, str(form, "agent"))) throw new Error("Agent not found.");
    declareTool(org, userActor(user), str(form, "agent"), { name, action: str(form, "action"), connection: (str(form, "connection") || "uncovered") as Connection }, now);
  });
}

export async function removeAgentToolAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", null, ({ org, user }, now) => removeAgentTool(org, userActor(user), str(form, "agent"), str(form, "tool"), now));
}

export async function deleteToolAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Tool removed.", ({ org, user }, now) => deleteTool(org, userActor(user), str(form, "id"), now));
}

// --- approvals -------------------------------------------------------------------

export async function decideApprovalAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("approver", null, async ({ org, user }, now) => {
    const decision = str(form, "decision") === "approve" ? "approve" : "reject";
    const result = await decideAndExecute(org, user, str(form, "id"), decision, str(form, "note"), "dashboard", now);
    const { approval, event } = result;
    if (approval.status === "pending") return { ok: true, message: "Your approval is recorded. A second person must also approve." };
    if (approval.status === "rejected") return { ok: true, message: "Rejected. The action will not run." };
    if (event.status === "failed") return { ok: false, message: `Approved, but the action failed: ${(event.result as { error?: string } | null)?.error ?? "unknown error"}` };
    return { ok: true, message: event.source === "vault" ? "Approved. The vault executed exactly the approved action, once." : "Approved. The agent may now proceed with exactly these parameters." };
  });
}

// --- rules and limits --------------------------------------------------------------

function ruleInput(form: FormData): RuleInput {
  let conditions: unknown;
  try {
    conditions = JSON.parse(str(form, "conditions") || "[]");
  } catch {
    throw new Error("The conditions could not be read.");
  }
  return { name: str(form, "name"), description: str(form, "description"), agentId: str(form, "agent") || null, conditions, effect: str(form, "effect") as RuleEffect, enabled: flag(form, "enabled") };
}

export async function saveRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const id = str(form, "id");
  const result = await act("admin", null, ({ org, user }, now) => {
    if (id) updateRule(org, userActor(user), id, ruleInput(form), now);
    else createRule(org, userActor(user), ruleInput(form), now);
  });
  if (result?.ok) redirect("/rules");
  return result;
}

export async function replayRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("viewer", null, ({ org }, now) => {
    const input = ruleInput(form);
    const replay = replayRule(org, { conditions: input.conditions, effect: input.effect, agentId: input.agentId }, 7, now);
    return { ok: true, data: { replay } };
  });
}

export async function toggleRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", null, ({ org, user }, now) => setRuleEnabled(org, userActor(user), str(form, "id"), flag(form, "enabled"), now));
}

export async function deleteRuleAction(_: ActionState, form: FormData): Promise<ActionState> {
  const result = await act("admin", null, ({ org, user }, now) => deleteRule(org, userActor(user), str(form, "id"), now));
  if (result?.ok && flag(form, "redirect")) redirect("/rules");
  return result;
}

export async function installTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Installed. Review the rules below.", ({ org, user }, now) =>
    installTemplate(org, userActor(user), str(form, "template"), { agentId: str(form, "agent") || null, enable: flag(form, "enable") }, now),
  );
}

export async function uninstallTemplateAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Template removed. Its rules and limits were deleted.", ({ org, user }, now) =>
    uninstallTemplate(org, userActor(user), str(form, "template"), now),
  );
}

function limitInput(form: FormData) {
  return {
    name: str(form, "name"),
    kind: str(form, "kind") as LimitKind,
    scope: str(form, "scope") as LimitScope,
    agentId: str(form, "agent") || null,
    action: str(form, "action") || null,
    period: str(form, "period") as LimitPeriod,
    value: Number(str(form, "value")),
    onExceed: (str(form, "on_exceed") === "ask_human" ? "ask_human" : "block") as "ask_human" | "block",
  };
}

export async function createLimitAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Limit added.", ({ org, user }, now) => createLimit(org, userActor(user), limitInput(form), now));
}

export async function updateLimitAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Limit updated.", ({ org, user }, now) => updateLimit(org, userActor(user), str(form, "id"), limitInput(form), now));
}

export async function toggleLimitAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", null, ({ org, user }, now) => setLimitEnabled(org, userActor(user), str(form, "id"), flag(form, "enabled"), now));
}

export async function deleteLimitAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", null, ({ org, user }, now) => deleteLimit(org, userActor(user), str(form, "id"), now));
}

// --- vault -----------------------------------------------------------------------

export async function saveCredentialAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Connected. The key is stored encrypted and is never shown again.", ({ org, user }, now) =>
    saveCredential(org, userActor(user), { connector: str(form, "connector"), mode: str(form, "mode") === "live" ? "live" : "sandbox", apiKey: String(form.get("api_key") ?? ""), baseUrl: str(form, "base_url") || undefined }, now),
  );
}

export async function deleteCredentialAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "Disconnected.", ({ org, user }, now) => deleteCredential(org, userActor(user), str(form, "connector"), now));
}

export async function setKeysRotatedAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", null, ({ org, user }, now) => setKeysRotated(org, userActor(user), str(form, "connector"), flag(form, "rotated"), now));
}

export async function saveMcpServerAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", "MCP server registered.", ({ org, user }, now) =>
    saveMcpServer(org, userActor(user), { slug: str(form, "slug"), name: str(form, "name"), url: str(form, "url"), authHeader: str(form, "auth_header") || undefined }, now),
  );
}

export async function deleteMcpServerAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", null, ({ org, user }, now) => deleteMcpServer(org, userActor(user), str(form, "slug"), now));
}

// --- settings ----------------------------------------------------------------------

/** Each settings form posts its fields as one JSON document in `patch`. */
export async function updateSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("owner", "Saved.", ({ org, user }, now) => {
    let patch: Record<string, unknown>;
    try {
      patch = JSON.parse(str(form, "patch") || "{}");
    } catch {
      throw new Error("The settings could not be read.");
    }
    const name = str(form, "org_name");
    if (name && name !== org.name) {
      renameOrg(org.id, name);
      audit(org.id, userActor(user), "organization.renamed", { type: "organization", id: org.id }, { from: org.name, to: name }, now);
    }
    updateSettings(org, userActor(user), patch, now);
  });
}

export async function addMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("owner", "Member added. Pass the password on to them yourself.", ({ org, user }, now) => {
    addMember(org, userActor(user), { name: str(form, "name"), email: str(form, "email"), role: str(form, "role") as Role, password: String(form.get("password") ?? "") }, now);
  });
}

export async function changeRoleAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("owner", null, ({ org, user }, now) => changeRole(org, userActor(user), str(form, "id"), str(form, "role") as Role, now));
}

export async function removeMemberAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("owner", null, ({ org, user }, now) => removeMember(org, userActor(user), str(form, "id"), now));
}

export async function createApiKeyAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("owner", null, ({ org, user }, now) => ({ ok: true, data: { key: createApiKey(org, userActor(user), str(form, "name"), now) } }));
}

export async function revokeApiKeyAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("owner", null, ({ org, user }, now) => revokeApiKey(org, userActor(user), str(form, "id"), now));
}

export async function acknowledgeAlertsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("approver", null, ({ org }, now) => acknowledgeAlerts(org.id, now, str(form, "id") || undefined));
}

// --- playground ----------------------------------------------------------------------

export async function runScenarioAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act("admin", null, async ({ org, user }, now) => ({ ok: true, data: { steps: await runScenario(org, user, str(form, "scenario"), now), scenario: str(form, "scenario") } }));
}

import "server-only";
import { all, get, run, tx } from "./db";
import { fingerprint, newId } from "./crypto";
import { agentActor } from "./agents";
import { audit } from "./audit";
import { createApproval, expireOverdue, getApproval } from "./approvals";
import { getEvent, insertEvent, parseEvent, updateEvent } from "./events";
import { checkLimits } from "./limits";
import { createAlert, emitWebhook } from "./notify";
import { buildContext, listRules, matchRules } from "./rules";
import { connectionFor, sightTool, upsertTool } from "./tools";
import { ACTIONS, RISK_ORDER, getAction, isKnownAction, matchesPattern } from "@/lib/catalog";
import { money } from "@/lib/format";
import {
  ENFORCED_SOURCES,
  type ActionEvent, type Agent, type AgentToken, type AppliedRule, type Approval, type Decision,
  type Fact, type Org, type Risk, type Source,
} from "@/lib/types";

export interface ActionRequest {
  /** The tool name as the agent knows it, e.g. "gmail.send". */
  tool?: string;
  /** A catalog action id, e.g. "email.send". Used when the tool is not yet classified. */
  action?: string;
  resource?: string | null;
  params?: Record<string, unknown>;
  idempotencyKey?: string | null;
  runId?: string | null;
  untrustedInputSeen?: boolean;
  explanation?: string | null;
  /** The agent is deliberately repeating an action that already ran. A person must confirm. */
  confirmRepeat?: boolean;
  /** Set by checkpoints AgentGuard defines itself (vault connectors), which need no human classification. */
  knownAction?: string;
  /** Facts read directly from the source system by an enforced checkpoint. */
  sourceFacts?: Fact[];
}

export interface DecideContext {
  org: Org;
  agent: Agent;
  token?: AgentToken;
  source: Source;
  now: number;
  /** False while seeding history, so no notifications leave the system. */
  live?: boolean;
  /** Record an action that already happened: evaluate it, but ask and block nothing. */
  reportOnly?: boolean;
}

export interface Outcome {
  /** The event that carries the answer. For a duplicate this is the original event. */
  event: ActionEvent;
  outcome: "allow" | "block" | "pending";
  duplicate: boolean;
  /** The action already ran; the agent must not run it again. */
  alreadyExecuted: boolean;
  approval?: Approval;
}

const READS_PRIVATE = ACTIONS.filter((a) => a.readsPrivate).map((a) => a.id);
const RUN_TTL = 24 * 3_600_000;
const AGENT_SESSION_TTL = 30 * 60_000;

// --- what the agent has read -------------------------------------------------

const runKey = (agent: Agent, runId?: string | null) => (runId ? `run:${runId}` : `agent:${agent.id}`);

export async function markRunUntrusted(org: Org, agent: Agent, runId: string | null | undefined, sourceLabel: string, now: number): Promise<void> {
  await run(
    `INSERT INTO runs (org_id, key, agent_id, untrusted_input_seen, untrusted_source, last_seen_at) VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT (org_id, key) DO UPDATE SET untrusted_input_seen = 1, untrusted_source = excluded.untrusted_source, last_seen_at = excluded.last_seen_at`,
    org.id,
    runKey(agent, runId),
    agent.id,
    sourceLabel,
    now,
  );
}

async function runState(org: Org, agent: Agent, runId: string | null | undefined, now: number): Promise<{ untrusted: boolean; source: string | null }> {
  const key = runKey(agent, runId);
  const row = await get<{ untrusted_input_seen: number; untrusted_source: string | null; last_seen_at: number }>(
    "SELECT untrusted_input_seen, untrusted_source, last_seen_at FROM runs WHERE org_id = ? AND key = ?",
    org.id,
    key,
  );
  if (!row) return { untrusted: false, source: null };
  const ttl = key.startsWith("agent:") ? AGENT_SESSION_TTL : RUN_TTL;
  if (now - row.last_seen_at > ttl) return { untrusted: false, source: null };
  return { untrusted: !!row.untrusted_input_seen, source: row.untrusted_source };
}

async function canReachPrivateData(agent: Agent): Promise<boolean> {
  if (agent.handles_private_data) return true;
  const marks = READS_PRIVATE.map(() => "?").join(", ");
  return !!await get(
    `SELECT 1 AS x FROM agent_tools at JOIN tools t ON t.id = at.tool_id WHERE at.agent_id = ? AND t.action IN (${marks}) LIMIT 1`,
    agent.id,
    ...READS_PRIVATE,
  );
}

// --- helpers -----------------------------------------------------------------

function readAmount(params: Record<string, unknown>): number | null {
  const raw = params.amount;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return null;
}

function readString(params: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = params[k];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number") return String(v);
  }
  return null;
}

const strictest = (verdicts: AppliedRule[]): Decision =>
  verdicts.some((v) => v.effect === "block") ? "BLOCK" : verdicts.some((v) => v.effect === "ask_human") ? "ASK_HUMAN" : "ALLOW";

/**
 * The earlier event for the same action. An exact match on parameters wins over
 * a more recent near match. An agent sees its own waiting, approved and rejected
 * requests; another agent's request only counts once it has actually run.
 */
async function priorEvent(org: Org, agentId: string, key: string, clientKey: string | null, fp: string, now: number): Promise<ActionEvent | undefined> {
  const since = now - org.settings.duplicateWindowHours * 3_600_000;
  const row = await get<Parameters<typeof parseEvent>[0]>(
    `SELECT * FROM events
     WHERE org_id = ? AND created_at >= ? AND (idempotency_key = ? OR (client_key IS NOT NULL AND client_key = ?))
       AND (status IN ('allowed', 'executing', 'executed') OR (agent_id = ? AND status IN ('pending', 'approved', 'rejected')))
     ORDER BY (params_fingerprint = ?) DESC, created_at DESC, rowid DESC LIMIT 1`,
    org.id,
    since,
    key,
    clientKey,
    agentId,
    fp,
  );
  return row ? parseEvent(row) : undefined;
}

async function ownFacts(org: Org, e: ActionEvent, verdicts: AppliedRule[], untrustedSource: string | null, now: number): Promise<Fact[]> {
  const facts: Fact[] = [];
  const src = "AgentGuard records";
  if (e.customer && e.amount !== null) {
    const week = (await get<{ total: number; n: number }>(
      "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM events WHERE org_id = ? AND customer = ? AND action = ? AND money_state IN ('reserved', 'settled') AND created_at >= ?",
      org.id,
      e.customer,
      e.action,
      now - 7 * 86_400_000,
    ))!;
    facts.push({
      label: "This customer in the last 7 days",
      value: week.n ? `${money(week.total, e.currency)} across ${week.n} earlier ${week.n === 1 ? "action" : "actions"} of this type` : "No earlier actions of this type",
      source: src,
      tone: week.n ? "warn" : "neutral",
    });
  }
  if (e.resource) {
    const earlier = (await get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM events WHERE org_id = ? AND resource = ? AND action = ? AND status IN ('executed', 'allowed', 'executing') AND id != ?",
      org.id,
      e.resource,
      e.action,
      e.id,
    ))!.n;
    if (earlier) facts.push({ label: "Already done on this resource", value: `${earlier} earlier ${earlier === 1 ? "time" : "times"}`, source: src, tone: "warn" });
  }
  if (e.untrusted_input_seen) {
    facts.push({
      label: "Untrusted content",
      value: `The agent read content from outside before this request${untrustedSource ? ` (${untrustedSource})` : ""}. Its explanation may have been influenced.`,
      source: src,
      tone: "danger",
    });
  }
  for (const v of verdicts) {
    if (v.effect !== "allow") facts.push({ label: "Why a person is needed", value: v.detail, source: v.name, tone: "neutral" });
  }
  return facts;
}

// --- the decision ------------------------------------------------------------

/**
 * The decision flow from the roadmap (3.3): build the standard event, check for
 * a duplicate, check the agent, the tool, limits, rules and risk, then allow,
 * block or ask a human. Synchronous and transactional, so two requests can
 * never both pass a limit that only one of them fits under.
 */
export async function decide(ctx: DecideContext, req: ActionRequest): Promise<Outcome> {
  const { org, agent, source, now } = ctx;
  const live = ctx.live !== false;
  if (!ctx.reportOnly) await expireOverdue(org, now, live);

  return await tx(async () => {
    const params = req.params && typeof req.params === "object" && !Array.isArray(req.params) ? req.params : {};
    const toolName = (req.tool?.trim() || req.action?.trim() || "").slice(0, 200);
    if (!toolName) throw new RequestError("Send a `tool` name or an `action` type.");

    const tool = await upsertTool(org.id, toolName, now, req.knownAction);
    const link = await sightTool(org.id, agent.id, tool.id, connectionFor(source), now);
    const unclassified = tool.status !== "confirmed";
    const action = unclassified ? (isKnownAction(req.action) ? req.action! : (tool.suggested_action ?? "unknown")) : tool.action!;
    const type = getAction(action);
    const resource = req.resource ? String(req.resource).slice(0, 300) : null;
    const amount = readAmount(params);
    const fp = fingerprint(action, resource, params);
    const key = resource && type.dedupeBy === "resource" ? `${resource}:${action}` : `${toolName}:${action}:${fp.slice(7, 39)}`;
    const clientKey = req.idempotencyKey ? String(req.idempotencyKey).slice(0, 200) : null;

    if (req.untrustedInputSeen) await markRunUntrusted(org, agent, req.runId, "reported by the agent", now);
    const seen = await runState(org, agent, req.runId, now);
    const untrusted = seen.untrusted;

    // Automated risk checks may only raise risk, never lower it.
    let risk: Risk = type.risk;
    if (untrusted && type.external && RISK_ORDER[risk] < RISK_ORDER.high) risk = "high";

    const observe = agent.mode === "observe";
    const draft: ActionEvent = {
      id: newId("evt"),
      org_id: org.id,
      agent_id: agent.id,
      run_id: req.runId ? String(req.runId).slice(0, 120) : null,
      source,
      enforcement: ENFORCED_SOURCES.includes(source) ? "enforced" : "cooperative",
      tool: toolName,
      action,
      resource,
      params,
      params_fingerprint: fp,
      idempotency_key: key,
      client_key: clientKey,
      untrusted_input_seen: untrusted ? 1 : 0,
      risk,
      decision: "ALLOW",
      would_decision: "ALLOW",
      observe: 0,
      rules: [],
      reason: null,
      status: "allowed",
      amount,
      currency: amount !== null ? (readString(params, "currency") ?? "usd").toLowerCase() : null,
      customer: readString(params, "customer", "customer_id"),
      money_state: "none",
      cost_usd: 0,
      model: null,
      tokens_in: 0,
      tokens_out: 0,
      explanation: req.explanation ? String(req.explanation).slice(0, 2000) : null,
      result: null,
      approval_id: null,
      duplicate_of: null,
      created_at: now,
      completed_at: null,
    };
    const actor = agentActor(agent);
    // Declared before `evaluate` can run: it reads both.
    let repeatOf: ActionEvent | undefined;
    const changedFrom: ActionEvent[] = [];

    const finish = async (e: ActionEvent, auditAction: string): Promise<ActionEvent> => {
      await insertEvent(e);
      await audit(org.id, actor, auditAction, { type: "event", id: e.id }, {
        tool: e.tool, action: e.action, resource: e.resource ?? undefined, amount: e.amount ?? undefined,
        source: e.source, rules: e.rules.map((r) => r.name), observe: e.observe ? true : undefined, reason: e.reason ?? undefined,
      }, now);
      return e;
    };
    const blocked = async (verdict: AppliedRule): Promise<Outcome> => {
      const e = await finish({ ...draft, decision: "BLOCK", would_decision: "BLOCK", status: "blocked", rules: [verdict], reason: verdict.detail, completed_at: now }, "action.blocked");
      return { event: e, outcome: "block", duplicate: false, alreadyExecuted: false };
    };

    if (ctx.reportOnly) {
      const verdicts = await evaluate();
      const would = strictest(verdicts);
      const e = await finish({
        ...draft, decision: "NONE", would_decision: would, status: "observed", rules: verdicts,
        reason: would === "ALLOW" ? null : verdicts.find((v) => v.effect !== "allow")!.detail,
        money_state: amount !== null && type.money ? "settled" : "none", completed_at: now,
      }, "action.reported");
      return { event: e, outcome: "allow", duplicate: false, alreadyExecuted: true };
    }

    // 1. The kill switch and token scope hold in every mode, including observe.
    if (agent.status !== "active") {
      return await blocked({
        id: "builtin:agent_stopped",
        name: agent.status === "killed" ? "Kill switch" : "Agent paused",
        effect: "block",
        kind: "builtin",
        detail: agent.status === "killed" ? "This agent was stopped with the kill switch. Every action is blocked." : `This agent is paused${agent.status_reason ? `: ${agent.status_reason}` : "."}`,
      });
    }
    if (ctx.token && !ctx.token.scopes.some((s) => matchesPattern(s, action) || matchesPattern(s, toolName))) {
      return await blocked({ id: "builtin:token_scope", name: "Token scope", effect: "block", kind: "builtin", detail: `This token is not scoped for ${action}.` });
    }

    // 2. Duplicate check, keyed on the action itself rather than on the request.
    // Waiting, approved and rejected requests are matched for every action, so a
    // retry never opens a second approval. "Already ran" applies to actions that
    // must not run twice; reads may repeat freely.
    {
      const prior = await priorEvent(org, agent.id, key, clientKey, fp, now);
      if (prior) {
        const same = prior.params_fingerprint === fp;
        const duplicateRow = async (decision: Decision, reason: string): Promise<ActionEvent> =>
          finish({ ...draft, decision, would_decision: decision, status: "duplicate", duplicate_of: prior.id, reason, approval_id: prior.approval_id, completed_at: now }, "action.duplicate");

        if (same && prior.status === "pending") {
          await duplicateRow("ASK_HUMAN", "The same request is already waiting for approval; no second request was created.");
          return { event: prior, outcome: "pending", duplicate: true, alreadyExecuted: false, approval: prior.approval_id ? await getApproval(org.id, prior.approval_id) : undefined };
        }
        if (same && prior.status === "approved") {
          // The approval is used exactly once: this call turns it into a permit.
          await updateEvent(prior.id, { status: "allowed" });
          await audit(org.id, actor, "approval.used", { type: "event", id: prior.id }, { approval_id: prior.approval_id, fingerprint: fp }, now);
          const allowed = await getEvent(org.id, prior.id);
          if (!allowed) throw new RequestError("Event not found.", 404, "not_found");
          return { event: allowed, outcome: "allow", duplicate: false, alreadyExecuted: false };
        }
        if (same && prior.status === "rejected" && !observe) {
          return await blocked({ id: "builtin:rejected", name: "Already rejected", effect: "block", kind: "builtin", detail: `${prior.reason ?? "A person rejected this exact request."} Asking again does not change the answer.` });
        }
        const ran = (type.dedupe || !!clientKey) && (prior.status === "executing" || prior.status === "executed" || prior.status === "allowed");
        if (ran && req.confirmRepeat) {
          repeatOf = prior;
        } else if (ran && (!observe || source === "vault")) {
          // A cooperative permit that never reported completion is re-issued,
          // because the agent may have crashed before acting on it.
          const reissue = same && prior.status === "allowed" && source !== "vault" && prior.agent_id === agent.id;
          await duplicateRow("ALLOW", reissue ? "Same request as before; the earlier permit was returned." : "This action already ran; the earlier result was returned instead of running it again.");
          return { event: prior, outcome: "allow", duplicate: true, alreadyExecuted: !reissue };
        } else if (ran) {
          draft.duplicate_of = prior.id;
        } else if (!same && (prior.status === "pending" || prior.status === "approved")) {
          changedFrom.push(prior);
        }
      }
    }

    // 3. Checks.
    async function evaluate(): Promise<AppliedRule[]> {
      const verdicts: AppliedRule[] = [];
      if (unclassified && org.settings.unknownToolsAskHuman) {
        verdicts.push({
          id: "builtin:unknown_tool", name: "Unknown tool", effect: "ask_human", kind: "builtin",
          detail: `"${toolName}" has not been classified yet, so it is not trusted.${tool.suggested_action ? ` It looks like "${getAction(tool.suggested_action).label.toLowerCase()}".` : ""}`,
        });
      }
      if (link.permission === "deny") verdicts.push({ id: "permission:deny", name: "Tool permission", effect: "block", kind: "permission", detail: `${agent.name} is not allowed to use ${toolName}.` });
      if (link.permission === "ask") verdicts.push({ id: "permission:ask", name: "Tool permission", effect: "ask_human", kind: "permission", detail: `${agent.name} must ask before using ${toolName}.` });
      if (link.permission === "allow") verdicts.push({ id: "permission:allow", name: "Tool permission", effect: "allow", kind: "permission", detail: `${agent.name} is allowed to use ${toolName}.` });

      verdicts.push(...matchRules(await listRules(org.id), agent.id, buildContext(org, agent, draft)));
      verdicts.push(...await checkLimits(org, { agentId: agent.id, action, amount, currency: draft.currency, customer: draft.customer, resource }, now));

      if (org.settings.untrustedExfiltrationGuard && untrusted && type.external && await canReachPrivateData(agent)) {
        verdicts.push({
          id: "builtin:untrusted_exfiltration", name: "Untrusted content guard", effect: "ask_human", kind: "builtin",
          detail: "The agent has read untrusted content and can reach private data, so anything it sends outside needs a person.",
        });
      }
      if (repeatOf) {
        verdicts.push({ id: "builtin:deliberate_repeat", name: "Deliberate repeat", effect: "ask_human", kind: "builtin", detail: `This action already ran (${repeatOf.id}). Repeating it on purpose needs confirmation.` });
      }
      // Irreversible and high-risk actions are strict by default. An explicit
      // allow lifts only this default, never a block or another ask.
      const explicitAllow = verdicts.some((v) => v.effect === "allow");
      if (org.settings.strictIrreversible && !explicitAllow && RISK_ORDER[risk] >= RISK_ORDER.high && !unclassified) {
        verdicts.push({
          id: "builtin:high_risk_default", name: "High-risk default", effect: "ask_human", kind: "builtin",
          detail: `${type.label} is ${type.reversible ? "high risk" : "irreversible"}, so it needs approval unless a rule allows it.`,
        });
      }
      return verdicts;
    }

    const verdicts = await evaluate();
    const would = strictest(verdicts);
    const decision: Decision = observe ? "ALLOW" : would;
    const deciding = verdicts.filter((v) => v.effect === (would === "BLOCK" ? "block" : "ask_human"));
    const event: ActionEvent = {
      ...draft,
      decision,
      would_decision: would,
      observe: observe ? 1 : 0,
      rules: verdicts,
      reason: would === "ALLOW" ? null : deciding.map((v) => v.detail).join(" "),
    };

    for (const prior of changedFrom) {
      await createAlert(org, {
        kind: "approval.parameters_changed", severity: "warning", title: `${agent.name} changed a request after asking`,
        body: `A new request for ${action} on ${resource ?? "the same target"} has different parameters from ${prior.id}, which was ${prior.status}. The earlier approval does not cover it.`,
        agentId: agent.id, eventId: event.id,
      }, now, live);
    }

    if (decision === "BLOCK") {
      event.status = "blocked";
      event.completed_at = now;
      await finish(event, "action.blocked");
      if (deciding.some((v) => v.kind === "limit")) emitWebhook(org, "limit.reached", { event_id: event.id, agent_id: agent.id, limits: deciding.map((v) => v.name) }, now, live);
      return { event, outcome: "block", duplicate: false, alreadyExecuted: false };
    }

    if (decision === "ASK_HUMAN") {
      const threshold = org.settings.twoPersonThreshold;
      const required = verdicts.some((v) => v.two) || (threshold !== null && amount !== null && amount >= threshold) ? 2 : 1;
      event.status = "pending";
      await finish(event, "action.pending");
      // Facts first: what the source system and our own records say. The agent's explanation is kept apart.
      const facts = [...(req.sourceFacts ?? []), ...(await ownFacts(org, event, verdicts, seen.source, now))];
      if (required === 2) facts.push({ label: "Two-person approval", value: "Two different authorized people must approve.", source: "AgentGuard records", tone: "warn" });
      const approval = await createApproval(org, agent, event, { facts, explanation: event.explanation, required }, now, live);
      await updateEvent(event.id, { approval_id: approval.id });
      event.approval_id = approval.id;
      if (deciding.some((v) => v.kind === "limit")) emitWebhook(org, "limit.reached", { event_id: event.id, agent_id: agent.id, limits: deciding.filter((v) => v.kind === "limit").map((v) => v.name) }, now, live);
      return { event, outcome: "pending", duplicate: false, alreadyExecuted: false, approval };
    }

    event.status = "allowed";
    event.money_state = amount !== null && type.money ? "reserved" : "none";
    await finish(event, observe && would !== "ALLOW" ? "action.observed" : "action.allowed");
    return { event, outcome: "allow", duplicate: false, alreadyExecuted: false };
  });
}

/** A request the caller got wrong, as opposed to a decision. Maps to HTTP 400. */
export class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "invalid_request",
  ) {
    super(message);
  }
}

// --- completion reports --------------------------------------------------------

export interface CompletionReport {
  eventId: string;
  status: "completed" | "failed";
  result?: unknown;
  /** The parameters the agent actually executed with. Compared against what was allowed. */
  params?: Record<string, unknown>;
}

/**
 * Cooperative checkpoints report what happened after acting. If the executed
 * parameters differ from what was allowed, AgentGuard cannot undo it, but it
 * raises a critical alert: this is the "approve $50, execute $5,000" loophole.
 */
export async function reportCompletion(ctx: Pick<DecideContext, "org" | "agent" | "now" | "live">, report: CompletionReport): Promise<ActionEvent> {
  const { org, agent, now } = ctx;
  const completed = await tx(async () => {
    const event = await getEvent(org.id, report.eventId);
    if (!event || event.agent_id !== agent.id) throw new RequestError("Event not found for this agent.", 404, "not_found");
    if (event.status !== "allowed" && event.status !== "approved") {
      throw new RequestError(`This action is ${event.status}; a completion cannot be reported for it.`, 409, "invalid_state");
    }
    const type = getAction(event.action);
    let mismatch = false;
    if (report.params) {
      mismatch = fingerprint(event.action, event.resource, report.params) !== event.params_fingerprint;
    }
    const ok = report.status === "completed";
    await updateEvent(event.id, {
      status: ok ? "executed" : "failed",
      result: mismatch ? { reported: report.result ?? null, parameter_mismatch: true, executed_params: report.params } : (report.result ?? null),
      money_state: event.amount !== null && type.money ? (ok ? "settled" : "released") : event.money_state,
      completed_at: now,
    });
    await audit(org.id, agentActor(agent), ok ? "action.completed" : "action.failed", { type: "event", id: event.id }, { tool: event.tool, parameter_mismatch: mismatch || undefined }, now);
    if (mismatch) {
      await createAlert(org, {
        kind: "execution.parameter_mismatch", severity: "critical", title: `${agent.name} executed something different from what was allowed`,
        body: `${event.tool} was allowed with one set of parameters and reported as executed with another. This connection is cooperative, so AgentGuard could not prevent it. Move this tool to the vault to enforce it.`,
        agentId: agent.id, eventId: event.id,
      }, now, ctx.live !== false);
    }
    const updated = await getEvent(org.id, event.id);
    if (!updated) throw new RequestError("Event not found.", 404, "not_found");
    return updated;
  });
  return completed;
}

/** The events of one run, oldest first: the "why did it do this?" timeline. */
export async function runTimeline(orgId: string, runId: string): Promise<ActionEvent[]> {
  return (await all<Parameters<typeof parseEvent>[0]>("SELECT * FROM events WHERE org_id = ? AND run_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 200", orgId, runId)).map(parseEvent);
}

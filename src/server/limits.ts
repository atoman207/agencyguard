import "server-only";
import type { SQLInputValue } from "node:sqlite";
import { all, get, run } from "./db";
import { newId } from "./crypto";
import { audit, type Actor } from "./audit";
import { matchesPattern } from "@/lib/catalog";
import { cost as fmtCost, money } from "@/lib/format";
import type { AppliedRule, Limit, LimitKind, LimitPeriod, LimitScope, Org } from "@/lib/types";

export const PERIOD_MS: Record<Exclude<LimitPeriod, "action">, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

export const PERIOD_LABEL: Record<LimitPeriod, string> = {
  action: "per action",
  hour: "in any hour",
  day: "in any 24 hours",
  week: "in any 7 days",
  month: "in any 30 days",
};

export function listLimits(orgId: string): Limit[] {
  return all<Limit>("SELECT * FROM limits WHERE org_id = ? ORDER BY created_at ASC", orgId);
}

export interface LimitInput {
  name: string;
  kind: LimitKind;
  scope: LimitScope;
  agentId: string | null;
  action: string | null;
  period: LimitPeriod;
  value: number;
  onExceed: "block" | "ask_human";
  template?: string | null;
}

export function createLimit(org: Org, actor: Actor, input: LimitInput, now: number): string {
  if (!(input.value > 0)) throw new Error("The limit needs a value above zero.");
  if (!input.name.trim()) throw new Error("Give the limit a name.");
  let { scope, period } = input;
  // A per-action limit has no window; every other scope needs one.
  if (scope === "action") period = "action";
  else if (period === "action") period = "day";
  if (input.kind === "cost" && scope !== "agent" && scope !== "organization") scope = "agent";
  const id = newId("lim");
  run(
    "INSERT INTO limits (id, org_id, name, kind, scope, agent_id, action, period, value, on_exceed, template, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    org.id,
    input.name.trim(),
    input.kind,
    scope,
    input.agentId,
    input.kind === "cost" ? null : input.action || null,
    period,
    input.value,
    // An AI-cost budget is checked before the model call; there is nothing to approve.
    input.kind === "cost" ? "block" : input.onExceed,
    input.template ?? null,
    now,
  );
  audit(org.id, actor, "limit.created", { type: "limit", id }, { name: input.name, kind: input.kind, scope, period, value: input.value, on_exceed: input.onExceed }, now);
  return id;
}

export function setLimitEnabled(org: Org, actor: Actor, id: string, enabled: boolean, now: number): void {
  if (run("UPDATE limits SET enabled = ? WHERE org_id = ? AND id = ?", enabled ? 1 : 0, org.id, id)) {
    audit(org.id, actor, enabled ? "limit.enabled" : "limit.disabled", { type: "limit", id }, {}, now);
  }
}

export function updateLimit(org: Org, actor: Actor, id: string, input: LimitInput, now: number): void {
  const before = get<Limit>("SELECT * FROM limits WHERE org_id = ? AND id = ?", org.id, id);
  if (!before) throw new Error("Limit not found.");
  if (!(input.value > 0)) throw new Error("The limit needs a value above zero.");
  if (!input.name.trim()) throw new Error("Give the limit a name.");
  let { scope, period } = input;
  if (scope === "action") period = "action";
  else if (period === "action") period = "day";
  if (input.kind === "cost" && scope !== "agent" && scope !== "organization") scope = "agent";
  const onExceed = input.kind === "cost" ? "block" : input.onExceed;
  run(
    "UPDATE limits SET name = ?, kind = ?, scope = ?, agent_id = ?, action = ?, period = ?, value = ?, on_exceed = ? WHERE org_id = ? AND id = ?",
    input.name.trim(),
    input.kind,
    scope,
    input.agentId,
    input.kind === "cost" ? null : input.action || null,
    period,
    input.value,
    onExceed,
    org.id,
    id,
  );
  audit(org.id, actor, "limit.updated", { type: "limit", id }, { name: input.name.trim(), kind: input.kind, scope, period, value: input.value, on_exceed: onExceed }, now);
}

export function deleteLimit(org: Org, actor: Actor, id: string, now: number): void {
  const limit = get<Limit>("SELECT * FROM limits WHERE org_id = ? AND id = ?", org.id, id);
  if (!limit) return;
  run("DELETE FROM limits WHERE org_id = ? AND id = ?", org.id, id);
  audit(org.id, actor, "limit.deleted", { type: "limit", id }, { name: limit.name }, now);
}

export interface LimitSubject {
  agentId: string;
  action: string;
  amount: number | null;
  currency: string | null;
  customer: string | null;
  resource: string | null;
}

/** Spend that already counts against a limit: reserved (approved, in flight) plus settled. */
function windowTotal(orgId: string, limit: Limit, subject: LimitSubject, now: number): number | null {
  if (limit.period === "action") return 0;
  const where = ["org_id = ?", "created_at >= ?"];
  const params: SQLInputValue[] = [orgId, now - PERIOD_MS[limit.period]];
  if (limit.scope === "customer") {
    if (!subject.customer) return null;
    where.push("customer = ?");
    params.push(subject.customer);
  } else if (limit.scope === "resource") {
    if (!subject.resource) return null;
    where.push("resource = ?");
    params.push(subject.resource);
  } else if (limit.scope === "agent") {
    where.push("agent_id = ?");
    params.push(subject.agentId);
  }
  if (limit.agent_id && limit.scope !== "agent") {
    where.push("agent_id = ?");
    params.push(limit.agent_id);
  }
  if (limit.action) {
    where.push("action LIKE ?");
    params.push(limit.action.replace(/\*/g, "%"));
  }
  if (limit.kind === "money") {
    where.push("money_state IN ('reserved', 'settled')", "currency = ?");
    params.push(subject.currency ?? "usd");
    return get<{ total: number }>(`SELECT COALESCE(SUM(amount), 0) AS total FROM events WHERE ${where.join(" AND ")}`, ...params)!.total;
  }
  if (limit.kind === "cost") {
    return get<{ total: number }>(`SELECT COALESCE(SUM(cost_usd), 0) AS total FROM events WHERE ${where.join(" AND ")}`, ...params)!.total;
  }
  where.push("status IN ('allowed', 'approved', 'executing', 'executed', 'observed')");
  return get<{ total: number }>(`SELECT COUNT(*) AS total FROM events WHERE ${where.join(" AND ")}`, ...params)!.total;
}

function applies(limit: Limit, subject: LimitSubject): boolean {
  if (!limit.enabled) return false;
  if (limit.agent_id && limit.agent_id !== subject.agentId) return false;
  if (limit.action && !matchesPattern(limit.action, subject.action)) return false;
  return true;
}

const scopeLabel = (limit: Limit, s: LimitSubject) =>
  limit.scope === "customer" ? `customer ${s.customer}` : limit.scope === "resource" ? `${s.resource}` : limit.scope === "agent" ? "this agent" : "the organization";

/** Money and count limits this action would break. */
export function checkLimits(org: Org, subject: LimitSubject, now: number): AppliedRule[] {
  const hits: AppliedRule[] = [];
  for (const limit of listLimits(org.id)) {
    if (limit.kind === "cost" || !applies(limit, subject)) continue;
    if (limit.kind === "money") {
      if (subject.amount === null) continue;
      if (limit.period === "action") {
        if (subject.amount > limit.value) {
          hits.push(hit(limit, `${money(subject.amount, subject.currency)} is above the ${money(limit.value, subject.currency)} limit for a single action.`));
        }
        continue;
      }
      const used = windowTotal(org.id, limit, subject, now);
      if (used === null) continue;
      if (used + subject.amount > limit.value) {
        hits.push(
          hit(
            limit,
            `This would bring ${scopeLabel(limit, subject)} to ${money(used + subject.amount, subject.currency)} ${PERIOD_LABEL[limit.period]}; the limit is ${money(limit.value, subject.currency)}.`,
          ),
        );
      }
    } else {
      const used = windowTotal(org.id, limit, subject, now);
      if (used === null) continue;
      if (used + 1 > limit.value) {
        hits.push(hit(limit, `${scopeLabel(limit, subject)} has already done this ${used} times ${PERIOD_LABEL[limit.period]}; the limit is ${limit.value}.`));
      }
    }
  }
  return hits;
}

function hit(limit: Limit, detail: string): AppliedRule {
  return { id: limit.id, name: limit.name, effect: limit.on_exceed, detail, kind: "limit" };
}

/** AI-cost budgets already used up for this agent. Checked before a model call is forwarded. */
export function checkCostBudgets(org: Org, agentId: string, now: number): AppliedRule[] {
  const subject: LimitSubject = { agentId, action: "ai.completion", amount: null, currency: null, customer: null, resource: null };
  const hits: AppliedRule[] = [];
  for (const limit of listLimits(org.id)) {
    if (limit.kind !== "cost" || !limit.enabled) continue;
    if (limit.agent_id && limit.agent_id !== agentId) continue;
    const used = windowTotal(org.id, limit, subject, now) ?? 0;
    if (used >= limit.value) {
      hits.push({
        id: limit.id,
        name: limit.name,
        effect: "block",
        detail: `AI cost for ${scopeLabel(limit, subject)} is ${fmtCost(used)} ${PERIOD_LABEL[limit.period]}; the budget is ${fmtCost(limit.value)}.`,
        kind: "limit",
      });
    }
  }
  return hits;
}

export interface LimitUsage {
  limit: Limit;
  used: number | null;
}

/** Current usage for the limits page. Customer and resource limits have no single total, so they return null. */
export function limitUsage(org: Org, now: number): LimitUsage[] {
  return listLimits(org.id).map((limit) => {
    if (limit.period === "action" || limit.scope === "customer" || limit.scope === "resource") return { limit, used: null };
    if (limit.scope === "agent" && !limit.agent_id) return { limit, used: null };
    const subject: LimitSubject = { agentId: limit.agent_id ?? "", action: "", amount: null, currency: "usd", customer: null, resource: null };
    return { limit, used: windowTotal(org.id, limit, subject, now) };
  });
}

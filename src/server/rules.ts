import "server-only";
import { all, get, json, run } from "./db";
import { newId } from "./crypto";
import { audit, type Actor } from "./audit";
import { getAction } from "@/lib/catalog";
import { hourIn } from "@/lib/format";
import { countRecipients, describeRule, matchesAll, validateConditions, type RuleContext } from "@/lib/rule-fields";
import type { ActionEvent, Agent, AppliedRule, Condition, Org, Rule, RuleEffect } from "@/lib/types";

// The roadmap names OPA or Cedar as the rule engine. This MVP evaluates rules
// with the small condition evaluator in lib/rule-fields.ts instead.

type RuleRow = Omit<Rule, "conditions"> & { conditions: string };
const parse = (r: RuleRow): Rule => ({ ...r, conditions: json<Condition[]>(r.conditions, []) });

export function listRules(orgId: string): Rule[] {
  return all<RuleRow>("SELECT * FROM rules WHERE org_id = ? ORDER BY created_at ASC", orgId).map(parse);
}

export function getRule(orgId: string, id: string): Rule | undefined {
  const row = get<RuleRow>("SELECT * FROM rules WHERE org_id = ? AND id = ?", orgId, id);
  return row ? parse(row) : undefined;
}

export interface RuleInput {
  name: string;
  description?: string;
  agentId: string | null;
  conditions: unknown;
  effect: RuleEffect;
  template?: string | null;
  enabled?: boolean;
}

const EFFECTS: RuleEffect[] = ["allow", "ask_human", "ask_two", "block"];

function validate(input: RuleInput): Condition[] {
  if (!input.name.trim()) throw new Error("Give the rule a name.");
  if (!EFFECTS.includes(input.effect)) throw new Error("Choose what the rule should do.");
  const conditions = validateConditions(input.conditions);
  // A rule that allows everything would silently switch off the default protections.
  if (input.effect === "allow" && conditions.length === 0) throw new Error("An allow rule needs at least one condition.");
  return conditions;
}

export function createRule(org: Org, actor: Actor, input: RuleInput, now: number): string {
  const conditions = validate(input);
  const id = newId("rul");
  run(
    "INSERT INTO rules (id, org_id, name, description, agent_id, conditions, effect, enabled, template, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    org.id,
    input.name.trim(),
    input.description?.trim() ?? "",
    input.agentId,
    JSON.stringify(conditions),
    input.effect,
    input.enabled === false ? 0 : 1,
    input.template ?? null,
    actor.id,
    now,
    now,
  );
  audit(org.id, actor, "rule.created", { type: "rule", id }, { name: input.name, rule: describeRule(conditions, input.effect), agent_id: input.agentId }, now);
  return id;
}

export function updateRule(org: Org, actor: Actor, id: string, input: RuleInput, now: number): void {
  const before = getRule(org.id, id);
  if (!before) throw new Error("Rule not found.");
  const conditions = validate(input);
  run(
    "UPDATE rules SET name = ?, description = ?, agent_id = ?, conditions = ?, effect = ?, version = version + 1, updated_at = ? WHERE org_id = ? AND id = ?",
    input.name.trim(),
    input.description?.trim() ?? "",
    input.agentId,
    JSON.stringify(conditions),
    input.effect,
    now,
    org.id,
    id,
  );
  audit(
    org.id,
    actor,
    "rule.updated",
    { type: "rule", id },
    { name: input.name, version: before.version + 1, before: describeRule(before.conditions, before.effect), after: describeRule(conditions, input.effect) },
    now,
  );
}

export function setRuleEnabled(org: Org, actor: Actor, id: string, enabled: boolean, now: number): void {
  const rule = getRule(org.id, id);
  if (!rule) return;
  run("UPDATE rules SET enabled = ?, updated_at = ? WHERE org_id = ? AND id = ?", enabled ? 1 : 0, now, org.id, id);
  audit(org.id, actor, enabled ? "rule.enabled" : "rule.disabled", { type: "rule", id }, { name: rule.name }, now);
}

export function deleteRule(org: Org, actor: Actor, id: string, now: number): void {
  const rule = getRule(org.id, id);
  if (!rule) return;
  run("DELETE FROM rules WHERE org_id = ? AND id = ?", org.id, id);
  audit(org.id, actor, "rule.deleted", { type: "rule", id }, { name: rule.name, rule: describeRule(rule.conditions, rule.effect) }, now);
}

type ContextEvent = Pick<ActionEvent, "action" | "tool" | "risk" | "source" | "enforcement" | "amount" | "customer" | "resource" | "params" | "untrusted_input_seen" | "created_at">;

export function buildContext(org: Org, agent: Pick<Agent, "environment" | "platform">, e: ContextEvent): RuleContext {
  const type = getAction(e.action);
  return {
    action: e.action,
    tool: e.tool,
    category: type.category,
    risk: e.risk,
    reversible: type.reversible,
    environment: agent.environment,
    platform: agent.platform,
    source: e.source,
    enforcement: e.enforcement,
    amount: e.amount,
    customer: e.customer,
    resource: e.resource,
    recipient_count: countRecipients(e.params),
    untrusted_input_seen: !!e.untrusted_input_seen,
    hour: hourIn(e.created_at, org.settings.timezone),
    params: e.params,
  };
}

export function matchRules(rules: Rule[], agentId: string, ctx: RuleContext): AppliedRule[] {
  const hits: AppliedRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.agent_id && rule.agent_id !== agentId) continue;
    if (!matchesAll(ctx, rule.conditions)) continue;
    hits.push({
      id: rule.id,
      name: rule.name,
      effect: rule.effect === "ask_two" ? "ask_human" : rule.effect,
      detail: describeRule(rule.conditions, rule.effect),
      kind: "rule",
      two: rule.effect === "ask_two" || undefined,
    });
  }
  return hits;
}

export interface ReplayResult {
  days: number;
  total: number;
  matched: number;
  /** Matching actions whose outcome would have been stricter than what actually happened. */
  changed: number;
  sample: { id: string; agent: string; tool: string; action: string; amount: number | null; currency: string | null; created_at: number; was: string }[];
}

/**
 * Policy replay: runs a draft rule over recent real activity and reports what
 * it would have caught, before the rule is switched on.
 */
export function replayRule(org: Org, draft: { conditions: unknown; effect: RuleEffect; agentId: string | null }, days: number, now: number): ReplayResult {
  const conditions = validateConditions(draft.conditions);
  const agents = new Map(all<Agent>("SELECT * FROM agents WHERE org_id = ?", org.id).map((a) => [a.id, a]));
  const rows = all<{
    id: string; agent_id: string; tool: string; action: string; risk: ActionEvent["risk"]; source: ActionEvent["source"];
    enforcement: ActionEvent["enforcement"]; amount: number | null; currency: string | null; customer: string | null;
    resource: string | null; params: string; untrusted_input_seen: number; created_at: number; would_decision: string;
  }>(
    `SELECT id, agent_id, tool, action, risk, source, enforcement, amount, currency, customer, resource, params,
            untrusted_input_seen, created_at, would_decision
     FROM events WHERE org_id = ? AND created_at >= ? AND action != 'ai.completion' AND status != 'duplicate'
     ORDER BY created_at DESC`,
    org.id,
    now - days * 86_400_000,
  );
  const strictness: Record<string, number> = { NONE: 0, ALLOW: 0, ASK_HUMAN: 1, BLOCK: 2 };
  const draftStrictness = draft.effect === "block" ? 2 : draft.effect === "allow" ? 0 : 1;
  const result: ReplayResult = { days, total: rows.length, matched: 0, changed: 0, sample: [] };
  for (const row of rows) {
    const agent = agents.get(row.agent_id);
    if (!agent || (draft.agentId && draft.agentId !== agent.id)) continue;
    const ctx = buildContext(org, agent, { ...row, params: json<Record<string, unknown>>(row.params, {}) });
    if (!matchesAll(ctx, conditions)) continue;
    result.matched++;
    if (draftStrictness > (strictness[row.would_decision] ?? 0)) result.changed++;
    if (result.sample.length < 8) {
      result.sample.push({
        id: row.id, agent: agent.name, tool: row.tool, action: row.action, amount: row.amount,
        currency: row.currency, created_at: row.created_at, was: row.would_decision,
      });
    }
  }
  return result;
}

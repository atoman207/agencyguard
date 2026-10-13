// Rule conditions: field metadata for the visual builder, plain-language
// descriptions, and the evaluator. Pure functions, shared by the builder UI,
// the decision engine and policy replay so all three agree.

import { ACTIONS, ACTION_CATEGORIES, RISK_ORDER, getAction, matchesPattern } from "./catalog";
import type { Condition, Environment, Enforcement, Risk, RuleEffect, Source } from "./types";

export interface RuleContext {
  action: string;
  tool: string;
  category: string;
  risk: Risk;
  reversible: boolean;
  environment: Environment;
  platform: string;
  source: Source;
  enforcement: Enforcement;
  amount: number | null;
  customer: string | null;
  resource: string | null;
  recipient_count: number;
  untrusted_input_seen: boolean;
  /** Hour of day, 0-23, in the organization's time zone. */
  hour: number;
  params: Record<string, unknown>;
}

export type FieldType = "action" | "enum" | "text" | "number" | "boolean" | "hours";

export interface RuleField {
  id: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  ops: string[];
  hint?: string;
}

const opt = (values: string[]) => values.map((v) => ({ value: v, label: v }));

export const RULE_FIELDS: RuleField[] = [
  {
    id: "action",
    label: "Action type",
    type: "action",
    options: ACTIONS.map((a) => ({ value: a.id, label: `${a.label} (${a.id})` })),
    ops: ["is", "is_not", "matches"],
  },
  { id: "category", label: "Action category", type: "enum", options: opt(ACTION_CATEGORIES), ops: ["is", "is_not"] },
  { id: "amount", label: "Amount", type: "number", ops: ["gt", "gte", "lt", "lte"], hint: "In the action's own currency" },
  { id: "recipient_count", label: "Number of recipients", type: "number", ops: ["gt", "gte", "lt", "lte"] },
  { id: "environment", label: "Environment", type: "enum", options: opt(["production", "staging", "development"]), ops: ["is", "is_not"] },
  { id: "risk", label: "Risk level", type: "enum", options: opt(["low", "medium", "high", "critical"]), ops: ["is", "at_least"] },
  { id: "reversible", label: "Can be undone", type: "boolean", ops: ["is_true", "is_false"] },
  { id: "untrusted_input_seen", label: "Agent has read untrusted content", type: "boolean", ops: ["is_true", "is_false"] },
  { id: "hour", label: "Time of day", type: "hours", ops: ["between", "not_between"], hint: "Hours 0-24 in your time zone, e.g. 9-18" },
  { id: "tool", label: "Tool name", type: "text", ops: ["is", "matches", "contains"], hint: "Use * as a wildcard with 'matches'" },
  { id: "customer", label: "Customer", type: "text", ops: ["is", "is_not"] },
  { id: "resource", label: "Resource", type: "text", ops: ["is", "matches", "contains"] },
  { id: "source", label: "Connection method", type: "enum", options: opt(["vault", "ai_gateway", "mcp_gateway", "sdk", "n8n", "make", "api"]), ops: ["is", "is_not"] },
  { id: "enforcement", label: "Protection level", type: "enum", options: opt(["enforced", "cooperative"]), ops: ["is", "is_not"] },
];

export const OP_LABELS: Record<string, string> = {
  is: "is",
  is_not: "is not",
  matches: "matches",
  contains: "contains",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
  at_least: "is at least",
  is_true: "is true",
  is_false: "is false",
  between: "is between",
  not_between: "is outside",
};

export const EFFECT_LABELS: Record<RuleEffect, string> = {
  allow: "allow it",
  ask_human: "ask a human",
  ask_two: "ask two people",
  block: "block it",
};

export function fieldMeta(id: string): RuleField | undefined {
  return RULE_FIELDS.find((f) => f.id === id);
}

function fieldValue(ctx: RuleContext, field: string): unknown {
  if (field.startsWith("param:")) {
    let v: unknown = ctx.params;
    for (const key of field.slice(6).split(".")) {
      if (v === null || typeof v !== "object") return undefined;
      v = (v as Record<string, unknown>)[key];
    }
    return v;
  }
  return (ctx as unknown as Record<string, unknown>)[field];
}

function parseRange(value: unknown): [number, number] | null {
  const m = String(value).match(/^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

export function evaluateCondition(ctx: RuleContext, cond: Condition): boolean {
  const actual = fieldValue(ctx, cond.field);
  const expected = cond.value;
  switch (cond.op) {
    case "is":
      return String(actual ?? "").toLowerCase() === String(expected).toLowerCase();
    case "is_not":
      return String(actual ?? "").toLowerCase() !== String(expected).toLowerCase();
    case "matches":
      return matchesPattern(String(expected), String(actual ?? ""));
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase());
    // A missing number never satisfies a numeric comparison: a rule about
    // amounts must not fire on an action that has no amount.
    case "gt":
      return typeof actual === "number" && actual > Number(expected);
    case "gte":
      return typeof actual === "number" && actual >= Number(expected);
    case "lt":
      return typeof actual === "number" && actual < Number(expected);
    case "lte":
      return typeof actual === "number" && actual <= Number(expected);
    case "at_least":
      return RISK_ORDER[actual as Risk] >= RISK_ORDER[expected as Risk];
    case "is_true":
      return actual === true;
    case "is_false":
      return actual === false;
    case "between":
    case "not_between": {
      const range = parseRange(expected);
      if (!range || typeof actual !== "number") return false;
      const [from, to] = range;
      // 22-6 wraps past midnight.
      const inside = from <= to ? actual >= from && actual < to : actual >= from || actual < to;
      return cond.op === "between" ? inside : !inside;
    }
    default:
      return false;
  }
}

export function matchesAll(ctx: RuleContext, conditions: Condition[]): boolean {
  return conditions.every((c) => evaluateCondition(ctx, c));
}

export function describeCondition(cond: Condition): string {
  const meta = fieldMeta(cond.field);
  const label = meta?.label.toLowerCase() ?? cond.field.replace(/^param:/, "parameter ");
  if (cond.op === "is_true") return label;
  if (cond.op === "is_false") return `not: ${label}`;
  let value = String(cond.value);
  if (cond.field === "action" && cond.op !== "matches") value = `"${getAction(value).label.toLowerCase()}"`;
  if (meta?.type === "hours") value = value.replace("-", ":00 and ") + ":00";
  return `${label} ${OP_LABELS[cond.op] ?? cond.op} ${value}`;
}

/** The rule read back in plain words, shown before anything is enabled. */
export function describeRule(conditions: Condition[], effect: RuleEffect): string {
  const when = conditions.length ? conditions.map(describeCondition).join(", and ") : "any action happens";
  return `If ${when}, then ${EFFECT_LABELS[effect]}.`;
}

export function countRecipients(params: Record<string, unknown>): number {
  if (typeof params.recipient_count === "number") return params.recipient_count;
  for (const key of ["recipients", "to"]) {
    const v = params[key];
    if (Array.isArray(v)) return v.length;
    if (typeof v === "string" && v.trim()) return v.split(/[,;]/).filter((s) => s.trim()).length;
  }
  return 0;
}

export function validateConditions(conditions: unknown): Condition[] {
  if (!Array.isArray(conditions)) throw new Error("Conditions must be a list.");
  return conditions.map((raw) => {
    const c = raw as Condition;
    const field = String(c.field ?? "");
    const meta = fieldMeta(field);
    if (!meta && !field.startsWith("param:")) throw new Error(`Unknown field "${field}".`);
    const op = String(c.op ?? "");
    if (!OP_LABELS[op] || (meta && !meta.ops.includes(op))) throw new Error(`"${op}" cannot be used with ${meta?.label ?? field}.`);
    let value: Condition["value"] = c.value ?? "";
    if (meta?.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value)) throw new Error(`${meta.label} needs a number.`);
    } else if (meta?.type === "hours") {
      const range = parseRange(value);
      if (!range || range[0] > 24 || range[1] > 24) throw new Error("Time of day needs a range such as 9-18.");
      value = `${range[0]}-${range[1]}`;
    } else if (meta?.type === "boolean") {
      value = true;
    } else {
      value = String(value).trim();
      if (!value) throw new Error(`${meta?.label ?? field} needs a value.`);
    }
    return { field, op, value };
  });
}

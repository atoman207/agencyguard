import "server-only";
import type { SQLInputValue } from "node:sqlite";
import { all, get, json, run } from "./db";
import type { ActionEvent, AppliedRule } from "@/lib/types";

type EventRow = Omit<ActionEvent, "params" | "rules" | "result"> & { params: string; rules: string; result: string | null };

export function parseEvent(r: EventRow): ActionEvent {
  return {
    ...r,
    params: json<Record<string, unknown>>(r.params, {}),
    rules: json<AppliedRule[]>(r.rules, []),
    result: r.result ? json<unknown>(r.result, null) : null,
  };
}

const COLUMNS = [
  "id", "org_id", "agent_id", "run_id", "source", "enforcement", "tool", "action", "resource", "params",
  "params_fingerprint", "idempotency_key", "client_key", "untrusted_input_seen", "risk", "decision",
  "would_decision", "observe", "rules", "reason", "status", "amount", "currency", "customer", "money_state",
  "cost_usd", "model", "tokens_in", "tokens_out", "explanation", "result", "approval_id", "duplicate_of",
  "created_at", "completed_at",
] as const;

export function insertEvent(e: ActionEvent): void {
  const row: Record<string, SQLInputValue> = {
    ...e,
    params: JSON.stringify(e.params),
    rules: JSON.stringify(e.rules),
    result: e.result === null || e.result === undefined ? null : JSON.stringify(e.result),
  } as unknown as Record<string, SQLInputValue>;
  run(`INSERT INTO events (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`, ...COLUMNS.map((c) => row[c] ?? null));
}

export function updateEvent(id: string, patch: Partial<ActionEvent>): void {
  const keys = Object.keys(patch) as (keyof ActionEvent)[];
  if (keys.length === 0) return;
  const values = keys.map((k) => {
    const v = patch[k];
    if (k === "params" || k === "rules" || k === "result") return v === null || v === undefined ? null : JSON.stringify(v);
    return (v ?? null) as SQLInputValue;
  });
  run(`UPDATE events SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...values, id);
}

export function getEvent(orgId: string, id: string): ActionEvent | undefined {
  const row = get<EventRow>("SELECT * FROM events WHERE org_id = ? AND id = ?", orgId, id);
  return row ? parseEvent(row) : undefined;
}

export interface EventFilters {
  agentId?: string;
  decision?: string;
  status?: string;
  action?: string;
  source?: string;
  runId?: string;
  q?: string;
  /** Leave out routine AI-model calls; blocked ones stay. */
  hideModelCalls?: boolean;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

function buildWhere(orgId: string, f: EventFilters): { where: string; params: SQLInputValue[] } {
  const where = ["org_id = ?"];
  const params: SQLInputValue[] = [orgId];
  const eq = (column: string, value?: string) => {
    if (!value) return;
    where.push(`${column} = ?`);
    params.push(value);
  };
  eq("agent_id", f.agentId);
  eq("status", f.status);
  eq("source", f.source);
  eq("run_id", f.runId);
  // "Would have" decisions count in observe mode, so filtering by decision
  // answers "what would enforcement have done".
  eq("would_decision", f.decision);
  if (f.action) {
    where.push("action LIKE ?");
    params.push(f.action.replace(/\*/g, "%"));
  }
  if (f.hideModelCalls) where.push("(action != 'ai.completion' OR would_decision = 'BLOCK')");
  if (f.q) {
    where.push("(tool LIKE ? OR resource LIKE ? OR customer LIKE ? OR id = ? OR params LIKE ?)");
    const like = `%${f.q}%`;
    params.push(like, like, like, f.q, like);
  }
  if (f.since) {
    where.push("created_at >= ?");
    params.push(f.since);
  }
  if (f.until) {
    where.push("created_at < ?");
    params.push(f.until);
  }
  return { where: where.join(" AND "), params };
}

export function listEvents(orgId: string, f: EventFilters = {}): ActionEvent[] {
  const { where, params } = buildWhere(orgId, f);
  return all<EventRow>(`SELECT * FROM events WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, f.limit ?? 50, f.offset ?? 0).map(parseEvent);
}

export function countEvents(orgId: string, f: EventFilters = {}): number {
  const { where, params } = buildWhere(orgId, f);
  return get<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE ${where}`, ...params)!.n;
}

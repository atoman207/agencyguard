import "server-only";
import { all, get, json, run } from "./db";
import { canonical, sha256 } from "./crypto";
import type { AuditEntry } from "@/lib/types";

export interface Actor {
  type: "user" | "agent" | "system";
  id: string | null;
  label: string;
}

export const SYSTEM: Actor = { type: "system", id: null, label: "AgentGuard" };

const GENESIS = "0".repeat(64);

function entryHash(prev: string, e: Omit<AuditEntry, "seq" | "hash" | "prev_hash">): string {
  return sha256(
    prev +
      canonical({
        org_id: e.org_id,
        actor_type: e.actor_type,
        actor_id: e.actor_id,
        actor_label: e.actor_label,
        action: e.action,
        target_type: e.target_type,
        target_id: e.target_id,
        details: e.details,
        created_at: e.created_at,
      }),
  );
}

/**
 * Appends to the organization's audit chain. Each entry's hash covers the
 * previous entry's hash, so editing or removing any row breaks every hash
 * after it and `verifyAudit` reports where.
 */
export async function audit(
  orgId: string,
  actor: Actor,
  action: string,
  target: { type: string; id: string | null },
  details: Record<string, unknown> = {},
  now: number = Date.now(),
): Promise<void> {
  const last = await get<{ hash: string }>("SELECT hash FROM audit_log WHERE org_id = ? ORDER BY seq DESC LIMIT 1", orgId);
  const prev = last?.hash ?? GENESIS;
  const entry = {
    org_id: orgId,
    actor_type: actor.type,
    actor_id: actor.id,
    actor_label: actor.label,
    action,
    target_type: target.type,
    target_id: target.id,
    details,
    created_at: now,
  };
  await run(
    `INSERT INTO audit_log (org_id, actor_type, actor_id, actor_label, action, target_type, target_id, details, created_at, prev_hash, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    orgId,
    actor.type,
    actor.id,
    actor.label,
    action,
    target.type,
    target.id,
    JSON.stringify(details),
    now,
    prev,
    entryHash(prev, entry),
  );
}

type AuditRow = Omit<AuditEntry, "details"> & { details: string };

const parse = (r: AuditRow): AuditEntry => ({ ...r, details: json<Record<string, unknown>>(r.details, {}) });

export async function listAudit(orgId: string, opts: { limit?: number; offset?: number; action?: string } = {}): Promise<AuditEntry[]> {
  const where = ["org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.action) {
    where.push("action LIKE ?");
    params.push(`${opts.action}%`);
  }
  return (await all<AuditRow>(
    `SELECT * FROM audit_log WHERE ${where.join(" AND ")} ORDER BY seq DESC LIMIT ? OFFSET ?`,
    ...params,
    opts.limit ?? 100,
    opts.offset ?? 0,
  )).map(parse);
}

export async function countAudit(orgId: string): Promise<number> {
  return (await get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE org_id = ?", orgId))!.n;
}

export async function allAudit(orgId: string): Promise<AuditEntry[]> {
  return (await all<AuditRow>("SELECT * FROM audit_log WHERE org_id = ? ORDER BY seq ASC", orgId)).map(parse);
}

export async function verifyAudit(orgId: string): Promise<{ ok: boolean; entries: number; brokenAt: number | null }> {
  const entries = await allAudit(orgId);
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prev_hash !== prev || e.hash !== entryHash(prev, e)) return { ok: false, entries: entries.length, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true, entries: entries.length, brokenAt: null };
}

import "server-only";
import { all, run } from "./db";
import { hmac, newId } from "./crypto";
import type { Alert, Org } from "@/lib/types";

export function publicUrl(): string {
  return (process.env.AGENTGUARD_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function record(orgId: string, channel: string, kind: string, payload: unknown, status: string, now: number): string {
  const id = newId("out");
  run(
    "INSERT INTO outbox (id, org_id, channel, kind, payload, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    id,
    orgId,
    channel,
    kind,
    JSON.stringify(payload),
    status,
    now,
  );
  return id;
}

function deliver(id: string, url: string, body: string, headers: Record<string, string>): void {
  // Delivery must never delay or fail the decision that triggered it.
  void fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(5000) })
    .then((res) => run("UPDATE outbox SET status = ?, detail = ? WHERE id = ?", res.ok ? "sent" : "failed", `HTTP ${res.status}`, id))
    .catch((err: unknown) => run("UPDATE outbox SET status = 'failed', detail = ? WHERE id = ?", String(err).slice(0, 200), id));
}

/** Sends a webhook event to the customer's system, signed with their secret. */
export function emitWebhook(org: Org, kind: string, data: Record<string, unknown>, now: number, live = true): void {
  const { webhookUrl, webhookSecret } = org.settings.notifications;
  if (!webhookUrl || !live) return;
  const body = JSON.stringify({ type: kind, created_at: now, organization: org.id, data });
  const id = record(org.id, "webhook", kind, { type: kind, data }, "queued", now);
  deliver(id, webhookUrl, body, { "x-agentguard-signature": `sha256=${hmac(webhookSecret, body)}`, "x-agentguard-event": kind });
}

export function notifySlack(org: Org, kind: string, text: string, now: number, live = true): void {
  const url = org.settings.notifications.slackWebhookUrl;
  if (!url || !live) return;
  const id = record(org.id, "slack", kind, { text }, "queued", now);
  deliver(id, url, JSON.stringify({ text }), {});
}

/**
 * Email delivery is not wired to a mail provider in this MVP. The message is
 * kept in the outbox so the secure-link flow can be reviewed in Settings.
 */
export function queueEmail(org: Org, kind: string, to: string[], subject: string, link: string, now: number, live = true): void {
  if (!live || to.length === 0) return;
  record(org.id, "email", kind, { to, subject, link }, "not_delivered", now);
}

export function createAlert(
  org: Org,
  alert: { kind: string; severity: Alert["severity"]; title: string; body: string; agentId?: string | null; eventId?: string | null },
  now: number,
  live = true,
): void {
  const id = newId("alr");
  run(
    "INSERT INTO alerts (id, org_id, kind, severity, title, body, agent_id, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    org.id,
    alert.kind,
    alert.severity,
    alert.title,
    alert.body,
    alert.agentId ?? null,
    alert.eventId ?? null,
    now,
  );
  emitWebhook(org, "alert.created", { id, ...alert }, now, live);
  if (alert.severity !== "info") notifySlack(org, "alert.created", `:warning: *${alert.title}*\n${alert.body}\n${publicUrl()}/overview`, now, live);
}

export function listAlerts(orgId: string, opts: { limit?: number; openOnly?: boolean; agentId?: string } = {}): Alert[] {
  const where = ["org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.openOnly) where.push("acknowledged_at IS NULL");
  if (opts.agentId) {
    where.push("agent_id = ?");
    params.push(opts.agentId);
  }
  return all<Alert>(`SELECT * FROM alerts WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`, ...params, opts.limit ?? 20);
}

export function acknowledgeAlerts(orgId: string, now: number, id?: string): void {
  if (id) run("UPDATE alerts SET acknowledged_at = ? WHERE org_id = ? AND id = ?", now, orgId, id);
  else run("UPDATE alerts SET acknowledged_at = ? WHERE org_id = ? AND acknowledged_at IS NULL", now, orgId);
}

export interface OutboxRow {
  id: string;
  channel: string;
  kind: string;
  payload: string;
  status: string;
  detail: string | null;
  created_at: number;
}

export function listOutbox(orgId: string, limit = 20): OutboxRow[] {
  return all<OutboxRow>("SELECT * FROM outbox WHERE org_id = ? ORDER BY created_at DESC LIMIT ?", orgId, limit);
}

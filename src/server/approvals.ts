import "server-only";
import { all, get, json, run, tx } from "./db";
import { newId } from "./crypto";
import { audit, SYSTEM } from "./audit";
import { getEvent, updateEvent } from "./events";
import { createAlert, emitWebhook, notifySlack, publicUrl, queueEmail } from "./notify";
import { getAction } from "@/lib/catalog";
import { money } from "@/lib/format";
import type { ActionEvent, Agent, Approval, ApprovalDecision, Fact, Org, Role, User } from "@/lib/types";

type ApprovalRow = Omit<Approval, "decisions" | "facts"> & { decisions: string; facts: string };

const parse = (r: ApprovalRow): Approval => ({
  ...r,
  decisions: json<ApprovalDecision[]>(r.decisions, []),
  facts: json<Fact[]>(r.facts, []),
});

export const APPROVER_ROLES: Role[] = ["owner", "admin", "approver"];
export const canApprove = (role: Role) => APPROVER_ROLES.includes(role);

export function getApproval(orgId: string, id: string): Approval | undefined {
  const row = get<ApprovalRow>("SELECT * FROM approvals WHERE org_id = ? AND id = ?", orgId, id);
  return row ? parse(row) : undefined;
}

export function listApprovals(orgId: string, opts: { status?: "pending" | "decided"; agentId?: string; limit?: number } = {}): Approval[] {
  const where = ["org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.status === "pending") where.push("status = 'pending'");
  if (opts.status === "decided") where.push("status != 'pending'");
  if (opts.agentId) {
    where.push("agent_id = ?");
    params.push(opts.agentId);
  }
  const order = opts.status === "pending" ? "expires_at ASC" : "COALESCE(decided_at, created_at) DESC";
  return all<ApprovalRow>(`SELECT * FROM approvals WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`, ...params, opts.limit ?? 50).map(parse);
}

export function countPending(orgId: string): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM approvals WHERE org_id = ? AND status = 'pending'", orgId)!.n;
}

function approverEmails(orgId: string): string[] {
  return all<{ email: string }>("SELECT email FROM users WHERE org_id = ? AND role IN ('owner', 'admin', 'approver')", orgId).map((u) => u.email);
}

export function describeEvent(e: ActionEvent): string {
  const what = e.action === "unknown" ? e.tool : getAction(e.action).label;
  const amount = e.amount !== null ? ` of ${money(e.amount, e.currency)}` : "";
  return `${what}${amount}${e.resource ? ` on ${e.resource}` : ""}`;
}

export function createApproval(
  org: Org,
  agent: Agent,
  event: ActionEvent,
  input: { facts: Fact[]; explanation: string | null; required: number; kind?: "action" | "response" },
  now: number,
  live: boolean,
): Approval {
  const id = newId("apr");
  run(
    `INSERT INTO approvals (id, org_id, event_id, agent_id, kind, fingerprint, status, required, facts, explanation, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
    id,
    org.id,
    event.id,
    agent.id,
    input.kind ?? "action",
    event.params_fingerprint,
    input.required,
    JSON.stringify(input.facts),
    input.explanation,
    now + org.settings.approvalTimeoutMinutes * 60_000,
    now,
  );
  // The email link opens a page behind login. Mail scanners follow links
  // automatically, so the link itself must never approve anything.
  const link = `${publicUrl()}/approvals/${id}`;
  const summary = `${agent.name} wants to: ${describeEvent(event)}`;
  notifySlack(org, "approval.requested", `:raised_hand: *Approval needed* — ${summary}\n${event.reason ?? ""}\nReview and decide: ${link}`, now, live);
  queueEmail(org, "approval.requested", approverEmails(org.id), `Approval needed: ${summary}`, link, now, live);
  return getApproval(org.id, id)!;
}

/** Applies timeouts. There is no background worker; this runs whenever approvals are read or decided. */
export function expireOverdue(org: Org, now: number, live = true): void {
  const overdue = all<ApprovalRow>("SELECT * FROM approvals WHERE org_id = ? AND status = 'pending' AND expires_at <= ?", org.id, now).map(parse);
  for (const approval of overdue) {
    if (org.settings.timeoutBehaviour === "escalate" && !approval.escalated_at) {
      run("UPDATE approvals SET escalated_at = ?, expires_at = ? WHERE id = ?", now, now + org.settings.approvalTimeoutMinutes * 60_000, approval.id);
      audit(org.id, SYSTEM, "approval.escalated", { type: "approval", id: approval.id }, { event_id: approval.event_id }, now);
      createAlert(
        org,
        { kind: "approval.escalated", severity: "warning", title: "An approval is waiting past its deadline", body: "Nobody decided in time, so it has been escalated to owners and admins.", agentId: approval.agent_id, eventId: approval.event_id },
        now,
        live,
      );
      continue;
    }
    tx(() => {
      run("UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ?", now, approval.id);
      const event = getEvent(org.id, approval.event_id);
      if (event && event.status === "pending") {
        updateEvent(event.id, { status: "expired", reason: "Nobody decided before the deadline, so the request was safely rejected.", completed_at: now });
      }
      audit(org.id, SYSTEM, "approval.expired", { type: "approval", id: approval.id }, { event_id: approval.event_id }, now);
    });
    emitWebhook(org, "approval.decided", { approval_id: approval.id, event_id: approval.event_id, status: "expired" }, now, live);
  }
}

export interface DecideResult {
  approval: Approval;
  event: ActionEvent;
  /** The approval is complete and the action must now be executed by the vault. */
  execute: boolean;
}

export function decideApproval(
  org: Org,
  user: Pick<User, "id" | "name" | "role" | "org_id">,
  id: string,
  decision: "approve" | "reject",
  note: string,
  channel: ApprovalDecision["channel"],
  now: number,
  live = true,
): DecideResult {
  if (user.org_id !== org.id || !canApprove(user.role)) throw new Error("You are not authorized to approve actions.");
  expireOverdue(org, now, live);

  const result = tx(() => {
    const approval = getApproval(org.id, id);
    if (!approval) throw new Error("Approval not found.");
    if (approval.status !== "pending") throw new Error(`This request was already ${approval.status}.`);
    const event = getEvent(org.id, approval.event_id);
    if (!event || event.status !== "pending") throw new Error("This action is no longer waiting for approval.");
    if (approval.decisions.some((d) => d.user_id === user.id)) throw new Error("You have already decided on this request. A second person must confirm it.");

    const decisions = [...approval.decisions, { user_id: user.id, user_name: user.name, decision, note: note.trim(), channel, at: now }];
    const approvals = decisions.filter((d) => d.decision === "approve").length;
    const actor = { type: "user" as const, id: user.id, label: user.name };
    const details = { event_id: event.id, fingerprint: approval.fingerprint, channel, note: note.trim() || undefined };

    if (decision === "reject") {
      run("UPDATE approvals SET status = 'rejected', decisions = ?, decided_at = ? WHERE id = ?", JSON.stringify(decisions), now, id);
      updateEvent(event.id, { status: "rejected", reason: `Rejected by ${user.name}${note.trim() ? `: ${note.trim()}` : "."}`, completed_at: now });
      audit(org.id, actor, "approval.rejected", { type: "approval", id }, details, now);
    } else if (approvals >= approval.required) {
      run("UPDATE approvals SET status = 'approved', decisions = ?, decided_at = ? WHERE id = ?", JSON.stringify(decisions), now, id);
      updateEvent(event.id, {
        status: "approved",
        // Reserve now, settle when the action completes, so parallel agents cannot overspend together.
        money_state: event.amount !== null && getAction(event.action).money ? "reserved" : event.money_state,
      });
      audit(org.id, actor, "approval.approved", { type: "approval", id }, { ...details, approvers: decisions.map((d) => d.user_name) }, now);
    } else {
      run("UPDATE approvals SET decisions = ? WHERE id = ?", JSON.stringify(decisions), id);
      audit(org.id, actor, "approval.first_approval", { type: "approval", id }, { ...details, still_needed: approval.required - approvals }, now);
    }
    return { approval: getApproval(org.id, id)!, event: getEvent(org.id, event.id)! };
  });

  if (result.approval.status !== "pending") {
    emitWebhook(
      org,
      "approval.decided",
      { approval_id: id, event_id: result.event.id, status: result.approval.status, decided_by: result.approval.decisions.map((d) => d.user_name) },
      now,
      live,
    );
  }
  return { ...result, execute: result.approval.status === "approved" && result.event.source === "vault" };
}

import "server-only";
import { run } from "./db";
import { getAgent } from "./agents";
import { audit, SYSTEM } from "./audit";
import { decideApproval, type DecideResult } from "./approvals";
import { getEvent, updateEvent } from "./events";
import { createAlert } from "./notify";
import { execute } from "./vault";
import { getAction } from "@/lib/catalog";
import type { ActionEvent, ApprovalDecision, Org, User } from "@/lib/types";

/**
 * Executes an allowed or approved vault action exactly once.
 *
 * The UPDATE below is the claim: only one caller can move the event from
 * allowed/approved to executing, so a double click, a retry or two approvers
 * racing can never run the action twice. What runs is the stored event, so the
 * action executed is exactly the action that was approved.
 */
export async function executeEvent(org: Org, eventId: string, now: number, live = true): Promise<ActionEvent> {
  const claimed = await run("UPDATE events SET status = 'executing' WHERE org_id = ? AND id = ? AND status IN ('allowed', 'approved') AND source = 'vault'", org.id, eventId);
  const event = await getEvent(org.id, eventId);
  if (!event) throw new Error("Event not found.");
  if (!claimed) return event;

  const [connector, actionId] = event.tool.split(".");
  const type = getAction(event.action);
  try {
    // The kill switch revokes vault access, even for something approved a moment ago.
    const agent = await getAgent(org.id, event.agent_id);
    if (!agent || agent.status !== "active") throw new Error("The agent was stopped before the action could run.");
    const result = await execute(org, connector, actionId, event.params, event.id, now);
    await updateEvent(event.id, { status: "executed", result, money_state: event.amount !== null && type.money ? "settled" : event.money_state, completed_at: now });
    await audit(org.id, SYSTEM, "vault.executed", { type: "event", id: event.id }, { tool: event.tool, resource: event.resource ?? undefined, amount: event.amount ?? undefined, fingerprint: event.params_fingerprint }, now);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateEvent(event.id, { status: "failed", result: { error: message }, money_state: event.money_state === "reserved" ? "released" : event.money_state, completed_at: now });
    await audit(org.id, SYSTEM, "vault.failed", { type: "event", id: event.id }, { tool: event.tool, error: message }, now);
    await createAlert(org, { kind: "vault.failed", severity: "warning", title: `${event.tool} failed in the vault`, body: message, agentId: event.agent_id, eventId: event.id }, now, live);
  }
  return (await getEvent(org.id, eventId))!;
}

/** Records a human decision and, for vault actions, executes the approved action straight away. */
export async function decideAndExecute(
  org: Org,
  user: Pick<User, "id" | "name" | "role" | "org_id">,
  approvalId: string,
  decision: "approve" | "reject",
  note: string,
  channel: ApprovalDecision["channel"],
  now: number,
  live = true,
): Promise<DecideResult> {
  const result = await decideApproval(org, user, approvalId, decision, note, channel, now, live);
  if (result.execute) result.event = await executeEvent(org, result.event.id, now, live);
  return result;
}

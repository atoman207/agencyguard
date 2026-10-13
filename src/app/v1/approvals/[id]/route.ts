import { agentAuth, route } from "@/server/api";
import { expireOverdue, getApproval } from "@/server/approvals";
import { RequestError } from "@/server/engine";
import { getEvent } from "@/server/events";

// GET /v1/approvals/{id} — the agent polls this while it waits for a person.
export const GET = route(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = agentAuth(request);
  const { id } = await params;
  expireOverdue(auth.org, Date.now());
  const approval = getApproval(auth.org.id, id);
  if (!approval || approval.agent_id !== auth.agent.id) throw new RequestError("Approval not found for this agent.", 404, "not_found");
  const event = getEvent(auth.org.id, approval.event_id)!;
  return Response.json({
    approval_id: approval.id,
    status: approval.status,
    event_id: event.id,
    event_status: event.status,
    approvals: approval.decisions.filter((d) => d.decision === "approve").length,
    required: approval.required,
    expires_at: approval.expires_at,
    reason: event.reason,
    fingerprint: approval.fingerprint,
    // An approval covers exactly these parameters. Any change needs a new approval.
    params: event.params,
    // For vault actions AgentGuard executes on approval, so the result is here.
    result: event.result,
  });
});

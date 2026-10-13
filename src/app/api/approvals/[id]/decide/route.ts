import { readJson, route, sessionAuth } from "@/server/api";
import { RequestError } from "@/server/engine";
import { decideAndExecute } from "@/server/execution";

// POST /api/approvals/{id}/decide — only a signed-in person can decide.
// Agent tokens and organization API keys are deliberately not accepted here.
export const POST = route(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await sessionAuth("viewer");
  const { id } = await params;
  const body = await readJson(request);
  if (body.decision !== "approve" && body.decision !== "reject") throw new RequestError('`decision` must be "approve" or "reject".');
  let result;
  try {
    result = await decideAndExecute(auth.org, auth.user, id, body.decision, typeof body.note === "string" ? body.note : "", "dashboard", Date.now());
  } catch (err) {
    const message = err instanceof Error ? err.message : "The decision could not be recorded.";
    throw new RequestError(message, /not authorized/.test(message) ? 403 : 409, /not authorized/.test(message) ? "forbidden" : "invalid_state");
  }
  return Response.json({
    approval_id: result.approval.id,
    status: result.approval.status,
    approvals: result.approval.decisions.filter((d) => d.decision === "approve").length,
    required: result.approval.required,
    event_id: result.event.id,
    event_status: result.event.status,
    result: result.event.result,
  });
});

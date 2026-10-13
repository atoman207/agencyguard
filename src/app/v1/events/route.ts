import { agentAuth, outcomeBody, parseAction, readJson, route } from "@/server/api";
import { decide, reportCompletion, RequestError } from "@/server/engine";

// POST /v1/events — report what happened.
// With `event_id`: the action that was allowed has now completed or failed.
// Without it: an action that ran without asking first; recorded for visibility only.
export const POST = route(async (request) => {
  const auth = agentAuth(request);
  const body = await readJson(request);
  const ctx = { org: auth.org, agent: auth.agent, now: Date.now() };

  if (typeof body.event_id === "string") {
    if (body.status !== "completed" && body.status !== "failed") throw new RequestError('`status` must be "completed" or "failed".');
    const params = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : undefined;
    const event = reportCompletion(ctx, { eventId: body.event_id, status: body.status, result: body.result, params });
    const mismatch = !!(event.result as { parameter_mismatch?: boolean } | null)?.parameter_mismatch;
    return Response.json({ event_id: event.id, status: event.status, parameter_mismatch: mismatch });
  }

  const { source, req } = parseAction(body);
  const outcome = decide({ ...ctx, token: auth.token, source, reportOnly: true }, req);
  return Response.json({ ...outcomeBody(outcome), decision: "recorded" });
});

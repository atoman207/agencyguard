import { agentAuth, readJson, route } from "@/server/api";
import { RequestError } from "@/server/engine";
import { checkResponse } from "@/server/response-check";
import type { Source } from "@/lib/types";

// POST /v1/responses/check — the response checkpoint for agents that do not
// call their model through the gateway. Send the reply before the customer sees it.
export const POST = route(async (request) => {
  const auth = agentAuth(request);
  const body = await readJson(request);
  if (typeof body.text !== "string" || !body.text.trim()) throw new RequestError("Send the reply as `text`.");
  if (auth.agent.status !== "active") throw new RequestError(`This agent is ${auth.agent.status}.`, 403, `agent_${auth.agent.status}`);
  const source = (["sdk", "n8n", "make", "api"] as Source[]).includes(body.source as Source) ? (body.source as Source) : "api";
  const verdict = checkResponse(
    { org: auth.org, agent: auth.agent, source, runId: typeof body.run_id === "string" ? body.run_id : null, now: Date.now() },
    body.text,
  );
  return Response.json({
    action: verdict.action,
    decision: verdict.observe ? "allow" : verdict.action === "block" ? "block" : verdict.action === "hold" ? "pending" : "allow",
    // The text that is safe to send now. When held, this is the holding message.
    text: verdict.text,
    findings: verdict.findings.map((f) => ({ type: f.type, label: f.label })),
    event_id: verdict.eventId,
    approval_id: verdict.approvalId,
    observe: verdict.observe,
  });
});

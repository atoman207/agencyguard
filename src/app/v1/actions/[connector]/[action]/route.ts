import { agentAuth, outcomeBody, readJson, route } from "@/server/api";
import { decide, RequestError } from "@/server/engine";
import { executeEvent } from "@/server/execution";
import { getConnector, prepare } from "@/server/vault";

// POST /v1/actions/{connector}/{action} — the enforced checkpoint.
// The agent never holds the real key: it asks the vault, the rules run, and
// AgentGuard performs the action itself, exactly once.
export const POST = route(async (request, { params }: { params: Promise<{ connector: string; action: string }> }) => {
  const auth = agentAuth(request);
  const { connector, action } = await params;
  const def = getConnector(connector)?.actions.find((a) => a.id === action);
  if (!def) throw new RequestError(`The vault has no action "${connector}/${action}".`, 404, "not_found");

  const body = await readJson(request);
  const raw = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : {};
  const now = Date.now();
  // Facts come from the source system before any rule runs.
  const prepared = await prepare(auth.org, connector, def, raw);

  const outcome = decide(
    { org: auth.org, agent: auth.agent, token: auth.token, source: "vault", now },
    {
      tool: `${connector}.${action}`,
      knownAction: def.action,
      resource: prepared.resource,
      params: prepared.params,
      sourceFacts: prepared.facts,
      idempotencyKey: typeof body.idempotency_key === "string" ? body.idempotency_key : null,
      runId: typeof body.run_id === "string" ? body.run_id : null,
      explanation: typeof body.explanation === "string" ? body.explanation : null,
      confirmRepeat: body.confirm_repeat === true,
    },
  );

  let event = outcome.event;
  if (outcome.outcome === "allow" && !outcome.alreadyExecuted) event = await executeEvent(auth.org, event.id, now);
  return Response.json(outcomeBody(outcome, event));
});

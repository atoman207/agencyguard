import { agentAuth, outcomeBody, parseAction, readJson, route } from "@/server/api";
import { decide } from "@/server/engine";

// POST /v1/check — the cooperative checkpoint. The agent asks before acting.
export const POST = route(async (request) => {
  const auth = agentAuth(request);
  const { source, req } = parseAction(await readJson(request));
  const outcome = decide({ org: auth.org, agent: auth.agent, token: auth.token, source, now: Date.now() }, req);
  return Response.json(outcomeBody(outcome));
});

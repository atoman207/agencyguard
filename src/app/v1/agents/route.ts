import { managementAuth, readJson, route } from "@/server/api";
import { createAgent, listAgents, PLATFORMS } from "@/server/agents";
import { RequestError } from "@/server/engine";
import type { AgentMode, Environment } from "@/lib/types";

// GET/POST /v1/agents — list and register agents.
export const GET = route(async (request) => {
  const auth = await managementAuth(request, "viewer");
  return Response.json({ agents: await listAgents(auth.org.id) });
});

export const POST = route(async (request) => {
  const auth = await managementAuth(request);
  const body = await readJson(request);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) throw new RequestError("An agent needs a `name`.");
  const environment = (["production", "staging", "development"] as Environment[]).includes(body.environment as Environment) ? (body.environment as Environment) : "production";
  const mode = (["observe", "enforce"] as AgentMode[]).includes(body.mode as AgentMode) ? (body.mode as AgentMode) : auth.org.settings.defaultAgentMode;
  const agent = await createAgent(
    auth.org,
    auth.actor,
    {
      name,
      platform: typeof body.platform === "string" && body.platform ? body.platform : PLATFORMS[PLATFORMS.length - 1],
      purpose: typeof body.purpose === "string" ? body.purpose : "",
      environment,
      mode,
      ownerUserId: auth.user?.id ?? null,
      handlesPrivateData: body.handles_private_data === true,
      checkResponses: body.check_responses !== false,
      parentAgentId: typeof body.parent_agent_id === "string" ? body.parent_agent_id : null,
    },
    Date.now(),
  );
  return Response.json({ agent }, { status: 201 });
});

import { managementAuth, readJson, route } from "@/server/api";
import { createToken, getAgent, setAgentStatus } from "@/server/agents";
import { RequestError } from "@/server/engine";

// POST /v1/agents/{id}/pause | resume | kill | tokens
export const POST = route(async (request, { params }: { params: Promise<{ id: string; op: string }> }) => {
  const auth = await managementAuth(request);
  const { id, op } = await params;
  const agent = getAgent(auth.org.id, id);
  if (!agent) throw new RequestError("Agent not found.", 404, "not_found");
  const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
  const now = Date.now();
  const reason = typeof body.reason === "string" ? body.reason : "";

  if (op === "pause" || op === "kill") {
    return Response.json({ agent: setAgentStatus(auth.org, auth.actor, id, op === "kill" ? "killed" : "paused", reason, now) });
  }
  if (op === "resume") {
    // Resuming a killed agent reactivates it, but its old tokens stay revoked.
    return Response.json({ agent: setAgentStatus(auth.org, auth.actor, id, "active", reason, now) });
  }
  if (op === "tokens") {
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === "string") : ["*"];
    const days = typeof body.expires_in_days === "number" && body.expires_in_days > 0 ? body.expires_in_days : null;
    const created = createToken(auth.org, auth.actor, id, { name: typeof body.name === "string" ? body.name : "API token", scopes, expiresInDays: days }, now);
    // The token is shown once. Only its hash is stored.
    return Response.json(created, { status: 201 });
  }
  throw new RequestError(`Unknown operation "${op}".`, 404, "not_found");
});

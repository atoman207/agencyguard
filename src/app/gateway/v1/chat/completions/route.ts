import { agentAuth, readJson, route } from "@/server/api";
import { asEventStream, chatCompletion } from "@/server/gateway";

// POST /gateway/v1/chat/completions — the AI-model gateway (OpenAI-compatible).
// Point an agent's base URL at {host}/gateway/v1 and use its AgentGuard token as the API key.
export const POST = route(async (request) => {
  const auth = await agentAuth(request);
  const body = await readJson(request);
  const result = await chatCompletion(auth, body, request.headers.get("x-agentguard-run"), Date.now());
  const headers: Record<string, string> = result.eventId ? { "x-agentguard-event": result.eventId } : {};
  if (result.stream && result.status === 200) {
    return new Response(asEventStream(result.body), { headers: { ...headers, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
  }
  return Response.json(result.body, { status: result.status, headers });
});

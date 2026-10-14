import { agentAuth, readJson, route } from "@/server/api";
import type { JsonRpcMessage } from "@/server/demo-mcp";
import { handleMcp } from "@/server/mcp";

// POST /mcp/{server} — the MCP gateway. Point the agent's MCP client here
// instead of at the tool server, with its AgentGuard token as the bearer token.
export const POST = route(async (request, { params }: { params: Promise<{ server: string }> }) => {
  const auth = await agentAuth(request);
  const { server } = await params;
  const message = (await readJson(request)) as unknown as JsonRpcMessage;
  const result = await handleMcp(
    auth,
    server,
    message,
    {
      sessionId: request.headers.get("mcp-session-id"),
      protocolVersion: request.headers.get("mcp-protocol-version"),
      runId: request.headers.get("x-agentguard-run"),
    },
    Date.now(),
  );
  const headers: Record<string, string> = result.sessionId ? { "mcp-session-id": result.sessionId } : {};
  if (!result.message) return new Response(null, { status: 202, headers });
  return Response.json(result.message, { status: result.status, headers });
});

// Server-initiated streams are not proxied.
export function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

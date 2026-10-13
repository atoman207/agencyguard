import { demoMcp, type JsonRpcMessage } from "@/server/demo-mcp";
import { seedEnabled } from "@/server/seed";

// POST /demo/mcp — the demo MCP server over HTTP, for trying the MCP gateway
// against a real network hop. It returns made-up shop data and is only
// available when demo data is enabled.
export async function POST(request: Request) {
  if (!seedEnabled()) return new Response(null, { status: 404 });
  let message: JsonRpcMessage;
  try {
    message = (await request.json()) as JsonRpcMessage;
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const reply = demoMcp(message);
  return reply ? Response.json(reply) : new Response(null, { status: 202 });
}

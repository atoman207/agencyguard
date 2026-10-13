import { readJson, route, sessionAuth } from "@/server/api";
import { saveMcpServer } from "@/server/mcp";
import { saveCredential } from "@/server/vault";

// POST /api/vault/credentials — connect a vault connector, or register an MCP server.
export const POST = route(async (request) => {
  const auth = await sessionAuth("admin");
  const body = await readJson(request);
  const now = Date.now();
  if (typeof body.mcp_url === "string") {
    saveMcpServer(auth.org, auth.actor, { slug: String(body.slug ?? ""), name: String(body.name ?? ""), url: body.mcp_url, authHeader: typeof body.auth_header === "string" ? body.auth_header : undefined }, now);
    return Response.json({ ok: true }, { status: 201 });
  }
  saveCredential(
    auth.org,
    auth.actor,
    {
      connector: String(body.connector ?? ""),
      mode: body.mode === "live" ? "live" : "sandbox",
      apiKey: typeof body.api_key === "string" ? body.api_key : "",
      baseUrl: typeof body.base_url === "string" ? body.base_url : undefined,
    },
    now,
  );
  return Response.json({ ok: true }, { status: 201 });
});

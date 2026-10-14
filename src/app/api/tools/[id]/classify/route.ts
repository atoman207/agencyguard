import { readJson, route, sessionAuth } from "@/server/api";
import { RequestError } from "@/server/engine";
import { classifyTool, upsertTool } from "@/server/tools";

// POST /api/tools/{id}/classify — confirm what a tool does.
// With the id "by-name" and a `name` in the body, a tool can be classified
// before any agent has used it.
export const POST = route(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await sessionAuth("admin");
  let { id } = await params;
  const body = await readJson(request);
  const now = Date.now();
  if (id === "by-name") {
    if (typeof body.name !== "string" || !body.name.trim()) throw new RequestError("Send the tool `name`.");
    id = (await upsertTool(auth.org.id, body.name.trim(), now)).id;
  }
  await classifyTool(auth.org, auth.actor, id, String(body.action ?? ""), now);
  return Response.json({ ok: true });
});

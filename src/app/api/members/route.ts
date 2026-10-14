import { readJson, route, sessionAuth } from "@/server/api";
import { addMember } from "@/server/users";
import type { Role } from "@/lib/types";

export const POST = route(async (request) => {
  const auth = await sessionAuth("owner");
  const body = await readJson(request);
  const user = await addMember(
    auth.org,
    auth.actor,
    { name: String(body.name ?? ""), email: String(body.email ?? ""), role: body.role as Role, password: String(body.password ?? "") },
    Date.now(),
  );
  return Response.json({ user }, { status: 201 });
});

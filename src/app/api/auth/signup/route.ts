import { readJson, route } from "@/server/api";
import { startSession } from "@/server/auth";
import { signUp } from "@/server/users";

export const POST = route(async (request) => {
  const body = await readJson(request);
  const user = signUp(
    { orgName: String(body.organization ?? ""), name: String(body.name ?? ""), email: String(body.email ?? ""), password: String(body.password ?? "") },
    Date.now(),
  );
  await startSession(user.id);
  return Response.json({ user }, { status: 201 });
});

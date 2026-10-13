import { readJson, route } from "@/server/api";
import { startSession } from "@/server/auth";
import { RequestError } from "@/server/engine";
import { checkPassword } from "@/server/users";

export const POST = route(async (request) => {
  const body = await readJson(request);
  let user;
  try {
    user = checkPassword(String(body.email ?? ""), String(body.password ?? ""), Date.now());
  } catch (err) {
    throw new RequestError(err instanceof Error ? err.message : "Sign-in failed.", 401, "invalid_credentials");
  }
  await startSession(user.id);
  return Response.json({ user });
});

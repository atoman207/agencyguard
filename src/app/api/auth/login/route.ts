import { readJson, route } from "@/server/api";
import { startSession } from "@/server/auth";
import { RequestError } from "@/server/engine";
import { checkPassword } from "@/server/users";

export const POST = route(async (request) => {
  const body = await readJson(request);
  let user;
  try {
    user = await checkPassword(String(body.email ?? ""), String(body.password ?? ""), Date.now());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sign-in failed.";
    // Misconfiguration (missing DATABASE_URL on Vercel, etc.) is not a bad password.
    if (/DATABASE_URL|AGENTGUARD_MASTER_KEY|Vercel/i.test(message)) {
      throw new RequestError(message, 503, "misconfigured");
    }
    throw new RequestError(message, 401, "invalid_credentials");
  }
  await startSession(user.id);
  return Response.json({ user });
});

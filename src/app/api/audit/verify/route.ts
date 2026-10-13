import { route, sessionAuth } from "@/server/api";
import { verifyAudit } from "@/server/audit";

export const GET = route(async () => {
  const auth = await sessionAuth("viewer");
  return Response.json(verifyAudit(auth.org.id));
});

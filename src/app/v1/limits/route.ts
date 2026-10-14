import { managementAuth, readJson, route } from "@/server/api";
import { createLimit, listLimits } from "@/server/limits";
import type { LimitKind, LimitPeriod, LimitScope } from "@/lib/types";

// GET/POST /v1/limits — spending limits, AI-cost budgets and action counts.
export const GET = route(async (request) => {
  const auth = await managementAuth(request, "viewer");
  return Response.json({ limits: await listLimits(auth.org.id) });
});

export const POST = route(async (request) => {
  const auth = await managementAuth(request);
  const body = await readJson(request);
  const id = await createLimit(
    auth.org,
    auth.actor,
    {
      name: String(body.name ?? ""),
      kind: (["money", "cost", "count"].includes(body.kind as string) ? body.kind : "money") as LimitKind,
      scope: (["action", "customer", "resource", "agent", "organization"].includes(body.scope as string) ? body.scope : "agent") as LimitScope,
      agentId: typeof body.agent_id === "string" ? body.agent_id : null,
      action: typeof body.action === "string" ? body.action : null,
      period: (["action", "hour", "day", "week", "month"].includes(body.period as string) ? body.period : "day") as LimitPeriod,
      value: Number(body.value),
      onExceed: body.on_exceed === "ask_human" ? "ask_human" : "block",
    },
    Date.now(),
  );
  return Response.json({ limit: (await listLimits(auth.org.id)).find((l) => l.id === id) }, { status: 201 });
});

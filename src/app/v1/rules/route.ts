import { managementAuth, readJson, route } from "@/server/api";
import { createRule, getRule, listRules } from "@/server/rules";
import { installTemplate } from "@/server/templates";
import type { RuleEffect } from "@/lib/types";

// GET/POST /v1/rules — list rules, create one, or install a template pack.
export const GET = route(async (request) => {
  const auth = await managementAuth(request, "viewer");
  return Response.json({ rules: listRules(auth.org.id) });
});

export const POST = route(async (request) => {
  const auth = await managementAuth(request);
  const body = await readJson(request);
  const agentId = typeof body.agent_id === "string" ? body.agent_id : null;
  if (typeof body.template === "string") {
    await installTemplate(auth.org, auth.actor, body.template, { agentId, enable: body.enabled !== false }, Date.now());
    return Response.json({ rules: listRules(auth.org.id).filter((r) => r.template === body.template) }, { status: 201 });
  }
  const id = createRule(
    auth.org,
    auth.actor,
    {
      name: String(body.name ?? ""),
      description: typeof body.description === "string" ? body.description : "",
      agentId,
      conditions: body.conditions ?? [],
      effect: body.effect as RuleEffect,
      enabled: body.enabled !== false,
    },
    Date.now(),
  );
  return Response.json({ rule: getRule(auth.org.id, id) }, { status: 201 });
});

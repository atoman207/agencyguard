import "server-only";
import { get, run, tx } from "./db";
import { audit, type Actor } from "./audit";
import { createLimit } from "./limits";
import { createRule } from "./rules";
import { BUILTIN_TEMPLATE_PACKS, type TemplatePack } from "@/lib/template-data";
import type { Org } from "@/lib/types";

export type { TemplatePack } from "@/lib/template-data";

export interface PackCatalog {
  packs: TemplatePack[];
  source: "builtin";
}

/** Template packs shipped in the app (no external catalog). */
export async function loadTemplatePacks(): Promise<PackCatalog> {
  return { packs: BUILTIN_TEMPLATE_PACKS, source: "builtin" };
}

export async function installedTemplates(orgId: string): Promise<Set<string>> {
  const { packs } = await loadTemplatePacks();
  return await installedTemplatesAmong(orgId, packs);
}

async function installedTemplatesAmong(orgId: string, packs: TemplatePack[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const pack of packs) {
    if (await get("SELECT 1 AS x FROM rules WHERE org_id = ? AND template = ? LIMIT 1", orgId, pack.id)) ids.add(pack.id);
  }
  return ids;
}

/** Installs a pack's rules and limits. Rules start disabled unless `enable` is set, so they can be replayed first. */
export async function installTemplate(org: Org, actor: Actor, packId: string, opts: { agentId: string | null; enable: boolean }, now: number): Promise<void> {
  const { packs } = await loadTemplatePacks();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) throw new Error("Unknown template.");
  await tx(async () => {
    if ((await installedTemplatesAmong(org.id, packs)).has(packId)) throw new Error("This template is already installed.");
    for (const rule of pack.rules) await createRule(org, actor, { ...rule, agentId: opts.agentId, template: pack.id, enabled: opts.enable }, now);
    for (const limit of pack.limits) await createLimit(org, actor, { ...limit, agentId: opts.agentId, template: pack.id }, now);
    await audit(org.id, actor, "template.installed", { type: "template", id: pack.id }, { name: pack.name, rules: pack.rules.length, limits: pack.limits.length }, now);
  });
}

/** Removes every rule and limit that was installed from a template pack. */
export async function uninstallTemplate(org: Org, actor: Actor, packId: string, now: number): Promise<void> {
  const { packs } = await loadTemplatePacks();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) throw new Error("Unknown template.");
  await tx(async () => {
    const rules = await run("DELETE FROM rules WHERE org_id = ? AND template = ?", org.id, packId);
    const limits = await run("DELETE FROM limits WHERE org_id = ? AND template = ?", org.id, packId);
    if (!rules && !limits) throw new Error("This template is not installed.");
    await audit(org.id, actor, "template.uninstalled", { type: "template", id: pack.id }, { name: pack.name, rules_removed: rules, limits_removed: limits }, now);
  });
}

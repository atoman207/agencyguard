import "server-only";
import { get, run, tx } from "./db";
import { audit, type Actor } from "./audit";
import { createLimit } from "./limits";
import { createRule } from "./rules";
import { supabase, supabaseConfigured } from "./supabase";
import { BUILTIN_TEMPLATE_PACKS, type TemplateCondition, type TemplateLimit, type TemplatePack, type TemplateRule } from "@/lib/template-data";
import type { Org } from "@/lib/types";

export type { TemplatePack } from "@/lib/template-data";

export interface PackCatalog {
  packs: TemplatePack[];
  /** Where the packs were read from. The built-in copy is used when Supabase cannot be reached. */
  source: "supabase" | "builtin";
  /** Why the built-in copy is in use, when it is. */
  note?: string;
}

const FRESH_MS = 60_000;
const FALLBACK_MS = 15_000;
type Globals = typeof globalThis & { __agPacks?: { at: number; catalog: PackCatalog } };

interface PackRow { id: string; name: string; audience: string; description: string }
interface RuleRow { pack_id: string; name: string; description: string; effect: TemplateRule["effect"]; conditions: TemplateCondition[] }
interface LimitRow { pack_id: string; name: string; kind: TemplateLimit["kind"]; scope: TemplateLimit["scope"]; action: string | null; period: TemplateLimit["period"]; value: number | string; on_exceed: TemplateLimit["onExceed"] }

async function readSupabase(): Promise<TemplatePack[]> {
  const sb = supabase();
  const [packs, rules, limits] = await Promise.all([
    sb.from("template_packs").select("id, name, audience, description").order("sort_order"),
    sb.from("template_rules").select("pack_id, name, description, effect, conditions").order("position"),
    sb.from("template_limits").select("pack_id, name, kind, scope, action, period, value, on_exceed").order("position"),
  ]);
  for (const r of [packs, rules, limits]) if (r.error) throw new Error(r.error.message);
  const packRows = (packs.data ?? []) as PackRow[];
  if (packRows.length === 0) throw new Error("The template tables are empty. Run `npm run supabase:seed`.");
  const ruleRows = (rules.data ?? []) as RuleRow[];
  const limitRows = (limits.data ?? []) as LimitRow[];
  return packRows.map((p) => ({
    id: p.id,
    name: p.name,
    audience: p.audience,
    description: p.description,
    rules: ruleRows
      .filter((r) => r.pack_id === p.id)
      .map((r) => ({ name: r.name, ...(r.description ? { description: r.description } : {}), effect: r.effect, conditions: r.conditions })),
    limits: limitRows
      .filter((l) => l.pack_id === p.id)
      .map((l) => ({ name: l.name, kind: l.kind, scope: l.scope, action: l.action, period: l.period, value: Number(l.value), onExceed: l.on_exceed })),
  }));
}

/** The template packs, from Supabase when it is reachable and set up, otherwise from the built-in copy. */
export async function loadTemplatePacks(): Promise<PackCatalog> {
  const g = globalThis as Globals;
  const now = Date.now();
  const cached = g.__agPacks;
  if (cached && now - cached.at < (cached.catalog.source === "supabase" ? FRESH_MS : FALLBACK_MS)) return cached.catalog;

  let catalog: PackCatalog;
  if (!supabaseConfigured()) {
    catalog = { packs: BUILTIN_TEMPLATE_PACKS, source: "builtin", note: "Supabase is not configured." };
  } else {
    try {
      catalog = { packs: await readSupabase(), source: "supabase" };
    } catch (err) {
      catalog = { packs: BUILTIN_TEMPLATE_PACKS, source: "builtin", note: err instanceof Error ? err.message : "Supabase could not be reached." };
    }
  }
  g.__agPacks = { at: now, catalog };
  return catalog;
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
  // Nothing below awaits, so the check and the inserts cannot be interleaved with another request.
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

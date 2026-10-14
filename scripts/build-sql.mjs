// Regenerates the template catalog data inside supabase/database.sql from
// src/lib/template-data.ts, so the SQL file and the built-in copy never drift.
//
//   npm run sql:build

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUILTIN_TEMPLATE_PACKS } from "../src/lib/template-data.ts";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "database.sql");
const BEGIN = "-- BEGIN TEMPLATE DATA";
const END = "-- END TEMPLATE DATA";

const str = (v) => (v === null || v === undefined ? "null" : `'${String(v).replaceAll("'", "''")}'`);
const num = (v) => String(Number(v));
const json = (v) => `${str(JSON.stringify(v))}::jsonb`;

const out = [];
const ids = BUILTIN_TEMPLATE_PACKS.map((p) => str(p.id)).join(", ");

out.push("insert into public.template_packs (id, name, audience, description, sort_order) values");
out.push(
  BUILTIN_TEMPLATE_PACKS.map((p, i) => `  (${str(p.id)}, ${str(p.name)}, ${str(p.audience)}, ${str(p.description)}, ${i})`).join(",\n"),
);
out.push("on conflict (id) do update set name = excluded.name, audience = excluded.audience, description = excluded.description, sort_order = excluded.sort_order;");
out.push("");
out.push(`delete from public.template_rules  where pack_id in (${ids});`);
out.push(`delete from public.template_limits where pack_id in (${ids});`);
out.push("");

const rules = BUILTIN_TEMPLATE_PACKS.flatMap((p) =>
  p.rules.map((r, i) => `  (${str(p.id)}, ${i}, ${str(r.name)}, ${str(r.description ?? "")}, ${str(r.effect)}, ${json(r.conditions)})`),
);
out.push("insert into public.template_rules (pack_id, position, name, description, effect, conditions) values");
out.push(`${rules.join(",\n")};`);
out.push("");

const limits = BUILTIN_TEMPLATE_PACKS.flatMap((p) =>
  p.limits.map(
    (l, i) => `  (${str(p.id)}, ${i}, ${str(l.name)}, ${str(l.kind)}, ${str(l.scope)}, ${str(l.action)}, ${str(l.period)}, ${num(l.value)}, ${str(l.onExceed)})`,
  ),
);
out.push("insert into public.template_limits (pack_id, position, name, kind, scope, action, period, value, on_exceed) values");
out.push(`${limits.join(",\n")};`);

const text = fs.readFileSync(file, "utf8");
const start = text.indexOf(BEGIN);
const end = text.indexOf(END);
if (start < 0 || end < start) throw new Error(`Markers not found in ${file}`);
const next = `${text.slice(0, start + BEGIN.length)}\n${out.join("\n")}\n${text.slice(end)}`;
fs.writeFileSync(file, next);
console.log(`Wrote ${BUILTIN_TEMPLATE_PACKS.length} packs, ${rules.length} rules, ${limits.length} limits to supabase/database.sql`);

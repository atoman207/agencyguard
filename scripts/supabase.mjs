// Supabase setup for AgentGuard's template catalog.
//
//   npm run supabase:check   verifies the connection, keys, tables and data
//   npm run supabase:seed    writes the template packs to Supabase
//
// Keys come from .env.local (see .env.example). The seed uses the secret key;
// the check uses both keys, to prove the app's read-only path works too.

import { createClient } from "@supabase/supabase-js";
import { BUILTIN_TEMPLATE_PACKS } from "../src/lib/template-data.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const command = process.argv[2];

const options = { auth: { persistSession: false, autoRefreshToken: false } };
class Failure extends Error {}
// Throws rather than calling process.exit, which can crash Node on Windows while a request is still closing.
const fail = (message) => {
  console.error(`\nFAILED: ${message}`);
  process.exitCode = 1;
  throw new Failure(message);
};
const ok = (message) => console.log(`  ok  ${message}`);

const SETUP_HINT = "The template tables do not exist yet. Open the Supabase dashboard > SQL Editor, paste the contents of supabase/schema.sql and run it, then run this again.";
const missingTable = (error) => error && (error.code === "PGRST205" || error.code === "42P01" || /could not find the table|does not exist/i.test(error.message ?? ""));

async function seed() {
  if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  if (!secret) fail("SUPABASE_SECRET_KEY is not set; the seed needs it to write.");
  const admin = createClient(url, secret, options);
  console.log(`Seeding ${BUILTIN_TEMPLATE_PACKS.length} template packs to ${url}`);

  const packs = BUILTIN_TEMPLATE_PACKS.map((p, i) => ({ id: p.id, name: p.name, audience: p.audience, description: p.description, sort_order: i }));
  const up = await admin.from("template_packs").upsert(packs, { onConflict: "id" });
  if (missingTable(up.error)) fail(SETUP_HINT);
  if (up.error) fail(`template_packs: ${up.error.message}`);
  ok(`${packs.length} packs`);

  const ids = packs.map((p) => p.id);
  for (const table of ["template_rules", "template_limits"]) {
    const del = await admin.from(table).delete().in("pack_id", ids);
    if (del.error) fail(`${table} (clearing): ${del.error.message}`);
  }

  const rules = BUILTIN_TEMPLATE_PACKS.flatMap((p) =>
    p.rules.map((r, i) => ({ pack_id: p.id, position: i, name: r.name, description: r.description ?? "", effect: r.effect, conditions: r.conditions })),
  );
  const limits = BUILTIN_TEMPLATE_PACKS.flatMap((p) =>
    p.limits.map((l, i) => ({ pack_id: p.id, position: i, name: l.name, kind: l.kind, scope: l.scope, action: l.action, period: l.period, value: l.value, on_exceed: l.onExceed })),
  );
  const r = await admin.from("template_rules").insert(rules);
  if (r.error) fail(`template_rules: ${r.error.message}`);
  ok(`${rules.length} rules`);
  const l = await admin.from("template_limits").insert(limits);
  if (l.error) fail(`template_limits: ${l.error.message}`);
  ok(`${limits.length} limits`);
  console.log("\nDone. Run `npm run supabase:check` to verify.");
}

async function check() {
  if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  if (!publishable) fail("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.");
  console.log(`Checking ${url}`);

  // 1. The publishable key is what the running app uses: it must be able to read, and only read.
  const anon = createClient(url, publishable, options);
  const packs = await anon.from("template_packs").select("id, name").order("sort_order");
  if (missingTable(packs.error)) fail(SETUP_HINT);
  if (packs.error) fail(`reading template_packs with the publishable key: ${packs.error.message}`);
  ok(`publishable key can read template_packs (${packs.data.length} rows)`);

  const counts = {};
  for (const table of ["template_rules", "template_limits"]) {
    const res = await anon.from(table).select("id", { count: "exact", head: true });
    if (res.error) fail(`reading ${table}: ${res.error.message}`);
    counts[table] = res.count;
    ok(`publishable key can read ${table} (${res.count} rows)`);
  }

  const expected = {
    packs: BUILTIN_TEMPLATE_PACKS.length,
    rules: BUILTIN_TEMPLATE_PACKS.reduce((n, p) => n + p.rules.length, 0),
    limits: BUILTIN_TEMPLATE_PACKS.reduce((n, p) => n + p.limits.length, 0),
  };
  if (packs.data.length !== expected.packs || counts.template_rules !== expected.rules || counts.template_limits !== expected.limits) {
    fail(`the catalog does not match the built-in copy (expected ${expected.packs} packs, ${expected.rules} rules, ${expected.limits} limits). Run \`npm run supabase:seed\`.`);
  }
  ok("catalog matches the built-in copy");

  // 2. Anonymous visitors must not be able to change the catalog.
  const write = await anon.from("template_packs").insert({ id: "__probe__", name: "x", audience: "x", description: "x" });
  if (!write.error) {
    await createClient(url, secret ?? publishable, options).from("template_packs").delete().eq("id", "__probe__");
    fail("the publishable key was able to WRITE to template_packs. Row-level security is not set up; run supabase/schema.sql.");
  }
  ok("publishable key cannot write (row-level security is on)");

  // 3. The secret key must be valid, for seeding.
  if (secret) {
    const admin = createClient(url, secret, options);
    const res = await admin.from("template_packs").select("id", { count: "exact", head: true });
    if (res.error) fail(`the secret key could not read template_packs: ${res.error.message}`);
    ok("secret key works");
  }
  console.log("\nSupabase is connected and the template catalog is in place.");
}

try {
  if (command === "seed") await seed();
  else if (command === "check") await check();
  else fail("Usage: node scripts/supabase.mjs <check|seed>");
} catch (err) {
  if (!(err instanceof Failure)) throw err;
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function walk(dir, out=[]) {
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory() && !["node_modules",".next"].includes(ent.name)) walk(p, out);
    else if (/\.(ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}
const repls = [
 [/const auth = agentAuth\(request\);/g, "const auth = await agentAuth(request);"],
 [/const cov = coverage\(org\);/g, "const cov = await coverage(org);"],
 [/await listUsers\(([^)]+)\)\.map/g, "(await listUsers($1)).map"],
 [/await listAgents\(([^)]+)\)\.map/g, "(await listAgents($1)).map"],
 [/await listCredentials\(([^)]+)\)\.map/g, "(await listCredentials($1)).map"],
 [/coverage\(org\)\.agents/g, "(await coverage(org)).agents"],
 [/const integrity = verifyAudit\(/g, "const integrity = await verifyAudit("],
 [/await listRules\(([^)]+)\)\.length/g, "(await listRules($1)).length"],
 [/await listLimits\(([^)]+)\)\.filter/g, "(await listLimits($1)).filter"],
 [/await installedTemplatesAmong\(([^)]+)\)\.has/g, "(await installedTemplatesAmong($1)).has"],
 [/await all<\{ agent_id: string; t: number \}>\("SELECT agent_id, MAX\(created_at\) AS t FROM events WHERE org_id = \? GROUP BY agent_id", org\.id\)\.map/g,
  '(await all<{ agent_id: string; t: number }>("SELECT agent_id, MAX(created_at) AS t FROM events WHERE org_id = ? GROUP BY agent_id", org.id)).map'],
 [/await all<Agent>\("SELECT \* FROM agents WHERE org_id = \?", org\.id\)\.map/g,
  '(await all<Agent>("SELECT * FROM agents WHERE org_id = ?", org.id)).map'],
];
for (const file of walk("src")) {
  let s = fs.readFileSync(file, "utf8");
  const orig = s;
  for (const [re, rep] of repls) s = s.replace(re, rep);
  if (file.includes("limits/page.tsx")) s = s.replace(/limitUsage\(org, now\)/g, "await limitUsage(org, now)");
  if (file.includes("audit/page.tsx")) s = s.replace(/async function targetHref/g, "function targetHref");
  if (file.endsWith("actions.ts")) {
    s = s.replace(/id = await createAgent\(org, userActor\(user\), \{ \.\.\.agentInput\(form\), parentAgentId: str\(form, "parent"\) \|\| null \}, now\)\.id;/,
      'id = (await createAgent(org, userActor(user), { ...agentInput(form), parentAgentId: str(form, "parent") || null }, now)).id;');
    s = s.replace(/updateSettings\(org, userActor\(user\), patch, now\);/g, "await updateSettings(org, userActor(user), patch, now);");
    s = s.replace(/, \(\{ org, user \}, now\) => \{/g, ", async ({ org, user }, now) => {");
    s = s.replace(/, \(\{ org \}, now\) => \{/g, ", async ({ org }, now) => {");
    s = s.replace(/, \(\{ org, user \}, now\) => await /g, ", async ({ org, user }, now) => await ");
    s = s.replace(/, \(\{ org \}, now\) => await /g, ", async ({ org }, now) => await ");
    s = s.replace(/\(\{ org, user \}, now\) => await /g, "async ({ org, user }, now) => await ");
    s = s.replace(/\(\{ org, user \}, now\) => \(\{/g, "async ({ org, user }, now) => ({");
  }
  if (s !== orig) { fs.writeFileSync(file, s); console.log("updated", file); }
}

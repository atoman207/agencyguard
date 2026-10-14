import fs from "node:fs";
import path from "node:path";

const root = "src";

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

// Fix async functions with object-literal or void return types missing Promise<>
for (const file of walk(root)) {
  let s = fs.readFileSync(file, "utf8");
  const before = s;

  // : void { on async function
  s = s.replace(/(async\s+function\s+\w+\s*\([^)]*\)\s*):\s*void\s*\{/g, "$1: Promise<void> {");

  // : { ... } | undefined {  and : { ... } {
  s = s.replace(
    /(async\s+function\s+\w+\s*\([^)]*\)\s*):\s*(\{[\s\S]*?\})\s*(\|\s*undefined)?\s*\{/g,
    (m, head, obj, und) => {
      if (m.includes("Promise<")) return m;
      return `${head}: Promise<${obj.trim()}${und ?? ""}> {`;
    },
  );

  if (s !== before) {
    fs.writeFileSync(file, s);
    console.log("types", file);
  }
}

// Known missing-await patterns on pages
const pageFixes = [
  {
    file: "src/app/(app)/agents/page.tsx",
    from: "const cov = new Map(coverage(org).agents.map((a) => [a.agent.id, a.share]));\n  const owners = new Map(await listUsers(org.id).map((u) => [u.id, u.name]));",
    to: "const cov = new Map((await coverage(org)).agents.map((a) => [a.agent.id, a.share]));\n  const owners = new Map((await listUsers(org.id)).map((u) => [u.id, u.name]));",
  },
];

for (const { file, from, to } of pageFixes) {
  if (!fs.existsSync(file)) continue;
  let s = fs.readFileSync(file, "utf8");
  if (s.includes(from)) {
    fs.writeFileSync(file, s.replace(from, to));
    console.log("page", file);
  } else {
    console.log("skip page pattern", file);
  }
}

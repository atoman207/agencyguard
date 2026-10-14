/**
 * Await all calls to exported async server helpers across src/.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src");
const serverDir = path.join(root, "server");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

// Collect exported async function names from server modules
const names = new Set();
for (const file of fs.readdirSync(serverDir).filter((f) => f.endsWith(".ts"))) {
  const src = fs.readFileSync(path.join(serverDir, file), "utf8");
  for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
    names.add(m[1]);
  }
}
// Also non-exported async functions that are called internally — collect all async function names in server/
const allAsync = new Set(names);
for (const file of fs.readdirSync(serverDir).filter((f) => f.endsWith(".ts"))) {
  const src = fs.readFileSync(path.join(serverDir, file), "utf8");
  for (const m of src.matchAll(/async\s+function\s+(\w+)/g)) {
    allAsync.add(m[1]);
  }
}

// Sort longest first to avoid partial matches (unlikely with word boundaries)
const nameList = [...allAsync].sort((a, b) => b.length - a.length);
const nameAlt = nameList.join("|");
console.log(`Tracking ${nameList.length} async helpers`);

const callRe = new RegExp(`(^|[^.\\w$])(?:await\\s+)?(${nameAlt})(\\s*<[^>]*>)?\\s*\\(`, "gm");

function processFile(file) {
  let src = fs.readFileSync(file, "utf8");
  const before = src;

  // Don't touch string contents naively — good enough for this codebase
  src = src.replace(callRe, (m, pre, name, gen) => `${pre}await ${name}${gen ?? ""}(`);
  src = src.replace(/await\s+await\s+/g, "await ");

  // Make sync functions async if they contain await of our helpers
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/async\s+function/.test(lines[i])) continue;
    if (!/^\s*(export\s+)?function\s+\w+/.test(lines[i])) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^(export\s+)?(async\s+)?function\s+/.test(lines[j])) {
        end = j;
        break;
      }
    }
    const body = lines.slice(i, end).join("\n");
    if (new RegExp(`await\\s+(${nameAlt})\\b`).test(body) || /await\s+(get|all|run|tx)\b/.test(body)) {
      lines[i] = lines[i].replace(/^(\s*)(export\s+)?function\s+/, "$1$2async function ");
    }
  }
  src = lines.join("\n");

  // Fix return types on newly-async functions (simple named types / unions, not object literals)
  src = src.replace(
    /(async\s+function\s+\w+\s*\([^)]*\)\s*):\s*(?!Promise\b|void\b|never\b)([A-Za-z_][\w\s|&<>\[\]"'.,\s]*)\s*\{/g,
    (m, head, ret) => {
      const t = ret.trim();
      if (!t || t.includes("{") || t.startsWith("Promise")) return m;
      return `${head}: Promise<${t}> {`;
    },
  );

  if (src !== before) {
    fs.writeFileSync(file, src);
    return true;
  }
  return false;
}

let n = 0;
for (const file of walk(root)) {
  if (processFile(file)) {
    console.log("updated", path.relative(process.cwd(), file));
    n++;
  }
}
console.log(`Updated ${n} files`);

/**
 * Fix pass: await get/all/run/tx including generics; async tx callbacks;
 * async functions + Promise return types for db importers.
 */
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

function importsDb(src) {
  return /from\s+["']\.\/db["']/.test(src) || /from\s+["']@\/server\/db["']/.test(src);
}

/** Insert await before get/all/run/tx calls (with optional generics). */
function addAwaits(src) {
  // Match: optional await already, then get|all|run|tx, optional <...>, then (
  return src.replace(
    /(^|[^.\w$])(?:await\s+)?(get|all|run|tx)(\s*<[^>]*>)?\s*\(/gm,
    (m, pre, name, gen) => `${pre}await ${name}${gen ?? ""}(`,
  );
}

function makeTxCallbacksAsync(src) {
  // await tx(() => {  -> await tx(async () => {
  // await tx(() =>    -> await tx(async () =>
  return src
    .replace(/await\s+tx\(\s*\(\s*\)\s*=>/g, "await tx(async () =>")
    .replace(/await\s+tx\(\s*function\s*\(/g, "await tx(async function (");
}

function markFunctionsAsync(src) {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(export\s+)?function\s+\w+/.test(lines[i])) continue;
    if (/async\s+function/.test(lines[i])) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^(export\s+)?(async\s+)?function\s+/.test(lines[j])) {
        end = j;
        break;
      }
    }
    const body = lines.slice(i, end).join("\n");
    if (/await\s+(get|all|run|tx)\b/.test(body)) {
      lines[i] = lines[i].replace(/^(\s*)(export\s+)?function\s+/, "$1$2async function ");
    }
  }
  return lines.join("\n");
}

/** Wrap non-Promise return types on async functions that clearly return T. */
function fixReturnTypes(src) {
  // async function foo(...): Type {  where Type is not Promise|void|never
  return src.replace(
    /(async\s+function\s+\w+\s*\([^)]*\)\s*):\s*(?!Promise\b|void\b|never\b|AsyncGenerator)([^{;=]+)\s*\{/g,
    (m, head, ret) => {
      const t = ret.trim();
      if (!t || t.startsWith("Promise")) return m;
      return `${head}: Promise<${t}> {`;
    },
  );
}

const files = walk(root).filter((f) => path.basename(f) !== "db.ts");

for (const file of files) {
  let src = fs.readFileSync(file, "utf8");
  if (!importsDb(src)) continue;

  const before = src;
  src = addAwaits(src);
  src = makeTxCallbacksAsync(src);
  src = markFunctionsAsync(src);
  src = fixReturnTypes(src);
  // clean double await
  src = src.replace(/await\s+await\s+/g, "await ");

  if (src !== before) {
    fs.writeFileSync(file, src);
    console.log("fixed", path.relative(process.cwd(), file));
  }
}

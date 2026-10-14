/**
 * Fix await precedence: await foo().bar → (await foo()).bar
 * Also mark sync functions/arrows that contain await as async.
 * Fix route handlers: export function GET → export async function GET when body has await.
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

/** Wrap await CALL in parens when followed by . or [ or ! */
function wrapAwaitCalls(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    // find "await "
    const idx = src.indexOf("await ", i);
    if (idx === -1) {
      out += src.slice(i);
      break;
    }
    // skip if already (await
    const before = src.slice(Math.max(0, idx - 1), idx);
    if (before === "(") {
      out += src.slice(i, idx + 6);
      i = idx + 6;
      continue;
    }
    out += src.slice(i, idx);
    const start = idx + 6; // after "await "
    // skip whitespace
    let j = start;
    while (j < src.length && /\s/.test(src[j])) j++;
    // must start with identifier
    if (!/[A-Za-z_$]/.test(src[j])) {
      out += src.slice(idx, j);
      i = j;
      continue;
    }
    // parse identifier + optional generics + call
    let k = j;
    while (k < src.length && /[\w$]/.test(src[k])) k++;
    // optional <generics>
    if (src[k] === "<") {
      let depth = 1;
      k++;
      while (k < src.length && depth > 0) {
        if (src[k] === "<") depth++;
        else if (src[k] === ">") depth--;
        k++;
      }
    }
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] !== "(") {
      out += src.slice(idx, k);
      i = k;
      continue;
    }
    // parse balanced parens
    let depth = 1;
    k++;
    while (k < src.length && depth > 0) {
      const c = src[k];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === '"' || c === "'" || c === "`") {
        const q = c;
        k++;
        while (k < src.length && src[k] !== q) {
          if (src[k] === "\\") k++;
          k++;
        }
      }
      k++;
    }
    const callEnd = k;
    // check if followed by . [ or !
    let m = callEnd;
    while (m < src.length && /\s/.test(src[m])) m++;
    if (src[m] === "." || src[m] === "[" || src[m] === "!") {
      out += "(await " + src.slice(start, callEnd) + ")";
      i = callEnd;
    } else {
      out += src.slice(idx, callEnd);
      i = callEnd;
    }
  }
  return out;
}

function markAsync(src) {
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // export function GET/POST/... or function foo
    if (/async\s+function/.test(lines[i])) continue;
    const fn = lines[i].match(/^(\s*)(export\s+)?function\s+(\w+)/);
    const arrow = lines[i].match(/^(\s*)(export\s+)?(const|let)\s+(\w+)\s*=\s*(?!async)(\([^)]*\)|[A-Za-z_]\w*)\s*=>/);
    if (!fn && !arrow) continue;

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^(export\s+)?(async\s+)?function\s+/.test(lines[j])) {
        end = j;
        break;
      }
      if (/^(export\s+)?(const|let)\s+\w+\s*=/.test(lines[j]) && j > i) {
        // only break on top-level-ish
        if ((lines[j].match(/^\s*/)[0].length || 0) <= (lines[i].match(/^\s*/)[0].length || 0)) {
          end = j;
          break;
        }
      }
    }
    const body = lines.slice(i, end).join("\n");
    if (!/\bawait\b/.test(body)) continue;
    if (fn) {
      lines[i] = lines[i].replace(/^(\s*)(export\s+)?function\s+/, "$1$2async function ");
    } else if (arrow) {
      lines[i] = lines[i].replace(/=\s*/, "= async ");
    }
  }
  return lines.join("\n");
}

let n = 0;
for (const file of walk(root)) {
  let src = fs.readFileSync(file, "utf8");
  if (!/\bawait\b/.test(src)) continue;
  const before = src;
  src = wrapAwaitCalls(src);
  src = markAsync(src);
  if (src !== before) {
    fs.writeFileSync(file, src);
    console.log("fixed", path.relative(process.cwd(), file));
    n++;
  }
}
console.log("files", n);

// scripts/_probe_fin2027_dangling_refs.mjs
//
// FIN-2027 W1 Post-Incident Guard 1. Given a list of (file, symbol)
// pairs that a PR removed or renamed, greps the tree for surviving
// references. Exits non-zero on any surviving reference.
//
// The trap the guard exists to catch (see docs/GOTCHAS.md and #1166 /
// #1169): deleting a constant while replacing only some of its
// references. `npm run build` passes because a bare identifier
// reference is a runtime ReferenceError, not a compile error. The
// year-safety probe passes because a dangling constant is invisible
// to it. A green build is not a reference check.
//
// Usage:
//   node scripts/_probe_fin2027_dangling_refs.mjs \
//     src/lib/labor/salaryBoard.js:FY2026 \
//     src/lib/labor/labor-batr.js:FISCAL_YEAR
//
//   The colon-separated pairs read: "check that <symbol> is no longer
//   referenced. The <file> path is where the symbol was defined - if
//   it was a local (non-exported) const, we scan JUST that file; if
//   the caller passes --tree the scan is tree-wide (for exported
//   symbols)."
//
// Flags:
//   --tree                 scan the whole tree, not just the source file
//   --root <path>          scan root (default: repo root)
//   --strict               exit non-zero on comment-only hits too
//                          (default: comment lines like `// FISCAL_YEAR foo`
//                          are ignored; only code identifier uses fail)
//
// Exit codes:
//   0 - no dangling references
//   1 - bad args
//   2 - at least one surviving reference
//
// Wire into the year-safety report by piping both into a combined
// PR-body "Guards" section.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url))) + "/";

const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", ".vercel", "coverage"]);
const CODE_EXTS = new Set([".js", ".mjs", ".ts", ".tsx", ".jsx"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (IGNORE_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else {
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot) : "";
      if (CODE_EXTS.has(ext)) out.push(p);
    }
  }
  return out;
}

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function isStringLiteralHit(line, symbol) {
  // Naive but useful: if the symbol only appears inside a matched
  // pair of quotes (single or double or backtick) on that line, treat
  // as a string literal hit, not a code reference.
  const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`);
  const m = line.match(re);
  if (!m) return false;
  const idx = m.index;
  // Walk char-by-char to idx, tracking simple in-string state.
  let inS = null;
  for (let i = 0; i < idx; i += 1) {
    const c = line[i];
    if (inS) {
      if (c === "\\") { i += 1; continue; }
      if (c === inS) { inS = null; continue; }
    } else if (c === "'" || c === '"' || c === "`") {
      inS = c;
    }
  }
  return inS !== null;
}

// Parse args
const args = { targets: [], tree: false, strict: false, root: REPO_ROOT };
for (let i = 2; i < process.argv.length; i += 1) {
  const x = process.argv[i];
  if (x === "--tree") args.tree = true;
  else if (x === "--strict") args.strict = true;
  else if (x === "--root") args.root = process.argv[++i];
  else if (x.startsWith("--")) { console.error(`unknown flag: ${x}`); process.exit(1); }
  else {
    const idx = x.lastIndexOf(":");
    if (idx < 0) { console.error(`bad pair: ${x} (expected 'file:symbol')`); process.exit(1); }
    args.targets.push({ file: x.slice(0, idx), symbol: x.slice(idx + 1) });
  }
}
if (args.targets.length === 0) {
  console.error("usage: node scripts/_probe_fin2027_dangling_refs.mjs <file:symbol> [<file:symbol>...] [--tree] [--strict]");
  process.exit(1);
}

console.log("FIN-2027 Guard 1 · dangling-reference scan");
console.log(`  root:    ${args.root}`);
console.log(`  tree:    ${args.tree}`);
console.log(`  strict:  ${args.strict}`);
console.log(`  targets: ${args.targets.length}`);
console.log("");

let totalFails = 0;

for (const t of args.targets) {
  const scanFiles = args.tree ? walk(args.root) : [join(args.root, t.file)];
  const re = new RegExp(`\\b${t.symbol.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`);
  const hits = [];
  for (const abs of scanFiles) {
    if (!existsSync(abs)) continue;
    const src = readFileSync(abs, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!re.test(line)) continue;
      const commentOnly = isCommentLine(line);
      const stringOnly  = isStringLiteralHit(line, t.symbol);
      if (!args.strict && (commentOnly || stringOnly)) continue;
      hits.push({ file: relative(args.root, abs), lineNo: i + 1, line: line.trimEnd(), commentOnly, stringOnly });
    }
  }
  const label = args.tree
    ? `symbol ${t.symbol} (was in ${t.file}, tree-wide scan)`
    : `symbol ${t.symbol} in file-local scope (${t.file})`;
  if (hits.length === 0) {
    console.log(`  PASS  ${label}`);
  } else {
    totalFails += hits.length;
    console.log(`  FAIL  ${label} · ${hits.length} surviving reference(s):`);
    for (const h of hits) {
      const tag = h.commentOnly ? " [comment]" : h.stringOnly ? " [string-literal]" : "";
      console.log(`        ${h.file}:${h.lineNo}${tag}  ${h.line.trim().slice(0, 100)}`);
    }
  }
}

console.log("");
console.log(totalFails === 0 ? "GUARD 1 · PASS" : "GUARD 1 · FAIL");
process.exit(totalFails === 0 ? 0 : 2);

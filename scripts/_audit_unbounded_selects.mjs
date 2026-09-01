// Permanent audit: catch Supabase `.select()` calls that carry no
// scope guard and will silently truncate at PostgREST's 1000-row cap.
//
// GOTCHAS.md:934 records the cap as having hit this project four
// times prior; it hit a fifth time this week in loadStintMap,
// silently truncating academy_person_stints at 1000 of 1129 rows
// and shipping eight requirements with a NULL person_id.
//
// Report-only in this pass. A brand-new lint that breaks CI on day
// one gets disabled rather than fixed - establish the signal first;
// wire in separately once the false-positive rate is known.
//
// Heuristic: for every `.select(...)` occurrence in a JS/MJS/JSX
// file under src/ or scripts/, walk backward to find the enclosing
// `.from("<table>")` and forward + backward inside the same
// statement to look for one of the SAFE guards below. Any of them
// means the call is bounded; absence flags it.
//
// SAFE guards:
//   1. `.limit(...)` or `.range(...)`           - explicit paging
//   2. `.single()` or `.maybeSingle()`          - single-row expected
//   3. `.eq('<pk>', ...)` or `.in('<pk>', ...)` - narrowed by PK/UK
//      (heuristic: column name in a small allowlist of primary-key
//      / unique-key shapes)
//   4. `{ count: 'exact', head: true }` in the select options - the
//      HEAD-count probe, no payload transferred
//
// Anything else is a candidate for silent truncation on a table
// that grows past 1000 rows. Also flagged: any select that has no
// enclosing `.from(...)` found in the ~600-char window (probably
// not a Supabase call - noted separately as SKIPPED, not FLAGGED).
//
// Run:
//   node scripts/_audit_unbounded_selects.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const ROOTS = [
  path.join(REPO_ROOT, "src"),
  path.join(REPO_ROOT, "scripts"),
];

const SELECT_RE = /\.select\s*\(/g;
const FROM_RE = /\.from\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

// Column names that reliably narrow to <= 1 row (PK / UK across the
// Academy + KPI + Ops schemas as of 2026-09-01). If a `.eq()` or
// `.in()` targets one of these, the select is bounded regardless of
// paging.
const PK_LIKE_COLS = new Set([
  "id", "attestation_id", "attempt_id", "question_id",
  "requirement_id", "cycle_id", "obligation_id",
  "worker_id", "person_id", "manager_worker_id",
  "team_key", "account_key", "rippling_id", "content_hash",
  "email", "natural_key", "grant_type",
]);

const GUARD_METHODS = [
  ".limit(", ".range(", ".single(", ".maybeSingle(",
];

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p));
    else if (entry.isFile() && (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".jsx"))) out.push(p);
  }
  return out;
}

// Locate the enclosing "chain" for a `.select(` occurrence. Walks
// backward until it finds an obvious statement start (line-start
// `await`, `const`, `let`, `var`, `return`, or a `;` on the line
// before) OR runs out of the 800-char window. Same forward, up to
// the next statement terminator.
function chainSlice(src, matchIdx) {
  const startWin = Math.max(0, matchIdx - 800);
  const endWin = Math.min(src.length, matchIdx + 1200);
  const before = src.slice(startWin, matchIdx);
  const after = src.slice(matchIdx, endWin);

  // Backward: find the last statement boundary. Look for the last
  // `;` OR the last line that starts with `await`/`const`/`let`/
  // `var`/`return`/blank. We use the LAST such line boundary before
  // matchIdx.
  const backLines = before.split("\n");
  let cutBack = 0;
  for (let i = backLines.length - 1; i >= 0; i--) {
    const line = backLines[i];
    if (/^(?:\s*(?:await\s+|const\s+|let\s+|var\s+|return\s+)|\s*)$/.test(line) && line.trim() === "") continue;
    if (/^\s*(?:await\s+|const\s+|let\s+|var\s+|return\s+|if\s*\()/.test(line)) {
      cutBack = backLines.slice(0, i).join("\n").length + (i > 0 ? 1 : 0);
      break;
    }
    if (/;\s*$/.test(line) && i < backLines.length - 1) {
      cutBack = backLines.slice(0, i + 1).join("\n").length + 1;
      break;
    }
  }

  // Forward: extend until we see a `;` at a paren-balance of zero,
  // OR the window ends, whichever first.
  let depth = 0;
  let cutFwd = after.length;
  for (let i = 0; i < after.length; i++) {
    const c = after[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth <= 0) { cutFwd = i + 1; break; }
    else if (c === "\n" && depth === 0 && i > 5 && after.slice(i, i + 40).match(/^\n\s*(?:\/\/|const |let |var |await |return |}|if |for )/)) {
      cutFwd = i;
      break;
    }
  }

  return before.slice(cutBack) + after.slice(0, cutFwd);
}

function chainHasGuard(chain) {
  // .limit / .range / .single / .maybeSingle anywhere in the chain
  for (const g of GUARD_METHODS) if (chain.includes(g)) return true;

  // count: 'exact', head: true inside the select options
  if (/count\s*:\s*["']exact["'][^)]*head\s*:\s*true/.test(chain)) return true;
  if (/head\s*:\s*true[^)]*count\s*:\s*["']exact["']/.test(chain)) return true;

  // .eq('<pk>', ...) or .in('<pk>', ...) on a PK-shaped column
  const eqInRe = /\.(?:eq|in)\s*\(\s*["'`]([a-z_][a-z0-9_]*)["'`]/gi;
  for (const m of chain.matchAll(eqInRe)) {
    if (PK_LIKE_COLS.has(m[1])) return true;
  }

  return false;
}

function findEnclosingTable(chain, selectIdx) {
  // Walk `.from(...)` in the chain; the LAST one that appears BEFORE
  // .select( in the chain string is the enclosing one.
  let best = null;
  for (const m of chain.matchAll(FROM_RE)) {
    if (m.index < selectIdx) best = m[1];
  }
  return best;
}

function lineNumberAt(src, idx) {
  return src.slice(0, idx).split("\n").length;
}

const flagged = [];
const skipped = [];
let totalSelects = 0;
let totalFiles = 0;

for (const root of ROOTS) {
  const files = await walk(root);
  for (const f of files) {
    totalFiles++;
    const src = await fs.readFile(f, "utf8");
    for (const m of src.matchAll(SELECT_RE)) {
      totalSelects++;
      const chain = chainSlice(src, m.index);
      // Find where `.select(` sits within the chain slice so we can
      // locate the enclosing `.from`.
      const selectInChain = chain.lastIndexOf(".select(");
      const table = findEnclosingTable(chain, selectInChain);
      const rel = path.relative(REPO_ROOT, f);
      const line = lineNumberAt(src, m.index);
      if (!table) {
        // Not a Supabase call as far as we can tell; skip.
        skipped.push({ file: rel, line });
        continue;
      }
      if (chainHasGuard(chain)) continue;
      flagged.push({ file: rel, line, table });
    }
  }
}

// Sort + de-dupe (same (file, line, table) can appear if the chain
// has multiple .select() forms; keep one entry per site).
const seen = new Set();
const unique = [];
for (const item of flagged) {
  const key = `${item.file}:${item.line}:${item.table}`;
  if (seen.has(key)) continue;
  seen.add(key);
  unique.push(item);
}
unique.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

console.log(`unbounded-select audit (report only):`);
console.log(`  files scanned:                   ${totalFiles}`);
console.log(`  .select() occurrences seen:      ${totalSelects}`);
console.log(`  skipped (no .from in window):    ${skipped.length}`);
console.log(`  FLAGGED (no bounding guard):     ${unique.length}`);
console.log("");

if (unique.length > 0) {
  console.log("Flagged sites (Supabase .select() with no limit/range/single/maybeSingle/PK-eq/HEAD-count):");
  // Group by table for scanability.
  const byTable = new Map();
  for (const u of unique) {
    if (!byTable.has(u.table)) byTable.set(u.table, []);
    byTable.get(u.table).push(u);
  }
  for (const [table, items] of [...byTable.entries()].sort()) {
    console.log(`  [${table}]  ${items.length} site(s)`);
    for (const it of items) console.log(`    ${it.file}:${it.line}`);
  }
}

// Report-only. Do not exit non-zero.

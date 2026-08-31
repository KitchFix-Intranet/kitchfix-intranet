// scripts/probes/_probe_pagination_order_keys.mjs
//
// Pagination-order guard. Committed as a load-bearing probe for every
// PR that touches PostgREST queries against a table that can exceed the
// 1000-row default page size.
//
// THE DEFECT CLASS THIS GUARDS
//
// Kevin's pattern-law note (2026-08-31): "instance three of the class
// in a month - purchasing #892's .order('id') retraction ($595.45),
// the Overview sentinel probe (-$3,672.03), and Overview pnl-loader
// sc_daily_revenue order chain."
//
// PostgREST's .range(from, to) offset pagination re-orders rows freely
// within a tie group whenever the .order() chain is not a strict total
// order on the row set being paginated. A tie group straddling the
// 1000-row page boundary produces silent duplication + drop:
//   - N rows land on both page k and page k+1 (double-counted)
//   - N other rows land on neither page (missed)
// The row count is unchanged; the sum is wrong.
//
// WHAT THIS PROBE DOES
//
// Walks every .js / .mjs / .ts file under src/ and scripts/, finds
// every `.range(` occurrence, walks backwards to the nearest .from(
// origin, collects every .order() chained between the .from and the
// .range, and classifies:
//
//   DETERMINISTIC - the .order() chain contains a column that is
//     unique-within-scope. Statically we cannot always prove this, so
//     the heuristic is:
//       - the chain includes an id-like column (id, rippling_id,
//         external_id, uuid, transaction_id, worker_id + week_start,
//         etc.), OR
//       - the chain includes enough keys to match the target's known
//         grain (see KNOWN_GRAINS below), OR
//       - the site carries an inline annotation acknowledging it
//
//   NEEDS-ANNOTATION - cannot be proven deterministic; requires an
//     inline `// pagination-order-ok: <reason>` on a line within 5
//     lines of the .range( call. When present, treated as ACCEPTED.
//
//   FAIL - no order chain, or chain is judged non-deterministic, and
//     no annotation is present. These are the sites to fix or
//     annotate.
//
// SEEDED FAILURE (self-test)
//
// Kevin's rule: "every probe born with a seeded failure case." Run
// with --self-test to prove the FAIL surface fires. The self-test
// writes a temp file containing a .range() call with a stripped order
// chain and asserts the scanner classifies it FAIL. Then it writes
// an annotated variant and asserts the scanner classifies it ACCEPTED.
// No production file is touched.
//
// STOP-RULE
//
// Kevin (2026-08-31): "If the probe finds anything like 76 findings,
// report it and stop - do not fix them in this PR." The pnl-loader
// fix ships in the same PR; sweep is a separate future PR.
//
// USAGE
//
//   node scripts/probes/_probe_pagination_order_keys.mjs
//   node scripts/probes/_probe_pagination_order_keys.mjs --self-test
//   node scripts/probes/_probe_pagination_order_keys.mjs --verbose
//
// Exits non-zero if FAIL count > 0.

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

const VERBOSE = process.argv.includes("--verbose");
const SELF_TEST = process.argv.includes("--self-test");

// ── Configuration ──────────────────────────────────────────────────

const SCAN_DIRS = ["src", "scripts"];
const EXTS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "coverage", "dist", "build"]);

// Column names that are, by convention, unique on a row - a single
// order key on any of these makes the chain deterministic. Kept
// conservative: any column that maps to a primary key or a
// per-row-unique identifier lands here.
const ID_LIKE = new Set([
  "id",
  "uuid",
  "rippling_id",
  "external_id",
  "transaction_id",
  "txn_id",
  "row_id",
  "pk",
  "primary_key",
]);

// Known table grains. If the ordered columns include this key set (in
// any order), the query is deterministic on that table. Format:
//   table_name -> [ [required_col_set_1], [required_col_set_2], ... ]
// Any one grain matching is enough.
const KNOWN_GRAINS = {
  "sc_daily_revenue":     [["account_key", "service_id", "service_date"]],
  "sc_daily_projections": [["account_key", "service_id", "service_date"]],
  "sc_daily_actuals":     [["account_key", "service_id", "service_date"]],
  "sc_day_metadata":      [["account_key", "service_date"]],
  "sc_services":          [["id"], ["account_key", "group_id", "service_name"]],
  "sc_service_groups":    [["id"], ["account_key", "group_name"]],
  "sc_service_prices":    [["id"], ["service_id", "price_kind", "effective_date"]],
  "pnl_actuals":          [["account_key", "fiscal_year", "period_no", "line_code"]],
  "kpi_budgets":          [["account_key", "fiscal_year", "period_no", "line_code"]],
  "kpi_period_status":    [["fiscal_year", "period_no"]],
  "kpi_account_flags":    [["account_key"]],
  "labor_actuals_latest": [["week_start", "account_key", "worker_id"]],
  "purchasing_actuals":   [["id"], ["source", "external_id"], ["account_key", "gl_line_code", "txn_date", "id"]],
  "accounts":             [["id"], ["team_key"]],
};

// Regex to find annotation on nearby lines.
const ANNOTATION_RE = /pagination-order-ok\s*:\s*(.+)/;

// Regex to pull a table name from a .from("name") or .from('name').
const FROM_RE = /\.from\(\s*["'`]([^"'`]+)["'`]/;

// Regex to pull column names from .order("col") or .order('col', ...).
// Handles nested schema like .order("account_key").
const ORDER_RE = /\.order\(\s*["'`]([^"'`]+)["'`]/g;

// Regex to pull column names from .eq("col", value) - a fixed .eq()
// column effectively constrains the grain: if the grain is
// (a, b, c, d) and the query does .eq("a", X), then ordering by
// (b, c, d) is deterministic on the filtered subset. We fold .eq()
// columns into the ordered-column set for the grain match.
const EQ_RE = /\.eq\(\s*["'`]([^"'`]+)["'`]/g;

// ── File walker ────────────────────────────────────────────────────

function walkDir(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walkDir(full, out);
    else {
      const dotIdx = name.lastIndexOf(".");
      const ext = dotIdx >= 0 ? name.slice(dotIdx) : "";
      if (EXTS.has(ext)) out.push(full);
    }
  }
  return out;
}

// ── Scanner ────────────────────────────────────────────────────────

// Given a file's line-array and the line index of a .range( call, walk
// backwards to find the .from(...) origin and forward-adjacent chained
// .order() lines. Because query builders are chained across newlines,
// we scan a window bounded by the nearest unmatched semicolon /
// function boundary before the .range line.
function extractChain(lines, rangeLineIdx) {
  // Find start of the chain. Walk backwards until we hit a line that
  // starts a new statement (a bare `const`/`let`/`var`/`await`/`return`
  // or a line ending with `;` that is not a chain continuation).
  let start = rangeLineIdx;
  while (start > 0) {
    const prev = lines[start - 1];
    const prevTrim = prev.trim();
    // A line ending with `;` closes a statement. If it does, stop.
    if (prevTrim.endsWith(";")) break;
    // Blank / comment-only lines: keep walking; the chain may span them.
    // A line starting with `const `, `let `, `var `, `return `, `await `,
    // or `.from(` (the source line itself) is the start. But we need to
    // include it, so decrement first then check.
    start -= 1;
    if (/\b(const|let|var|return|await)\b/.test(prevTrim) || /\.from\(/.test(prevTrim)) break;
    // Safety net: don't scan more than 60 lines back.
    if (rangeLineIdx - start > 60) break;
  }

  const window = lines.slice(start, rangeLineIdx + 1).join("\n");
  const fromMatch = window.match(FROM_RE);
  const table = fromMatch ? fromMatch[1] : null;

  const orderCols = [];
  let m;
  ORDER_RE.lastIndex = 0;
  while ((m = ORDER_RE.exec(window)) !== null) {
    orderCols.push(m[1]);
  }

  const eqCols = [];
  let em;
  EQ_RE.lastIndex = 0;
  while ((em = EQ_RE.exec(window)) !== null) {
    eqCols.push(em[1]);
  }

  // Annotation: check the entire chain window (from the .from(...) or
  // the walked-back statement start through the .range( line) plus a
  // small forward buffer for trailing-comment style. This catches
  // annotations placed above the query builder as well as inline.
  const annoStart = Math.max(0, start - 2);
  const annoEnd = Math.min(lines.length, rangeLineIdx + 6);
  let annotation = null;
  for (let i = annoStart; i < annoEnd; i += 1) {
    const am = lines[i].match(ANNOTATION_RE);
    if (am) { annotation = am[1].trim(); break; }
  }

  return { table, orderCols, eqCols, annotation, chainWindow: window };
}

function classify({ table, orderCols, eqCols, annotation }) {
  if (annotation) {
    return { verdict: "ACCEPTED", reason: `annotated: ${annotation}` };
  }
  if (orderCols.length === 0) {
    return { verdict: "FAIL", reason: "no .order() in chain" };
  }
  // ID-like column present -> deterministic.
  for (const col of orderCols) {
    if (ID_LIKE.has(col)) {
      return { verdict: "DETERMINISTIC", reason: `id-like column in chain: ${col}` };
    }
  }
  // Known grain match? Fold .eq()-filtered columns into the effective
  // ordered set - a fixed .eq() constrains the grain to a subset where
  // the remaining columns provide a total order.
  if (table && KNOWN_GRAINS[table]) {
    const grains = KNOWN_GRAINS[table];
    const orderSet = new Set(orderCols);
    const effectiveSet = new Set([...orderCols, ...(eqCols || [])]);
    for (const grain of grains) {
      if (grain.every(k => orderSet.has(k))) {
        return { verdict: "DETERMINISTIC", reason: `matches ${table} grain: (${grain.join(", ")})` };
      }
      if (grain.every(k => effectiveSet.has(k))) {
        const eqOnly = grain.filter(k => !orderSet.has(k) && (eqCols || []).includes(k));
        return { verdict: "DETERMINISTIC", reason: `matches ${table} grain with .eq() pinning: order=(${orderCols.join(",")}) + eq=(${eqOnly.join(",")})` };
      }
    }
    return { verdict: "FAIL", reason: `${table} grain requires one of [${grains.map(g => "(" + g.join(",") + ")").join(" | ")}]; chain has order=(${orderCols.join(", ")}) eq=(${(eqCols || []).join(", ")})` };
  }
  // Unknown table + no id-like column. Needs annotation to certify.
  return { verdict: "FAIL", reason: `table '${table || "unknown"}' not in KNOWN_GRAINS and no id-like column; add // pagination-order-ok: <reason> if intentional` };
}

function scanFile(path) {
  let src;
  try { src = readFileSync(path, "utf8"); }
  catch { return []; }
  const lines = src.split("\n");
  const findings = [];
  for (let i = 0; i < lines.length; i += 1) {
    // Comment lines that mention `.range(` should be excluded.
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    if (!lines[i].includes(".range(")) continue;
    // Must look like an actual method call: `.range(<num>, <num>)`.
    // Skip lines that look like documentation strings.
    if (!/\.range\(\s*[a-zA-Z0-9_+\-*/() ,]+\)/.test(lines[i])) continue;
    const chain = extractChain(lines, i);
    const cls = classify(chain);
    findings.push({
      file: path,
      line: i + 1,
      table: chain.table,
      orderCols: chain.orderCols,
      annotation: chain.annotation,
      verdict: cls.verdict,
      reason: cls.reason,
    });
  }
  return findings;
}

function scanAll() {
  const files = [];
  for (const dir of SCAN_DIRS) files.push(...walkDir(join(REPO_ROOT, dir)));
  const findings = [];
  const selfPath = fileURLToPath(import.meta.url);
  for (const f of files) {
    // The probe's own file contains .range( in string literals inside
    // the self-test source; skip to avoid scanning our own bytecode.
    if (f === selfPath) continue;
    findings.push(...scanFile(f));
  }
  return findings;
}

// ── Self-test ──────────────────────────────────────────────────────

async function selfTest() {
  console.log("=== SELF-TEST: seeded pagination-order failure ===\n");
  const seedFile = join(REPO_ROOT, "scripts", "probes", "_probe_pagination_order_keys_seed.tmp.mjs");

  // Case 1: known-good call with the third key stripped. This mirrors
  // the exact defect just fixed in pnl-loader.js:215-217 - ordering
  // sc_daily_revenue by (account_key, service_date) without the
  // service_id third key.
  const stripped = `// TEMP seed for _probe_pagination_order_keys self-test.
export async function seedStripped(supa, memberChunk, start, end) {
  const q = await supa
    .from("sc_daily_revenue")
    .select("account_key, service_date, actual_revenue")
    .in("account_key", memberChunk)
    .gte("service_date", start)
    .lte("service_date", end)
    .order("account_key")
    .order("service_date")
    .range(0, 999);
  return q;
}
`;
  writeFileSync(seedFile, stripped);
  const strippedFindings = scanFile(seedFile);
  const failed = strippedFindings.find(f => f.verdict === "FAIL");
  const strippedOk = !!failed;
  console.log(`  Case 1 (stripped order chain on sc_daily_revenue):`);
  console.log(`    findings: ${strippedFindings.length}`);
  if (failed) {
    console.log(`    verdict: ${failed.verdict}`);
    console.log(`    reason:  ${failed.reason}`);
  }
  console.log(`    self-test: ${strippedOk ? "PASS (fired as designed)" : "FAIL (guard silent)"}`);

  // Case 2: annotated variant. Same shape, but with the annotation
  // present - guard should classify ACCEPTED.
  const annotated = `// TEMP seed for _probe_pagination_order_keys self-test.
export async function seedAnnotated(supa, memberChunk, start, end) {
  // pagination-order-ok: sample only; caller aggregates, no page boundary
  const q = await supa
    .from("sc_daily_revenue")
    .select("account_key, service_date, actual_revenue")
    .in("account_key", memberChunk)
    .gte("service_date", start)
    .lte("service_date", end)
    .order("account_key")
    .order("service_date")
    .range(0, 999);
  return q;
}
`;
  writeFileSync(seedFile, annotated);
  const annotatedFindings = scanFile(seedFile);
  const accepted = annotatedFindings.find(f => f.verdict === "ACCEPTED");
  const annotatedOk = !!accepted;
  console.log(`\n  Case 2 (annotated call site):`);
  console.log(`    findings: ${annotatedFindings.length}`);
  if (accepted) {
    console.log(`    verdict: ${accepted.verdict}`);
    console.log(`    reason:  ${accepted.reason}`);
  }
  console.log(`    self-test: ${annotatedOk ? "PASS (annotation honored)" : "FAIL (annotation ignored)"}`);

  try { unlinkSync(seedFile); } catch {}

  console.log(`\n  Self-test overall: ${(strippedOk && annotatedOk) ? "PASS" : "FAIL"}`);
  return strippedOk && annotatedOk;
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  if (SELF_TEST) {
    const ok = await selfTest();
    process.exit(ok ? 0 : 1);
  }

  // Always run the self-test at launch to prove the machinery. Kevin's
  // rule ("every probe born with a seeded failure case") - baked in,
  // not optional.
  const selfOk = await selfTest();
  if (!selfOk) {
    console.error("\n[abort] self-test failed - guard is broken, not scanning production");
    process.exit(2);
  }

  console.log("\n=== SCAN: production .range() call sites ===\n");
  const findings = scanAll();
  const total = findings.length;
  const byVerdict = { DETERMINISTIC: 0, ACCEPTED: 0, FAIL: 0 };
  const fails = [];
  for (const f of findings) {
    byVerdict[f.verdict] = (byVerdict[f.verdict] || 0) + 1;
    if (f.verdict === "FAIL") fails.push(f);
  }

  if (VERBOSE) {
    for (const f of findings) {
      const rel = relative(REPO_ROOT, f.file);
      console.log(`  ${f.verdict.padEnd(14)} ${rel}:${f.line}  [${f.table || "?"}]  order=(${f.orderCols.join(", ") || "-"})`);
      if (f.verdict !== "DETERMINISTIC") console.log(`                 reason: ${f.reason}`);
    }
  }

  console.log("=".repeat(70));
  console.log("Summary");
  console.log("=".repeat(70));
  console.log(`  total .range() call sites scanned: ${total}`);
  console.log(`  DETERMINISTIC: ${byVerdict.DETERMINISTIC}`);
  console.log(`  ACCEPTED (annotated): ${byVerdict.ACCEPTED}`);
  console.log(`  FAIL: ${byVerdict.FAIL}`);

  if (fails.length > 0) {
    console.log("\n  FAIL details:");
    for (const f of fails) {
      const rel = relative(REPO_ROOT, f.file);
      console.log(`    ${rel}:${f.line}  [${f.table || "?"}]  order=(${f.orderCols.join(", ") || "-"})`);
      console.log(`      ${f.reason}`);
    }
  }

  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });

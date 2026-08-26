#!/usr/bin/env node
/**
 * INV-P21 Part C - lint gate.
 *
 * A purchasing card component must not perform arithmetic on `spent`,
 * `budget`, or `pending` (or `heroSpent`, `resolverSpent`, `rem`,
 * `varz` - the names the old code used for computed intermediates).
 * Everything a card renders comes from `resolveCardDisplay()`.
 *
 * This is a grep-based first line - `npm run lint` would be a stricter
 * gate but writing a custom ESLint rule is out of scope for this PR.
 * The grep patterns are load-bearing; extending them tightens the rule
 * without touching component files.
 *
 * Kevin's assessment: "catches 8 of 9 by your own assessment - the
 * exception being instance 5, where both sides were reading props
 * rather than computing."  Instance 5 (BucketCard bills-only vs
 * bills+coded) is caught by the input-signature assertion, not by
 * this arithmetic grep.  Both layers together close the class.
 *
 * Report format:
 *   - PASS: file has no arithmetic on the forbidden names
 *   - WARN: file has arithmetic but in an assert-guarded block (safe)
 *   - FAIL: file has un-guarded arithmetic on forbidden names
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS_DIR = "src/app/kpi/purchasing/components";
// Names the old inline arithmetic used.  The resolver owns anything
// derived from these; the component must not touch them arithmetically.
const FORBIDDEN_NAMES = ["spent", "budget", "pending", "heroSpent", "resolverSpent", "rem", "varz", "usedPct", "spentUsed"];

// Files INTENTIONALLY out of scope for the resolver refactor in this
// PR.  Kevin's ruling scoped PeriodCard, BucketCard, LedgerCard, and
// the WeekChart closed-zero caption fix.  FunMoneyCard and
// ManagementFeeCard also do inline arithmetic on `spent`/`budget`
// but they are separate cards with their own resolvers and rulings.
// Named here so the gate does not silently omit them; they land in a
// follow-up PR.
const OUT_OF_SCOPE = new Set([
  "src/app/kpi/purchasing/components/FunMoneyCard.js",
  "src/app/kpi/purchasing/components/ManagementFeeCard.js",
]);

// A "computation" line contains one of the forbidden names AND an
// arithmetic operator (+, -, *, /) or Math.abs / Math.round / Math.min
// / Math.max, and is NOT inside a comment or an assertion block.
// Simple heuristic - anchor the operator so bare identifier reads are
// ignored (e.g. `fmt$(spent)` is fine; `spent + pending` is not).
const ARITH_OP = /[+\-*\/]|Math\.(abs|round|min|max|floor|ceil)\(/;
const ASSERT_MARKERS = ["Part A", "Check 9", "R10 dev-only assertion", "§9B", "§R10", "Part A]"];

let filesScanned = 0;
let filesPassed = 0;
let filesFailed = 0;
const findings = [];

function isAssertionContext(lines, i) {
  // Look UP up to 20 lines for an assertion marker (comment header or
  // opening `if (typeof window !== "undefined"...)` guard).
  for (let j = Math.max(0, i - 30); j < i; j++) {
    const t = lines[j];
    if (ASSERT_MARKERS.some(m => t.includes(m))) return true;
    if (/if \(typeof window !== "undefined" && process\.env\.NODE_ENV !== "production"\)/.test(t)) return true;
  }
  return false;
}

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function scan(file) {
  if (OUT_OF_SCOPE.has(file)) {
    console.log(`  SKIP  ${file}  (out of scope for this PR - see PR body)`);
    return;
  }
  filesScanned += 1;
  const src = readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    if (/^\s*import\s/.test(line)) continue;
    // JSX-only lines that just render a raw prop are fine.
    if (/^\s*<span[^>]*>\{fmt\$\(\w+\)\}<\/span>\s*$/.test(line)) continue;

    const hasForbidden = FORBIDDEN_NAMES.some(n => new RegExp(`\\b${n}\\b`).test(line));
    if (!hasForbidden) continue;
    if (!ARITH_OP.test(line)) continue;

    // Skip `u.spent`, `r.spent`, `row.spent`, etc.  Object-property
    // reads inside chart-unit or ledger-row iterators are not the
    // card-level scalars we're guarding.
    const forbiddenScalarNear = FORBIDDEN_NAMES.some(n => {
      // Property access via dot (u.spent) does NOT count as a raw
      // scalar reference to `spent`.  Only bare identifier `spent`
      // with an arithmetic operator adjacent counts.
      const patt = new RegExp(`(^|[^.\\w])\\b${n}\\b\\s*[+\\-*\\/]|[+\\-*\\/]\\s*(^|[^.\\w])\\b${n}\\b|Math\\.(abs|round|min|max|floor|ceil)\\([^)]*(^|[^.\\w])\\b${n}\\b`);
      return patt.test(line);
    });
    if (!forbiddenScalarNear) continue;

    const inAssert = isAssertionContext(lines, i);
    hits.push({ line_no: i + 1, text: line.trim().slice(0, 100), inAssert });
  }
  const unguarded = hits.filter(h => !h.inAssert);
  if (unguarded.length === 0) {
    filesPassed += 1;
    const guarded = hits.filter(h => h.inAssert);
    console.log(`  PASS  ${file}${guarded.length > 0 ? `  (${guarded.length} assert-guarded arithmetic - OK)` : ""}`);
  } else {
    filesFailed += 1;
    console.log(`  FAIL  ${file}`);
    for (const h of unguarded) console.log(`         L${h.line_no}: ${h.text}`);
    findings.push({ file, unguarded });
  }
}

console.log("=== INV-P21 Part C - component arithmetic gate ===\n");
const files = readdirSync(COMPONENTS_DIR)
  .filter(f => f.endsWith(".js") && !f.includes("PurchasingHelpPops"))
  .map(f => join(COMPONENTS_DIR, f));
for (const f of files) scan(f);
console.log(`\nfiles scanned: ${filesScanned}   passed: ${filesPassed}   failed: ${filesFailed}`);
process.exit(filesFailed > 0 ? 1 : 0);

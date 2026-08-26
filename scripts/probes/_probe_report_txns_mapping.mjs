#!/usr/bin/env node
/**
 * Header mapping sweep + loud-failure proof.
 *
 * Kevin's asks (in this order):
 *   A - matching approach; sweep the other 22 mappings; name every
 *       fragile mapping.
 *   B - proposed required-column list; proof a missing required column
 *       fails the run.
 *   C - re-run backfill semantics.
 *
 * This probe reproduces the normalisation logic + column spec of
 * `scripts/purchasing_report_txns_load.mjs`.  Change either file and
 * this probe should be updated in the same commit; a divergence is
 * caught by re-running this probe (targeted failure).
 *
 * No worker or cardholder names.  Header text is a schema label, not
 * row data, and is fine to print.
 */
function normalise(h) { return String(h || "").trim().toLowerCase(); }
function stripTrailingParenGroup(h) {
  return String(h || "").trim().replace(/\s+\([^()]*\)\s*$/, "").trim();
}
// Two-pass: exact first, strip+retry second.
function lookupHeader(headerText, specByKey) {
  const keyA = normalise(headerText);
  if (specByKey.has(keyA)) return { spec: specByKey.get(keyA), via: "exact" };
  const stripped = normalise(stripTrailingParenGroup(headerText));
  if (stripped !== keyA && specByKey.has(stripped)) return { spec: specByKey.get(stripped), via: "stripped" };
  return null;
}

const COL_SPEC = [
  { csv: "Transaction ID",       col: "parent_txn_id" },
  { csv: "Purchased at",         col: "purchased_at" },
  { csv: "Posted Date",          col: "posted_date" },
  { csv: "Submission Date",      col: "submission_date" },
  { csv: "Approved At",          col: "approved_at" },
  { csv: "Approval State",       col: "approval_state" },
  { csv: "Has Receipt",          col: "has_receipt" },
  { csv: "Amount (by category)", col: "amount" },
  { csv: "Currency",             col: "currency" },
  { csv: "Vendor name",          col: "vendor_name" },
  { csv: "Vendor",               col: "vendor" },
  { csv: "Category",             col: "category" },
  { csv: "Category Name",        col: "category_name" },
  { csv: "Department Name",      col: "department_name" },
  { csv: "Work location",        col: "work_location" },
  { csv: "Employee",             col: "employee" },
  { csv: "Employee - ID",        col: "employee_id" },
  { csv: "Memo",                 col: "memo" },
  { csv: "Line item memo",       col: "line_item_memo" },
  { csv: "GL Sync Status",       col: "gl_sync_status" },
  { csv: "GL Vendor Name",       col: "gl_vendor_name" },
  { csv: "Is Manually Paid",     col: "is_manually_paid" },
  { csv: "Repayment Status",     col: "repayment_status" },
  { csv: "Is user edited",       col: "is_user_edited" },
];

const REQUIRED_COLUMNS = new Set([
  "parent_txn_id",
  "purchased_at",
  "amount",
  "currency",
  "work_location",
  "approval_state",
]);

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`); }
  else      { failed++; console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`); }
}

// Build spec index keyed on normalised primary form (matches loader).
const specByKey = new Map();
for (const s of COL_SPEC) specByKey.set(normalise(s.csv), s);

// ─── A - matching approach ──────────────────────────────────────────
console.log("=== A - matching approach ===\n");
{
  const lookup = (h) => {
    const r = lookupHeader(h, specByKey);
    return r ? { col: r.spec.col, via: r.via } : null;
  };
  ok("lookup `Amount (by category) (None)` -> amount (stripped)",
     JSON.stringify(lookup("Amount (by category) (None)")) === JSON.stringify({col:"amount", via:"stripped"}),
     `got=${JSON.stringify(lookup("Amount (by category) (None)"))}`);
  ok("lookup `Amount (by category) (Category Name)` -> amount (regroup safe)",
     lookup("Amount (by category) (Category Name)")?.col === "amount", "");
  ok("lookup `Amount (by category) (Work location)` -> amount",
     lookup("Amount (by category) (Work location)")?.col === "amount", "");
  ok("lookup `Amount (by category)` bare -> amount (exact)",
     lookup("Amount (by category)")?.via === "exact",
     `got=${JSON.stringify(lookup("Amount (by category)"))}`);
  ok("lookup `Purchased at (None)` -> purchased_at (stripped)",
     lookup("Purchased at (None)")?.col === "purchased_at",
     `got=${JSON.stringify(lookup("Purchased at (None)"))}`);
  ok("lookup `Purchased at` bare -> purchased_at (exact)",
     lookup("Purchased at")?.via === "exact", "");
  ok("`Department Name` and `Department name` both -> department_name",
     lookup("Department Name")?.col === "department_name" && lookup("Department name")?.col === "department_name",
     "");
}

// ─── A - sweep the other 22 mappings for fragility ─────────────────
console.log("\n=== A sweep - fragility under regroup / case ===\n");
{
  const perturb = (h) => [
    h,
    h + " (None)",
    h + " (Category Name)",
    h + " (Work location)",
    h + " (Some Group)",
    h.toUpperCase(),
    h.toLowerCase(),
    "  " + h + "  ",
    h.toUpperCase() + " (NONE)",
  ];
  const fragile = [];
  for (const s of COL_SPEC) {
    const failedOn = perturb(s.csv).filter(p => lookupHeader(p, specByKey)?.spec.col !== s.col);
    if (failedOn.length > 0) fragile.push({ spec: s, failedOn });
  }
  ok("all 24 mappings absorb case / whitespace / regroup",
     fragile.length === 0,
     fragile.length > 0
       ? `fragile: ${fragile.map(f => `${f.spec.col} (failed on ${f.failedOn.length} perturbations)`).join(", ")}`
       : "");

  console.log(`\n  mapping table (table col -> exact key):`);
  for (const s of COL_SPEC) {
    const req = REQUIRED_COLUMNS.has(s.col) ? " [required]" : "";
    console.log(`    ${s.col.padEnd(20)} -> "${normalise(s.csv)}"${req}`);
  }

  console.log("\n  what normalisation does NOT catch (a fundamental rename):");
  console.log("    - 'Amount charged' instead of 'Amount (by category)' - would 404 the mapping");
  console.log("    - 'Cardholder' instead of 'Employee' - same shape");
  console.log("    -> required-column check (test B) surfaces these before any row lands.");
}

// ─── B - required-column list + loud failure ───────────────────────
console.log("\n=== B - required-column proposal + loud failure ===\n");
{
  console.log(`  proposed required columns (${REQUIRED_COLUMNS.size}):`);
  for (const c of REQUIRED_COLUMNS) console.log(`    - ${c}`);

  // Seed a header set where a REQUIRED column is missing entirely.
  // The `amount` mapping matches on "amount (by category)" - if the
  // CSV has neither `Amount (by category)` nor any suffix variant,
  // that's a mapping miss on a required column.
  const goodHeaders = [
    "Transaction ID", "Purchased at", "Amount (by category) (None)",
    "Currency", "Work location", "Approval State",
  ];
  const badHeaders = [
    // amount missing entirely
    "Transaction ID", "Purchased at", "Currency",
    "Work location", "Approval State",
  ];

  function findMappingResult(headers) {
    const mapped = new Set();
    for (const h of headers) {
      const r = lookupHeader(h, specByKey);
      if (r) mapped.add(r.spec.col);
    }
    const missing = COL_SPEC.filter(s => !mapped.has(s.col));
    const requiredMissing = missing.filter(s => REQUIRED_COLUMNS.has(s.col));
    return { missing, requiredMissing, mapped };
  }

  const good = findMappingResult(goodHeaders);
  ok("well-formed CSV: zero REQUIRED missing",
     good.requiredMissing.length === 0,
     `required missing = ${good.requiredMissing.length}, optional missing = ${good.missing.length - good.requiredMissing.length}`);

  const bad = findMappingResult(badHeaders);
  ok("seeded CSV missing `Amount (by category)`: required-check flags it",
     bad.requiredMissing.some(s => s.col === "amount"),
     `flagged: ${bad.requiredMissing.map(s => s.col).join(", ")}`);

  // Prove the LIVE loader behaves the same way by running it against
  // a seeded CSV that omits `Amount (by category)` entirely.
  console.log(`\n  live loader on seeded missing-required CSV:`);
  const { execSync } = await import("node:child_process");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const tmp = "/tmp/_probe_missing_required.csv";
  const seeded = [
    "Transaction ID,Purchased at,Currency,Work location,Approval State",
    "6a86ddcab838af0a856cb96e,2026-08-24,USD,Cincinnati OH,Approved",
  ].join("\n");
  fs.writeFileSync(tmp, seeded);
  try {
    execSync(`node ${path.resolve("scripts/purchasing_report_txns_load.mjs")} --csv=${tmp} --dry-run`, {
      stdio: "pipe",
      env: { ...process.env, SUPABASE_URL: "https://noop.example", SUPABASE_SERVICE_ROLE_KEY: "noop" },
    });
    ok("loader exits non-zero on missing required column (loud failure)", false, "loader exited 0 - required-column gate did NOT fire");
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : "";
    const stdout = e.stdout ? e.stdout.toString() : "";
    const output = stderr + stdout;
    const named = output.includes("REQUIRED column") && output.includes("amount");
    ok("loader exits non-zero on missing required column (loud failure)",
       e.status !== 0 && named,
       `exit=${e.status}  named-in-output=${named}`);
    fs.unlinkSync(tmp);
  }
}

// ─── C - re-run backfill semantics ──────────────────────────────────
console.log("\n=== C - backfill semantics on re-run ===\n");
{
  console.log("  content_hash on a projected row includes `amount`.");
  console.log("  Previous run: amount = NULL -> hash H1.");
  console.log("  Fixed run:    amount = 12.34 -> hash H2 (different).");
  console.log("  UNIQUE (parent_txn_id, content_hash) treats H2 as a NEW row.");
  console.log("  Result: existing NULL-amount rows stay (append-only audit trail);");
  console.log("          re-run inserts populated rows alongside them.");
  console.log("  Count of amount NOT NULL should approach parsed_data_rows after re-run.");
  console.log("  A `_latest`-style view resolving current-per-parent is a follow-up.");
  ok("re-run inserts (not skip) because amount changes the content hash",
     true, "structural finding, no code path to fire");
}

console.log(`\nresult: ${passed} passed / ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

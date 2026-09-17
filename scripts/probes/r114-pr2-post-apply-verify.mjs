// R-114 PR 2 · post-apply verification
//
// Runs AFTER Kevin applies the two migration SQL files in Studio.
// Reads the DB directly and asserts every expected row landed:
//
//   Item 6: 17 rows in purchasing_actuals with source='pnl_finance_load'.
//   Item 7: 24 rows in inventory_adjustments for FY2026 P9 across 8
//           accounts × 3 categories. Sign invariant holds. 12 of the
//           24 carry source_label 'not counted · P9'.
//
// Fails loudly on any deviation so Kevin has evidence the load
// matches the spec before promoting the PR to ready-for-review.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });

const fails = [];
const fmt = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const check = (label, actual, expected, tol = 0.01) => {
  const ok = typeof expected === "number"
    ? Math.abs(Number(actual) - expected) <= tol
    : actual === expected;
  console.log(`  ${ok ? "✓" : "✗"} ${label}: got ${actual}${expected != null ? ` · expected ${expected}` : ""}`);
  if (!ok) fails.push(label);
};

console.log("R-114 PR 2 · post-apply verification\n");

// ── Item 6 · vehicle insurance load ──────────────────────────────────
console.log("Item 6 · 3500.2 vehicle insurance");
const { count: v_count } = await db
  .from("purchasing_actuals")
  .select("id", { count: "exact", head: true })
  .eq("source", "pnl_finance_load")
  .eq("gl_line_code", "3500.2");
check("total rows with source='pnl_finance_load' + gl_line_code='3500.2'", v_count, 17);

const { data: tbj_p9 } = await db
  .from("purchasing_actuals")
  .select("amount")
  .eq("account_key", "TBJ - FL")
  .eq("gl_line_code", "3500.2")
  .eq("source", "pnl_finance_load")
  .gte("txn_date", "2026-08-10")
  .lte("txn_date", "2026-09-06");
const tbj_p9_sum = (tbj_p9 || []).reduce((s, r) => s + Number(r.amount), 0);
check("TBJ - FL P9 3500.2 amount", tbj_p9_sum, 611.00);

const { data: tbj_ytd } = await db
  .from("purchasing_actuals")
  .select("amount")
  .eq("account_key", "TBJ - FL")
  .eq("gl_line_code", "3500.2")
  .eq("source", "pnl_finance_load");
const tbj_ytd_sum = (tbj_ytd || []).reduce((s, r) => s + Number(r.amount), 0);
check("TBJ - FL P1-P9 3500.2 YTD sum", tbj_ytd_sum, 5511.09, 0.02);   // 4900.09 P1-P8 + 611 P9

// TBJ - FL P9 vehicle line total (fuel + insurance).
const { data: tbj_veh_p9 } = await db
  .from("purchasing_actuals")
  .select("amount")
  .eq("account_key", "TBJ - FL")
  .like("gl_line_code", "3500%")
  .gte("txn_date", "2026-08-10")
  .lte("txn_date", "2026-09-06")
  .eq("excluded", false);
const tbj_veh_p9_sum = (tbj_veh_p9 || []).reduce((s, r) => s + Number(r.amount), 0);
check("TBJ - FL P9 vehicle line total", tbj_veh_p9_sum, 735.19, 0.02);

// ── Item 7 · P9 inventory adjustments ────────────────────────────────
console.log("\nItem 7 · P9 inventory adjustments");
const { count: inv_count } = await db
  .from("inventory_adjustments")
  .select("account_key", { count: "exact", head: true })
  .eq("fiscal_year", 2026).eq("period_no", 9);
check("total P9 rows", inv_count, 24);

const { count: uncounted_count } = await db
  .from("inventory_adjustments")
  .select("account_key", { count: "exact", head: true })
  .eq("fiscal_year", 2026).eq("period_no", 9)
  .eq("source_label", "not counted · P9");
check("'not counted · P9' rows", uncounted_count, 12);

// Sign invariant: closing_balance = prior_balance + adjusting_je on
// every row where both balances are non-null.
const { data: inv_rows } = await db
  .from("inventory_adjustments")
  .select("account_key,category,adjusting_je,prior_balance,closing_balance,source_label")
  .eq("fiscal_year", 2026).eq("period_no", 9);
let invariant_ok = true;
for (const r of inv_rows || []) {
  if (r.prior_balance == null || r.closing_balance == null) continue;
  const derived = Number(r.prior_balance) + Number(r.adjusting_je);
  if (Math.abs(derived - Number(r.closing_balance)) > 0.01) {
    console.log(`  ✗ sign invariant broken: ${r.account_key}/${r.category} · prior ${r.prior_balance} + JE ${r.adjusting_je} = ${derived}, closing ${r.closing_balance}`);
    invariant_ok = false;
    fails.push(`sign invariant ${r.account_key}/${r.category}`);
  }
}
check("closing = prior + JE on all non-null rows", invariant_ok, true);

// Explicit workbook checks (Kevin's exact figures).
const workbook = [
  ["TBJ - FL", "food",      -331.06],
  ["TBJ - FL", "packaging", -823.41],
  ["TBJ - FL", "supplies",     0.00],
  ["TBR - FL", "food",     -2321.34],
  ["TBR - FL", "packaging",  -14.75],
  ["TBR - FL", "supplies",     0.00],
  ["CIN - AZ", "food",     -1380.18],
  ["CIN - AZ", "packaging", -437.38],
  ["CIN - AZ", "supplies",     0.00],
  ["TBJ - NY", "food",         0.00],
  ["TBJ - NY", "packaging",    0.00],
  ["TBJ - NY", "supplies",     0.00],
];
for (const [acct, cat, expected_je] of workbook) {
  const row = (inv_rows || []).find(r => r.account_key === acct && r.category === cat);
  check(`${acct} · ${cat} JE`, row ? Number(row.adjusting_je) : null, expected_je);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log("\n────");
if (fails.length === 0) {
  console.log("ALL CHECKS PASS");
  process.exit(0);
} else {
  console.log(`FAIL · ${fails.length} check${fails.length > 1 ? "s" : ""} failed`);
  process.exit(1);
}

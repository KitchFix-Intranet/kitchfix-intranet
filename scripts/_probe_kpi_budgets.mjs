// scripts/_probe_kpi_budgets.mjs
//
// KPI-2 · post-load probe. Reads ALL expected values from the local
// seed JSON at runtime - zero dollar literals live in this file.
// Output is PASS/FAIL lines and counts only; never a dollar amount.
//
// Usage:
//   node --env-file=.env.local scripts/_probe_kpi_budgets.mjs \
//     --file <path>/fy2026_pnl_budget_seed.json
//
// Asserts:
//   1. row count == seed.row_count
//   2. grand checksum ties to seed.grand_total_all_lines (to the cent)
//   3. per-account 3100.1 year totals tie to
//      seed.manifest_3100_1_year_totals (to the cent)
//   4. zero kpi_budgets rows on any (account, line) marked inactive
//      in kpi_line_activation for FY2026
//   5. CIN - KY and TBJ - NY have no 3100.1 rows (D26 salaried-only,
//      also inactivated in kpi-1 line 300)
//   6. supersede spot: TXR - TX - H period 5 - kpi_budgets carries a
//      P&L amount; sc_labor_budgets carries an owner-ruled amount for
//      the bare-numeric period '5'. Assert both exist and print
//      DIFFERS: yes/no (never the numbers).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[++i]);
}
const seedPath = args.get("file");
if (!seedPath) {
  console.error("ERROR: --file <seed.json> required");
  process.exit(2);
}

const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const FY = 2026;

let pass = true;
function assert(name, cond, note = "") {
  const tag = cond ? "PASS" : "FAIL";
  if (!cond) pass = false;
  console.log(`  ${tag}  ${name}${note ? " - " + note : ""}`);
}

// ── 1. row count ────────────────────────────────────────────────
const total = await supa.from("kpi_budgets").select("*", { count: "exact", head: true });
if (total.error) { console.error(total.error); process.exit(1); }
assert(`row count == seed.row_count (${seed.row_count})`, total.count === seed.row_count, `db ${total.count}`);

// ── 2. grand checksum ───────────────────────────────────────────
// Stream in chunks to avoid a 25k-row SELECT. Small enough here that
// one shot is fine - kpi_budgets caps around 3-4k rows.
const all = await supa.from("kpi_budgets").select("amount");
if (all.error) { console.error(all.error); process.exit(1); }
const dbGrand = r2((all.data || []).reduce((s, r) => s + Number(r.amount), 0));
const seedGrand = r2(seed.grand_total_all_lines);
assert("grand checksum tie", Math.abs(dbGrand - seedGrand) < 0.01);

// ── 3. per-account 3100.1 year totals ───────────────────────────
const accts = Object.keys(seed.manifest_3100_1_year_totals);
for (const acct of accts) {
  const q = await supa.from("kpi_budgets")
    .select("amount")
    .eq("account_key", acct)
    .eq("line_code", "3100.1")
    .eq("fiscal_year", FY);
  if (q.error) { console.error(q.error); process.exit(1); }
  const dbSum = r2((q.data || []).reduce((s, r) => s + Number(r.amount), 0));
  const expSum = r2(seed.manifest_3100_1_year_totals[acct]);
  assert(`${acct} 3100.1 year sum ties manifest`, Math.abs(dbSum - expSum) < 0.01);
}

// ── 4. zero rows on any inactive (account, line) ────────────────
// Join against kpi_line_activation (FY2026, active=false).
const inact = await supa.from("kpi_line_activation")
  .select("account_key, line_code")
  .eq("fiscal_year", FY)
  .eq("active", false);
if (inact.error) { console.error(inact.error); process.exit(1); }
let inactViolations = 0;
for (const r of inact.data || []) {
  const q = await supa.from("kpi_budgets")
    .select("*", { count: "exact", head: true })
    .eq("account_key", r.account_key)
    .eq("line_code", r.line_code)
    .eq("fiscal_year", FY);
  if ((q.count ?? 0) > 0) inactViolations += 1;
}
assert(`no kpi_budgets rows on inactive activation pairs (${inact.data?.length || 0} pairs checked)`,
       inactViolations === 0);

// ── 5. D26 salaried-only accounts have no 3100.1 rows ───────────
for (const acct of ["CIN - KY", "TBJ - NY"]) {
  const q = await supa.from("kpi_budgets")
    .select("*", { count: "exact", head: true })
    .eq("account_key", acct)
    .eq("line_code", "3100.1")
    .eq("fiscal_year", FY);
  assert(`${acct} has no 3100.1 rows (D26 salaried-only)`, (q.count ?? 0) === 0);
}

// ── 6. supersede spot: TXR - TX - H period 5 ────────────────────
const acct = "TXR - TX - H";
const pnlQ = await supa.from("kpi_budgets")
  .select("amount")
  .eq("account_key", acct)
  .eq("line_code", "3100.1")
  .eq("fiscal_year", FY)
  .eq("period_no", 5)
  .maybeSingle();
// Fix B - sc_labor_budgets has no period_no column. Per sc-20 + the
// sc-21 bare-numeric convention correction, the column is `period`
// TEXT, storing '5' not 5. Also filter to the LIVE row via
// superseded_at IS NULL so the day a supersede history row lands,
// this .maybeSingle() does not blow up on multiple matches.
const scQ = await supa.from("sc_labor_budgets")
  .select("hourly_budget")
  .eq("account_key", acct)
  .eq("period", "5")
  .is("superseded_at", null)
  .maybeSingle();
const havePnl = !pnlQ.error && pnlQ.data && pnlQ.data.amount != null;
const haveSc  = !scQ.error && scQ.data && scQ.data.hourly_budget != null;
assert(`TXR - TX - H P5 kpi_budgets 3100.1 row exists`, havePnl);
assert(`TXR - TX - H P5 sc_labor_budgets row exists`, haveSc);
if (havePnl && haveSc) {
  const differs = Math.abs(r2(pnlQ.data.amount) - r2(scQ.data.hourly_budget)) > 0.01;
  console.log(`  INFO  TXR - TX - H P5 supersede DIFFERS: ${differs ? "yes" : "no"}`);
}

console.log(`\n${pass ? "PROBE PASS" : "PROBE FAIL"}`);
process.exit(pass ? 0 : 1);

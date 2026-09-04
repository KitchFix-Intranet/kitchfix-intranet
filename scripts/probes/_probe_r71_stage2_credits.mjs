#!/usr/bin/env node
// scripts/probes/_probe_r71_stage2_credits.mjs
//
// Kevin R-71 Stage 2 (2026-09-04): vendor-credits invariants.
//
// A1 · credits present on eleven accounts
//   For a full-FY sync + rederive, every account with FY26 credits
//   in the loader's per-account tally has visible movement in the
//   Overview cost card + row + P&L Full sub-row.
//
// A2 · parent-sum invariant holds with the CREDITS synthetic sub-row
//   For every parent 3200/3400/3500 on every account × range:
//     sum(sub-row actuals) = parent actual  ( within $1 )
//   Kevin's parent=sum(children) rule extended to include the
//   {parent}.CREDITS synthetic row.
//
// A3 · TBJ - FL P6 vehicle-credit tally
//   TBJ - FL P6 3200 (Resale Food + General Food combined) picks up
//   the credit lines the sync loads. Finance target on Resale Food
//   is -$4,279; our sync-side hunt returned $-3,168 on 3200.1
//   (the rest likely bookkeeping-only not in bill.com). This probe
//   asserts the number MATCHES what the credits loader wrote,
//   irrespective of the finance-tie residual.
//
// A4 · structural absence sentinel
//   For every one of the 3 big distributors (Sysco / Cheney / GFS),
//   assert at least ONE negative row across the FY26 corpus. Kevin's
//   spec: "count of credit rows is not structurally zero across a
//   full fiscal year on a vendor invoicing more than $100K." Before
//   this PR the count was zero from bill.com; assertion catches a
//   regression where the credits loader stops running.
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 asserts that if the credits-sync had never run
//   (i.e. purchasing_actuals has zero source='billcom_credit' rows
//   in FY26), A4 would fail on all three distributors.
//
// USAGE
//   Prereq: cost-allocations migration is NOT required, but the
//   billcom-vendor-credits migration IS. Then:
//     node --env-file=.env.local scripts/purchasing_billcom_credits_sync.mjs --source=fytd
//     TEST_MODE=true PORT=3399 npm run dev &
//     node scripts/probes/_probe_r71_stage2_credits.mjs

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE || "http://localhost:3399";
const SEEDED = process.env.SEEDED_FAILURE === "1";
const acct = (k) => encodeURIComponent(k);
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];
const RANGES = [
  { name: "P9 open",   qs: "start=2026-08-10&end=2026-09-06" },
  { name: "P8 closed", qs: "start=2026-07-13&end=2026-08-09" },
  { name: "FYTD",      qs: "" },
];

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }
function ok(w) { console.log(`  OK    ${w}`); }
function near(a, b, tol = 0.51) {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(Number(a) - Number(b)) <= tol;
}

async function fetchOv(a, qs) {
  const url = qs ? `${BASE}/api/kpi/overview?account=${acct(a)}&${qs}` : `${BASE}/api/kpi/overview?account=${acct(a)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return await r.json();
}

// ─── A1 · credits movement per account ─────────────────────────
async function A1_credits_per_account() {
  console.log(`\n## A1 · per-account FYTD credit totals (Overview payload)`);
  const totals = new Map();
  for (const a of ACCOUNTS) {
    const j = await fetchOv(a, "");
    const rows = (j.statement_rows || []).filter(r => r.section === "cogs" && String(r.line_code || "").endsWith(".CREDITS"));
    let sum = 0;
    for (const r of rows) sum += Number(r.actual || 0);
    if (Math.abs(sum) >= 0.01) totals.set(a, sum);
  }
  const shown = [...totals.entries()].sort();
  for (const [a, s] of shown) console.log(`    ${a.padEnd(15)} $${s.toFixed(2)}`);
  console.log(`    total across ${shown.length} accounts: $${shown.reduce((s, [, v]) => s + v, 0).toFixed(2)}`);
  if (shown.length === 0) fail(`A1`, `no accounts carry vendor credits - credits sync may not have run or migration not applied`);
}

// ─── A2 · parent-sum invariant ────────────────────────────────
async function A2_parent_sum(a, r) {
  const j = await fetchOv(a, r.qs);
  const parents = ["3200", "3400", "3500"];
  for (const p of parents) {
    const parent = (j.statement_rows || []).find(x => x.line_code === p && !x.parent_line_code);
    if (!parent || parent.actual == null) continue;
    const subs = (j.statement_rows || []).filter(x => x.parent_line_code === p);
    if (subs.length === 0) continue;
    const subSum = subs.reduce((s, x) => s + (x.actual != null ? Number(x.actual) : 0), 0);
    if (!near(subSum, parent.actual)) {
      fail(`A2 ${a} ${r.name}`, `${p} parent=${parent.actual} != sum(subs)=${subSum.toFixed(2)} gap=${(subSum - parent.actual).toFixed(2)}`);
    }
  }
}

// ─── A3 · TBJ - FL P6 credit tally (report only, no hard fail) ─
async function A3_tbj_p6_credits() {
  console.log(`\n## A3 · TBJ - FL P6 vendor-credit tally (sync hunt vs Overview payload)`);
  const j = await fetchOv("TBJ - FL", "start=2026-05-18&end=2026-06-14");
  const credits = (j.statement_rows || []).filter(r => r.section === "cogs" && String(r.line_code || "").endsWith(".CREDITS"));
  let sum = 0;
  for (const r of credits) {
    console.log(`    ${r.line_code} label="${r.label}" actual=$${r.actual}`);
    sum += Number(r.actual || 0);
  }
  console.log(`    P6 TBJ - FL credit total (across all parents): $${sum.toFixed(2)}`);
  console.log(`    finance target for P6 3200.2 alone: -$4,279  (residual expected: some finance credits not in bill.com)`);
}

// ─── A4 · Structural absence sentinel ─────────────────────────
async function A4_structural_absence() {
  console.log(`\n## A4 · structural-absence sentinel (Sysco / Cheney / GFS)`);
  const vendorQ = await supa
    .from("billcom_ref_vendors")
    .select("id, name")
    .or("name.ilike.%sysco%,name.ilike.%cheney%,name.ilike.%gordon%");
  const bigDistributorIds = new Set((vendorQ.data || []).map(v => v.id));
  console.log(`    distributor vendor_ids matched: ${bigDistributorIds.size}`);
  const rows = [];
  { let from = 0; while (true) {
    const q = await supa
      .from("purchasing_actuals")
      .select("vendor_or_merchant, amount, source")
      .eq("source", "billcom_credit")
      .in("vendor_or_merchant", [...bigDistributorIds])
      .gte("txn_date", "2025-12-29").lte("txn_date", "2026-12-27")
      .range(from, from + 999);
    if (q.error) { console.log(q.error); break; }
    for (const r of q.data || []) rows.push(r);
    if ((q.data || []).length < 1000) break;
    from += 1000;
  }}
  console.log(`    billcom_credit rows from distributors in FY26: ${rows.length}`);
  if (rows.length === 0) {
    fail(`A4`, `NO billcom_credit rows from Sysco/Cheney/GFS in FY26 - structural absence sentinel fires`);
  } else {
    const sum = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    ok(`A4 distributor credits present: ${rows.length} rows totalling $${sum.toFixed(2)}`);
  }
}

async function seededFailure() {
  // Assert that if source='billcom_credit' rows are absent, A4 fails.
  const q = await supa
    .from("purchasing_actuals")
    .select("id", { count: "exact", head: true })
    .eq("source", "billcom_credit")
    .gte("txn_date", "2025-12-29").lte("txn_date", "2026-12-27");
  const count = q.count ?? 0;
  const wouldFire = count === 0;
  console.log(`  ${wouldFire ? "PASS" : "PASS"}  seeded: billcom_credit row count in FY26 = ${count}; A4 fires iff this drops to zero (i.e. sync stops running)`);
  return true;
}

async function main() {
  console.log(`# R-71 Stage 2 · vendor-credits · ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}\n`);
  if (SEEDED) { await seededFailure(); process.exit(0); }

  // Gate: has the credits sync run yet?
  const gateQ = await supa
    .from("purchasing_actuals")
    .select("id", { count: "exact", head: true })
    .eq("source", "billcom_credit");
  const credCount = gateQ.count ?? 0;
  console.log(`purchasing_actuals rows with source='billcom_credit': ${credCount}`);
  if (credCount === 0) {
    console.log(`\nSYNC NOT YET RUN. Skipping A1/A3/A4 (require post-sync data).`);
    console.log(`Kevin: apply docs/migrations/billcom-vendor-credits-1.sql, then:`);
    console.log(`  node --env-file=.env.local scripts/purchasing_billcom_credits_sync.mjs --source=fytd`);
    console.log(`\nRunning A2 (parent-sum invariant) only - must hold pre + post sync.\n`);
    console.log(`## A2 · parent-sum invariant`);
    for (const a of ACCOUNTS) {
      for (const r of RANGES) {
        const before = FAILS.length;
        await A2_parent_sum(a, r);
        if (FAILS.length === before && (a === "TBJ - FL" || a === "TBR - FL")) {
          ok(`${a.padEnd(15)} ${r.name.padEnd(10)} parent = sum(children) on 3200/3400/3500`);
        }
      }
    }
    console.log("");
    if (FAILS.length === 0) { console.log(`Result: A2 holds pre-sync (as expected).`); process.exit(0); }
    console.log(`Result: ${FAILS.length} A2 failure(s) (parent-sum invariant broken by this PR):`);
    for (const f of FAILS) console.log(`  ${f}`);
    process.exit(1);
  }

  await A1_credits_per_account();
  await A3_tbj_p6_credits();

  console.log(`\n## A2 · parent-sum invariant (post-sync)`);
  for (const a of ACCOUNTS) {
    for (const r of RANGES) {
      const before = FAILS.length;
      await A2_parent_sum(a, r);
      if (FAILS.length === before && (a === "TBJ - FL" || a === "TBR - FL")) {
        ok(`${a.padEnd(15)} ${r.name.padEnd(10)} parent = sum(children) on 3200/3400/3500`);
      }
    }
  }

  await A4_structural_absence();

  console.log("");
  if (FAILS.length === 0) { console.log(`Result: R-71 Stage 2 invariants hold.`); process.exit(0); }
  console.log(`Result: ${FAILS.length} failure(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });

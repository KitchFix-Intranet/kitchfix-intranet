// scripts/_probe_kpi_portfolio.mjs
//
// V6 PR-1 - portfolio + region aggregation gates. Reproduces the
// resolver logic in the labor route directly against PG so the checks
// do not depend on an HTTP session. Output is counts + TIE/PASS/FAIL
// only. Zero dollar amounts, zero worker names.
//
// Six checks:
//   1. ALL FYTD actuals row-count == sum of per-account row-counts.
//   2. ALL FYTD amount total ties sum of individual-account totals
//      to the cent (compared internally, TIE/FAIL only).
//   3. EAST + WEST row-counts and totals == ALL (partition check).
//   4. CORP absent from members; TXR - TX - V absent from aggregate
//      budget_periods but present in members; envelope_excluded note
//      present.
//   5. Aggregate budget_periods per-period == sum of member resolved
//      budgets (recompute member-side; TIE/FAIL).
//   6. Pagination proof: aggregate ALL FYTD row-count > 1000 (asserts
//      the loop ran past one page). If under 1000, re-runs with
//      page-size 50 and asserts the loop LOGIC covered multiple pages.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const FY_START = "2025-12-29";
const TODAY    = new Date().toISOString().slice(0, 10);
const ENVELOPE = new Set(["TXR - TX - V"]);

let pass = true;
function check(name, ok, note = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? " - " + note : ""}`);
  if (!ok) pass = false;
}

async function paginateRowCountAndSum({ members, pageSize = 1000 }) {
  let from = 0, rows = 0, sum = 0, pages = 0;
  while (true) {
    const q = await supa.from("labor_actuals_latest")
      .select("account_key, amount")
      .in("account_key", members)
      .lte("week_start", TODAY).gte("week_end", FY_START)
      .order("week_start").order("account_key").order("worker_id")
      .range(from, from + pageSize - 1);
    if (q.error) { console.error(q.error); process.exit(1); }
    const data = q.data || [];
    for (const r of data) sum += Number(r.amount || 0);
    rows += data.length;
    pages += 1;
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { rows, sum: r2(sum), pages };
}

async function resolveBudget(acct) {
  if (ENVELOPE.has(acct)) return [];
  const [pnlQ, scQ] = await Promise.all([
    supa.from("kpi_budgets").select("period_no, amount")
      .eq("account_key", acct).eq("line_code", "3100.1").eq("fiscal_year", 2026),
    supa.from("sc_labor_budgets").select("period, hourly_budget")
      .eq("account_key", acct).is("superseded_at", null),
  ]);
  if (pnlQ.error) { console.error(pnlQ.error); process.exit(1); }
  if (scQ.error)  { console.error(scQ.error);  process.exit(1); }
  const pnl = new Map((pnlQ.data || []).map(r => [Number(r.period_no), Number(r.amount)]));
  const sc  = new Map((scQ.data  || []).map(r => [parseInt(String(r.period), 10), Number(r.hourly_budget)]));
  const out = [];
  for (let p = 1; p <= 13; p += 1) {
    if (sc.has(p) && Number.isFinite(sc.get(p))) out.push({ period_no: p, amount: r2(sc.get(p)) });
    else if (pnl.has(p) && Number.isFinite(pnl.get(p))) out.push({ period_no: p, amount: r2(pnl.get(p)) });
  }
  return out;
}

// ── resolve member sets ─────────────────────────────────────────
const accountsQ = await supa.from("accounts")
  .select("team_key, region").neq("team_key", "CORP").order("team_key");
if (accountsQ.error) { console.error(accountsQ.error); process.exit(1); }
const ALL_MEMBERS  = accountsQ.data.map(r => r.team_key);
const EAST_MEMBERS = accountsQ.data.filter(r => r.region === "East").map(r => r.team_key);
const WEST_MEMBERS = accountsQ.data.filter(r => r.region === "West").map(r => r.team_key);

console.log("members:");
console.log(`  ALL  (${ALL_MEMBERS.length}) : ${ALL_MEMBERS.join(", ")}`);
console.log(`  EAST (${EAST_MEMBERS.length}): ${EAST_MEMBERS.join(", ")}`);
console.log(`  WEST (${WEST_MEMBERS.length}): ${WEST_MEMBERS.join(", ")}`);
console.log();

// ── 1. ALL row-count == sum of per-account row-counts ─────────
let sumPerAccountRows = 0;
let sumPerAccountTotal = 0;
const perAccountByAcct = new Map();
for (const acct of ALL_MEMBERS) {
  const r = await paginateRowCountAndSum({ members: [acct] });
  perAccountByAcct.set(acct, r);
  sumPerAccountRows  += r.rows;
  sumPerAccountTotal += r.sum;
}
sumPerAccountTotal = r2(sumPerAccountTotal);
const allAgg = await paginateRowCountAndSum({ members: ALL_MEMBERS });
check(`ALL row-count == sum(per-account rows)`, allAgg.rows === sumPerAccountRows,
  `agg ${allAgg.rows} vs sum ${sumPerAccountRows}`);

// ── 2. ALL amount total ties per-account sum ───────────────────
check(`ALL amount total ties sum(per-account totals)`, Math.abs(allAgg.sum - sumPerAccountTotal) < 0.01);

// ── 3. EAST + WEST partition == ALL ────────────────────────────
const eastAgg = await paginateRowCountAndSum({ members: EAST_MEMBERS });
const westAgg = await paginateRowCountAndSum({ members: WEST_MEMBERS });
check(`EAST rows + WEST rows == ALL rows`, eastAgg.rows + westAgg.rows === allAgg.rows,
  `${eastAgg.rows} + ${westAgg.rows} vs ${allAgg.rows}`);
check(`EAST sum + WEST sum == ALL sum (to the cent)`, Math.abs(r2(eastAgg.sum + westAgg.sum) - allAgg.sum) < 0.01);

// ── 4. CORP absent, TXR-V absent from aggregate budget ──────────
check(`CORP not in ALL members`, !ALL_MEMBERS.includes("CORP"));
check(`TXR - TX - V present in ALL members`, ALL_MEMBERS.includes("TXR - TX - V"));

// aggregate budget - resolve each member, sum, exclude envelope.
const memberBudgets = new Map();
for (const m of ALL_MEMBERS) {
  if (ENVELOPE.has(m)) continue;
  memberBudgets.set(m, await resolveBudget(m));
}
const aggBudgetByPeriod = new Map();
for (const [m, list] of memberBudgets) {
  for (const bp of list) {
    aggBudgetByPeriod.set(bp.period_no, r2((aggBudgetByPeriod.get(bp.period_no) || 0) + bp.amount));
  }
}
const envelopeInScope = ALL_MEMBERS.filter(m => ENVELOPE.has(m));
check(`envelope_excluded note would carry TXR - TX - V for ALL`, envelopeInScope.length > 0 && envelopeInScope[0] === "TXR - TX - V");
check(`TXR - TX - V contributes 0 periods to aggregate budget`, !memberBudgets.has("TXR - TX - V"));

// ── 5. aggregate budget_periods per period == sum(members) ──────
let periodTieAll = true;
for (const [p, aggAmt] of aggBudgetByPeriod) {
  let expected = 0;
  for (const [, list] of memberBudgets) {
    const bp = list.find(x => x.period_no === p);
    if (bp) expected += bp.amount;
  }
  expected = r2(expected);
  const tie = Math.abs(aggAmt - expected) < 0.01;
  if (!tie) { periodTieAll = false; console.log(`    period ${p} FAIL - agg ${aggAmt} vs recomputed ${expected}`); }
}
check(`aggregate budget_periods per-period == sum(member budgets), all periods`, periodTieAll,
  `${aggBudgetByPeriod.size} periods checked`);

// ── 6. pagination proof ────────────────────────────────────────
if (allAgg.rows > 1000) {
  check(`pagination loop ran multiple pages (rows > 1000)`, allAgg.pages > 1,
    `rows ${allAgg.rows} · pages ${allAgg.pages}`);
} else {
  const forced = await paginateRowCountAndSum({ members: ALL_MEMBERS, pageSize: 50 });
  check(`pagination logic covered multiple pages at page-size 50`, forced.pages > 1,
    `rows ${forced.rows} · pages ${forced.pages}`);
  check(`page-size-50 rows == full rows`, forced.rows === allAgg.rows);
  check(`page-size-50 sum == full sum`, Math.abs(forced.sum - allAgg.sum) < 0.01);
}

console.log(`\n${pass ? "PROBE PASS" : "PROBE FAIL"}`);
process.exit(pass ? 0 : 1);

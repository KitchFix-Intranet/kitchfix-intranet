// PROBE (read-only): M-1 labor-budget acceptance.
//
// Verifies:
//   1. Every account's derived-homestand envelopes sum to the P&L
//      season total EXACTLY (the headline check).
//   2. Straddling homestands (CIN-OH HS7 crosses P6→P7) draw from
//      the right periods in the right proportion - shows arithmetic.
//   3. A missing budget row returns null with a reason, not zero.
//   4. The derivation returns [] for non-MLB accounts.
//   5. TXR-V's flex path: sold revenue × ratio = adjustedEnvelope.
//
//   node --env-file=.env.local scripts/_probe_labor_budget_acceptance.mjs

import { createClient } from "@supabase/supabase-js";
import {
  deriveLaborBudgets,
  buildGameDerivedDaysPerPeriod,
} from "../../src/app/service-calendar/season/laborBudgetDerivation.js";
import {
  deriveHomestandSegments,
  DERIVE_HOMESTANDS_ACCOUNTS,
} from "../../src/app/service-calendar/season/homestandDerivation.js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TODAY = new Date().toISOString().slice(0, 10);

// ─── Load yearData-shaped input from PG ─────────────────────────
async function loadYearShaped(accountKey) {
  // GAME + AWAY rows only, matching yearData.days[i].dayType usage.
  const { data, error } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, day_type, opponent, game_pk")
    .eq("account_key", accountKey)
    .order("service_date", { ascending: true });
  if (error) throw new Error(error.message);
  // Group by YYYY-MM for the yearData shape.
  const byMonth = new Map();
  for (const r of data) {
    const monthKey = String(r.service_date).slice(0, 7);
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey).push({
      date: String(r.service_date).slice(0, 10),
      dayType: r.day_type,
      opponent: r.opponent || "",
      gamePk: r.game_pk || null,
      status: "future",       // status is irrelevant for the derivation
      actualMeals: 0,
    });
  }
  const yearData = [...byMonth.entries()].map(([month, days]) => ({ month, days }));
  return yearData;
}

async function loadPeriodRanges(accountKey) {
  const { data, error } = await supa
    .from("sc_day_metadata")
    .select("period, service_date")
    .eq("account_key", accountKey)
    .not("period", "is", null)
    .order("service_date", { ascending: true });
  if (error) throw new Error(error.message);
  const map = new Map();
  for (const r of data) {
    const cur = map.get(r.period);
    if (!cur) map.set(r.period, { period: r.period, start: r.service_date, end: r.service_date });
    else if (r.service_date > cur.end) cur.end = r.service_date;
  }
  return [...map.values()].sort((a, b) => a.start.localeCompare(b.start));
}

async function loadBudgets(accountKey) {
  const { data, error } = await supa
    .from("sc_labor_budgets")
    .select("period, hourly_budget, salary_budget, revenue_forecast")
    .eq("account_key", accountKey)
    .is("superseded_at", null)
    .order("period", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadRatio(accountKey) {
  const { data, error } = await supa
    .from("accounts")
    .select("labor_ratio")
    .eq("team_key", accountKey)
    .single();
  if (error) throw new Error(error.message);
  return data.labor_ratio != null ? Number(data.labor_ratio) : null;
}

console.log(`═══ M-1 acceptance probe (today=${TODAY}) ═══\n`);

const MLB = ["CIN - OH", "STL - MO", "TXR - TX - H", "TXR - TX - V"];

let allExactMatch = true;

for (const account of MLB) {
  console.log(`──── ${account} ────`);
  const [yearData, periodRanges, budgets, ratio] = await Promise.all([
    loadYearShaped(account),
    loadPeriodRanges(account),
    loadBudgets(account),
    loadRatio(account),
  ]);
  console.log(`  periodRanges: ${periodRanges.length}   budgets: ${budgets.length}   ratio: ${ratio ?? "(null)"}`);

  const segments = deriveHomestandSegments(yearData, TODAY, { accountKey: account });
  console.log(`  derived homestand blocks: ${segments.length}`);

  const daysPerPeriod = buildGameDerivedDaysPerPeriod(segments, periodRanges);
  console.log(`  game-derived days per period: ${Object.entries(daysPerPeriod).map(([p, n]) => `${p}=${n}`).join(", ")}`);

  const envelopes = deriveLaborBudgets(segments, budgets, periodRanges, {
    accountKey: account,
    laborRatio: ratio,
  });

  // Compare in CENTS so floating-point drift never masks a real
  // arithmetic mismatch (the M-1 defect surfaced on TXR-TX-H as
  // "diff = -2.9e-11" - true cents-exact math prints diff = 0).
  const envCents = envelopes.reduce((s, e) => s + (e.envelopeCents || 0), 0);
  const seasonCents = budgets.reduce((s, b) => s + Math.round(Number(b.hourly_budget || 0) * 100), 0);
  const diffCents = envCents - seasonCents;
  const match = diffCents === 0;
  if (!match) allExactMatch = false;
  const fmt$ = (cents) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  console.log(`  envelope sum: ${fmt$(envCents)}   season hourly: ${fmt$(seasonCents)}   diff: ${diffCents}¢  ${match ? "✓ EXACT" : "✗ DRIFT"}`);

  // Show every homestand's envelope with cents where meaningful.
  console.log(`  per-homestand envelopes:`);
  for (const e of envelopes) {
    if (e.envelope == null) {
      console.log(`    ${e.homestandId.padEnd(5)} ${e.startDate}..${e.endDate} (${e.gameCount}g)  NULL - ${e.reason}`);
    } else {
      const bkStr = e.breakdown.map(b => `${b.period}=${fmt$(b.subtotalCents)}`).join(" + ");
      const chkCents = e.breakdown.reduce((s, b) => s + b.subtotalCents, 0);
      const chkMark = chkCents === e.envelopeCents ? "" : ` ⚠ breakdown-cents=${chkCents} vs envelope-cents=${e.envelopeCents}`;
      console.log(`    ${e.homestandId.padEnd(5)} ${e.startDate}..${e.endDate} (${e.gameCount}g)  ${fmt$(e.envelopeCents)}${chkMark}  [${bkStr}]`);
    }
  }
  console.log("");
}

// ─── CIN-OH HS7 straddle - arithmetic detail ────────────────────
console.log("──── Straddle receipt: CIN-OH HS7 ────");
{
  const account = "CIN - OH";
  const [yearData, periodRanges, budgets] = await Promise.all([
    loadYearShaped(account), loadPeriodRanges(account), loadBudgets(account),
  ]);
  const segments = deriveHomestandSegments(yearData, TODAY, { accountKey: account });
  const hs7 = segments.find(s => s.homestandId === "HS7");
  console.log(`  HS7 span: ${hs7.startDate} .. ${hs7.endDate} (${hs7.gameCount} games)`);
  // sc-21 (2026-07-29): period is BARE NUMERIC ("6", "7") - not "P6".
  const p6 = periodRanges.find(r => r.period === "6");
  const p7 = periodRanges.find(r => r.period === "7");
  console.log(`  P6: ${p6.start}..${p6.end}   P7: ${p7.start}..${p7.end}`);
  const daysPerPeriod = buildGameDerivedDaysPerPeriod(segments, periodRanges);
  const p6Budget = budgets.find(b => b.period === "6");
  const p7Budget = budgets.find(b => b.period === "7");
  console.log(`  P6 hourly=$${p6Budget.hourly_budget} / ${daysPerPeriod["6"]} days = $${(Number(p6Budget.hourly_budget) / daysPerPeriod["6"]).toFixed(4)}/day`);
  console.log(`  P7 hourly=$${p7Budget.hourly_budget} / ${daysPerPeriod["7"]} days = $${(Number(p7Budget.hourly_budget) / daysPerPeriod["7"]).toFixed(4)}/day`);
  const envelopes = deriveLaborBudgets(segments, budgets, periodRanges, { accountKey: account });
  const hs7Env = envelopes.find(e => e.homestandId === "HS7");
  const fmtP = (p) => `P${p}`;
  const bkStr = hs7Env.breakdown.map(b => `${fmtP(b.period)}=$${(b.subtotalCents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`).join(" + ");
  console.log(`  HS7 breakdown: ${bkStr} = $${(hs7Env.envelopeCents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
  console.log(`  HS7 periodsTouched: ${hs7Env.periodsTouched.map(fmtP).join(" + ")}`);
}

// ─── Missing budget row → null with reason ──────────────────────
console.log("\n──── Missing-budget receipt ────");
{
  // Simulate: derive using an empty budget list. Every homestand should
  // emit envelope=null with a reason.
  const account = "CIN - OH";
  const [yearData, periodRanges] = await Promise.all([
    loadYearShaped(account), loadPeriodRanges(account),
  ]);
  const segments = deriveHomestandSegments(yearData, TODAY, { accountKey: account });
  const emptyBudgets = [];
  const envelopes = deriveLaborBudgets(segments, emptyBudgets, periodRanges, { accountKey: account });
  const nullish = envelopes.filter(e => e.envelope == null);
  const zeros = envelopes.filter(e => e.envelope === 0);
  console.log(`  ${nullish.length} of ${envelopes.length} homestands emit envelope=null with a reason.`);
  console.log(`  ${zeros.length} homestands emit envelope=0.  (must be 0 - a zero envelope reads as "you may spend nothing.")`);
  console.log(`  sample reason on the first: "${nullish[0]?.reason}"`);
}

// ─── Non-MLB → [] ───────────────────────────────────────────────
console.log("\n──── Non-MLB gate ────");
{
  const account = "CIN - AZ";
  const yearData = await loadYearShaped(account);
  const periodRanges = await loadPeriodRanges(account);
  const segments = deriveHomestandSegments(yearData, TODAY, { accountKey: account });
  const envelopes = deriveLaborBudgets(segments, [], periodRanges, { accountKey: account });
  console.log(`  ${account}: segments=${segments.length}, envelopes=${envelopes.length}   ${segments.length === 0 && envelopes.length === 0 ? "✓ empty as expected" : "✗ leaked"}`);
}

// ─── TXR-V flex round-trip ──────────────────────────────────────
console.log("\n──── TXR-V flex round-trip ────");
{
  const account = "TXR - TX - V";
  const [yearData, periodRanges, budgets, ratio] = await Promise.all([
    loadYearShaped(account), loadPeriodRanges(account), loadBudgets(account), loadRatio(account),
  ]);
  const segments = deriveHomestandSegments(yearData, TODAY, { accountKey: account });
  // Fake a sold-revenue value on HS3.
  const hs3 = segments[2]; // 0-indexed
  const soldRevenueByBlockKey = { [hs3.key]: 27000 };
  const envelopes = deriveLaborBudgets(segments, budgets, periodRanges, {
    accountKey: account,
    laborRatio: ratio,
    soldRevenueByBlockKey,
  });
  const hs3Env = envelopes.find(e => e.homestandId === "HS3");
  // sc-21 cents-exact math: expected = round(soldRevenue × ratio × 100) / 100.
  // (Old integer round would have said $5,192 - imprecise now that
  // everything else is cent-accurate.)
  const expectedAdjCents = Math.round(27000 * ratio * 100);
  const expectedAdj = expectedAdjCents / 100;
  const gotCents = Math.round(hs3Env.adjustedEnvelope * 100);
  const flexMatch = gotCents === expectedAdjCents;
  console.log(`  ratio: ${ratio}   HS3 forecast envelope: $${hs3Env.envelope}`);
  console.log(`  HS3 with soldRevenue=$27,000: adjustedEnvelope = $${hs3Env.adjustedEnvelope.toFixed(2)}  (expected $${expectedAdj.toFixed(2)})  ${flexMatch ? "✓" : "✗"}`);
}

console.log(`\n═══ headline: ${allExactMatch ? "✓ every account's derived envelopes sum to season hourly EXACTLY" : "✗ drift detected"} ═══`);

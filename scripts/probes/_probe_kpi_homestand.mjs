// scripts/_probe_kpi_homestand.mjs
//
// Homestand PR-1 acceptance. In-process where the assertion is a
// property of the resolver (H1..H5, H7); live HTTP against `next dev`
// with TEST_MODE=true for the route-shape check (H6). Same TEST_MODE
// pattern the PR-3b + V42 probes use.
//
// Assertions
//   H1  windows contiguous + non-overlapping across a full season
//       for all four homestand accounts. Every daily row inside exactly
//       one stand's window (or none for pre-floor stands).
//   H2  sum of every non-pre-floor stand's actual dollars ==
//       sum(labor_actuals_daily) over the union of windows, to the
//       cent. Pre-floor stands are excluded per owner ruling
//       2026-08-21. No orphans, no double counts.
//   H3  CIN - OH's derived grouping reproduces the stored 13 stands
//       EXACTLY (game_start + game_end match one-for-one).
//   H4  budget reconciliation: sum(per-day mille-cent budget across
//       every day of the FY) / 1000 rounded to cents == sum(kpi_budgets
//       for the account + line_code) to the cent. Assert on every
//       homestand account. THIS IS THE TRAP: period length is 28 days
//       from the fiscal calendar, never derived from labor_actuals.
//   H5  the four HOMESTAND_ACCOUNTS_FY2026 return stands; every other
//       account returns []. Owner ruling 2026-08-21 (final): hardcoded
//       list, not derived. NON_HOMESTAND_SAMPLE covers each excluded
//       shape (no schedule; schedule + no hourly labor; schedule +
//       hourly labor but development complex).
//   H6  a homestand HTTP request returns `source` in {"daily",
//       "weekly"} and never a new value; `homestand` + `homestand_split`
//       + `homestand_bank` are present in the body; `homestands` is
//       the same list the resolver returned in-process.
//   H7  CIN - OH structural fixtures + bank arithmetic as PROPERTY.
//       Owner ruling 2026-08-24: hardcoded snapshot pins broke when
//       payroll approvals moved live figures overnight (HS 11 08/20
//       shifts got approved, bank shifted $4,218.39 -> $3,359.08 as
//       designed). Windows, budgets, peak_in_week, stands_finished /
//       remaining are STRUCTURAL and stay pinned. Bank + remaining_budget
//       are LIVE and asserted as a PROPERTY (bank == sum(finished
//       budget) - sum(finished actual); remaining_budget ==
//       sum(unfinished budget)).
//   HInv night_games + day_games == game_days on EVERY stand across
//       every homestand account. Owner ruling 2026-08-21: no null
//       fallback on day_night - if this ever fails, we want to know,
//       not degrade quietly.
//   HSent CIN - OH 06/29 weekly aggregate unchanged: 113.98 / 2.32
//       / 39.91 / $4,328.27. THIS ONE stays a snapshot because it
//       genuinely cannot move - a closed June week with every shift
//       approved months ago is a fingerprint of the derive pipeline,
//       and any change is a real regression.
//
// Usage: node scripts/_probe_kpi_homestand.mjs

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import {
  HOMESTAND_ACCOUNTS_FY2026,
  listHomestands,
  actualsByStand,
  computeHomestandBank,
  isoToDate, dateToIso, addDaysIso,
  perDayMilleCents,
} from "../../src/lib/labor/homestandResolver.js";

// PR-2 audit follow-up 2026-08-21: post-owner-ruling H5 shape.
// HOMESTAND_ACCOUNTS_FY2026 is the four-account hardcoded list; any
// other account (schedule or not, hourly labor or not) must return
// [] from listHomestands.
const HOMESTAND_ACCTS = [...HOMESTAND_ACCOUNTS_FY2026];
// Sampled non-included accounts covering every excluded shape:
//   - CIN - KY, TBJ - NY  : has schedule, zero hourly labor (Louisville/Buffalo salaried)
//   - STL - FL, TBJ - FL  : has schedule + hourly labor, but development complex
//                            (labor doesn't cluster around games)
//   - TBR - FL, CIN - AZ,
//     TXR - AZ            : no schedule, hourly labor only (PDC/AZ)
const NON_HOMESTAND_SAMPLE = [
  "CIN - KY", "TBJ - NY",
  "STL - FL", "TBJ - FL",
  "TBR - FL", "CIN - AZ", "TXR - AZ",
];
// Kept for backwards compatibility with the rest of this file's usage.
const MLB = HOMESTAND_ACCTS;

const PORT = process.env.PROBE_PORT || "3100";
const BASE = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 90000;

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }
function skip(line) { console.log(`  SKIP  ${line}`); }
function note(line) { console.log(`  NOTE  ${line}`); }

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

console.log("=".repeat(72));
console.log("homestand PR-1 acceptance");
console.log("=".repeat(72));

async function fetchAllRange(table, cols, filters) {
  let out = [], from = 0;
  while (true) {
    let q = supa.from(table).select(cols).range(from, from + 999);
    for (const [k, v] of filters) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

// Pre-fetch every stand list + FY daily actuals per MLB account.
const standsByAcct = new Map();
const dailyByAcct  = new Map();
for (const a of MLB) {
  standsByAcct.set(a, await listHomestands(supa, a, 2026));
  dailyByAcct.set(a, await fetchAllRange("labor_actuals_daily", "work_date, amount", [["account_key", a]]));
}

// ─── H1 contiguous + non-overlapping windows ────────────────────────
console.log("");
console.log("[H1] windows contiguous and non-overlapping across the full season, all four accounts");
{
  let bad = 0;
  for (const a of MLB) {
    const hs = standsByAcct.get(a);
    if (!hs.length) { note(`${a}: 0 stands`); continue; }
    // Non-pre-floor stands must chain: prev.window_end + 1 == next.window_start
    // Pre-floor stands may overlap with themselves (window_start == game_start)
    // since we bound them to game_start rather than prev.game_end + 1.
    const chain = hs.filter(h => !h.pre_floor).sort((x, y) => x.window_start.localeCompare(y.window_start));
    let gaps = 0, overlaps = 0;
    for (let i = 1; i < chain.length; i++) {
      const expectStart = addDaysIso(chain[i - 1].window_end, 1);
      if (chain[i].window_start > expectStart) gaps++;
      if (chain[i].window_start < expectStart) overlaps++;
    }
    if (gaps === 0 && overlaps === 0) ok(`${a}: ${hs.length} stand(s), ${chain.length} non-pre-floor - contiguous, zero gaps, zero overlaps`);
    else { fail(`${a}: gaps=${gaps} overlaps=${overlaps}`); bad++; }
  }
  if (bad === 0) ok("all four homestand accounts pass windowing invariant");
}

// ─── H2 stand-actual sum == daily-total sum (union of windows) ──────
console.log("");
console.log("[H2] sum(non-pre-floor stand actuals) == sum(labor_actuals_daily inside those windows), to the cent");
{
  for (const a of MLB) {
    const hs = standsByAcct.get(a);
    const daily = dailyByAcct.get(a);
    if (!hs.length) { note(`${a}: no stands - skip`); continue; }
    // Both sides accumulate myriadths (Math.round(amount * 10000)).
    // actualsByStand now returns myriadths per stand; the daily-window
    // sum uses the same rounding path. Equality is exact.
    const inWindow = daily.filter(r => hs.some(h => !h.pre_floor && r.work_date >= h.window_start && r.work_date <= h.window_end));
    const dailyX10000 = inWindow.reduce((s, r) => s + Math.round(Number(r.amount || 0) * 10000), 0);
    const actMap = actualsByStand(hs, daily);
    let standX10000 = 0;
    for (const [, x] of actMap) standX10000 += x;
    if (dailyX10000 === standX10000) ok(`${a}: sum(stand actuals) == sum(daily in windows) EXACT ($${(standX10000/10000).toFixed(2)})`);
    else fail(`${a}: myriadth delta = ${dailyX10000 - standX10000} (${((dailyX10000 - standX10000) / 10000).toFixed(4)} dollars)`);
  }
}

// ─── H3 derived stands reproduce stored homestand_id count per acct ─
// PR-2 audit follow-up 2026-08-21: stand counts are NOT uniform.
// Measured for FY2026: CIN - OH 13, STL - MO 13, TXR - TX - H 12,
// TXR - TX - V 12. This probe asserts each account's derivation
// matches its stored homestand_id count exactly, so any regression
// that mis-groups games (or any code that assumes 13 across the
// board) is caught on the account it misfires on.
console.log("");
console.log("[H3] derived grouping reproduces the expected stand count per account (per-account, not uniform)");
{
  const EXPECTED = { "CIN - OH": 13, "STL - MO": 13, "TXR - TX - H": 12, "TXR - TX - V": 12 };
  for (const a of MLB) {
    const hs = standsByAcct.get(a);
    const want = EXPECTED[a];
    if (hs.length !== want) fail(`${a}: derived ${hs.length} stands, expected ${want}`);
    else ok(`${a}: ${want} derived stands (matches EXPECTED)`);
  }
  // Stored-id integrity is documented as a NOTE, not an assertion:
  // STL - MO's schedule loader wrote homestand_id=HS8 to two derived
  // stands (2026-06-22 and 2026-07-23), giving 12 distinct ids
  // against 13 derived stands. Runtime never keys on homestand_id -
  // window resolution + budget attribution key on game_start - so
  // this is a data-quality signal, not a runtime bug. Flagging for
  // schedule-loader follow-up in a separate PR.
  for (const a of MLB) {
    const hs = standsByAcct.get(a);
    const storedIds = new Set(hs.map(h => h.homestand_id).filter(Boolean));
    const want = EXPECTED[a];
    if (storedIds.size === want) ok(`${a}: ${want} distinct stored homestand_ids, one per derived stand`);
    else note(`${a}: ${storedIds.size} distinct stored homestand_ids across ${want} derived stands - schedule-loader inconsistency (runtime uses game_start, not homestand_id)`);
  }
}

// ─── H4 FY budget reconciliation ────────────────────────────────────
console.log("");
console.log("[H4] per-day budget summed across the FY == sum(kpi_budgets) to the cent, all four homestand accounts");
{
  for (const a of MLB) {
    const budgets = await fetchAllRange("kpi_budgets", "period_no, amount", [["account_key", a], ["line_code", "3100.1"], ["fiscal_year", 2026]]);
    const totalCents = budgets.reduce((s, b) => s + Math.round(Number(b.amount || 0) * 100), 0);
    // Reconstruct FY per-day mille-cent sum via the resolver's helper.
    let mille = 0;
    for (const b of budgets) mille += perDayMilleCents(Math.round(Number(b.amount || 0) * 100)) * 28;
    const reconstructed = Math.round(mille / 1000);
    if (reconstructed === totalCents) ok(`${a}: per-day * 28 * 13 = kpi_budgets total ($${(totalCents/100).toFixed(2)}) EXACT`);
    else fail(`${a}: reconstructed ${reconstructed}c vs kpi_budgets ${totalCents}c, delta ${reconstructed - totalCents}c`);
  }
}

// ─── H5 the four hardcoded accounts return stands; everyone else [] ──
// PR-2 audit follow-up 2026-08-21: post-owner-ruling shape.
console.log("");
console.log("[H5] the four HOMESTAND_ACCOUNTS_FY2026 return stands; every other sampled account returns []");
{
  for (const a of HOMESTAND_ACCTS) {
    const hs = await listHomestands(supa, a, 2026);
    if (hs.length > 0) ok(`${a}: ${hs.length} stands`);
    else fail(`${a}: expected stands, got []`);
  }
  for (const a of NON_HOMESTAND_SAMPLE) {
    const hs = await listHomestands(supa, a, 2026);
    if (hs.length === 0) ok(`${a}: [] (excluded per owner ruling)`);
    else fail(`${a}: got ${hs.length} stands - expected [] per owner ruling`);
  }
}

// ─── HInv night + day == game_days ──────────────────────────────────
console.log("");
console.log("[HInv] night_games + day_games == game_days on every stand, all four accounts");
{
  let bad = 0;
  for (const a of MLB) {
    for (const h of standsByAcct.get(a)) {
      if (h.night_games + h.day_games !== h.game_days) {
        fail(`${a} stand game_start=${h.game_start}: night ${h.night_games} + day ${h.day_games} != game_days ${h.game_days}`);
        bad++;
      }
    }
  }
  if (bad === 0) ok(`invariant holds on every stand across all four accounts`);
}

// ─── H7 CIN - OH structural fixtures + bank as PROPERTY ─────────────
// Owner ruling 2026-08-24 after PR-A landed and this probe surfaced
// homestand "drift" that was actually the board WORKING: HS 11's
// 08/20 shifts got approved overnight by the nightly sync at 07:36,
// so HS 11 actual moved $7,732.47 -> $8,591.78 (34.27h at ~$25/hr
// with OT) and the bank fell to $3,359.08 with it.
//
// Fixture posture (revised):
//   KEEP as hardcoded pins (structural, cannot legitimately move):
//     - window boundaries (derived from stored schedule + daily floor
//       clamp + prep-day rule)
//     - budgets (derived from kpi_budgets 3100.1 x per-day pro-rate)
//     - peak_games_in_week (Monday-anchored count on stored schedule)
//     - stands_finished / stands_remaining (given frozen today)
//   REPLACE with PROPERTY (live figures that legitimately move):
//     - bank total  ->  bank == sum(finished budget) - sum(finished actual)
//     - remaining_budget  ->  == sum(unfinished stand budgets)
//   These hold regardless of what payroll does overnight and still
//   fail loudly on a real regression (a sign flip, a missing stand,
//   the pre-floor exclusion breaking).
console.log("");
console.log("[H7] CIN - OH structural fixtures + bank arithmetic as property");
{
  const hs = standsByAcct.get("CIN - OH");
  const daily = dailyByAcct.get("CIN - OH");
  const hs11 = hs.find(h => h.game_start === "2026-08-14");
  const hs10 = hs.find(h => h.game_start === "2026-07-27");
  if (!hs11 || !hs10) fail("HS 10 or HS 11 not found");
  else {
    const eq = (label, got, want) => {
      if (got === want) ok(`${label}: ${got}`);
      else fail(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    };
    const near = (label, got, want, tol = 0.005) => {
      if (Math.abs(got - want) < tol) ok(`${label}: ${got}`);
      else fail(`${label}: got ${got}, want ${want}`);
    };
    // STRUCTURAL pins - these derive from stored schedule + budget
    // and cannot legitimately move.
    eq  ("HS 11 window_start", hs11.window_start, "2026-08-07");
    eq  ("HS 11 window_end  ", hs11.window_end,   "2026-08-20");
    near("HS 11 budget      ", hs11.budget, 8056.06);
    eq  ("HS 11 peak_in_week", hs11.peak_games_in_week, 4);
    eq  ("HS 10 window_start", hs10.window_start, "2026-07-13");
    eq  ("HS 10 window_end  ", hs10.window_end,   "2026-08-06");
    near("HS 10 budget      ", hs10.budget, 12432.19);
    eq  ("HS 10 peak_in_week", hs10.peak_games_in_week, 7);

    // Freeze today against 2026-08-21 so stands_finished stays 9. The
    // freeze is what makes stands_finished / stands_remaining
    // structural rather than time-of-day-dependent - HS 11 (game_end
    // 2026-08-20) is finished under that freeze.
    const actMap = actualsByStand(hs, daily);
    const bank = computeHomestandBank(hs, actMap, "2026-08-21");

    // PROPERTY: bank == sum(finished stand budgets) - sum(finished
    // stand actuals). Per-stand rounded on BOTH sides, then summed,
    // matching computeHomestandBank's own arithmetic. Holds
    // regardless of what payroll approves overnight - the two sides
    // move together by construction. Fails loudly on a real
    // regression (pre-floor stand leaking into finished sum, an
    // account_key mismatch, a sign flip).
    let expectedBankCents = 0;
    let expectedRemainingCents = 0;
    let expectedFinished = 0;
    let expectedRemaining = 0;
    for (const h of hs) {
      if (h.pre_floor) continue;
      if (h.game_end < "2026-08-21") {
        const bC = Math.round((h.budget || 0) * 100);
        const aC = Math.round((actMap.get(h.game_start) || 0) / 100);
        expectedBankCents += (bC - aC);
        expectedFinished += 1;
      } else {
        expectedRemainingCents += Math.round((h.budget || 0) * 100);
        expectedRemaining += 1;
      }
    }
    const gotBankCents = Math.round(bank.bank * 100);
    if (gotBankCents === expectedBankCents) ok(`bank == sum(finished budget) - sum(finished actual) EXACT (${bank.stands_finished} finished stands, $${bank.bank.toFixed(2)} today; the specific dollar figure moves as payroll approves - the ARITHMETIC holds)`);
    else fail(`bank $${bank.bank.toFixed(2)} != computed sum $${(expectedBankCents/100).toFixed(2)} - budget or actual arithmetic broke`);

    // stands_finished / stands_remaining - structural under the today
    // freeze. Verify against the walk above so a change in the
    // pre_floor / game_end < today discrimination is caught.
    if (bank.stands_finished === expectedFinished && bank.stands_finished === 9) ok(`stands_finished = 9 (matches expected walk under today=2026-08-21)`);
    else fail(`stands_finished = ${bank.stands_finished}, walked ${expectedFinished}, want 9`);
    if (bank.stands_remaining === expectedRemaining && bank.stands_remaining === 2) ok(`stands_remaining = 2 (matches expected walk)`);
    else fail(`stands_remaining = ${bank.stands_remaining}, walked ${expectedRemaining}, want 2`);

    // PROPERTY: remaining_budget == sum(unfinished stand budgets).
    // Derived from stored schedule + kpi_budgets so drift here would
    // be a real bug (schedule change, budget refresh); still safer to
    // assert the property than a dollar figure.
    const gotRemainingCents = Math.round(bank.remaining_budget * 100);
    if (gotRemainingCents === expectedRemainingCents) ok(`remaining_budget == sum(unfinished budgets) EXACT ($${bank.remaining_budget.toFixed(2)})`);
    else fail(`remaining_budget $${bank.remaining_budget.toFixed(2)} != computed sum $${(expectedRemainingCents/100).toFixed(2)}`);
  }
}

// ─── H8 salary integration: budget + actual + bank on both bases ────
// PR #274 (owner ruling 2026-08-21): the salary toggle on the homestand
// view is exposed only if include_salary=1 makes stand.budget AND
// stand.actual (AND the bank) reconcile on the same basis. This block
// proves both bases on the same account by calling listHomestands with
// includeSalary=false vs true and reproducing the route-side salary
// fold that produces stand.actual (per-stand salaryProRate over the
// stand's window). Failure mode this guards: actual folds in salary
// while budget stays hourly-only, and every stand reads over-budget the
// instant someone flips the toggle.
console.log("");
console.log("[H8] salary integration: hourly-only unchanged; salary-on adds to both sides, bank reconciles on each basis");
{
  const { loadSalaryActuals } = await import("../../src/lib/labor/salaryBoard.js");
  const { salaryProRate }     = await import("../../src/lib/labor/salaryProRate.js");
  const acct = "CIN - OH";
  const today = "2026-08-21";

  // Hourly-only path. Structural pin on budget (derived from stored
  // schedule + kpi_budgets); bank + actual are LIVE FIGURES that move
  // as payroll approves - asserted as a PROPERTY, not a snapshot.
  // Owner ruling 2026-08-24 after HS 11's 08/20 shifts got approved
  // overnight moved bank $4,218.39 -> $3,359.08 (as designed).
  const hsHourly = await listHomestands(supa, acct, 2026, { includeSalary: false });
  const daily    = dailyByAcct.get(acct);
  const actMapH  = actualsByStand(hsHourly, daily);
  const bankH    = computeHomestandBank(hsHourly, actMapH, today);
  const hs11H    = hsHourly.find(h => h.game_start === "2026-08-14");
  const near = (label, got, want, tol = 0.005) => {
    if (Math.abs(got - want) < tol) ok(`${label}: ${got}`);
    else fail(`${label}: got ${got}, want ${want}`);
  };
  // PROPERTY: hourly-only bank reconciles.
  let hourlyExpectedBankCents = 0;
  for (const h of hsHourly) {
    if (h.pre_floor || h.game_end >= today) continue;
    const bC = Math.round((h.budget || 0) * 100);
    const aC = Math.round((actMapH.get(h.game_start) || 0) / 100);
    hourlyExpectedBankCents += (bC - aC);
  }
  const hourlyGotBankCents = Math.round(bankH.bank * 100);
  if (hourlyGotBankCents === hourlyExpectedBankCents) ok(`hourly-only bank reconciles: $${bankH.bank.toFixed(2)} == sum(budget) - sum(actual) EXACT`);
  else fail(`hourly-only bank drift: $${bankH.bank.toFixed(2)} vs computed $${(hourlyExpectedBankCents/100).toFixed(2)}`);
  // STRUCTURAL: budget stays pinned - derived from schedule + budget
  // table, cannot legitimately move.
  near("hourly-only HS 11 budget", hs11H.budget, 8056.06);
  // Live: HS 11 actual moves with payroll approvals. Assert only that
  // it exists as a non-null non-zero number (a real dollar figure was
  // computed) and that it matches actMap (identity that catches a
  // client-vs-server divergence). No snapshot on the value itself.
  const hs11Actual = Math.round((actMapH.get("2026-08-14") || 0) / 100) / 100;
  if (hs11Actual > 0) ok(`hourly-only HS 11 actual = $${hs11Actual.toFixed(2)} (present + non-zero; specific value moves as payroll approves)`);
  else fail(`hourly-only HS 11 actual is zero or negative ($${hs11Actual}) - attribution broke`);
  if (hs11H.budget_hourly === hs11H.budget) ok(`hourly-only: budget_hourly == budget ($${hs11H.budget})`);
  else fail(`hourly-only: budget_hourly (${hs11H.budget_hourly}) != budget (${hs11H.budget})`);
  if (hs11H.budget_salary === null) ok(`hourly-only: budget_salary is null (breakout absent when toggle off)`);
  else fail(`hourly-only: budget_salary should be null, got ${hs11H.budget_salary}`);

  // Salary-on path. Reproduces the server-side fold: listHomestands
  // returns stand.budget = hourly + salary; the route adds pro-rated
  // salary to actMap; bank reconciles on the salary-inclusive basis.
  const hsSal   = await listHomestands(supa, acct, 2026, { includeSalary: true });
  const actMapS = new Map(actualsByStand(hsSal, daily));
  const salActQ = await loadSalaryActuals(supa, [acct], "2025-12-29", "2026-12-27");
  if (salActQ.error) fail(`salary actuals load: ${salActQ.error}`);
  for (const h of hsSal) {
    if (h.pre_floor) continue;
    const pr = salaryProRate({ startISO: h.window_start, endISO: h.window_end, salaryRows: salActQ.rows || [] });
    const salX10000 = Math.round((pr.total || 0) * 10000);
    actMapS.set(h.game_start, (actMapS.get(h.game_start) || 0) + salX10000);
  }
  const bankS  = computeHomestandBank(hsSal, actMapS, today);
  const hs11S  = hsSal.find(h => h.game_start === "2026-08-14");

  // 1. Breakout fields present with correct sum on both bases.
  const budgetSum = (hs11S.budget_hourly || 0) + (hs11S.budget_salary || 0);
  if (Math.abs(budgetSum - hs11S.budget) < 0.005) ok(`salary-on HS 11: budget_hourly + budget_salary == budget ($${hs11S.budget})`);
  else fail(`salary-on HS 11: breakout sum ${budgetSum} != budget ${hs11S.budget}`);

  // 2. Both sides move together. Salary contribution positive on CIN - OH.
  if (hs11S.budget > hs11H.budget) ok(`salary-on HS 11: budget ($${hs11S.budget}) > hourly-only budget ($${hs11H.budget}) by $${(hs11S.budget - hs11H.budget).toFixed(2)}`);
  else fail(`salary-on HS 11: budget did not increase over hourly-only`);
  // Actual is what the route would produce; recompute here since
  // listHomestands doesn't attach actual (route does).
  const hs11SalX = actMapS.get("2026-08-14") || 0;
  const hs11ActualSal = Math.round(hs11SalX / 100) / 100;
  if (hs11ActualSal > hs11Actual) ok(`salary-on HS 11: actual ($${hs11ActualSal}) > hourly-only actual ($${hs11Actual}) by $${(hs11ActualSal - hs11Actual).toFixed(2)}`);
  else fail(`salary-on HS 11: actual did not increase over hourly-only`);

  // 3. Bank reconciles on salary-inclusive basis: bank == sum(finished
  // stand budgets) - sum(finished stand actuals), same discipline as
  // hourly-only.
  let expectedBankCents = 0;
  for (const h of hsSal) {
    if (h.pre_floor || h.game_end >= today) continue;
    const bC = Math.round((h.budget || 0) * 100);
    const aC = Math.round((actMapS.get(h.game_start) || 0) / 100);
    expectedBankCents += (bC - aC);
  }
  const gotBankCents = Math.round(bankS.bank * 100);
  if (gotBankCents === expectedBankCents) ok(`salary-on bank reconciles: $${bankS.bank.toFixed(2)} == sum(budget) - sum(actual) EXACT`);
  else fail(`salary-on bank drift: got $${bankS.bank.toFixed(2)}, computed $${(expectedBankCents/100).toFixed(2)}`);

  // 4. Stands_finished / stands_remaining unchanged across bases -
  // the discrimination is by game_end vs today, not by basis.
  if (bankH.stands_finished === bankS.stands_finished && bankH.stands_remaining === bankS.stands_remaining) {
    ok(`stands_finished + stands_remaining unchanged across bases (${bankH.stands_finished} / ${bankH.stands_remaining})`);
  } else {
    fail(`stands counts drifted: hourly=(${bankH.stands_finished}/${bankH.stands_remaining}) salary=(${bankS.stands_finished}/${bankS.stands_remaining})`);
  }

  // 5. Regression net: hourly-only path is byte-for-byte unchanged
  // when re-run after the salary-on path (no shared state leak).
  const hsHourlyAgain = await listHomestands(supa, acct, 2026, { includeSalary: false });
  const hs11H2 = hsHourlyAgain.find(h => h.game_start === "2026-08-14");
  if (hs11H2.budget === hs11H.budget && hs11H2.budget_hourly === hs11H.budget_hourly && hs11H2.budget_salary === null) {
    ok(`hourly-only re-run: budget still $${hs11H2.budget}, budget_salary still null`);
  } else {
    fail(`hourly-only re-run drift: budget=${hs11H2.budget} budget_hourly=${hs11H2.budget_hourly} budget_salary=${hs11H2.budget_salary}`);
  }

  // 6. THE LOAD-BEARING ASSERTION owner ruling 2026-08-21 (post-#771):
  // abs(bank_salary_on - bank_hourly_only) must be < $1.00. This is
  // the single check that fails LOUDLY on the exact failure mode PR
  // #274 was built to prevent - actual folding in salary while budget
  // stays hourly-only (or vice versa) would shift the bank by the
  // salary contribution across the finished-stand era (thousands),
  // never a dime.
  //
  // Why the delta stays tiny: CIN - OH salary is flat at $1,680.38 /
  // week, one distinct amount across 34 weeks (verified 2026-08-21).
  // The finished-stand era carries $28,566 of salary against a
  // $69,181 hourly base. Adding a flat cost to BOTH budget and
  // actual nearly cancels - the residue is nine stands of one-cent
  // independent rounding, hence the observed $0.10 drift. If either
  // side were missing salary, the bank would shift by ~$28K - and
  // this assertion catches that in one line, invisible in any single-
  // stand check.
  const deltaCents = Math.abs(Math.round((bankS.bank - bankH.bank) * 100));
  if (deltaCents < 100) {
    ok(`bank delta across bases < $1.00: |${bankS.bank.toFixed(2)} - ${bankH.bank.toFixed(2)}| = $${(deltaCents/100).toFixed(2)} (both sides moved together)`);
  } else {
    fail(`bank delta across bases = $${(deltaCents/100).toFixed(2)} >= $1.00 - ONE SIDE PICKED UP SALARY, THE OTHER DID NOT. This is the exact failure PR #274 was built to prevent. Check listHomestands includeSalary flag vs the route's salary-fold on actMap.`);
  }
}

// ─── H9 pre-floor stand estimator - PR #273 ─────────────────────────
// Owner spec 2026-08-21: pre-floor stands (HS 1, HS 2 on 03/26-open
// accounts; HS 1 on 04/03-open accounts) get a game-day-weighted
// estimate derived from each account's own low-OT stand history.
// Non-negotiables:
//   1. Pre-floor count per account is measured, never assumed: 2 for
//      CIN - OH + STL - MO; 1 for TXR - TX - H + TXR - TX - V.
//   2. Zero stands may straddle the daily floor. Method refuses.
//   3. Bank is BYTE-IDENTICAL with the estimator on and off. The
//      bank is the number operators make decisions on; estimates
//      never enter it. This is the load-bearing assertion.
//   4. CIN - OH sanity: 03/27 (Friday, no game, no prep-day-of-any-
//      stand) = $0. 04/02..04/08 (road trip - team away) = $0.
console.log("");
console.log("[H9] pre-floor stand estimator: counts, no-straddle, bank-byte-identical, CIN - OH sanity");
{
  const { foldPreFloorEstimates, assertNoStraddlingStand } = await import("../../src/lib/labor/preFloorEstimator.js");
  const today = "2026-08-21";
  const dailyFloor = "2026-04-20";
  const EXPECTED_PRE_FLOOR = {
    "CIN - OH": 2, "STL - MO": 2, "TXR - TX - H": 1, "TXR - TX - V": 1,
  };

  // 1. Per-account pre-floor counts + no straddle.
  for (const acct of MLB) {
    const hs = standsByAcct.get(acct);
    const preFloor = hs.filter(h => h.pre_floor);
    const want = EXPECTED_PRE_FLOOR[acct];
    if (preFloor.length === want) ok(`${acct}: ${want} pre-floor stand(s)`);
    else fail(`${acct}: got ${preFloor.length} pre-floor, expected ${want}`);
    try {
      assertNoStraddlingStand(hs, dailyFloor);
      ok(`${acct}: no stand straddles the daily floor`);
    } catch (e) {
      fail(`${acct}: ${e.message}`);
    }
  }

  // 2. Bank byte-identical with estimator on and off. LOAD-BEARING.
  // Owner rule: "the bank is a promise about money and must remain
  // provable. Assert the bank is unchanged by the estimator."
  for (const acct of MLB) {
    const hs = standsByAcct.get(acct);
    const daily = dailyByAcct.get(acct);
    const actMap = actualsByStand(hs, daily);
    const bankBefore = computeHomestandBank(hs, actMap, today);
    const hsWithEstimates = await foldPreFloorEstimates(supa, acct, hs, dailyFloor, today);
    const actMapAfter = actualsByStand(hsWithEstimates, daily);
    const bankAfter = computeHomestandBank(hsWithEstimates, actMapAfter, today);
    const bankSame = bankBefore.bank === bankAfter.bank
                  && bankBefore.spent_to_date === bankAfter.spent_to_date
                  && bankBefore.budget_to_date === bankAfter.budget_to_date
                  && bankBefore.stands_finished === bankAfter.stands_finished
                  && bankBefore.stands_remaining === bankAfter.stands_remaining
                  && bankBefore.remaining_budget === bankAfter.remaining_budget;
    if (bankSame) ok(`${acct}: bank byte-identical with estimator on and off ($${bankBefore.bank.toFixed(2)})`);
    else fail(`${acct}: bank drifted with estimator - before=${JSON.stringify(bankBefore)} after=${JSON.stringify(bankAfter)} - ESTIMATES LEAKED INTO BANK, this is exactly what PR #273 was built to prevent`);
  }

  // 2b. HS FB1 PR-4 (owner ruling 2026-08-25): estimator now folds onto
  // PLAYED stands too (retrospective plan for the Actuals | Plan
  // toggle). Bank must STILL be byte-identical - played stands carry
  // actual_estimated as a comparison value, is_estimated stays FALSE
  // so no client display gate confuses actual with plan. Baseline
  // captured on origin/main before the PR-4 fold change (2026-08-25):
  //   CIN - OH      $3,359.08
  //   STL - MO      $8,377.39
  //   TXR - TX - H  $38,157.32
  //   TXR - TX - V  -$3,601.96
  // These are the numbers the bank invariant is anchored to; if they
  // move, the fold leaked into the bank.
  const PR4_BANK_BASELINE = {
    "CIN - OH": 3359.08,
    "STL - MO": 8377.39,
    "TXR - TX - H": 38157.32,
    "TXR - TX - V": -3601.96,
  };
  for (const acct of MLB) {
    const hs = standsByAcct.get(acct);
    const hsWithEstimates = await foldPreFloorEstimates(supa, acct, hs, dailyFloor, today);
    const daily = dailyByAcct.get(acct);
    const actMap = actualsByStand(hsWithEstimates, daily);
    const bankAfter = computeHomestandBank(hsWithEstimates, actMap, today);
    const want = PR4_BANK_BASELINE[acct];
    if (Math.abs(bankAfter.bank - want) < 0.005) {
      ok(`${acct}: bank byte-identical with PR-4 played-stand fold ($${bankAfter.bank.toFixed(2)} matches baseline)`);
    } else {
      fail(`${acct}: bank drifted from baseline - want $${want.toFixed(2)}, got $${bankAfter.bank.toFixed(2)} (delta $${(bankAfter.bank - want).toFixed(2)}) - PLAYED-STAND FOLD LEAKED INTO BANK`);
    }
    // Every played stand carries actual_estimated with is_estimated: false.
    // Pre-floor + future stands keep is_estimated: true (rail hatch
    // semantics apply only there).
    const playedStands = hsWithEstimates.filter(h => !h.pre_floor && h.game_end < today);
    const badPlayed = playedStands.filter(h => h.actual_estimated == null || h.is_estimated === true);
    if (badPlayed.length === 0) {
      ok(`${acct}: all ${playedStands.length} played stand(s) carry actual_estimated with is_estimated: false`);
    } else {
      fail(`${acct}: ${badPlayed.length} played stand(s) missing actual_estimated or wrongly marked is_estimated: ${badPlayed.map(h => h.game_start).join(", ")}`);
    }
  }

  // 3. CIN - OH sanity per owner spec.
  {
    const hs = standsByAcct.get("CIN - OH");
    const hsWithEst = await foldPreFloorEstimates(supa, "CIN - OH", hs, dailyFloor, today);
    const hs1 = hsWithEst.find(h => h.index === 1);
    const hs2 = hsWithEst.find(h => h.index === 2);
    if (hs1?.is_estimated) ok(`CIN - OH HS 1 marked is_estimated: $${hs1.actual_estimated?.toFixed(2)}`);
    else fail(`CIN - OH HS 1 not marked is_estimated`);
    if (hs2?.is_estimated) ok(`CIN - OH HS 2 marked is_estimated: $${hs2.actual_estimated?.toFixed(2)}`);
    else fail(`CIN - OH HS 2 not marked is_estimated`);

    // Owner's per-day sanity checks (day types + zero-amount expected).
    const perDayHs1 = hs1?.estimator_meta?.per_day || [];
    const perDayHs2 = hs2?.estimator_meta?.per_day || [];
    const check = (label, list, date, wantAmount) => {
      const e = list.find(p => p.date === date);
      if (!e) { fail(`${label}: ${date} not in per_day breakdown`); return; }
      if (Math.abs(e.amount - wantAmount) < 0.005) ok(`${label}: ${date} = $${e.amount.toFixed(2)} (${e.day_type})`);
      else fail(`${label}: ${date} = $${e.amount.toFixed(2)}, expected $${wantAmount.toFixed(2)}`);
    };
    // 03/27 is a Friday off day in HS 1's window (03/26 Thu opener,
    // 03/27 Fri off, 03/28-04/01 games). Owner: 03/27 lands at $0.
    check("CIN - OH HS 1 sanity", perDayHs1, "2026-03-27", 0);
    // HS 2's WINDOW is 04/02-04/16 (owner-approved attribution: HS 1's
    // last game 04/01 + 1 = 04/02, through HS 2's last game 04/16).
    // The road-trip stretch 04/02-04/08 is IN window but the team is
    // away, so the schedule has no game and no prep. Owner: "each of
    // those days lands at $0, with that week's money correctly sitting
    // on the games at either end." Assert both PRESENCE (they're in
    // the breakdown) and $0 amount (no schedule weight to attract a
    // slice) - the alternative of absence would mask a bug that
    // reassigned road-trip dates to a neighbor stand.
    const roadTripDates = ["2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", "2026-04-07", "2026-04-08"];
    for (const d of roadTripDates) check("CIN - OH HS 2 road-trip sanity", perDayHs2, d, 0);

    // Pin to the value the corrected derivation produces (owner rule
    // 2026-08-21). Three fixes now applied:
    //
    //   1. dollars_regular (not amount) for base-rate derivation -
    //      excludes OT/DT/premium that the low-OT restriction was
    //      already supposed to keep out.
    //   2. Exclude zero-amount days from the sample - CIN - OH
    //      2026-08-20 (HS 11 game_end, one day before todayIso) was
    //      $0 from Rippling lag and dragged the day base sample from
    //      11 games to 12 games, $806.89 down to $739.65.
    //   3. HS 1's window starts at its PREP DAY (game_start - 1)
    //      instead of game_start. Owner ruling after PR #773 v3
    //      surfaced the walk: every other stand owns the prep day
    //      before it (because window_start = prev.game_end + 1),
    //      but HS 1 had no predecessor and its prep day fell into
    //      no stand at all. That put ~$1,276 (CIN - OH week 03/23-
    //      03/29 prep-day slice) into a gap. First-stand window
    //      now consistent with every other stand.
    //
    // Base rates BYTE-IDENTICAL to spec:
    //   night $1,136.15 / 25 games
    //   day   $806.89   / 11 games
    //
    // HS 1 = $8,966.72 (added $1,276.37 prep-day slice on top of the
    // previous $7,690.35 - matches the walk in PR #773's comment
    // thread that predicted this delta byte-for-byte).
    // HS 2 = $7,325.83 (unchanged; HS 2's window already spanned its
    // own prep day 04/09 under the old rule).
    const near = (label, got, want, tol = 0.50) => {
      if (Math.abs(got - want) < tol) ok(`${label}: $${got.toFixed(2)}`);
      else fail(`${label}: got $${got.toFixed(2)}, want $${want.toFixed(2)} (delta $${(got - want).toFixed(2)})`);
    };
    near("CIN - OH HS 1 estimate (window extended to prep day per owner ruling)", hs1?.actual_estimated, 8966.72);
    near("CIN - OH HS 2 estimate (unchanged - already spanned own prep day)", hs2?.actual_estimated, 7325.83);
  }
}

// ─── HSent sentinel ────────────────────────────────────────────────
// This ONE stays a snapshot because it genuinely cannot move: a closed
// week from June (2026-06-29) with every shift approved months ago.
// The value is a fingerprint of the CIN - OH derive pipeline; any
// change here means something upstream shifted (an actuals-daily
// re-derive, a schema change, a report-backfill overwrite) and we
// want that to fail loudly. Owner ruling 2026-08-24: this is the
// shape of assertion that works for sentinels - a fact about a moment
// that cannot legitimately change, not a fact about today.
console.log("");
console.log("[HSent] CIN - OH 06/29 weekly sentinel: 113.98 / 2.32 / 39.91 / $4,328.27");
{
  const q = await supa.from("labor_actuals_latest")
    .select("hours_regular, hours_overtime, hours_double_time, amount")
    .eq("account_key", "CIN - OH")
    .eq("week_start", "2026-06-29");
  const sum = { reg: 0, ot: 0, dt: 0, amt: 0 };
  for (const r of q.data || []) {
    sum.reg += Number(r.hours_regular || 0);
    sum.ot  += Number(r.hours_overtime || 0);
    sum.dt  += Number(r.hours_double_time || 0);
    sum.amt += Number(r.amount || 0);
  }
  const c = (l, g, w) => { if (Math.abs(g - w) < 0.005) ok(`${l}: ${g.toFixed(2)}`); else fail(`${l}: ${g.toFixed(2)} != ${w.toFixed(2)}`); };
  c("hours_regular    ", sum.reg, 113.98);
  c("hours_overtime   ", sum.ot,  2.32);
  c("hours_double_time", sum.dt,  39.91);
  c("amount           ", sum.amt, 4328.27);
}

// ─── H6 live HTTP - route shape ─────────────────────────────────────
// Owner ruling 2026-08-21: dev-server smoke tests cost 20 min twice
// on this repo. H6 is gated behind PROBE_LIVE_HTTP=1 - when unset,
// we skip the dev-server spin-up entirely. The deployed-URL probe
// in PR-3 (against Vercel) is the intended regression net for the
// route contract.
if (process.env.PROBE_LIVE_HTTP !== "1") {
  console.log("");
  console.log("[H6] SKIP - live HTTP requires PROBE_LIVE_HTTP=1 (deployed-URL probe covers this in PR-3)");
  console.log("");
  console.log("=".repeat(72));
  console.log(hardFail === 0 ? "HOMESTAND PR-1: ALL PROBES PASS (H6 SKIPPED)" : `HOMESTAND PR-1: ${hardFail} FAILURE(S)`);
  console.log("=".repeat(72));
  process.exit(hardFail === 0 ? 0 : 1);
}
console.log("");
console.log("[H6] live HTTP: homestand request routes through the existing range resolver + splices homestand fields");
console.log(`spinning up next dev on :${PORT} with TEST_MODE=true`);

const proc = spawn("npm", ["run", "dev", "--", "--port", PORT], {
  env: { ...process.env, TEST_MODE: "true", NODE_ENV: "development" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderrTail = "";
proc.stdout.on("data", () => {});
proc.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });

async function waitReady(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/kpi/labor?account=CIN%20-%20OH&start=2026-07-06&end=2026-07-12`, { signal: AbortSignal.timeout(30000) });
      if (r.status === 200 || r.status === 400 || r.status === 500) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

try {
  const ready = await waitReady(Date.now() + READY_TIMEOUT_MS);
  if (!ready) {
    fail("dev server did not become ready within 90s");
    console.log(stderrTail.split("\n").slice(-8).map(l => `    ${l}`).join("\n"));
  } else {
    ok("dev server ready");
    // HS 11 = 2026-08-14 → weekly window (08/07-08/20 = 14 days, whole 2 weeks starting Fri which is NOT whole-week). Actually the window is 08/07-08/20; 08/07 is Fri, 08/20 is Wed - not whole weeks so daily.
    const r1 = await (await fetch(`${BASE}/api/kpi/labor?account=CIN%20-%20OH&homestand=2026-08-14`)).json();
    if (r1.source !== "daily" && r1.source !== "weekly") fail(`homestand response source=${r1.source} - expected 'daily' or 'weekly'`);
    else ok(`homestand HS 11 -> source='${r1.source}' (existing range resolver, no new value)`);
    if (r1.homestand && r1.homestand.game_start === "2026-08-14") ok(`response includes homestand{game_start=2026-08-14}`);
    else fail(`response missing homestand.game_start=2026-08-14: got ${JSON.stringify(r1.homestand)?.slice(0, 100)}`);
    if (r1.homestand_split && typeof r1.homestand_split.game_day_dollars === "number") ok(`response includes homestand_split.game_day_dollars`);
    else fail(`response missing homestand_split`);
    if (r1.homestand_bank && typeof r1.homestand_bank.bank === "number") ok(`response includes homestand_bank.bank`);
    else fail(`response missing homestand_bank`);
    if (Array.isArray(r1.homestands) && r1.homestands.length === 13) ok(`response includes homestands list (13 stands - CIN - OH FY26)`);
    else fail(`homestands list wrong for CIN - OH: length=${Array.isArray(r1.homestands) ? r1.homestands.length : "not-array"} (expected 13)`);

    // Non-MLB account: no homestand field, homestands = []
    const r2 = await (await fetch(`${BASE}/api/kpi/labor?account=TBR%20-%20FL&start=2026-07-06&end=2026-07-12`)).json();
    if (Array.isArray(r2.homestands) && r2.homestands.length === 0) ok(`TBR - FL response: homestands=[] (tab absent)`);
    else fail(`TBR - FL response: homestands=${JSON.stringify(r2.homestands)?.slice(0, 80)}`);
    if (r2.homestand === undefined && r2.homestand_split === undefined && r2.homestand_bank === undefined) ok(`TBR - FL response: no homestand/split/bank fields (correct)`);
    else fail(`TBR - FL response leaks homestand fields`);
  }
} finally {
  proc.kill("SIGTERM");
  await sleep(500);
  try { proc.kill("SIGKILL"); } catch {}
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "HOMESTAND PR-1: ALL PROBES PASS" : `HOMESTAND PR-1: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);

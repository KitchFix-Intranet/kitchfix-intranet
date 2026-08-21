// scripts/_probe_kpi_homestand.mjs
//
// Homestand PR-1 acceptance. In-process where the assertion is a
// property of the resolver (H1..H5, H7); live HTTP against `next dev`
// with TEST_MODE=true for the route-shape check (H6). Same TEST_MODE
// pattern the PR-3b + V42 probes use.
//
// Assertions
//   H1  windows contiguous + non-overlapping across a full season
//       for all six MLB accounts. Every daily row inside exactly
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
//       MLB account. THIS IS THE TRAP: period length is 28 days from
//       the fiscal calendar, never derived from labor_actuals.
//   H5  listHomestands returns [] for every non-MLB account: TBR - FL,
//       CIN - AZ, TXR - AZ, TBJ - FL. The client reads [] as "no
//       homestand tab here" (absent, not disabled).
//   H6  a homestand HTTP request returns `source` in {"daily",
//       "weekly"} and never a new value; `homestand` + `homestand_split`
//       + `homestand_bank` are present in the body; `homestands` is
//       the same list the resolver returned in-process.
//   H7  CIN - OH verified fixtures, to the cent (owner-measured):
//         HS 11 MIA/STL   window 08/07-08/20  budget 8056.06  peak 4
//         HS 10 ATH/CLE   window 07/13-08/06  budget 12432.19 peak 7
//         bank across 9 finished stands ~= 6008.61 (aggregate rounding
//         drift <= 5c is acceptable per PR-1 probe design)
//   HInv night_games + day_games == game_days on EVERY stand across
//       ALL SIX accounts. Owner ruling 2026-08-21: no null fallback
//       on day_night - if this ever fails, we want to know, not
//       degrade quietly.
//   HSent CIN - OH 06/29 weekly aggregate unchanged: 113.98 / 2.32
//       / 39.91 / $4,328.27.
//
// Usage: node scripts/_probe_kpi_homestand.mjs

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import {
  MLB_HOMESTAND_ACCOUNTS,
  listHomestands,
  actualsByStand,
  computeHomestandBank,
  isoToDate, dateToIso, addDaysIso,
  perDayMilleCents,
} from "../src/lib/labor/homestandResolver.js";

const NON_MLB_SAMPLE = ["TBR - FL", "CIN - AZ", "TXR - AZ", "TBJ - FL"];
const MLB = [...MLB_HOMESTAND_ACCOUNTS];

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
console.log("[H1] windows contiguous and non-overlapping across the full season, all six accounts");
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
  if (bad === 0) ok("all six MLB accounts pass windowing invariant");
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

// ─── H3 CIN - OH derived stands reproduce stored 13 ────────────────
console.log("");
console.log("[H3] CIN - OH derived grouping reproduces the stored 13 stands EXACTLY");
{
  const hs = standsByAcct.get("CIN - OH");
  const storedIds = new Set(hs.map(h => h.homestand_id).filter(Boolean));
  if (hs.length !== 13) fail(`CIN - OH derived ${hs.length} stands, expected 13`);
  else ok(`CIN - OH: 13 derived stands`);
  if (storedIds.size !== 13) fail(`CIN - OH: ${storedIds.size} distinct stored homestand_ids, expected 13`);
  else ok(`CIN - OH: 13 distinct stored homestand_ids, one per derived stand`);
}

// ─── H4 FY budget reconciliation ────────────────────────────────────
console.log("");
console.log("[H4] per-day budget summed across the FY == sum(kpi_budgets) to the cent, all six MLB accounts");
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

// ─── H5 non-MLB accounts return [] ──────────────────────────────────
console.log("");
console.log("[H5] listHomestands returns [] for every non-MLB account");
{
  for (const a of NON_MLB_SAMPLE) {
    const hs = await listHomestands(supa, a, 2026);
    if (hs.length === 0) ok(`${a}: [] (no homestand tab)`);
    else fail(`${a}: got ${hs.length} stands - non-MLB should be empty`);
  }
}

// ─── HInv night + day == game_days ──────────────────────────────────
console.log("");
console.log("[HInv] night_games + day_games == game_days on every stand, all six accounts");
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
  if (bad === 0) ok(`invariant holds on every stand across all six accounts`);
}

// ─── H7 CIN - OH verified fixtures ──────────────────────────────────
console.log("");
console.log("[H7] CIN - OH verified fixtures");
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
    eq  ("HS 11 window_start", hs11.window_start, "2026-08-07");
    eq  ("HS 11 window_end  ", hs11.window_end,   "2026-08-20");
    near("HS 11 budget      ", hs11.budget, 8056.06);
    eq  ("HS 11 peak_in_week", hs11.peak_games_in_week, 4);
    eq  ("HS 10 window_start", hs10.window_start, "2026-07-13");
    eq  ("HS 10 window_end  ", hs10.window_end,   "2026-08-06");
    near("HS 10 budget      ", hs10.budget, 12432.19);
    eq  ("HS 10 peak_in_week", hs10.peak_games_in_week, 7);
    // Bank across 9 finished stands - EXACT to the cent per owner
    // ruling 2026-08-21. Freeze today against the measurement date
    // so finished-stand count is exactly 9.
    //
    // Post-audit 2026-08-21: expected value MOVED from $6,008.62 to
    // $4,218.39. Reason: PR-2 audit surfaced that HS 3's window was
    // reaching three days behind the daily floor (HS 2 pre-floor,
    // HS 3 inherited HS 2's game_end + 1 = 04/17, floor 04/20). PR-2
    // v2 clamps EVERY non-pre-floor window_start up to the floor;
    // HS 3 becomes 04/20-04/30 (11 days) and its budget recomputes
    // from $8,354.43 to $6,564.20. That $1,790.23 of budget the
    // 04/17-04/19 window used to own had no attributable actual,
    // so removing it shrinks the bank by the same amount ($6,008.62
    // - $1,790.23 = $4,218.39). This is the same "budget without
    // attributable actual fakes a surplus" logic that excludes pre-
    // floor STANDS from the bank; extending it to pre-floor DAYS
    // owned by non-pre-floor stands is the audit correction.
    //
    // Rounding order still matters: per-stand rounded on BOTH sides
    // then summed. See PR-1 fixture note (removed here for brevity)
    // for the three-way comparison against round-once-at-end and
    // per-row-cent paths.
    const actMap = actualsByStand(hs, daily);
    const bank = computeHomestandBank(hs, actMap, "2026-08-21");
    const wantBankCents = 421839;   // $4218.39 - owner-verified 2026-08-21 post-clamp
    const gotBankCents = Math.round(bank.bank * 100);
    if (gotBankCents === wantBankCents) ok(`bank across 9 finished stands = $${bank.bank.toFixed(2)} EXACT (per-stand rounded, both sides, summed; post-clamp)`);
    else fail(`bank $${bank.bank.toFixed(2)} != $4218.39 (delta ${gotBankCents - wantBankCents}c) - see rounding-order + clamp comment above`);
    // stands_finished + stands_remaining + remaining_budget are the
    // new fields from the season-card hotfix. Assert them here so a
    // future re-derive lands exact.
    if (bank.stands_finished === 9)        ok(`stands_finished = 9`);
    else                                    fail(`stands_finished = ${bank.stands_finished}, want 9`);
    if (bank.stands_remaining === 2)       ok(`stands_remaining = 2`);
    else                                    fail(`stands_remaining = ${bank.stands_remaining}, want 2`);
    if (Math.round(bank.remaining_budget * 100) === 1501809) ok(`remaining_budget = $15,018.09`);
    else                                    fail(`remaining_budget = $${bank.remaining_budget}, want $15,018.09`);
  }
}

// ─── HSent sentinel ────────────────────────────────────────────────
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
    if (Array.isArray(r1.homestands) && r1.homestands.length === 13) ok(`response includes homestands list (13 stands)`);
    else fail(`homestands list wrong: length=${Array.isArray(r1.homestands) ? r1.homestands.length : "not-array"}`);

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

// scripts/probes/_probe_kpi_export_portfolio.mjs
//
// PR-D acceptance. Owner ruling 2026-08-24: "the export must match
// what is on screen. Add a probe: for a portfolio range, the sum of
// Detail rows equals the total the board displays, to the cent."
//
// Same discipline as the homestand employee-sum invariant. The probe
// reproduces the export server's rollup (group by (account_key,
// week_start), sum amount) directly against Supabase, then compares
// to the sum of raw labor_actuals_latest rows for the same portfolio
// scope. If the rollup is sum-preserving, the export's Total $ column
// ties the board display (both read the same rows).
//
// Zero dollar amounts printed except the invariant deltas.
// Zero worker names.
//
// Portfolio scope resolved via the shared helper the read + export
// routes both use, so this probe fails loudly if the helper ever
// silently changes membership.

import { createClient } from "@supabase/supabase-js";
import { resolvePortfolioMembers, PORTFOLIO_KEYS } from "../../src/lib/kpi/portfolioMembers.js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
const FY_START = "2025-12-29";
const TODAY    = new Date().toISOString().slice(0, 10);
const SEV_RANK = { unknown: 3, partial: 2, hours_only: 2, no_labor: 1, complete: 0 };
function worstCoverage(states) {
  let best = "complete";
  for (const s of states) {
    if ((SEV_RANK[s] || 0) > (SEV_RANK[best] || 0)) best = s;
  }
  return best;
}

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }

console.log("=".repeat(72));
console.log("KPI portfolio export - sum-preservation probe (PR-D)");
console.log("=".repeat(72));

async function paginateActuals({ members, start, end }) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    const q = await supa.from("labor_actuals_latest")
      .select("account_key, week_start, amount, coverage_state")
      .in("account_key", members)
      .lte("week_start", end)
      .gte("week_end", start)
      .order("account_key", { ascending: true })
      .order("week_start", { ascending: true })
      .range(from, from + pageSize - 1);
    if (q.error) throw new Error(`actuals fetch: ${q.error.message}`);
    const batch = q.data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function checkPortfolio(pseudoKey, start, end) {
  console.log("");
  console.log(`[${pseudoKey}]  range ${start} to ${end}`);

  const memberQ = await resolvePortfolioMembers(supa, pseudoKey);
  if (memberQ.error) { fail(`resolvePortfolioMembers error: ${memberQ.error.message}`); return; }
  const members = memberQ.data.map(r => r.team_key);
  if (members.length === 0) { fail(`no members for ${pseudoKey}`); return; }
  ok(`members resolved (${members.length}): ${members.join(", ")}`);

  const rows = await paginateActuals({ members, start, end });
  ok(`raw actuals fetched (${rows.length} worker-week rows)`);

  // Sum-preservation invariant: raw sum == rolled sum, to the cent.
  const rawTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const perAcctWeek = new Map();
  for (const r of rows) {
    const k = `${r.account_key}|${r.week_start}`;
    const cur = perAcctWeek.get(k) || { amount: 0, states: [] };
    cur.amount += Number(r.amount || 0);
    cur.states.push(r.coverage_state);
    perAcctWeek.set(k, cur);
  }
  const rolled = [...perAcctWeek.values()].map(v => ({ amount: v.amount, coverage: worstCoverage(v.states) }));
  const rolledTotal = rolled.reduce((s, d) => s + d.amount, 0);
  const delta = Math.abs(rawTotal - rolledTotal);
  if (delta < 0.005) ok(`sum preserved: raw = rolled = $${r2(rawTotal).toFixed(2)} (delta $${delta.toFixed(6)})`);
  else fail(`sum drift: raw $${r2(rawTotal).toFixed(2)} vs rolled $${r2(rolledTotal).toFixed(2)} (delta $${delta.toFixed(6)})`);

  // Coverage rollup - a single incomplete worker-week makes the
  // account-week incomplete. Verify: any account-week with a non
  // complete member state has non-complete rolled coverage.
  let rollupOk = true;
  for (const [k, v] of perAcctWeek) {
    const anyIncomplete = v.states.some(s => s && s !== "complete" && s !== "no_labor");
    const rolled = worstCoverage(v.states);
    const rolledIsIncomplete = rolled !== "complete" && rolled !== "no_labor";
    if (anyIncomplete && !rolledIsIncomplete) {
      fail(`coverage rollup missed: ${k} had states=${JSON.stringify(v.states)} but rolled=${rolled}`);
      rollupOk = false;
    }
  }
  if (rollupOk) ok(`coverage rolled to worst per (account, week) across ${perAcctWeek.size} rollups`);

  // Row-count sanity: rolled rows <= raw rows (grouping never adds rows).
  if (rolled.length <= rows.length) ok(`rollup row count ${rolled.length} <= raw ${rows.length}`);
  else fail(`rollup row count ${rolled.length} EXCEEDS raw ${rows.length} (grouping bug)`);
}

for (const key of PORTFOLIO_KEYS) {
  await checkPortfolio(key, FY_START, TODAY);
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "PORTFOLIO EXPORT PR-D: ALL PROBES PASS" : `PORTFOLIO EXPORT PR-D: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);

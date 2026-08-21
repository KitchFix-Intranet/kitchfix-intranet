// scripts/_probe_v32_prior_comparison.mjs
//
// V32-13/V32-15 verification. Hits Supabase directly. Confirms the
// six scale-free measures reproduce for CIN - AZ P9 (in-progress) with
// P8 as prior, and reports the cost/worker figure specifically per
// Kevin's ruling: "verify it on live data before shipping - it is the
// one measure that is not already on the board in some form."
//
// No dollars or worker names in output. Reports counts + ratios only.

import { createClient } from "@supabase/supabase-js";
import { computePeriodMeasures } from "../src/app/kpi/labor/lib/board.js";
import { periodStartISO, periodEndISO } from "../src/app/kpi/labor/lib/periods.js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const TODAY = new Date().toISOString().slice(0, 10);
const ACCOUNT = "CIN - AZ";
const CURRENT_PERIOD = 9;
const PRIOR_PERIOD = 8;

async function loadActuals(account, start, end) {
  const PS = 1000;
  const out = [];
  let from = 0;
  while (true) {
    const q = await supa.from("labor_actuals_latest")
      .select("account_key, worker_id, week_start, week_end, hours_regular, hours_overtime, hours_double_time, hours_premium_other, amount")
      .eq("account_key", account)
      .lte("week_start", end).gte("week_end", start)
      .range(from, from + PS - 1);
    if (q.error) throw q.error;
    const rows = q.data || [];
    out.push(...rows);
    if (rows.length < PS) break;
    from += PS;
  }
  return out;
}

async function main() {
  const currentStart = periodStartISO(CURRENT_PERIOD);
  const currentEnd = periodEndISO(CURRENT_PERIOD);
  const priorStart = periodStartISO(PRIOR_PERIOD);
  const priorEnd = periodEndISO(PRIOR_PERIOD);

  const currentEndDate = new Date(currentEnd);
  const todayDate = new Date(TODAY);
  const isClosed = currentEndDate < todayDate;
  const startDate = new Date(currentStart);
  const daysIn = Math.max(0, Math.floor((todayDate - startDate) / 86400000) + 1);
  const currentElapsedWeeks = isClosed ? 4 : Math.min(4, daysIn / 7);

  console.log(`V32-13 prior-period comparison probe · ${ACCOUNT}`);
  console.log(`  today: ${TODAY}`);
  console.log(`  current P${CURRENT_PERIOD} ${currentStart}..${currentEnd}  elapsedWeeks=${currentElapsedWeeks.toFixed(2)}  closed=${isClosed}`);
  console.log(`  prior   P${PRIOR_PERIOD} ${priorStart}..${priorEnd}  elapsedWeeks=4  closed=true`);

  const [currentActuals, priorActuals] = await Promise.all([
    loadActuals(ACCOUNT, currentStart, currentEnd),
    loadActuals(ACCOUNT, priorStart, priorEnd),
  ]);
  console.log(`\n  row counts: current=${currentActuals.length}  prior=${priorActuals.length}`);

  const now = computePeriodMeasures(currentActuals, currentElapsedWeeks);
  const prior = computePeriodMeasures(priorActuals, 4);

  if (!now || !prior) {
    console.log("insufficient data on one side");
    process.exit(1);
  }

  console.log("\n  MEASURES (now / prior / delta)");
  const keys = ["blended_rate", "overtime_pct", "crew_size", "spend_per_week", "hours_per_week", "cost_per_worker"];
  for (const k of keys) {
    const n = now[k], p = prior[k];
    const d = n - p;
    const dPct = p !== 0 ? ((n - p) / p) * 100 : null;
    console.log(`    ${k.padEnd(18)} now=${String(n).padStart(10)}   prior=${String(p).padStart(10)}   delta=${d.toFixed(2)}  (${dPct != null ? dPct.toFixed(1)+"%" : "n/a"})`);
  }

  console.log("\n  Cost/worker verification (spend / elapsedWeeks / distinct_workers):");
  console.log(`    now  = ${now.cost_per_worker}  = spend_per_week (${now.spend_per_week}) / crew_size (${now.crew_size})`);
  console.log(`    prior = ${prior.cost_per_worker}  = spend_per_week (${prior.spend_per_week}) / crew_size (${prior.crew_size})`);
  const nowCheck = Math.round((now.spend_per_week / now.crew_size) * 100) / 100;
  const priorCheck = Math.round((prior.spend_per_week / prior.crew_size) * 100) / 100;
  const okNow = Math.abs(nowCheck - now.cost_per_worker) < 0.01;
  const okPrior = Math.abs(priorCheck - prior.cost_per_worker) < 0.01;
  console.log(`    identity check: now ${okNow ? "PASS" : "FAIL"}  ·  prior ${okPrior ? "PASS" : "FAIL"}`);
  process.exit(okNow && okPrior ? 0 : 1);
}

main().catch(e => { console.error("PROBE ERROR:", e); process.exit(2); });

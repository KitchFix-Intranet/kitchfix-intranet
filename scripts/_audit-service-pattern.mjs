// scripts/_audit-service-pattern.mjs
// Read-only service-pattern audit (plan v2.67, Task 1/2/3).
// Emits per-account cross-tabs + summary datums to stdout as JSON.
// The audit doc quotes both the queries used here AND the numbers below.
//
// Run: node --env-file=.env.local scripts/_audit-service-pattern.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and service role required");
const sb = createClient(url, key, { auth: { persistSession: false } });

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR_START = `${new Date().getUTCFullYear()}-01-01`;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function paginateAll(runPage) {
  const all = []; let from = 0;
  for (;;) {
    const { data, error } = await runPage(from, from + 999);
    if (error) throw error;
    all.push(...(data || []));
    if ((data || []).length < 1000) return all;
    from += 1000;
  }
}

// ─── Accounts + phase windows ──────────────────────────────────────
const { data: accounts, error: acctErr } = await sb
  .from("accounts")
  .select("team_key, level, billing_model, has_homestand_schedule")
  .order("team_key");
if (acctErr) throw acctErr;

const { data: phaseRows, error: phaseErr } = await sb
  .from("sc_phase_calendar")
  .select("account_key, phase, start_date, end_date")
  .order("account_key")
  .order("start_date");
if (phaseErr) throw phaseErr;

const phasesByAccount = {};
for (const p of phaseRows) {
  if (!phasesByAccount[p.account_key]) phasesByAccount[p.account_key] = [];
  phasesByAccount[p.account_key].push(p);
}
function phaseForDate(accountKey, date) {
  const rows = phasesByAccount[accountKey] || [];
  for (const p of rows) if (date >= p.start_date && date <= p.end_date) return p.phase;
  return null;
}

// ─── Task 1: cross-tab per account ─────────────────────────────────
// Query: SELECT account_key, service_date, projected_count FROM
//   sc_daily_projections ORDER BY id RANGE (paginated).
// Reduce to per-(account, service_date): served if any projected_count > 0.
console.log("=== Task 1 - service pattern per account (from sc_daily_projections)\n");

const projRows = await paginateAll((from, to) => sb
  .from("sc_daily_projections")
  .select("account_key, service_date, projected_count")
  .order("id")
  .range(from, to));
console.log(`Total sc_daily_projections rows: ${projRows.length}\n`);

// Build per-(account, date) served flag
const perDate = new Map();
for (const r of projRows) {
  const k = `${r.account_key}|${r.service_date}`;
  const prev = perDate.get(k);
  const served = Number(r.projected_count) > 0;
  if (!prev) perDate.set(k, { account_key: r.account_key, service_date: r.service_date, served });
  else if (served) prev.served = true;
}

const task1PerAccount = {};
for (const a of accounts) {
  const isPast = (d) => d < TODAY;
  const rows = [...perDate.values()].filter((x) => x.account_key === a.team_key);
  const summary = {
    account_key: a.team_key,
    level: a.level,
    billing_model: a.billing_model,
    has_homestand_schedule: a.has_homestand_schedule,
    total_dates: rows.length,
    past_dates: rows.filter((r) => isPast(r.service_date)).length,
    future_dates: rows.filter((r) => !isPast(r.service_date)).length,
    // DOW cross-tab: dow -> { past: {served,not}, future: {served,not} }
    dow_cross: {},
    // DOW x phase (PDC accounts only). Key = "dow_idx|phase".
    dow_phase_cross: {},
    // Sunday served details for the CIN-AZ deep dive
    sunday_served: [],
    sunday_not: [],
  };
  for (let d = 0; d < 7; d++) summary.dow_cross[DOW[d]] = { past_served: 0, past_not: 0, future_served: 0, future_not: 0 };
  for (const r of rows) {
    const dt = new Date(r.service_date + "T12:00:00");
    const dowIdx = dt.getUTCDay();
    const dow = DOW[dowIdx];
    const past = isPast(r.service_date);
    const cell = summary.dow_cross[dow];
    if (past) { if (r.served) cell.past_served++; else cell.past_not++; }
    else { if (r.served) cell.future_served++; else cell.future_not++; }
    // Phase cross (PDC accounts only)
    const ph = phaseForDate(a.team_key, r.service_date);
    if (ph) {
      const k = `${dow}|${ph}`;
      if (!summary.dow_phase_cross[k]) summary.dow_phase_cross[k] = { served: 0, not: 0 };
      if (r.served) summary.dow_phase_cross[k].served++;
      else summary.dow_phase_cross[k].not++;
    }
    // Sunday detail (any account)
    if (dow === "Sun") {
      const rec = { date: r.service_date, phase: ph };
      if (r.served) summary.sunday_served.push(rec);
      else summary.sunday_not.push(rec);
    }
  }
  task1PerAccount[a.team_key] = summary;
}

// Print DOW cross-tab per account, past + future
for (const [ak, s] of Object.entries(task1PerAccount)) {
  console.log(`\n── ${ak} (level=${s.level}, billing=${s.billing_model || "NULL"}, has_hs=${s.has_homestand_schedule}) ──`);
  console.log(`  total dates:  ${s.total_dates}  (past=${s.past_dates}, future=${s.future_dates})`);
  console.log(`  DOW     past-served  past-not  future-served  future-not`);
  for (const dow of DOW) {
    const c = s.dow_cross[dow];
    console.log(`  ${dow.padEnd(4)}  ${String(c.past_served).padStart(11)}  ${String(c.past_not).padStart(8)}  ${String(c.future_served).padStart(13)}  ${String(c.future_not).padStart(10)}`);
  }
  // DOW x phase (only if account has phases)
  if (Object.keys(s.dow_phase_cross).length > 0) {
    console.log(`  DOW x PHASE  (served/not):`);
    // Collect unique phases + sort by phase-name
    const phases = [...new Set(Object.keys(s.dow_phase_cross).map((k) => k.split("|")[1]))].sort();
    console.log(`  DOW  ` + phases.map((p) => p.padStart(16)).join(""));
    for (const dow of DOW) {
      const cells = phases.map((p) => {
        const c = s.dow_phase_cross[`${dow}|${p}`];
        return c ? `${c.served}/${c.not}`.padStart(16) : "  -/-".padStart(16);
      });
      console.log(`  ${dow.padEnd(4)}` + cells.join(""));
    }
  }
}

// Task 1 direct answers
console.log(`\n\n=== Task 1 direct answers\n`);

// Q2: CIN-AZ served Sundays by phase
const cinAz = task1PerAccount["CIN - AZ"];
if (cinAz) {
  console.log(`Q2. CIN-AZ served Sundays by phase:`);
  const byPhase = {};
  for (const r of cinAz.sunday_served) {
    const k = r.phase || "(no phase)";
    byPhase[k] = (byPhase[k] || 0) + 1;
  }
  for (const [ph, n] of Object.entries(byPhase).sort((a, b) => b[1] - a[1])) {
    console.log(`   ${n.toString().padStart(3)}  ${ph}`);
  }
  console.log(`   TOTAL served Sundays: ${cinAz.sunday_served.length}`);
  console.log(`   TOTAL non-served Sundays: ${cinAz.sunday_not.length}`);
  console.log(`\n   Served Sunday dates:`);
  for (const r of cinAz.sunday_served) console.log(`     ${r.date}  (phase: ${r.phase || "(no phase)"})`);
}

// ─── Task 2: actuals contamination ────────────────────────────────
console.log(`\n\n=== Task 2 - actuals contamination (from sc_daily_actuals_history)\n`);

// Query: SELECT changed_by, changed_at, account_key, service_id, service_date,
// old_count, new_count FROM sc_daily_actuals_history.
// Criterion: obvious test signatures = changed_by contains "test" (case-insensitive)
// OR changed_by == "system" OR contains "@example." OR anonymous-shaped patterns.
// Also flag: entries where new_count is >999 (implausibly high for a per-service meal count).

const histRows = await paginateAll((from, to) => sb
  .from("sc_daily_actuals_history")
  .select("account_key, service_id, service_date, old_count, new_count, changed_by, changed_at")
  .order("id")
  .range(from, to));
console.log(`Total sc_daily_actuals_history rows: ${histRows.length}`);

// Group by changed_by to see what identities are writing
const authorCounts = {};
for (const r of histRows) authorCounts[r.changed_by || "(null)"] = (authorCounts[r.changed_by || "(null)"] || 0) + 1;
const authorsSorted = Object.entries(authorCounts).sort((a, b) => b[1] - a[1]);
console.log(`\nchanged_by breakdown (identities and their history-row counts):`);
for (const [author, n] of authorsSorted) console.log(`  ${n.toString().padStart(6)}  ${author}`);

// Test-signature counts
const testAuthorRE = /test|smoke|dev|localhost|@example\.|@test\.|kf-test/i;
const testHistRows = histRows.filter((r) => testAuthorRE.test(r.changed_by || ""));
console.log(`\nTest-signature history rows (changed_by matches ${testAuthorRE}): ${testHistRows.length}`);

// Implausibly high values
const implausibleHistRows = histRows.filter((r) => Number(r.new_count) > 999);
console.log(`History rows with new_count > 999: ${implausibleHistRows.length}`);
if (implausibleHistRows.length > 0) {
  const bad = implausibleHistRows.slice(0, 5);
  for (const r of bad) console.log(`  ${r.service_date}  ${r.account_key}  changed_by=${r.changed_by}  new=${r.new_count}`);
}

// Estimate impact on the 208 post-mark cancellations: post-mark cancellations
// are days where sc_daily_actuals rows exist with all-zero actual_count for that
// day. Fetch sc_daily_actuals YTD for those accounts and see how many of the
// post-mark days had at least one history entry from a test-signature author.
console.log(`\nEffect on 208 post-mark cancellations - approximation:`);
console.log(`  A post-mark cancellation day is (has_actuals && all actuals=0) per`);
console.log(`  serviceCalendar.js:326. sc_daily_actuals_history captures value-change`);
console.log(`  events. If a day was CREATED at 0 (no prior nonzero) it has no history`);
console.log(`  row. Only days corrected N->0 leave a trace. Rough test-share only.`);
console.log(`  Test-signature history rows this session: ${testHistRows.length} out of ${histRows.length} total = ${((testHistRows.length / Math.max(1, histRows.length)) * 100).toFixed(1)}%.`);
console.log(`  Post-mark cancellations affected: measurable only if the test-signature`);
console.log(`  authors touched days that later collapsed to all-zero actuals. Not a`);
console.log(`  clean separation - state below.`);

// ─── Task 3: zero-projection dates per account ────────────────────
console.log(`\n\n=== Task 3 - zero-projection dates per account (in-window gaps)\n`);

// For each account, active window = min(service_date) to max(service_date) in
// sc_daily_projections. A "zero-projection date" is a date within [min, max]
// that has NO row in sc_daily_projections. Compare against total in-window
// dates.
for (const a of accounts) {
  const dates = new Set();
  for (const r of projRows) if (r.account_key === a.team_key) dates.add(r.service_date);
  if (dates.size === 0) {
    console.log(`  ${a.team_key.padEnd(15)}  no projection rows`);
    continue;
  }
  const sorted = [...dates].sort();
  const first = sorted[0], last = sorted[sorted.length - 1];
  const dFirst = new Date(first + "T12:00:00");
  const dLast = new Date(last + "T12:00:00");
  const windowDays = Math.round((dLast - dFirst) / 86400000) + 1;
  const missingDates = windowDays - dates.size;
  console.log(`  ${a.team_key.padEnd(15)}  window=${first}..${last} (${windowDays}d)  with_proj=${dates.size}  zero-proj=${missingDates}  (${((missingDates / windowDays) * 100).toFixed(1)}%)`);
}

// scripts/_probe_v42_sentinel.mjs
//
// V42 PR-A acceptance: prove the migration + derive change did not
// move a single dollar or hour, and report the new anomaly counts
// once the re-derive has populated the columns.
//
// Runs against real Supabase. Runs in TWO poses:
//   1. Pre-migration / pre-re-derive - sentinel MUST pass, new
//      columns absent-or-null across the board.
//   2. Post-migration + post-re-derive - sentinel MUST pass
//      (identical values), new columns populated, anomaly counts
//      report roughly 18 no-clock-out across all accounts for the
//      current week (Kevin's measurement 2026-08-20).
//
// The sentinel assertion is the load-bearing one. Any drift from
// 113.98 / 2.32 / 39.91 / $4,328.27 for CIN - OH week 2026-06-29
// means the derive change touched a value it should not have and
// the FIRST thing to investigate.
//
// Assertions
//   S1  CIN - OH week 2026-06-29 aggregate: sum(hours_regular)
//       = 113.98, sum(hours_overtime) = 2.32, sum(hours_double_time)
//       = 39.91, sum(amount) = 4,328.27
//   S2  presence of the five V42 columns in the labor_actuals
//       select (schema visible)
//   S3  report only: draft_entry_count, draft_hours, and the three
//       anomaly counts summed across the CURRENT week (Monday of
//       the report date) for all accounts. Expected post-re-derive:
//       ~18 anomaly_no_clockout. If all NULL, note "pre-re-derive
//       shape" and continue.
//
// Usage: node --env-file=.env.local scripts/_probe_v42_sentinel.mjs

import { createClient } from "@supabase/supabase-js";

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
console.log("V42 PR-A sentinel probe");
console.log("=".repeat(72));

// ─── S1 - CIN - OH week 2026-06-29 sentinel ─────────────────────────
console.log("");
console.log("[S1] CIN - OH week 2026-06-29 aggregate: hours + dollars unmoved");
{
  const q = await supa.from("labor_actuals")
    .select("hours_regular, hours_overtime, hours_double_time, amount")
    .eq("account_key", "CIN - OH")
    .eq("week_start", "2026-06-29");
  if (q.error) { fail(`query error: ${q.error.message}`); }
  else if (!q.data || q.data.length === 0) { fail("no rows returned for CIN - OH 2026-06-29"); }
  else {
    const sums = { reg: 0, ot: 0, dt: 0, amt: 0 };
    for (const r of q.data) {
      sums.reg += Number(r.hours_regular || 0);
      sums.ot  += Number(r.hours_overtime || 0);
      sums.dt  += Number(r.hours_double_time || 0);
      sums.amt += Number(r.amount || 0);
    }
    const check = (label, got, want) => {
      if (Math.abs(got - want) < 0.005) ok(`${label}: ${got.toFixed(2)} == ${want.toFixed(2)}`);
      else fail(`${label}: ${got.toFixed(2)} != ${want.toFixed(2)} - DRIFT (investigate first)`);
    };
    check("hours_regular    ", sums.reg,   113.98);
    check("hours_overtime   ", sums.ot,    2.32);
    check("hours_double_time", sums.dt,    39.91);
    check("amount           ", sums.amt,   4328.27);
  }
}

// ─── S2 - schema visibility (pass/fail flips post-apply) ───────────
console.log("");
console.log("[S2] the five V42 columns are selectable on labor_actuals");
let columnsApplied = false;
{
  const q = await supa.from("labor_actuals")
    .select("draft_entry_count, draft_hours, anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h")
    .limit(1);
  if (q.error) {
    if (/does not exist/i.test(q.error.message)) {
      note("columns not yet applied - expected before Kevin runs the migration in Studio");
    } else {
      fail(`schema probe error: ${q.error.message}`);
    }
  } else {
    columnsApplied = true;
    ok("all five columns present on labor_actuals (draft_entry_count / draft_hours / anomaly_no_clockout / anomaly_under_1h / anomaly_over_16h)");
  }
}

// ─── S3 - current-week anomaly report ──────────────────────────────
// Report only; not a pass/fail (except that all NULLs before
// re-derive is normal, not a failure). Skipped if S2 says columns
// are not applied yet.
console.log("");
console.log("[S3] current-week anomaly report (Monday of report date, all accounts)");
if (!columnsApplied) {
  skip("columns not applied yet - re-run this probe post-apply + post-re-derive");
} else {
  // Anchor to the fiscal week (Monday) containing today.
  const now = new Date();
  const dow = now.getUTCDay();               // 0=Sun ... 1=Mon
  const daysBackToMon = (dow + 6) % 7;       // Mon->0, Sun->6
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - daysBackToMon);
  const mondayISO = mon.toISOString().slice(0, 10);
  const q = await supa.from("labor_actuals")
    .select("account_key, draft_entry_count, draft_hours, anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h")
    .eq("week_start", mondayISO);
  if (q.error) { fail(`current-week query error: ${q.error.message}`); }
  else {
    const rows = q.data || [];
    const nonNull = rows.filter(r =>
      r.draft_entry_count != null || r.draft_hours != null ||
      r.anomaly_no_clockout != null || r.anomaly_under_1h != null || r.anomaly_over_16h != null
    );
    if (nonNull.length === 0) {
      note(`week ${mondayISO}: ${rows.length} rows, all V42 columns NULL - pre-re-derive shape (expected before Kevin runs the derive with the new code)`);
    } else {
      const sums = { draft: 0, hrs: 0, no_clockout: 0, under_1h: 0, over_16h: 0 };
      for (const r of rows) {
        sums.draft       += Number(r.draft_entry_count || 0);
        sums.hrs         += Number(r.draft_hours || 0);
        sums.no_clockout += Number(r.anomaly_no_clockout || 0);
        sums.under_1h    += Number(r.anomaly_under_1h || 0);
        sums.over_16h    += Number(r.anomaly_over_16h || 0);
      }
      const distinctAccounts = new Set(rows.filter(r => (Number(r.draft_entry_count) || 0) > 0).map(r => r.account_key));
      note(`week ${mondayISO}: ${rows.length} worker-week rows across ${distinctAccounts.size} accounts with draft entries`);
      note(`  draft_entry_count total = ${sums.draft}`);
      note(`  draft_hours total       = ${sums.hrs.toFixed(2)}`);
      note(`  anomaly_no_clockout     = ${sums.no_clockout}  (Kevin measured ~18 on 2026-08-20)`);
      note(`  anomaly_under_1h        = ${sums.under_1h}`);
      note(`  anomaly_over_16h        = ${sums.over_16h}`);
    }
  }
}

// ─── S4 - CLOSED-WEEK DRAFT SURVEY ─────────────────────────────────
// Kevin wants closed-week drafts surfaced, not smoothed. Every
// closed week is expected to be zero today (measured 2026-08-20);
// anything non-zero is unapproved labor sitting in a period that is
// supposed to be final - a real finding worth naming, not a bug.
console.log("");
console.log("[S4] closed-week draft survey (draft_hours > 0 on any week with week_end < today)");
if (!columnsApplied) {
  skip("columns not applied yet");
} else {
  const todayISO = new Date().toISOString().slice(0, 10);
  const q = await supa.from("labor_actuals")
    .select("account_key, week_start, week_end, worker_id, draft_entry_count, draft_hours, anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h")
    .lt("week_end", todayISO)
    .gt("draft_hours", 0)
    .order("week_start", { ascending: false })
    .order("account_key");
  if (q.error) { fail(`closed-week query error: ${q.error.message}`); }
  else {
    const rows = q.data || [];
    if (rows.length === 0) {
      ok("no closed week has draft_hours > 0 (matches Kevin's 2026-08-20 measurement)");
    } else {
      note(`FINDING: ${rows.length} closed-week worker-week rows with draft_hours > 0 - unapproved labor in a period that is supposed to be final`);
      // Group by (account, week) for a readable rollup.
      const byWeek = new Map();
      for (const r of rows) {
        const k = `${r.account_key}|${r.week_start}`;
        const cur = byWeek.get(k) || { account: r.account_key, week: r.week_start, workers: 0, hours: 0, no_clockout: 0, under_1h: 0, over_16h: 0 };
        cur.workers += 1;
        cur.hours += Number(r.draft_hours || 0);
        cur.no_clockout += Number(r.anomaly_no_clockout || 0);
        cur.under_1h += Number(r.anomaly_under_1h || 0);
        cur.over_16h += Number(r.anomaly_over_16h || 0);
        byWeek.set(k, cur);
      }
      for (const v of [...byWeek.values()].sort((a, b) => b.week.localeCompare(a.week) || a.account.localeCompare(b.account))) {
        note(`  ${v.account}  wk ${v.week}  workers=${v.workers}  draft_hours=${v.hours.toFixed(2)}  anomalies=${v.no_clockout}/${v.under_1h}/${v.over_16h} (no-clockout / under-1h / over-16h)`);
      }
    }
  }
}

// ─── S5 - CURRENT-WEEK ANOMALIES BY ACCOUNT ────────────────────────
// Kevin wants concentration vs. spread. If the 18 no-clockout entries
// live at one site, that is an operator finding; if they are spread,
// that is a signal in the data itself.
console.log("");
console.log("[S5] current-week anomaly counts by account (concentration vs. spread)");
if (!columnsApplied) {
  skip("columns not applied yet");
} else {
  const now = new Date();
  const dow = now.getUTCDay();
  const daysBackToMon = (dow + 6) % 7;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() - daysBackToMon);
  const mondayISO = mon.toISOString().slice(0, 10);
  const q = await supa.from("labor_actuals")
    .select("account_key, draft_entry_count, draft_hours, anomaly_no_clockout, anomaly_under_1h, anomaly_over_16h")
    .eq("week_start", mondayISO);
  if (q.error) { fail(`current-week per-account query error: ${q.error.message}`); }
  else {
    const rows = q.data || [];
    const byAcct = new Map();
    for (const r of rows) {
      const k = r.account_key;
      const cur = byAcct.get(k) || { draft_entries: 0, draft_hours: 0, no_clockout: 0, under_1h: 0, over_16h: 0 };
      cur.draft_entries += Number(r.draft_entry_count || 0);
      cur.draft_hours += Number(r.draft_hours || 0);
      cur.no_clockout += Number(r.anomaly_no_clockout || 0);
      cur.under_1h += Number(r.anomaly_under_1h || 0);
      cur.over_16h += Number(r.anomaly_over_16h || 0);
      byAcct.set(k, cur);
    }
    const accts = [...byAcct.entries()]
      .filter(([, v]) => v.draft_entries > 0 || v.no_clockout > 0 || v.under_1h > 0 || v.over_16h > 0)
      .sort((a, b) => b[1].no_clockout - a[1].no_clockout || a[0].localeCompare(b[0]));
    if (accts.length === 0) {
      note(`week ${mondayISO}: no account has draft entries this week`);
    } else {
      note(`week ${mondayISO}: ${accts.length} account(s) with draft entries or anomalies`);
      note("  account          drafts  draft_hrs  no-clockout  under-1h  over-16h");
      for (const [acct, v] of accts) {
        note(`  ${acct.padEnd(14)}   ${String(v.draft_entries).padStart(6)}   ${v.draft_hours.toFixed(2).padStart(8)}   ${String(v.no_clockout).padStart(10)}   ${String(v.under_1h).padStart(7)}   ${String(v.over_16h).padStart(7)}`);
      }
    }
  }
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "V42 PR-A SENTINEL: PASS" : `V42 PR-A SENTINEL: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);

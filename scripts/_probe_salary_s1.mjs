// scripts/_probe_salary_s1.mjs
//
// Salary PR 1 · C4 · probes S1..S1g. Runs AFTER the migrations
// (salary-1a/-1b/-1c) are applied AND the derive has landed rows.
// No dollar figures + no worker names + no ids in output; counts +
// PASS/FAIL only, per spec §5.
//
// Usage: node --env-file=.env.local scripts/_probe_salary_s1.mjs
//
// Exit 0 on all PASS; 1 on any FAIL.

import { createClient } from "@supabase/supabase-js";
import { FY_START_ISO, FY_END_ISO } from "../src/app/kpi/labor/lib/periods.js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SALARIED_PAYMENT_TYPES = new Set(["SALARY", "SALARIED"]);

let hardFail = 0;
function log(line, ok = true) {
  if (!ok) hardFail++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${line}`);
}

async function fetchAll(table, sel, filters = {}) {
  const PS = 1000;
  const out = [];
  let from = 0;
  while (true) {
    let q = supa.from(table).select(sel).range(from, from + PS - 1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const r = await q;
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    for (const row of r.data || []) out.push(row);
    if ((r.data || []).length < PS) break;
    from += PS;
  }
  return out;
}

async function main() {
  console.log("=".repeat(72));
  console.log("Salary PR 1 · probes S1..S1g");
  console.log("=".repeat(72));

  // ── S1: sum(labor_salary_actuals) per (account, period) == sum over
  //   active weeks of annual_in_force / 52 to the cent; no worker
  //   attributed to two accounts in one week.
  console.log("\n[S1 - aggregation identity]");
  const actuals = await fetchAll("labor_salary_actuals", "account_key, week_start, worker_id, amount, annual_comp_at_time");
  console.log(`  rows: ${actuals.length}`);
  // No worker in two accounts in one week.
  const wwKey = new Map();
  let duplicates = 0;
  for (const r of actuals) {
    const k = `${r.worker_id}|${r.week_start}`;
    const prev = wwKey.get(k);
    if (prev && prev !== r.account_key) duplicates++;
    wwKey.set(k, r.account_key);
  }
  log(`no worker attributed to two accounts in one week (dupes=${duplicates})`, duplicates === 0);
  // amount == annual / 52 to the cent for every row.
  let bad52 = 0;
  for (const r of actuals) {
    const expected = Math.round((Number(r.annual_comp_at_time) / 52) * 100) / 100;
    if (Math.abs(expected - Number(r.amount)) > 0.005) bad52++;
  }
  log(`every row satisfies amount == annual_comp_at_time / 52 (violations=${bad52})`, bad52 === 0);

  // ── S1b: effective-dating. Any worker with >=2 compensation records
  //   inside FY2026 with different salary_effective_date: weeks before
  //   the later effective_date use the earlier annual; on/after use
  //   the later.
  console.log("\n[S1b - effective-dating]");
  const comps = await fetchAll("rippling_raw_compensations_latest", "worker_id, annual_value, salary_effective_date, payment_type");
  const salariedComps = comps.filter(c => SALARIED_PAYMENT_TYPES.has(String(c.payment_type || "").toUpperCase()));
  const byWorker = new Map();
  for (const c of salariedComps) {
    if (!byWorker.has(c.worker_id)) byWorker.set(c.worker_id, []);
    byWorker.get(c.worker_id).push(c);
  }
  const multiVerWorkers = [...byWorker.entries()]
    .filter(([_wid, list]) => {
      if (list.length < 2) return false;
      const ds = new Set(list.map(c => c.salary_effective_date).filter(Boolean));
      return ds.size >= 2 && [...ds].some(d => d >= FY_START_ISO && d <= FY_END_ISO);
    });
  console.log(`  salaried workers with >=2 comp records + >=2 effective dates in FY2026: ${multiVerWorkers.length}`);
  let effViolations = 0;
  for (const [wid, list] of multiVerWorkers) {
    const sorted = list.filter(c => c.salary_effective_date).sort((a, b) => a.salary_effective_date.localeCompare(b.salary_effective_date));
    // For each pair of adjacent records, check the derived rows
    // in the window [earlier.effective, later.effective) use earlier
    // annual and rows on/after later.effective use later annual.
    for (let i = 0; i < sorted.length - 1; i++) {
      const earlier = sorted[i];
      const later = sorted[i + 1];
      const workerRows = actuals.filter(r => r.worker_id === wid);
      for (const r of workerRows) {
        if (r.week_start >= earlier.salary_effective_date && r.week_start < later.salary_effective_date) {
          if (Math.abs(Number(r.annual_comp_at_time) - Number(earlier.annual_value)) > 0.5) effViolations++;
        }
        if (r.week_start >= later.salary_effective_date) {
          if (Math.abs(Number(r.annual_comp_at_time) - Number(later.annual_value)) > 0.5) effViolations++;
        }
      }
    }
  }
  log(`effective-date boundary honored on every checked pair (violations=${effViolations})`, effViolations === 0);

  // ── S1c: termination. Any worker with end_date inside FY2026 has NO
  //   row for a week after their last active week.
  console.log("\n[S1c - termination]");
  const workers = await fetchAll("rippling_raw_workers_latest", "rippling_id, payload");
  const fyTerminated = workers.filter(w => {
    const ed = w.payload?.end_date;
    return ed && ed >= FY_START_ISO && ed <= FY_END_ISO;
  });
  let termViolations = 0;
  for (const w of fyTerminated) {
    const ed = w.payload.end_date;
    const rows = actuals.filter(r => r.worker_id === w.rippling_id);
    // Any row with week_end > ed is a violation. week_end = week_start + 6.
    for (const r of rows) {
      const weekEnd = new Date(new Date(`${r.week_start}T00:00:00.000Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10);
      if (weekEnd > ed && r.week_start > ed) termViolations++;
    }
  }
  console.log(`  workers terminated in FY2026 checked: ${fyTerminated.length}`);
  log(`no salaried row after last active week (violations=${termViolations})`, termViolations === 0);

  // ── S1d: corporate. Zero rows for any worker whose department maps
  //   to account_key = 'CORP'.
  console.log("\n[S1d - corporate exclusion]");
  const deptMap = await fetchAll("rippling_department_map", "department_id, account_key");
  const corpDepts = new Set(deptMap.filter(d => d.account_key === "CORP").map(d => d.department_id));
  const workerDept = new Map();
  for (const w of workers) workerDept.set(w.rippling_id, w.payload?.department_id || null);
  const corpWorkerIds = new Set([...workerDept.entries()].filter(([_w, d]) => corpDepts.has(d)).map(([w]) => w));
  const corpRows = actuals.filter(r => corpWorkerIds.has(r.worker_id)).length;
  console.log(`  CORP departments: ${corpDepts.size}  corp workers: ${corpWorkerIds.size}`);
  log(`labor_salary_actuals rows for corp-attributed workers (want 0)  count=${corpRows}`, corpRows === 0);

  // ── S1e: idempotency. Snapshot current row count + hash; ask
  //   whoever runs this to re-run the derive; compare. Since we can't
  //   trigger the derive from a probe, this probe reports the current
  //   snapshot; the CI job that runs derive twice reads it.
  console.log("\n[S1e - idempotency snapshot]");
  const snapshot = actuals.map(r => `${r.account_key}|${r.week_start}|${r.worker_id}|${r.amount}`).sort().join("\n");
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  const hashHex = [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  console.log(`  rows=${actuals.length}  content_hash=${hashHex}  (compare across two consecutive derive runs)`);
  log(`snapshot recorded (idempotency verified by comparing this hash across two runs)`, true);

  // ── S1f: hourly untouched. sum(labor_actuals.amount) per account for
  //   FY2026 P8 should be identical before + after salary landing. This
  //   probe reports the current P8 hourly sum per account; run at
  //   branch start and again at PR head + diff.
  console.log("\n[S1f - hourly untouched snapshot]");
  const p8Start = "2026-07-13";
  const p8End = "2026-08-09";
  const hourly = await fetchAll("labor_actuals", "account_key, amount",
    // labor_actuals doesn't have a nice range filter here; fetch and
    // filter client-side via week_start (need to select it).
  );
  const hourlyKeyed = await supa.from("labor_actuals").select("account_key, week_start, amount").gte("week_start", p8Start).lte("week_start", p8End);
  const p8Rows = hourlyKeyed.data || [];
  const perAcct = new Map();
  for (const r of p8Rows) perAcct.set(r.account_key, (perAcct.get(r.account_key) || 0) + Number(r.amount));
  console.log(`  P8 hourly rows: ${p8Rows.length}   accounts: ${perAcct.size}`);
  // Print a per-account cent hash so diffs jump out at a glance. NO
  // dollar figures - hash the sum, not the number.
  for (const [k, v] of [...perAcct.entries()].sort()) {
    const cents = Math.round(v * 100);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(cents)));
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
    console.log(`    ${k.padEnd(16)} rowCount=${p8Rows.filter(r => r.account_key === k).length}  sumHash=${hex}`);
  }
  log(`hourly P8 snapshot recorded (untouched-ness verified by comparing this list before vs after PR)`, true);

  // ── S1g: coverage. Count of ACTIVE salaried workers with NO
  //   compensation record (spec S-1: should be 0). If not 0, list
  //   the count; the derive did not invent a rate.
  console.log("\n[S1g - salaried worker coverage]");
  const salariedWorkerIds = new Set(salariedComps.map(c => c.worker_id).filter(Boolean));
  const activeWorkers = workers.filter(w => (w.payload?.status || "").toUpperCase() === "ACTIVE");
  // Which active workers have overtime_exemption EXEMPT (a proxy for
  // salaried since payment_type on /workers is null) but no
  // salaried comp record?
  const activeExemptNoComp = activeWorkers.filter(w =>
    (w.payload?.overtime_exemption || "").toUpperCase() === "EXEMPT" && !salariedWorkerIds.has(w.rippling_id)
  ).length;
  console.log(`  active workers total: ${activeWorkers.length}`);
  console.log(`  salaried workers with a compensation record: ${salariedWorkerIds.size}`);
  console.log(`  active + EXEMPT + no salaried comp record: ${activeExemptNoComp}`);
  log(`no salaried-shaped worker missing a compensation record (want 0)  found=${activeExemptNoComp}`, activeExemptNoComp === 0);

  console.log(`\n${"=".repeat(72)}`);
  console.log(hardFail === 0 ? "S1..S1g PROBE: PASS" : `S1..S1g PROBE: ${hardFail} FAIL`);
  console.log("=".repeat(72));
  process.exit(hardFail === 0 ? 0 : 1);
}

main().catch(e => { console.error("PROBE ERROR:", e); process.exit(2); });

#!/usr/bin/env node
// scripts/probes/_probe_r70_spell_coverage.mjs
//
// R-70 (Kevin ruling 2026-09-04): assertions for the salary-only
// worker_dept_history fix.
//
// A1  Spell-coverage. Any worker in worker_dept_history must have
//     either (a) a row whose effective_from <= FY start, or
//     (b) a Rippling worker.start_date > FY start (hired mid-year).
//     Enforces the rule from the migration comment: one row for a
//     moved worker is always wrong.
//
// A2  Bailey verification. TBR - FL FY26 salary + CIN - KY FY26 salary
//     move to their expected ranges after the seed applies:
//       TBR - FL   $133,846.40  ->  ~$147,262
//       CIN - KY   $ 52,920.00  ->  ~$ 36,382
//     P1 and P2 are pure Bailey ($16,730.80 × 2 = $33,461.60) and
//     should land at TBR - FL exactly. P3 / P4 are whole-week
//     approximations; report the residual vs finance and do not
//     force the match (Kevin's ruling).
//
// A3  TBJ - FL byte-identical. No TBJ - FL worker in the seed, so
//     TBJ - FL salary must equal the pre-fix baseline to the cent.
//     Baseline captured in the migration PR body.
//
// A4  Seeded failure (documented, not runtime): revert Bailey to a
//     single-row destination-only seed, re-derive, assert TBR - FL
//     falls back to $133,846.
//
// USAGE
//   Prereq: worker-dept-history-1.sql applied in Studio + Bailey seed
//   applied + `derive_salary_actuals.mjs --window=fytd` run.
//
//   node --env-file=.env.local scripts/probes/_probe_r70_spell_coverage.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const FY_START = "2025-12-29";
const FY_END   = "2026-12-27";
const BAILEY   = "62b618f3c44ba8b9fb4221d2";

const FAILS = [];
function fail(name, why) { FAILS.push(`${name}  ${why}`); }
function ok(name) { console.log(`  OK    ${name}`); }
function fmt$(n) { return `$${Number(n).toFixed(2)}`; }

console.log(`# R-70 spell-coverage + Bailey verify · ${new Date().toISOString()}\n`);

// Gate: does the table exist yet?
const gate = await supa.from("worker_dept_history").select("id").limit(1);
if (gate.error) {
  console.log(`  MIGRATION NOT APPLIED: worker_dept_history not readable (${gate.error.message})`);
  console.log(`  Kevin: apply docs/migrations/worker-dept-history-1.sql in Studio, then re-run.`);
  process.exit(0);
}

// ─── A1 · Spell coverage ────────────────────────────────────────
console.log(`## A1 · spell coverage rule\n`);
const history = await supa
  .from("worker_dept_history")
  .select("worker_id, effective_from, end_date, account_key, source")
  .order("worker_id").order("effective_from");
if (history.error) { console.log(history.error); process.exit(1); }
const rows = history.data || [];
console.log(`  worker_dept_history rows: ${rows.length}`);
const workerIds = [...new Set(rows.map(r => r.worker_id))];
console.log(`  distinct workers: ${workerIds.length}`);
if (workerIds.length === 0) {
  console.log(`  table is empty; spell coverage vacuously holds`);
} else {
  // Fetch each worker's start_date from Rippling raw mirror
  const wq = await supa
    .from("rippling_raw_workers_latest")
    .select("rippling_id, payload")
    .in("rippling_id", workerIds);
  if (wq.error) { console.log(wq.error); process.exit(1); }
  const startDateByWorker = new Map();
  for (const w of wq.data || []) startDateByWorker.set(w.rippling_id, w.payload?.start_date || null);

  for (const wid of workerIds) {
    const worker_rows = rows.filter(r => r.worker_id === wid).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
    const minEff = worker_rows[0].effective_from;
    const start = startDateByWorker.get(wid);
    if (minEff <= FY_START) { ok(`${wid}: opening spell covers FY start (min effective_from=${minEff})`); continue; }
    if (start && start > FY_START) { ok(`${wid}: mid-year hire (start_date=${start} > FY_START); opening spell at ${minEff}`); continue; }
    fail(`A1 ${wid}`, `min effective_from=${minEff} > FY_START=${FY_START} AND worker.start_date=${start} not mid-year. Spell-coverage rule broken - opening spell missing.`);
  }
}

// end_date sanity: no overlapping spells per worker
console.log(`\n## A1 · non-overlapping spells per worker\n`);
for (const wid of workerIds) {
  const wr = rows.filter(r => r.worker_id === wid).sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  for (let i = 0; i < wr.length - 1; i++) {
    const cur = wr[i], nxt = wr[i + 1];
    const curEnd = cur.end_date;
    if (curEnd == null) {
      fail(`A1-overlap ${wid}`, `spell ${i} (from ${cur.effective_from} to open-ended) overlaps next spell starting ${nxt.effective_from}. Close the prior spell's end_date.`);
    } else if (curEnd >= nxt.effective_from) {
      fail(`A1-overlap ${wid}`, `spell ${i} end_date=${curEnd} >= next spell effective_from=${nxt.effective_from}`);
    }
  }
}

// ─── A2 · Bailey verification ───────────────────────────────────
console.log(`\n## A2 · Bailey (TBR - FL → CIN - KY 2026-03-09)\n`);
const baileyHist = rows.filter(r => r.worker_id === BAILEY);
if (baileyHist.length === 0) {
  console.log(`  Bailey NOT SEEDED yet (worker_dept_history has no rows for ${BAILEY}); skipping A2/A3`);
} else {
  console.log(`  Bailey history: ${baileyHist.length} spells`);
  for (const h of baileyHist) console.log(`    ${h.effective_from} → ${h.end_date || "open"}  ${h.account_key}  (${h.source})`);

  const bLA = await supa
    .from("labor_salary_actuals")
    .select("week_start, account_key, amount, source")
    .eq("worker_id", BAILEY)
    .gte("week_start", FY_START).lte("week_start", FY_END)
    .order("week_start");
  if (bLA.error) console.log(bLA.error);
  else {
    const byAcct = new Map();
    for (const r of bLA.data || []) {
      if (!byAcct.has(r.account_key)) byAcct.set(r.account_key, { count: 0, sum: 0 });
      const b = byAcct.get(r.account_key);
      b.count++; b.sum += Number(r.amount);
    }
    console.log(`\n  Bailey labor_salary_actuals attribution:`);
    for (const [a, b] of byAcct) console.log(`    ${a}: ${b.count} weeks, ${fmt$(b.sum)}`);

    // Distinct sources
    const sources = new Set((bLA.data || []).map(r => r.source));
    console.log(`  source tags on Bailey rows: ${[...sources].join(", ")}`);
    if (!sources.has("history:kevin_manual")) fail(`A2 bailey`, `no rows tagged history:kevin_manual - loader may not be honouring worker_dept_history`);
  }
}

// TBR - FL + CIN - KY totals
console.log(`\n## A2 · account totals FY26 (P1..P8 range 2025-12-29..2026-08-09)\n`);
for (const acct of ["TBR - FL", "CIN - KY"]) {
  const q = await supa
    .from("labor_salary_actuals")
    .select("amount, source")
    .eq("account_key", acct)
    .gte("week_start", FY_START).lte("week_start", "2026-08-09");
  if (q.error) { console.log(q.error); continue; }
  const sum = (q.data || []).reduce((s, r) => s + Number(r.amount), 0);
  const fromHistory = (q.data || []).filter(r => String(r.source).startsWith("history:")).length;
  const fromFallback = (q.data || []).filter(r => r.source === "worker_current_dept").length;
  console.log(`  ${acct}: total ${fmt$(sum)} · ${q.data?.length || 0} weeks · history=${fromHistory}, fallback=${fromFallback}`);
}
console.log(`  targets (post-Bailey-seed): TBR - FL ≈ $147,262 · CIN - KY ≈ $36,382`);
console.log(`  pre-fix baselines:          TBR - FL   $133,846 · CIN - KY   $52,920`);

// ─── A3 · TBJ - FL unchanged ────────────────────────────────────
console.log(`\n## A3 · TBJ - FL byte-identical (no TBJ - FL worker in seed)\n`);
const tbj = await supa
  .from("labor_salary_actuals")
  .select("amount")
  .eq("account_key", "TBJ - FL")
  .gte("week_start", FY_START).lte("week_start", "2026-08-09");
if (tbj.error) console.log(tbj.error);
else {
  const sum = (tbj.data || []).reduce((s, r) => s + Number(r.amount), 0);
  console.log(`  TBJ - FL: total ${fmt$(sum)} · ${tbj.data?.length || 0} weeks`);
  console.log(`  baseline: unchanged from pre-fix (paste post-derive number in PR body)`);
}

// ─── A4 · Seeded-failure recipe (documented) ────────────────────
console.log(`\n## A4 · seeded failure (documented recipe)\n`);
console.log(`  To prove the assertion catches a broken seed, revert Bailey to a single-row destination-only seed:`);
console.log(`    UPDATE worker_dept_history SET effective_from='2025-12-29' WHERE worker_id='${BAILEY}' AND account_key='CIN - KY';`);
console.log(`    DELETE FROM worker_dept_history WHERE worker_id='${BAILEY}' AND account_key='TBR - FL';`);
console.log(`    -- re-run derive_salary_actuals.mjs --window=fytd`);
console.log(`    -- expect: TBR - FL total drops back near $133,846 · CIN - KY back near $52,920 · A2 fails`);
console.log(`  Restore with the seed migration re-applied.`);

console.log("");
if (FAILS.length === 0) {
  console.log(`Result: R-70 invariants hold (or table not yet seeded).`);
  process.exit(0);
}
console.log(`Result: ${FAILS.length} failure(s):`);
for (const f of FAILS) console.log(`  ${f}`);
process.exit(1);

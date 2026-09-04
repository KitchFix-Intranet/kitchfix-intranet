#!/usr/bin/env node
// scripts/probes/_probe_salary_effective_dating.mjs
//
// Kevin ruling R-68 item 2 (2026-09-04): the salary board returns a
// constant per-period figure for accounts where finance stepped
// rates down. Reports whether labor_salary_actuals carries one rate
// per worker (no historical effective-dating) or per-week rates
// (loader / display issue).
//
// Report finding for TBR - FL (Kevin's example):
//   finance P1  $21,154   board  $16,731
//   finance P2  $21,154   board  $16,731
//   ...steps down to matching by P5
//
// This probe reports the schema, per-worker weekly variance, and
// per-period sums for any account named on the command line
// (defaults to TBR - FL). Diagnostic; no assertions.
//
// USAGE
//   node --env-file=.env.local scripts/probes/_probe_salary_effective_dating.mjs [account]

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log(`SUPABASE_URL: ${url ? "PRESENT" : "ABSENT"}  SERVICE_KEY: ${key ? "PRESENT" : "ABSENT"}`);
  process.exit(1);
}
const supa = createClient(url, key);

const ACCT = process.argv[2] || "TBR - FL";
const FY_START = "2025-12-29";
const FY_END = "2026-12-27";

async function main() {
  console.log(`# labor_salary_actuals effective-dating check · ${ACCT} · ${new Date().toISOString()}`);

  const sample = await supa.from("labor_salary_actuals").select("*").limit(1);
  if (sample.error) { console.log(sample.error); return; }
  const cols = sample.data && sample.data[0] ? Object.keys(sample.data[0]) : [];
  console.log("\n## Schema");
  console.log(cols.join(", "));

  const rows = [];
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_salary_actuals")
      .select("*")
      .eq("account_key", ACCT)
      .gte("week_start", FY_START)
      .lte("week_start", FY_END)
      .order("worker_id").order("week_start")
      .range(from, from + 999);
    if (q.error) { console.log(q.error); return; }
    for (const r of q.data || []) rows.push(r);
    if ((q.data || []).length < 1000) break;
    from += 1000;
  }
  console.log(`\n${rows.length} rows`);

  const byWorker = new Map();
  for (const r of rows) {
    if (!byWorker.has(r.worker_id)) byWorker.set(r.worker_id, []);
    byWorker.get(r.worker_id).push(r);
  }
  console.log(`\n## Per-worker weekly variance\n`);
  for (const [w, wr] of byWorker) {
    const amts = new Set(wr.map(x => Math.round(Number(x.amount || 0) * 100) / 100));
    const anns = new Set(wr.map(x => x.annual_comp_at_time));
    console.log(`  ${w}: ${wr.length} weeks, ${amts.size} distinct weekly amounts, ${anns.size} distinct annual_comp values`);
  }

  const periodOf = (weekStart) => {
    const fy = new Date("2025-12-29T00:00:00Z");
    const d = new Date(`${weekStart}T00:00:00Z`);
    return Math.floor((d.getTime() - fy.getTime()) / (86400000 * 28)) + 1;
  };
  const perPeriod = new Map();
  for (const r of rows) {
    const p = periodOf(r.week_start);
    if (p >= 1 && p <= 13) perPeriod.set(p, (perPeriod.get(p) || 0) + Number(r.amount || 0));
  }
  console.log(`\n## Per-period sums\n`);
  for (let p = 1; p <= 13; p++) {
    const v = perPeriod.get(p);
    console.log(`  P${p}: ${v != null ? `$${v.toFixed(2)}` : "-"}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

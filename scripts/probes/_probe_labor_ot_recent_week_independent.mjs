#!/usr/bin/env node
// scripts/probes/_probe_labor_ot_recent_week_independent.mjs
//
// R-38 independent-read assertion. Read-only.
// Kevin's rule: "Assert the hero equals the OT hours for the named
// week from an INDEPENDENT read, not from the same payload field the
// card renders. Two surfaces, one number."
//
// Compares board.overtime.recent_week.ot_hours (what the card hero
// displays) against an independent SQL sum of hours_overtime for the
// same account + week window, straight off labor_actuals_latest.
// Fires on any drift.
//
// USAGE:
//   Local dev server on :3311 with TEST_MODE=true.
//   node --env-file=.env.local --import ./scripts/probes/_at_alias_hook.mjs \
//        scripts/probes/_probe_labor_ot_recent_week_independent.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const BASE = "http://localhost:3311";
const TOL = 0.05;

const cases = [
  // Anchor case: CIN - OH period 7 (2026-06-15 - 2026-07-12), four
  // fiscal weeks; the last CLOSED week within the range must be
  // 07/06 – 07/12. Sentinel-adjacent - overview sentinel #1 asserts
  // the row-level shape for CIN - OH wk 06/29 (hours_overtime=2.32).
  { account: "CIN - OH", start: "2026-06-15", end: "2026-07-12", label: "P7" },
  // Account with recent OT movement.
  { account: "STL - FL", start: "2026-07-13", end: "2026-08-09", label: "P8" },
  // Account with basically zero OT.
  { account: "TXR - AZ", start: "2026-07-13", end: "2026-08-09", label: "P8" },
  // FYTD - most recent closed week overall.
  { account: "STL - FL", start: "2025-12-29", end: "2026-09-01", label: "FYTD" },
];

async function fetchBoard(account, start, end) {
  const url = `${BASE}/api/kpi/labor?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

async function independentOtHours(account, week_start, week_end) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const r = await supa.from("labor_actuals_latest")
      .select("hours_overtime")
      .eq("account_key", account)
      .gte("week_start", week_start)
      .lte("week_end", week_end)
      .order("worker_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(r.error.message);
    rows.push(...(r.data || []));
    if ((r.data || []).length < PAGE) break;
    from += PAGE;
  }
  const sum = rows.reduce((s, r) => s + Number(r.hours_overtime || 0), 0);
  return Math.round(sum * 100) / 100;
}

async function main() {
  console.log(`# R-38 independent-read assertion - ${new Date().toISOString()}`);
  console.log("");

  let pass = 0, fail = 0;
  for (const c of cases) {
    const body = await fetchBoard(c.account, c.start, c.end);
    const ot = body?.board?.overtime;
    const recent = ot?.recent_week;
    if (!recent) {
      console.log(`  SKIP  ${c.account} / ${c.label}  (no recent week - reason=${ot?.applicable_reason})`);
      continue;
    }
    const paylOt = Number(recent.ot_hours || 0);
    const indep = await independentOtHours(c.account, recent.week_start, recent.week_end);
    const ok = Math.abs(paylOt - indep) <= TOL;
    if (ok) pass += 1; else fail += 1;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.account} / ${c.label}  week=${recent.week_start}..${recent.week_end}  payload=${paylOt.toFixed(2)}  independent=${indep.toFixed(2)}`);
  }
  console.log("");
  console.log(`Result: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });

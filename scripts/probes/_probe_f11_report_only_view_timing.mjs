#!/usr/bin/env node
// scripts/probes/_probe_f11_report_only_view_timing.mjs
//
// F-11 measurement. Read-only.
// Purpose: pin down why rippling_report_only_pending_v1 500s on
// ALL/FYTD after purchasing-10's rewrite was supposed to fix it.
//
// Shapes tested (bounded reads only, no COUNT(*) on the view):
//   S1: single account, single 4-week window (should be fastest)
//   S2: single account, FYTD                 (should be < 500ms)
//   S3: 10-account IN, single 4-week window   (portfolio narrow window)
//   S4: 10-account IN, FYTD                   (ALL/FYTD - the 500 case)
//   S5: bare view SELECT LIMIT 1              (view materialisation cost)
//
// Each shape runs three times to expose warm-vs-cold variance. We
// paginate with .range(0, 999) so a 1000+row set doesn't skew the
// timing. If a shape exceeds 8000ms, we mark it as TIMEOUT-CANDIDATE
// (Supabase statement_timeout is 8s by default in the client path).

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const FYTD_START = "2025-12-29";
const FYTD_END = new Date().toISOString().slice(0, 10);
const P9_START = "2026-08-10";
const P9_END = "2026-09-06";

async function accountsFromDb() {
  const r = await supa.from("accounts").select("team_key").neq("team_key", "CORP").order("team_key");
  if (r.error) throw new Error(r.error.message);
  return (r.data || []).map(x => x.team_key);
}

async function timed(label, fn) {
  const times = [];
  let lastRows = null;
  let lastError = null;
  for (let i = 0; i < 3; i += 1) {
    const t0 = Date.now();
    try {
      const r = await fn();
      const ms = Date.now() - t0;
      times.push(ms);
      if (r.error) {
        lastError = r.error;
        console.log(`  ${label.padEnd(58)} run ${i + 1}: ${String(ms).padStart(6)}ms  ERROR: ${r.error.message}`);
      } else {
        lastRows = (r.data || []).length;
        console.log(`  ${label.padEnd(58)} run ${i + 1}: ${String(ms).padStart(6)}ms  rows=${lastRows}`);
      }
    } catch (e) {
      const ms = Date.now() - t0;
      times.push(ms);
      lastError = e;
      console.log(`  ${label.padEnd(58)} run ${i + 1}: ${String(ms).padStart(6)}ms  THROWN: ${e.message}`);
    }
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const min = Math.min(...times);
  const max = Math.max(...times);
  const status = lastError ? "ERROR" : (max > 8000 ? "TIMEOUT-CANDIDATE" : "OK");
  console.log(`  ${label.padEnd(58)} summary: avg=${avg}ms min=${min}ms max=${max}ms  ${status}`);
  console.log("");
  return { times, lastError, lastRows, status };
}

async function main() {
  console.log(`# F-11 timing probe - ${new Date().toISOString()}`);
  const accounts = await accountsFromDb();
  console.log(`# accounts (excl CORP): ${accounts.length} - ${accounts.join(", ")}`);
  console.log("");

  console.log("## S1 - single account, 4-week window (baseline fastest shape)");
  await timed(`view / TBR - FL / P9`, () =>
    supa.from("rippling_report_only_pending_v1")
      .select("parent_txn_id, amount, account_key, purchased_at")
      .eq("account_key", "TBR - FL")
      .gte("purchased_at", P9_START)
      .lte("purchased_at", P9_END)
      .order("parent_txn_id", { ascending: true })
      .range(0, 999));

  console.log("## S2 - single account, FYTD");
  await timed(`view / TBR - FL / FYTD`, () =>
    supa.from("rippling_report_only_pending_v1")
      .select("parent_txn_id, amount, account_key, purchased_at")
      .eq("account_key", "TBR - FL")
      .gte("purchased_at", FYTD_START)
      .lte("purchased_at", FYTD_END)
      .order("parent_txn_id", { ascending: true })
      .range(0, 999));

  console.log("## S3 - IN(all accounts), 4-week window");
  await timed(`view / .in(11 accts) / P9`, () =>
    supa.from("rippling_report_only_pending_v1")
      .select("parent_txn_id, amount, account_key, purchased_at")
      .in("account_key", accounts)
      .gte("purchased_at", P9_START)
      .lte("purchased_at", P9_END)
      .order("parent_txn_id", { ascending: true })
      .range(0, 999));

  console.log("## S4 - IN(all accounts), FYTD  (the ALL/FYTD 500 case)");
  await timed(`view / .in(11 accts) / FYTD`, () =>
    supa.from("rippling_report_only_pending_v1")
      .select("parent_txn_id, amount, account_key, purchased_at")
      .in("account_key", accounts)
      .gte("purchased_at", FYTD_START)
      .lte("purchased_at", FYTD_END)
      .order("parent_txn_id", { ascending: true })
      .range(0, 999));

  console.log("## S5 - bare view SELECT LIMIT 1 (materialisation cost)");
  await timed(`view / LIMIT 1 / no filter`, () =>
    supa.from("rippling_report_only_pending_v1")
      .select("parent_txn_id, amount, account_key, purchased_at")
      .order("parent_txn_id", { ascending: true })
      .range(0, 0));

  console.log("## S6 - bare view full read to gauge total materialisation cost");
  await timed(`view / range(0, 999) / no filter`, () =>
    supa.from("rippling_report_only_pending_v1")
      .select("parent_txn_id, amount, account_key, purchased_at")
      .order("parent_txn_id", { ascending: true })
      .range(0, 999));

  console.log("## S7 - control: same shape on rippling_report_txns_latest (upstream view)");
  await timed(`latest / IN(11 accts alt via work_location) / FYTD`, () =>
    supa.from("rippling_report_txns_latest")
      .select("parent_txn_id, purchased_at, amount, work_location")
      .gte("purchased_at", FYTD_START)
      .lte("purchased_at", FYTD_END)
      .order("parent_txn_id", { ascending: true })
      .range(0, 999));

  console.log("## S8 - route-side reproduction: exact loadReportOnlyPending chunking (200-member IN)");
  const IN_CHUNK = 200;
  const chunk = accounts.slice(0, Math.min(accounts.length, IN_CHUNK));
  await timed(`view / .in(${chunk.length} accts, chunked) / FYTD`, () =>
    supa.from("rippling_report_only_pending_v1")
      .select("parent_txn_id, amount, account_key, purchased_at")
      .in("account_key", chunk)
      .gte("purchased_at", FYTD_START)
      .lte("purchased_at", FYTD_END)
      .order("parent_txn_id", { ascending: true })
      .range(0, 999));

  console.log("## Diagnostic: confirm purchasing-10 rewrite is live");
  const { data: viewsInfo, error: viewErr } = await supa.rpc("_meta_check_view_source", {}).limit(0);
  // Best-effort. If the RPC does not exist, fall back to the row-count invariant.
  if (viewErr) {
    // Fall back: row count + total. purchasing-10 verify note said the row set is
    // UNCHANGED across the three view versions (only planner behaviour changed),
    // so this cannot distinguish 8/9/10. We report the count only as sanity.
    console.log(`  (no _meta_check_view_source RPC; skipping source inspection)`);
  } else if (viewsInfo) {
    console.log(`  view source rows: ${viewsInfo?.length}`);
  }
}

main().catch(e => { console.error(`THROWN: ${e.message || e}`); process.exit(1); });

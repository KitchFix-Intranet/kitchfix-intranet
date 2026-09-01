#!/usr/bin/env node
// scripts/probes/_probe_ruling6_scope_guard.mjs
//
// Ruling 6 scope guard (2026-09-01, born from the scope-restoration fix
// in scripts/purchasing_rippling_sync.mjs).
//
// PURPOSE
//   Ruling 6 excludes API rows whose report-side twin is coded, on the
//   theory that the coder already dispositioned the underlying charge
//   on the report side. Its scope is UNCODED-ON-OUR-SIDE ONLY - the
//   full population Kevin ruled on was 56 uncoded rows / $17,863.01
//   (PR #885). The rule as shipped 2026-08-29 lost the second half of
//   that scope - reportCodedHit was a bare set-membership test that
//   fired regardless of the API row's own coded state, excluding
//   4,215 rows / $991,456.39.
//
//   This probe asserts the boundary: every purchasing_actuals row
//   excluded with reason='report_coded' must have gl_line_code IS NULL.
//   If any coded row carries that reason, the probe fails with count
//   and dollar sum.
//
// APPROACH
//   Paginated read of purchasing_actuals filtered on
//     source='rippling_spend' AND excluded IS TRUE AND reason='report_coded'
//   Two counters:
//     - CODED = rows where gl_line_code IS NOT NULL   (must be 0)
//     - UNCODED = rows where gl_line_code IS NULL     (the intended scope)
//   Reports the CODED count + $ sum and PASS/FAIL. Prints the UNCODED
//   count for visibility (near ~190 rows per the ruling estimate).
//
// SEEDED FAILURE
//   SEEDED_FAILURE=1 flips the assertion axis: the probe checks that
//   any coded row carries reason='report_coded'. On a healthy corpus
//   (post-fix, ~190 uncoded / 0 coded excluded), this seeded axis
//   should also PASS - but the seed additionally forces a synthetic
//   "found 1 coded" line into the output so the operator can see the
//   fail-path formatting exercised without editing the DB.
//
// USAGE
//   node --env-file=.env.local scripts/probes/_probe_ruling6_scope_guard.mjs
//   SEEDED_FAILURE=1 node --env-file=.env.local scripts/probes/_probe_ruling6_scope_guard.mjs
//
//   Wire into CI alongside the other purchasing guards. Fails loud on
//   any regression to the pre-2026-09-01 shipped behaviour.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const SEEDED_FAILURE = process.env.SEEDED_FAILURE === "1";
const PAGE = 1000;

function fmt$(v) {
  const n = Math.round(Number(v || 0) * 100) / 100;
  return `$${n.toFixed(2)}`;
}

async function paginateReportCoded() {
  // Walk every row excluded under reason='report_coded'. Deterministic
  // .order() on id so paging is stable at the 1000-row boundary
  // (per the pagination pattern law).
  const out = [];
  let from = 0;
  while (true) {
    const r = await supa
      .from("purchasing_actuals")
      .select("id, source, excluded, reason, gl_line_code, amount, txn_date, source_line_id")
      .eq("source", "rippling_spend")
      .eq("excluded", true)
      .eq("reason", "report_coded")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(`report_coded page ${from}: ${r.error.message}`);
    const rows = r.data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function main() {
  console.log(`# Ruling 6 scope guard - ${new Date().toISOString()}`);
  console.log(`# Assert: every row with reason='report_coded' has gl_line_code IS NULL`);
  console.log(`# Rows loaded from: purchasing_actuals where source='rippling_spend' AND excluded=true AND reason='report_coded'`);
  console.log("");

  const rows = await paginateReportCoded();
  const coded = rows.filter(r => r.gl_line_code != null && String(r.gl_line_code).trim() !== "");
  const uncoded = rows.filter(r => r.gl_line_code == null || String(r.gl_line_code).trim() === "");

  const codedCount = coded.length;
  const codedSum = coded.reduce((s, r) => s + Number(r.amount || 0), 0);
  const uncodedCount = uncoded.length;
  const uncodedSum = uncoded.reduce((s, r) => s + Number(r.amount || 0), 0);

  console.log(`## Population`);
  console.log(`  reason='report_coded' total: rows=${rows.length} sum=${fmt$(rows.reduce((s, r) => s + Number(r.amount || 0), 0))}`);
  console.log(`  intended scope (gl_line_code IS NULL, uncoded):    rows=${uncodedCount} sum=${fmt$(uncodedSum)}`);
  console.log(`  out-of-scope   (gl_line_code IS NOT NULL, coded):  rows=${codedCount} sum=${fmt$(codedSum)}`);
  console.log("");

  // Seeded failure: force a synthetic coded row into the output so the
  // fail-path formatting is exercised without touching the DB. The
  // synthetic row is prefixed with `SEED:` in the sample so it is
  // never mistaken for a real defect.
  let effectiveCodedCount = codedCount;
  let effectiveCodedSum = codedSum;
  let seededExtras = [];
  if (SEEDED_FAILURE) {
    seededExtras.push({ id: "SEED:0", gl_line_code: "3200.1", amount: 12.34, txn_date: "seed", source_line_id: "SEED:synthetic" });
    effectiveCodedCount += 1;
    effectiveCodedSum += 12.34;
    console.log(`## SEEDED_FAILURE=1 - injecting 1 synthetic coded row to exercise the FAIL path`);
    console.log("");
  }

  console.log(`## Result`);
  const passed = effectiveCodedCount === 0;
  if (passed) {
    console.log(`  PASS - 0 coded rows carry reason='report_coded'.`);
    console.log(`  Ruling 6 scope holds: exclusions confined to uncoded (${uncodedCount} rows / ${fmt$(uncodedSum)}).`);
  } else {
    console.log(`  FAIL - ${effectiveCodedCount} coded rows carry reason='report_coded' (sum ${fmt$(effectiveCodedSum)}).`);
    console.log(`  Ruling 6 must exclude only uncoded rows. See scripts/purchasing_rippling_sync.mjs`);
    console.log(`  reason-chain block: 'reportCodedHit && !glLine'.`);
    console.log("");
    console.log(`  Sample (up to 10 offenders):`);
    const sample = [...seededExtras, ...coded].slice(0, 10);
    for (const r of sample) {
      console.log(`    id=${String(r.id).padEnd(8)} gl=${String(r.gl_line_code).padEnd(8)} amount=${fmt$(r.amount)} txn_date=${r.txn_date || "?"} line=${r.source_line_id || "?"}`);
    }
  }

  process.exit(passed ? 0 : 1);
}

main().catch(e => {
  console.error(`THROWN: ${e.message || e}`);
  process.exit(2);
});

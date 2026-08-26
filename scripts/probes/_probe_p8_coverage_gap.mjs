#!/usr/bin/env node
/**
 * Phase-two ingest coverage probe. Answers Kevin's Part B question
 * BEFORE the new table is populated by walking parent_txn_ids alone:
 *
 * 1) Set of parent_txn_ids in `rippling_report_seen_txns` (report side)
 * 2) Set of distinct parent_txn_ids in `rippling_raw_spend_lines_latest`
 *    (line-item feed side)
 * 3) Difference = report parents the line-item feed has never seen
 * 4) For each such parent_txn_id, decode the MongoDB ObjectID
 *    (first 4 bytes = seconds since epoch) to get the parent's
 *    approximate creation date. Report date range.
 *
 * NO worker or cardholder names in output. Counts + date buckets only.
 */
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("env SUPABASE_URL:              ", SB_URL ? "PRESENT" : "ABSENT");
console.log("env SUPABASE_SERVICE_ROLE_KEY: ", SB_KEY ? "PRESENT" : "ABSENT");
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function pageAll(builder) {
  const out = [];
  const PS = 1000;
  for (let from = 0; ; from += PS) {
    const { data, error } = await builder().range(from, from + PS - 1);
    if (error) { console.error(error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PS) break;
  }
  return out;
}

function objectIdToDate(hex) {
  // Mongo ObjectID first 8 hex chars = seconds since epoch.
  const seconds = Number("0x" + hex.slice(0, 8));
  return new Date(seconds * 1000);
}

async function main() {
  const reportRows = await pageAll(() =>
    supa.from("rippling_report_seen_txns").select("parent_txn_id, loaded_at")
  );
  const reportIds = new Set(reportRows.map(r => r.parent_txn_id).filter(Boolean));
  console.log(`\nrippling_report_seen_txns:               ${reportIds.size} distinct parent_txn_ids`);

  const rawRows = await pageAll(() =>
    supa.from("rippling_raw_spend_lines_latest").select("parent_txn_id")
  );
  const rawIds = new Set((rawRows || []).map(r => r.parent_txn_id).filter(Boolean));
  console.log(`rippling_raw_spend_lines_latest (line-feed): ${rawIds.size} distinct parent_txn_ids`);

  // Intersection + differences
  let both = 0, reportOnly = 0, rawOnly = 0;
  const reportOnlyIds = [];
  for (const id of reportIds) {
    if (rawIds.has(id)) both++;
    else { reportOnly++; reportOnlyIds.push(id); }
  }
  for (const id of rawIds) {
    if (!reportIds.has(id)) rawOnly++;
  }
  console.log(`\nintersection (in both):                  ${both}`);
  console.log(`report-only (line-feed has never seen):  ${reportOnly}`);
  console.log(`raw-only (report has never sent):        ${rawOnly}`);

  // Date range on report-only parents (via ObjectID timestamp)
  if (reportOnlyIds.length > 0) {
    const dates = reportOnlyIds
      .filter(id => /^[0-9a-f]{24}$/i.test(id))
      .map(id => objectIdToDate(id));
    dates.sort((a, b) => a - b);
    const iso = d => d.toISOString().slice(0, 10);
    const first = dates[0];
    const last  = dates[dates.length - 1];
    console.log(`\nreport-only date range (parent ObjectID timestamp):`);
    console.log(`  earliest: ${iso(first)}`);
    console.log(`  latest:   ${iso(last)}`);
    const today = new Date();
    const daysAgo = Math.round((today - last) / 86400000);
    console.log(`  latest is ${daysAgo} days before today (${today.toISOString().slice(0, 10)})`);

    // Distribution by day for the last 30 days
    const byDay = new Map();
    for (const d of dates) {
      const key = iso(d);
      byDay.set(key, (byDay.get(key) || 0) + 1);
    }
    console.log(`\nreport-only distribution by day (last 30 days):`);
    const now = Date.now();
    const days = [...byDay.entries()]
      .filter(([k]) => (now - new Date(k).getTime()) / 86400000 <= 30)
      .sort();
    for (const [day, count] of days) console.log(`  ${day}: ${count}`);
  }

  // Also: how many raw-only ids? Investigate briefly
  if (rawOnly > 0 && rawOnly <= 20) {
    console.log(`\nraw-only IDs (line-feed sees them but report does not, dates):`);
    const rawOnlyIds = [...rawIds].filter(id => !reportIds.has(id));
    for (const id of rawOnlyIds) {
      if (/^[0-9a-f]{24}$/i.test(id)) {
        console.log(`  parent_id ObjectID timestamp: ${objectIdToDate(id).toISOString().slice(0, 10)}`);
      }
    }
  }
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });

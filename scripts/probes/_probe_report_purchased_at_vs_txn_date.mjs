#!/usr/bin/env node
/**
 * INV-P15's Ruling-1 calibration re-measurement, this time driven by
 * the phase-two table `rippling_report_txns` after first ingest.
 *
 * Compares report `purchased_at` (real transaction date) against the
 * derived `txn_date` on rippling_raw_spend_lines_latest (ObjectID
 * timestamp minus 1 day, per Ruling 1 calibration).  Reports how many
 * rows agree, how many drift, and how many cross a fiscal-week
 * boundary.
 *
 * Requires the bridge between raw `external_id`'s ObjectID prefix and
 * the report's `parent_txn_id`.  Same resolver as
 * scripts/purchasing_rippling_sync.mjs:596.
 *
 * NO names, no amounts, no memos.  Counts + date deltas only.
 */
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("env SUPABASE_URL:              ", SB_URL ? "PRESENT" : "ABSENT");
console.log("env SUPABASE_SERVICE_ROLE_KEY: ", SB_KEY ? "PRESENT" : "ABSENT");
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const OBJECTID_HEX24 = /^[a-f0-9]{24}$/;
function parentIdFromExternalId(ext) {
  if (!ext || typeof ext !== "string") return null;
  const idx = ext.indexOf("__");
  if (idx <= 0) return null;
  const tok = ext.slice(0, idx).toLowerCase();
  return OBJECTID_HEX24.test(tok) ? tok : null;
}
function objectIdToTxnDate(hex) {
  // Ruling 1 - ObjectID seconds minus 1 day
  const secs = parseInt(hex.slice(0, 8), 16);
  const ms = (secs - 86400) * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

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

// Fiscal week helper - use ISO week for the comparison (close enough
// for the "same fiscal week" check; if a row drifts across ISO-week
// it very likely drifts across fiscal-week too).
function isoWeek(d) {
  const dt = new Date(d);
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const wk = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

async function main() {
  const txns = await pageAll(() =>
    supa.from("rippling_report_txns").select("parent_txn_id, purchased_at")
  );
  console.log(`\nrippling_report_txns rows: ${txns.length}`);
  const reportByParent = new Map();
  for (const r of txns) {
    if (r.parent_txn_id && r.purchased_at && !reportByParent.has(r.parent_txn_id)) {
      reportByParent.set(r.parent_txn_id, r.purchased_at);
    }
  }
  console.log(`distinct parent_txn_id with purchased_at: ${reportByParent.size}`);

  const raw = await pageAll(() =>
    supa.from("rippling_raw_spend_lines_latest").select("parent_txn_id, external_id")
  );
  console.log(`raw line items: ${raw.length}`);

  let intersect = 0, agree = 0, disagree = 0, weekCross = 0;
  const disagreementSamples = [];
  for (const r of raw) {
    let hex = null;
    if (r.parent_txn_id && OBJECTID_HEX24.test(r.parent_txn_id)) hex = r.parent_txn_id;
    else hex = parentIdFromExternalId(r.external_id);
    if (!hex) continue;
    const reportDate = reportByParent.get(hex);
    if (!reportDate) continue;
    intersect += 1;
    const derived = objectIdToTxnDate(hex);
    if (reportDate === derived) { agree += 1; continue; }
    disagree += 1;
    if (isoWeek(reportDate) !== isoWeek(derived)) weekCross += 1;
    if (disagreementSamples.length < 5) disagreementSamples.push({ derived, purchased_at: reportDate });
  }
  console.log(`\nintersection (both sources):        ${intersect}`);
  console.log(`agree (derived == purchased_at):    ${agree}   (${(intersect > 0 ? (agree/intersect*100).toFixed(2) : "n/a")}%)`);
  console.log(`disagree (any delta):               ${disagree}`);
  console.log(`  of which cross an ISO-week bound: ${weekCross}   ← rows that could sit on wrong fiscal week`);
  if (disagreementSamples.length > 0) {
    console.log(`\nsample disagreements (no PII):`);
    for (const s of disagreementSamples) console.log(`  derived=${s.derived}  purchased_at=${s.purchased_at}`);
  }
  console.log(`\nowner rule: any week-cross > 0 stops the merge PR - the Ruling 1 calibration would have drifted.`);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });

// S1 root cause probe.
// Prior _live_db_check.json ran_at 2026-08-15T01:05:08 recorded TBJ raw=2338 live=2235 dollarSet=2219.
// Today, running the SAME script code returns raw=2338 dollarSet=2202 with Kevin's numbers.
//
// Total TBJ rows unfiltered today = 2596. Prior script's window pull returned 2338. That is because
// the script uses `.range(from, from+999)` and the raw range .gte("2026-05-01").lte("2026-07-31")
// which excludes rows with corrupted prefixes (2020-, 2023-, and past raw values).
//
// The mismatch on dollar_set (2219 vs 2202) requires the same window filter. Both runs pull
// the same window slice. The delta is 17 rows / +$12,629.32 spend. That is very close to
// Kevin's stated "R2(a) restatement bridge for TBJ is +$12,629.32".
//
// Hypothesis: between 2026-08-15T01:05 and today (2026-08-14 per date rollback), rows were
// EITHER added OR their statuses/review_reasons changed OR their prices were corrected.
// Let me identify the 17 rows to name the mechanism.

import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";
import fs from "node:fs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing env");
const supa = createClient(url, key, { auth: { persistSession: false } });

const round2 = (n) => Math.round(n * 100) / 100;

function dnormJs(raw) {
  if (!raw) return null;
  const s = String(raw);
  if (s.startsWith("0026-")) return "2026-" + s.slice(5);
  if (s.startsWith("0206-")) return "2026-" + s.slice(5);
  if (s.startsWith("23026-")) return s.slice(1);
  if (s.startsWith("72026-")) return s.slice(1);
  return s;
}

const WSTART = "2026-05-01", WEND = "2026-07-31";

// Fetch ALL TBJ rows with FULL detail
const all = [];
{
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supa
      .from("ai_line_items")
      .select("id, invoice_uuid, invoice_date, extended_price, review_reason, created_at")
      .eq("account_key", "TBJ - FL")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
}

// Apply Kevin's SQL filter (dnorm-first)
const windowRows = all.filter(r => {
  const nd = dnormJs(r.invoice_date);
  return nd && nd >= WSTART && nd <= WEND;
});

// Fetch headers for status filter
const uuids = [...new Set(windowRows.map(r => r.invoice_uuid).filter(Boolean))];
const hdrs = new Map();
{
  const CHUNK = 100;
  for (let i = 0; i < uuids.length; i += CHUNK) {
    const batch = uuids.slice(i, i + CHUNK);
    const { data, error } = await supa
      .from("invoice_submissions")
      .select("id, status")
      .in("id", batch);
    if (error) throw error;
    for (const r of data) hdrs.set(r.id, r);
  }
}

// Live rows (exclude corrected/deleted)
const liveRows = windowRows.filter(r => {
  const h = hdrs.get(r.invoice_uuid);
  return !(h && (h.status === "corrected" || h.status === "deleted"));
});

// Dollar set (exclude invoice_over_extracted)
const dollarSet = liveRows.filter(r => r.review_reason !== "invoice_over_extracted");

console.log("== Full audit today ==");
console.log(`  all_tbj_rows=${all.length}`);
console.log(`  window_rows (dnorm filter)=${windowRows.length}`);
console.log(`  live_rows (post-status)=${liveRows.length}`);
console.log(`  dollar_set (post review_reason)=${dollarSet.length}`);
console.log(`  dollar_set spend=$${round2(dollarSet.reduce((s,r)=>s+(Number(r.extended_price)||0),0))}`);

// Split by created_at
const CUTOFF = "2026-08-15T01:05:08Z"; // when 03_live_db_check.mjs ran
const preRows = dollarSet.filter(r => r.created_at < CUTOFF);
const postRows = dollarSet.filter(r => r.created_at >= CUTOFF);
console.log(`\n== Dollar set split by created_at vs prior run cutoff ${CUTOFF} ==`);
console.log(`  created BEFORE cutoff: ${preRows.length} rows / $${round2(preRows.reduce((s,r)=>s+(Number(r.extended_price)||0),0))}`);
console.log(`  created AT/AFTER cutoff: ${postRows.length} rows / $${round2(postRows.reduce((s,r)=>s+(Number(r.extended_price)||0),0))}`);

// Post-cutoff rows in detail
if (postRows.length && postRows.length < 30) {
  console.log("\n  post-cutoff detail:");
  for (const r of postRows) {
    console.log(`    ${r.id}  ${r.invoice_date}  ep=${r.extended_price}  rr=${r.review_reason}  created=${r.created_at}`);
  }
}

// (no updated_at column; skip)

// Also check total ai_line_items count for TBJ before/after
const priorRaw = 2338;  // from _live_db_check.json
const priorLive = 2235;
const priorDollar = 2219;
const priorSpend = 171222.23;
console.log(`\n== Prior vs now delta ==`);
console.log(`  raw pull:      ${priorRaw} -> ${windowRows.length}  (delta ${windowRows.length - priorRaw})`);
console.log(`  live:          ${priorLive} -> ${liveRows.length}  (delta ${liveRows.length - priorLive})`);
console.log(`  dollar_set:    ${priorDollar} -> ${dollarSet.length}  (delta ${dollarSet.length - priorDollar})`);
console.log(`  spend:         $${priorSpend} -> $${round2(dollarSet.reduce((s,r)=>s+(Number(r.extended_price)||0),0))}  (delta $${round2(dollarSet.reduce((s,r)=>s+(Number(r.extended_price)||0),0) - priorSpend)})`);

// Rows that would be status-corrected now (status change during window)
const nowCorrected = windowRows.filter(r => {
  const h = hdrs.get(r.invoice_uuid);
  return h && (h.status === "corrected" || h.status === "deleted");
});
console.log(`\n  rows now under corrected/deleted invoice: ${nowCorrected.length}`);

// Rows now flagged invoice_over_extracted
const nowOverExt = liveRows.filter(r => r.review_reason === "invoice_over_extracted");
console.log(`  rows now flagged invoice_over_extracted: ${nowOverExt.length} (spend $${round2(nowOverExt.reduce((s,r)=>s+(Number(r.extended_price)||0),0))})`);

const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_s1_root_cause.json";
fs.writeFileSync(OUT, JSON.stringify({
  ran_at: new Date().toISOString(),
  today: {
    all_tbj_rows: all.length,
    window_rows: windowRows.length,
    live_rows: liveRows.length,
    dollar_set: dollarSet.length,
    dollar_set_spend: round2(dollarSet.reduce((s,r)=>s+(Number(r.extended_price)||0),0)),
    now_corrected_or_deleted: nowCorrected.length,
    now_over_extracted: nowOverExt.length,
    now_over_extracted_spend: round2(nowOverExt.reduce((s,r)=>s+(Number(r.extended_price)||0),0)),
  },
  prior: { raw: priorRaw, live: priorLive, dollar: priorDollar, spend: priorSpend },
  delta_by_created_at: {
    cutoff: CUTOFF,
    pre_cutoff_rows: preRows.length,
    pre_cutoff_spend: round2(preRows.reduce((s,r)=>s+(Number(r.extended_price)||0),0)),
    post_cutoff_rows: postRows.length,
    post_cutoff_spend: round2(postRows.reduce((s,r)=>s+(Number(r.extended_price)||0),0)),
    post_cutoff_detail: postRows.map(r => ({ id: r.id, invoice_date: r.invoice_date, ep: r.extended_price, rr: r.review_reason, created: r.created_at })),
  },
  now_over_extracted_sample: nowOverExt.slice(0, 30).map(r => ({ id: r.id, ep: r.extended_price, invoice_date: r.invoice_date })),
}, null, 2));
console.log(`\nwrote ${OUT}`);

#!/usr/bin/env node
// R-148B · superseded-uncoded detection probe. READ ONLY.
//
// Mechanism (Kevin ruling 2026-09-24):
//   rippling_raw_spend_lines_latest.external_id is
//     `<txn_objectid>__line_item_content_<category_id>_<amount>_no_dimensions`.
//   The category id is baked into the line identity. When an operator picks
//   a category in Rippling, the API stops returning the old (`68ed4977b7aabd
//   4234afda3a` = "**Please Select A Category**") line and starts returning
//   a new line with the chosen category. The derive inserts the new coded
//   row but never removes the old one, because touchedSourceLineIds only
//   ever contains ids the live walk returned. One orphaned uncoded row
//   accumulates per coded charge, forever.
//
// Detection: group raw lines by (objectid_prefix, amount). A line is
// superseded when:
//   1. its category_id = '68ed4977b7aabd4234afda3a' (Please Select), AND
//   2. a peer in the same group has a different category, AND
//   3. that peer's last_seen_at > this line's last_seen_at.
//
// Output artifacts:
//   scripts/probes/artifacts/r148b_reversal.json  · COMMITTABLE.
//     source_line_id + reason only. No dollars, no vendors, no employees.
//   ~/Downloads/kf-r148b-review.json              · LOCAL, NOT COMMITTED.
//     Full detail (merchant, amount, both external_ids, both last_seen_at,
//     account_key, txn_date) so the supersession is auditable.
//
// Prints three assertions per Kevin's spec + per-account before/after for
// CP (P10) so Kevin can approve before ship.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const KEY_URL = process.env.SUPABASE_URL;
const KEY_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`SUPABASE_URL: ${KEY_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${KEY_SVC ? "PRESENT" : "ABSENT"}`);
if (!KEY_URL || !KEY_SVC) process.exit(1);

const s = createClient(KEY_URL, KEY_SVC, { auth: { persistSession: false, autoRefreshToken: false } });

const PLEASE_SELECT_CAT = "68ed4977b7aabd4234afda3a";
const OBJECTID_HEX24 = /^[a-f0-9]{24}__line_item_content_/;
const P10 = { start: "2026-09-07", end: "2026-10-04" };  // CP window

const ARTIFACT_DIR    = path.join(__dirname, "artifacts");
const REVERSAL_PATH   = path.join(ARTIFACT_DIR, "r148b_reversal.json");
const REVIEW_PATH     = process.env.R148B_REVIEW_PATH
  || path.join(homedir(), "Downloads", "kf-r148b-review.json");

if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const fmt$ = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAGE = 1000;
async function pageAll(table, sel, filters = q => q) {
  const out = [];
  let from = 0;
  while (true) {
    const q = filters(s.from(table).select(sel).range(from, from + PAGE - 1));
    const r = await q;
    if (r.error) throw r.error;
    out.push(...(r.data || []));
    if ((r.data || []).length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ── Step 1 · load raw spend lines with the external_id shape we key on
console.log();
console.log("Step 1 · load rippling_raw_spend_lines_latest (paginated)");
const rawAll = await pageAll(
  "rippling_raw_spend_lines_latest",
  "rippling_id, external_id, category_id, amount, last_seen_at",
);
const raw = rawAll.filter(r => r.external_id && OBJECTID_HEX24.test(r.external_id));
console.log(`  ${rawAll.length} rows total · ${raw.length} match the objectid__line_item_content_ shape`);

// ── Step 2 · group by (objectid_prefix, amount)
const groupOf = r => `${r.external_id.slice(0, 24)}|${Number(r.amount).toFixed(2)}`;
const byGroup = new Map();
for (const r of raw) {
  const k = groupOf(r);
  if (!byGroup.has(k)) byGroup.set(k, []);
  byGroup.get(k).push(r);
}
console.log(`  ${byGroup.size} distinct (objectid, amount) groups`);

// ── Step 3 · classify Please Select lines that have a coded peer
console.log();
console.log("Step 3 · classify (superseded | same_walk | suspect_coded_earlier)");
const candidates = [];
for (const [_, members] of byGroup) {
  const unset  = members.filter(r => r.category_id === PLEASE_SELECT_CAT);
  const coded  = members.filter(r => r.category_id && r.category_id !== PLEASE_SELECT_CAT);
  if (unset.length === 0 || coded.length === 0) continue;
  for (const u of unset) {
    const uSeen = new Date(u.last_seen_at).getTime();
    const codedSeen = coded.map(c => ({ c, t: new Date(c.last_seen_at).getTime() }));
    const maxCoded = codedSeen.reduce((a, b) => a.t > b.t ? a : b);
    const verdict = maxCoded.t > uSeen ? "superseded"
                  : maxCoded.t === uSeen ? "same_walk"
                  : "suspect_coded_earlier";
    candidates.push({
      unset_rippling_id: u.rippling_id,
      unset_external_id: u.external_id,
      unset_last_seen:   u.last_seen_at,
      coded_rippling_id: maxCoded.c.rippling_id,
      coded_external_id: maxCoded.c.external_id,
      coded_last_seen:   maxCoded.c.last_seen_at,
      coded_twin_count:  coded.length,
      coded_all:         coded.map(c => c.rippling_id),  // A4 walks all twins
      amount:            u.amount,
      verdict,
    });
  }
}
const bucket = {
  superseded:            candidates.filter(c => c.verdict === "superseded"),
  same_walk:             candidates.filter(c => c.verdict === "same_walk"),
  suspect_coded_earlier: candidates.filter(c => c.verdict === "suspect_coded_earlier"),
};
console.log(`  superseded:            ${bucket.superseded.length}`);
console.log(`  same_walk:             ${bucket.same_walk.length}`);
console.log(`  suspect_coded_earlier: ${bucket.suspect_coded_earlier.length}`);

// ── Step 4 · join to purchasing_actuals (all rippling_spend rows, both states,
// so A4 can classify the fate of each coded twin)
console.log();
console.log("Step 4 · load purchasing_actuals · source=rippling_spend (all states, for A4)");
const paAll = await pageAll(
  "purchasing_actuals",
  "id, source_line_id, source_bill_id, account_key, gl_line_code, amount, txn_date, vendor_or_merchant, excluded, reason",
  q => q.eq("source", "rippling_spend"),
);
const paBySourceLineId = new Map(paAll.map(r => [r.source_line_id.replace(/^rippling_spend:/, ""), r]));
const paCountingIds    = new Set(paAll.filter(r => r.excluded === false).map(r => r.id));
console.log(`  ${paAll.length} rippling_spend rows loaded · ${paCountingIds.size} counting (excluded=false)`);

const retireRows = [];
for (const c of bucket.superseded) {
  const pa = paBySourceLineId.get(c.unset_rippling_id);
  if (!pa) continue;                    // never derived into PA - skip
  if (pa.excluded === true) continue;   // already excluded upstream, not counting - skip
  retireRows.push({ ...c, pa });
}
console.log(`  ${retireRows.length} counting rows queued for retirement (${bucket.superseded.length - retireRows.length} superseded rows already excluded upstream or not derived)`);

// ── Step 5 · assertions
console.log();
console.log("Step 5 · assertions");

// A1. Zero rows where coded_last_seen <= unset_last_seen among the retirement set.
const a1_bad = retireRows.filter(r => new Date(r.coded_last_seen).getTime() <= new Date(r.unset_last_seen).getTime());
console.log(`  A1 · coded_last_seen > unset_last_seen for every retirement · ${a1_bad.length === 0 ? "PASS (0 bad)" : "FAIL (" + a1_bad.length + " bad)"}`);

// A2. Structurally impossible per grouping key: every group has one amount by construction.
// Confirm zero mixed-amount groups exist across the raw pool.
let a2_mixed = 0;
for (const [_, members] of byGroup) {
  const amts = new Set(members.map(m => Number(m.amount).toFixed(2)));
  if (amts.size > 1) a2_mixed += 1;
}
console.log(`  A2 · zero mixed-amount groups (GL-split guard) · ${a2_mixed === 0 ? "PASS (0, structurally impossible per grouping key)" : "FAIL (" + a2_mixed + " mixed - grouping key broken)"}`);

// A3. Count of groups where the unset line has 2+ coded twins (item recoded more than once).
const a3_multi = retireRows.filter(r => r.coded_twin_count >= 2).length;
console.log(`  A3 · retirements from multi-recode groups (2+ coded twins) · count = ${a3_multi} · sweep retires exactly one Please Select row per group by construction`);

// A4 (permanent, Kevin ruling 2026-09-24). Every retired row must have a
// counting replacement, or a documented reason it should not. Categories:
//   (a) direct coded twin counting in purchasing_actuals
//   (b) settled row for same account, vendor, amount within +/-5 days,
//       counting, not itself in the retirement set
//   (c) direct coded twin excluded by map_excluded or report_coded
//       (charge is meant to be off the board)
// Anything falling outside a, b, c halts the sweep.
const INTENTIONAL_REASONS = new Set(["map_excluded", "report_coded"]);
const FIVE_DAYS_MS = 5 * 86400000;
const retireIds = new Set(retireRows.map(r => r.pa.id));

// Index counting PA rows by (account, vendor, amount) for O(1) B lookup.
const countingByKey = new Map();
for (const pa of paAll) {
  if (pa.excluded !== false) continue;
  const k = `${pa.account_key}|${pa.vendor_or_merchant}|${Number(pa.amount).toFixed(2)}`;
  if (!countingByKey.has(k)) countingByKey.set(k, []);
  countingByKey.get(k).push(pa);
}

const a4 = { direct: 0, settled_elsewhere: 0, intentional: 0, uncovered: [] };
for (const r of retireRows) {
  // (a) any coded twin counting?
  const directCounting = r.coded_all.some(rid => {
    const twinPa = paBySourceLineId.get(rid);
    return twinPa && twinPa.excluded === false;
  });
  if (directCounting) { a4.direct += 1; continue; }
  // (b) settled elsewhere within +/-5 days?
  const k = `${r.pa.account_key}|${r.pa.vendor_or_merchant}|${Number(r.pa.amount).toFixed(2)}`;
  const nearby = countingByKey.get(k) || [];
  const rDate = r.pa.txn_date ? new Date(r.pa.txn_date + "T00:00:00Z").getTime() : null;
  const settledElsewhere = rDate != null && nearby.some(pa =>
    pa.id !== r.pa.id
    && !retireIds.has(pa.id)
    && pa.txn_date
    && Math.abs(new Date(pa.txn_date + "T00:00:00Z").getTime() - rDate) <= FIVE_DAYS_MS
  );
  if (settledElsewhere) { a4.settled_elsewhere += 1; continue; }
  // (c) direct twin excluded by map_excluded or report_coded?
  const intentional = r.coded_all.some(rid => {
    const twinPa = paBySourceLineId.get(rid);
    return twinPa && twinPa.excluded === true && INTENTIONAL_REASONS.has(twinPa.reason);
  });
  if (intentional) { a4.intentional += 1; continue; }
  // Uncovered - HALT
  a4.uncovered.push(r);
}

console.log(`  A4 · every retirement covered by (a) direct twin counting, (b) settled elsewhere, or (c) intentional exclusion:`);
console.log(`         (a) direct twin counting     : ${a4.direct}`);
console.log(`         (b) settled elsewhere (+/-5d): ${a4.settled_elsewhere}`);
console.log(`         (c) intentional (map/report) : ${a4.intentional}`);
console.log(`         uncovered (halt trigger)     : ${a4.uncovered.length}`);
// A4 permanent invariant (Kevin ruling 2026-09-24): uncovered > 0 halts.
// This runs every night forever.
const a4_pass = a4.uncovered.length === 0;
if (a4.uncovered.length > 0) {
  console.log(`  A4 · FAIL: ${a4.uncovered.length} retirements have no counting replacement and no documented reason. Sample:`);
  for (const r of a4.uncovered.slice(0, 5)) {
    console.log(`    ${r.pa.account_key} · ${r.pa.txn_date} · ${r.pa.vendor_or_merchant} · ${fmt$(r.amount)} · unset_rid=${r.unset_rippling_id}`);
  }
}
// One-time backfill guard (Kevin ruling 2026-09-24): the exact 156/19/4
// split gates only the FIRST PRODUCTION SWEEP. Set R148B_STRICT_BASELINE=true
// to require an exact match (halts on drift). Unset / anything else on
// nightly - drift is EXPECTED (a coded charge tomorrow moves the split)
// and halting a nightly job on expected change is worse than not checking.
// After the first production sweep succeeds, this constant should be
// retired from the sweep code entirely; kept here in the probe as
// documentation of the mechanism-confirmed baseline.
const KEVIN_BASELINE = { direct: 156, settled_elsewhere: 19, intentional: 4 };
const STRICT_BASELINE = process.env.R148B_STRICT_BASELINE === "true";
const drift = ["direct", "settled_elsewhere", "intentional"].filter(k => a4[k] !== KEVIN_BASELINE[k]);
if (drift.length > 0) {
  const msg = `A4 baseline drift from Kevin's 2026-09-24 split on ${drift.join(", ")} · expected ${JSON.stringify(KEVIN_BASELINE)} got ${JSON.stringify({direct: a4.direct, settled_elsewhere: a4.settled_elsewhere, intentional: a4.intentional})}`;
  if (STRICT_BASELINE) {
    console.log(`  A4 · STRICT DRIFT HALT: ${msg} (R148B_STRICT_BASELINE=true)`);
  } else {
    console.warn(`  A4 · WARN: ${msg} (continuing; set R148B_STRICT_BASELINE=true to halt)`);
  }
}
const a4_strict_pass = !STRICT_BASELINE || drift.length === 0;
console.log(`  A4 · ${a4_pass && a4_strict_pass ? "PASS" : "FAIL"}${STRICT_BASELINE ? " (strict baseline mode)" : ""}`);

// ── Step 6 · per-account before/after report for CP (P10)
console.log();
console.log("Step 6 · per-account before/after · CP P10 (2026-09-07 to 2026-10-04)");
const p10Rows   = paAll.filter(r => r.excluded === false && r.txn_date && r.txn_date >= P10.start && r.txn_date <= P10.end);
const p10RetIds = new Set(retireRows
  .filter(r => r.pa.txn_date && r.pa.txn_date >= P10.start && r.pa.txn_date <= P10.end)
  .map(r => r.pa.id));

const accounts = [...new Set(p10Rows.map(r => r.account_key).filter(Boolean))].sort();
const perAcct = new Map();
for (const acct of accounts) perAcct.set(acct, { beforeRows: 0, beforeUn: 0, beforeSum: 0, afterRows: 0, afterUn: 0, afterSum: 0 });
for (const r of p10Rows) {
  const b = perAcct.get(r.account_key);
  if (!b) continue;
  const amt = Number(r.amount || 0);
  b.beforeRows += 1;
  if (r.gl_line_code == null) b.beforeUn += 1;
  b.beforeSum += amt;
  if (!p10RetIds.has(r.id)) {
    b.afterRows += 1;
    if (r.gl_line_code == null) b.afterUn += 1;
    b.afterSum += amt;
  }
}

console.log(`| account         | rows Δ         | uncoded Δ       | spend Δ                                            |`);
console.log(`|-----------------|----------------|-----------------|-----------------------------------------------------|`);
let tot = { br: 0, bu: 0, bs: 0, ar: 0, au: 0, as: 0 };
for (const acct of accounts) {
  const b = perAcct.get(acct);
  console.log(`| ${acct.padEnd(15)} | ${String(b.beforeRows).padStart(3)} → ${String(b.afterRows).padEnd(3)}  (${String(b.beforeRows - b.afterRows).padStart(3)}) | ${String(b.beforeUn).padStart(3)} → ${String(b.afterUn).padEnd(3)}  (${String(b.beforeUn - b.afterUn).padStart(3)}) | ${fmt$(b.beforeSum).padStart(12)} → ${fmt$(b.afterSum).padEnd(12)}  Δ ${fmt$(b.beforeSum - b.afterSum).padStart(10)} |`);
  tot.br += b.beforeRows; tot.bu += b.beforeUn; tot.bs += b.beforeSum;
  tot.ar += b.afterRows;  tot.au += b.afterUn;  tot.as += b.afterSum;
}
console.log(`| ${"PORTFOLIO".padEnd(15)} | ${String(tot.br).padStart(3)} → ${String(tot.ar).padEnd(3)}  (${String(tot.br - tot.ar).padStart(3)}) | ${String(tot.bu).padStart(3)} → ${String(tot.au).padEnd(3)}  (${String(tot.bu - tot.au).padStart(3)}) | ${fmt$(tot.bs).padStart(12)} → ${fmt$(tot.as).padEnd(12)}  Δ ${fmt$(tot.bs - tot.as).padStart(10)} |`);

// ── Step 7 · write artifacts
console.log();
console.log("Step 7 · write artifacts");

// Reversal file · committable · source_line_id + account_key + reason
// only (Kevin ruling 2026-09-24). account_key makes reversal self-
// contained so it does not depend on spend_work_location_site_map
// staying stable. Zero dollars, zero vendors, zero employees.
const reversal = {
  brief_ref: "R-148B · Kevin ruling 2026-09-24 (mechanism confirmed)",
  schema_version: 2,
  reason: "superseded_uncoded",
  retirements: retireRows
    .map(r => ({
      source_line_id: `rippling_spend:${r.unset_rippling_id}`,
      account_key:    r.pa.account_key,
    }))
    .sort((a, b) => a.source_line_id.localeCompare(b.source_line_id)),
};
fs.writeFileSync(REVERSAL_PATH, JSON.stringify(reversal, null, 2));
console.log(`  wrote ${REVERSAL_PATH} · ${reversal.retirements.length} rows`);

// Review file · local · full detail, sorted
const review = {
  generated_at: new Date().toISOString(),
  brief_ref: "R-148B · Kevin ruling 2026-09-24 (mechanism confirmed)",
  detection_rule: "grouped raw lines on (objectid_prefix, amount); unset line where category_id = 68ed4977b7aabd4234afda3a (Please Select) and a coded peer has strictly greater last_seen_at",
  totals: {
    superseded_in_raw:            bucket.superseded.length,
    same_walk_in_raw:             bucket.same_walk.length,
    suspect_coded_earlier_in_raw: bucket.suspect_coded_earlier.length,
    retirement_set:               retireRows.length,
    multi_recode_groups_in_set:   a3_multi,
    a4_split:                     { direct: a4.direct, settled_elsewhere: a4.settled_elsewhere, intentional: a4.intentional, uncovered: a4.uncovered.length },
    a4_kevin_baseline:            KEVIN_BASELINE,
  },
  cp_p10: { window: P10, per_account: Object.fromEntries(accounts.map(acct => [acct, perAcct.get(acct)])), portfolio: tot },
  retirements: retireRows.map(r => ({
    source_line_id:     `rippling_spend:${r.unset_rippling_id}`,
    pa_id:              r.pa.id,
    source_bill_id:     r.pa.source_bill_id,
    account_key:        r.pa.account_key,
    amount:             Number(r.amount),
    txn_date:           r.pa.txn_date,
    vendor_or_merchant: r.pa.vendor_or_merchant,
    unset_external_id:  r.unset_external_id,
    coded_external_id:  r.coded_external_id,
    unset_last_seen:    r.unset_last_seen,
    coded_last_seen:    r.coded_last_seen,
    coded_twin_count:   r.coded_twin_count,
  })).sort((a, b) => (a.account_key || "").localeCompare(b.account_key || "") || (a.txn_date || "").localeCompare(b.txn_date || "")),
};
fs.writeFileSync(REVIEW_PATH, JSON.stringify(review, null, 2));
console.log(`  wrote ${REVIEW_PATH} · full detail (amounts, vendors, external_ids, last_seen)`);

console.log();
console.log("=== summary ===");
console.log(`  retirement set: ${retireRows.length} rows`);
console.log(`  assertions:     A1 ${a1_bad.length === 0 ? "PASS" : "FAIL"} · A2 ${a2_mixed === 0 ? "PASS" : "FAIL"} · A3 ${a3_multi} multi-recode groups · A4 ${a4_pass && a4_strict_pass ? "PASS" : "FAIL"} (${a4.direct}/${a4.settled_elsewhere}/${a4.intentional}/${a4.uncovered.length})`);
console.log(`  portfolio CP:   rows ${tot.br} → ${tot.ar} · uncoded ${tot.bu} → ${tot.au} · spend ${fmt$(tot.bs)} → ${fmt$(tot.as)} (Δ ${fmt$(tot.bs - tot.as)})`);
process.exit((a1_bad.length === 0 && a2_mixed === 0 && a4_pass && a4_strict_pass) ? 0 : 1);

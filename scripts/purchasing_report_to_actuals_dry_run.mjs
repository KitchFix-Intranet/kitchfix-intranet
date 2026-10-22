#!/usr/bin/env node
/**
 * scripts/purchasing_report_to_actuals_dry_run.mjs
 *
 * Stage 2 dry-run. Reads rippling_report_txns (the nightly report
 * parsed into DB rows), applies the owner-approved mapping to produce
 * a shadow purchasing_actuals shape, and reports:
 *
 *   1. Row counts (parsed, mapped, excluded, Food-fallback, by
 *      reconcile_status).
 *   2. P10 tie: shadow card totals (per account + per gl_line_code)
 *      vs the EXISTING purchasing_actuals (source='rippling_spend')
 *      rows for P10. Confirms the report reproduces what the API walk
 *      coded.
 *   3. P10 total COGS (shadow cards + billcom invoices) vs posted
 *      pnl_actuals 3200 / 3400 / 3500 per account.
 *   4. Unmapped Work location or Category Name values (sentinels for
 *      owner review).
 *
 * No DB write. The dry-run never writes - that is the whole point.
 * The real load path lives in a separate script added after Stage 1
 * migration is applied and this dry-run is approved.
 *
 * Output:
 *   - Human-readable control report with names / dollars to
 *     ~/Downloads/card_feed_stage2_dry_run_<date>.txt. Carries PII and
 *     dollar figures; MUST NOT be committed. .gitignore / shell
 *     discipline keeps it out of the repo.
 *   - PASS / FAIL summary + counts to stdout. No names, no accounts,
 *     no dollar figures - safe to paste into a PR body or a workflow
 *     log.
 *
 * CLI:
 *   node --env-file=/path/to/.env.local scripts/purchasing_report_to_actuals_dry_run.mjs
 *     [--batch-cutoff-hours=<N>]   default 36. Includes only rows
 *                                  with last_seen_at >= NOW()-Nh. Pass
 *                                  --batch-cutoff-hours=0 to include
 *                                  every row ever ingested.
 *
 * Exit codes:
 *   0  dry-run completed. See stdout for PASS / FAIL.
 *   1  configuration error (missing env or supabase client).
 *   2  database read error.
 */
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  WORK_LOCATION_MAP,
  GL_OVERRIDES,
  buildDbCategoryMap,
  mapReportRowToActualsShape,
  isUncodedToFood,
  normalizeReconcileStatus,
} from "../src/lib/purchasing/reportToActualsMap.js";

function parseArgs(argv) {
  const args = { batchCutoffHours: 36 };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--batch-cutoff-hours=")) {
      const n = Number(a.slice("--batch-cutoff-hours=".length));
      if (Number.isFinite(n) && n >= 0) args.batchCutoffHours = n;
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function envOrDie(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`env ${name} ABSENT`);
    process.exit(1);
  }
  return v;
}

const args = parseArgs(process.argv);
const SB_URL = envOrDie("SUPABASE_URL");
const SB_KEY = envOrDie("SUPABASE_SERVICE_ROLE_KEY");
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// Paginate because supabase client caps a single query at 1000 rows.
async function pageAll(builderFactory, pageSize = 1000) {
  const out = [];
  let from = 0;
  for (;;) {
    const q = await builderFactory().range(from, from + pageSize - 1);
    if (q.error) {
      console.error(`page read failed at from=${from}: ${q.error.message}`);
      process.exit(2);
    }
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ─── FY2026 period boundaries ────────────────────────────────────────
// Mirrors the server-side periodBasis helper used by the live route.
const FY_START = new Date("2025-12-29T00:00:00Z");
function periodNoFor(dateISO) {
  if (!dateISO) return null;
  const d = new Date(`${String(dateISO).slice(0, 10)}T00:00:00Z`);
  const days = Math.floor((d.getTime() - FY_START.getTime()) / 86400000);
  if (days < 0 || days > 365) return null;
  const p = Math.floor(days / 28) + 1;
  return Math.min(13, Math.max(1, p));
}

const P10_START = "2026-09-07";
const P10_END   = "2026-10-04";

function money(n) {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return (v < 0 ? "-$" : "$") + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ─── Fetch inputs ────────────────────────────────────────────────────
const t0 = Date.now();
console.log(`stage 2 dry-run start=${new Date().toISOString()}`);
console.log(`batch cutoff hours = ${args.batchCutoffHours}`);

const cutoffISO = args.batchCutoffHours === 0
  ? null
  : new Date(Date.now() - args.batchCutoffHours * 3600 * 1000).toISOString();

const reportRows = await pageAll(() => {
  let q = supa.from("rippling_report_txns").select(
    "id, parent_txn_id, content_hash, purchased_at, posted_date, amount, " +
    "vendor_name, vendor, category_name, work_location, employee, " +
    "employee_id, memo, line_item_memo, gl_sync_status, has_receipt, last_seen_at"
  ).order("id");
  if (cutoffISO) q = q.gte("last_seen_at", cutoffISO);
  return q;
});

// Latest-content-hash-per-parent view. The loader's ignoreDuplicates
// semantics means stale/recoded rows persist in rippling_report_txns -
// a recode leaves the old content_hash in place with an old last_seen_at.
// DISTINCT ON (parent_txn_id) ORDER BY last_seen_at DESC bounds that
// staleness by picking the newest content_hash per parent. Loses rows
// for category-split parents (one row per split -> all but newest get
// dropped). The reported figures bracket the real "current CSV" state;
// the follow-up real-write ingest will consume the CSV directly where
// current-vs-stale is unambiguous.
const reportRowsLatest = await pageAll(() =>
  supa.from("rippling_report_txns_latest").select(
    "id, parent_txn_id, content_hash, purchased_at, posted_date, amount, " +
    "vendor_name, vendor, category_name, work_location, employee, " +
    "employee_id, memo, line_item_memo, gl_sync_status, has_receipt, last_seen_at"
  ).order("id"),
);

const catMapRows = await pageAll(() =>
  supa.from("spend_category_map").select("category_label, gl_line_code"),
);
const dbCategoryMap = buildDbCategoryMap(catMapRows);

const wlMapRows = await pageAll(() =>
  supa.from("spend_work_location_site_map").select("work_location_label, account_key, excluded"),
);

console.log(`fetched: report_rows=${reportRows.length}  category_map=${catMapRows.length}  work_location_map=${wlMapRows.length}`);

// ─── Cross-check hardcoded maps against DB maps ──────────────────────
const DBX_WL_BY_LABEL = new Map();
for (const r of wlMapRows) {
  const label = (r.work_location_label == null ? "" : String(r.work_location_label)).trim();
  if (!label) continue;
  if (!DBX_WL_BY_LABEL.has(label)) DBX_WL_BY_LABEL.set(label, []);
  DBX_WL_BY_LABEL.get(label).push(r);
}
const WL_DIVERGENCES = [];
for (const [label, entry] of Object.entries(WORK_LOCATION_MAP)) {
  const dbRows = DBX_WL_BY_LABEL.get(label) || [];
  const dbAccountKey = dbRows.find(r => !r.excluded)?.account_key || null;
  const dbExcluded = dbRows.some(r => r.excluded);
  if (entry.excluded) {
    if (!dbExcluded && dbRows.length > 0) {
      WL_DIVERGENCES.push({ label, hardcoded: "excluded", db: dbAccountKey || "(none)" });
    }
  } else {
    if (dbAccountKey !== entry.account_key && dbRows.length > 0) {
      WL_DIVERGENCES.push({ label, hardcoded: entry.account_key, db: dbAccountKey });
    }
  }
}

// ─── Map every report row to a shadow shape ──────────────────────────
const shadow = [];
const unmappedWorkLocations = new Set();
const unmappedCategories = new Set();
const unknownReconcile = new Set();
const reconcileCounts = {};
let countExcluded = 0;
let countMappedAccount = 0;
let countFoodFallback = 0;
let countAmountZero = 0;

for (const r of reportRows) {
  const shape = mapReportRowToActualsShape(r, dbCategoryMap);
  shadow.push(shape);

  if (shape._unmapped_work_location) unmappedWorkLocations.add(r.work_location || "(null)");
  if (shape._unmapped_category)     unmappedCategories.add(r.category_name || "(null)");
  if (r.gl_sync_status && !normalizeReconcileStatus(r.gl_sync_status)) {
    unknownReconcile.add(r.gl_sync_status);
  }
  const rs = normalizeReconcileStatus(r.gl_sync_status) || "(null)";
  reconcileCounts[rs] = (reconcileCounts[rs] || 0) + 1;

  if (shape.excluded) countExcluded += 1;
  if (shape.account_key) countMappedAccount += 1;
  if (shape._uncoded_to_food) countFoodFallback += 1;
  if (Math.abs(shape.amount) < 0.005) countAmountZero += 1;
}

// ─── P10 tie: shadow vs existing purchasing_actuals ──────────────────
//
// Shadow (new): sum amounts across shadow rows where purchased_at
// falls in P10 and the row is NOT excluded. Group by account_key +
// gl_line_code (with NULL rolled up as "(uncoded)").

function p10Filter(shape) {
  const d = shape.txn_date;
  if (!d) return false;
  const iso = String(d).slice(0, 10);
  return iso >= P10_START && iso <= P10_END;
}

function keyOf(shape) {
  return `${shape.account_key || "(null)"}::${shape.gl_line_code || "(uncoded)"}`;
}

const shadowP10 = new Map();
for (const s of shadow) {
  if (s.excluded) continue;
  if (!p10Filter(s)) continue;
  const k = keyOf(s);
  shadowP10.set(k, (shadowP10.get(k) || 0) + Number(s.amount || 0));
}

// Latest-only variant: apply the same mapping but against the DISTINCT-
// ON-parent view so stale/recoded content_hashes are bounded.
const shadowLatestP10 = new Map();
for (const r of reportRowsLatest) {
  const shape = mapReportRowToActualsShape(r, dbCategoryMap);
  if (shape.excluded) continue;
  if (!p10Filter(shape)) continue;
  const k = keyOf(shape);
  shadowLatestP10.set(k, (shadowLatestP10.get(k) || 0) + Number(shape.amount || 0));
}

// Existing purchasing_actuals (source='rippling_spend') for P10.
const paExisting = await pageAll(() =>
  supa.from("purchasing_actuals")
    .select("account_key, gl_line_code, amount, txn_date, excluded")
    .eq("source", "rippling_spend")
    .gte("txn_date", P10_START)
    .lte("txn_date", P10_END)
    .order("id"),
);
const existingP10 = new Map();
for (const r of paExisting) {
  if (r.excluded) continue;
  const k = `${r.account_key || "(null)"}::${r.gl_line_code || "(uncoded)"}`;
  existingP10.set(k, (existingP10.get(k) || 0) + Number(r.amount || 0));
}

// Merge keys to a per-key delta.
const allKeys = new Set([...shadowP10.keys(), ...existingP10.keys(), ...shadowLatestP10.keys()]);
const tieRows = [];
for (const k of allKeys) {
  const sh = shadowP10.get(k) || 0;
  const shL = shadowLatestP10.get(k) || 0;
  const ex = existingP10.get(k) || 0;
  tieRows.push({ key: k, shadow: sh, shadowLatest: shL, existing: ex, deltaAll: sh - ex, deltaLatest: shL - ex });
}
tieRows.sort((a, b) => Math.abs(b.deltaAll) - Math.abs(a.deltaAll));

// ─── P10 total COGS vs pnl_actuals ───────────────────────────────────
//
// Shadow cards (uncoded routed to 3200 for the Food fallback), summed
// by account_key. Billcom invoices from purchasing_actuals, summed by
// account_key + gl_line_code starting with 32/34/35. pnl_actuals
// posted figures for the same accounts + lines.

function foodFallbackLine(shape) {
  if (shape._uncoded_to_food) return "3200";
  return shape.gl_line_code;
}

const shadowCogsByAcctLine = new Map();
for (const s of shadow) {
  if (s.excluded) continue;
  if (!p10Filter(s)) continue;
  const line = foodFallbackLine(s);
  if (!line) continue;
  const prefix = String(line).slice(0, 2);
  if (prefix !== "32" && prefix !== "34" && prefix !== "35") continue;
  const key = `${s.account_key || "(null)"}::${prefix}`;
  shadowCogsByAcctLine.set(key, (shadowCogsByAcctLine.get(key) || 0) + Number(s.amount || 0));
}

const billcomP10 = await pageAll(() =>
  supa.from("purchasing_actuals")
    .select("account_key, gl_line_code, amount, excluded")
    .eq("source", "billcom")
    .gte("txn_date", P10_START)
    .lte("txn_date", P10_END)
    .order("id"),
);
const billcomCogs = new Map();
for (const r of billcomP10) {
  if (r.excluded) continue;
  if (!r.gl_line_code) continue;
  const prefix = String(r.gl_line_code).slice(0, 2);
  if (prefix !== "32" && prefix !== "34" && prefix !== "35") continue;
  const key = `${r.account_key || "(null)"}::${prefix}`;
  billcomCogs.set(key, (billcomCogs.get(key) || 0) + Number(r.amount || 0));
}

// pnl_actuals uses detail line_codes like 3200.1, 3200.2, 3400.1, 3500.4;
// aggregate by prefix (first two chars) to match the shadow + billcom
// prefix-grouped shape above.
const pnlP10 = await pageAll(() =>
  supa.from("pnl_actuals")
    .select("account_key, line_code, actual")
    .eq("fiscal_year", 2026)
    .eq("period_no", 10)
    .or("line_code.like.32%,line_code.like.34%,line_code.like.35%")
    .order("account_key"),
);
const pnlCogs = new Map();
for (const r of pnlP10) {
  if (!r.line_code) continue;
  const prefix = String(r.line_code).slice(0, 2);
  if (prefix !== "32" && prefix !== "34" && prefix !== "35") continue;
  const key = `${r.account_key || "(null)"}::${prefix}`;
  pnlCogs.set(key, (pnlCogs.get(key) || 0) + Number(r.actual || 0));
}

const cogsKeys = new Set([...shadowCogsByAcctLine.keys(), ...billcomCogs.keys(), ...pnlCogs.keys()]);
const cogsRows = [];
for (const k of cogsKeys) {
  const sh = shadowCogsByAcctLine.get(k) || 0;
  const bl = billcomCogs.get(k) || 0;
  const pn = pnlCogs.get(k) || 0;
  cogsRows.push({ key: k, shadow_cards: sh, billcom: bl, total: sh + bl, pnl: pn, delta: (sh + bl) - pn });
}
cogsRows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

// ─── Compose the control report (names + dollars allowed) ────────────
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const outPath = path.join(os.homedir(), "Downloads", `card_feed_stage2_dry_run_${stamp}.txt`);

const lines = [];
lines.push(`CARD FEED STAGE 2 DRY-RUN - CONTROL REPORT (local, do not commit)`);
lines.push(`generated: ${new Date().toISOString()}`);
lines.push(`batch cutoff hours: ${args.batchCutoffHours}  (0 = all history)`);
lines.push(``);
lines.push(`─────────── 1. INPUT COUNTS ───────────`);
lines.push(`report rows loaded: ${reportRows.length}`);
lines.push(`distinct parent_txn_id in loaded set: ${new Set(reportRows.map(r => r.parent_txn_id)).size}`);
lines.push(`spend_category_map rows: ${catMapRows.length}  (labelled gl_line_code: ${dbCategoryMap.size})`);
lines.push(`spend_work_location_site_map rows: ${wlMapRows.length}`);
lines.push(``);
lines.push(`─────────── 2. MAPPING COUNTS ───────────`);
lines.push(`mapped to account (account_key non-null): ${countMappedAccount}`);
lines.push(`excluded (Remote / Corporate / GL override excluded): ${countExcluded}`);
lines.push(`Food fallback (uncoded, not do_not_sync): ${countFoodFallback}`);
lines.push(`amount near-zero (|amount| < 0.01): ${countAmountZero}`);
lines.push(``);
lines.push(`reconcile_status breakdown:`);
for (const [k, v] of Object.entries(reconcileCounts).sort((a, b) => b[1] - a[1])) {
  lines.push(`  ${k}: ${v}`);
}
lines.push(``);
lines.push(`─────────── 3. UNMAPPED VALUES ───────────`);
lines.push(`unmapped Work location (${unmappedWorkLocations.size}):`);
for (const w of [...unmappedWorkLocations].sort()) lines.push(`  ${JSON.stringify(w)}`);
lines.push(``);
lines.push(`unmapped Category Name (${unmappedCategories.size}) - these route to Food fallback:`);
for (const c of [...unmappedCategories].sort()) lines.push(`  ${JSON.stringify(c)}`);
lines.push(``);
lines.push(`unknown gl_sync_status values (not in the 5 known normalized set):`);
if (unknownReconcile.size === 0) {
  lines.push(`  (none)`);
} else {
  for (const s of [...unknownReconcile].sort()) lines.push(`  ${JSON.stringify(s)}`);
}
lines.push(``);
lines.push(`─────────── 4. HARDCODED-VS-DB MAP DIVERGENCES ───────────`);
if (WL_DIVERGENCES.length === 0) {
  lines.push(`  work location map: agrees with spend_work_location_site_map on every labelled entry.`);
} else {
  for (const d of WL_DIVERGENCES) {
    lines.push(`  DIVERGENCE: label=${JSON.stringify(d.label)}  hardcoded=${d.hardcoded}  db=${d.db}`);
  }
}
lines.push(``);
lines.push(`─────────── 5. P10 TIE: SHADOW CARDS vs EXISTING purchasing_actuals rippling_spend ───────────`);
lines.push(`P10 window: ${P10_START} to ${P10_END}`);
lines.push(`report_rows (all history): ${reportRows.length}  report_rows (latest-per-parent): ${reportRowsLatest.length}`);
lines.push(`shadow P10 keys (all history): ${shadowP10.size}  shadow P10 keys (latest-only): ${shadowLatestP10.size}  existing P10 keys: ${existingP10.size}  compared: ${allKeys.size}`);
lines.push(``);
lines.push(`Columns: shadow(all) = sum over every content_hash per parent; shadow(latest) =`);
lines.push(`DISTINCT ON (parent_txn_id) ORDER BY last_seen_at DESC; existing = current`);
lines.push(`purchasing_actuals (source='rippling_spend'); deltaAll + deltaLatest = shadow - existing.`);
lines.push(``);
lines.push(`per (account_key::gl_line_code)    shadow(all)       shadow(latest)   existing         deltaAll         deltaLatest`);
for (const r of tieRows) {
  lines.push(`  ${r.key.padEnd(32)} ${money(r.shadow).padStart(16)} ${money(r.shadowLatest).padStart(16)} ${money(r.existing).padStart(16)} ${money(r.deltaAll).padStart(16)} ${money(r.deltaLatest).padStart(16)}`);
}
const tieTotalShadow       = tieRows.reduce((s, r) => s + r.shadow, 0);
const tieTotalShadowLatest = tieRows.reduce((s, r) => s + r.shadowLatest, 0);
const tieTotalExisting     = tieRows.reduce((s, r) => s + r.existing, 0);
lines.push(`  ${"TOTAL".padEnd(32)} ${money(tieTotalShadow).padStart(16)} ${money(tieTotalShadowLatest).padStart(16)} ${money(tieTotalExisting).padStart(16)} ${money(tieTotalShadow - tieTotalExisting).padStart(16)} ${money(tieTotalShadowLatest - tieTotalExisting).padStart(16)}`);
lines.push(``);
lines.push(`─────────── 6. P10 TOTAL COGS: shadow cards + billcom vs pnl_actuals ───────────`);
lines.push(`per (account_key::line_prefix)   shadow_cards        billcom         total           pnl             delta`);
for (const r of cogsRows) {
  lines.push(`  ${r.key.padEnd(32)} ${money(r.shadow_cards).padStart(16)} ${money(r.billcom).padStart(16)} ${money(r.total).padStart(16)} ${money(r.pnl).padStart(16)} ${money(r.delta).padStart(16)}`);
}
const cogsShadow  = cogsRows.reduce((s, r) => s + r.shadow_cards, 0);
const cogsBillcom = cogsRows.reduce((s, r) => s + r.billcom,       0);
const cogsPnl     = cogsRows.reduce((s, r) => s + r.pnl,           0);
lines.push(`  ${"TOTAL".padEnd(32)} ${money(cogsShadow).padStart(16)} ${money(cogsBillcom).padStart(16)} ${money(cogsShadow + cogsBillcom).padStart(16)} ${money(cogsPnl).padStart(16)} ${money((cogsShadow + cogsBillcom) - cogsPnl).padStart(16)}`);
lines.push(``);
lines.push(`─────────── END ───────────`);
lines.push(``);
await fs.writeFile(outPath, lines.join("\n"), "utf8");

// ─── Stdout summary (safe for logs / PR body - PASS/FAIL only) ──────
console.log(``);
console.log(`─── DRY-RUN SUMMARY (safe for logs) ───`);
console.log(`report_rows_loaded: ${reportRows.length}`);
console.log(`mapped_to_account: ${countMappedAccount}`);
console.log(`excluded: ${countExcluded}`);
console.log(`food_fallback_rows: ${countFoodFallback}`);
console.log(`amount_near_zero: ${countAmountZero}`);
console.log(`unmapped_work_locations: ${unmappedWorkLocations.size}  ${unmappedWorkLocations.size === 0 ? "PASS" : "FAIL"}`);
console.log(`unmapped_categories: ${unmappedCategories.size}`);
console.log(`unknown_gl_sync_status: ${unknownReconcile.size}  ${unknownReconcile.size === 0 ? "PASS" : "REVIEW"}`);
console.log(`hardcoded_vs_db_work_location_divergences: ${WL_DIVERGENCES.length}  ${WL_DIVERGENCES.length === 0 ? "PASS" : "FAIL"}`);
console.log(`p10_tie_keys_compared: ${allKeys.size}`);
console.log(`p10_shadow_total_all_history_vs_existing_delta: ${(tieTotalShadow - tieTotalExisting).toFixed(2) >= 0 ? "+" : ""}${(tieTotalShadow - tieTotalExisting).toFixed(2)}`);
console.log(`p10_shadow_total_latest_only_vs_existing_delta: ${(tieTotalShadowLatest - tieTotalExisting).toFixed(2) >= 0 ? "+" : ""}${(tieTotalShadowLatest - tieTotalExisting).toFixed(2)}`);
console.log(`p10_cogs_keys_compared: ${cogsKeys.size}`);
console.log(``);
console.log(`control report written: ${outPath}`);
console.log(`duration: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

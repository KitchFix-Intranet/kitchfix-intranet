#!/usr/bin/env node
/**
 * scripts/purchasing_p10_card_coding_backfill.mjs
 *
 * One-time P10 card-coding backfill. Reads the current coding state
 * from rippling_report_txns (the nightly report feed), matches to the
 * P10 uncoded rippling_spend rows in purchasing_actuals on
 * (account_key, vendor_or_merchant, txn_date, amount), derives
 * gl_line_code / gl_bucket / excluded via the same loader helpers the
 * nightly swap uses, and either reports the proposed correction
 * (dry-run, default) or applies it via apply_card_coding_backfill RPC
 * (requires explicit --apply).
 *
 * This is a correction to CLOSED Finance history. P10 is below the
 * swap_card_actuals_above_floor hard floor (>= 2026-10-05) by design -
 * the nightly swap can never fix this, so this one-off exists. The
 * RPC's WHERE clause pins source + gl_line_code IS NULL + the P10
 * date window; this script is responsible for not sending anything
 * outside those lines.
 *
 * Pre-flight (per CLAUDE.md migration-gate discipline):
 *   - docs/migrations/purchasing-15-card-coding-backfill-rpc.sql
 *     applied in Supabase Studio.
 *   - Dry-run reviewed by Chat-Claude + Kevin before --apply.
 *
 * CLI:
 *   node --env-file=/path/to/.env.local scripts/purchasing_p10_card_coding_backfill.mjs
 *     [--apply]      perform the UPDATE. Default is dry-run; --apply
 *                    must be explicit. --dry-run accepted as a no-op
 *                    for symmetry.
 *
 * Exit codes:
 *   0  dry-run or apply completed; see stdout.
 *   1  configuration or arg error.
 *   2  database read error.
 *   3  database write error, or post-apply control-count violation.
 */
import { createClient } from "@supabase/supabase-js";
import {
  buildDbCategoryMap,
  mapReportRowToActualsShape,
} from "../src/lib/purchasing/reportToActualsMap.js";

// P10 FY2026 bounds (28-day period, same shape as every other
// FY2026 period). The RPC also pins this window in its WHERE clause;
// the constant here is for the SELECTs the script runs. Any divergence
// between the two would be a scope leak - keep them in sync by hand.
const P10_START = "2026-09-07";
const P10_END   = "2026-10-04";

function parseArgs(argv) {
  const args = { apply: false };
  for (const a of argv.slice(2)) {
    if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else { console.error(`unknown arg: ${a}`); process.exit(1); }
  }
  return args;
}

function envOrDie(name) {
  const v = process.env[name];
  if (!v) { console.error(`env ${name} ABSENT`); process.exit(1); }
  return v;
}

// Supabase client caps a single query at 1000 rows; paginate.
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

// Detail-table bucket per PurchasingFold.bucketOf. Four display buckets
// (food / packaging / vehicle / billed) plus "sga" and null for drops.
// Mirrored here so a null-gl_line_code row routes correctly to Food
// (the uncoded-to-Food rule); the fold does the same at render.
function bucketOf(gl) {
  const s = String(gl || "").trim();
  if (!s) return null;
  if (s === "3200" || s.startsWith("3200.")) return "food";
  if (s === "3400" || s.startsWith("3400.")) return "packaging";
  if (s === "3500" || s.startsWith("3500.")) return "vehicle";
  if (s.startsWith("13")) return "billed";
  if (s.startsWith("5"))  return "sga";
  return null;
}

// A row with gl_line_code IS NULL and excluded=FALSE routes to Food in
// the detail table (uncoded-to-Food). An excluded row does not render
// at all. For the before / after projection we fold both rules in.
function bucketOfActualsRow(gl_line_code, excluded) {
  if (excluded) return null;
  const b = bucketOf(gl_line_code);
  if (b === "sga") return null;
  if (b == null) return "food"; // uncoded-to-Food
  return b;
}

function fmt0(n) {
  const v = Number(n || 0);
  const sign = v < 0 ? "-" : "";
  return `${sign}${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
}

function dkey(k) { return k == null ? "" : String(k); }

async function sumBucketsP10Cards(supa) {
  const rows = await pageAll(() => supa.from("purchasing_actuals")
    .select("gl_line_code, excluded, amount")
    .eq("source", "rippling_spend")
    .gte("txn_date", P10_START)
    .lte("txn_date", P10_END));
  const sums = { food: 0, packaging: 0, vehicle: 0, billed: 0 };
  let dropped = 0;
  for (const r of rows) {
    const b = bucketOfActualsRow(r.gl_line_code, r.excluded);
    if (b == null) { dropped += 1; continue; }
    sums[b] += Number(r.amount || 0);
  }
  const totalRows = rows.length;
  return { sums, dropped, totalRows };
}

async function outOfRangeControlCount(supa) {
  // Everything with source='rippling_spend' OUTSIDE P10. Must be
  // byte-identical before and after --apply. This is the belt-and-
  // suspenders check against the RPC's WHERE clause.
  const beforeCount = await supa.from("purchasing_actuals")
    .select("id", { count: "exact", head: true })
    .eq("source", "rippling_spend")
    .lt("txn_date", P10_START);
  if (beforeCount.error) { console.error(`control pre-P10 read FAILED: ${beforeCount.error.message}`); process.exit(2); }
  const afterCount = await supa.from("purchasing_actuals")
    .select("id", { count: "exact", head: true })
    .eq("source", "rippling_spend")
    .gt("txn_date", P10_END);
  if (afterCount.error) { console.error(`control post-P10 read FAILED: ${afterCount.error.message}`); process.exit(2); }
  return { prePeriod: beforeCount.count || 0, postPeriod: afterCount.count || 0 };
}

async function main() {
  const args = parseArgs(process.argv);
  const SB_URL = envOrDie("SUPABASE_URL");
  const SB_KEY = envOrDie("SUPABASE_SERVICE_ROLE_KEY");
  const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  const t0 = Date.now();
  console.log(`p10_card_coding_backfill mode=${args.apply ? "APPLY" : "DRY-RUN"} window=${P10_START}..${P10_END}`);

  // ─── Load inputs ─────────────────────────────────────────────────
  const catMapResp = await supa.from("spend_category_map").select("category_label, gl_line_code");
  if (catMapResp.error) { console.error(`spend_category_map read FAILED: ${catMapResp.error.message}`); process.exit(2); }
  const dbCategoryMap = buildDbCategoryMap(catMapResp.data || []);
  console.log(`category map: ${dbCategoryMap.size} labelled entries`);

  // Report rows for P10 (every snapshot of every charge).
  const reportRowsRaw = await pageAll(() => supa.from("rippling_report_txns")
    .select("parent_txn_id, purchased_at, posted_date, vendor_name, vendor, amount, category_name, work_location, memo, line_item_memo, has_receipt, employee, employee_id, gl_sync_status, last_seen_at")
    .gte("purchased_at", P10_START)
    .lte("purchased_at", P10_END)
    .order("last_seen_at", { ascending: false }));
  console.log(`report rows read (P10, all snapshots): ${reportRowsRaw.length}`);

  // Latest state per (vendor_name, purchased_at, amount). The query
  // orders by last_seen_at DESC, so a first-wins pass gives latest-
  // wins per business-identity key.
  const seen = new Set();
  const reportLatest = [];
  for (const r of reportRowsRaw) {
    const key = `${dkey(r.vendor_name)}|${dkey(r.purchased_at)}|${Number(r.amount)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reportLatest.push(r);
  }
  console.log(`report rows latest-per-charge: ${reportLatest.length}`);

  // Derive shapes using the same loader logic the nightly swap uses.
  const reportShapes = reportLatest.map(r => mapReportRowToActualsShape(r, dbCategoryMap));

  // Index report shapes by match key.
  const reportByKey = new Map();
  for (let i = 0; i < reportShapes.length; i++) {
    const s = reportShapes[i];
    const key = `${dkey(s.account_key)}|${dkey(s.vendor_or_merchant)}|${dkey(s.txn_date)}|${Number(s.amount)}`;
    if (!reportByKey.has(key)) reportByKey.set(key, { shape: s, source: reportLatest[i] });
  }

  // Uncoded P10 card rows in purchasing_actuals (the correction target).
  const uncodedActuals = await pageAll(() => supa.from("purchasing_actuals")
    .select("id, account_key, vendor_or_merchant, txn_date, amount, gl_line_code, excluded, source")
    .eq("source", "rippling_spend")
    .gte("txn_date", P10_START)
    .lte("txn_date", P10_END)
    .is("gl_line_code", null));
  console.log(`P10 uncoded card rows (correction target): ${uncodedActuals.length}`);

  // ─── Classify ────────────────────────────────────────────────────
  // toCode: new gl_line_code set AND no excluded-invariant conflict.
  // stillUncoded: report says uncoded too; leave alone.
  // excludedFlipDeferred: new excluded=TRUE but existing account_key != NULL;
  //                      would violate purchasing_actuals_excluded_shape
  //                      check constraint. Surface, do not apply here.
  // noMatch: no report row at the (account, vendor, date, amount) key.
  const toCode = [];
  const stillUncoded = [];
  const excludedFlipDeferred = [];
  const noMatch = [];
  for (const a of uncodedActuals) {
    const key = `${dkey(a.account_key)}|${dkey(a.vendor_or_merchant)}|${dkey(a.txn_date)}|${Number(a.amount)}`;
    const hit = reportByKey.get(key);
    if (!hit) { noMatch.push(a); continue; }
    const r = hit.shape;
    const newGl = r.gl_line_code;
    const newExcl = Boolean(r.excluded);

    if (newGl == null && !newExcl) { stillUncoded.push({ actuals: a, report: hit.source }); continue; }
    if (newExcl && a.account_key != null) {
      excludedFlipDeferred.push({ actuals: a, report: hit.source, newGl, newExcl });
      continue;
    }
    toCode.push({
      id: a.id,
      gl_line_code: newGl,
      gl_bucket: r.gl_bucket,
      excluded: newExcl,
      _actuals: a,
      _report: hit.source,
      _reportCategory: hit.source.category_name,
    });
  }

  // ─── Dry-run report ──────────────────────────────────────────────
  console.log("");
  console.log("══════════════════════════════════════════════════════");
  console.log(`CLASSIFICATION of ${uncodedActuals.length} P10 uncoded card rows`);
  console.log("══════════════════════════════════════════════════════");
  console.log(`to code (safe apply)                 : ${toCode.length}`);
  console.log(`still uncoded in report (leave)      : ${stillUncoded.length}`);
  console.log(`excluded-flip DEFERRED               : ${excludedFlipDeferred.length}`);
  console.log(`no match on (acct, vendor, date, $) : ${noMatch.length}`);

  // Per-gl breakdown of the apply set.
  const byGl = new Map();
  for (const t of toCode) {
    const g = t.gl_line_code || "(null, excluded)";
    const cur = byGl.get(g) || { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += Number(t._actuals.amount || 0);
    byGl.set(g, cur);
  }
  console.log("");
  console.log("── apply-set breakdown by gl_line_code ──");
  const glKeys = [...byGl.keys()].sort();
  for (const g of glKeys) {
    const v = byGl.get(g);
    console.log(`  ${g.padEnd(28)} count=${String(v.count).padStart(3)}  amount=${fmt0(v.amount)}`);
  }

  // Before + projected after bucket totals.
  const before = await sumBucketsP10Cards(supa);
  const projectedAfter = { food: before.sums.food, packaging: before.sums.packaging, vehicle: before.sums.vehicle, billed: before.sums.billed };
  for (const t of toCode) {
    // was: uncoded + excluded=FALSE -> routed to food
    projectedAfter.food -= Number(t._actuals.amount || 0);
    const newBucket = bucketOfActualsRow(t.gl_line_code, t.excluded);
    if (newBucket != null) projectedAfter[newBucket] += Number(t._actuals.amount || 0);
    // excluded=TRUE drops out of all four buckets (not surfaced in table).
  }
  console.log("");
  console.log("── P10 card bucket totals ──");
  console.log(`  before   food=${fmt0(before.sums.food)}  pack=${fmt0(before.sums.packaging)}  vehicle=${fmt0(before.sums.vehicle)}  billed=${fmt0(before.sums.billed)}`);
  console.log(`  after*   food=${fmt0(projectedAfter.food)}  pack=${fmt0(projectedAfter.packaging)}  vehicle=${fmt0(projectedAfter.vehicle)}  billed=${fmt0(projectedAfter.billed)}`);
  console.log(`           (* projected; dry-run only)`);
  console.log(`  P10 card rows total=${before.totalRows}  excluded/sga-dropped=${before.dropped}`);

  // Out-of-range control count.
  const control = await outOfRangeControlCount(supa);
  console.log("");
  console.log("── out-of-range control (must be unchanged post-apply) ──");
  console.log(`  rippling_spend rows txn_date <  ${P10_START} : ${control.prePeriod}`);
  console.log(`  rippling_spend rows txn_date >  ${P10_END  } : ${control.postPeriod}`);

  // Itemize the deferred sets.
  if (stillUncoded.length > 0) {
    console.log("");
    console.log(`── still uncoded in report (${stillUncoded.length}) ──`);
    for (const row of stillUncoded) {
      const a = row.actuals;
      console.log(`  id=${a.id}  acct=${dkey(a.account_key)}  ${dkey(a.vendor_or_merchant)}  ${dkey(a.txn_date)}  amount=${fmt0(a.amount)}`);
    }
  }
  if (excludedFlipDeferred.length > 0) {
    console.log("");
    console.log(`── excluded re-coding DEFERRED (${excludedFlipDeferred.length}) - needs account_key reset ruling ──`);
    for (const row of excludedFlipDeferred) {
      const a = row.actuals;
      console.log(`  id=${a.id}  acct=${dkey(a.account_key)}  ${dkey(a.vendor_or_merchant)}  ${dkey(a.txn_date)}  amount=${fmt0(a.amount)}  new_gl=${row.newGl || "(null)"}  new_excl=${row.newExcl}`);
    }
  }
  if (noMatch.length > 0) {
    console.log("");
    console.log(`── no match on (account, vendor, date, amount) (${noMatch.length}) ──`);
    for (const a of noMatch) {
      console.log(`  id=${a.id}  acct=${dkey(a.account_key)}  ${dkey(a.vendor_or_merchant)}  ${dkey(a.txn_date)}  amount=${fmt0(a.amount)}`);
    }
  }

  // ─── Dry-run exit ────────────────────────────────────────────────
  if (!args.apply) {
    console.log("");
    console.log("DRY-RUN: no write. Pass --apply to execute the backfill.");
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`done: dry-run only, duration=${dur}s`);
    process.exit(0);
  }

  // ─── Apply ───────────────────────────────────────────────────────
  if (toCode.length === 0) {
    console.log("");
    console.log("APPLY: zero rows in apply set - nothing to do.");
    process.exit(0);
  }

  console.log("");
  console.log(`APPLY: calling apply_card_coding_backfill with ${toCode.length} rows`);
  const payload = toCode.map(t => ({
    id: t.id,
    gl_line_code: t.gl_line_code,
    gl_bucket: t.gl_bucket,
    excluded: t.excluded,
  }));

  const rpcResp = await supa.rpc("apply_card_coding_backfill", { p_rows: payload });
  if (rpcResp.error) {
    console.error(`apply_card_coding_backfill FAILED: ${rpcResp.error.message}`);
    process.exit(3);
  }
  const updated = Number(rpcResp.data || 0);
  console.log(`RPC returned: updated=${updated}`);

  // Post-apply snapshots.
  const afterControl = await outOfRangeControlCount(supa);
  const afterBuckets = await sumBucketsP10Cards(supa);
  console.log("");
  console.log("── post-apply snapshots ──");
  console.log(`  rippling_spend rows txn_date <  ${P10_START} : before=${control.prePeriod} after=${afterControl.prePeriod}`);
  console.log(`  rippling_spend rows txn_date >  ${P10_END  } : before=${control.postPeriod} after=${afterControl.postPeriod}`);
  console.log(`  P10 card bucket totals after   food=${fmt0(afterBuckets.sums.food)}  pack=${fmt0(afterBuckets.sums.packaging)}  vehicle=${fmt0(afterBuckets.sums.vehicle)}  billed=${fmt0(afterBuckets.sums.billed)}`);

  if (afterControl.prePeriod !== control.prePeriod || afterControl.postPeriod !== control.postPeriod) {
    console.error("");
    console.error(`CONTROL-COUNT VIOLATION: out-of-range rippling_spend row count changed. Before pre=${control.prePeriod} post=${control.postPeriod}; after pre=${afterControl.prePeriod} post=${afterControl.postPeriod}.`);
    process.exit(3);
  }
  console.log(`out-of-range control: HELD (counts identical before/after)`);

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`done: applied=${updated} duration=${dur}s`);
}

main().catch(e => {
  console.error(`fatal: ${e.message}`);
  process.exit(2);
});

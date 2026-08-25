#!/usr/bin/env node
/*
 * Snapshot for the walk-completeness PR.
 *
 * Purpose: capture (before) and later (after) state for the delta
 * report Kevin asked for.
 *
 * Reports for source='rippling_spend', excluded=false, FYTD:
 *   - total row count in rippling_raw_spend_lines_latest
 *   - total row count in purchasing_actuals filtered to rippling_spend
 *   - max(txn_date)
 *   - by account_key: sum(amount), row count
 *   - by (account_key, gl_bucket): sum(amount), row count
 *   - by (account_key, gl_bucket): sum plus rippling_spend billcom_sentinel
 *   - portfolio P9 kpi budget (bill.com sentinel; must not move)
 *   - TBR - FL P8 gl 3200.1 billcom sentinel  (must not move)
 *
 * Writes JSON to argv[1] so a before/after diff is possible. Read-only.
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("env SUPABASE_URL:              ", SB_URL ? "PRESENT" : "ABSENT");
console.log("env SUPABASE_SERVICE_ROLE_KEY: ", SB_KEY ? "PRESENT" : "ABSENT");
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }

const outPath = process.argv[2] || `/tmp/r10_snapshot_${new Date().toISOString().slice(0, 10)}.json`;
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const FY_START = "2025-12-29";

async function pageAll(query) {
  const rows = [];
  const PS = 1000;
  for (let from = 0; ; from += PS) {
    const { data, error } = await query.range(from, from + PS - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PS) break;
  }
  return rows;
}

async function main() {
  const snapshot = { snapshot_at: new Date().toISOString(), fy_start: FY_START };

  // rippling_raw_spend_lines_latest total count
  {
    const { count } = await supa
      .from("rippling_raw_spend_lines_latest")
      .select("rippling_id", { count: "exact", head: true });
    snapshot.raw_lines_latest_count = count;
  }
  // rippling_raw_spend_lines_latest max first_seen_at (proxy for last sync visibility)
  {
    const { data } = await supa
      .from("rippling_raw_spend_lines_latest")
      .select("first_seen_at")
      .order("first_seen_at", { ascending: false })
      .limit(1);
    snapshot.raw_lines_latest_max_first_seen = data?.[0]?.first_seen_at || null;
  }
  // rippling_raw_spend_lines_latest max rippling_id (UUIDv7 -> newest line-mint)
  {
    const { data } = await supa
      .from("rippling_raw_spend_lines_latest")
      .select("rippling_id")
      .order("rippling_id", { ascending: false })
      .limit(1);
    snapshot.raw_lines_latest_max_rippling_id = data?.[0]?.rippling_id || null;
    if (snapshot.raw_lines_latest_max_rippling_id) {
      const hex = snapshot.raw_lines_latest_max_rippling_id.replace(/-/g, "").slice(0, 12);
      const ms = Number(BigInt("0x" + hex));
      snapshot.raw_lines_latest_max_mint_iso = new Date(ms).toISOString();
      snapshot.raw_lines_latest_max_mint_age_days = ((Date.now() - ms) / 86400000).toFixed(2);
    }
  }

  // purchasing_actuals for source=rippling_spend
  const acts = await pageAll(
    supa.from("purchasing_actuals")
      .select("account_key, gl_bucket, gl_line_code, amount, txn_date, excluded")
      .eq("source", "rippling_spend")
      .eq("excluded", false)
      .gte("txn_date", FY_START)
      .order("txn_date", { ascending: false }),
  );
  snapshot.purchasing_actuals_rippling_count = acts.length;
  snapshot.purchasing_actuals_rippling_max_txn_date = acts[0]?.txn_date || null;

  // Aggregate by account_key
  const byAcct = new Map();
  const byAcctBucket = new Map();
  for (const r of acts) {
    const amt = Number(r.amount || 0);
    const a = r.account_key || "(null)";
    const b = r.gl_bucket || "(null)";
    if (!byAcct.has(a)) byAcct.set(a, { count: 0, sum: 0 });
    byAcct.get(a).count += 1;
    byAcct.get(a).sum += amt;
    const key = `${a}||${b}`;
    if (!byAcctBucket.has(key)) byAcctBucket.set(key, { account_key: a, gl_bucket: b, count: 0, sum: 0 });
    byAcctBucket.get(key).count += 1;
    byAcctBucket.get(key).sum += amt;
  }
  snapshot.by_account = [...byAcct.entries()].map(([k, v]) => ({
    account_key: k, count: v.count, sum: Math.round(v.sum * 100) / 100,
  })).sort((a, b) => a.account_key.localeCompare(b.account_key));
  snapshot.by_account_bucket = [...byAcctBucket.values()].map(v => ({
    ...v, sum: Math.round(v.sum * 100) / 100,
  })).sort((a, b) => (a.account_key + a.gl_bucket).localeCompare(b.account_key + b.gl_bucket));

  // Sentinel probes (must not move)
  {
    const s1 = await pageAll(
      supa.from("purchasing_actuals")
        .select("amount")
        .eq("account_key", "TBR - FL")
        .eq("source", "billcom")
        .eq("excluded", false)
        .eq("gl_line_code", "3200.1")
        .gte("txn_date", "2026-07-13")
        .lte("txn_date", "2026-08-09"),
    );
    const sum = s1.reduce((s, r) => s + Number(r.amount || 0), 0);
    snapshot.sentinel_tbrfl_p8_3200_1 = Math.round(sum * 100) / 100;
  }
  // Portfolio P9 kpi budget - queried from kpi_budgets
  {
    const { data } = await supa
      .from("kpi_budgets")
      .select("account_key, gl_line_code, amount")
      .eq("period_no", 9)
      .in("gl_line_code", ["3200.1", "3200.2", "3400.1", "3400.2", "3400.5", "3500.2", "3500.3", "3500.4", "3500.5"]);
    // Sum across all 11 accounts (matches page.js totals.pl_cogs.budget for P9 ALL)
    let sum = 0;
    for (const r of data || []) sum += Number(r.amount || 0);
    snapshot.sentinel_portfolio_p9_pl_cogs_budget = Math.round(sum * 100) / 100;
  }

  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nwrote snapshot to: ${outPath}`);
  console.log(`\nraw_lines_latest_count:               ${snapshot.raw_lines_latest_count}`);
  console.log(`raw_lines_latest_max_first_seen:      ${snapshot.raw_lines_latest_max_first_seen}`);
  console.log(`raw_lines_latest_max_mint_iso:        ${snapshot.raw_lines_latest_max_mint_iso}`);
  console.log(`raw_lines_latest_max_mint_age_days:   ${snapshot.raw_lines_latest_max_mint_age_days}`);
  console.log(`purchasing_actuals_rippling_count:    ${snapshot.purchasing_actuals_rippling_count}`);
  console.log(`purchasing_actuals_rippling_max_txn:  ${snapshot.purchasing_actuals_rippling_max_txn_date}`);
  console.log(`sentinel TBR-FL P8 3200.1 billcom:    $${snapshot.sentinel_tbrfl_p8_3200_1}`);
  console.log(`sentinel portfolio P9 kpi budget:     $${snapshot.sentinel_portfolio_p9_pl_cogs_budget}`);
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });

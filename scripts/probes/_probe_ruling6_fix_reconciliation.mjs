#!/usr/bin/env node
// scripts/probes/_probe_ruling6_fix_reconciliation.mjs
//
// Post-fix reconciliation for the Ruling 6 scope-restoration PR.
// Read-only.
//
// PURPOSE
//   Kevin's ruling 2026-09-01 requires three re-runs in the fix PR:
//     (a) purchasing reconciliation against the P8 finance workbook -
//         the prior 0.23% raw no longer describes the board
//     (b) food and packaging vs finance, per account, YTD-P8
//     (c) Overview sentinels + parity - see separate probes
//   This probe delivers (a) and (b) in one pass by reading pnl_actuals
//   (finance truth, already seeded from the P8 workbook via
//   scripts/derive_pnl_actuals.mjs) and purchasing_actuals (post-fix
//   board totals) and comparing per (account_key, gl_line_code).
//
// APPROACH
//   Window: YTD-P8 = 2025-12-29 .. 2026-08-09 (fiscal P1..P8, matches
//   the workbook's period cutoff and every prior recon window).
//
//   Finance side: SUM(actual) from pnl_actuals where period IN 1..8
//   grouped by (account_key, line_code).
//
//   Board side: SUM(amount) from purchasing_actuals where excluded=false
//   and txn_date IN window grouped by (account_key, gl_line_code).
//   Includes both source='rippling_spend' and source='billcom' (the two
//   writers on purchasing_actuals per the two-writer rule).
//
//   Buckets:
//     - Food:      gl 3200.x
//     - Packaging: gl 3400.x
//     - Vehicle:   gl 3500.x
//   Reports per-account + portfolio deltas for each bucket, and a
//   portfolio Purchasing (food+pkg+vehicle) reconciliation to restate
//   the 0.23% figure Kevin flagged.
//
// USAGE
//   node --env-file=.env.local scripts/probes/_probe_ruling6_fix_reconciliation.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const WINDOW_START = "2025-12-29";
const WINDOW_END   = "2026-08-09";
const PERIOD_MAX   = 8;
const PAGE = 1000;

function fmt$(v) {
  const n = Math.round(Number(v || 0) * 100) / 100;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(num, den) {
  if (!den) return "n/a";
  return `${((num / den) * 100).toFixed(2)}%`;
}
function bucketOf(gl) {
  const s = String(gl || "");
  if (s.startsWith("3200")) return "food";
  if (s.startsWith("3400")) return "packaging";
  if (s.startsWith("3500")) return "vehicle";
  return null;
}

async function accountKeys() {
  const r = await supa.from("accounts").select("team_key").neq("team_key", "CORP").order("team_key");
  if (r.error) throw new Error(r.error.message);
  return (r.data || []).map(x => x.team_key);
}

async function pnlByAccountBucket(accounts) {
  // pnl_actuals YTD-P8, buckets by line_code prefix.
  const chunkSize = 100;
  const totals = new Map();  // acct -> { food, packaging, vehicle }
  for (const acct of accounts) totals.set(acct, { food: 0, packaging: 0, vehicle: 0 });

  for (let i = 0; i < accounts.length; i += chunkSize) {
    const chunk = accounts.slice(i, i + chunkSize);
    let from = 0;
    while (true) {
      const r = await supa
        .from("pnl_actuals")
        .select("account_key, line_code, period_no, actual")
        .in("account_key", chunk)
        .lte("period_no", PERIOD_MAX)
        .order("account_key", { ascending: true })
        .order("period_no", { ascending: true })
        .order("line_code", { ascending: true })
        .range(from, from + PAGE - 1);
      if (r.error) throw new Error(`pnl_actuals page ${from}: ${r.error.message}`);
      const rows = r.data || [];
      for (const row of rows) {
        const b = bucketOf(row.line_code);
        if (!b) continue;
        const t = totals.get(row.account_key);
        if (!t) continue;
        t[b] += Number(row.actual || 0);
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  return totals;
}

async function boardByAccountBucket(accounts) {
  // purchasing_actuals YTD-P8, all sources, excluded=false.
  const chunkSize = 100;
  const totals = new Map();  // acct -> { food, packaging, vehicle, food_bill, food_card, pkg_bill, pkg_card, veh_bill, veh_card }
  for (const acct of accounts) totals.set(acct, {
    food: 0, packaging: 0, vehicle: 0,
    food_bill: 0, food_card: 0, pkg_bill: 0, pkg_card: 0, veh_bill: 0, veh_card: 0,
  });

  for (let i = 0; i < accounts.length; i += chunkSize) {
    const chunk = accounts.slice(i, i + chunkSize);
    let from = 0;
    while (true) {
      const r = await supa
        .from("purchasing_actuals")
        .select("account_key, source, gl_line_code, amount, txn_date")
        .in("account_key", chunk)
        .eq("excluded", false)
        .gte("txn_date", WINDOW_START)
        .lte("txn_date", WINDOW_END)
        .order("account_key", { ascending: true })
        .order("txn_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (r.error) throw new Error(`purchasing_actuals page ${from}: ${r.error.message}`);
      const rows = r.data || [];
      for (const row of rows) {
        const b = bucketOf(row.gl_line_code);
        if (!b) continue;
        const t = totals.get(row.account_key);
        if (!t) continue;
        const amt = Number(row.amount || 0);
        t[b] += amt;
        if (row.source === "billcom") t[`${b === "food" ? "food" : b === "packaging" ? "pkg" : "veh"}_bill`] += amt;
        else if (row.source === "rippling_spend") t[`${b === "food" ? "food" : b === "packaging" ? "pkg" : "veh"}_card`] += amt;
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  return totals;
}

function tableRow(acct, finVal, boardVal) {
  const delta = boardVal - finVal;
  const pct = fmtPct(delta, finVal);
  return `  ${acct.padEnd(15)} finance=${fmt$(finVal).padStart(14)}  board=${fmt$(boardVal).padStart(14)}  Δ=${fmt$(delta).padStart(14)}  Δ%=${pct.padStart(9)}`;
}

async function main() {
  console.log(`# Ruling 6 fix reconciliation - ${new Date().toISOString()}`);
  console.log(`# Window: YTD-P8 (${WINDOW_START} .. ${WINDOW_END}, periods 1..${PERIOD_MAX})`);
  console.log(`# Finance side: pnl_actuals (already seeded from P8 workbook)`);
  console.log(`# Board side:   purchasing_actuals where excluded=false (post-Ruling-6-fix)`);
  console.log("");

  const accounts = await accountKeys();
  const fin = await pnlByAccountBucket(accounts);
  const board = await boardByAccountBucket(accounts);

  const buckets = ["food", "packaging", "vehicle"];
  for (const b of buckets) {
    console.log(`## ${b.toUpperCase()} (${b === "food" ? "gl 3200.x" : b === "packaging" ? "gl 3400.x" : "gl 3500.x"})`);
    let finTot = 0, boardTot = 0, billTot = 0, cardTot = 0;
    for (const acct of accounts) {
      const finVal = fin.get(acct)?.[b] || 0;
      const boardVal = board.get(acct)?.[b] || 0;
      finTot += finVal; boardTot += boardVal;
      const suffix = b === "food" ? "food" : b === "packaging" ? "pkg" : "veh";
      billTot += board.get(acct)?.[`${suffix}_bill`] || 0;
      cardTot += board.get(acct)?.[`${suffix}_card`] || 0;
      console.log(tableRow(acct, finVal, boardVal));
    }
    console.log(`  ${"PORTFOLIO".padEnd(15)} finance=${fmt$(finTot).padStart(14)}  board=${fmt$(boardTot).padStart(14)}  Δ=${fmt$(boardTot - finTot).padStart(14)}  Δ%=${fmtPct(boardTot - finTot, finTot).padStart(9)}`);
    console.log(`  ${"(source split)".padEnd(15)} billcom=${fmt$(billTot).padStart(13)}  cards=${fmt$(cardTot).padStart(13)}`);
    console.log("");
  }

  // Portfolio purchasing reconciliation (food + packaging + vehicle),
  // restating the prior "0.23% raw" figure post-fix.
  console.log(`## PORTFOLIO PURCHASING RECONCILIATION (food + packaging + vehicle, YTD-P8)`);
  let finPur = 0, boardPur = 0;
  for (const acct of accounts) {
    const f = fin.get(acct) || {};
    const b = board.get(acct) || {};
    finPur += (f.food || 0) + (f.packaging || 0) + (f.vehicle || 0);
    boardPur += (b.food || 0) + (b.packaging || 0) + (b.vehicle || 0);
  }
  console.log(`  finance = ${fmt$(finPur)}`);
  console.log(`  board   = ${fmt$(boardPur)}`);
  console.log(`  Δ       = ${fmt$(boardPur - finPur)}   (${fmtPct(boardPur - finPur, finPur)} of finance)`);
  console.log(`  |Δ|     = ${fmt$(Math.abs(boardPur - finPur))}  (${fmtPct(Math.abs(boardPur - finPur), finPur)} raw)`);
  console.log("");
}

main().catch(e => { console.error(`THROWN: ${e.message || e}`); process.exit(1); });

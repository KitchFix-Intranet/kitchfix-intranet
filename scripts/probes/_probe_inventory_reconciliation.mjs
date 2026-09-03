#!/usr/bin/env node
// scripts/probes/_probe_inventory_reconciliation.mjs
//
// Kevin R-61 (2026-09-03) post-load reconciliation:
// board vs finance food + pkg+sup residual, before and after the
// inventory adjustment. Residual = board_side - finance_side; a
// negative number means the board reads LOWER than finance.
//
//   before = purchases - finance
//   after  = (purchases - inventory_je) - finance   [i.e. adjusted - finance]
//
// Kevin's target: TBR - FL food falls from $7,689 to ~ -$1,998;
//                 TBJ - FL from $15,842 to ~ $12,493. Report all
//                 eight accounts.
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node --env-file=.env.local scripts/probes/_probe_inventory_reconciliation.mjs

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "TBJ - FL", "TBJ - NY",
  "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[fatal] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing - restore .env.local");
  process.exit(2);
}
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function financeSums() {
  // Sum finance-side pnl_actuals P1-P8 per account, aggregating sub-
  // line codes: 3200.* -> food; 3400.* -> pkg+sup.
  const q = await supa
    .from("pnl_actuals")
    .select("account_key, line_code, actual")
    .eq("fiscal_year", 2026)
    .in("account_key", ACCOUNTS)
    .in("period_no", [1, 2, 3, 4, 5, 6, 7, 8])
    .in("line_code", ["3200.1", "3200.2", "3400.1", "3400.2", "3400.5"]);
  if (q.error) throw new Error(JSON.stringify(q.error));
  const out = new Map(ACCOUNTS.map(a => [a, { food: 0, pkg_sup: 0 }]));
  for (const r of q.data || []) {
    const rec = out.get(r.account_key);
    if (!rec) continue;
    if (r.line_code.startsWith("3200")) rec.food += Number(r.actual || 0);
    if (r.line_code.startsWith("3400")) rec.pkg_sup += Number(r.actual || 0);
  }
  return out;
}

async function boardPayload(account) {
  // FYTD range - the resolver now caps at last-closed period (P8) so
  // this covers P1-P8 in one call. `actual_purchased` is raw purchases;
  // `actual` is the adjusted figure (finance-side) that ships to the
  // COGS card.
  const url = `${BASE}/api/kpi/overview?account=${acct(account)}`;
  const r = await fetch(url);
  return r.json();
}

function extract(payload) {
  const rows = (payload.statement_rows || []).filter(r => r.section === "cogs" && !r.parent_line_code);
  const row3200 = rows.find(r => r.line_code === "3200");
  const row3400 = rows.find(r => r.line_code === "3400");
  return {
    food_purchases: row3200?.actual_purchased ?? row3200?.actual ?? null,
    food_adjusted:  row3200?.actual ?? null,
    food_je:        row3200?.inventory_je ?? null,
    pkg_purchases:  row3400?.actual_purchased ?? row3400?.actual ?? null,
    pkg_adjusted:   row3400?.actual ?? null,
    pkg_je:         row3400?.inventory_je ?? null,
  };
}

function fmt(n) {
  if (n == null || Number.isNaN(Number(n))) return "     n/a  ";
  const v = Number(n);
  const abs = Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0, minimumFractionDigits: 0 });
  return (v < 0 ? "-$" : " $") + abs.padStart(9);
}

async function main() {
  console.log(`# inventory reconciliation - ${new Date().toISOString()}`);
  console.log(`# board FYTD (auto-caps to P1-P8 per R-52); finance P1-P8 pnl_actuals`);
  console.log(`# residual = board_side - finance   |   after = adjusted - finance`);
  console.log("");
  const finance = await financeSums();
  const rows = [];
  for (const a of ACCOUNTS) {
    const p = await boardPayload(a);
    if (p.error) { console.log(`  ${a}: HTTP ${JSON.stringify(p.error)}`); continue; }
    const b = extract(p);
    const f = finance.get(a) || { food: 0, pkg_sup: 0 };
    const foodPur = b.food_purchases;
    const foodAdj = b.food_adjusted;
    const pkgPur  = b.pkg_purchases;
    const pkgAdj  = b.pkg_adjusted;
    const foodBefore = foodPur != null ? foodPur - f.food : null;
    const foodAfter  = foodAdj != null ? foodAdj - f.food : null;
    const pkgBefore  = pkgPur != null ? pkgPur - f.pkg_sup : null;
    const pkgAfter   = pkgAdj != null ? pkgAdj - f.pkg_sup : null;
    rows.push({ a, foodBefore, foodAfter, pkgBefore, pkgAfter, foodJe: b.food_je, pkgJe: b.pkg_je });
  }

  console.log("account          |    food_before |   food_after  |    pkg_before |    pkg_after  |   food_je   |   pkg_je");
  console.log("-----------------+----------------+---------------+---------------+---------------+-------------+---------");
  for (const r of rows) {
    console.log(`${r.a.padEnd(16)} |  ${fmt(r.foodBefore)}   |  ${fmt(r.foodAfter)}  |  ${fmt(r.pkgBefore)}  |  ${fmt(r.pkgAfter)}  |  ${fmt(r.foodJe)}  |  ${fmt(r.pkgJe)}`);
  }
  console.log("");
  // Kevin's two predictions.
  const tbr = rows.find(r => r.a === "TBR - FL");
  const tbj = rows.find(r => r.a === "TBJ - FL");
  console.log("Kevin's predictions:");
  console.log(`  TBR - FL food:  before $${tbr.foodBefore?.toFixed(0)} -> after $${tbr.foodAfter?.toFixed(0)}  (predicted after: -$1,998)`);
  console.log(`  TBJ - FL food:  before $${tbj.foodBefore?.toFixed(0)} -> after $${tbj.foodAfter?.toFixed(0)}  (predicted after: $12,493)`);
}
main().catch(e => { console.error(e); process.exit(1); });

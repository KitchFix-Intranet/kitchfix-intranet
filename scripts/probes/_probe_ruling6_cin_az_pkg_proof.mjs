#!/usr/bin/env node
// scripts/probes/_probe_ruling6_cin_az_pkg_proof.mjs
//
// The proof number - CIN - AZ packaging cards post-fix.
// Read-only.
//
// Baseline (Kevin's 2026-08-28 capture, byte-exact per
// docs/audits/PURCHASING_CARD_LANE_EMPTY_CIN_AZ_2026-09-01.md:29):
//   packaging cards = $23,574.60 on 2026-08-28 pre-fix
//   packaging cards = $0.00      on the board 2026-08-31 post-Ruling-6-defect
//
// Post-fix expectation: the 99 API-coded packaging rows Ruling 6 was
// excluding should now be back on the board with excluded=false, so
// packaging cards should read back near $23,574.60 (plus any post-08-28
// coding activity).
//
// This probe replicates the exact board-side codedCardSpentForGl query:
//   src/app/api/kpi/purchasing/route.js:602-610 -> in-memory sum where
//   r.source === 'rippling_spend' AND r.gl_line_code === gl on
//   purchasing_actuals filtered { account, excluded=false, txn_date in window }.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const ACCOUNT = "CIN - AZ";
const FY_START = "2025-12-29";
const FY_END   = new Date().toISOString().slice(0, 10);
const PAGE = 1000;

async function walk({ start, end }) {
  const out = [];
  let from = 0;
  while (true) {
    const r = await supa
      .from("purchasing_actuals")
      .select("source, gl_line_code, amount, txn_date, excluded, source_line_id, reason")
      .eq("account_key", ACCOUNT)
      .eq("excluded", false)
      .gte("txn_date", start)
      .lte("txn_date", end)
      .order("txn_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(`page ${from}: ${r.error.message}`);
    const rows = r.data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function fmt$(v) {
  const n = Math.round(Number(v || 0) * 100) / 100;
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  console.log(`# CIN - AZ card lane proof - ${new Date().toISOString()}`);
  console.log(`# Query: purchasing_actuals { account='CIN - AZ', excluded=false, txn_date in window }`);
  console.log(`# Then in-memory: source='rippling_spend' AND gl_line_code starts with <bucket>`);
  console.log(`# Baseline: pre-fix (2026-08-31) packaging cards = $0.00; Kevin's 08-28 capture = $23,574.60`);
  console.log("");

  // FYTD-to-today (Kevin's board reads FY-to-latest-closed but FYTD is
  // the same window with unrounded date bounds - report both endpoints).
  const windows = [
    { label: "FYTD-to-today", start: FY_START, end: FY_END },
    { label: "YTD-P8 (2025-12-29..2026-08-09)", start: "2025-12-29", end: "2026-08-09" },
  ];

  for (const w of windows) {
    console.log(`## ${w.label}`);
    const rows = await walk(w);
    const cards = rows.filter(r => r.source === "rippling_spend");
    const bills = rows.filter(r => r.source === "billcom");

    const bucket = (glPrefix) => {
      const cRows = cards.filter(r => String(r.gl_line_code || "").startsWith(glPrefix));
      const bRows = bills.filter(r => String(r.gl_line_code || "").startsWith(glPrefix));
      return {
        cards: { n: cRows.length, sum: cRows.reduce((s, r) => s + Number(r.amount || 0), 0) },
        bills: { n: bRows.length, sum: bRows.reduce((s, r) => s + Number(r.amount || 0), 0) },
      };
    };
    const food = bucket("3200");
    const pkg  = bucket("3400");
    const veh  = bucket("3500");

    console.log(`  Food (3200.x):      cards ${String(food.cards.n).padStart(4)} rows ${fmt$(food.cards.sum).padStart(14)}   bills ${String(food.bills.n).padStart(4)} rows ${fmt$(food.bills.sum).padStart(14)}`);
    console.log(`  Packaging (3400.x): cards ${String(pkg.cards.n).padStart(4)} rows ${fmt$(pkg.cards.sum).padStart(14)}   bills ${String(pkg.bills.n).padStart(4)} rows ${fmt$(pkg.bills.sum).padStart(14)}`);
    console.log(`  Vehicle (3500.x):   cards ${String(veh.cards.n).padStart(4)} rows ${fmt$(veh.cards.sum).padStart(14)}   bills ${String(veh.bills.n).padStart(4)} rows ${fmt$(veh.bills.sum).padStart(14)}`);
    console.log("");
  }

  // Also confirm the pre-fix condition: the ~99 packaging rows that
  // were report_coded on 08-31 should now no longer carry that reason.
  console.log(`## Sanity: CIN - AZ excluded=true reason breakdown FYTD-to-today`);
  let from = 0;
  const excl = [];
  while (true) {
    const r = await supa
      .from("purchasing_actuals")
      .select("source, gl_line_code, amount, txn_date, reason, excluded, source_line_id")
      .eq("source", "rippling_spend")
      .eq("excluded", true)
      .gte("txn_date", FY_START)
      .lte("txn_date", FY_END)
      .order("txn_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (r.error) throw new Error(r.error.message);
    excl.push(...(r.data || []));
    if ((r.data || []).length < PAGE) break;
    from += PAGE;
  }
  // Filter to CIN - AZ via raw source_line_id lookup would be expensive;
  // instead read all excluded rippling_spend and filter by reason only,
  // since excluded rows carry account_key=NULL by CHECK constraint.
  // We measure the portfolio picture here.
  const byReason = new Map();
  for (const r of excl) {
    const k = r.reason || "(null)";
    if (!byReason.has(k)) byReason.set(k, { n: 0, sum: 0 });
    const e = byReason.get(k);
    e.n += 1; e.sum += Number(r.amount || 0);
  }
  console.log(`  ${"reason".padEnd(24)} ${"rows".padStart(6)}  ${"$sum".padStart(14)}   (portfolio-wide, cannot join to account via excluded rows)`);
  for (const k of [...byReason.keys()].sort()) {
    const e = byReason.get(k);
    console.log(`  ${k.padEnd(24)} ${String(e.n).padStart(6)}  ${fmt$(e.sum).padStart(14)}`);
  }
}

main().catch(e => { console.error(`THROWN: ${e.message || e}`); process.exit(1); });

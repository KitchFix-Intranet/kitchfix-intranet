// scripts/_probe_pnl_recon_lag.mjs
// Test Kevin's lag hypothesis: does our labor sum, when its window is
// shifted back N days, match the P&L figure for that same period?
//
// Kevin's evidence: shifting our TBR-FL P8 window back 7 days lands
// within $109 of the P&L figure. Test that hypothesis and expand to
// every account-period pair where there is enough coverage.
//
// Query: labor_actuals_latest weekly totals per account. Compute two
// sums per period:
//   NATIVE:  weeks whose Monday sits within the period boundary
//   SHIFTED: weeks whose Monday sits within the period boundary
//            SHIFTED BACK by 7 days (i.e. one week earlier)
// Compare each sum to the P&L Actual for that period.

import { createClient } from "@supabase/supabase-js";
import { periodStartISO, periodEndISO } from "../src/app/kpi/labor/lib/periods.js";
import fs from "node:fs";

const SUPA_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error("env ABSENT"); process.exit(1); }
const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

const FIN = JSON.parse(fs.readFileSync("/tmp/pnl_finance.json", "utf8"));
const SHEET_TO_ACCT = {
  "CIN-AZ": "CIN - AZ", "CIN-KY": "CIN - KY", "CIN-OH": "CIN - OH",
  "STL-FL": "STL - FL", "STL-MO": "STL - MO",
  "TBJ-BUF": "TBJ - NY", "TBJ-FL": "TBJ - FL",
  "TBR-FL": "TBR - FL",
  "TXR-AZ": "TXR - AZ", "TXR-HOME": "TXR - TX - H", "TXR-VISTOR": "TXR - TX - V",
};
const accounts = Object.values(SHEET_TO_ACCT);

// Load weekly totals for the whole FY2026 window.
async function loadWeeklyTotals() {
  const PS = 1000;
  const byAcct = new Map();  // acct -> Map<week_start, sum>
  let from = 0;
  while (true) {
    const q = await supa
      .from("labor_actuals_latest")
      .select("account_key, week_start, amount")
      .eq("fiscal_year", 2026)
      .in("account_key", accounts)
      .range(from, from + PS - 1);
    if (q.error) throw new Error(q.error.message);
    for (const r of q.data || []) {
      const inner = byAcct.get(r.account_key) || new Map();
      inner.set(r.week_start, (inner.get(r.week_start) || 0) + Number(r.amount || 0));
      byAcct.set(r.account_key, inner);
    }
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return byAcct;
}
const weekly = await loadWeeklyTotals();

function shiftIso(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sumInWindow(map, startIso, endIso) {
  if (!map) return null;
  let sum = 0;
  let anyPresent = false;
  for (const [ws, amt] of map) {
    if (ws >= startIso && ws <= endIso) { sum += amt; anyPresent = true; }
  }
  return anyPresent ? Math.round(sum * 100) / 100 : null;
}

// For every account-period P5..P8 (where DB has coverage), test:
//   native      = sum in [periodStart, periodEnd]
//   shifted-7   = sum in [periodStart - 7, periodEnd - 7]
//   fin_actual  = finance file's Actual value for that period
// Report the delta of each strategy against finance.
console.log("acct".padEnd(15) + " " + "P".padStart(3) + " " + "native".padStart(11) + " " + "shifted".padStart(11) + " " + "fin".padStart(11) + " " + "d_native".padStart(10) + " " + "d_shifted".padStart(10));
for (const [sheet, acct] of Object.entries(SHEET_TO_ACCT)) {
  const map = weekly.get(acct);
  for (let p = 5; p <= 8; p++) {
    const ps = periodStartISO(p);
    const pe = periodEndISO(p);
    const native = sumInWindow(map, ps, pe);
    const shifted = sumInWindow(map, shiftIso(ps, -7), shiftIso(pe, -7));
    const fin = FIN[sheet]?.periods?.[`P${p}`]?.hourly_actual ?? null;
    if (native == null && shifted == null && (fin == null || fin === 0)) continue;
    const dNative = (native != null && fin != null) ? Math.round((native - fin) * 100) / 100 : null;
    const dShifted = (shifted != null && fin != null) ? Math.round((shifted - fin) * 100) / 100 : null;
    console.log(
      acct.padEnd(15) + " " +
      String(p).padStart(3) + " " +
      String(native ?? "-").padStart(11) + " " +
      String(shifted ?? "-").padStart(11) + " " +
      String(fin ?? "-").padStart(11) + " " +
      String(dNative ?? "-").padStart(10) + " " +
      String(dShifted ?? "-").padStart(10)
    );
  }
}

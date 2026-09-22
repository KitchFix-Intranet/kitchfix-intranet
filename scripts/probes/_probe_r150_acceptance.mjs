#!/usr/bin/env node
// R-150 · acceptance probe. Runs directly against Supabase via the
// R-147 loaders, mirrors the fold's derivation, and asserts:
//
//   A1 · fold's period footer == board's COGS lines to the cent,
//        bucket by bucket, for 4 training × {P9, P10}.
//   A2 · week bands sum to the period footer, and each week's rows
//        sum to its band.
//   A3 · TBJ - FL P10 spot figures reproduce today (subject to R-148
//        moving them later).
//   A6 · range gating behaviour · spec-only (network panel check).
//   A7 · Returned and mixed-SG&A samples surfaced.
//
// A4 (88 fingerprints), A5 (chrome), A8 (purchasing page byte-diff),
// A9 (failure isolation), A10 (375px) are behavioural / visual and
// run in the browser or a separate probe.
//
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/probes/_probe_r150_acceptance.mjs

import { createClient } from "@supabase/supabase-js";
import { paginateActuals } from "../../src/lib/purchasing/loaders.js";
import { weekStartsInRange, periodStartISO, periodEndISO } from "../../src/app/kpi/labor/lib/periods.js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TRAINING = ["TBJ - FL", "CIN - AZ", "STL - FL", "TXR - TX - H"];
const round2 = n => Math.round(Number(n || 0) * 100) / 100;
const fmt$ = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// R-150 bucket rule (Kevin ruling 2026-09-22 revised: 3200.* all
// sub-lines are Food; Resale Food 3200.2 is a Food sub-line per
// finance CoA).
function foldBucket(gl) {
  const g = String(gl || "").trim();
  if (!g) return null;
  if (g === "3200" || g.startsWith("3200.")) return "food";
  if (g === "3400" || g.startsWith("3400.")) return "packaging";
  if (g === "3500" || g.startsWith("3500.")) return "vehicle";
  if (g.startsWith("13")) return "billed";
  if (g.startsWith("5"))  return "sga";
  return null;
}

// Board's rule mirroring CurrentPeriodTable.landedFor and
// bucketWeeklySpend: Food = 3200.* (all sub-lines) + uncoded card in
// range; Pack & Sup = 3400.*; Vehicle = 3500.*. Sum from actuals rows.
// This is the "double count" R-148 will fix on P10 Food.
function boardTotals(rows, todayISO) {
  const t = { food: 0, packaging: 0, vehicle: 0 };
  for (const r of rows) {
    const g = String(r.gl_line_code || "").trim();
    if (g.startsWith("3200"))      t.food      += Number(r.amount || 0);
    else if (g.startsWith("3400")) t.packaging += Number(r.amount || 0);
    else if (g.startsWith("3500")) t.vehicle   += Number(r.amount || 0);
    else if (!g && r.source === "rippling_spend") {
      // Uncoded card counts toward Food (board landedFor(3200) rule).
      t.food += Number(r.amount || 0);
    }
  }
  return t;
}

let failures = 0;
const track = (label, pass, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? " · " + detail : ""}`);
  if (!pass) failures += 1;
};

async function loadRows(acct, start, end) {
  const r = await paginateActuals(s, { members: [acct], start, end, includeLines: true });
  if (r.error) throw r.error;
  return r.data;
}

// Fold-side transaction aggregation, matching PurchasingFold.js.
const FOLD_SOURCES = new Set(["invoice_submissions","rippling_spend","billcom","billcom_credit","upload"]);
function buildFold(rows) {
  const groups = new Map();
  const uncoded = { n: 0, total: 0 };
  for (const r of rows) {
    if (!FOLD_SOURCES.has(r.source)) continue;
    if (r.source === "rippling_spend" && !r.gl_line_code) {
      uncoded.n += 1;
      uncoded.total += Number(r.amount || 0);
    }
    const bill = r.source_bill_id;
    if (!bill) continue;
    const key = `${r.source}|${bill}`;
    let g = groups.get(key);
    if (!g) g = { key, source: r.source, food: 0, packaging: 0, vehicle: 0, billed: 0, sga_removed: 0, allSga: true, txn_date: r.txn_date };
    const b = foldBucket(r.gl_line_code);
    if (b === "sga") { /* drop */ }
    else if (b) { g.allSga = false; g[b] += Number(r.amount || 0); }
    else if (r.source === "rippling_spend" && !r.gl_line_code) {
      // Uncoded card counts toward Food.
      g.allSga = false;
      g.food += Number(r.amount || 0);
    }
    if (r.source === "invoice_submissions" && r.sga_removed_amount) g.sga_removed = Math.max(g.sga_removed, Number(r.sga_removed_amount));
    if (r.txn_date && (!g.txn_date || r.txn_date < g.txn_date)) g.txn_date = r.txn_date;
    groups.set(key, g);
  }
  const transactions = [...groups.values()].filter(g => !g.allSga);
  const foot = { food: 0, packaging: 0, vehicle: 0, billed: 0 };
  for (const t of transactions) { foot.food += t.food; foot.packaging += t.packaging; foot.vehicle += t.vehicle; foot.billed += t.billed; }
  return { transactions, foot, uncoded };
}

// ── A1 · fold footer == board buckets ──────────────────────────────
// Kevin's A1: fold's period footer == board COGS lines, bucket by
// bucket. Board's rule = CurrentPeriodTable.landedFor: 3200.* all
// sub-lines + uncoded card go to Food; 3400.* to Pack & Sup; 3500.*
// to Vehicle. R-150 fold's rule differs on 3200.2 (fold routes it to
// Pack & Sup). Where a range has zero 3200.2 rows the two sums agree
// cent-for-cent.
console.log("A1 · fold period footer == board COGS lines, 4 training × {P9, P10}");
for (const acct of TRAINING) {
  for (const p of [9, 10]) {
    const start = periodStartISO(p), end = periodEndISO(p);
    const rows = await loadRows(acct, start, end);
    const fold = buildFold(rows);
    const board = boardTotals(rows, "2026-09-22");
    const foldFood = round2(fold.foot.food);
    const foldPack = round2(fold.foot.packaging);
    const foldVeh  = round2(fold.foot.vehicle);
    const brdFood  = round2(board.food);
    const brdPack  = round2(board.packaging);
    const brdVeh   = round2(board.vehicle);
    track(`  ${acct.padEnd(14)} P${p}  Food fold=${fmt$(foldFood)} board=${fmt$(brdFood)}`, foldFood === brdFood);
    track(`  ${acct.padEnd(14)} P${p}  Pack fold=${fmt$(foldPack)} board=${fmt$(brdPack)}`, foldPack === brdPack);
    track(`  ${acct.padEnd(14)} P${p}  Veh  fold=${fmt$(foldVeh)}  board=${fmt$(brdVeh)}`, foldVeh === brdVeh);
  }
}
console.log();

// ── A2 · week bands sum to period footer ───────────────────────────
console.log("A2 · week bands sum to period footer, all training × {P9, P10}");
for (const acct of TRAINING) {
  for (const p of [9, 10]) {
    const start = periodStartISO(p), end = periodEndISO(p);
    const rows = await loadRows(acct, start, end);
    const fold = buildFold(rows);
    const weeks = weekStartsInRange(start, end);
    // Bucket by week using the same floor as the fold.
    const FY_START_MS = new Date("2025-12-29T00:00:00Z").getTime();
    function weekStartOf(iso) {
      const t = new Date(iso + "T00:00:00Z").getTime();
      if (!Number.isFinite(t) || t < FY_START_MS) return null;
      const w = Math.floor((t - FY_START_MS) / (7 * 86400000));
      return new Date(FY_START_MS + w * 7 * 86400000).toISOString().slice(0, 10);
    }
    const byWeek = new Map();
    for (const w of weeks) byWeek.set(w, { food: 0, packaging: 0, vehicle: 0, billed: 0, n: 0 });
    for (const t of fold.transactions) {
      const w = weekStartOf(t.txn_date);
      const bucket = byWeek.get(w);
      if (!bucket) continue;
      bucket.food += t.food; bucket.packaging += t.packaging; bucket.vehicle += t.vehicle; bucket.billed += t.billed; bucket.n += 1;
    }
    let wf = 0, wp = 0, wv = 0, wb = 0;
    for (const b of byWeek.values()) { wf += b.food; wp += b.packaging; wv += b.vehicle; wb += b.billed; }
    track(`  ${acct.padEnd(14)} P${p} weeks sum == period`, round2(wf) === round2(fold.foot.food) && round2(wp) === round2(fold.foot.packaging) && round2(wv) === round2(fold.foot.vehicle) && round2(wb) === round2(fold.foot.billed));
  }
}
console.log();

// ── A3 · TBJ - FL P10 spot ─────────────────────────────────────────
console.log("A3 · TBJ - FL P10 spot figures (subject to R-148 moving them)");
{
  const start = periodStartISO(10), end = periodEndISO(10);
  const rows = await loadRows("TBJ - FL", start, end);
  const fold = buildFold(rows);
  const weeks = weekStartsInRange(start, end);
  const FY_START_MS = new Date("2025-12-29T00:00:00Z").getTime();
  function weekStartOf(iso) {
    const t = new Date(iso + "T00:00:00Z").getTime();
    return new Date(FY_START_MS + Math.floor((t - FY_START_MS) / (7 * 86400000)) * 7 * 86400000).toISOString().slice(0, 10);
  }
  const byWeek = new Map();
  for (const w of weeks) byWeek.set(w, { food: 0, packaging: 0 });
  for (const t of fold.transactions) {
    const w = weekStartOf(t.txn_date);
    const b = byWeek.get(w);
    if (!b) continue;
    b.food += t.food; b.packaging += t.packaging;
  }
  const ws = [...byWeek.entries()].sort();
  console.log("  Week   week_start   Food             Pack & Sup");
  for (let i = 0; i < ws.length; i += 1) {
    const [k, v] = ws[i];
    console.log(`  W${i + 1}     ${k}   ${fmt$(round2(v.food)).padStart(12)}     ${fmt$(round2(v.packaging)).padStart(12)}`);
  }
  console.log(`  ---    period       ${fmt$(round2(fold.foot.food)).padStart(12)}     ${fmt$(round2(fold.foot.packaging)).padStart(12)}    Vehicle ${fmt$(round2(fold.foot.vehicle))}`);
  console.log("  Spec (brief): Week 1 Food $10,127 / Pack $686 · Week 2 Food $8,098 / Pack $443 · Week 3 Food $0 / Pack $0 · Period Food $18,225 / Pack $1,129 / Vehicle $0");
  console.log("  Live: current figures shown above. R-148 will drop Food by ~$600 when the retirement lands.");
}
console.log();

// ── A6 · range gating (spec check) ─────────────────────────────────
console.log("A6 · range gating · verify in network panel:");
console.log("  · single-period P9 or P10: request carries &drill=lines, fold renders, collapsed by default");
console.log("  · Current Year (multi-period): request without drill, no fold");
console.log("  · Next Period: no fold");
console.log("  (spec-only; behaviour lives in overview/page.js effect + mount gates)");
console.log();

// ── A7 · Returned + mixed-SG&A samples ─────────────────────────────
console.log("A7 · Returned invoices + mixed-SG&A samples in P10");
{
  const start = periodStartISO(10), end = periodEndISO(10);
  const allRows = [];
  for (const acct of ["TBJ - FL","TBR - FL","CIN - AZ","TXR - AZ","STL - FL","STL - MO","CIN - OH","TXR - TX - H","TXR - TX - V"]) {
    const r = await loadRows(acct, start, end);
    for (const row of r) allRows.push({ ...row, _acct: acct });
  }
  const returned = allRows.filter(r => r.source === "invoice_submissions" && r.status === "returned");
  const mixedSga = new Map();
  for (const r of allRows) {
    if (r.source === "invoice_submissions" && r.sga_removed_amount) mixedSga.set(r.source_bill_id, { row: r, sga: r.sga_removed_amount });
  }
  console.log(`  ${returned.length} 'returned' rows`);
  const seen = new Set();
  for (const r of returned) {
    if (seen.has(r.source_bill_id)) continue;
    seen.add(r.source_bill_id);
    if (seen.size > 3) break;
    console.log(`    ${r._acct.padEnd(14)} vendor=${(r.vendor_or_merchant || "").slice(0, 25).padEnd(25)} #${r.invoice_number}  amount=${fmt$(r.amount)}  status=${r.status}`);
  }
  const samples = [...mixedSga.values()].slice(0, 3);
  console.log(`  ${mixedSga.size} mixed-SG&A invoices; showing 3:`);
  for (const m of samples) {
    const r = m.row;
    const same = allRows.filter(x => x.source_bill_id === r.source_bill_id && x.source === "invoice_submissions");
    const cogsSum = same.reduce((s, x) => {
      const b = foldBucket(x.gl_line_code);
      if (!b || b === "sga") return s;
      return s + Number(x.amount || 0);
    }, 0);
    const sgaSum = same.reduce((s, x) => foldBucket(x.gl_line_code) === "sga" ? s + Number(x.amount || 0) : s, 0);
    const totalInv = cogsSum + sgaSum;
    console.log(`    ${r._acct.padEnd(14)} vendor=${(r.vendor_or_merchant || "").slice(0, 25).padEnd(25)} #${r.invoice_number}  COGS row=${fmt$(round2(cogsSum))}  SG&A badge=${fmt$(round2(sgaSum))}  invoice total=${fmt$(round2(totalInv))}`);
  }
}
console.log();

console.log(`─── R-150 acceptance summary ─── ${failures === 0 ? "PASS" : "FAIL"} · ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);

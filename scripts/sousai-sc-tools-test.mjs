#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/sousai-sc-tools-test.mjs
// Phase F PR 2 · CLI probe for the six SC + spend data tools.
//
// Read-only against production PG. Requires the sousai-1 migration to be
// applied in Studio (the four views must exist).
//
// Run:
//   node --env-file=.env.local scripts/sousai-sc-tools-test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { scAccountWindow } from "../src/lib/sousai/tools/data/scAccountWindow.js";
import { scHomestandDetail } from "../src/lib/sousai/tools/data/scHomestandDetail.js";
import { scServicePrice } from "../src/lib/sousai/tools/data/scServicePrice.js";
import { scOrientation } from "../src/lib/sousai/tools/data/scOrientation.js";
import { spendSummary } from "../src/lib/sousai/tools/data/spendSummary.js";
import { spendVendorHistory } from "../src/lib/sousai/tools/data/spendVendorHistory.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

let passed = 0, failed = 0;
const failures = [];

async function run(label, fn) {
  console.log(`\n${BOLD}▶ ${label}${RESET}`);
  try {
    await fn();
    passed++;
    console.log(`  ${GREEN}PASS${RESET}`);
  } catch (e) {
    failed++;
    failures.push({ label, error: e.message });
    console.log(`  ${RED}FAIL${RESET}: ${e.message}`);
    if (e.stack) console.log(`  ${DIM}${e.stack.split("\n").slice(1, 4).join("\n  ")}${RESET}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function log(o) { console.log(`  ${DIM}${JSON.stringify(o, null, 2).split("\n").join("\n  ")}${RESET}`); }

// ── sc_orientation ─────────────────────────────────────────────────────────

await run("sc_orientation - CIN-OH (MLB) returns homestand + period, no phase", async () => {
  const r = await scOrientation({ accountKey: "CIN - OH" });
  log(r);
  assert(r.homestand?.applicable === true, "homestand should apply for MLB account");
  assert(r.period?.applicable === true, "period should apply");
  assert(r.phase?.applicable === false, "phase should NOT apply for non-PDC");
  assert(r.period?.period_label === "Period 8", `expected period_label='Period 8', got '${r.period?.period_label}'`);
  assert(r.period?.period_short === "P8", `expected period_short='P8', got '${r.period?.period_short}'`);
  assert(r.period?.day_number === (r.period?.days_elapsed + 1), "day_number should be days_elapsed + 1");
});

await run("sc_orientation - TXR-AZ (PDC) returns phase, no homestand", async () => {
  const r = await scOrientation({ accountKey: "TXR - AZ" });
  log({
    homestand_applicable: r.homestand?.applicable,
    homestand_reason: r.homestand?.reason,
    period: r.period?.period_label,
    phase: r.phase?.phase,
  });
  assert(r.homestand?.applicable === false, "homestand should NOT apply for PDC account");
  assert(r.phase?.applicable === true, "phase should apply for PDC");
  assert(r.phase?.phase, "phase name should be present");
});

await run("sc_orientation - CORP has no service dimensions", async () => {
  const r = await scOrientation({ accountKey: "CORP" });
  log({
    homestand: r.homestand?.applicable,
    period: r.period?.applicable,
    phase: r.phase?.applicable,
  });
  assert(r.homestand?.applicable === false, "CORP: no homestand");
  assert(r.period?.applicable === false, "CORP: no period");
  assert(r.phase?.applicable === false, "CORP: no phase");
});

await run("sc_orientation - bare 'what period are we in' (no accountKey)", async () => {
  const r = await scOrientation({ scope: "period" });
  log(r);
  assert(r.period?.applicable === true, "should return period");
  assert(r.period?.company_wide === true, "should be marked company_wide");
  assert(r.period?.period_label === "Period 8", `expected 'Period 8', got '${r.period?.period_label}'`);
  assert(r.parameters?.accountKey === null, "should have null accountKey in params");
});

await run("sc_orientation - unknown teamKey returns known-keys note", async () => {
  const r = await scOrientation({ accountKey: "BGC", scope: "all" });
  log(r);
  assert(r.note && r.note.includes("current-season list"), "expected current-season-list language");
});

await run("sc_orientation - missing accountKey with scope=all errors clearly", async () => {
  const r = await scOrientation({ scope: "all" });
  log(r);
  assert(r.error && r.error.includes("accountKey is required"), "expected clear error");
});

// ── sc_account_window ──────────────────────────────────────────────────────

await run("sc_account_window - CIN-OH month view returns summary shape", async () => {
  const r = await scAccountWindow({ accountKey: "CIN - OH", window: "month" });
  log({
    days_with_actuals: r.days_with_actuals,
    total_service_days: r.total_service_days,
    is_partial: r.is_partial,
    meals: r.meals,
    revenue_available: r.revenue?.available,
    window_boundaries: r.window_boundaries,
  });
  assert(typeof r.days_with_actuals === "number", "days_with_actuals number");
  assert(typeof r.total_service_days === "number", "total_service_days number");
  assert(typeof r.is_partial === "boolean", "is_partial boolean");
  assert(r.meals && typeof r.meals.projected === "number", "meals.projected number");
  assert(r.window_boundaries?.label, "label present");
});

await run("sc_account_window - period window uses P-label", async () => {
  const r = await scAccountWindow({ accountKey: "CIN - OH", window: "period" });
  log({ label: r.window_boundaries?.label, is_partial: r.is_partial });
  assert(r.window_boundaries?.label?.startsWith("Period "), `expected 'Period N' label, got '${r.window_boundaries?.label}'`);
});

// ── sc_homestand_detail ────────────────────────────────────────────────────

await run("sc_homestand_detail - CIN-OH current homestand returns rows", async () => {
  const r = await scHomestandDetail({ accountKey: "CIN - OH", homestandRef: "current" });
  log({
    homestand_id: r.homestand_id,
    date_range: r.date_range,
    total_days: r.total_days,
    days_without_actuals: r.days_without_actuals,
    row_count: r.row_count,
    sample_row: r.rows?.[0],
  });
  assert(r.homestand_id, "homestand_id present");
  assert(Array.isArray(r.rows), "rows array");
  // no-entry days should have actual_meals === null (distinct from 0)
  const noEntryRow = r.rows.find((row) => !row.has_actuals);
  if (noEntryRow) {
    assert(noEntryRow.actual_meals === null, `no-entry day should have actual_meals=null, got ${noEntryRow.actual_meals}`);
  }
});

// ── sc_service_price ───────────────────────────────────────────────────────

await run("sc_service_price - TBJ-FL breakfast returns prices", async () => {
  const r = await scServicePrice({ accountKey: "TBJ - FL", serviceNameOrId: "breakfast" });
  log({
    total: r.total,
    priced_count: r.priced_count,
    unpriced_count: r.unpriced_count,
    sample: r.matches?.[0],
  });
  assert(r.total >= 1, `expected at least 1 breakfast match at TBJ-FL, got ${r.total}`);
});

await run("sc_service_price - no match returns friendly note", async () => {
  const r = await scServicePrice({ accountKey: "CIN - OH", serviceNameOrId: "nonexistent-service-xyz" });
  log(r);
  assert(r.matches?.length === 0, "expected 0 matches");
  assert(r.note && r.note.includes("service-catalog gap"), "expected coverage note");
});

// ── spend_summary ──────────────────────────────────────────────────────────

await run("spend_summary - Sysco this year (vendor alias resolution)", async () => {
  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);
  const r = await spendSummary({ vendorName: "Sysco", window: "ytd", asOf });
  log({
    dollar_total: r.totals?.dollar_total,
    line_count: r.totals?.line_count,
    date_range: `${r.parameters?.dateFrom} to ${r.parameters?.dateTo}`,
    historical_lines: r.totals?.historical_lines,
    top_categories: Object.entries(r.by_category || {}).sort((a, b) => b[1] - a[1]).slice(0, 5),
  });
  assert(typeof r.totals?.dollar_total === "number", "dollar total number");
  assert(r.totals.line_count >= 0, "line count non-negative");
});

await run("spend_summary - STL-FL food this month", async () => {
  const asOf = new Date().toISOString().slice(0, 10);
  const r = await spendSummary({ accountKey: "STL - FL", category: "food", window: "month", asOf });
  log({
    dollar_total: r.totals?.dollar_total,
    line_count: r.totals?.line_count,
    date_range: `${r.parameters?.dateFrom} to ${r.parameters?.dateTo}`,
    by_vendor_top3: Object.entries(r.by_vendor || {}).sort((a, b) => b[1] - a[1]).slice(0, 3),
  });
  assert(typeof r.totals?.dollar_total === "number", "dollar total number");
});

await run("spend_summary - unknown vendor returns friendly note", async () => {
  const r = await spendSummary({ vendorName: "TotallyNonexistentVendor", window: "month" });
  log(r);
  assert(r.note && r.note.includes("no vendor found"), "expected no-vendor note");
});

// ── spend_vendor_history ───────────────────────────────────────────────────

await run("spend_vendor_history - Sysco last 30 days", async () => {
  const now = new Date();
  const dateTo = now.toISOString().slice(0, 10);
  const from = new Date(now); from.setDate(from.getDate() - 30);
  const dateFrom = from.toISOString().slice(0, 10);
  const r = await spendVendorHistory({ vendorName: "Sysco", dateFrom, dateTo });
  log({
    matched_vendor_names: r.matched_vendor_names,
    total_lines: r.total_lines,
    total_dollars: r.total_dollars,
    truncated: r.truncated,
    sample_row: r.rows?.[0],
  });
  assert(typeof r.total_lines === "number", "total_lines number");
});

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}══════════════════════════════════════════════════${RESET}`);
console.log(`${BOLD}Summary${RESET}: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : GREEN}${failed} failed${RESET}`);
if (failed > 0) {
  console.log(`\n${BOLD}Failures:${RESET}`);
  for (const f of failures) console.log(`  ${RED}${f.label}${RESET}: ${f.error}`);
  process.exit(1);
}
process.exit(0);

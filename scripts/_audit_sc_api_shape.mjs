// Import the live orchestrator and exercise loadAccountConfig +
// loadMonthData(January) + loadYearSummary for CIN-AZ, TBJ-FL, TXR-TX-H.
// Verify: serviceGroups shape, days array (31 entries for Jan), prices
// match sc_service_prices, year months array has 12 entries with day
// arrays. NO writes.

import { createClient } from "@supabase/supabase-js";
import {
  loadAccountConfig,
  loadMonthData,
  loadYearSummary,
} from "../src/lib/dataStore/serviceCalendar.js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TARGETS = ["CIN - AZ", "TBJ - FL", "TXR - TX - H"];
const YEAR = 2026;
const JAN = 1;

function checkmark(b) { return b ? "✓" : "✗"; }

for (const acct of TARGETS) {
  console.log(`\n══════ ${acct} ══════`);

  // 1. loadAccountConfig
  const cfg = await loadAccountConfig(acct);
  console.log(`loadAccountConfig:`);
  console.log(`  groups:   ${cfg.groups.length}  (active: ${cfg.groups.filter(g => g.active).length})`);
  console.log(`  services: ${cfg.services.length}  (active: ${cfg.services.filter(s => s.active).length})`);
  // Spot: every service has a groupName, sortOrder, price (>= 0 numeric)
  let badShape = 0;
  for (const s of cfg.services) {
    if (typeof s.groupName !== "string" || s.groupName === "") badShape++;
    if (typeof s.sortOrder !== "number") badShape++;
    if (typeof s.price !== "number" || isNaN(s.price)) badShape++;
  }
  console.log(`  ${checkmark(badShape === 0)} service shape integrity: ${badShape === 0 ? "all good" : badShape + " issues"}`);
  // Sort order monotonic per group?
  const groupSvcLists = new Map();
  for (const s of cfg.services) {
    if (!groupSvcLists.has(s.groupId)) groupSvcLists.set(s.groupId, []);
    groupSvcLists.get(s.groupId).push(s.sortOrder);
  }
  let monoBad = 0;
  for (const arr of groupSvcLists.values()) {
    for (let i = 1; i < arr.length; i++) if (arr[i] < arr[i-1]) monoBad++;
  }
  console.log(`  ${checkmark(monoBad === 0)} services sorted (group, sortOrder): ${monoBad === 0 ? "ok" : monoBad + " out of order"}`);

  // Cross-check: cfg.services prices == sc_service_prices latest
  const svcIds = cfg.services.map((s) => s.id);
  const { data: priceRows } = await supa.from("sc_service_prices")
    .select("service_id, price, effective_date")
    .in("service_id", svcIds)
    .order("effective_date", { ascending: false });
  const latestPrice = new Map();
  for (const r of priceRows || []) {
    if (!latestPrice.has(r.service_id)) latestPrice.set(r.service_id, Number(r.price));
  }
  let priceMismatch = 0;
  const mismatchDetail = [];
  for (const s of cfg.services) {
    const pg = latestPrice.has(s.id) ? latestPrice.get(s.id) : 0;
    if (Math.round(s.price * 100) !== Math.round(pg * 100)) {
      priceMismatch++;
      mismatchDetail.push({ service: s.serviceName, group: s.groupName, cfg: s.price, pg });
    }
  }
  console.log(`  ${checkmark(priceMismatch === 0)} prices match sc_service_prices latest: ${priceMismatch === 0 ? "all match" : priceMismatch + " mismatches"}`);
  if (priceMismatch > 0) for (const m of mismatchDetail.slice(0, 5)) console.log(`    ${m.group}/${m.service}: cfg=$${m.cfg}  pg=$${m.pg}`);

  // 2. loadMonthData(Jan 2026)
  const month = await loadMonthData(acct, YEAR, JAN);
  console.log(`\nloadMonthData(${YEAR}-01):`);
  console.log(`  month: ${month.month}  ${checkmark(month.month === "2026-01")}`);
  console.log(`  days array length: ${month.days.length}  ${checkmark(month.days.length === 31)} (expected 31 for January)`);
  // Spot check first day
  if (month.days.length > 0) {
    const d0 = month.days[0];
    const hasServices = Array.isArray(d0.services);
    const hasTotals = d0.totals && typeof d0.totals.projectedCount === "number";
    console.log(`  day[0].date: ${d0.date}  ${checkmark(d0.date === "2026-01-01")}`);
    console.log(`  day[0].services array: ${hasServices ? d0.services.length + " entries" : "MISSING"}  ${checkmark(hasServices)}`);
    console.log(`  day[0].totals shape: ${checkmark(hasTotals)}`);
  }
  // Check: every day's services array has same shape as cfg.services count (per service rows)
  const expectedActiveSvcs = cfg.services.filter((s) => s.active).length;
  const dayServiceCounts = new Set(month.days.map((d) => d.services.length));
  console.log(`  distinct day.services.length values: ${[...dayServiceCounts].join(",")}  (config active svc = ${expectedActiveSvcs})`);

  // 3. loadYearSummary
  const year = await loadYearSummary(acct, YEAR);
  console.log(`\nloadYearSummary(${YEAR}):`);
  console.log(`  year: ${year.year}  ${checkmark(year.year === YEAR)}`);
  console.log(`  months array length: ${year.months.length}  ${checkmark(year.months.length === 12)} (expected 12 for full year)`);
  if (year.months.length !== 12) {
    const got = year.months.map(m => m.month).join(", ");
    console.log(`  months present: ${got}`);
  }
  // Per-month: days array exists, status values are valid
  const validStatuses = new Set(["entered", "no-service", "overdue", "needs-entry", "future"]);
  let invalidStatusCount = 0;
  let totalYearDays = 0;
  for (const m of year.months) {
    if (!Array.isArray(m.days)) { invalidStatusCount++; continue; }
    totalYearDays += m.days.length;
    for (const d of m.days) {
      if (!validStatuses.has(d.status)) invalidStatusCount++;
    }
  }
  console.log(`  ${checkmark(invalidStatusCount === 0)} all day statuses valid: ${invalidStatusCount === 0 ? "ok" : invalidStatusCount + " invalid"}`);
  console.log(`  total year days across all months: ${totalYearDays}`);
}

console.log("\n══════ DONE ══════");

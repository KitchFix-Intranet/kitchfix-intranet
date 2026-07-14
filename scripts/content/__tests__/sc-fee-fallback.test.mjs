// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/__tests__/sc-fee-fallback.test.mjs
//
// Unit tests for the Part 3 Bug B fix + 2026-07-14 widening: the Service
// Calendar loaders were dropping schedule-bearing dates from days[] when
// sc_daily_revenue happened not to cover them. That silently vanished
// Kevin's four flagged MLB fee getaway AWAY dates + the AAA / PDCO
// authored-before-schedule gaps too.
//
// The fix extracts the fallback into a shared pure helper
// (addMissingScheduleDates) called by BOTH loaders and scoped by the
// caller to the UNION of homestand + overlay dates. These tests exercise
// the helper + the classify branch it feeds - no DB, no supabase, no
// network. E2E screen-level assertion (navigate to the Month drill and
// see the "@ HOU" chip land on TXR 8/2) is deferred to roadmap 4 per
// Kevin's ruling.
//
// Run via:
//   npm run test:unit
// ─────────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import {
  addMissingScheduleDates,
  classifyDayStatus,
} from "../../../src/lib/dataStore/serviceCalendar.js";

// Kevin's four flagged pattern dates from Part 3, verbatim - the MLB fee
// dates that visually vanished on the Month drill. Grouped by account
// because homestandMap is per-account (TXR 8/30 and CIN 8/30 share the
// calendar date but live in different maps at runtime).
const KEVIN_FLAGGED_BY_ACCOUNT = {
  "TXR - TX - H": [
    { date: "2026-08-02", opp: "HOU" },
    { date: "2026-08-30", opp: "MIL" },
  ],
  "CIN - OH": [
    { date: "2026-08-13", opp: "CWS" },
    { date: "2026-08-30", opp: "CHC" },
  ],
};

// One AAA example from the 2026-07-14 widening probe: TBJ-NY (Buffalo)
// had 5 AWAY + 7 HOME games without projection rows. Buffalo is per-meal
// where meal counts feed billing, so the previous fee-only fallback would
// have left these blank on the drill. Post-widening they materialize.
const AAA_TBJ_MISSING = {
  account: "TBJ - NY",
  awayGetaway: { date: "2026-09-08", opp: "CLT", dayType: "AWAY" },
  homeGame:    { date: "2026-09-15", opp: "ROC", dayType: "GAME" },
};

// Minimal homestandMap fixture. Real map has homestandId + gameTime + more,
// but classifyDayStatus's fee branch reads only dayType; the per-meal
// branch reads only dayType too (for the AWAY short-circuit). Opponent
// comes back via the response's separate homestandMap field on the
// client - not via the day entry itself.
function buildHomestandMap(entries) {
  const m = {};
  for (const e of entries) {
    m[e.date] = {
      homestandId: null,
      dayType: e.dayType || "AWAY",
      opponent: e.opp || null,
      dayNight: null,
      gameTime: null,
      isDoubleheader: false,
    };
  }
  return m;
}

// Default factory matching loadMonthDataPostgres's dayBuckets shape.
const monthDefault = (date) => ({
  date,
  period:     null,
  weekLabel:  null,
  eventLabel: null,
  gameType:   null,
  gameTime:   null,
  services:   [],
});

// Default factory matching loadYearSummaryPostgres's dayState shape.
const yearDefault = (date) => ({
  date,
  hasAct: false,
  anyNonZeroAct: false,
  hasProj: false,
  anyNonZeroProj: false,
  gameType: "",
});

// classify statusCtx builders per branch.
function buildFeeStatusCtx(homestandMap, today = new Date("2026-09-01T12:00:00Z")) {
  const lockCutoff = new Date(today);
  lockCutoff.setDate(lockCutoff.getDate() - 7);
  return {
    today,
    lockCutoff,
    billingModel: "flat_fee",
    hasHomestandData: true,
    homestandMap,
  };
}
function buildPerMealStatusCtx(homestandMap, today = new Date("2026-09-01T12:00:00Z")) {
  const lockCutoff = new Date(today);
  lockCutoff.setDate(lockCutoff.getDate() - 7);
  return {
    today,
    lockCutoff,
    billingModel: "actuals_drive_invoice", // AAA
    hasHomestandData: true,
    homestandMap,
  };
}

// ─── addMissingScheduleDates ────────────────────────────────────────────

test("addMissingScheduleDates: returns 0 for an empty scheduleDates set", () => {
  const map = new Map();
  const added = addMissingScheduleDates(map, new Set(), monthDefault);
  assert.equal(added, 0);
  assert.equal(map.size, 0);
});

test("addMissingScheduleDates: fills Kevin's 4 MLB fee dates when the map starts empty (Month shape, per account)", () => {
  for (const [account, dates] of Object.entries(KEVIN_FLAGGED_BY_ACCOUNT)) {
    const map = new Map();
    const hm = buildHomestandMap(dates);
    const added = addMissingScheduleDates(map, Object.keys(hm), monthDefault);
    assert.equal(added, dates.length, `${account}: added count`);
    for (const d of dates) {
      const entry = map.get(d.date);
      assert.ok(entry, `${account}: expected entry for ${d.date} (@${d.opp})`);
      assert.equal(entry.date, d.date);
      // Shape sanity - fields the Month loader downstream expects.
      assert.equal(entry.services.length, 0);
      assert.equal(entry.period, null);
      assert.equal(entry.gameTime, null);
    }
  }
});

test("addMissingScheduleDates: fills the same MLB dates in Year shape (symmetric with Month)", () => {
  for (const [account, dates] of Object.entries(KEVIN_FLAGGED_BY_ACCOUNT)) {
    const map = new Map();
    const hm = buildHomestandMap(dates);
    const added = addMissingScheduleDates(map, Object.keys(hm), yearDefault);
    assert.equal(added, dates.length, `${account}: added count`);
    for (const d of dates) {
      const entry = map.get(d.date);
      assert.ok(entry, `${account}: expected entry for ${d.date}`);
      assert.equal(entry.hasAct, false);
      assert.equal(entry.hasProj, false);
      assert.equal(entry.anyNonZeroAct, false);
      assert.equal(entry.anyNonZeroProj, false);
    }
  }
});

test("addMissingScheduleDates: fills AAA (per-meal) days that lack projections too (widening rider)", () => {
  const { awayGetaway, homeGame } = AAA_TBJ_MISSING;
  const map = new Map();
  const hm = buildHomestandMap([awayGetaway, homeGame]);
  const added = addMissingScheduleDates(map, Object.keys(hm), monthDefault);
  assert.equal(added, 2, "AAA: both AWAY and GAME materialize");
  assert.ok(map.get(awayGetaway.date));
  assert.ok(map.get(homeGame.date));
});

test("addMissingScheduleDates: unions homestand + overlay dates (PDCO widening rider)", () => {
  // PDCO STL-FL shape: no homestandMap, only overlay. The union should
  // still materialize each overlay date so the day appears on the drill.
  const map = new Map();
  const homestandDates = [];
  const overlayDates = ["2026-07-21", "2026-07-22", "2026-08-04"];
  const union = new Set([...homestandDates, ...overlayDates]);
  const added = addMissingScheduleDates(map, union, monthDefault);
  assert.equal(added, 3);
  for (const d of overlayDates) assert.ok(map.get(d), `overlay date ${d} materialized`);
});

test("addMissingScheduleDates: does NOT overwrite existing entries", () => {
  const map = new Map();
  const [firstAcctDates] = Object.values(KEVIN_FLAGGED_BY_ACCOUNT);
  const preseeded = firstAcctDates[0].date;
  // Pre-seed one of the dates as if sc_daily_revenue actually had rows
  // for it (the normal shape). The fallback must not clobber it.
  map.set(preseeded, { date: preseeded, services: [{ preexisting: true }] });
  const hm = buildHomestandMap(firstAcctDates);
  const added = addMissingScheduleDates(map, Object.keys(hm), monthDefault);
  assert.equal(added, firstAcctDates.length - 1);
  const preserved = map.get(preseeded);
  assert.equal(preserved.services.length, 1);
  assert.equal(preserved.services[0].preexisting, true);
});

// ─── classifyDayStatus on synthesized dayShape ──────────────────────────────

test("synthesized fallback day + hs.dayType=AWAY -> classify returns 'away' (fee branch, Kevin's 4 dates)", () => {
  for (const [account, dates] of Object.entries(KEVIN_FLAGGED_BY_ACCOUNT)) {
    const hm = buildHomestandMap(dates);
    const ctx = buildFeeStatusCtx(hm);
    for (const d of dates) {
      const s = { date: d.date, hasAct: false, anyNonZeroAct: false, hasProj: false, anyNonZeroProj: false };
      assert.equal(classifyDayStatus(s, ctx), "away",
        `${account} ${d.date} (@${d.opp}) should classify as away`);
    }
  }
});

test("synthesized fallback day + hs.dayType=AWAY -> classify returns 'away' (per-meal branch, AAA)", () => {
  const { awayGetaway } = AAA_TBJ_MISSING;
  const hm = buildHomestandMap([awayGetaway]);
  const ctx = buildPerMealStatusCtx(hm);
  const s = { date: awayGetaway.date, hasAct: false, anyNonZeroAct: false, hasProj: false, anyNonZeroProj: false };
  assert.equal(classifyDayStatus(s, ctx), "away",
    "AAA per-meal branch also short-circuits AWAY days for schedule-having accounts");
});

test("synthesized fallback day + hs.dayType=GAME + no actuals -> classify returns 'future' (fee)", () => {
  // A HOME game day with no sc_daily_revenue rows (rider 2 — the fallback
  // catches this shape too, so future MLB HOME games materialize as game
  // days with 0 meals rather than disappearing).
  const hm = buildHomestandMap([{ date: "2026-08-03", dayType: "GAME", opp: "SF" }]);
  const ctx = buildFeeStatusCtx(hm);
  const s = { date: "2026-08-03", hasAct: false, anyNonZeroAct: false, hasProj: false, anyNonZeroProj: false };
  assert.equal(classifyDayStatus(s, ctx), "future");
});

test("synthesized fallback day + no hs -> classify returns 'off-season' (safeguard)", () => {
  // If a date is added to dayBuckets by mistake with no matching
  // homestandMap entry, it classifies as off-season (existing safeguard).
  const ctx = buildFeeStatusCtx({});
  const s = { date: "2026-08-02", hasAct: false, anyNonZeroAct: false, hasProj: false, anyNonZeroProj: false };
  assert.equal(classifyDayStatus(s, { ...ctx, hasHomestandData: true }), "off-season");
});

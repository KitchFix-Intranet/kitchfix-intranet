// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/__tests__/schedule-drift.test.mjs
//
// Unit tests for the schedule-drift watchdog's PURE differ + Slack payload
// formatter. No I/O, no DB, no HTTP. Fixtures cover: clean run, time change,
// PPD / DATE_DRIFT, new DH game_pk (MISSING_IN_DB), PHANTOM_IN_DB, KNOWN_ISSUES
// suppression grouping, and PDCO AWAY-by-design suppression.
//
// Run via:
//   npm run test:unit
// ─────────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import {
  TRACKED_TEAMS,
  KNOWN_ISSUES,
  diffSchedule,
  formatSlackPayload,
  normalizeOpp,
  localDate,
  HEARTBEAT_DOW,
} from "../../../src/lib/scheduleDrift.js";

// ─── Constants + helpers ─────────────────────────────────────────────

test("TRACKED_TEAMS: 8 accounts, correct sportId mix (Part 4 §P4.1)", () => {
  assert.equal(TRACKED_TEAMS.length, 8);
  const bySport = TRACKED_TEAMS.reduce((a, t) => (a[t.sportId] = (a[t.sportId] || 0) + 1, a), {});
  assert.deepEqual(bySport, { 1: 4, 11: 2, 14: 2 });
});

test("TRACKED_TEAMS: TXR H+V share the same MLB teamId (per _extract_sc_13 doctrine)", () => {
  const txrH = TRACKED_TEAMS.find(t => t.account === "TXR - TX - H");
  const txrV = TRACKED_TEAMS.find(t => t.account === "TXR - TX - V");
  assert.equal(txrH.teamId, txrV.teamId);
  assert.equal(txrH.teamId, 140);
});

test("normalizeOpp: AZ -> ARI, OAK -> ATH, passthrough otherwise", () => {
  assert.equal(normalizeOpp("AZ"), "ARI");
  assert.equal(normalizeOpp("OAK"), "ATH");
  assert.equal(normalizeOpp("STL"), "STL");
  assert.equal(normalizeOpp(null), null);
});

test("localDate: known Central-time midnight-crossing case (Rangers home game)", () => {
  // 2026-04-04 03:35Z is 2026-04-03 22:35 CT (day before UTC).
  assert.equal(localDate("2026-04-04T03:35:00Z", "America/Chicago"), "2026-04-03");
  // Noon UTC same day both zones.
  assert.equal(localDate("2026-04-04T12:00:00Z", "America/Chicago"), "2026-04-04");
});

test("KNOWN_ISSUES: every entry has game_pk + account + reason (schema sanity)", () => {
  for (const k of KNOWN_ISSUES) {
    assert.ok(k.game_pk, "game_pk required");
    assert.ok(k.account, "account required");
    assert.ok(k.reason, "reason required");
  }
});

// ─── diffSchedule: clean run ─────────────────────────────────────────

test("diffSchedule: clean run produces zero drifts", () => {
  const apiGames = [
    { date: "2026-07-10", game_pk: 900001, ha: "HOME", opp: "HOU", status: "Scheduled", isPPD: false, dhCode: "N", gameNumber: 1, gameTimeUtc: "2026-07-11T00:05:00Z" },
    { date: "2026-07-11", game_pk: 900002, ha: "HOME", opp: "HOU", status: "Scheduled", isPPD: false, dhCode: "N", gameNumber: 1, gameTimeUtc: "2026-07-11T23:05:00Z" },
  ];
  const hsRows = [
    { service_date: "2026-07-10", day_type: "GAME", opponent: "HOU", game_pk: 900001, game_time: "2026-07-11T00:05:00+00:00" },
    { service_date: "2026-07-11", day_type: "GAME", opponent: "HOU", game_pk: 900002, game_time: "2026-07-11T23:05:00+00:00" },
  ];
  const r = diffSchedule({ apiGames, hsRows, account: "TXR - TX - H" });
  assert.equal(r.drifts.length, 0);
  assert.equal(r.knownGaps.length, 0);
  assert.equal(r.counts.ok, 2);
});

// ─── diffSchedule: time delta ────────────────────────────────────────

test("diffSchedule: time delta beyond 5-min tolerance -> TIME_DELTA", () => {
  const apiGames = [
    { date: "2026-07-10", game_pk: 900001, ha: "HOME", opp: "HOU", status: "Scheduled", isPPD: false, dhCode: "N", gameNumber: 1, gameTimeUtc: "2026-07-11T00:35:00Z" },
  ];
  const hsRows = [
    { service_date: "2026-07-10", day_type: "GAME", opponent: "HOU", game_pk: 900001, game_time: "2026-07-11T00:05:00+00:00" },
  ];
  const r = diffSchedule({ apiGames, hsRows, account: "TXR - TX - H" });
  assert.equal(r.drifts.length, 1);
  assert.equal(r.drifts[0].kind, "TIME_DELTA");
  assert.match(r.drifts[0].details, /delta=30min/);
});

test("diffSchedule: time delta inside 5-min tolerance -> no drift", () => {
  const apiGames = [
    { date: "2026-07-10", game_pk: 900001, ha: "HOME", opp: "HOU", status: "Scheduled", isPPD: false, dhCode: "N", gameNumber: 1, gameTimeUtc: "2026-07-11T00:07:00Z" },
  ];
  const hsRows = [
    { service_date: "2026-07-10", day_type: "GAME", opponent: "HOU", game_pk: 900001, game_time: "2026-07-11T00:05:00+00:00" },
  ];
  const r = diffSchedule({ apiGames, hsRows, account: "TXR - TX - H" });
  assert.equal(r.drifts.length, 0);
  assert.equal(r.counts.ok, 1);
});

// ─── diffSchedule: DATE_DRIFT (PPD makeup class) ─────────────────────

test("diffSchedule: DATE_DRIFT (pk match, hs date != api date) -> alert", () => {
  const apiGames = [
    { date: "2026-07-23", game_pk: 823042, ha: "HOME", opp: "ARI", status: "Scheduled", isPPD: false, dhCode: "N", gameNumber: 1, gameTimeUtc: "2026-07-23T18:15:00Z" },
  ];
  const hsRows = [
    { service_date: "2026-06-25", day_type: "GAME", opponent: "ARI", game_pk: 823042, game_time: null },
  ];
  const r = diffSchedule({ apiGames, hsRows, account: "STL - MO" });
  assert.equal(r.drifts.length, 1);
  assert.equal(r.drifts[0].kind, "DATE_DRIFT");
});

// ─── diffSchedule: MISSING_IN_DB with a new DH secondary game_pk ─────

test("diffSchedule: new DH secondary game_pk -> MISSING_IN_DB drift", () => {
  const apiGames = [
    { date: "2026-08-17", game_pk: 900010, ha: "HOME", opp: "STL", status: "Scheduled", isPPD: false, dhCode: "S", gameNumber: 1, gameTimeUtc: "2026-08-17T17:40:00Z" },
    { date: "2026-08-17", game_pk: 900011, ha: "HOME", opp: "STL", status: "Scheduled", isPPD: false, dhCode: "S", gameNumber: 2, gameTimeUtc: "2026-08-17T22:40:00Z" },
  ];
  const hsRows = [
    { service_date: "2026-08-17", day_type: "GAME", opponent: "STL", game_pk: 900011, game_time: "2026-08-17T22:40:00+00:00" },
  ];
  const r = diffSchedule({ apiGames, hsRows, account: "CIN - OH" });
  const missing = r.drifts.filter(d => d.kind === "MISSING_IN_DB");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].game_pk, 900010);
  assert.equal(r.counts.dh, 2);
});

// ─── diffSchedule: PHANTOM_IN_DB ─────────────────────────────────────

test("diffSchedule: hs row for a pk absent from API -> PHANTOM_IN_DB", () => {
  const apiGames = [];
  const hsRows = [
    { service_date: "2026-07-10", day_type: "GAME", opponent: "HOU", game_pk: 900999, game_time: null },
  ];
  const r = diffSchedule({ apiGames, hsRows, account: "TXR - TX - H" });
  assert.equal(r.drifts.length, 1);
  assert.equal(r.drifts[0].kind, "PHANTOM_IN_DB");
  assert.equal(r.drifts[0].game_pk, 900999);
});

test("diffSchedule: hs EXHIBITION row with null pk -> not counted as phantom", () => {
  const apiGames = [];
  const hsRows = [
    { service_date: "2026-03-23", day_type: "EXHIBITION", opponent: "KC", game_pk: null, game_time: null },
  ];
  const r = diffSchedule({ apiGames, hsRows, account: "TXR - TX - H" });
  assert.equal(r.drifts.length, 0);
});

// ─── diffSchedule: KNOWN_ISSUES suppression ───────────────────────────

test("diffSchedule: KNOWN_ISSUES entry routes drift into knownGaps not drifts", () => {
  const knownPk = KNOWN_ISSUES.find(k => k.account === "CIN - OH")?.game_pk;
  assert.ok(knownPk, "test needs at least one CIN - OH known issue");
  const apiGames = [
    { date: "2026-08-17", game_pk: knownPk, ha: "HOME", opp: "STL", status: "Scheduled", isPPD: false, dhCode: "S", gameNumber: 2, gameTimeUtc: "2026-08-17T22:40:00Z" },
  ];
  const hsRows = [];
  const r = diffSchedule({ apiGames, hsRows, account: "CIN - OH" });
  assert.equal(r.drifts.length, 0);
  assert.equal(r.knownGaps.length, 1);
  assert.equal(r.knownGaps[0].game_pk, knownPk);
});

// ─── diffSchedule: PDCO AWAY-by-design suppression ───────────────────

test("diffSchedule: PDCO (STL - FL) AWAY MISSING_IN_DB -> silently ignored", () => {
  // STL - FL overlay is HOME-only per sc-17. Every FSL AWAY API game is
  // expected to be missing from hs. These should NOT alarm.
  const apiGames = [
    { date: "2026-05-19", game_pk: 900500, ha: "AWAY", opp: "SLU", status: "Scheduled", isPPD: false, dhCode: "N", gameNumber: 1, gameTimeUtc: "2026-05-19T23:00:00Z" },
  ];
  const hsRows = [];
  const r = diffSchedule({ apiGames, hsRows, account: "STL - FL" });
  assert.equal(r.drifts.length, 0);
  assert.equal(r.knownGaps.length, 0);
});

test("diffSchedule: PDCO (STL - FL) HOME MISSING_IN_DB -> still alarms", () => {
  // A HOME PDCO game that's not in the overlay IS a real gap.
  const apiGames = [
    { date: "2026-05-19", game_pk: 900501, ha: "HOME", opp: "SLU", status: "Scheduled", isPPD: false, dhCode: "N", gameNumber: 1, gameTimeUtc: "2026-05-19T23:00:00Z" },
  ];
  const hsRows = [];
  const r = diffSchedule({ apiGames, hsRows, account: "STL - FL" });
  assert.equal(r.drifts.length, 1);
  assert.equal(r.drifts[0].kind, "MISSING_IN_DB");
});

// ─── formatSlackPayload: noise discipline ────────────────────────────

test("formatSlackPayload: clean run + not heartbeat -> shouldPost=false", () => {
  const results = TRACKED_TEAMS.map(t => ({ account: t.account, drifts: [], knownGaps: [], counts: { ok: 100 } }));
  const p = formatSlackPayload({ accountResults: results, isHeartbeat: false });
  assert.equal(p.shouldPost, false);
});

test("formatSlackPayload: clean run + heartbeat -> single 'schedules clean' line", () => {
  const results = TRACKED_TEAMS.map(t => ({ account: t.account, drifts: [], knownGaps: [], counts: { ok: 100 } }));
  const p = formatSlackPayload({ accountResults: results, isHeartbeat: true });
  assert.equal(p.shouldPost, true);
  assert.match(p.text, /schedules clean/);
  assert.match(p.text, /8\/8/);
});

test("formatSlackPayload: real drifts -> shouldPost=true, drifts inline, known-gaps grouped", () => {
  const drift = { kind: "TIME_DELTA", account: "TXR - TX - H", date: "2026-08-02", game_pk: 900001, details: "hs=... api=... delta=30min", severity: "alert" };
  const known = { game_pk: 824514, reason: "DATE_DRIFT waits Option A" };
  const results = [
    { account: "TXR - TX - H", drifts: [drift], knownGaps: [], counts: {} },
    { account: "CIN - OH",     drifts: [],      knownGaps: [known, known], counts: {} },
  ];
  const p = formatSlackPayload({ accountResults: results, isHeartbeat: false });
  assert.equal(p.shouldPost, true);
  assert.match(p.text, /TIME_DELTA/);
  assert.match(p.text, /known gaps: 2 matches across 1 account/);
});

test("formatSlackPayload: >30 drifts truncates with 'N more' line", () => {
  const many = Array.from({ length: 45 }, (_, i) => ({
    kind: "MISSING_IN_DB", account: "TBJ - NY", date: "2026-05-01", game_pk: 900000 + i,
    details: `test drift #${i}`, severity: "alert",
  }));
  const p = formatSlackPayload({ accountResults: [{ account: "TBJ - NY", drifts: many, knownGaps: [], counts: {} }], isHeartbeat: false });
  assert.equal(p.shouldPost, true);
  assert.match(p.text, /\(15 more drift lines truncated\)/);
});

test("formatSlackPayload: failure -> shouldPost=true, red header", () => {
  const results = [
    { account: "CIN - OH", drifts: [], knownGaps: [], counts: {}, error: "API 503" },
    ...TRACKED_TEAMS.slice(1).map(t => ({ account: t.account, drifts: [], knownGaps: [], counts: {} })),
  ];
  const p = formatSlackPayload({ accountResults: results, isHeartbeat: false });
  assert.equal(p.shouldPost, true);
  assert.match(p.text, /rotating_light/);
  assert.match(p.text, /1 failure/);
});

test("HEARTBEAT_DOW: Monday (JS Date.getDay() === 1)", () => {
  assert.equal(HEARTBEAT_DOW, 1);
});

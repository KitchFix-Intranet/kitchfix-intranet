// sc-59 schedule-drift tests - weekly, scoped, plain-English, change-only.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ALERTING_KINDS,
  diffSchedule,
  filterToAlerting,
  humanDate,
  renderDrift,
  renderMoveLine,
  renderDropLine,
  signatureOf,
  computeWeeklyDiff,
  formatWeeklyRecapPayload,
} from "../scheduleDrift.js";

// ─── Fixtures (minimal shapes the differ reads) ───────────────────
function apiGame({ date, game_pk, ha = "HOME", opp = "ATL", status = "Scheduled", isPPD = false, dhCode = "N", gameNumber = 1, gameTimeUtc = null }) {
  return { date, game_pk, ha, opp, status, isPPD, dhCode, gameNumber, gameTimeUtc };
}
function hsRow({ service_date, day_type = "GAME", opponent = "ATL", game_pk, game_time = null }) {
  return { service_date, day_type, opponent, game_pk, game_time };
}

// ─── Test 1: scope + no known-gaps footer ────────────────────────
test("sc-59 scope: only DATE_DRIFT + PHANTOM_IN_DB are alerting; others excluded", () => {
  // Mix of drift kinds all generated from one small fixture:
  // - DATE_DRIFT:   pk 100 (hs 2026-05-01 vs api 2026-05-02)
  // - PHANTOM_IN_DB: pk 200 (in hs, absent from api)
  // - TIME_DELTA:    pk 300 (same pk + date, time off by 20min)
  // - OPP_CHANGE:    pk 400 (same pk + date, opp mismatch)
  // - H_A_FLIP:      pk 500 (same pk + date, HA mismatch)
  // - MISSING_IN_DB: pk 600 (api only, no hs row, not PDCO)
  const apiGames = [
    apiGame({ date: "2026-05-02", game_pk: 100, ha: "HOME", opp: "LAD" }),
    // pk 200 phantom - omit from api
    apiGame({ date: "2026-05-04", game_pk: 300, ha: "HOME", opp: "LAD", gameTimeUtc: "2026-05-04T23:30:00Z" }),
    apiGame({ date: "2026-05-05", game_pk: 400, ha: "HOME", opp: "SF" }),
    apiGame({ date: "2026-05-06", game_pk: 500, ha: "HOME", opp: "SD" }),
    apiGame({ date: "2026-05-07", game_pk: 600, ha: "HOME", opp: "COL" }),
  ];
  const hsRows = [
    hsRow({ service_date: "2026-05-01", game_pk: 100, opponent: "LAD" }),       // DATE_DRIFT
    hsRow({ service_date: "2026-05-03", game_pk: 200, opponent: "ARI" }),       // PHANTOM
    hsRow({ service_date: "2026-05-04", game_pk: 300, opponent: "LAD", game_time: "2026-05-04T22:00:00Z" }), // TIME_DELTA (~90min)
    hsRow({ service_date: "2026-05-05", game_pk: 400, opponent: "MIL" }),       // OPP_CHANGE
    hsRow({ service_date: "2026-05-06", game_pk: 500, day_type: "AWAY", opponent: "SD" }), // H_A_FLIP
    // no pk 600 row -> MISSING_IN_DB
  ];
  const r = diffSchedule({ apiGames, hsRows, account: "CIN - OH" });
  const alerting = filterToAlerting(r.drifts);
  const kinds = new Set(alerting.map((d) => d.kind));

  assert.deepEqual([...kinds].sort(), ["DATE_DRIFT", "PHANTOM_IN_DB"], "only the two tracked kinds survive filterToAlerting");
  assert.equal(alerting.length, 2, "exactly one DATE_DRIFT + one PHANTOM in this fixture");
  assert.ok(r.drifts.length > alerting.length, "the full differ output still includes the other kinds for diagnostics");
  // Known-gaps footer is a rendering concern; recap builder below asserts
  // the footer is gone, not the diff output.
  assert.ok(ALERTING_KINDS.has("DATE_DRIFT"));
  assert.ok(ALERTING_KINDS.has("PHANTOM_IN_DB"));
  assert.ok(!ALERTING_KINDS.has("TIME_DELTA"));
  assert.ok(!ALERTING_KINDS.has("OPP_CHANGE"));
  assert.ok(!ALERTING_KINDS.has("H_A_FLIP"));
  assert.ok(!ALERTING_KINDS.has("MISSING_IN_DB"));
});

// ─── Test 2: plain-English + human date ──────────────────────────
test("sc-59 render: move + drop templates use human dates and the correct vs/at + Home/Away wording", () => {
  assert.equal(humanDate("2026-08-12", 2026), "Wed, Aug 12");
  assert.equal(humanDate("2026-08-11", 2026), "Tue, Aug 11");
  assert.equal(humanDate("2027-01-02", 2026), "Sat, Jan 2, 2027", "year shown when it differs");

  const move = renderMoveLine(
    { kind: "DATE_DRIFT", account: "CIN - OH", game_pk: 1, scDate: "2026-08-11", apiDate: "2026-08-12", opponent: "LAD", homeAway: "HOME" },
    2026
  );
  assert.equal(
    move,
    "*CIN - OH* - Home vs LAD: your calendar shows *Tue, Aug 11*, the league now has it on *Wed, Aug 12*. Update the Service Calendar.",
  );

  const moveAway = renderMoveLine(
    { kind: "DATE_DRIFT", account: "TBJ - FL", game_pk: 2, scDate: "2026-04-05", apiDate: "2026-04-07", opponent: "DUN", homeAway: "AWAY" },
    2026
  );
  assert.match(moveAway, /^\*TBJ - FL\* - Away at DUN: /);

  const drop = renderDropLine(
    { kind: "PHANTOM_IN_DB", account: "STL - MO", game_pk: 3, scDate: "2026-07-04", apiDate: "2026-07-04", opponent: "CHC", homeAway: "HOME" },
    2026
  );
  assert.equal(
    drop,
    "*STL - MO* - Home vs CHC on *Sat, Jul 4*: no longer on the league schedule (cancelled or removed). Remove or update it.",
  );
  // No pk= in visible line.
  assert.ok(!/pk=/i.test(move), "move line hides pk=");
  assert.ok(!/pk=/i.test(drop), "drop line hides pk=");

  // Dispatcher renderDrift must select the right template.
  const d1 = { kind: "DATE_DRIFT", account: "x", scDate: "2026-05-01", apiDate: "2026-05-02", opponent: "A", homeAway: "HOME" };
  const d2 = { kind: "PHANTOM_IN_DB", account: "x", scDate: "2026-05-01", apiDate: "2026-05-01", opponent: "A", homeAway: "AWAY" };
  const d3 = { kind: "TIME_DELTA" };
  assert.ok(/your calendar shows/.test(renderDrift(d1, 2026)));
  assert.ok(/no longer on the league/.test(renderDrift(d2, 2026)));
  assert.equal(renderDrift(d3, 2026), null, "non-alerting kinds yield no renderer");
});

// ─── Test 3: change-only - silent when nothing changed ──────────
test("sc-59 change-only: prior == current -> shouldPost false, no post", () => {
  const current = [
    { signature: "a|1|DATE_DRIFT|2026-05-01|2026-05-02", account_key: "a", kind: "DATE_DRIFT", display: "line A" },
    { signature: "b|2|PHANTOM_IN_DB|2026-06-10",         account_key: "b", kind: "PHANTOM_IN_DB", display: "line B" },
  ];
  const prior = current.map((e) => ({ ...e }));
  const diff = computeWeeklyDiff({ currentEntries: current, priorRows: prior });
  assert.equal(diff.newItems.length, 0);
  assert.equal(diff.clearedItems.length, 0);
  assert.equal(diff.carryOpen, 2);
  // reconcile shape: no inserts, no deletes, only bumps (which stay internal).
  assert.equal(diff.reconcile.inserts.length, 0);
  assert.equal(diff.reconcile.deletes.length, 0);
  assert.equal(diff.reconcile.bumps.length, 2);

  const payload = formatWeeklyRecapPayload({
    newItems: diff.newItems,
    clearedItems: diff.clearedItems,
    carryOpenCount: diff.carryOpen,
    failures: [],
    weekOfIso: "2026-10-12",
    runId: "run1",
  });
  assert.equal(payload.shouldPost, false, "no NEW + no CLEARED + no failures -> silent week");
  assert.equal(payload.text, "");
});

// ─── Test 4: NEW + CLEARED - recap with correct sections ─────────
test("sc-59 change-only: {A,B} prior vs {B,C} current -> NEW C, CLEARED A, carry B", () => {
  const prior = [
    { signature: "sigA", account_key: "A", kind: "DATE_DRIFT",    display: "stored A line", first_seen: "t0", last_seen: "t0" },
    { signature: "sigB", account_key: "B", kind: "PHANTOM_IN_DB", display: "stored B line", first_seen: "t0", last_seen: "t0" },
  ];
  const current = [
    { signature: "sigB", account_key: "B", kind: "PHANTOM_IN_DB", display: "stored B line (unchanged)" },
    { signature: "sigC", account_key: "C", kind: "DATE_DRIFT",    display: "new C line" },
  ];
  const diff = computeWeeklyDiff({ currentEntries: current, priorRows: prior });

  assert.equal(diff.newItems.length, 1);
  assert.equal(diff.newItems[0].signature, "sigC");
  assert.equal(diff.clearedItems.length, 1);
  assert.equal(diff.clearedItems[0].signature, "sigA");
  assert.equal(diff.clearedItems[0].display, "stored A line", "Cleared section replays the stored display");
  assert.equal(diff.carryOpen, 1);
  assert.deepEqual(diff.reconcile.inserts.map((r) => r.signature), ["sigC"]);
  assert.deepEqual(diff.reconcile.deletes, ["sigA"]);
  assert.deepEqual(diff.reconcile.bumps, ["sigB"]);

  const payload = formatWeeklyRecapPayload({
    newItems: diff.newItems,
    clearedItems: diff.clearedItems,
    carryOpenCount: diff.carryOpen,
    failures: [],
    weekOfIso: "2026-10-12",
    runId: "run2",
    runYear: 2026,
  });
  assert.equal(payload.shouldPost, true);
  assert.ok(/Weekly schedule changes.*week of/.test(payload.text), "weekOf header present");
  assert.ok(/New this week/.test(payload.text), "New section present");
  assert.ok(/new C line/.test(payload.text), "New entry rendered");
  assert.ok(/Cleared since last week/.test(payload.text), "Cleared section present");
  assert.ok(/stored A line/.test(payload.text), "Cleared replays prior display");
  assert.ok(/1 change still open from earlier weeks/.test(payload.text), "carry-open one-liner");
  assert.ok(!/stored B line/.test(payload.text), "carry-open items NEVER listed individually");
  assert.ok(!/known gaps:/.test(payload.text), "no known-gaps footer");
  assert.ok(!/pk=/i.test(payload.text), "no pk= dumps in recap");
});

// ─── Test 5: known-gap suppression still holds for DATE_DRIFT ──────
test("sc-59 known-gap suppression intact: a listed DATE_DRIFT pk goes to knownGaps, not drifts", () => {
  // KNOWN_ISSUES has { game_pk: 824518, account: "CIN - OH", reason: "DATE_DRIFT waits Option A ..." }.
  // Build a drift that would otherwise fire.
  const apiGames = [apiGame({ date: "2026-05-23", game_pk: 824518, ha: "HOME", opp: "LAD" })];
  const hsRows   = [hsRow({ service_date: "2026-05-20", game_pk: 824518, opponent: "LAD" })];
  const r = diffSchedule({ apiGames, hsRows, account: "CIN - OH" });
  assert.equal(r.drifts.length, 0, "known pk is suppressed from drifts");
  assert.equal(r.knownGaps.length, 1, "known pk lands in knownGaps for counting");
  assert.equal(r.knownGaps[0].game_pk, 824518);
  // filterToAlerting keeps the suppression obvious: zero alerting on this pk.
  assert.equal(filterToAlerting(r.drifts).length, 0);
});

// ─── Patch: failed-account guard (don't false-clear a drift we did not verify)
test("sc-59 patch: prior drifts for a failed account are NOT cleared or deleted", () => {
  // Prior holds two drifts, one per account. Current run: AAA was
  // fetched OK and still shows sigA; BBB's fetch threw, so BBB
  // contributes zero currentEntries and is in failedAccounts.
  const prior = [
    { signature: "sigA", account_key: "AAA", kind: "DATE_DRIFT",    display: "AAA line", first_seen: "t0", last_seen: "t0" },
    { signature: "sigB", account_key: "BBB", kind: "PHANTOM_IN_DB", display: "BBB line", first_seen: "t0", last_seen: "t0" },
  ];
  const current = [
    { signature: "sigA", account_key: "AAA", kind: "DATE_DRIFT", display: "AAA line" },
  ];
  const diff = computeWeeklyDiff({
    currentEntries: current,
    priorRows:      prior,
    failedAccounts: new Set(["BBB"]),
  });

  assert.deepEqual(diff.clearedItems, [], "no CLEARED - sigB belongs to a failed account");
  assert.deepEqual(diff.reconcile.deletes, [], "sigB must NOT be deleted from state");
  assert.deepEqual(diff.reconcile.bumps, ["sigA"], "sigA is a carry (bump), still verified");
  assert.deepEqual(diff.newItems, [], "no NEW this run");
  assert.deepEqual(diff.reconcile.inserts, [], "no inserts");
  assert.equal(diff.carryOpen, 1, "only sigA counts as carry; sigB is not re-counted as open");

  // sigB appears nowhere in newItems or clearedItems.
  const everywhere = [...diff.newItems, ...diff.clearedItems].map((x) => x.signature);
  assert.ok(!everywhere.includes("sigB"), "sigB must not leak into either section");
});

test("sc-59 patch: with empty failedAccounts, a prior absent from current is still CLEARED + deleted", () => {
  // Regression anchor: the new guard must not silence a legitimate
  // cleared drift when every account was successfully verified.
  const prior = [
    { signature: "sigA", account_key: "AAA", kind: "DATE_DRIFT", display: "AAA line", first_seen: "t0", last_seen: "t0" },
  ];
  const current = []; // AAA was verified; the drift is gone.
  const diff = computeWeeklyDiff({
    currentEntries: current,
    priorRows:      prior,
    failedAccounts: new Set(),  // no failures
  });
  assert.deepEqual(diff.clearedItems.map((x) => x.signature), ["sigA"], "sigA correctly cleared when AAA is verified");
  assert.deepEqual(diff.reconcile.deletes, ["sigA"], "sigA deleted from state");
  assert.equal(diff.carryOpen, 0);
  assert.deepEqual(diff.newItems, []);
});

// ─── Test 6: resilience - state read failure doesn't crash the flow ─
test("sc-59 resilience: when prior state is unavailable, caller falls back to posting current list", () => {
  // The route's fallback simulated here: priorRows = [] means the diff
  // treats every current signature as NEW. computeWeeklyDiff is pure, so
  // the test asserts the fallback path's outputs. The route uses the
  // same shape (passes currentEntries as newItems directly) when the
  // state read itself threw; this test proves nothing crashes and the
  // payload shape is still correct.
  const current = [
    { signature: "sig1", account_key: "a", kind: "DATE_DRIFT", display: "line 1" },
  ];
  const diff = computeWeeklyDiff({ currentEntries: current, priorRows: [] });
  assert.equal(diff.newItems.length, 1);
  assert.equal(diff.clearedItems.length, 0);
  assert.equal(diff.carryOpen, 0);

  const payload = formatWeeklyRecapPayload({
    newItems: diff.newItems,
    clearedItems: [],
    carryOpenCount: 0,
    failures: [],
    weekOfIso: "2026-10-12",
    runId: "runFallback",
  });
  assert.equal(payload.shouldPost, true);
  assert.ok(/New this week/.test(payload.text));
  assert.ok(!/Cleared since last week/.test(payload.text));

  // signatureOf must not throw for a non-alerting kind (returns null;
  // the route drops it defensively before building the entry).
  assert.equal(signatureOf({ kind: "TIME_DELTA" }), null);
});

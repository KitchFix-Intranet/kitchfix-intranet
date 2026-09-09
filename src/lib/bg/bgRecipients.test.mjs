// bgRecipients.test.mjs
//
// Covers the fail-loud fence Kevin ruled on 2026-09-09: if
// bg_report_recipients resolves to an empty TO after validation,
// the caller (cron route) must skip the send and log the source
// rather than silently succeed. These tests exercise the pure
// helpers that produce the { to, cc } split; the route's fail-loud
// branch is asserted structurally (empty TO -> skip).

import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRecipients,
  splitToAndCc,
  previousCalendarMonthISO,
} from "./bgRecipients.js";

// ─── normalizeRecipients ────────────────────────────────────────

test("normalize: empty input -> empty array", () => {
  assert.deepEqual(normalizeRecipients([]), []);
  assert.deepEqual(normalizeRecipients(null), []);
  assert.deepEqual(normalizeRecipients(undefined), []);
});

test("normalize: valid addresses pass through, lowercased + trimmed", () => {
  assert.deepEqual(
    normalizeRecipients(["  Sebastian@KITCHFIX.com  ", "k.fietek@kitchfix.com"]),
    ["sebastian@kitchfix.com", "k.fietek@kitchfix.com"],
  );
});

test("normalize: dedup preserves first-seen order", () => {
  assert.deepEqual(
    normalizeRecipients([
      "a@x.com", "B@X.com", "a@x.com", "  b@x.com  ", "c@x.com",
    ]),
    ["a@x.com", "b@x.com", "c@x.com"],
  );
});

test("normalize: syntactically-invalid entries dropped", () => {
  assert.deepEqual(
    normalizeRecipients([
      "sebastian",              // no @
      "sebastian@",             // no domain
      "sebastian@kitchfix",     // no TLD
      "sebastian@kitchfix.com", // valid
      "",                       // empty
      null,                     // null
      "   ",                    // whitespace only
    ]),
    ["sebastian@kitchfix.com"],
  );
});

test("normalize: guards the fail-loud fence - all-invalid input yields empty array", () => {
  // The route checks to.length === 0 and skips the send. This test
  // is the input to that fence.
  const result = normalizeRecipients(["not-an-email", "also-bad"]);
  assert.deepEqual(result, []);
});

// ─── splitToAndCc ────────────────────────────────────────────────

test("split: empty input -> empty TO + empty CC", () => {
  assert.deepEqual(splitToAndCc([]), { to: [], cc: [] });
  assert.deepEqual(splitToAndCc(null), { to: [], cc: [] });
});

test("split: single recipient -> TO only, no CC", () => {
  assert.deepEqual(
    splitToAndCc(["sebastian@kitchfix.com"]),
    { to: ["sebastian@kitchfix.com"], cc: [] },
  );
});

test("split: first slot TO, rest CC (Kevin ruling)", () => {
  assert.deepEqual(
    splitToAndCc(["sebastian@kitchfix.com", "k.fietek@kitchfix.com", "joe@kitchfix.com"]),
    {
      to: ["sebastian@kitchfix.com"],
      cc: ["k.fietek@kitchfix.com", "joe@kitchfix.com"],
    },
  );
});

// ─── previousCalendarMonthISO ────────────────────────────────────

test("previousMonth: mid-month -> previous month same year", () => {
  const now = new Date("2026-09-15T13:00:00Z");
  assert.equal(previousCalendarMonthISO(now), "2026-08");
});

test("previousMonth: day-4 firing -> previous month", () => {
  // Cron fires 2026-10-04 -> report covers September.
  const now = new Date("2026-10-04T13:00:00Z");
  assert.equal(previousCalendarMonthISO(now), "2026-09");
});

test("previousMonth: January -> previous December of prior year", () => {
  const now = new Date("2027-01-04T13:00:00Z");
  assert.equal(previousCalendarMonthISO(now), "2026-12");
});

test("previousMonth: uses UTC (no local-tz drift)", () => {
  // A UTC noon on 2026-10-04 is still Oct 4 everywhere; previous
  // month is September. If the fn used local time, a US-CT
  // environment at UTC-5 would see 2026-10-04T13Z as 2026-10-04
  // 07:00 CT - same day, no drift. But if the fn were run at
  // 2026-10-04T00:30Z (still Oct 4 UTC, but 2026-10-03 evening CT)
  // local-tz code would produce "2026-09" from Sep 15 perspective.
  // Cron always fires in UTC, so we assert UTC here.
  const now = new Date("2026-10-04T00:30:00Z");
  assert.equal(previousCalendarMonthISO(now), "2026-09");
});

test("previousMonth: February from March correctly picks Feb", () => {
  const now = new Date("2026-03-04T13:00:00Z");
  assert.equal(previousCalendarMonthISO(now), "2026-02");
});

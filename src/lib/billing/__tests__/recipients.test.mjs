// recipients.js resolver tests. F2 exhaustive test-mode matrix +
// F3 live-mode matrix. F6 grep proof asserted structurally: the
// resolver has ONE if-mode==='test' branch that returns Kevin only.

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveRecipients,
  NOTIFICATION_TYPES,
  KEVIN_EMAIL, SEBASTIAN_EMAIL, JOE_EMAIL, JOSH_EMAIL,
} from "../recipients.js";

// ─── F2: test-mode returns Kevin only, for every (notification, account) ──

const ALL_NOTIFICATION_TYPES = Object.values(NOTIFICATION_TYPES);
const PILOT_ACCOUNTS = ["TXR - AZ", "CIN - AZ"];

test("F2 test-mode matrix: every (notification, account) pair returns Kevin only", () => {
  for (const notification of ALL_NOTIFICATION_TYPES) {
    for (const accountKey of PILOT_ACCOUNTS) {
      const out = resolveRecipients({
        notification, accountKey, mode: "test",
        submitterEmail: "site.leader@kitchfix.com",
        accountMap: {
          salariedManagerEmails: ["a@x.com", "b@x.com"],
          rdoEmail: "s.lynch@kitchfix.com",
        },
        adjusterEmail: "adjuster@kitchfix.com",
      });
      assert.deepEqual(out.to, [KEVIN_EMAIL],
        `${notification} ${accountKey}: to should be [KEVIN] got ${JSON.stringify(out.to)}`);
      assert.deepEqual(out.cc, [],
        `${notification} ${accountKey}: cc should be [] got ${JSON.stringify(out.cc)}`);
    }
  }
});

test("F2 test-mode: unknown notification type STILL returns Kevin only (structural override wins)", () => {
  const out = resolveRecipients({
    notification: "UNKNOWN_TYPE",
    accountKey: "TXR - AZ",
    mode: "test",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
  });
  assert.deepEqual(out.to, [KEVIN_EMAIL]);
  assert.deepEqual(out.cc, []);
});

test("F2 test-mode: minimal args (no accountMap, no submitter) still returns Kevin only", () => {
  const out = resolveRecipients({ notification: "anything", mode: "test" });
  assert.deepEqual(out.to, [KEVIN_EMAIL]);
});

// ─── F3: live-mode matrix (addendum §A6) ────────────────────────

const LIVE_ACCOUNT_MAP = {
  salariedManagerEmails: ["l.ochoa@kitchfix.com", "chef2@kitchfix.com"],
  rdoEmail: "s.lynch@kitchfix.com",
};

test("F3 N1: static + salaried + submitter", () => {
  const out = resolveRecipients({
    notification: NOTIFICATION_TYPES.N1,
    accountKey: "TXR - AZ",
    mode: "live",
    submitterEmail: "site.leader@kitchfix.com",
    accountMap: LIVE_ACCOUNT_MAP,
  });
  assert.deepEqual([...out.to].sort(), [
    SEBASTIAN_EMAIL, KEVIN_EMAIL, JOE_EMAIL, JOSH_EMAIL,
    "l.ochoa@kitchfix.com", "chef2@kitchfix.com",
    "site.leader@kitchfix.com",
  ].sort());
  assert.deepEqual(out.cc, []);
  // No RDO on N1 (addendum §A6 explicit).
  assert.ok(!out.to.includes("s.lynch@kitchfix.com"));
  assert.ok(!out.cc.includes("s.lynch@kitchfix.com"));
});

test("F3 N2: Kevin + Sebastian only", () => {
  const out = resolveRecipients({
    notification: NOTIFICATION_TYPES.N2,
    accountKey: "TXR - AZ", mode: "live",
    accountMap: LIVE_ACCOUNT_MAP,
  });
  assert.deepEqual([...out.to].sort(), [KEVIN_EMAIL, SEBASTIAN_EMAIL].sort());
  assert.deepEqual(out.cc, []);
});

test("F3 N3.1: salaried (to), Kevin+Sebastian (cc)", () => {
  const out = resolveRecipients({
    notification: NOTIFICATION_TYPES.N3_1,
    accountKey: "TXR - AZ", mode: "live",
    accountMap: LIVE_ACCOUNT_MAP,
  });
  assert.deepEqual([...out.to].sort(), ["l.ochoa@kitchfix.com", "chef2@kitchfix.com"].sort());
  assert.deepEqual([...out.cc].sort(), [KEVIN_EMAIL, SEBASTIAN_EMAIL].sort());
});

test("F3 N3.2: salaried (to), Kevin+Sebastian (cc) - same as N3.1", () => {
  const out = resolveRecipients({
    notification: NOTIFICATION_TYPES.N3_2,
    accountKey: "TXR - AZ", mode: "live",
    accountMap: LIVE_ACCOUNT_MAP,
  });
  assert.deepEqual([...out.to].sort(), ["l.ochoa@kitchfix.com", "chef2@kitchfix.com"].sort());
  assert.deepEqual([...out.cc].sort(), [KEVIN_EMAIL, SEBASTIAN_EMAIL].sort());
});

test("F3 N3.3: salaried (to), Kevin+Sebastian+RDO (cc)", () => {
  const out = resolveRecipients({
    notification: NOTIFICATION_TYPES.N3_3,
    accountKey: "TXR - AZ", mode: "live",
    accountMap: LIVE_ACCOUNT_MAP,
  });
  assert.deepEqual([...out.to].sort(), ["l.ochoa@kitchfix.com", "chef2@kitchfix.com"].sort());
  assert.deepEqual([...out.cc].sort(),
    [KEVIN_EMAIL, SEBASTIAN_EMAIL, "s.lynch@kitchfix.com"].sort());
});

test("F3 N4: adjuster, Joe, Josh, Sebastian, RDO (to)", () => {
  const out = resolveRecipients({
    notification: NOTIFICATION_TYPES.N4,
    accountKey: "TXR - AZ", mode: "live",
    adjusterEmail: "adjuster@kitchfix.com",
    accountMap: LIVE_ACCOUNT_MAP,
  });
  assert.deepEqual([...out.to].sort(), [
    "adjuster@kitchfix.com",
    JOE_EMAIL, JOSH_EMAIL, SEBASTIAN_EMAIL,
    "s.lynch@kitchfix.com",
  ].sort());
  assert.deepEqual(out.cc, []);
});

// ─── Live-mode edge cases ────────────────────────────────────────

test("live-mode: empty salariedManagerEmails leaves them out (no crash)", () => {
  const out = resolveRecipients({
    notification: NOTIFICATION_TYPES.N1,
    accountKey: "TXR - AZ", mode: "live",
    submitterEmail: "leader@x.com",
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
  });
  assert.ok(out.to.includes(SEBASTIAN_EMAIL));
  assert.ok(!out.to.some(e => e === undefined || e === null));
});

test("live-mode: NULL rdo_email keeps N3.3 cc = [Kevin, Sebastian]", () => {
  const out = resolveRecipients({
    notification: NOTIFICATION_TYPES.N3_3,
    accountKey: "TXR - AZ", mode: "live",
    accountMap: { salariedManagerEmails: ["a@x.com"], rdoEmail: null },
  });
  assert.deepEqual([...out.cc].sort(), [KEVIN_EMAIL, SEBASTIAN_EMAIL].sort());
});

test("live-mode: duplicate submitter (already in static) dedups", () => {
  const out = resolveRecipients({
    notification: NOTIFICATION_TYPES.N1,
    accountKey: "TXR - AZ", mode: "live",
    submitterEmail: KEVIN_EMAIL,
    accountMap: { salariedManagerEmails: [], rdoEmail: null },
  });
  const kevinCount = out.to.filter(e => e === KEVIN_EMAIL).length;
  assert.equal(kevinCount, 1, "Kevin appears exactly once");
});

test("live-mode: unknown notification type THROWS with the type named", () => {
  assert.throws(
    () => resolveRecipients({
      notification: "UNKNOWN",
      accountKey: "TXR - AZ", mode: "live",
      accountMap: { salariedManagerEmails: [], rdoEmail: null },
    }),
    /unknown notification type/,
  );
});

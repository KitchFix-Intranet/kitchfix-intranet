// gmail.oauth.test.mjs
//
// Tests for the OAuth-financial audit-BCC extension (2026-09-09).
// Focuses on the shared auditBccFor helper - the actual send-time
// wiring in sendInvoiceEmail + sendRejectionEmail is validated by
// unit-testing the dedup helper rather than mocking the Gmail API.

import test from "node:test";
import assert from "node:assert/strict";
import { auditBccFor, AUDIT_BCC_EMAIL } from "./gmail.js";

// ─── auditBccFor ────────────────────────────────────────────────

test("empty inputs -> audit BCC present", () => {
  assert.deepEqual(auditBccFor({}), [AUDIT_BCC_EMAIL]);
  assert.deepEqual(auditBccFor(), [AUDIT_BCC_EMAIL]);
});

test("to array without audit -> audit BCC present", () => {
  assert.deepEqual(
    auditBccFor({ to: ["chef@x.com"] }),
    [AUDIT_BCC_EMAIL],
  );
});

test("to single string without audit -> audit BCC present", () => {
  assert.deepEqual(
    auditBccFor({ to: "chef@x.com" }),
    [AUDIT_BCC_EMAIL],
  );
});

test("to contains audit -> BCC suppressed", () => {
  assert.deepEqual(auditBccFor({ to: [AUDIT_BCC_EMAIL] }), []);
  assert.deepEqual(auditBccFor({ to: AUDIT_BCC_EMAIL }), []);
});

test("cc contains audit -> BCC suppressed", () => {
  assert.deepEqual(
    auditBccFor({ to: ["chef@x.com"], cc: [AUDIT_BCC_EMAIL] }),
    [],
  );
});

test("both to and cc empty -> audit BCC present", () => {
  assert.deepEqual(auditBccFor({ to: [], cc: [] }), [AUDIT_BCC_EMAIL]);
});

test("case-insensitive dedup on To", () => {
  assert.deepEqual(
    auditBccFor({ to: ["KitchFix.Admin@KITCHFIX.COM"] }),
    [],
  );
});

test("case-insensitive dedup on Cc", () => {
  assert.deepEqual(
    auditBccFor({ to: ["a@x.com"], cc: ["KitchFix.Admin@kitchfix.com"] }),
    [],
  );
});

test("null / undefined / empty-string entries do not confuse dedup", () => {
  assert.deepEqual(
    auditBccFor({ to: [null, undefined, "", "chef@x.com"] }),
    [AUDIT_BCC_EMAIL],
  );
});

test("audit as string cc -> BCC suppressed", () => {
  assert.deepEqual(
    auditBccFor({ to: ["chef@x.com"], cc: AUDIT_BCC_EMAIL }),
    [],
  );
});

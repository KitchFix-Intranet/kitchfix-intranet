// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/__tests__/validate-checks.test.mjs
// Unit tests for the two ERROR-severity rules added 2026-07-29:
//   - checkNonCanonicalOrphan: fires on unbalanced <NonCanonical> opens/closes
//   - checkRelatedDocumentsStatus: fires on Status-column header in # Related
//     Documents tables (the hand-typed drift surface eliminated in this PR).
//
// Fixtures are inline strings. No I/O, no PG, no MDX parser round-trip -
// the rules operate on the body string directly.
// ─────────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import {
  checkNonCanonicalOrphan,
  checkRelatedDocumentsStatus,
} from "../validate.mjs";

// ── checkNonCanonicalOrphan ─────────────────────────────────────────────────

test("noncanonical_orphan: fires on unclosed opening tag", () => {
  const findings = [];
  const body = "# Section\n\nBefore.\n<NonCanonical>\nExample content.\n\nMore prose.\n";
  checkNonCanonicalOrphan(body, {}, findings);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "ERROR");
  assert.equal(findings[0].check, "noncanonical_orphan");
});

test("noncanonical_orphan: fires on extra closing tag", () => {
  const findings = [];
  const body = "prose\n<NonCanonical>\ncontent\n</NonCanonical>\n</NonCanonical>\n";
  checkNonCanonicalOrphan(body, {}, findings);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, "noncanonical_orphan");
});

test("noncanonical_orphan: fires on backticked orphan-open in prose", () => {
  const findings = [];
  const body = "> CRITICAL: Mark specimens with `<NonCanonical>` markup.\n";
  checkNonCanonicalOrphan(body, {}, findings);
  assert.equal(findings.length, 1);
});

test("noncanonical_orphan: silent on balanced pair (well-formed body markup)", () => {
  const findings = [];
  const body = "# Section\n\n<NonCanonical>\n$1.00\n</NonCanonical>\n\nMore prose.\n";
  checkNonCanonicalOrphan(body, {}, findings);
  assert.equal(findings.length, 0);
});

test("noncanonical_orphan: silent on multiple balanced pairs", () => {
  const findings = [];
  const body = "<NonCanonical>a</NonCanonical>\ntext\n<NonCanonical>b</NonCanonical>\n";
  checkNonCanonicalOrphan(body, {}, findings);
  assert.equal(findings.length, 0);
});

test("noncanonical_orphan: silent on no mentions at all", () => {
  const findings = [];
  const body = "Just prose.\n\n# Section\n\nMore prose.\n";
  checkNonCanonicalOrphan(body, {}, findings);
  assert.equal(findings.length, 0);
});

// ── checkRelatedDocumentsStatus ─────────────────────────────────────────────

test("related_documents_status_col: fires on Status header", () => {
  const findings = [];
  const body = [
    "# Purpose",
    "",
    "Some text.",
    "",
    "# Related Documents",
    "",
    "| Document ID | Title | Status |",
    "|---|---|---|",
    "| STD-001 | Doc Format Standard | Live |",
    "",
  ].join("\n");
  checkRelatedDocumentsStatus(body, {}, findings);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "ERROR");
  assert.equal(findings[0].check, "related_documents_status_col");
});

test("related_documents_status_col: fires on Current Status header", () => {
  const findings = [];
  const body = "# Related Documents\n\n| Document ID | Title | Current Status |\n|---|---|---|\n| STD-001 | X | Live |\n";
  checkRelatedDocumentsStatus(body, {}, findings);
  assert.equal(findings.length, 1);
});

test("related_documents_status_col: fires on State header", () => {
  const findings = [];
  const body = "# Related Documents\n\n| Doc ID | Title | State |\n|---|---|---|\n";
  checkRelatedDocumentsStatus(body, {}, findings);
  assert.equal(findings.length, 1);
});

test("related_documents_status_col: silent on Reviewed against header", () => {
  const findings = [];
  const body = [
    "# Related Documents",
    "",
    "| Document ID | Title | Reviewed against |",
    "|---|---|---|",
    "| STD-001 | Doc Format Standard | v1.0 |",
    "",
  ].join("\n");
  checkRelatedDocumentsStatus(body, {}, findings);
  assert.equal(findings.length, 0);
});

test("related_documents_status_col: silent on Notes header (the excluded shape)", () => {
  const findings = [];
  const body = "# Related Documents\n\n| Doc ID | Title | Notes |\n|---|---|---|\n| STD-001 | X | Governs this. |\n";
  checkRelatedDocumentsStatus(body, {}, findings);
  assert.equal(findings.length, 0);
});

test("related_documents_status_col: silent on two-column table (no third column)", () => {
  const findings = [];
  const body = "# Related Documents\n\n| Document ID | Title |\n|---|---|\n| STD-001 | X |\n";
  checkRelatedDocumentsStatus(body, {}, findings);
  assert.equal(findings.length, 0);
});

test("related_documents_status_col: silent when no # Related Documents section exists", () => {
  const findings = [];
  const body = "# Purpose\n\n| A | B | Status |\n|---|---|---|\n| x | y | z |\n";
  checkRelatedDocumentsStatus(body, {}, findings);
  assert.equal(findings.length, 0);
});

test("related_documents_status_col: does not confuse an unrelated Status column outside Related Documents section", () => {
  const findings = [];
  const body = [
    "# Doc Cover",
    "",
    "| Field | Value | Status |",
    "|---|---|---|",
    "| DOCUMENT ID | REF-006 | Draft |",
    "",
    "# Related Documents",
    "",
    "| Document ID | Title | Reviewed against |",
    "|---|---|---|",
    "| STD-001 | X | v1.0 |",
    "",
  ].join("\n");
  checkRelatedDocumentsStatus(body, {}, findings);
  assert.equal(findings.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/__tests__/projection-core.test.mjs
// First unit tests in the repo. Covers the projection's pure logic without
// touching the database.
//
// Run via:
//   npm run test:unit
// Or directly:
//   node --test scripts/content/__tests__
//
// Why __tests__/ and not tests/: Playwright collects from tests/ (see
// playwright.config.ts). Living outside that directory keeps the two
// runners cleanly separated. The node --test runner discovers test files
// when pointed at this directory.
// ─────────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDiff,
  mdxToDocRow,
  diffRow,
  valEq,
} from "../lib/projection-core.mjs";

// ─── mdxToDocRow ────────────────────────────────────────────────────────────

test("mdxToDocRow: clean frontmatter -> expected row shape", () => {
  const fm = {
    id: "PB-007",
    title: "Test Playbook",
    doc_class: "PB",
    status: "In Build",
    version: "1.0",
    shelf: "Operations & Leadership",
    card_line: "A one-liner.",
    summary: "Longer summary text.",
    keywords: ["test", "playbook"],
    owner: "Director of Operations",
    approver: "VP Operations",
    audience: "operator",
    classification: "KitchFix Internal",
    print_required: false,
    critical: false,
    sort_order: 10,
    effective_date: "2026-06-01",
    last_reviewed: "2026-06-01",
    access_level: "unrestricted",
    approval: {
      approved_version: "1.0",
      approved_by: "VP Ops",
      approved_date: "2026-06-01",
      method: "recorded sign-off",
    },
  };
  const row = mdxToDocRow(fm);
  assert.equal(row.id, "PB-007");
  assert.equal(row.title, "Test Playbook");
  assert.equal(row.doc_class, "PB");
  assert.equal(row.status, "In Build");
  assert.equal(row.shelf, "Operations & Leadership");
  assert.equal(row.sort_order, 10);
  assert.equal(row.approved_date, "2026-06-01");
  assert.equal(row.is_historical, false);
  assert.equal(row.data_provenance, "batch_rebuild");
  assert.equal(row.access_level, "unrestricted");
  assert.equal(row.next_review, null);
  assert.deepEqual(row.keywords, ["test", "playbook"]);
});

test("mdxToDocRow: defaults applied when frontmatter omits fields", () => {
  const fm = {
    id: "PB-008",
    title: "Bare Doc",
    doc_class: "PB",
    status: "Placeholder",
  };
  const row = mdxToDocRow(fm);
  assert.equal(row.version, null);
  assert.equal(row.shelf, null);
  assert.equal(row.card_line, null);
  assert.deepEqual(row.keywords, []);
  assert.equal(row.classification, "KitchFix Internal");
  assert.equal(row.sort_order, 100);
  assert.equal(row.print_required, false);
  assert.equal(row.critical, false);
  assert.equal(row.access_level, "unrestricted");
  assert.equal(row.approved_date, null);
});

// ─── Overlay-preserve contract (the load-bearing one) ───────────────────────

test("mdxToDocRow: on UPDATE, status comes from existing PG row (overlay preserve)", () => {
  const fm = { id: "PB-007", title: "T", doc_class: "PB", status: "In Build" };
  const existing = { status: "Live", access_level: "restricted" };
  const row = mdxToDocRow(fm, existing);
  // The dashboard moved this doc to Live; MDX still says In Build. The
  // projection must NOT clobber the overlay value.
  assert.equal(row.status, "Live");
});

test("mdxToDocRow: on UPDATE, access_level comes from existing PG row (overlay preserve)", () => {
  const fm = {
    id: "POL-007",
    title: "T",
    doc_class: "POL",
    status: "Live",
    access_level: "unrestricted",
  };
  const existing = { status: "Live", access_level: "slt" };
  const row = mdxToDocRow(fm, existing);
  // Owner promoted to SLT-only via the dashboard. Must survive projection.
  assert.equal(row.access_level, "slt");
});

test("mdxToDocRow: on INSERT (no existing), MDX seeds status + access_level", () => {
  const fm = {
    id: "POL-008",
    title: "T",
    doc_class: "POL",
    status: "Placeholder",
    access_level: "restricted",
  };
  const row = mdxToDocRow(fm, null);
  assert.equal(row.status, "Placeholder");
  assert.equal(row.access_level, "restricted");
});

test("mdxToDocRow: pinned + archived are NOT in the projection write set", () => {
  // Overlay-by-omission contract. pinned lives in document_pins; archived is
  // managed by the archive RPC. Neither should ever appear in mdxToDocRow's
  // output (the upsert ON CONFLICT SET clause only touches columns present).
  const fm = { id: "PB-009", title: "T", doc_class: "PB", status: "Live" };
  const row = mdxToDocRow(fm);
  assert.equal(row.pinned, undefined);
  assert.equal(row.archived, undefined);
  assert.equal(row.archived_at, undefined);
  assert.equal(row.source_drive_id, undefined);
  assert.equal(row.source_drive_id_es, undefined);
  assert.equal(row.storage_path, undefined);
});

// ─── diffRow + valEq ────────────────────────────────────────────────────────

test("diffRow: unchanged row produces no diff", () => {
  const existing = mdxToDocRow({
    id: "PB-001", title: "T", doc_class: "PB", status: "Live", version: "1.0",
  });
  const planned = mdxToDocRow({
    id: "PB-001", title: "T", doc_class: "PB", status: "Live", version: "1.0",
  });
  const changes = diffRow(existing, planned);
  assert.deepEqual(changes, {});
});

test("diffRow: title change detected", () => {
  const existing = mdxToDocRow({ id: "PB-001", title: "Old", doc_class: "PB", status: "Live" });
  const planned = mdxToDocRow({ id: "PB-001", title: "New", doc_class: "PB", status: "Live" });
  const changes = diffRow(existing, planned);
  assert.deepEqual(changes.title, { from: "Old", to: "New" });
});

test("diffRow: status changes do NOT appear (overlay-preserved)", () => {
  // status is overlay; mdxToDocRow will pass through `existing.status` when
  // existing is provided. diffRow's fields list does not include status; even
  // if the planned row somehow differed, diffRow would not surface it.
  const existing = { status: "Live", title: "T", doc_class: "PB" };
  const planned = mdxToDocRow(
    { id: "PB-001", title: "T", doc_class: "PB", status: "Pending" },
    existing,
  );
  const changes = diffRow(existing, planned);
  assert.equal(changes.status, undefined);
});

test("diffRow: keywords compared as multiset (order does not matter)", () => {
  const existing = { keywords: ["b", "a", "c"] };
  const planned = { keywords: ["a", "b", "c"] };
  const changes = diffRow(existing, planned);
  assert.equal(changes.keywords, undefined);
});

test("diffRow: keywords addition detected", () => {
  const existing = { keywords: ["a", "b"] };
  const planned = { keywords: ["a", "b", "c"] };
  const changes = diffRow(existing, planned);
  assert.ok(changes.keywords, "expected keywords change");
});

test("valEq: Date instance compares equal to its YYYY-MM-DD string", () => {
  assert.equal(valEq(new Date("2026-06-15T00:00:00Z"), "2026-06-15"), true);
});

test("valEq: null/undefined treated as equal", () => {
  assert.equal(valEq(null, undefined), true);
  assert.equal(valEq(undefined, null), true);
});

test("valEq: distinct strings unequal", () => {
  assert.equal(valEq("a", "b"), false);
});

// ─── computeDiff classification ─────────────────────────────────────────────

function makeCorpusEntry(fm) {
  return { id: fm.id, frontmatter: fm };
}

test("computeDiff: classifies insert (in MDX, not in PG)", () => {
  const corpus = [
    makeCorpusEntry({ id: "PB-NEW", title: "New", doc_class: "PB", status: "Placeholder" }),
  ];
  const live = { documents: [] };
  const { docPlan } = computeDiff(corpus, live);
  assert.equal(docPlan.insert.length, 1);
  assert.equal(docPlan.insert[0].id, "PB-NEW");
  assert.equal(docPlan.update.length, 0);
  assert.equal(docPlan.archive.length, 0);
});

test("computeDiff: classifies update (in both, fields differ)", () => {
  const corpus = [
    makeCorpusEntry({ id: "PB-001", title: "After", doc_class: "PB", status: "Live" }),
  ];
  const live = {
    documents: [{
      id: "PB-001",
      title: "Before",
      doc_class: "PB",
      status: "Live",
      access_level: "unrestricted",
      keywords: [],
      archived: false,
    }],
  };
  const { docPlan } = computeDiff(corpus, live);
  assert.equal(docPlan.update.length, 1);
  assert.equal(docPlan.update[0].id, "PB-001");
  assert.deepEqual(docPlan.update[0].changes.title, { from: "Before", to: "After" });
  assert.equal(docPlan.insert.length, 0);
  assert.equal(docPlan.archive.length, 0);
});

test("computeDiff: classifies archive (active in PG, absent from MDX)", () => {
  const corpus = [];
  const live = {
    documents: [{
      id: "PB-GONE",
      title: "Old",
      doc_class: "PB",
      status: "Live",
      archived: false,
    }],
  };
  const { docPlan } = computeDiff(corpus, live);
  assert.equal(docPlan.archive.length, 1);
  assert.equal(docPlan.archive[0].id, "PB-GONE");
  assert.equal(docPlan.archive[0].reason, "absent_from_mdx");
});

test("computeDiff: already-archived absent doc is NOT re-archived", () => {
  const corpus = [];
  const live = {
    documents: [{ id: "PB-X", title: "T", doc_class: "PB", status: "Retired", archived: true }],
  };
  const { docPlan } = computeDiff(corpus, live);
  assert.equal(docPlan.archive.length, 0);
});

test("computeDiff: unchanged doc (in both, deep-equal) produces no plan entry", () => {
  const fm = { id: "PB-001", title: "Same", doc_class: "PB", status: "Live" };
  const existing = mdxToDocRow(fm, {
    status: "Live", access_level: "unrestricted",
  });
  const corpus = [makeCorpusEntry(fm)];
  const live = {
    documents: [{
      ...existing,
      status: "Live",
      access_level: "unrestricted",
      archived: false,
    }],
  };
  const { docPlan } = computeDiff(corpus, live);
  assert.equal(docPlan.insert.length, 0);
  assert.equal(docPlan.update.length, 0);
  assert.equal(docPlan.archive.length, 0);
});

// ─── computeDiff: relationships + surfaces planning ─────────────────────────

test("computeDiff: authored relationships deduped + included in relPlan", () => {
  const corpus = [
    makeCorpusEntry({
      id: "PB-001",
      title: "T",
      doc_class: "PB",
      status: "Live",
      relationships: [
        { to: "POL-007", type: "references" },
        { to: "POL-007", type: "references" }, // duplicate
        { to: "REF-006", type: "references" },
      ],
    }),
  ];
  const { relPlan } = computeDiff(corpus, { documents: [] });
  assert.equal(relPlan.length, 2);
  assert.ok(relPlan.every((r) => r.kind === "authored"));
});

test("computeDiff: supersedes frontmatter becomes one authored_supersedes edge", () => {
  const corpus = [
    makeCorpusEntry({
      id: "PB-002",
      title: "T",
      doc_class: "PB",
      status: "Live",
      supersedes: "PB-001",
    }),
  ];
  const { relPlan } = computeDiff(corpus, { documents: [] });
  assert.equal(relPlan.length, 1);
  assert.deepEqual(relPlan[0], {
    from_doc: "PB-002",
    to_doc: "PB-001",
    rel_type: "supersedes",
    kind: "authored_supersedes",
  });
});

test("computeDiff: surfaces planned + deduped per doc", () => {
  const corpus = [
    makeCorpusEntry({
      id: "AGR-001",
      title: "T",
      doc_class: "AGR",
      status: "Live",
      surfaces: ["new-hire-onboarding", "new-hire-onboarding", "kitchen"],
    }),
  ];
  const { surfPlan } = computeDiff(corpus, { documents: [] });
  assert.equal(surfPlan.length, 2);
  assert.deepEqual(surfPlan.map((s) => s.surface).sort(), ["kitchen", "new-hire-onboarding"]);
});

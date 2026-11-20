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
  isMovedToLibrary,
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

// ─── T2 isMovedToLibrary (fail-safe tag) ────────────────────────────────────

test("isMovedToLibrary: exact literal 'library' only", () => {
  assert.equal(isMovedToLibrary({ home: "library" }), true);
});

test("isMovedToLibrary: undefined home -> false (column may not exist)", () => {
  assert.equal(isMovedToLibrary({}), false);
});

test("isMovedToLibrary: null home -> false", () => {
  assert.equal(isMovedToLibrary({ home: null }), false);
});

test("isMovedToLibrary: 'v1' -> false", () => {
  assert.equal(isMovedToLibrary({ home: "v1" }), false);
});

test("isMovedToLibrary: 'LIBRARY' (upper) -> false (case-sensitive)", () => {
  assert.equal(isMovedToLibrary({ home: "LIBRARY" }), false);
});

test("isMovedToLibrary: 'library ' (trailing space) -> false (whitespace-sensitive)", () => {
  assert.equal(isMovedToLibrary({ home: "library " }), false);
});

test("isMovedToLibrary: null or undefined row -> false", () => {
  assert.equal(isMovedToLibrary(null), false);
  assert.equal(isMovedToLibrary(undefined), false);
});

// ─── T2 computeDiff: a moved document is left alone ─────────────────────────

/**
 * Build a fixture where POL-007 has been moved to the library. The file on
 * disk still exists and has drifted from the live row (title + version).
 * Live PG also has two relationship rows and one surface row originating
 * from POL-007, plus a relationship row that points AT POL-007 from PB-001
 * (which is NOT moved - its row still comes from the file).
 */
function movedFixture() {
  const corpus = [
    makeCorpusEntry({
      id: "POL-007",
      title: "Drifted Title",           // file drifted from live
      doc_class: "POL",
      status: "Live",
      version: "9.9",                    // file drifted from live
      card_line: "drifted card_line",
      relationships: [
        { to: "REF-006", type: "references" }, // file still has this
      ],
      surfaces: ["kitchen"],             // file still has this
      obligations: [
        { key: "pol7_quarterly_review", type: "review", cadence: "quarterly", owner: "VP" },
      ],
    }),
    makeCorpusEntry({
      id: "PB-001",
      title: "PB One",
      doc_class: "PB",
      status: "Live",
      relationships: [
        { to: "POL-007", type: "references" }, // PB-001 points AT POL-007
      ],
    }),
  ];
  const live = {
    documents: [
      {
        id: "POL-007",
        title: "Live Title",             // different from file
        doc_class: "POL",
        status: "Live",
        version: "1.0",                  // different from file
        access_level: "unrestricted",
        home: "library",                 // MOVED
        keywords: [],
        archived: false,
      },
      {
        id: "PB-001",
        title: "PB One",
        doc_class: "PB",
        status: "Live",
        access_level: "unrestricted",
        home: "v1",                      // not moved
        keywords: [],
        archived: false,
      },
    ],
    relationships: [
      { from_doc: "POL-007", to_doc: "SOP-008", rel_type: "references" },
      { from_doc: "POL-007", to_doc: "REF-006", rel_type: "references" },
      { from_doc: "PB-001",  to_doc: "POL-007", rel_type: "references" },
    ],
    surfaces: [
      { doc_id: "POL-007", surface: "kitchen" },
      { doc_id: "POL-007", surface: "all-hands" },     // live-only
    ],
  };
  return { corpus, live };
}

test("T2: a moved document whose file CHANGED is not in insert, not in update", () => {
  const { corpus, live } = movedFixture();
  const { docPlan, leftAlone } = computeDiff(corpus, live);
  assert.ok(leftAlone.includes("POL-007"), "POL-007 should be in leftAlone");
  assert.equal(docPlan.insert.find((r) => r.id === "POL-007"), undefined,
    "moved doc must not be in insert");
  assert.equal(docPlan.update.find((u) => u.id === "POL-007"), undefined,
    "moved doc must not be in update");
});

test("T2: a moved document whose file was DELETED is not in archive", () => {
  const { live } = movedFixture();
  const corpus = []; // POL-007 file is absent
  const { docPlan, leftAlone, leftAloneFileDrift } = computeDiff(corpus, live);
  assert.ok(leftAlone.includes("POL-007"), "POL-007 should still be in leftAlone");
  assert.equal(docPlan.archive.find((a) => a.id === "POL-007"), undefined,
    "moved doc must not be in archive even when file absent");
  // File-absence is surfaced as a drift note, not an error.
  assert.ok(
    leftAloneFileDrift.find((d) => d.id === "POL-007" && d.kind === "removed_from_mdx"),
    "removed_from_mdx drift note expected",
  );
});

test("T2: no content row is planned for a moved document (any language)", () => {
  // The content filter lives in executeApply's render-pipeline; the logic
  // under test here is that the `leftAlone` set is reliable and the doc is
  // not in the write-set. Callers filter `render` by `!leftAlone.has(id)`.
  const { corpus, live } = movedFixture();
  const { leftAlone } = computeDiff(corpus, live);
  const render = [
    { id: "POL-007", html: "<p>x</p>", content_hash: "h1", lang: "en" },
    { id: "POL-007", html: "<p>y</p>", content_hash: "h2", lang: "es" },
    { id: "PB-001",  html: "<p>z</p>", content_hash: "h3", lang: "en" },
  ];
  const leftAloneSet = new Set(leftAlone);
  const toWrite = render.filter((r) => !leftAloneSet.has(r.id));
  assert.equal(toWrite.length, 1);
  assert.equal(toWrite[0].id, "PB-001");
});

test("T2: moved doc's live relationship rows pass through; rows AT it from other docs stay from files", () => {
  const { corpus, live } = movedFixture();
  const { relPlan } = computeDiff(corpus, live);
  // From the moved doc: both live rows pass through verbatim.
  const fromMoved = relPlan.filter((r) => r.from_doc === "POL-007");
  assert.equal(fromMoved.length, 2);
  assert.ok(fromMoved.every((r) => r.kind === "live_passthrough_left_alone"));
  const movedTargets = fromMoved.map((r) => r.to_doc).sort();
  assert.deepEqual(movedTargets, ["REF-006", "SOP-008"]);
  // File-authored row that POINTS AT the moved doc is still built from files.
  const pointingAt = relPlan.filter((r) => r.to_doc === "POL-007");
  assert.equal(pointingAt.length, 1);
  assert.equal(pointingAt[0].from_doc, "PB-001");
  assert.equal(pointingAt[0].kind, "authored");
  // Total count = 2 passthrough + 1 authored = 3; the file-authored
  // relationship on POL-007 (-> REF-006) is NOT in the plan because
  // POL-007 is left-alone (the live passthrough covers it).
  assert.equal(relPlan.length, 3);
});

test("T2: moved doc's live surface rows pass through verbatim; file surfaces for it are dropped", () => {
  const { corpus, live } = movedFixture();
  const { surfPlan } = computeDiff(corpus, live);
  const fromMoved = surfPlan.filter((s) => s.doc_id === "POL-007");
  assert.equal(fromMoved.length, 2);
  const surfs = fromMoved.map((s) => s.surface).sort();
  assert.deepEqual(surfs, ["all-hands", "kitchen"]);
  assert.ok(fromMoved.every((s) => s.kind === "live_passthrough_left_alone"));
});

test("T2: no obligations change is planned for a moved document", () => {
  // Same shape as the content test: the filter lives in the apply
  // path, keyed off the leftAlone set.
  const { corpus, live } = movedFixture();
  const { leftAlone } = computeDiff(corpus, live);
  const plan = { byDoc: [
    { doc_id: "POL-007", rows: [{ obligation_key: "k1" }] },
    { doc_id: "PB-001",  rows: [{ obligation_key: "k2" }] },
  ] };
  const leftAloneSet = new Set(leftAlone);
  const toReplace = plan.byDoc.filter((d) => !leftAloneSet.has(d.doc_id));
  assert.equal(toReplace.length, 1);
  assert.equal(toReplace[0].doc_id, "PB-001");
});

test("T2: fail-safe - home undefined / null / 'v1' / 'LIBRARY' / 'library ' all treated as v1", () => {
  // Five variants, five live rows, none should be in leftAlone; an
  // identical MDX fixture should produce today's behaviour (one update
  // per row that drifts, as normal).
  const corpus = [
    makeCorpusEntry({ id: "A", title: "T", doc_class: "PB", status: "Live" }),
    makeCorpusEntry({ id: "B", title: "T", doc_class: "PB", status: "Live" }),
    makeCorpusEntry({ id: "C", title: "T", doc_class: "PB", status: "Live" }),
    makeCorpusEntry({ id: "D", title: "T", doc_class: "PB", status: "Live" }),
    makeCorpusEntry({ id: "E", title: "T", doc_class: "PB", status: "Live" }),
  ];
  const live = {
    documents: [
      { id: "A", title: "T", doc_class: "PB", status: "Live", access_level: "unrestricted", archived: false /* no home */ },
      { id: "B", title: "T", doc_class: "PB", status: "Live", access_level: "unrestricted", home: null,       archived: false },
      { id: "C", title: "T", doc_class: "PB", status: "Live", access_level: "unrestricted", home: "v1",       archived: false },
      { id: "D", title: "T", doc_class: "PB", status: "Live", access_level: "unrestricted", home: "LIBRARY",  archived: false },
      { id: "E", title: "T", doc_class: "PB", status: "Live", access_level: "unrestricted", home: "library ", archived: false },
    ],
    relationships: [],
    surfaces: [],
  };
  const { leftAlone } = computeDiff(corpus, live);
  assert.deepEqual(leftAlone, [], "every variant must stay on the v1 path");
});

// Sanity: without the home column, main's behaviour is byte-identical.
test("T2: an empty leftAlone list does not change any existing plan branch", () => {
  const corpus = [
    makeCorpusEntry({
      id: "PB-001",
      title: "After",
      doc_class: "PB",
      status: "Live",
      relationships: [{ to: "POL-007", type: "references" }],
      surfaces: ["kitchen"],
    }),
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
    relationships: [],
    surfaces: [],
  };
  const { docPlan, relPlan, surfPlan, leftAlone } = computeDiff(corpus, live);
  assert.equal(leftAlone.length, 0);
  assert.equal(docPlan.update.length, 1);
  assert.equal(relPlan.length, 1);
  assert.equal(surfPlan.length, 1);
});

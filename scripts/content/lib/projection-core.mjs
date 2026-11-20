// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/lib/projection-core.mjs
// Pure logic for the OPD projection: diff planning + row construction.
//
// Extracted from scripts/content/project-catalog.mjs (B1) so it can be
// covered by unit tests via `node --test scripts/content/__tests__`. The
// functions here have no side effects, no I/O, and no module-level state.
// The script imports them back unchanged.
//
// Behavior-preserving extraction - the functions are identical in shape to
// their previous in-file definitions; the only change is they are now
// exported from this module.
//
// T2: `documents.home` overlay. A document whose live
// `documents.home === 'library'` has been moved to the v2 Library. The
// projection must never touch its row, its content, its obligations, or
// the authored relationships / surfaces it owns. Rows pointing AT a moved
// document from other, non-moved documents stay built from files as today.
// Fail-safe: anything other than the exact literal 'library' (undefined,
// null, 'v1', 'LIBRARY', 'library '...) is treated as v1.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is this live PG row flagged as moved to the v2 Library?
 *
 * Case-sensitive, whitespace-sensitive comparison against the exact
 * literal 'library'. Fail-safe: the column may not exist yet
 * (Studio-applied additive change), may be null, may carry a historical
 * value like 'v1', or any future tier - all of those stay on the v1
 * projection path.
 */
export function isMovedToLibrary(row) {
  return !!row && row.home === "library";
}

/**
 * Build the row a single MDX file projects into the documents table.
 *
 * Overlay fields (status, access_level) use conditional include rather than
 * preserve-by-omission:
 *   - On INSERT (existing === null): MDX seeds the initial value.
 *   - On UPDATE (existing !== null): the PG value is the source of truth,
 *     copied through here so the upsert's ON CONFLICT SET clause resolves
 *     to a no-op for that column.
 *
 * documents.status is NOT NULL with no schema default, so the omit-pattern
 * used for pinned/archived/source_drive_id would fail INSERT. access_level
 * has a schema default and could technically be omitted on update, but the
 * conditional pattern is used for both for symmetry.
 *
 * is_historical is always false on projection writes; data_provenance is
 * always 'batch_rebuild' since the projection is by definition batch.
 */
export function mdxToDocRow(fm, existing = null) {
  return {
    id: fm.id,
    title: fm.title,
    doc_class: fm.doc_class,
    status: existing ? existing.status : fm.status,
    version: fm.version || null,
    shelf: fm.shelf || null,
    card_line: fm.card_line || null,
    summary: fm.summary || null,
    keywords: fm.keywords || [],
    owner: fm.owner || null,
    approver: fm.approver || null,
    audience: fm.audience || null,
    classification: fm.classification || "KitchFix Internal",
    print_required: !!fm.print_required,
    critical: !!fm.critical,
    sort_order: fm.sort_order ?? 100,
    effective_date: fm.effective_date || null,
    last_reviewed: fm.last_reviewed || null,
    // pr-7-14: STD-001 v1.2 cover renders approver + approval date. The
    // approver column already exists; this projects the approval block's
    // approved_date out of frontmatter. Null when the approval block is
    // absent (placeholder/in-build docs) - the cover renders an em-dash.
    approved_date: fm.approval?.approved_date || null,
    // next_review computed later in projection (last_reviewed + review_interval_months);
    // for the dry-run we surface null so the planned-update field is honest about
    // what gets written.
    next_review: null,
    is_historical: false,
    data_provenance: "batch_rebuild",
    // pr-7-11 hierarchical access gate. Overlay-preserved post-A1: on INSERT,
    // MDX seeds the initial value (defaults to 'unrestricted' when frontmatter
    // doesn't specify). On UPDATE, the existing PG value rides through
    // unchanged - the dashboard owns live access tier. Validator catches
    // unknown values upstream.
    access_level: existing ? existing.access_level : (fm.access_level || "unrestricted"),
    // source_drive_id / source_drive_id_es preserved separately - projection
    // does NOT clobber them since they are operator/admin choices.
  };
}

/**
 * Compute the per-field diff between an existing PG row and the planned
 * mdxToDocRow output. Returns an object keyed by changed fields; empty when
 * the row would not change.
 *
 * status + access_level are overlay-preserved (sourced from `existing` in
 * mdxToDocRow). They are deliberately NOT in the fields list so they never
 * appear in the diff - the projection no longer authors them on update.
 */
export function diffRow(existing, planned) {
  const changes = {};
  const fields = [
    "title", "doc_class", "version", "shelf", "card_line", "summary",
    "owner", "approver", "audience", "classification", "print_required", "critical",
    "sort_order", "effective_date", "last_reviewed", "next_review", "is_historical",
    "data_provenance", "approved_date",
  ];
  for (const f of fields) {
    if (planned[f] !== undefined && !valEq(existing[f], planned[f])) {
      changes[f] = { from: existing[f], to: planned[f] };
    }
  }
  // keywords: compare as multiset
  const ek = JSON.stringify([...(existing.keywords || [])].sort());
  const pk = JSON.stringify([...(planned.keywords || [])].sort());
  if (ek !== pk) changes.keywords = { from: existing.keywords, to: planned.keywords };
  return changes;
}

/**
 * Equality helper used by diffRow. Treats null/undefined as equal and
 * normalizes Date instances to YYYY-MM-DD strings for date-field comparison.
 */
export function valEq(a, b) {
  if (a === b) return true;
  if (a === null && (b === undefined || b === null)) return true;
  if (b === null && (a === undefined || a === null)) return true;
  if (a instanceof Date) return a.toISOString().slice(0, 10) === b;
  return false;
}

/**
 * Compute the full sync plan: which doc rows insert / update / archive,
 * which relationship edges to set, which surfaces to set.
 *
 * Inputs:
 *   corpus - array of parsed MDX docs: { id, frontmatter, ... }
 *   live   - { documents: [...], relationships: [...], surfaces: [...] }
 *            snapshot from PG. `relationships` and `surfaces` are read so
 *            the T2 home overlay can pass live rows through verbatim for
 *            documents the projection has been told to leave alone.
 *
 * Output:
 *   { docPlan: { insert, update, archive, skip_retired_pg },
 *     relPlan: [{ from_doc, to_doc, rel_type, kind }],
 *     surfPlan: [{ doc_id, surface }],
 *     corpusById,
 *     leftAlone: [docId, ...],              // sorted; home='library' in PG
 *     leftAloneFileDrift: [                  // non-fatal note, not an error
 *       { id, kind: "fields" | "content_hash" | "removed_from_mdx", ... }
 *     ]}
 *
 * T2 overlay rule (binding across every plan):
 *   A document whose live row has `home === 'library'` is left alone:
 *   - not in docPlan.insert (insert means "not in PG"; by definition
 *     a left-alone doc is in PG)
 *   - not in docPlan.update (its row is owned by the Library now)
 *   - not in docPlan.archive (its file may be gone; still don't archive)
 *   - rows AUTHORED by it in relPlan / surfPlan are passed through from
 *     the live snapshot verbatim, by from_doc / doc_id
 *   - rows authored by OTHER docs that point AT it stay built from files,
 *     as today (one row from file = one row in the plan)
 *   - a file that would have produced a different row or a different
 *     content_hash is reported in `leftAloneFileDrift` so a person can
 *     see the stale file - never an error, never a halt.
 *
 * Fail-safe: `isMovedToLibrary` only answers yes on the exact literal
 * 'library'. The column may not exist yet; null / undefined / any other
 * value stays on today's path.
 */
export function computeDiff(corpus, live) {
  const mdxIds = new Set();
  const docPlan = {
    insert: [],
    update: [],
    archive: [],          // active in PG, absent from MDX
    skip_retired_pg: [],  // already Retired/archived in PG and absent from MDX (no action)
  };
  const corpusById = {};
  for (const d of corpus) {
    if (d.id) {
      mdxIds.add(d.id);
      corpusById[d.id] = d;
    }
  }
  const pgById = {};
  for (const row of live.documents) pgById[row.id] = row;

  // Build the left-alone set first so every later branch can consult it.
  // An id lands here if its LIVE row (not its file) is flagged
  // home='library'. A brand-new MDX doc that is not in PG yet cannot be
  // left alone.
  const leftAloneSet = new Set();
  for (const row of live.documents) {
    if (isMovedToLibrary(row)) leftAloneSet.add(row.id);
  }

  // Drift notes - never an error, never a halt. Someone may have edited
  // a file that is no longer the master; a human needs to know.
  const leftAloneFileDrift = [];

  // Insert / update
  for (const d of corpus) {
    if (!d.id) continue;
    const fm = d.frontmatter;
    const existing = pgById[d.id];

    // Left-alone: the file is NOT written. Compute the row the projection
    // would have written and compare to the live row purely for the
    // drift note, then skip.
    if (existing && leftAloneSet.has(d.id)) {
      const wouldHaveWritten = mdxToDocRow(fm, existing);
      const wouldHaveChanged = diffRow(existing, wouldHaveWritten);
      const changedFields = Object.keys(wouldHaveChanged);
      if (changedFields.length > 0) {
        leftAloneFileDrift.push({
          id: d.id,
          kind: "fields",
          fields: changedFields.sort(),
        });
      }
      continue;
    }

    // Normal path.
    // `existing` is threaded into mdxToDocRow so the overlay fields (status,
    // access_level) preserve their PG value on UPDATE while MDX still seeds
    // on INSERT - see mdxToDocRow for the per-field logic.
    const row = mdxToDocRow(fm, existing);
    if (!existing) {
      docPlan.insert.push(row);
    } else {
      const changes = diffRow(existing, row);
      if (Object.keys(changes).length > 0) {
        docPlan.update.push({ id: d.id, changes, row });
      }
    }
  }

  // Archive: present in PG (active) but not in MDX. A left-alone doc
  // whose file was removed from `content/documents/` is NOT archived.
  // The Library owns its row now; its file disappearing is expected.
  for (const row of live.documents) {
    if (mdxIds.has(row.id)) continue;
    if (row.archived) continue; // already archived, nothing to do
    if (leftAloneSet.has(row.id)) {
      // Note the file-absence so a person can see it; this is the
      // "someone deleted the file after the doc moved" case.
      leftAloneFileDrift.push({
        id: row.id,
        kind: "removed_from_mdx",
      });
      continue;
    }
    if (row.status === "Retired") {
      // Already Retired but not archived. Per brief: archive-not-delete.
      docPlan.archive.push({ id: row.id, current_status: row.status, title: row.title, reason: "retired_in_pg_absent_from_mdx" });
    } else {
      docPlan.archive.push({ id: row.id, current_status: row.status, title: row.title, reason: "absent_from_mdx" });
    }
  }

  // Relationships: authored edges only. The reader inverts at read time via
  // the route's `direction: 'in'|'out'` field; storing inverse rows would
  // double-render the same relationship on both ends.
  //
  // T2: rows authored BY a left-alone doc (from_doc === id) are passed
  // through verbatim from the live snapshot. Rows that point AT a
  // left-alone doc from a non-moved document still come from files,
  // as today.
  const relPlan = [];
  const relSeen = new Set(); // dedupe key: from|to|type

  // 1. File-authored rows, skipping any rows whose from_doc is left-alone.
  for (const d of corpus) {
    if (!d.id) continue;
    if (leftAloneSet.has(d.id)) continue;
    for (const rel of d.frontmatter.relationships || []) {
      const k = `${d.id}|${rel.to}|${rel.type}`;
      if (relSeen.has(k)) continue;
      relSeen.add(k);
      relPlan.push({ from_doc: d.id, to_doc: rel.to, rel_type: rel.type, kind: "authored" });
    }
    // supersedes frontmatter is just another authored edge (one direction only)
    if (d.frontmatter.supersedes) {
      const k = `${d.id}|${d.frontmatter.supersedes}|supersedes`;
      if (!relSeen.has(k)) {
        relSeen.add(k);
        relPlan.push({
          from_doc: d.id,
          to_doc: d.frontmatter.supersedes,
          rel_type: "supersedes",
          kind: "authored_supersedes",
        });
      }
    }
  }

  // 2. Live rows from left-alone source docs, passed through verbatim.
  // The planned-vs-inserted count guard in executeApply still holds
  // because these rows are real `document_relationships` rows the
  // function will re-insert on replace.
  const liveRels = Array.isArray(live.relationships) ? live.relationships : [];
  for (const row of liveRels) {
    if (!leftAloneSet.has(row.from_doc)) continue;
    const k = `${row.from_doc}|${row.to_doc}|${row.rel_type}`;
    if (relSeen.has(k)) continue;
    relSeen.add(k);
    relPlan.push({
      from_doc: row.from_doc,
      to_doc: row.to_doc,
      rel_type: row.rel_type,
      kind: "live_passthrough_left_alone",
    });
  }

  // Surfaces: same rule. File-authored for non-moved docs, live
  // passthrough for moved docs.
  const surfPlan = [];
  const surfSeen = new Set();
  for (const d of corpus) {
    if (!d.id) continue;
    if (leftAloneSet.has(d.id)) continue;
    for (const s of d.frontmatter.surfaces || []) {
      const k = `${d.id}|${s}`;
      if (surfSeen.has(k)) continue;
      surfSeen.add(k);
      surfPlan.push({ doc_id: d.id, surface: s });
    }
  }
  const liveSurfs = Array.isArray(live.surfaces) ? live.surfaces : [];
  for (const row of liveSurfs) {
    if (!leftAloneSet.has(row.doc_id)) continue;
    const k = `${row.doc_id}|${row.surface}`;
    if (surfSeen.has(k)) continue;
    surfSeen.add(k);
    surfPlan.push({
      doc_id: row.doc_id,
      surface: row.surface,
      kind: "live_passthrough_left_alone",
    });
  }

  const leftAlone = Array.from(leftAloneSet).sort();
  return { docPlan, relPlan, surfPlan, corpusById, leftAlone, leftAloneFileDrift };
}

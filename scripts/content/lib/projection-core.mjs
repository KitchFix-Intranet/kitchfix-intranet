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
// ─────────────────────────────────────────────────────────────────────────────

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
 *   live   - { documents: [...] } snapshot from PG
 *
 * Output:
 *   { docPlan: { insert, update, archive, skip_retired_pg },
 *     relPlan: [{ from_doc, to_doc, rel_type, kind }],
 *     surfPlan: [{ doc_id, surface }],
 *     corpusById }
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

  // Insert / update
  for (const d of corpus) {
    if (!d.id) continue;
    const fm = d.frontmatter;
    // `existing` is threaded into mdxToDocRow so the overlay fields (status,
    // access_level) preserve their PG value on UPDATE while MDX still seeds
    // on INSERT - see mdxToDocRow for the per-field logic.
    const existing = pgById[d.id];
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

  // Archive: present in PG (active) but not in MDX
  for (const row of live.documents) {
    if (mdxIds.has(row.id)) continue;
    if (row.archived) continue; // already archived, nothing to do
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
  const relPlan = [];
  const relSeen = new Set(); // dedupe key: from|to|type
  for (const d of corpus) {
    if (!d.id) continue;
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

  // Surfaces from frontmatter
  const surfPlan = [];
  const surfSeen = new Set();
  for (const d of corpus) {
    if (!d.id) continue;
    for (const s of d.frontmatter.surfaces || []) {
      const k = `${d.id}|${s}`;
      if (surfSeen.has(k)) continue;
      surfSeen.add(k);
      surfPlan.push({ doc_id: d.id, surface: s });
    }
  }

  return { docPlan, relPlan, surfPlan, corpusById };
}

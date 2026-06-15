// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/project_catalog.mjs
// Frontmatter -> Postgres `documents` + `document_relationships` row shape.
// Per brief §5.
//
// F1: produces row-shaped JS objects + a dry-run print. No DB write. At F7
// this script wires to the existing supabase-js client and upserts.
//
// Mapping (per docs/migrations/pr-7-1-opd-schema.sql and the OPD enums):
//   frontmatter.id           -> documents.id (TEXT PK)
//   frontmatter.title        -> documents.title
//   frontmatter.doc_class    -> documents.doc_class (CHECK 10 values)
//   frontmatter.status       -> documents.status (CHECK 7 values)
//   frontmatter.version      -> documents.version
//   frontmatter.shelf        -> documents.shelf (CHECK 7 values or NULL)
//   frontmatter.card_line    -> documents.card_line
//   frontmatter.summary      -> documents.summary
//   frontmatter.keywords     -> documents.keywords (TEXT[])
//   frontmatter.owner        -> documents.owner
//   frontmatter.approver     -> documents.approver
//   frontmatter.audience     -> documents.audience
//   frontmatter.classification -> documents.classification
//   ... etc
//
// Plus: governance fields (approval, last_reviewed, effective_date,
// review_interval_months) are NEW columns the F7 migration adds; F1 just
// captures them in the projected row for inspection. Adding the columns is
// a Phase 2 schema migration that lands at F7 (per the brief).
// ─────────────────────────────────────────────────────────────────────────────

export function projectDocumentRow(frontmatter) {
  const fm = frontmatter;
  // The documents-table-shape row (existing columns + new governance fields).
  return {
    id: fm.id,
    title: fm.title,
    doc_class: fm.doc_class,
    status: fm.status,
    version: fm.version ?? null,
    shelf: fm.shelf ?? null,
    card_line: fm.card_line ?? null,
    summary: fm.summary ?? null,
    keywords: fm.keywords || [],
    owner: fm.owner ?? null,
    approver: fm.approver ?? null,
    audience: fm.audience ?? null,
    classification: fm.classification || "KitchFix Internal",
    pinned: !!fm.pinned,
    print_required: !!fm.print_required,
    critical: !!fm.critical,
    sort_order: fm.sort_order ?? 100,
    is_historical: false,
    data_provenance: "manual_entry",
    // NEW columns added at F7 schema migration:
    last_reviewed: fm.last_reviewed ?? null,
    effective_date: fm.effective_date ?? null,
    review_interval_months: fm.review_interval_months ?? 12,
    approved_version: fm.approval?.approved_version ?? null,
    approved_by: fm.approval?.approved_by ?? null,
    approved_date: fm.approval?.approved_date ?? null,
    approval_method: fm.approval?.method ?? null,
    applies_to: fm.applies_to ?? "company-wide",
    lang: fm.lang || "en",
    in_corpus: fm.in_corpus !== false,
    translation_of: fm.translation_of ?? null,
    source_version: fm.source_version ?? null,
    supersedes: fm.supersedes ?? null,
  };
}

export function projectRelationships(frontmatter) {
  const fm = frontmatter;
  const rows = (fm.relationships || []).map((r) => ({
    from_doc: fm.id,
    to_doc: r.to,
    rel_type: r.type,
    is_historical: false,
    data_provenance: "manual_entry",
    from_section: r.from_section ?? null,
  }));
  // The `supersedes` frontmatter field projects to a superseded_by edge.
  if (fm.supersedes) {
    rows.push({
      from_doc: fm.supersedes,
      to_doc: fm.id,
      rel_type: "superseded_by",
      is_historical: false,
      data_provenance: "manual_entry",
      from_section: null,
    });
  }
  return rows;
}

export function printRow(row) {
  console.log("documents row:");
  for (const [k, v] of Object.entries(row)) {
    console.log(`  ${k.padEnd(24)} ${JSON.stringify(v)}`);
  }
}

export function printRelationships(rows) {
  if (rows.length === 0) {
    console.log("document_relationships rows: (none)");
    return;
  }
  console.log(`document_relationships rows: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.from_doc} -[${r.rel_type}]-> ${r.to_doc}` + (r.from_section ? `  (from ${r.from_section})` : ""));
  }
}

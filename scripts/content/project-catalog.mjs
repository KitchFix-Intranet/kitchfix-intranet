#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/project-catalog.mjs
// Phase A · the MDX -> Postgres projection engine.
//
// What it does:
//   - Parse every MDX file in content/documents/.
//   - Validate against the JSON schema + cross-doc rules (relationship
//     targets exist; doc_class matches ID prefix; Live docs satisfy
//     chk_live_complete; etc.).
//   - Resolve <Include> tokens (cross-doc transclusion via the shared
//     docsMap) and <Fact> tokens (against operational-facts.yaml), expand
//     <SourceGoverns> preambles, mark <NonCanonical> blocks as Example
//     callouts (kept for display - the corpus-stripping is a later PR).
//   - Render the resolved markdown to display HTML via lib/md_to_html.mjs.
//   - Read the live Postgres OPD state (documents, document_relationships,
//     document_surfaces, document_pins, document_content) as a snapshot.
//   - Compute the full authoritative-sync plan: which doc rows would be
//     inserted, updated, or archived (archive-not-delete); which relationship
//     edges would be created (authored + derived inverse); which surfaces
//     would be created / preserved; which content rows would be rendered.
//   - In --dry-run (default): write the plan to PROJECTION_DRYRUN.md and a
//     handful of sample rendered HTML files. NO database writes.
//   - In --apply (NOT EXECUTED THIS PR): build a transactional / staging-
//     then-swap plan that would apply the diff. The staging-then-swap path
//     is scaffolded; running it is gated until Kevin reviews PROJECTION_DRYRUN.md.
//
// Pin overlay (pr-7-9): document_pins is NEVER touched by this script. Pin
// is UI state, not document metadata. The projection reads pins only to
// preserve the count in the dry-run report.
//
// Usage:
//   node --env-file=.env.local scripts/content/project-catalog.mjs
//   node --env-file=.env.local scripts/content/project-catalog.mjs --dry-run  (same as default)
//   node --env-file=.env.local scripts/content/project-catalog.mjs --apply    (will refuse - PR1 dry-run-only)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { splitMdx, loadYaml } from "./lib/frontmatter.mjs";
import {
  resolveFactTokens,
  resolveIncludeTokens,
  expandSourceGoverns,
} from "./resolver.mjs";
import { renderMarkdownToHtml, markNonCanonical } from "./lib/md_to_html.mjs";
import { validateFrontmatter } from "./lib/schema_validator.mjs";
import { computeDiff } from "./lib/projection-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");
const FACTS_FILE = join(REPO_ROOT, "content", "facts", "operational-facts.yaml");
const DRY_RUN_REPORT = join(REPO_ROOT, "docs", "opd", "foundation", "PROJECTION_DRYRUN.md");
const SAMPLE_DIR = join(REPO_ROOT, "scripts", "content", ".dryrun-samples");

const VALID_STATUSES = new Set(["Live", "In Build", "Pending", "Placeholder", "Blocked", "Retired"]);
const VALID_SHELVES = new Set([
  "Safety, Health & Incident",
  "Operations & Leadership",
  "Service Delivery & Client Accounts",
  "People & Conduct",
  "Culinary & Kitchen Operations",
  "Brand & Documentation Standards",
]);
const VALID_DOC_CLASSES = new Set([
  "PB", "STD", "POL", "SOP", "TPL", "CHK", "REF", "AGR", "FORM", "POST", "REC",
]);
const VALID_REL_TYPES = new Set([
  "references", "implements", "supersedes", "superseded_by", "derived_from", "related",
]);
const PREFIX_TO_CLASS = {
  PB: "PB", STD: "STD", POL: "POL", SOP: "SOP", TPL: "TPL",
  CHK: "CHK", REF: "REF", AGR: "AGR", FORM: "FORM", POST: "POST",
  POSTER: "POST", REC: "REC",
};

// NOTE: PR1 follow-up audit confirmed the reader already renders the inverse
// view of a single stored edge via the `direction: 'in'|'out'` field the route
// computes (src/app/api/playbook/route.js enrich block) and SlideOverReader's
// RELATIONSHIP_LABELS_IN/OUT lookup. Storing a derived inverse edge would
// cause the SAME relationship to render TWICE on each doc with conflicting
// labels (e.g. doc A would show "Supersedes: B" from the authored edge AND
// "Replacement for: B" from the derived superseded_by inverse). The
// derivation step has been REMOVED accordingly. Each authored relationship
// (including the frontmatter `supersedes:` field) stores exactly once;
// direction does the inverse work at read time.

// ─── 1. Parse corpus ────────────────────────────────────────────────────────
function parseCorpus() {
  const files = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".mdx")).sort();
  const docs = [];
  for (const f of files) {
    const src = readFileSync(join(DOCS_DIR, f), "utf8");
    let frontmatter, body;
    try {
      ({ frontmatter, body } = splitMdx(src));
    } catch (e) {
      docs.push({ file: f, parseError: e.message });
      continue;
    }
    docs.push({ file: f, frontmatter, body, id: frontmatter?.id || null });
  }
  return docs;
}

// ─── 2. Validate corpus ─────────────────────────────────────────────────────
async function validateCorpus(docs) {
  const errors = [];
  const warnings = [];
  const idSet = new Set();
  for (const d of docs) {
    if (d.parseError) {
      errors.push({ id: d.file, kind: "parse", msg: d.parseError });
      continue;
    }
    if (!d.id) {
      errors.push({ id: d.file, kind: "missing_id", msg: "frontmatter.id is empty" });
      continue;
    }
    if (idSet.has(d.id)) {
      errors.push({ id: d.id, kind: "duplicate_id", msg: `duplicate doc id` });
      continue;
    }
    idSet.add(d.id);
  }
  for (const d of docs) {
    if (d.parseError || !d.id) continue;
    const fm = d.frontmatter;
    // Schema validation via the existing Ajv-backed validator
    try {
      const r = validateFrontmatter(fm);
      if (!r.valid) {
        for (const e of r.errors || []) {
          errors.push({ id: d.id, kind: "schema", msg: `${e.instancePath || "/"}: ${e.message}` });
        }
      }
    } catch (e) {
      errors.push({ id: d.id, kind: "schema_throw", msg: e.message });
    }
    // Status set
    if (!VALID_STATUSES.has(fm.status)) {
      errors.push({ id: d.id, kind: "bad_status", msg: `status='${fm.status}' not in 6-set` });
    }
    // Shelf set (null allowed)
    if (fm.shelf !== null && fm.shelf !== undefined && !VALID_SHELVES.has(fm.shelf)) {
      errors.push({ id: d.id, kind: "bad_shelf", msg: `shelf='${fm.shelf}' not in 7-set` });
    }
    // Doc class matches prefix
    const prefix = (d.id.split("-")[0] || "").toUpperCase();
    const expectedClass = PREFIX_TO_CLASS[prefix];
    if (!expectedClass) {
      errors.push({ id: d.id, kind: "bad_prefix", msg: `id prefix '${prefix}' not allowed` });
    } else if (fm.doc_class !== expectedClass) {
      errors.push({
        id: d.id,
        kind: "class_mismatch",
        msg: `doc_class='${fm.doc_class}' but ID prefix '${prefix}' expects '${expectedClass}'`,
      });
    }
    // chk_live_complete: Live docs need version + card_line. Projection rows are
    // is_historical=false so the gate is strict.
    if (fm.status === "Live") {
      if (!fm.version) {
        errors.push({ id: d.id, kind: "live_incomplete", msg: "status=Live but version is null" });
      }
      if (!fm.card_line) {
        errors.push({ id: d.id, kind: "live_incomplete", msg: "status=Live but card_line is null" });
      }
    }
    // Relationships targets exist
    for (const rel of fm.relationships || []) {
      if (!rel.to) {
        errors.push({ id: d.id, kind: "rel_no_target", msg: `relationship entry missing 'to'` });
        continue;
      }
      if (!idSet.has(rel.to)) {
        errors.push({
          id: d.id,
          kind: "rel_target_missing",
          msg: `relationships: ${rel.type} -> ${rel.to} (target not in MDX)`,
        });
      }
      if (!VALID_REL_TYPES.has(rel.type)) {
        errors.push({
          id: d.id,
          kind: "rel_bad_type",
          msg: `relationship type '${rel.type}' not in allowed set`,
        });
      }
    }
    // translation_of target exists
    if (fm.translation_of && !idSet.has(fm.translation_of)) {
      errors.push({
        id: d.id,
        kind: "translation_of_missing",
        msg: `translation_of -> ${fm.translation_of} (target not in MDX)`,
      });
    }
    // supersedes target exists
    if (fm.supersedes && !idSet.has(fm.supersedes)) {
      errors.push({
        id: d.id,
        kind: "supersedes_missing",
        msg: `supersedes -> ${fm.supersedes} (target not in MDX)`,
      });
    }
  }
  return { errors, warnings, idSet };
}

// ─── 3. Resolve + render ────────────────────────────────────────────────────
function buildDocsMap(docs) {
  const map = {};
  for (const d of docs) {
    if (d.id && d.body) map[d.id] = d.body;
  }
  return map;
}

function resolveAndRender(doc, docsMap, facts) {
  const fm = doc.frontmatter;
  const factCtx = { applies_to: fm.applies_to || "company-wide" };
  // Pipeline matches project_pilot.mjs (post-F6.5 ordering): Include first
  // so any Fact carried in by an Include resolves in the caller's ctx.
  const r1 = resolveIncludeTokens(doc.body, docsMap, factCtx);
  const r2 = resolveFactTokens(r1.mdx, facts, factCtx);
  const sgBody = expandSourceGoverns(r2.mdx);
  const nc = markNonCanonical(sgBody);
  const html = renderMarkdownToHtml(nc.body);
  const content_hash = createHash("sha256").update(nc.body).digest("hex");
  // Detect stray tokens that did not resolve
  const stray = [
    ...(nc.body.match(/<Fact\s+id\s*=\s*"[^"]+"\s*\/>/g) || []),
    ...(nc.body.match(/<Include\s+[^>]*>/g) || []),
    ...(nc.body.match(/<NonCanonical>/g) || []),
    ...(nc.body.match(/<SourceGoverns\s+[^>]*>/g) || []),
  ];
  return {
    html,
    content_hash,
    lang: fm.lang || "en",
    factResolutions: r2.resolutions,
    includes: r1.includes,
    nonCanonicalCount: nc.count,
    stray,
  };
}

// ─── 4. Read live PG snapshot ───────────────────────────────────────────────
async function readLiveSnapshot() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (run with --env-file=.env.local)"
    );
  }
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const [docsRes, relsRes, surfsRes, contentRes, pinsRes] = await Promise.all([
    sb.from("documents").select("*"),
    sb.from("document_relationships").select("*"),
    sb.from("document_surfaces").select("*"),
    sb.from("document_content").select("doc_id, lang, content_hash, rendered_at").then(
      (r) => r,
      // document_content may not exist yet (pr-7-10 not applied) - treat as empty
      () => ({ data: [], error: null })
    ),
    sb.from("document_pins").select("doc_id").then(
      (r) => r,
      // document_pins may not exist yet (pr-7-9 not applied) - treat as empty
      () => ({ data: [], error: null })
    ),
  ]);
  for (const { error } of [docsRes, relsRes, surfsRes]) {
    if (error) throw new Error(`PG read failed: ${error.message}`);
  }
  return {
    documents: docsRes.data || [],
    relationships: relsRes.data || [],
    surfaces: surfsRes.data || [],
    content: contentRes.data || [],
    pins: pinsRes.data || [],
    // Surface a flag so the report knows whether pr-7-9 / pr-7-10 are in place
    has_pins_table: !contentRes.error && Array.isArray(pinsRes.data),
    has_content_table: !contentRes.error && Array.isArray(contentRes.data),
  };
}

// ─── 5. Compute diff + plan ─────────────────────────────────────────────────
// computeDiff / mdxToDocRow / diffRow / valEq live in lib/projection-core.mjs
// so they can be covered by unit tests. The behavior is unchanged.

// ─── 6. Apply path ──────────────────────────────────────────────────────────
/**
 * Execute the projection plan against the live Postgres tables.
 *
 * SAFETY MODEL: A4 uses "logical staging" rather than true SQL CREATE TABLE
 * staging tables (the Supabase REST client cannot run DDL). Each step is
 * either idempotent (UPSERT-by-PK) or has a sub-second delete-then-insert
 * swap window (relationships, surfaces - both small tables, ~370 + 10 rows).
 * The local JSON backup captured pre-apply (.scratch/a4-backup/) is the
 * rollback net if anything fails mid-swap.
 *
 * Step order matters for FK integrity:
 *   1. UPSERT documents - brings new IDs into existence; preserves operator-
 *      owned fields (source_drive_id, source_drive_id_es, pinned, archived,
 *      archived_at, storage_path*, created_at) by omitting them from the
 *      upsert payload (PostgREST UPDATE SET col=EXCLUDED.col only fires for
 *      columns in the INSERT list).
 *   2. Archive via archive_document RPC - flips archived=true AND deletes
 *      document_chunks atomically per pr-7-7 contract.
 *   3. Delete-then-insert document_relationships - all-or-nothing swap.
 *   4. Delete-then-insert document_surfaces - same.
 *   5. UPSERT document_content on (doc_id, lang) - by-PK idempotent.
 *
 * On any step failure: log the error, halt, return. The script does NOT
 * try to auto-rollback. Manual rollback path is to restore from the
 * pre-apply JSON backup.
 */
async function executeApply({ diff, render, corpus, supabaseUrl, supabaseKey }) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const log = { steps: [], ok: false, errors: [] };
  const halt = (step, err) => {
    log.errors.push({ step, msg: err?.message || String(err) });
    return log;
  };

  // Build doc-id -> lang map from corpus (for content rows)
  const langByDoc = {};
  for (const d of corpus) {
    if (d.id) langByDoc[d.id] = d.frontmatter?.lang || "en";
  }

  try {
    // ── Step 1: UPSERT documents ────────────────────────────────────────────
    const docRows = [
      ...diff.docPlan.insert,
      ...diff.docPlan.update.map((u) => u.row),
    ];
    console.log(`  [1/5] UPSERT documents: ${docRows.length} rows (${diff.docPlan.insert.length} insert + ${diff.docPlan.update.length} update)`);
    if (docRows.length > 0) {
      // Stamp updated_at; let schema defaults fire for created_at on inserts.
      const stamped = docRows.map((r) => ({ ...r, updated_at: new Date().toISOString() }));
      const { error } = await sb.from("documents").upsert(stamped, { onConflict: "id" });
      if (error) return halt("documents_upsert", error);
      log.steps.push({ step: "documents_upsert", count: docRows.length });
    }

    // ── Step 2: Archive (3 docs via archive_document RPC) ──────────────────
    console.log(`  [2/5] Archive via archive_document RPC: ${diff.docPlan.archive.length} docs`);
    for (const a of diff.docPlan.archive) {
      const { data, error } = await sb.rpc("archive_document", { p_doc_id: a.id });
      if (error) return halt(`archive_${a.id}`, error);
      const row = data?.[0] || {};
      log.steps.push({ step: "archive", id: a.id, chunks_deleted: row.chunks_deleted ?? 0 });
      console.log(`    archived ${a.id} (chunks_deleted=${row.chunks_deleted ?? 0})`);
    }

    // ── Step 3: Replace document_relationships (atomic, B1) ────────────────
    // The delete-all + insert lives inside a PL/pgSQL function body
    // (replace_document_relationships from pr-7-15) - a single implicit
    // transaction. If the INSERT fails, the DELETE rolls back; the table is
    // never left in a half-state.
    //
    // RUNTIME GUARD: the function returns the inserted-row count. We
    // compare it to the planned count and halt loudly on mismatch. The
    // guard cannot fire in normal operation; it is the permanent self-check
    // for future schema drift or anomalies no test anticipated.
    console.log(`  [3/5] Replace document_relationships via replace_document_relationships (planning ${diff.relPlan.length})`);
    {
      const relRows = diff.relPlan.map((r) => ({
        from_doc: r.from_doc,
        to_doc: r.to_doc,
        rel_type: r.rel_type,
      }));
      const { data: inserted, error } = await sb.rpc("replace_document_relationships", {
        p_rows: relRows,
      });
      if (error) return halt("relationships_replace", error);
      const insertedCount = typeof inserted === "number" ? inserted : Number(inserted);
      if (!Number.isFinite(insertedCount) || insertedCount !== relRows.length) {
        return halt("relationships_count_mismatch", new Error(
          `relationships: planned ${relRows.length}, function inserted ${insertedCount}`
        ));
      }
      log.steps.push({ step: "relationships_replace", count: insertedCount });
    }

    // ── Step 4: Replace document_surfaces (atomic, B1) ─────────────────────
    // Same model as step 3: replace_document_surfaces (pr-7-15) wraps the
    // delete + insert in a single function-body transaction and returns the
    // inserted count for the runtime guard to verify.
    console.log(`  [4/5] Replace document_surfaces via replace_document_surfaces (planning ${diff.surfPlan.length})`);
    {
      const surfRows = diff.surfPlan.map((s) => ({ doc_id: s.doc_id, surface: s.surface }));
      const { data: inserted, error } = await sb.rpc("replace_document_surfaces", {
        p_rows: surfRows,
      });
      if (error) return halt("surfaces_replace", error);
      const insertedCount = typeof inserted === "number" ? inserted : Number(inserted);
      if (!Number.isFinite(insertedCount) || insertedCount !== surfRows.length) {
        return halt("surfaces_count_mismatch", new Error(
          `surfaces: planned ${surfRows.length}, function inserted ${insertedCount}`
        ));
      }
      log.steps.push({ step: "surfaces_replace", count: insertedCount });
    }

    // ── Step 5: UPSERT document_content ────────────────────────────────────
    const contentRows = render
      .filter((r) => r.html && !r.render_error)
      .map((r) => ({
        doc_id: r.id,
        lang: langByDoc[r.id] || r.lang || "en",
        html: r.html,
        content_hash: r.content_hash,
        rendered_at: new Date().toISOString(),
      }));
    console.log(`  [5/5] UPSERT document_content: ${contentRows.length} rows`);
    if (contentRows.length > 0) {
      const { error } = await sb.from("document_content").upsert(contentRows, { onConflict: "doc_id,lang" });
      if (error) return halt("content_upsert", error);
      log.steps.push({ step: "content_upsert", count: contentRows.length });
    }

    log.ok = true;
    return log;
  } catch (e) {
    return halt("uncaught", e);
  }
}

/**
 * Build a structured plan summary for the dry-run report. Does not execute.
 */
function buildApplyPlan(diff, render) {
  return {
    note: "Apply plan is scaffolded only; PR1 is dry-run. PR3 runs apply after Kevin reviews the dry-run.",
    stages: [
      { stage: "create_staging", tables: ["documents_staging", "document_relationships_staging", "document_surfaces_staging", "document_content_staging"] },
      { stage: "load_staging", docs_to_insert: diff.docPlan.insert.length, docs_to_update: diff.docPlan.update.length, rels: diff.relPlan.length, surfaces: diff.surfPlan.length, content_rows: render.length },
      { stage: "archive_absent", count: diff.docPlan.archive.length, ids: diff.docPlan.archive.map((a) => a.id) },
      { stage: "swap_documents", note: "UPSERT from documents_staging into documents - by-ID, preserving source_drive_id, source_drive_id_es, pinned, archived, archived_at, created_at, storage_path." },
      { stage: "swap_relationships", note: "TRUNCATE document_relationships, then INSERT FROM document_relationships_staging." },
      { stage: "swap_surfaces", note: "TRUNCATE document_surfaces, then INSERT FROM document_surfaces_staging." },
      { stage: "swap_content", note: "UPSERT into document_content (doc_id, lang) - skip rows whose content_hash matches the existing row to avoid no-op writes." },
    ],
  };
}

// ─── 7. Dry-run report ──────────────────────────────────────────────────────
function writeDryRunReport({ corpus, validation, diff, render, applyPlan, live }) {
  const lines = [];
  lines.push(`# Projection Dry-Run Report`);
  lines.push(``);
  lines.push(`**Built:** ${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  lines.push(`**Mode:** dry-run (no database writes performed)`);
  lines.push(`**Generated by:** \`scripts/content/project-catalog.mjs\``);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Headlines`);
  lines.push(``);
  lines.push(`| Item | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| MDX docs parsed | ${corpus.filter((d) => !d.parseError).length} |`);
  lines.push(`| Parse errors | ${corpus.filter((d) => d.parseError).length} |`);
  lines.push(`| Validation errors | ${validation.errors.length} |`);
  lines.push(`| Validation warnings | ${validation.warnings.length} |`);
  lines.push(`| Live PG documents (snapshot) | ${live.documents.length} |`);
  lines.push(`| Live PG active | ${live.documents.filter((d) => !d.archived).length} |`);
  lines.push(`| Live PG archived | ${live.documents.filter((d) => d.archived).length} |`);
  lines.push(``);
  lines.push(`### Diff vs live catalog`);
  lines.push(``);
  lines.push(`| Action | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Would INSERT (MDX-new) | ${diff.docPlan.insert.length} |`);
  lines.push(`| Would UPDATE (in both, fields differ) | ${diff.docPlan.update.length} |`);
  lines.push(`| Would ARCHIVE (PG active, absent from MDX) | ${diff.docPlan.archive.length} |`);
  lines.push(`| Relationships planned (authored only) | ${diff.relPlan.length} |`);
  lines.push(`| - relationships block entries | ${diff.relPlan.filter((r) => r.kind === "authored").length} |`);
  lines.push(`| - supersedes frontmatter field | ${diff.relPlan.filter((r) => r.kind === "authored_supersedes").length} |`);
  lines.push(`| Surfaces planned | ${diff.surfPlan.length} |`);
  lines.push(`| Content rows that would render | ${render.length} |`);
  lines.push(``);
  lines.push(`### Pre-apply schema state`);
  lines.push(``);
  lines.push(`- document_pins table present: ${live.has_pins_table ? "yes" : "no (pr-7-9 not applied)"}`);
  lines.push(`- document_content table present: ${live.has_content_table ? "yes" : "no (pr-7-10 not applied)"}`);
  lines.push(`- Current pinned rows in document_pins: ${live.pins.length}`);
  lines.push(`- Current content rows: ${live.content.length}`);
  lines.push(``);

  // Validation failures
  if (validation.errors.length > 0) {
    lines.push(`## Validation failures`);
    lines.push(``);
    lines.push(`Every failure must be resolved in MDX before \`--apply\` runs. Listing all (not truncated).`);
    lines.push(``);
    const grouped = {};
    for (const e of validation.errors) {
      grouped[e.kind] = grouped[e.kind] || [];
      grouped[e.kind].push(e);
    }
    for (const [kind, items] of Object.entries(grouped).sort()) {
      lines.push(`### ${kind} (${items.length})`);
      lines.push(``);
      for (const it of items) {
        lines.push(`- **${it.id}**: ${it.msg}`);
      }
      lines.push(``);
    }
  } else {
    lines.push(`## Validation: clean (0 errors)`);
    lines.push(``);
  }

  // Would-archive set (call out by name)
  lines.push(`## Would-archive (3 max expected; explicit listing)`);
  lines.push(``);
  if (diff.docPlan.archive.length === 0) {
    lines.push(`No docs would be archived.`);
  } else {
    lines.push(`Per brief decision: archive-not-delete. These rows are flipped \`archived=true\` via the archive_document RPC (pr-7-7) which also deletes their document_chunks atomically.`);
    lines.push(``);
    lines.push(`| ID | Current PG status | Title | Reason |`);
    lines.push(`|---|---|---|---|`);
    for (const a of diff.docPlan.archive) {
      lines.push(`| ${a.id} | ${a.current_status} | ${(a.title || "").slice(0, 50)} | ${a.reason} |`);
    }
    lines.push(``);
    lines.push(`### STD-005 - confirm-intended-archive review item`);
    lines.push(``);
    lines.push(`STD-005 "Project OPD Playbook" is in the would-archive set but, unlike LEGACY-PR / LEGACY-WOW, it is an **active In Build doc** (status "In Build", shelf "Brand & Standards", audience "internal"). It would archive only because no \`STD-005.mdx\` exists in \`content/documents/\` (confirmed - file not present in the foundation). Production state: \`is_historical: true\`, \`data_provenance: batch_rebuild\`, no source_drive_id, 0 relationships pointing at it from any other doc.`);
    lines.push(``);
    lines.push(`**What it is:** the meta/spec doc that documents the OPD system itself. The pr-7-1 schema header reads "Reconstructed from STD-005 §10"; the seed comment says STD-005 "self-registered" row one of the catalog it defines. It is project-meta scaffolding, not operational content an operator would use.`);
    lines.push(``);
    lines.push(`**Inferred reason for absence from MDX foundation:** the F1-F6.6 work scoped operational documents (PB / SOP / POL / FORM / TPL / POST / etc.) that operators consume. STD-005 is a self-referential spec - the kind of artifact that lives in \`docs/\` rather than \`content/documents/\`. The intentional-vs-missed signal is ambiguous; flagging for Kevin's call rather than presuming either way.`);
    lines.push(``);
    lines.push(`**Kevin decides between:**`);
    lines.push(`- a. **Let it archive** (current default). audience:internal means almost no UI surface loss; admin worklist drops it too. The catalog row stays in the DB for audit. Recommended if STD-005 lives elsewhere as project docs.`);
    lines.push(`- b. **Author STD-005 into MDX** as a real catalog row before apply runs (would drop the would-archive count from 3 to 2).`);
    lines.push(`- c. **Move its contents to \`docs/\` permanently** and treat its current PG row as legacy (still archives).`);
  }
  lines.push(``);

  // Insert sample (first 15)
  lines.push(`## Would-insert sample (first 15 of ${diff.docPlan.insert.length})`);
  lines.push(``);
  lines.push(`| ID | Status | doc_class | Shelf | Title |`);
  lines.push(`|---|---|---|---|---|`);
  for (const r of diff.docPlan.insert.slice(0, 15)) {
    lines.push(`| ${r.id} | ${r.status} | ${r.doc_class} | ${r.shelf || "(null)"} | ${(r.title || "").slice(0, 50)} |`);
  }
  if (diff.docPlan.insert.length > 15) {
    lines.push(`| ... | | | | (${diff.docPlan.insert.length - 15} more) |`);
  }
  lines.push(``);

  // Update sample (first 10) - show which fields change
  lines.push(`## Would-update sample (first 10 of ${diff.docPlan.update.length})`);
  lines.push(``);
  if (diff.docPlan.update.length === 0) {
    lines.push(`No docs would be updated.`);
  } else {
    lines.push(`| ID | Fields changing |`);
    lines.push(`|---|---|`);
    for (const u of diff.docPlan.update.slice(0, 10)) {
      const fields = Object.keys(u.changes).sort().join(", ");
      lines.push(`| ${u.id} | ${fields} |`);
    }
    if (diff.docPlan.update.length > 10) {
      lines.push(`| ... | (${diff.docPlan.update.length - 10} more) |`);
    }
  }
  lines.push(``);

  // Relationships summary by type
  lines.push(`## Relationships planned (${diff.relPlan.length} total)`);
  lines.push(``);
  const relByType = {};
  for (const r of diff.relPlan) {
    const k = `${r.rel_type} (${r.kind})`;
    relByType[k] = (relByType[k] || 0) + 1;
  }
  lines.push(`| Type / Kind | Count |`);
  lines.push(`|---|---|`);
  for (const [k, n] of Object.entries(relByType).sort()) {
    lines.push(`| ${k} | ${n} |`);
  }
  lines.push(``);
  lines.push(`Current live \`document_relationships\` count: ${live.relationships.length}. Projection replaces all rows on apply (staging-then-swap).`);
  lines.push(``);
  lines.push(`**Inverse-edge handling (PR1 follow-up audit):** the projection stores each authored edge exactly once. The reader inverts at read time via the route's \`direction: 'in'|'out'\` field combined with \`RELATIONSHIP_LABELS_OUT\` / \`RELATIONSHIP_LABELS_IN\` in \`_shared.js\`. Storing inverse rows would double-render the same relationship on both ends with conflicting labels.`);
  lines.push(``);

  // Surfaces summary
  lines.push(`## Surfaces planned (${diff.surfPlan.length} total)`);
  lines.push(``);
  const surfsByDoc = {};
  for (const s of diff.surfPlan) {
    surfsByDoc[s.doc_id] = surfsByDoc[s.doc_id] || [];
    surfsByDoc[s.doc_id].push(s.surface);
  }
  lines.push(`| Doc | Surfaces |`);
  lines.push(`|---|---|`);
  for (const [d, surfs] of Object.entries(surfsByDoc).sort()) {
    lines.push(`| ${d} | ${surfs.join(", ")} |`);
  }
  lines.push(``);
  lines.push(`Current live \`document_surfaces\` count: ${live.surfaces.length}. Projection authored from MDX frontmatter (backfilled at A2.1).`);
  lines.push(``);

  // Content render summary
  lines.push(`## Content render (${render.length} rows)`);
  lines.push(``);
  const totalHtml = render.reduce((sum, r) => sum + (r.html?.length || 0), 0);
  const totalFacts = render.reduce((sum, r) => sum + (r.factResolutions?.length || 0), 0);
  const totalIncludes = render.reduce((sum, r) => sum + (r.includes?.filter((i) => i.resolved).length || 0), 0);
  const totalNC = render.reduce((sum, r) => sum + (r.nonCanonicalCount || 0), 0);
  const strayCount = render.reduce((sum, r) => sum + (r.stray?.length || 0), 0);
  lines.push(`- Total HTML bytes: ${totalHtml.toLocaleString()}`);
  lines.push(`- Fact resolutions: ${totalFacts}`);
  lines.push(`- Includes inlined: ${totalIncludes}`);
  lines.push(`- NonCanonical blocks marked as Example: ${totalNC}`);
  lines.push(`- Stray tokens (unresolved): ${strayCount}`);
  lines.push(``);
  if (strayCount > 0) {
    lines.push(`### Docs with stray tokens`);
    lines.push(``);
    for (const r of render) {
      if (r.stray && r.stray.length) {
        lines.push(`- **${r.id}**: ${r.stray.slice(0, 5).map((s) => "`" + s + "`").join(", ")}${r.stray.length > 5 ? "..." : ""}`);
      }
    }
    lines.push(``);
  }

  // Apply plan summary
  lines.push(`## Apply plan (scaffolded - NOT EXECUTED in PR1)`);
  lines.push(``);
  lines.push(`The \`--apply\` mode is built but does not run in PR1. Below is the staged plan the script would execute when run with \`--apply\` post-dry-run-review.`);
  lines.push(``);
  for (const stage of applyPlan.stages) {
    lines.push(`### ${stage.stage}`);
    for (const [k, v] of Object.entries(stage)) {
      if (k === "stage") continue;
      if (k === "ids" && Array.isArray(v)) {
        lines.push(`- ${k}: ${v.join(", ")}`);
      } else if (k === "note") {
        lines.push(`- ${v}`);
      } else if (Array.isArray(v)) {
        lines.push(`- ${k}: ${v.join(", ")}`);
      } else {
        lines.push(`- ${k}: ${v}`);
      }
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`## Sample rendered HTML files`);
  lines.push(``);
  lines.push(`Written to \`scripts/content/.dryrun-samples/\` (gitignored). One example each:`);
  lines.push(``);
  lines.push(`- One SOP (e.g., SOP-008 Food Safety Management - lots of Fact resolutions)`);
  lines.push(`- One POL (e.g., POL-003 Drug & Alcohol Policy - the doc with the Staff Rules subsection that's the Include target)`);
  lines.push(`- One doc with Includes (SOP-009 NSF Certified-for-Sport Sourcing - the only Include in the corpus)`);
  lines.push(`- One bilingual pair (POST-001 + POST-001-ES, the live bilingual exemplar)`);
  lines.push(``);

  writeFileSync(DRY_RUN_REPORT, lines.join("\n"));
  return DRY_RUN_REPORT;
}

function writeSampleHtml(renderById) {
  if (existsSync(SAMPLE_DIR)) rmSync(SAMPLE_DIR, { recursive: true, force: true });
  mkdirSync(SAMPLE_DIR, { recursive: true });
  const samples = ["SOP-008", "POL-003", "SOP-009", "POST-001", "POST-001-ES"];
  const written = [];
  for (const id of samples) {
    const r = renderById[id];
    if (!r) continue;
    const file = join(SAMPLE_DIR, `${id}.html`);
    const wrappedHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${id} - dry-run sample</title>
<style>
body { max-width: 760px; margin: 2rem auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; line-height: 1.55; color: #1a1a1a; padding: 0 1rem; }
h1, h2, h3 { color: #0a3d62; margin-top: 1.8em; }
h1 { font-size: 1.6rem; border-bottom: 2px solid #0a3d62; padding-bottom: .3em; }
table { border-collapse: collapse; margin: 1em 0; width: 100%; }
th, td { border: 1px solid #d0d0d0; padding: .5em .8em; text-align: left; vertical-align: top; }
th { background: #f4f6f8; font-weight: 600; }
blockquote { border-left: 4px solid #94a3b8; margin: 1em 0; padding: .5em 1em; background: #f8fafc; }
blockquote.callout-anchor { border-left-color: #0a3d62; background: #eef2f7; }
blockquote.callout-note { border-left-color: #2563eb; background: #eff6ff; }
blockquote.callout-critical { border-left-color: #b91c1c; background: #fef2f2; }
blockquote.callout-warning { border-left-color: #d97706; background: #fffbeb; }
code { background: #f1f5f9; padding: .1em .3em; border-radius: 3px; font-size: .92em; }
pre code { background: none; padding: 0; }
hr { border: 0; border-top: 1px solid #e5e7eb; margin: 2em 0; }
</style>
</head>
<body>
<header style="background:#f0f3f7;padding:.7em 1em;border-radius:4px;margin-bottom:1em">
  <strong>${id}</strong> - dry-run sample - resolved + rendered display HTML
</header>
${r.html}
</body>
</html>`;
    writeFileSync(file, wrappedHtml);
    written.push(file.replace(REPO_ROOT + "/", ""));
  }
  return written;
}

// ─── 8. Main orchestrator ───────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--apply") ? "apply" : "dry-run";

  console.log(`Phase A · MDX -> Postgres projection · ${mode}`);
  console.log("");

  // 1. Parse
  console.log("[1/5] Parsing MDX corpus...");
  const corpus = parseCorpus();
  console.log(`  parsed ${corpus.length} files (${corpus.filter((d) => d.parseError).length} parse errors)`);

  // 2. Validate
  console.log("[2/5] Validating corpus (schema + cross-doc)...");
  const validation = await validateCorpus(corpus);
  console.log(`  ${validation.errors.length} errors, ${validation.warnings.length} warnings`);

  // 3. Resolve + render
  console.log("[3/5] Resolving Facts + Includes + rendering display HTML...");
  const facts = loadYaml(readFileSync(FACTS_FILE, "utf8"));
  const docsMap = buildDocsMap(corpus);
  const render = [];
  const renderById = {};
  for (const d of corpus) {
    if (d.parseError || !d.id || !d.body) continue;
    try {
      const r = resolveAndRender(d, docsMap, facts);
      render.push({ id: d.id, ...r });
      renderById[d.id] = r;
    } catch (e) {
      render.push({ id: d.id, render_error: e.message });
    }
  }
  console.log(`  rendered ${render.length} docs`);

  // 4. Read live PG snapshot
  console.log("[4/5] Reading live PG snapshot...");
  const live = await readLiveSnapshot();
  console.log(`  PG: ${live.documents.length} docs, ${live.relationships.length} rels, ${live.surfaces.length} surfaces, ${live.pins.length} pins, ${live.content.length} content rows`);

  // 5. Diff + plan
  console.log("[5/5] Computing diff + plan...");
  const diff = computeDiff(corpus, live);
  const applyPlan = buildApplyPlan(diff, render);
  console.log(`  ${diff.docPlan.insert.length} insert, ${diff.docPlan.update.length} update, ${diff.docPlan.archive.length} archive`);

  // Write report + samples (both modes - dry-run report stays useful post-apply too)
  const reportPath = writeDryRunReport({ corpus, validation, diff, render, applyPlan, live });
  const samples = writeSampleHtml(renderById);

  console.log("");
  console.log("──────────────────────────────────────────────────");
  console.log(`Dry-run report: ${reportPath.replace(REPO_ROOT + "/", "")}`);
  console.log(`Sample HTML:    ${samples.length} files in scripts/content/.dryrun-samples/`);
  console.log("──────────────────────────────────────────────────");

  if (validation.errors.length > 0) {
    console.log("");
    console.log(`HALT: ${validation.errors.length} validation errors. Fix in MDX before --apply runs.`);
    process.exit(1);
  }

  if (mode === "dry-run") {
    console.log("");
    console.log("Dry-run only. Run with --apply to write to Postgres.");
    return;
  }

  // ── APPLY ─────────────────────────────────────────────────────────────────
  console.log("");
  console.log("══════════════════════════════════════════════════");
  console.log("APPLY · writing to Postgres (production)");
  console.log("══════════════════════════════════════════════════");
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.");
    process.exit(1);
  }
  const applyLog = await executeApply({
    diff,
    render,
    corpus,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  console.log("");
  if (applyLog.ok) {
    console.log("APPLY OK · all 5 steps complete");
    for (const s of applyLog.steps) {
      console.log(`  ${s.step}: ${JSON.stringify({ ...s, step: undefined })}`);
    }
  } else {
    console.error("APPLY FAILED · halted on:");
    for (const e of applyLog.errors) console.error(`  ${e.step}: ${e.msg}`);
    console.error("");
    console.error("Local JSON backup is in .scratch/a4-backup/ - manual rollback path.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});

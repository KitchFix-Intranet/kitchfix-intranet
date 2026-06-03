-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-1-opd-schema.sql
-- Project OPD · PR 7.1 · The Playbook — document catalog schema
-- (PR family number kept for filename sort order; the "Module 7" label was
--  retired pre-apply to avoid collision with Project 3's Module 7 = Smart Inventory.)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Stands up the Operational Playbook Database (OPD) catalog in Postgres. Greenfield,
-- Postgres-only domain — no Sheets predecessor, no dual-write, no cutover flags
-- (CUTOVER_PLAYBOOK.md scopes greenfield PG-only out of the dual-write window).
-- Reconstructed from STD-005 §10; the original documents-library migration was never
-- committed to this repo (confirmed 2026-05-29). Module name for opts.module: "playbook".
--
-- Four tables:
--   documents              — the catalog (one row per document). TEXT PK = doc ID.
--   document_relationships — directed edges (references / implements / supersedes …)
--   document_surfaces      — many-to-many: a doc's contextual appearances in intranet tools
--   document_issues        — report-an-issue channel (STD-005 §7.3)
--
-- House-style notes:
--   • Enums are CHECK constraints, not Postgres ENUM types.
--   • is_historical + data_provenance on every table (post-Module-6 house style). Values match
--     pr-6-1 verbatim: 'app_scan' | 'batch_rebuild' | 'manual_entry' | 'unknown'. OPD has no
--     OCR pipeline, so ongoing app writes default to 'manual_entry'; the seed (pr-7-2) marks
--     reconstructed rows 'batch_rebuild' + is_historical = TRUE.
--   • is_historical earns its place via chk_live_complete (documents): a Live doc must carry a
--     version AND a card_line — but historical/seed rows are exempt, mirroring pr-6-1's
--     "is_historical = TRUE OR <strict rule>" gated-constraint pattern.
--   • RLS DISABLED on every table (service_role client bypasses it; auth is app-layer in
--     src/lib/opdAcl.js). RLS becomes the boundary only when AUTH_MODEL.md ships user JWTs.
--   • GRANT blocks mandatory — PostgREST returns "permission denied" without them even RLS-off.
--   • Idempotent. Apply via Studio, then run verify-pr-7-1 BEFORE the seed (pr-7-2).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- documents — the catalog
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id               TEXT PRIMARY KEY,                          -- stable doc ID: PB-006, SOP-002, REF-005-A
  title            TEXT NOT NULL,
  doc_class        TEXT NOT NULL,
  status           TEXT NOT NULL,
  version          TEXT,                                      -- current published version; NULL while unstarted
  shelf            TEXT,                                      -- home shelf; NULL for Retired / unassigned

  card_line        TEXT,                                      -- operator one-liner on the browse card
  summary          TEXT,                                      -- longer; SousAI signal
  keywords         TEXT[] NOT NULL DEFAULT '{}',              -- SousAI signal

  owner            TEXT,                                      -- role title, not a person's name
  approver         TEXT,                                      -- role title

  source_drive_id  TEXT,                                      -- Drive file id; reader builds view/thumbnail URL from it
  storage_path     TEXT,                                      -- reserved for deferred Supabase Storage path (PDF copies)

  pinned           BOOLEAN NOT NULL DEFAULT false,            -- floats to top of its shelf
  print_required   BOOLEAN NOT NULL DEFAULT false,            -- POST class: shows Print affordance
  critical         BOOLEAN NOT NULL DEFAULT false,            -- safety-critical styling (carried from manifests)
  sort_order       INTEGER NOT NULL DEFAULT 100,

  audience         TEXT,                                      -- defined now; enforcement deferred (page gate covers v1)
  classification   TEXT NOT NULL DEFAULT 'KitchFix Internal',

  effective_date   DATE,
  last_reviewed    DATE,
  next_review      DATE,

  is_historical    BOOLEAN NOT NULL DEFAULT false,            -- TRUE = reconstructed/seed row, exempt from strict gates
  data_provenance  TEXT NOT NULL DEFAULT 'manual_entry',

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_documents_class CHECK (
    doc_class IN ('PB','SOP','TPL','REF','STD','POL','AGR','FORM','POST','CHK')
  ),
  CONSTRAINT chk_documents_status CHECK (
    status IN ('Live','In Build','Draft','Pending','Placeholder','Blocked','Retired')
  ),
  CONSTRAINT chk_documents_shelf CHECK (
    shelf IS NULL OR shelf IN ('Safety','Operations','HR & People','Culinary','Finance','Site & Client')
  ),
  CONSTRAINT chk_documents_provenance CHECK (
    data_provenance IN ('app_scan','batch_rebuild','manual_entry','unknown')
  ),
  -- A published (Live) document must be complete. Seed/historical rows are exempt.
  CONSTRAINT chk_live_complete CHECK (
    is_historical = TRUE OR status <> 'Live' OR (version IS NOT NULL AND card_line IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS documents_shelf_idx       ON documents (shelf);
CREATE INDEX IF NOT EXISTS documents_status_idx      ON documents (status);
CREATE INDEX IF NOT EXISTS documents_class_idx       ON documents (doc_class);
CREATE INDEX IF NOT EXISTS documents_browse_idx      ON documents (shelf, doc_class, sort_order, title);
CREATE INDEX IF NOT EXISTS documents_pinned_idx      ON documents (shelf) WHERE pinned = true;

ALTER TABLE documents DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON documents TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON documents TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- document_relationships — directed edges between documents
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_relationships (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_doc         TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  to_doc           TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  rel_type         TEXT NOT NULL,
  is_historical    BOOLEAN NOT NULL DEFAULT false,
  data_provenance  TEXT NOT NULL DEFAULT 'manual_entry',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_rel_type CHECK (
    rel_type IN ('references','implements','supersedes','superseded_by','derived_from','related')
  ),
  CONSTRAINT chk_rel_provenance CHECK (
    data_provenance IN ('app_scan','batch_rebuild','manual_entry','unknown')
  ),
  CONSTRAINT uq_relationship UNIQUE (from_doc, to_doc, rel_type)
);

CREATE INDEX IF NOT EXISTS document_relationships_from_idx ON document_relationships (from_doc);
CREATE INDEX IF NOT EXISTS document_relationships_to_idx   ON document_relationships (to_doc);

ALTER TABLE document_relationships DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON document_relationships TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON document_relationships TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- document_surfaces — where a document is contextually surfaced in the intranet
-- (a doc lives on ONE shelf but can surface in MANY tools; STD-005 §7.2)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_surfaces (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id           TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  surface          TEXT NOT NULL,                             -- named widget/tool/workflow, e.g. 'kitchen'
  is_historical    BOOLEAN NOT NULL DEFAULT false,
  data_provenance  TEXT NOT NULL DEFAULT 'manual_entry',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_surface_provenance CHECK (
    data_provenance IN ('app_scan','batch_rebuild','manual_entry','unknown')
  ),
  CONSTRAINT uq_surface UNIQUE (doc_id, surface)
);

CREATE INDEX IF NOT EXISTS document_surfaces_surface_idx ON document_surfaces (surface);
CREATE INDEX IF NOT EXISTS document_surfaces_doc_idx     ON document_surfaces (doc_id);

ALTER TABLE document_surfaces DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON document_surfaces TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON document_surfaces TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- document_issues — operator report-an-issue channel (STD-005 §7.3)
-- Insert → Slack ping to the Architect for triage (wired in the route handler).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_issues (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id           TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  reporter_email   TEXT NOT NULL,
  issue_text       TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'open',
  is_historical    BOOLEAN NOT NULL DEFAULT false,
  data_provenance  TEXT NOT NULL DEFAULT 'manual_entry',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_issue_status CHECK (
    status IN ('open','triaged','in_progress','closed')
  ),
  CONSTRAINT chk_issue_provenance CHECK (
    data_provenance IN ('app_scan','batch_rebuild','manual_entry','unknown')
  )
);

CREATE INDEX IF NOT EXISTS document_issues_doc_idx   ON document_issues (doc_id);
CREATE INDEX IF NOT EXISTS document_issues_open_idx  ON document_issues (status) WHERE status <> 'closed';

ALTER TABLE document_issues DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON document_issues TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON document_issues TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-1. Next: run scripts/verify-pr-7-1-opd-schema.mjs, then apply pr-7-2 (seed).
-- ─────────────────────────────────────────────────────────────────────────────

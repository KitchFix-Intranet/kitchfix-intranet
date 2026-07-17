-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-16-opd-add-rec-class.sql
-- Add REC (Record) to the documents.doc_class CHECK constraint.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT this does:
--   Expands the documents.doc_class CHECK constraint to allow 'REC' as an
--   eleventh doc class. The set was PB/SOP/TPL/REF/STD/POL/AGR/FORM/POST/CHK
--   as defined in pr-7-1-opd-schema.sql; this migration adds REC.
--
-- WHY:
--   PR #452 (feat: add REC (Record) doc class) added REC to the JSON schema
--   doc_class enum, the JS validator VALID_CLASSES set, the reader/cockpit
--   CLASS_LABELS + FM_DOC_CLASSES + CLASS_EDIT_OPTIONS + CLASS_FAMILY maps,
--   and the projection code's VALID_DOC_CLASSES + PREFIX_TO_CLASS. It missed
--   the PG-side CHECK constraint. PR #454 then landed the first REC docs
--   (REC-101..REC-111 per-account records) and the auto-projection Action
--   halted at [1/5] UPSERT documents with
--     documents_upsert: new row for relation "documents" violates check
--     constraint "chk_documents_class"
--   because the PG constraint still rejected doc_class='REC'. This migration
--   closes that sweep gap.
--
-- CHUNK IMPACT: NONE.
--   document_chunks has no doc_class column - the field affects the documents
--   table alone. Existing chunks stay exactly as they are; no re-embedding
--   required.
--
-- IDEMPOTENT:
--   DROP CONSTRAINT IF EXISTS handles re-runs. The ALTER TABLE + ADD
--   CONSTRAINT pair is a safe re-execution: dropping and re-adding the same
--   constraint definition is a no-op in behavior.
--
-- APPLY STATUS:
--   Applied manually in Supabase Studio on 2026-07-17 by Kevin (post-#454
--   projection failure). This file captures the applied change so the DDL
--   is in-repo and future maintainers see the state. The auto-projection
--   Action re-run after this file lands will succeed because the constraint
--   already accepts REC in production.
--
-- COORDINATION:
--   No app-side change needed - PR #452 already updated the JS/JSON side.
--   The next opd-autoprojection run (either the merge of this PR or a manual
--   workflow_dispatch / trivial content commit) will insert the 25 REC/REF
--   batch rows that pr #454's atomic-rollback prevented from landing.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE documents DROP CONSTRAINT IF EXISTS chk_documents_class;

ALTER TABLE documents ADD CONSTRAINT chk_documents_class CHECK (
  doc_class IN ('PB','SOP','TPL','REF','STD','POL','AGR','FORM','POST','CHK','REC')
);

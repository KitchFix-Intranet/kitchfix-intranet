-- ════════════════════════════════════════════════════════════════════════════
-- INV-2 prereq: Add RQ enum members to inventory_alias_source +
-- price_history_source
-- ════════════════════════════════════════════════════════════════════════════
-- Hard prerequisite P1 from docs/MODULE_7_INV-2_PLAN_CORRECTION.md §2a.
--
-- WHY
-- The Review Queue PG mirrors on feat/review-queue-complete-tool write
-- source='manual_resolve' (Match/Pick-different/Create-new) and
-- source='manual_resolve_reverted' (Undo reversers) to both item_aliases
-- and price_history. Engine-confirmed 2026-06-11 (22P02 invalid_text_-
-- representation) that neither value exists in the live enums:
--   inventory_alias_source  = (manual, ocr_learned, merge, item_review, ai_cron)
--   price_history_source    = (manual_add, manual_verify, invoice_ocr, merge)
--
-- The Undo path is doubly exposed: it BOTH writes 'manual_resolve_reverted'
-- AND filters .eq("source", "manual_resolve") in the WHERE clause. Both
-- values must exist in both enums or the reversers silently match zero
-- rows even after the forward writes succeed (which they don't, yet).
--
-- SAFETY
-- ALTER TYPE ... ADD VALUE rewrites no rows and changes no current
-- behavior - the values are unused until the RQ PG paths execute, which
-- is flag-gated off. Additive change. No reversal needed if it produces
-- problems (it can't; nothing references the new values until INV-2
-- cutover, and even then only the RQ paths use them).
--
-- TRANSACTION NOTE
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in some
-- PostgreSQL versions/configurations. Run each statement separately, not
-- wrapped in BEGIN/COMMIT. The Supabase Studio SQL editor runs each
-- top-level statement in its own implicit transaction, which satisfies
-- this. If running via psql or another tool, ensure autocommit (no
-- explicit BEGIN block).
--
-- USAGE
--   Supabase Studio SQL editor: paste this whole file, run.
--   Then verify with: node --env-file=.env.local scripts/_probe_enum_members.mjs
--   Expected: all four values now ACCEPTED on their respective enums.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TYPE inventory_alias_source ADD VALUE IF NOT EXISTS 'manual_resolve';
ALTER TYPE inventory_alias_source ADD VALUE IF NOT EXISTS 'manual_resolve_reverted';
ALTER TYPE price_history_source    ADD VALUE IF NOT EXISTS 'manual_resolve';
ALTER TYPE price_history_source    ADD VALUE IF NOT EXISTS 'manual_resolve_reverted';

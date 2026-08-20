-- ═══════════════════════════════════════════════════════════════════════════
-- purchasing-4-category-mapping-provenance.sql
--
-- G3 (2026-08-20): map the 55 Rippling spend categories to GL line codes.
-- Part A parses `\d{4}(\.\d+)*` off the category name. Part B applies the
-- owner's 23 rulings from card_category_rulings.xlsx. Part D populates
-- spend_category_map.gl_line_code with a provenance trail so a labelled
-- row can be traced back to the reason for its route in six months.
--
-- Column values allowed on spend_category_map.provenance:
--   'parsed_from_name'         -> Part A: leading GL code parsed off the
--                                  category name (e.g. "3200.1 General Food"
--                                  -> "3200.1"). 32 categories.
--   'owner_ruling_2026-08-20'  -> Part B: owner ruling from the xlsx
--                                  Rulings sheet column F. 22 categories
--                                  routed by ruling (23 rulings total; one
--                                  is `**Please Select A Category**`
--                                  which stays unrouted).
--   'unrouted'                 -> nothing applies. Category stays in the
--                                  visible queue.
--
-- ─── SCHEMA CHANGES (this migration) ─────────────────────────────────────
--
-- 1. spend_category_map.provenance - TEXT column, nullable. Populated for
--    every labelled row by scripts/purchasing_apply_category_rulings.mjs.
--    Nullable because unlabelled rows carry no provenance until a
--    ruling or a name parse assigns one. Constraint: when
--    gl_line_code IS NOT NULL then provenance MUST be one of the three
--    allowed values (encoded in Statement 4).
--
-- ─── DDL STATEMENTS - APPLY ONE AT A TIME IN STUDIO ──────────────────────
-- Each statement is independently valid.
--
-- No new tables, so no additional GRANTs required. spend_category_map
-- already carries GRANT SELECT, INSERT, UPDATE TO service_role from
-- purchasing-1-schema.sql (§20). Verify V3 below re-asserts.

-- Statement 1: add the provenance column, nullable.
ALTER TABLE spend_category_map
  ADD COLUMN IF NOT EXISTS provenance TEXT;

-- Statement 2: drop the constraint if it exists (idempotent).
ALTER TABLE spend_category_map
  DROP CONSTRAINT IF EXISTS spend_category_map_provenance_shape;

-- Statement 3: pre-flight check - COUNT rows that would violate the
-- constraint about to be added in Statement 4. READ-ONLY. Expect 0.
-- A violating row is one where gl_line_code is populated but provenance
-- is not one of the three allowed values (or is NULL).
-- If this returns > 0, STOP - inspect the violating rows before Statement 4:
--   SELECT category_id, category_label, gl_line_code, provenance
--     FROM spend_category_map
--    WHERE gl_line_code IS NOT NULL
--      AND (provenance IS NULL
--           OR provenance NOT IN ('parsed_from_name',
--                                 'owner_ruling_2026-08-20',
--                                 'unrouted'));
SELECT COUNT(*) || ' violating rows (gl_line_code IS NOT NULL AND provenance not in allowed set)'
         AS preflight_result
  FROM spend_category_map
 WHERE gl_line_code IS NOT NULL
   AND (provenance IS NULL
        OR provenance NOT IN ('parsed_from_name',
                              'owner_ruling_2026-08-20',
                              'unrouted'));

-- Statement 4: add the constraint - if gl_line_code is populated then
-- provenance MUST be one of the three allowed values. The converse
-- (provenance -> gl_line_code non-null) is NOT enforced because
-- 'unrouted' is a legitimate provenance for a row whose gl_line_code
-- stays NULL - the ruling was "keep it in the queue" and that ruling
-- itself is a decision worth recording.
ALTER TABLE spend_category_map
  ADD CONSTRAINT spend_category_map_provenance_shape
    CHECK (gl_line_code IS NULL
           OR provenance IN ('parsed_from_name',
                             'owner_ruling_2026-08-20',
                             'unrouted'));

-- Statement 5: index for provenance lookups (audit queries).
CREATE INDEX IF NOT EXISTS spend_category_map_provenance_idx
  ON spend_category_map (provenance)
  WHERE provenance IS NOT NULL;

-- Statement 6: update the table comment to reflect the new column.
COMMENT ON COLUMN spend_category_map.provenance IS
  'Populated by scripts/purchasing_apply_category_rulings.mjs (G3, 2026-08-20). '
  'Values: parsed_from_name (leading \d{4}(\.\d+)* on category_label), '
  'owner_ruling_2026-08-20 (Kevin''s ruling in card_category_rulings.xlsx col F), '
  'unrouted (nothing applies - category stays in the visible queue).';

-- ─── VERIFY BLOCK - READ-ONLY (no BEGIN/UPDATE/ROLLBACK) ─────────────────
-- Run these in Studio after the DDL lands. Every query is a SELECT.
--
-- V1. provenance column exists on spend_category_map with type TEXT
--     SELECT column_name, data_type, is_nullable
--       FROM information_schema.columns
--      WHERE table_name = 'spend_category_map' AND column_name = 'provenance';
--
-- V2. provenance constraint present
--     SELECT conname, pg_get_constraintdef(oid)
--       FROM pg_constraint
--      WHERE conrelid = 'spend_category_map'::regclass
--        AND conname = 'spend_category_map_provenance_shape';
--
-- V3. service_role holds SELECT and UPDATE on spend_category_map (should
--     already be true from purchasing-1-schema.sql §20; re-asserted here
--     because G3's applier script hits this table with UPDATE and any
--     future migration touching the table must not silently break it).
--     SELECT grantee, privilege_type
--       FROM information_schema.role_table_grants
--      WHERE table_name = 'spend_category_map'
--        AND grantee = 'service_role'
--        AND privilege_type IN ('SELECT', 'UPDATE', 'INSERT')
--      ORDER BY privilege_type;
--     (expect three rows: INSERT, SELECT, UPDATE)
--
-- V4. provenance index present
--     SELECT indexname FROM pg_indexes
--      WHERE tablename = 'spend_category_map'
--        AND indexname = 'spend_category_map_provenance_idx';
--
-- ─── OWNER ATTESTATION ───────────────────────────────────────────────────
-- applied in Studio: YES
--   head SHA: <fill-in-when-applied>

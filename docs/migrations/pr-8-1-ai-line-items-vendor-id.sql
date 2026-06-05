-- ════════════════════════════════════════════════════════════════════════════
-- PR 8.1: ai_line_items.vendor_id (FK to vendors)
-- ════════════════════════════════════════════════════════════════════════════
-- Adds the FK column that canonicalizes vendor identity on every AI-extracted
-- line item, matching the inventory_items.vendor_id pattern (TEXT NOT NULL
-- REFERENCES vendors(id)).
--
-- SPLIT INTO TWO PARTS for production safety. Paste them at two different
-- times around the intranet code deploy so there is NEVER a window where the
-- schema requires vendor_id but the live code doesn't populate it (= 23502
-- not-null failure on every invoice upload):
--
--     ┌─────────────────────────────────────────────────────────────────┐
--     │  STEP 1.  Paste PART A in Supabase Studio.                       │
--     │           Adds the column NULLABLE + backfills the 7,655 rows.   │
--     │           Schema is permissive; live code can keep writing NULL  │
--     │           (the existing insertAILineItemsPostgres path).         │
--     │                                                                  │
--     │  STEP 2.  Merge the intranet PR (this branch) → Vercel deploys.  │
--     │           New code path resolves + populates vendor_id on every  │
--     │           invoice insert.                                        │
--     │                                                                  │
--     │  STEP 3.  Paste PART B in Supabase Studio.                       │
--     │           Top-up UPDATE catches any rows written during the gap  │
--     │           window between PART A and the deploy, then DO-block    │
--     │           guard, SET NOT NULL, ADD FK, CREATE INDEX.             │
--     │                                                                  │
--     │  STEP 4.  Run scripts/verify-pr-8-1-ai-line-items-vendor-id.mjs  │
--     │           — exits 0 only after BOTH parts are applied.           │
--     └─────────────────────────────────────────────────────────────────┘
--
-- Backfill algorithm mirrors scripts/backfill-inventory.mjs Phase 2:
--   1. exact match: lower(vendors.name) = lower(vendor_name)
--   2. alias fallback: vendor_aliases.alias_normalized = normalize(vendor_name)
--      where normalize = lowercase + strip non-[a-z0-9 space]
--
-- Coverage verified 2026-06-05 via scripts/_probe_pr_8_1_vendor_resolution.mjs:
--   ai_line_items total rows:     7,655
--   distinct vendor_name values:    33
--   exact match (vendors.name):     29 distinct  /  7,627 rows  (99.6%)
--   via vendor_aliases:              4 distinct  /     28 rows  ( 0.4%)
--   unresolved / empty / Test:       0 distinct  /      0 rows
--   => 100% coverage; SET NOT NULL in PART B is safe.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ████████████████████████████████████████████████████████████████████████████
-- PART A  -  paste BEFORE the intranet code PR is merged + deployed
-- ████████████████████████████████████████████████████████████████████████████
-- ════════════════════════════════════════════════════════════════════════════
-- Adds the column NULLABLE and backfills existing rows. The DO-block at the
-- bottom guards against silent partial backfills but does NOT enforce the
-- column going forward — new writes from the still-running production code
-- continue to land with vendor_id = NULL, which is fine while the column is
-- nullable. The eventual NOT NULL + FK constraint lives in PART B.

-- ── Step A.1: add column (nullable) ────────────────────────────────────
ALTER TABLE ai_line_items ADD COLUMN IF NOT EXISTS vendor_id TEXT;

-- ── Step A.2: backfill existing rows ───────────────────────────────────
-- exact_match: lower(vendors.name) = lower(ai_line_items.vendor_name)
-- alias_match: vendor_aliases.alias_normalized matches normalized vendor_name,
--              for any row not already covered by exact_match.
-- DISTINCT ON (a.id) in alias_match defensively collapses any (vanishingly
-- unlikely) case where two vendors share an alias_normalized; chooses the
-- lower vendor_id deterministically. The probe confirmed there are no such
-- collisions in current prod data; the DISTINCT ON is belt-and-suspenders.

WITH exact_match AS (
  SELECT a.id AS row_id, v.id AS vendor_id
    FROM ai_line_items a
    JOIN vendors v ON lower(v.name) = lower(a.vendor_name)
   WHERE v.deleted_at IS NULL
),
alias_match AS (
  SELECT DISTINCT ON (a.id) a.id AS row_id, va.vendor_id
    FROM ai_line_items a
    JOIN vendor_aliases va
      ON va.alias_normalized = regexp_replace(lower(a.vendor_name), '[^a-z0-9 ]', '', 'g')
   WHERE a.id NOT IN (SELECT row_id FROM exact_match)
   ORDER BY a.id, va.vendor_id
),
all_resolved AS (
  SELECT row_id, vendor_id FROM exact_match
  UNION ALL
  SELECT row_id, vendor_id FROM alias_match
)
UPDATE ai_line_items
   SET vendor_id = all_resolved.vendor_id
  FROM all_resolved
 WHERE ai_line_items.id = all_resolved.row_id;

-- ── Step A.3: PART A guard ─────────────────────────────────────────────
-- RAISE if the backfill did not cover every existing row. PART A leaves
-- the column nullable on purpose; the guard here proves that the EXISTING
-- rows were all resolved, even though new writes from the still-running
-- production code will keep landing as NULL until PART B is pasted. (The
-- top-up UPDATE in PART B handles those gap-window rows.)

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM ai_line_items WHERE vendor_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      'PR 8.1 PART A: backfill incomplete -- % existing ai_line_items rows still have NULL vendor_id. '
      'Investigate unresolved vendor_names (check vendors + vendor_aliases tables) and re-run PART A. '
      'Do NOT paste PART B until this is zero.',
      n;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- STOP HERE.
--
-- Now:
--   1. Merge the intranet PR (this branch) so insertAILineItemsPostgres starts
--      populating vendor_id on new writes.
--   2. Wait for Vercel to redeploy.
--   3. Confirm new invoice uploads are landing with vendor_id populated
--      (spot-check a recent row: SELECT id, vendor_name, vendor_id FROM
--      ai_line_items WHERE is_historical = FALSE ORDER BY created_at DESC
--      LIMIT 5).
--   4. THEN paste PART B below.
--
-- Pasting PART B BEFORE the code is deployed will cause every new invoice
-- upload to fail with 23502 not-null violation. Don't.
-- ════════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════════
-- ████████████████████████████████████████████████████████████████████████████
-- PART B  -  paste AFTER the intranet code PR is merged + deployed
-- ████████████████████████████████████████████████████████████████████████████
-- ════════════════════════════════════════════════════════════════════════════
-- Catches any rows written during the gap window (PART A applied but new code
-- not yet deployed) by re-running the same exact + alias resolution scoped to
-- vendor_id IS NULL only. Then the DO-block re-confirms zero NULLs, then SET
-- NOT NULL + ADD FK + CREATE INDEX make the constraint self-enforcing.

-- ── Step B.1: top-up UPDATE for the gap window ─────────────────────────
-- Same CTE shape as PART A but scoped to NULL rows only. If the gap window
-- was empty (no invoice uploads between PART A and the code deploy), this
-- UPDATE is a no-op. If there were uploads, it resolves them with the same
-- algorithm the new code uses.

WITH exact_match AS (
  SELECT a.id AS row_id, v.id AS vendor_id
    FROM ai_line_items a
    JOIN vendors v ON lower(v.name) = lower(a.vendor_name)
   WHERE v.deleted_at IS NULL
     AND a.vendor_id IS NULL
),
alias_match AS (
  SELECT DISTINCT ON (a.id) a.id AS row_id, va.vendor_id
    FROM ai_line_items a
    JOIN vendor_aliases va
      ON va.alias_normalized = regexp_replace(lower(a.vendor_name), '[^a-z0-9 ]', '', 'g')
   WHERE a.vendor_id IS NULL
     AND a.id NOT IN (SELECT row_id FROM exact_match)
   ORDER BY a.id, va.vendor_id
),
all_resolved AS (
  SELECT row_id, vendor_id FROM exact_match
  UNION ALL
  SELECT row_id, vendor_id FROM alias_match
)
UPDATE ai_line_items
   SET vendor_id = all_resolved.vendor_id
  FROM all_resolved
 WHERE ai_line_items.id = all_resolved.row_id;

-- ── Step B.2: PART B guard ─────────────────────────────────────────────
-- RAISE if any rows still have NULL vendor_id after the top-up. This catches
-- the case where a vendor was OCR'd during the gap window for which no
-- vendors row + no vendor_aliases entry exists -- the new deployed code
-- would have thrown on those, so they should not appear, but if they do,
-- the migration aborts BEFORE SET NOT NULL and we keep nullable for
-- forensic review.

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM ai_line_items WHERE vendor_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION
      'PR 8.1 PART B: top-up incomplete -- % ai_line_items rows still have NULL vendor_id '
      'after the gap-window top-up. The deployed code should have thrown on any unresolvable '
      'vendor; investigate which vendor_names slipped through. SET NOT NULL aborted.',
      n;
  END IF;
END $$;

-- ── Step B.3: tighten + FK + index ─────────────────────────────────────
ALTER TABLE ai_line_items ALTER COLUMN vendor_id SET NOT NULL;
ALTER TABLE ai_line_items
  ADD CONSTRAINT ai_line_items_vendor_id_fkey
  FOREIGN KEY (vendor_id) REFERENCES vendors(id);
CREATE INDEX IF NOT EXISTS ai_line_items_vendor_idx
  ON ai_line_items (vendor_id);

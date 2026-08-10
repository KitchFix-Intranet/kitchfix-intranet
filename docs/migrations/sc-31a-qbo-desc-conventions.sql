-- ═══════════════════════════════════════════════════════════════════
-- sc-31a: QBO line-description conventions (PR-B2 follow-up to sc-31)
-- 2026-08-10
-- ═══════════════════════════════════════════════════════════════════
--
-- Owner ruling 2026-08-10 (retro-shadow round 1 finding A):
--   Builder emits `qbo_item_name` (not SC service_name) for
--   `plain_name` lines. The `qbo_item_name` field on sc_qbo_service_map
--   therefore carries Sebastian's typed invoice-line description
--   convention, NOT the QB item's registered `Name`. QBO's ItemRef is
--   resolved by `value` (id) at post time; `name` is a display hint
--   the API accepts as-is, so this is safe.
--
-- What sc-31 seeded vs. what the live CIN - AZ invoices carry
--   (probed 2026-08-10 against qbo_K300168899_cin_pair_0713_main.json
--    + qbo_K300168900_cin_pair_0713_rehab.json, live QBO fixtures):
--
--   service_id / item        sc-31 qbo_item_name           invoice desc
--   ─────────────────────    ───────────────────────       ────────────
--   5529584a... (3322 Snack) "REDS MiLB/MLB - Snack"       "Pre-Game Snack"
--   3e5ac4cb... (3371 Coff)  "REDS Coffee Service"         "Coffee Service"
--   d9e368ee... (3372 Foun)  "REDS Fountain Beverages"     "Fountain Beverages"
--   c667d4e5... (3327 CP)    "REDS Rehab - Meal Service"   "Continental Plus"
--
-- Retro-shadow round 1 on CIN - AZ pair 07-13..07-26 (2026-08-10):
--   Rehab slot K300168900 = 20/20 MATCH; main slot K300168899 = 24/27
--   matched, 0 orphans, 3 description-only diffs with matching Amount.
--   Two of the three (Fountain Bev 2026-07-13 + 2026-07-20) are the
--   qbo_item_name convention above; the third (2026-07-26 REDS MiLB -
--   Meal Service) is a real per-service data variance still awaiting
--   Sebastian's ruling and is out of scope for this migration.
--
-- What this migration does:
--   Four UPDATE statements on `sc_qbo_service_map`, each with the
--   matching NOT-EXISTS-guarded `sc_config_changelog` INSERT (change
--   type 'update' this time; sc-31 wrote 'create' rows). No table
--   shape changes. No CHECK swaps (sc-31 already unioned the two new
--   entity types). Idempotent: re-apply is a no-op because both the
--   UPDATE and the changelog INSERT self-check current state.
--
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. UPDATE the four affected mapping rows ─────────────────────
-- Each UPDATE is guarded by WHERE current-value != new-value so
-- re-apply is a no-op that touches zero rows.

UPDATE sc_qbo_service_map
   SET qbo_item_name = 'Pre-Game Snack',
       changed_at    = now()
 WHERE service_id = '5529584a-ab40-4cb6-81d1-ac30372c9978'
   AND account_key = 'CIN - AZ'
   AND qbo_item_name = 'REDS MiLB/MLB - Snack';

UPDATE sc_qbo_service_map
   SET qbo_item_name = 'Coffee Service',
       changed_at    = now()
 WHERE service_id = '3e5ac4cb-7391-46db-ae38-cb71435d4e03'
   AND account_key = 'CIN - AZ'
   AND qbo_item_name = 'REDS Coffee Service';

UPDATE sc_qbo_service_map
   SET qbo_item_name = 'Fountain Beverages',
       changed_at    = now()
 WHERE service_id = 'd9e368ee-916a-4f03-96f5-1079bb520cc7'
   AND account_key = 'CIN - AZ'
   AND qbo_item_name = 'REDS Fountain Beverages';

UPDATE sc_qbo_service_map
   SET qbo_item_name = 'Continental Plus',
       changed_at    = now()
 WHERE service_id = 'c667d4e5-db72-4e37-9da8-06342881e76f'
   AND account_key = 'CIN - AZ'
   AND qbo_item_name = 'REDS Rehab - Meal Service';

-- ─── 2. Changelog rows (C-1 lesson: every billing-config touch
--         writes a changelog entry) ──────────────────────────────
--
-- One INSERT per affected row, guarded so re-apply is a no-op. The
-- `old_value` captures the pre-change qbo_item_name for forensic
-- traceability; `new_value` holds the post-change value.
INSERT INTO sc_config_changelog
  (account_key, entity_type, entity_id, entity_label, change_type,
   old_value, new_value, effective_date, reason, changed_by)
SELECT
  'CIN - AZ',
  'qbo_service_map',
  '5529584a-ab40-4cb6-81d1-ac30372c9978'::uuid,
  'Pre-Game Snack',
  'update',
  jsonb_build_object('qbo_item_name', 'REDS MiLB/MLB - Snack'),
  jsonb_build_object('qbo_item_name', 'Pre-Game Snack'),
  CURRENT_DATE,
  'sc-31a: line-description convention (owner ruling 2026-08-10, retro-shadow round 1 finding A)',
  'sc-31a-desc-fix'
WHERE NOT EXISTS (
  SELECT 1 FROM sc_config_changelog c
  WHERE c.entity_type = 'qbo_service_map'
    AND c.entity_id   = '5529584a-ab40-4cb6-81d1-ac30372c9978'::uuid
    AND c.reason LIKE 'sc-31a:%'
);

INSERT INTO sc_config_changelog
  (account_key, entity_type, entity_id, entity_label, change_type,
   old_value, new_value, effective_date, reason, changed_by)
SELECT
  'CIN - AZ',
  'qbo_service_map',
  '3e5ac4cb-7391-46db-ae38-cb71435d4e03'::uuid,
  'Coffee Service',
  'update',
  jsonb_build_object('qbo_item_name', 'REDS Coffee Service'),
  jsonb_build_object('qbo_item_name', 'Coffee Service'),
  CURRENT_DATE,
  'sc-31a: line-description convention (owner ruling 2026-08-10, retro-shadow round 1 finding A)',
  'sc-31a-desc-fix'
WHERE NOT EXISTS (
  SELECT 1 FROM sc_config_changelog c
  WHERE c.entity_type = 'qbo_service_map'
    AND c.entity_id   = '3e5ac4cb-7391-46db-ae38-cb71435d4e03'::uuid
    AND c.reason LIKE 'sc-31a:%'
);

INSERT INTO sc_config_changelog
  (account_key, entity_type, entity_id, entity_label, change_type,
   old_value, new_value, effective_date, reason, changed_by)
SELECT
  'CIN - AZ',
  'qbo_service_map',
  'd9e368ee-916a-4f03-96f5-1079bb520cc7'::uuid,
  'Fountain Beverages',
  'update',
  jsonb_build_object('qbo_item_name', 'REDS Fountain Beverages'),
  jsonb_build_object('qbo_item_name', 'Fountain Beverages'),
  CURRENT_DATE,
  'sc-31a: line-description convention (owner ruling 2026-08-10, retro-shadow round 1 finding A)',
  'sc-31a-desc-fix'
WHERE NOT EXISTS (
  SELECT 1 FROM sc_config_changelog c
  WHERE c.entity_type = 'qbo_service_map'
    AND c.entity_id   = 'd9e368ee-916a-4f03-96f5-1079bb520cc7'::uuid
    AND c.reason LIKE 'sc-31a:%'
);

INSERT INTO sc_config_changelog
  (account_key, entity_type, entity_id, entity_label, change_type,
   old_value, new_value, effective_date, reason, changed_by)
SELECT
  'CIN - AZ',
  'qbo_service_map',
  'c667d4e5-db72-4e37-9da8-06342881e76f'::uuid,
  'Continental Plus',
  'update',
  jsonb_build_object('qbo_item_name', 'REDS Rehab - Meal Service'),
  jsonb_build_object('qbo_item_name', 'Continental Plus'),
  CURRENT_DATE,
  'sc-31a: line-description convention (owner ruling 2026-08-10, retro-shadow round 1 finding A)',
  'sc-31a-desc-fix'
WHERE NOT EXISTS (
  SELECT 1 FROM sc_config_changelog c
  WHERE c.entity_type = 'qbo_service_map'
    AND c.entity_id   = 'c667d4e5-db72-4e37-9da8-06342881e76f'::uuid
    AND c.reason LIKE 'sc-31a:%'
);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════

-- V1. Four mapping rows carry Sebastian's typed convention.
--
-- SELECT service_id, qbo_item_id, qbo_item_name
-- FROM sc_qbo_service_map
-- WHERE service_id IN (
--   '5529584a-ab40-4cb6-81d1-ac30372c9978',
--   '3e5ac4cb-7391-46db-ae38-cb71435d4e03',
--   'd9e368ee-916a-4f03-96f5-1079bb520cc7',
--   'c667d4e5-db72-4e37-9da8-06342881e76f'
-- )
-- ORDER BY qbo_item_id;
--
-- Expect:
--   3322  Pre-Game Snack
--   3327  Continental Plus
--   3371  Coffee Service
--   3372  Fountain Beverages

-- V2. Exactly four changelog rows with the sc-31a reason.
--
-- SELECT entity_id, entity_label, old_value->>'qbo_item_name' AS old_name,
--        new_value->>'qbo_item_name' AS new_name, changed_at
-- FROM sc_config_changelog
-- WHERE reason LIKE 'sc-31a:%'
-- ORDER BY changed_at;
--
-- Expect 4 rows, one per service_id above.

-- V3. Re-apply is a no-op. Running this file a second time in Studio
--     changes zero rows: the UPDATEs' WHERE guard on qbo_item_name
--     already-matching-new value skips; the INSERTs' NOT EXISTS on
--     'sc-31a:%' reason skips.

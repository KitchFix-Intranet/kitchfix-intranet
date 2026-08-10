-- ═══════════════════════════════════════════════════════════════════
-- sc-31: QBO mapping tables + pilot seeds (PR-B of the SC -> QBO
-- billing arc)
-- 2026-08-07
-- ═══════════════════════════════════════════════════════════════════
--
-- Spec authority: docs/SC_QBO_SHAPE_SPEC.md §5 (mapping tables) + §6
-- (data model). PR-B builds the pure invoice builder on top of these
-- tables. PR-C wires the adapter (sc-32).
--
-- Owner amendment 2026-08-06 (rules CIN - AZ bi-weekly pairs):
--   Pairs are PERIOD-ALIGNED (P.week1-2 and P.week3-4 of each fiscal
--   period), derived from `sc_day_metadata`'s fiscal calendar, NOT
--   from modular arithmetic on an anchor date. `biweekly_anchor`
--   below is kept as a NULLABLE REFERENCE COLUMN only.
--   Verified [ran] 2026-08-07: all 6 canonical closes
--   (2026-05-31, 06-14, 06-28, 07-12, 07-26, 08-09) land on Sun of
--   Week 2 or Week 4 of their period.
--   P13 (3 weeks) pairing is undefined: a bi-weekly build touching
--   P13 hard-fails with a named error (enforced in the builder,
--   src/lib/billing/buildInvoicePayload.js).
--
-- What this migration adds:
--   1. `sc_qbo_account_map` - SC account -> QB customer + tax code
--      + cadence + split reference.
--   2. `sc_qbo_service_map` - SC service_id -> QB item + aggregate
--      group + invoice slot + tax override.
--   3. `sc_config_changelog_entity_type_check` swap - adds the two
--      new entity types ('qbo_account_map', 'qbo_service_map') to
--      the existing CHECK constraint. First-run of sc-31 rolled
--      back cleanly because the seed changelog INSERTs failed the
--      original constraint (owner probed live 2026-08-10):
--          CHECK ((entity_type = ANY (ARRAY['price'::text,
--            'service'::text, 'group'::text, 'fee'::text,
--            'fun_money'::text, 'labor_ratio'::text])))
--      New CHECK is the union: the same 6 values plus our 2.
--      Idempotent (DROP IF EXISTS + re-add). Runs BEFORE the
--      changelog INSERTs in the same transaction so the seed rows
--      pass the new constraint on first apply.
--   4. Seed rows for the two pilot accounts (TXR - AZ + CIN - AZ),
--      each with a paired `sc_config_changelog` row per the C-1
--      lesson (every seed row that touches billing writes a
--      changelog entry; no bypass paths).
--   5. GRANTs mirroring sc-22 / sc-30.
--
-- Every service_id below was verified against live sc_services by
-- SELECT on 2026-08-07 (probe /tmp/prb_recon.mjs; never hand-typed).
-- QB item ids were confirmed by name via a live GET on the QBO
-- proxy same day.
--
-- sc_config_changelog schema VERIFIED LIVE (owner, 2026-08-10) after
-- two consecutive first-apply rollbacks against assumptions about
-- this same table:
--   Round 1: `entity_type` CHECK constraint scoped to 6 values;
--            our two new types rejected. Fixed by section 6 below.
--   Round 2: `entity_id` is UUID, not TEXT; the seed INSERTs cast
--            sm.service_id::text, so uuid = text at the guard.
-- Per SR-23 the second miss means the approach was wrong, not the
-- line. This amendment verifies EVERY changelog column reference
-- against the live column dump. Live shape (2026-08-10):
--   id             uuid            NOT NULL   (has DEFAULT; unset by us)
--   account_key    text            NOT NULL   (text literal / column)
--   entity_type    text            NOT NULL   (text literal; CHECK swap covers)
--   entity_id      uuid            NULL       (NULL for account_map,
--                                              service_id uuid for service_map)
--   entity_label   text            NULL       (text - account_key /
--                                              service_name)
--   change_type    text            NOT NULL   ('create' literal)
--   old_value      jsonb           NULL       (NULL for seeds)
--   new_value      jsonb           NULL       (jsonb_build_object)
--   effective_date date            NULL       (CURRENT_DATE)
--   reason         text            NOT NULL   ('sc-31 seed: ...' literal)
--   requested_by   text            NULL       (not set; defaults NULL)
--   changed_by     text            NOT NULL   ('sc-31-seed' literal)
--   changed_at     timestamptz     NOT NULL   (has DEFAULT; unset by us)
-- Every reference below now matches this dump exactly. If a third
-- rollback ever appears against this table, ask what other
-- structural assumption was carried unchecked - do not fix the
-- individual line.
--
-- ─── UNMAPPED SC services (report only, not seeded) ──────────────
--   TXR - AZ - Minor League / Extra Protein - Beef/Seafood     (f48beec1-2845-4b4e-a364-ff098ffcb0e9, is_flat_fee)
--   TXR - AZ - Minor League / Extra Protein - Chicken/Pork     (197337ed-401e-469b-9086-00ddcc78d8a7, is_flat_fee)
--   TXR - AZ - Major League / Extra Protein - Beef/Seafood     (cbb73f62-7c9c-45b3-9c45-f184c887ab35, is_flat_fee)
--   TXR - AZ - Major League / Extra Protein - Chicken/Pork     (c81067bd-163a-485c-8a86-cbcf65246341, is_flat_fee)
--
-- No matching QB item exists for TXR-AZ Extra Protein by name
-- (scanned via `SELECT * FROM Item WHERE Name LIKE 'TXR-AZ%'`).
-- Per prompt: "anything unmappable lands in the report as UNMAPPED,
-- not guessed." The builder throws on unmapped services (spec §4
-- hard-fail), so a finalize touching these rows will fail loudly.
-- Sebastian confirms mapping before PR-C ships.
--
-- Retroactive effect: ZERO on data. Seeds INSERT ON CONFLICT DO
-- NOTHING - re-apply is a no-op on the row set. Both tables start
-- empty except for the seeded rows.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. sc_qbo_account_map ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sc_qbo_account_map (
  account_key             TEXT PRIMARY KEY CHECK (
                            account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                          ),
  qbo_customer_id         TEXT NOT NULL,
  qbo_customer_name       TEXT NOT NULL,
  qbo_taxcode_id          TEXT NOT NULL,
  cadence                 TEXT NOT NULL CHECK (cadence IN ('weekly', 'biweekly')),

  -- Reference column only. Owner amendment 2026-08-06: bi-weekly
  -- pairs are period-aligned via sc_day_metadata; this date is NOT
  -- the input the builder consults. Kept because Sebastian ratified
  -- it verbally + it doubles as documentation of the first-seen
  -- close in the current season for a given cadence.
  biweekly_anchor         DATE,

  active                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 2. sc_qbo_service_map ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sc_qbo_service_map (
  service_id              UUID PRIMARY KEY,

  -- FK-shape reference. sc_services.id is the source of truth; a
  -- foreign key would fire on account archival cascade so we keep
  -- the relationship logical.
  account_key             TEXT NOT NULL,

  qbo_item_id             TEXT NOT NULL,
  qbo_item_name           TEXT NOT NULL,

  -- Optional grouping label. Services with the SAME aggregate_group
  -- AND identical cent-rounded rates MERGE into one invoice line
  -- per day, with a composed description. Differing rates within
  -- the same group SPLIT into separate lines (spec §4 rate guard).
  aggregate_group         TEXT,

  -- Invoice slot for split billing (spec §5 evidence: CIN - AZ
  -- emits two invoices per close - main + rehab).
  invoice_slot            TEXT NOT NULL DEFAULT 'main',

  -- Tax override. NULL = 'TAX' (default); explicit values ('NON')
  -- override at the line level. Used for is_tax_free services.
  tax_override            TEXT CHECK (tax_override IS NULL OR tax_override IN ('NON', 'TAX', 'ZERO')),

  -- Line description convention for solo mapped services (services
  -- with NO aggregate_group). Values:
  --   NULL         : no description on the invoice line (default;
  --                  matches TXR - AZ Regular Snack / Pre-Game Hot
  --                  Snack invoicing convention)
  --   'plain_name' : description = service_name (matches CIN - AZ
  --                  Snack / Coffee Service / Fountain Beverages
  --                  invoicing convention)
  -- Ignored for aggregate_group members (they always get the
  -- composed "Total =" or single-name description per spec §4).
  line_desc_style         TEXT CHECK (line_desc_style IS NULL OR line_desc_style IN ('plain_name')),

  active                  BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── 3. Indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sc_qbo_service_map_account
  ON sc_qbo_service_map (account_key)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_sc_qbo_service_map_group
  ON sc_qbo_service_map (account_key, aggregate_group)
  WHERE active = true AND aggregate_group IS NOT NULL;

-- ─── 4. Seeds - accounts ───────────────────────────────────────────
INSERT INTO sc_qbo_account_map
  (account_key, qbo_customer_id, qbo_customer_name, qbo_taxcode_id, cadence, biweekly_anchor)
VALUES
  ('TXR - AZ', '19000', 'Texas Rangers - Surprise, AZ',    '36', 'weekly',   NULL),
  ('CIN - AZ', '17752', 'Cincinnati Reds (Goodyear, AZ)',  '37', 'biweekly', '2026-05-31')
ON CONFLICT (account_key) DO NOTHING;

-- ─── 5. Seeds - services ───────────────────────────────────────────
--
-- TXR - AZ (9 mapped; 4 Extra Protein UNMAPPED per header note).
INSERT INTO sc_qbo_service_map
  (service_id,                              account_key, qbo_item_id, qbo_item_name,                                aggregate_group, invoice_slot, tax_override, line_desc_style)
VALUES
  -- MiLB B/L/D -> 3333 (aggregate)
  ('5d626ec9-2505-470f-abe6-d7f3168ddf8f', 'TXR - AZ',  '3333', 'TXR-AZ MiLB - Breakfast/Lunch/Dinner',        'txr-milb-bld',  'main', NULL, NULL),
  ('3ec66570-b1dd-4189-a9ff-a0f9aba47797', 'TXR - AZ',  '3333', 'TXR-AZ MiLB - Breakfast/Lunch/Dinner',        'txr-milb-bld',  'main', NULL, NULL),
  ('b6b449b7-04f3-4da8-ab21-81874fcb6b93', 'TXR - AZ',  '3333', 'TXR-AZ MiLB - Breakfast/Lunch/Dinner',        'txr-milb-bld',  'main', NULL, NULL),
  -- MiLB Continental Breakfast -> 3336 (own line, no desc per TXR - AZ convention)
  ('6871d41e-08a8-4603-92c4-ba399a3a3674', 'TXR - AZ',  '3336', 'TXR-AZ - Continental Breakfast',              NULL,            'main', NULL, NULL),
  -- MiLB Pre-Game Hot Snack -> 3337 (own line, no desc per TXR - AZ convention)
  ('e47abd8c-a866-4108-84c8-24685f8ea96a', 'TXR - AZ',  '3337', 'TXR-AZ - Pre-Game Hot Snack',                 NULL,            'main', NULL, NULL),
  -- MiLB Regular Snack -> 3338 (own line, no desc per TXR - AZ convention)
  ('b5b0d24b-1162-4a80-a546-42bb6231470d', 'TXR - AZ',  '3338', 'TXR-AZ - Regular Snack',                      NULL,            'main', NULL, NULL),
  -- ML B/L/D -> 3334 (aggregate)
  ('28aa24de-aaf3-49aa-957b-76b95e1a13b6', 'TXR - AZ',  '3334', 'TXR-AZ MLB - Breakfast/Lunch/Dinner',         'txr-mlb-bld',   'main', NULL, NULL),
  ('91cd69db-68c5-40ef-b45a-9200c071972d', 'TXR - AZ',  '3334', 'TXR-AZ MLB - Breakfast/Lunch/Dinner',         'txr-mlb-bld',   'main', NULL, NULL),
  ('3f591244-cb3d-49d1-9525-fddbc5979905', 'TXR - AZ',  '3334', 'TXR-AZ MLB - Breakfast/Lunch/Dinner',         'txr-mlb-bld',   'main', NULL, NULL),

-- CIN - AZ (13 mapped, full active set).
  -- MiLB B/L/D -> 3300 (aggregate)
  ('82fd6db3-35ec-4904-907d-5c52a74f625e', 'CIN - AZ',  '3300', 'REDS MiLB - Meal Service',                    'cin-milb-bld',  'main', NULL, NULL),
  ('ed628578-527c-4dc9-9f91-3b94efb72846', 'CIN - AZ',  '3300', 'REDS MiLB - Meal Service',                    'cin-milb-bld',  'main', NULL, NULL),
  ('54679d87-820a-4a04-ba9e-76c431fce90e', 'CIN - AZ',  '3300', 'REDS MiLB - Meal Service',                    'cin-milb-bld',  'main', NULL, NULL),
  -- MiLB Pre-Game Snack -> 3322 (own line, plain-name per CIN - AZ convention)
  ('5529584a-ab40-4cb6-81d1-ac30372c9978', 'CIN - AZ',  '3322', 'REDS MiLB/MLB - Snack',                       NULL,            'main', NULL, 'plain_name'),
  -- Coffee Service (FF TF) -> 3371, one line per week, tax NON (plain-name desc)
  ('3e5ac4cb-7391-46db-ae38-cb71435d4e03', 'CIN - AZ',  '3371', 'REDS Coffee Service',                         NULL,            'main', 'NON', 'plain_name'),
  -- Fountain Bev (FF TF) -> 3372, one line per week, tax NON (plain-name desc)
  ('d9e368ee-916a-4f03-96f5-1079bb520cc7', 'CIN - AZ',  '3372', 'REDS Fountain Beverages',                     NULL,            'main', 'NON', 'plain_name'),
  -- ML B/L/D -> 3302 (aggregate)
  ('1e5a337d-610b-4b7d-9154-3f8787e8ccf8', 'CIN - AZ',  '3302', 'REDS MLB - Meal Service',                     'cin-mlb-bld',   'main', NULL, NULL),
  ('b00eaf5a-0849-4e97-90bc-760afc320dd3', 'CIN - AZ',  '3302', 'REDS MLB - Meal Service',                     'cin-mlb-bld',   'main', NULL, NULL),
  ('6b8919dd-17ce-4e7b-87b9-6787b2220e2e', 'CIN - AZ',  '3302', 'REDS MLB - Meal Service',                     'cin-mlb-bld',   'main', NULL, NULL),
  -- Rehab B/L/D -> 3327 (aggregate, rehab slot)
  ('4f0cc3af-2fef-4f5a-8762-3f87c45de3a3', 'CIN - AZ',  '3327', 'REDS Rehab - Meal Service',                   'cin-rehab-meal','rehab', NULL, NULL),
  ('30efb290-f371-4f1a-8267-488f568ec08a', 'CIN - AZ',  '3327', 'REDS Rehab - Meal Service',                   'cin-rehab-meal','rehab', NULL, NULL),
  ('2b2be535-c41d-49a1-8519-6ac4dc06cdb9', 'CIN - AZ',  '3327', 'REDS Rehab - Meal Service',                   'cin-rehab-meal','rehab', NULL, NULL),
  -- Rehab Continental Plus -> 3327, NO group (6.36 rate keeps it on
  -- its own lines per prompt Step 1). Rate-guard invariant preserved.
  -- Plain-name desc per Rehab convention.
  ('c667d4e5-db72-4e37-9da8-06342881e76f', 'CIN - AZ',  '3327', 'REDS Rehab - Meal Service',                   NULL,            'rehab', NULL, 'plain_name')
ON CONFLICT (service_id) DO NOTHING;

-- ─── 6. sc_config_changelog_entity_type_check swap ─────────────────
--
-- The existing CHECK on `sc_config_changelog.entity_type` scopes
-- allowed values to a fixed set. First-apply of sc-31 rolled back
-- cleanly on 2026-08-10 because the seed changelog INSERTs below
-- carry two NEW entity types ('qbo_account_map', 'qbo_service_map')
-- that the CHECK rejected. Owner ran the live definition:
--
--   CHECK ((entity_type = ANY (ARRAY['price'::text, 'service'::text,
--     'group'::text, 'fee'::text, 'fun_money'::text,
--     'labor_ratio'::text])))
--
-- Six values. Ours are two new ones. Swap = drop + re-add with the
-- full 8-value list. IF EXISTS on the drop keeps re-apply safe.
-- The re-add is unconditional so the constraint name always points
-- at the same definition after the migration lands.
--
-- Runs BEFORE the seed changelog INSERTs (same transaction), so a
-- fresh apply sees the new CHECK when the INSERTs fire.
ALTER TABLE sc_config_changelog
  DROP CONSTRAINT IF EXISTS sc_config_changelog_entity_type_check;

ALTER TABLE sc_config_changelog
  ADD CONSTRAINT sc_config_changelog_entity_type_check
  CHECK (entity_type IN (
    'price',
    'service',
    'group',
    'fee',
    'fun_money',
    'labor_ratio',
    'qbo_account_map',
    'qbo_service_map'
  ));

-- ─── 7. Changelog rows for every seeded row (C-1 lesson) ───────────
--
-- The C-1 finding: CIN - OH fee escalation was applied to
-- `sc_fee_schedule` but NOT recorded in `sc_config_changelog`. The
-- lesson: every seed that touches billing writes a changelog entry.
-- These INSERTs fire even on re-apply because sc_config_changelog
-- is append-only by grant.
INSERT INTO sc_config_changelog
  (account_key, entity_type, entity_id, entity_label, change_type, old_value, new_value, effective_date, reason, changed_by)
SELECT
  am.account_key,
  'qbo_account_map',
  NULL,
  am.account_key,
  'create',
  NULL,
  jsonb_build_object(
    'qbo_customer_id',   am.qbo_customer_id,
    'qbo_customer_name', am.qbo_customer_name,
    'qbo_taxcode_id',    am.qbo_taxcode_id,
    'cadence',           am.cadence,
    'biweekly_anchor',   am.biweekly_anchor
  ),
  CURRENT_DATE,
  'sc-31 seed: pilot QBO account map (spec docs/SC_QBO_SHAPE_SPEC.md §5)',
  'sc-31-seed'
FROM sc_qbo_account_map am
WHERE am.account_key IN ('TXR - AZ', 'CIN - AZ')
  AND NOT EXISTS (
    SELECT 1 FROM sc_config_changelog c
    WHERE c.entity_type = 'qbo_account_map'
      AND c.account_key = am.account_key
      AND c.reason LIKE 'sc-31 seed:%'
  );

INSERT INTO sc_config_changelog
  (account_key, entity_type, entity_id, entity_label, change_type, old_value, new_value, effective_date, reason, changed_by)
SELECT
  sm.account_key,
  'qbo_service_map',
  sm.service_id,                         -- uuid -> uuid (entity_id is uuid, verified live 2026-08-10)
  s.service_name,
  'create',
  NULL,
  jsonb_build_object(
    'qbo_item_id',      sm.qbo_item_id,
    'qbo_item_name',    sm.qbo_item_name,
    'aggregate_group',  sm.aggregate_group,
    'invoice_slot',     sm.invoice_slot,
    'tax_override',     sm.tax_override
  ),
  CURRENT_DATE,
  'sc-31 seed: pilot QBO service map (spec docs/SC_QBO_SHAPE_SPEC.md §5)',
  'sc-31-seed'
FROM sc_qbo_service_map sm
JOIN sc_services s ON s.id = sm.service_id
WHERE sm.account_key IN ('TXR - AZ', 'CIN - AZ')
  AND NOT EXISTS (
    SELECT 1 FROM sc_config_changelog c
    WHERE c.entity_type = 'qbo_service_map'
      AND c.entity_id   = sm.service_id  -- uuid = uuid (was ::text; owner verified live 2026-08-10)
      AND c.reason LIKE 'sc-31 seed:%'
  );

-- ─── 8. GRANTs (sc-22 / sc-30 pattern) ─────────────────────────────
GRANT SELECT, INSERT, UPDATE ON sc_qbo_account_map TO service_role;
GRANT SELECT, INSERT, UPDATE ON sc_qbo_service_map TO service_role;
GRANT REFERENCES, TRIGGER    ON sc_qbo_account_map TO anon, authenticated;
GRANT REFERENCES, TRIGGER    ON sc_qbo_service_map TO anon, authenticated;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════
--
--   V E R I F Y   B L O C K   -   N O T   P A R T   O F   T H E
--                             M I G R A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════

-- V1. Tables + column shapes.
--
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('sc_qbo_account_map', 'sc_qbo_service_map')
-- ORDER BY table_name, ordinal_position;


-- V2. Account seed counts + shapes. Expected: 2 rows.
--
-- SELECT account_key, cadence, biweekly_anchor, qbo_customer_name, qbo_taxcode_id, active
-- FROM sc_qbo_account_map
-- ORDER BY account_key;


-- V3. Service seed counts. Expected: TXR - AZ = 9, CIN - AZ = 13.
--
-- SELECT account_key, COUNT(*) AS mapped_services
-- FROM sc_qbo_service_map
-- WHERE active = true
-- GROUP BY account_key
-- ORDER BY account_key;


-- V4. B1 acceptance: every seed row has a changelog row.
--     Expected: account_map = 2 rows, service_map = 22 rows,
--     total = 24 rows.
--
-- SELECT entity_type, COUNT(*) AS changelog_rows
-- FROM sc_config_changelog
-- WHERE reason LIKE 'sc-31 seed:%'
-- GROUP BY entity_type
-- ORDER BY entity_type;


-- V5. Aggregate groups per account (fixture reproducibility check).
--     Expected:
--       TXR - AZ  txr-milb-bld  3  (MiLB B/L/D)
--       TXR - AZ  txr-mlb-bld   3  (ML B/L/D)
--       CIN - AZ  cin-milb-bld  3  (MiLB B/L/D)
--       CIN - AZ  cin-mlb-bld   3  (ML B/L/D)
--       CIN - AZ  cin-rehab-meal 3 (Rehab B/L/D; Continental Plus is NULL group)
--
-- SELECT account_key, aggregate_group, COUNT(*) AS members
-- FROM sc_qbo_service_map
-- WHERE aggregate_group IS NOT NULL AND active = true
-- GROUP BY account_key, aggregate_group
-- ORDER BY account_key, aggregate_group;


-- V6. sc_config_changelog_entity_type_check now permits our 2 new
--     entity types + the pre-existing 6 (union = 8 values). This is
--     the amendment sc-31 landed after the first-apply rollback on
--     2026-08-10.
--     Expected pg_get_constraintdef output (exact whitespace may vary):
--       CHECK ((entity_type = ANY (ARRAY['price'::text,
--         'service'::text, 'group'::text, 'fee'::text,
--         'fun_money'::text, 'labor_ratio'::text,
--         'qbo_account_map'::text, 'qbo_service_map'::text])))
--
-- SELECT pg_get_constraintdef(c.oid) AS definition
-- FROM pg_constraint c
-- JOIN pg_class t ON t.oid = c.conrelid
-- WHERE t.relname = 'sc_config_changelog'
--   AND c.conname = 'sc_config_changelog_entity_type_check';

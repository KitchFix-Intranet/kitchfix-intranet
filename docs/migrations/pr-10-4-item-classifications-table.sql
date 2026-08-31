-- ============================================================================
-- pr-10-4: item_classifications table for Phase 3 purchasing analysis
-- ============================================================================
-- Phase 3 landing (2026-08-13). Adds a NEW table (item_classifications) to
-- persist the three-axis classification (quality / preparation / storage)
-- for distinct (vendor_id, normalized_description) pairs.
--
-- Populated in dev from a local JSON cache (~/dev/purchase-discovery-2026-08-12
-- /item_classifications.json). Bulk-loaded via a follow-up script AFTER Kevin
-- applies this migration.
--
-- Complies with Phase 2 hard rule 1 (no source column overwrite): this creates
-- a NEW table, does not touch ai_line_items.
--
-- DO NOT APPLY without Kevin approval. Migration is idempotent (CREATE ... IF
-- NOT EXISTS). Safe to re-apply.

BEGIN;

CREATE TABLE IF NOT EXISTS item_classifications (
  id                     serial PRIMARY KEY,
  normalized_description text        NOT NULL,
  vendor_id              text,                 -- disambiguates same-desc-at-multiple-vendors
  quality_axis           text        CHECK (quality_axis IN ('premium','commodity','neutral')),
  quality_confidence     int         CHECK (quality_confidence BETWEEN 0 AND 100),
  quality_reason         text,
  preparation_axis       text        CHECK (preparation_axis IN ('prefabricated','scratch-input','neutral')),
  preparation_confidence int         CHECK (preparation_confidence BETWEEN 0 AND 100),
  preparation_reason     text,
  storage_axis           text        CHECK (storage_axis IN ('frozen','fresh','shelf-stable','unknown')),
  storage_confidence     int         CHECK (storage_confidence BETWEEN 0 AND 100),
  storage_reason         text,
  classified_at          timestamptz NOT NULL DEFAULT now(),
  model_used             text,
  UNIQUE (normalized_description, vendor_id)
);

CREATE INDEX IF NOT EXISTS item_classifications_desc_idx
  ON item_classifications (normalized_description);

CREATE INDEX IF NOT EXISTS item_classifications_vendor_idx
  ON item_classifications (vendor_id);

COMMENT ON TABLE  item_classifications                   IS 'Phase 3 (pr-10-4). Three-axis classification of distinct purchase-line-item descriptions.';
COMMENT ON COLUMN item_classifications.normalized_description IS 'Trimmed uppercase description used as classification key.';
COMMENT ON COLUMN item_classifications.vendor_id             IS 'Optional. Null when classification is vendor-independent; set when vendor-specific.';
COMMENT ON COLUMN item_classifications.quality_axis          IS 'premium | commodity | neutral';
COMMENT ON COLUMN item_classifications.quality_confidence    IS '0-100. Rows below 70 excluded from headline pct.';
COMMENT ON COLUMN item_classifications.quality_reason        IS 'Short auditability string from the classifier.';
COMMENT ON COLUMN item_classifications.preparation_axis      IS 'prefabricated | scratch-input | neutral';
COMMENT ON COLUMN item_classifications.storage_axis          IS 'frozen | fresh | shelf-stable | unknown';
COMMENT ON COLUMN item_classifications.model_used            IS 'e.g. claude-sonnet-4-6.';

-- Post-check
DO $$
DECLARE ok bool;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'item_classifications' AND column_name = 'quality_axis'
  ) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'pr-10-4: item_classifications.quality_axis missing after migration';
  END IF;
  RAISE NOTICE 'pr-10-4: table + columns present';
END $$;

COMMIT;

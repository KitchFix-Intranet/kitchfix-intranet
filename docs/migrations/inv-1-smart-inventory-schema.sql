-- ═══════════════════════════════════════════════════════════════
-- INV-1 (DRAFT) — Module 7 Smart Inventory PG schema
-- ═══════════════════════════════════════════════════════════════
--
-- DRAFT FILE. PENDING REVIEW. NOT YET APPLIED TO ANY DATABASE.
-- Do not run this file against production or any preview branch.
-- Adapters are not wired; the cron is not yet updated.
--
-- Source spec: docs/MODULE_7_DATA_AUDIT.md (PR #113) Part 3 resolved
-- decisions D1-D10. Every design choice below traces to a specific
-- audit decision; see the inline comments.
--
-- Eight core tables plus the merge_history_items junction:
--   inventory_items       (renamed from item_catalog)
--   item_aliases
--   storage_locations
--   count_sessions
--   count_items
--   price_history
--   review_queue
--   merge_history
--   merge_history_items   (junction; replaces JSON arrays per D3)
--
-- zone_corrections is dropped from INV-1 per the resolved investigation
-- (vestigial: 0 rows, one write site, no reader).
--
-- RLS posture: tables are built RLS-ready (canonical account on every
-- table) but RLS is DISABLED per D1 (parked). Policies ship in a
-- separate pre-go-live PR.
--
-- File is idempotent (IF NOT EXISTS / CREATE OR REPLACE) so re-running
-- after schema iterations is safe.
--
-- Prerequisite: pgcrypto for gen_random_uuid(). Already enabled by
-- prior module migrations; the guard is here for safety.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────
-- ENUM TYPES
-- ─────────────────────────────────────────────────────────────
-- DO blocks let CREATE TYPE be idempotent (CREATE TYPE has no IF NOT
-- EXISTS form in current PG).

DO $$ BEGIN
  CREATE TYPE inventory_item_status AS ENUM ('active', 'archived', 'excluded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE inventory_alias_source AS ENUM ('manual', 'ocr_learned', 'merge', 'item_review', 'ai_cron');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE count_session_status AS ENUM ('draft', 'submitted', 'corrected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE price_history_source AS ENUM ('manual_add', 'manual_verify', 'invoice_ocr', 'merge');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE review_queue_status AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE review_queue_reason AS ENUM (
    'arithmetic_fail',
    'low_match_confidence',
    'possible_new',
    'overcount_suspect_reextract'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE merge_history_action AS ENUM ('merge', 'keep_separate', 'link', 'exclude');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE merge_history_item_role AS ENUM ('keeper', 'merged');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────
-- Account-key canonical CHECK constraint shape
-- ─────────────────────────────────────────────────────────────
-- Matches the regex enforced on vendor_accounts.account_key (PR 5.1)
-- so a single canonical form covers vendors + invoices + inventory.
-- D6 retires accountMatch; this CHECK is what makes that safe.
-- Pattern: 'CIN - OH' | 'STL - MO' | 'TXR - TX - H' | 'CORP' | etc.
-- Backfill (INV-3) normalizes the one stray full-form row
-- ('STL - MO - St Louis Cardinals') to canonical short form before
-- this constraint can fire.

-- ═══════════════════════════════════════════════════════════════
-- 1. inventory_items  (renamed from item_catalog; T1, D2, D5, D6, D7)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inventory_items (
  -- TEXT PK matches the live Sheets ID format ('item_<uuid>') so the
  -- same ID flows through dual-write. Vendors uses the same pattern.
  id                  TEXT PRIMARY KEY,

  -- D6: canonical short-form, enforced by CHECK.
  account             TEXT NOT NULL CHECK (
                        account ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                        OR account = 'CORP'
                      ),

  name                TEXT NOT NULL,
  category            TEXT,                 -- normalized to bootstrap's 5-bucket scheme by the app for now; promote to enum later if useful
  unit                TEXT,

  -- Soft FK; ON DELETE SET NULL so deactivating a zone does not delete the item.
  location_id         TEXT REFERENCES storage_locations(id) ON DELETE SET NULL,

  -- D2: canonical vendor identity. Matches invoice_submissions.vendor_id.
  -- Backfill (INV-3) resolves all 34 freeform strings: 29 exact,
  -- 3 via vendor_aliases, 'Samuels Seafoos' gets a fresh alias,
  -- 'Test Vendor' rows are skipped (dev artifact).
  vendor_id           TEXT NOT NULL REFERENCES vendors(id),

  -- "Most recent price snapshot" cache for bootstrap; populated on write
  -- by handleVerifyPrice / handleAddItem / cron promotion. Authoritative
  -- ledger is price_history. (Keep as stored for read-path simplicity;
  -- the audit did not push these to view-derived.)
  last_price          NUMERIC,
  last_price_date     DATE,
  last_price_vendor   TEXT,                 -- display name; FK NOT applied because last vendor may differ from primary

  -- D5: priceAtLastCount column DROPPED. Read-time derive from
  -- count_items via the v_inventory_items_with_price_at_last_count view.

  -- D7: status enum replaces the legacy active boolean + status string pair.
  status              inventory_item_status NOT NULL DEFAULT 'active',

  -- D7: separate updated_at TIMESTAMPTZ. This is the column the cron
  -- writes its "row touched" timestamp into (was leaking into col Q
  -- of the Sheet today, the dual-meaning bug).
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  linked_to_invoice   BOOLEAN NOT NULL DEFAULT false,
  is_variety_group    BOOLEAN NOT NULL DEFAULT false,

  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  notes               TEXT,
  last_verified       TIMESTAMPTZ
);

-- Hot read path: active items per account.
CREATE INDEX IF NOT EXISTS inventory_items_account_active_idx
  ON inventory_items (account)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS inventory_items_vendor_idx
  ON inventory_items (vendor_id);

CREATE INDEX IF NOT EXISTS inventory_items_location_idx
  ON inventory_items (location_id);

CREATE INDEX IF NOT EXISTS inventory_items_name_lower_idx
  ON inventory_items (lower(name))
  WHERE status = 'active';

-- ═══════════════════════════════════════════════════════════════
-- 2. item_aliases  (T2, D4)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS item_aliases (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  item_id             TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  alias_text          TEXT NOT NULL,

  -- Mirrors vendor_aliases pattern: GENERATED STORED keeps the
  -- normalized form in sync and lets the UNIQUE constraint enforce
  -- per-item dedup at the database level.
  alias_normalized    TEXT GENERATED ALWAYS AS (
                        lower(regexp_replace(alias_text, '[^a-zA-Z0-9 ]', '', 'g'))
                      ) STORED,

  -- Nullable: alias may have been learned without a specific vendor
  -- attached (manual catalog edit, AI similarity check).
  vendor_id           TEXT REFERENCES vendors(id),

  confidence          INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),

  -- D4: BOTH columns retained. 408 of 6,585 rows in the live data
  -- have learned_by != source; backfill must preserve that distinction.
  learned_by          TEXT,
  source              inventory_alias_source NOT NULL DEFAULT 'manual',

  learned_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (item_id, alias_normalized)
);

CREATE INDEX IF NOT EXISTS item_aliases_alias_idx
  ON item_aliases (alias_normalized);

CREATE INDEX IF NOT EXISTS item_aliases_vendor_idx
  ON item_aliases (vendor_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. storage_locations  (T3)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS storage_locations (
  id                  TEXT PRIMARY KEY,                     -- 'loc_<uuid>'

  account             TEXT NOT NULL CHECK (
                        account ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                        OR account = 'CORP'
                      ),

  name                TEXT NOT NULL,
  icon                TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,

  -- Self-FK for sub-zones. SET NULL on parent delete so sub-zones
  -- orphan up to the account root rather than cascade-vanishing.
  parent_location_id  TEXT REFERENCES storage_locations(id) ON DELETE SET NULL,

  color               TEXT,

  active              BOOLEAN NOT NULL DEFAULT true,        -- locations use a simple boolean; archived/excluded apply to items only
  created_by          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()

  -- Reserved cols 6-7 of the Sheets schema dropped per T3.
);

CREATE INDEX IF NOT EXISTS storage_locations_account_idx
  ON storage_locations (account)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS storage_locations_parent_idx
  ON storage_locations (parent_location_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. count_sessions  (T4, D7 Option B)
-- ═══════════════════════════════════════════════════════════════
-- No stored totals (D7 Option B). All 6 totals (5 categories +
-- grand_total) live in v_count_session_totals and aggregate from
-- count_items at read time.

CREATE TABLE IF NOT EXISTS count_sessions (
  id                  TEXT PRIMARY KEY,                     -- 'inv_<uuid>'

  account             TEXT NOT NULL CHECK (
                        account ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                        OR account = 'CORP'
                      ),

  -- TEXT for now; HUB periods are not yet in PG (T4 dependency note).
  -- Promotion to FK happens when HUB migrates.
  period              TEXT NOT NULL,

  started_by          TEXT NOT NULL,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  status              count_session_status NOT NULL DEFAULT 'draft',

  -- Populated only on the draft -> submitted transition.
  submitted_by        TEXT,
  submitted_at        TIMESTAMPTZ,

  -- A submitted/corrected session must have both submitted_by + submitted_at.
  CONSTRAINT chk_submitted_metadata CHECK (
    (status = 'draft' AND submitted_by IS NULL AND submitted_at IS NULL)
    OR (status IN ('submitted', 'corrected') AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS count_sessions_account_status_idx
  ON count_sessions (account, status, submitted_at DESC NULLS LAST);

-- ═══════════════════════════════════════════════════════════════
-- 5. count_items  (T5, D7)
-- ═══════════════════════════════════════════════════════════════
-- Append-only ledger. Replay by latest location_save_id per
-- (session_id, location_id) gives "current state of this zone in
-- this session" (see v_current_count_state).

CREATE TABLE IF NOT EXISTS count_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  session_id          TEXT NOT NULL REFERENCES count_sessions(id) ON DELETE CASCADE,

  -- Append-batch key. All rows in a single handleCountSave call share
  -- this id. Latest-save-id-per-(session,location) wins on read.
  location_save_id    TEXT NOT NULL,

  item_id             TEXT NOT NULL REFERENCES inventory_items(id),
  location_id         TEXT REFERENCES storage_locations(id),

  quantity            NUMERIC NOT NULL DEFAULT 0,
  unit                TEXT,
  price_at_count      NUMERIC,

  -- D7: generated. Eliminates the drift the Sheets pattern allowed.
  extended_price      NUMERIC GENERATED ALWAYS AS (quantity * price_at_count) STORED,

  -- D7: preserve the "deliberately zero" distinction from "missing count".
  none_on_hand        BOOLEAN NOT NULL DEFAULT false,

  saved_by            TEXT NOT NULL,
  saved_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Cross-check: if none_on_hand is true, quantity must be 0.
  CONSTRAINT chk_none_on_hand_zero CHECK (
    none_on_hand = false OR quantity = 0
  )
);

-- Powers the current-count window per D7 Option B (the totals view
-- aggregates count_items in this index-friendly shape).
CREATE INDEX IF NOT EXISTS count_items_session_idx
  ON count_items (session_id);

CREATE INDEX IF NOT EXISTS count_items_session_location_save_idx
  ON count_items (session_id, location_id, saved_at DESC);

CREATE INDEX IF NOT EXISTS count_items_item_idx
  ON count_items (item_id);

-- ═══════════════════════════════════════════════════════════════
-- 6. price_history  (T6, D2, D7, P8)
-- ═══════════════════════════════════════════════════════════════
-- Append-only authoritative ledger. Cron writes via ON CONFLICT.

CREATE TABLE IF NOT EXISTS price_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  item_id             TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,

  account             TEXT NOT NULL CHECK (
                        account ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                        OR account = 'CORP'
                      ),

  vendor_id           TEXT NOT NULL REFERENCES vendors(id),

  price               NUMERIC NOT NULL,
  effective_date      DATE NOT NULL,

  -- P8: clean FK to canonical invoice when this price came from an
  -- invoice OCR. NULL for manual sources. Backfill resolves client_uuid
  -- -> invoice_submissions.id for the cron-sourced rows.
  invoice_id          UUID REFERENCES invoice_submissions(id),

  -- Cron-side dedup key (the legacy "sourceOrInvoiceId" string).
  -- Stays as TEXT because manual sources used to write things like
  -- "manual-add" too. UNIQUE (item_id, source_or_invoice_id) below
  -- moves the cron's JS Set dedup into the DB (D7).
  source_or_invoice_id  TEXT NOT NULL,

  source              price_history_source NOT NULL,

  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by         TEXT,

  -- D7: cron idempotency moves to the DB. INSERT ... ON CONFLICT
  -- (item_id, source_or_invoice_id) DO NOTHING is the new write
  -- pattern (replaces cron's processedInvoices JS Set).
  UNIQUE (item_id, source_or_invoice_id)
);

CREATE INDEX IF NOT EXISTS price_history_item_recorded_idx
  ON price_history (item_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS price_history_item_account_recorded_idx
  ON price_history (item_id, account, recorded_at DESC);

CREATE INDEX IF NOT EXISTS price_history_invoice_idx
  ON price_history (invoice_id);

CREATE INDEX IF NOT EXISTS price_history_vendor_idx
  ON price_history (vendor_id);

-- ═══════════════════════════════════════════════════════════════
-- 7. review_queue  (T7, D9)
-- ═══════════════════════════════════════════════════════════════
-- Schema models the resolver target even though the resolver UI is
-- deferred (D9). The cron + backfill scripts are the active writers.

CREATE TABLE IF NOT EXISTS review_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  account             TEXT NOT NULL CHECK (
                        account ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                        OR account = 'CORP'
                      ),

  -- Nullable: a queue row may be about a specific catalog item (resolver
  -- pre-loaded) or a fresh line-item awaiting catalog match.
  item_id             TEXT REFERENCES inventory_items(id),

  line_item_text      TEXT NOT NULL,
  vendor              TEXT,                                  -- display string; canonical vendor flows in via invoice_id

  -- FK to canonical invoice. Backfill maps the legacy
  -- col-D (client_uuid) -> invoice_submissions.id.
  invoice_id          UUID REFERENCES invoice_submissions(id),
  invoice_date        DATE,

  suggested_match_id    TEXT REFERENCES inventory_items(id),
  suggested_match_name  TEXT,
  confidence            INTEGER CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 100),

  status              review_queue_status NOT NULL DEFAULT 'pending',

  -- Decision-metadata: populated by the resolver UI (deferred, D9).
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMPTZ,
  result_item_id      TEXT REFERENCES inventory_items(id),

  reason              review_queue_reason NOT NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_queue_account_status_idx
  ON review_queue (account, status, created_at DESC);

CREATE INDEX IF NOT EXISTS review_queue_account_reason_idx
  ON review_queue (account, reason)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS review_queue_invoice_idx
  ON review_queue (invoice_id);

-- ═══════════════════════════════════════════════════════════════
-- 8. merge_history  (T8, D3)
-- ═══════════════════════════════════════════════════════════════
-- Header row per merge decision. The list of involved items moves
-- to the merge_history_items junction (D3, replaces JSON arrays).

CREATE TABLE IF NOT EXISTS merge_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  account             TEXT NOT NULL CHECK (
                        account ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                        OR account = 'CORP'
                      ),

  -- Nullable for keep_separate (no keeper exists).
  keeper_item_id      TEXT REFERENCES inventory_items(id),
  canonical_name      TEXT,

  action              merge_history_action NOT NULL,

  reason              TEXT,                                  -- populated by review_delete + free-form notes
  email               TEXT NOT NULL,

  -- Optional grouping key for AI similarity batches (existing field).
  ai_group_id         TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merge_history_account_action_idx
  ON merge_history (account, action, created_at DESC);

CREATE INDEX IF NOT EXISTS merge_history_keeper_idx
  ON merge_history (keeper_item_id);

-- ═══════════════════════════════════════════════════════════════
-- 9. merge_history_items  (junction, D3)
-- ═══════════════════════════════════════════════════════════════
-- One row per item involved in a merge decision. Replaces the legacy
-- mergedItemIds + mergedNames JSON arrays. Enables clean queries like
-- "what merges ever touched this item" without JSON parsing, and the
-- cron's "excluded names" filter becomes a join.

CREATE TABLE IF NOT EXISTS merge_history_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  merge_id            UUID NOT NULL REFERENCES merge_history(id) ON DELETE CASCADE,

  -- Nullable: the item row may have been hard-deleted from
  -- inventory_items if a legacy cleanup happened. item_name is the
  -- snapshot at merge time so AI training corpus stays usable.
  item_id             TEXT REFERENCES inventory_items(id),
  item_name           TEXT NOT NULL,

  role                merge_history_item_role NOT NULL,

  -- Prevent the same (merge, item) being recorded twice.
  UNIQUE (merge_id, item_id)
);

CREATE INDEX IF NOT EXISTS merge_history_items_item_idx
  ON merge_history_items (item_id);

CREATE INDEX IF NOT EXISTS merge_history_items_role_idx
  ON merge_history_items (role);

-- ═══════════════════════════════════════════════════════════════
-- merge_inventory_items()  stored proc (D7/P4)
-- ═══════════════════════════════════════════════════════════════
-- Atomic transaction wrapping the merge sequence. Mirrors the live
-- merge_vendors() pattern from pr-5-3-vendor-merge-function.sql.
--
--   Inputs:
--     p_keeper_id      TEXT     the item to keep
--     p_dupe_ids       TEXT[]   items to merge into keeper
--     p_canonical_name TEXT     new name for the keeper (NULL = keep current)
--     p_email          TEXT     actor for audit
--
--   Side effects (all-or-nothing inside one PL/pgSQL function):
--     1. Optional: rename the keeper if p_canonical_name supplied.
--     2. Reassign item_aliases.item_id from each dupe to keeper
--        (ON CONFLICT (item_id, alias_normalized) DO NOTHING so a
--        keeper-already-has-this-alias case is harmless).
--     3. Reassign price_history.item_id from each dupe to keeper.
--        (ON CONFLICT (item_id, source_or_invoice_id) DO NOTHING in
--        case the keeper already saw the same invoice.)
--     4. Soft-delete the dupes: status='archived', updated_at=now().
--     5. Insert merge_history row.
--     6. Insert merge_history_items rows (keeper + every dupe).
--
--   Returns JSON: { merge_id, aliases_reassigned, prices_reassigned,
--                   dupes_archived }

CREATE OR REPLACE FUNCTION merge_inventory_items(
  p_keeper_id       text,
  p_dupe_ids        text[],
  p_canonical_name  text,
  p_email           text
) RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_merge_id              uuid;
  v_keeper                inventory_items%ROWTYPE;
  v_account               text;
  v_aliases_reassigned    int := 0;
  v_prices_reassigned     int := 0;
  v_dupes_archived        int := 0;
  v_dupe_id               text;
  v_dupe_row              inventory_items%ROWTYPE;
BEGIN
  -- Validate keeper.
  SELECT * INTO v_keeper FROM inventory_items WHERE id = p_keeper_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_inventory_items: keeper % not found', p_keeper_id;
  END IF;
  IF v_keeper.status <> 'active' THEN
    RAISE EXCEPTION 'merge_inventory_items: keeper % is not active (status=%)', p_keeper_id, v_keeper.status;
  END IF;
  v_account := v_keeper.account;

  -- 1. Optional rename.
  IF p_canonical_name IS NOT NULL AND p_canonical_name <> v_keeper.name THEN
    UPDATE inventory_items
       SET name = p_canonical_name,
           updated_at = now()
     WHERE id = p_keeper_id;
  END IF;

  -- 2. Reassign aliases.
  WITH reassigned AS (
    UPDATE item_aliases
       SET item_id = p_keeper_id
     WHERE item_id = ANY(p_dupe_ids)
       AND NOT EXISTS (
         SELECT 1 FROM item_aliases existing
          WHERE existing.item_id = p_keeper_id
            AND existing.alias_normalized = item_aliases.alias_normalized
       )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_aliases_reassigned FROM reassigned;

  -- Drop any leftover dupe-alias rows whose normalized form already
  -- exists on the keeper (preserve UNIQUE invariant).
  DELETE FROM item_aliases WHERE item_id = ANY(p_dupe_ids);

  -- 3. Reassign price_history.
  WITH reassigned AS (
    UPDATE price_history
       SET item_id = p_keeper_id
     WHERE item_id = ANY(p_dupe_ids)
       AND NOT EXISTS (
         SELECT 1 FROM price_history existing
          WHERE existing.item_id = p_keeper_id
            AND existing.source_or_invoice_id = price_history.source_or_invoice_id
       )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_prices_reassigned FROM reassigned;

  DELETE FROM price_history WHERE item_id = ANY(p_dupe_ids);

  -- 4. Soft-delete dupes.
  WITH archived AS (
    UPDATE inventory_items
       SET status = 'archived',
           updated_at = now()
     WHERE id = ANY(p_dupe_ids)
       AND status <> 'archived'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_dupes_archived FROM archived;

  -- 5. Header row.
  INSERT INTO merge_history (
    account, keeper_item_id, canonical_name, action, email
  ) VALUES (
    v_account, p_keeper_id, COALESCE(p_canonical_name, v_keeper.name), 'merge', p_email
  ) RETURNING id INTO v_merge_id;

  -- 6. Junction rows.
  INSERT INTO merge_history_items (merge_id, item_id, item_name, role)
  VALUES (v_merge_id, p_keeper_id, COALESCE(p_canonical_name, v_keeper.name), 'keeper');

  FOREACH v_dupe_id IN ARRAY p_dupe_ids LOOP
    SELECT * INTO v_dupe_row FROM inventory_items WHERE id = v_dupe_id;
    IF FOUND THEN
      INSERT INTO merge_history_items (merge_id, item_id, item_name, role)
      VALUES (v_merge_id, v_dupe_id, v_dupe_row.name, 'merged');
    END IF;
  END LOOP;

  RETURN json_build_object(
    'merge_id',             v_merge_id,
    'aliases_reassigned',   v_aliases_reassigned,
    'prices_reassigned',    v_prices_reassigned,
    'dupes_archived',       v_dupes_archived
  );
END $$;

-- ═══════════════════════════════════════════════════════════════
-- VIEWS for bootstrap derivations (D8, mechanical only)
-- ═══════════════════════════════════════════════════════════════
-- All views are non-materialized. D8 explicitly rejects materialized
-- views unless a real read-latency problem appears.

-- v_current_count_state: latest (location_save_id, saved_at) per
-- (session, location). Used to filter count_items down to the
-- "current state" of each zone in a session.
CREATE OR REPLACE VIEW v_current_count_state AS
SELECT DISTINCT ON (session_id, location_id)
  session_id,
  location_id,
  location_save_id,
  saved_at
FROM count_items
ORDER BY session_id, location_id, saved_at DESC;

-- v_current_count_items: count_items joined to v_current_count_state.
-- This is the projection chefs and the bootstrap care about.
CREATE OR REPLACE VIEW v_current_count_items AS
SELECT ci.*
FROM count_items ci
JOIN v_current_count_state cs
  ON cs.session_id       = ci.session_id
 AND cs.location_id      IS NOT DISTINCT FROM ci.location_id
 AND cs.location_save_id = ci.location_save_id;

-- v_count_session_totals: D7 Option B. The 5 category totals + grand
-- total derived from count_items joined to inventory_items.category.
-- Replaces handleCountSubmit's app-side aggregation. Note: category
-- bucket names ('Food', 'Packaging', 'Supplies', 'Snacks', 'Beverages')
-- match the existing app contract; reclassification happens in app
-- code via the catMap (inventory_items.category is the source of truth).
CREATE OR REPLACE VIEW v_count_session_totals AS
SELECT
  s.id AS session_id,
  COALESCE(SUM(ci.extended_price) FILTER (WHERE ii.category = 'Food'),       0) AS total_food,
  COALESCE(SUM(ci.extended_price) FILTER (WHERE ii.category = 'Packaging'),  0) AS total_packaging,
  COALESCE(SUM(ci.extended_price) FILTER (WHERE ii.category = 'Supplies'),   0) AS total_supplies,
  COALESCE(SUM(ci.extended_price) FILTER (WHERE ii.category = 'Snacks'),     0) AS total_snacks,
  COALESCE(SUM(ci.extended_price) FILTER (WHERE ii.category = 'Beverages'),  0) AS total_beverages,
  COALESCE(SUM(ci.extended_price),                                           0) AS grand_total
FROM count_sessions s
LEFT JOIN v_current_count_items ci ON ci.session_id = s.id
LEFT JOIN inventory_items       ii ON ii.id = ci.item_id
GROUP BY s.id;

-- v_price_history_ranked: per-item-per-account ranked history with
-- the immediately-prior price exposed via LAG(). Foundation for
-- v_price_movers and any "what was the prior price" lookup.
CREATE OR REPLACE VIEW v_price_history_ranked AS
SELECT
  ph.*,
  ROW_NUMBER() OVER (PARTITION BY item_id, account ORDER BY recorded_at DESC, effective_date DESC) AS rn,
  LAG(price)   OVER (PARTITION BY item_id, account ORDER BY recorded_at ASC,  effective_date ASC ) AS prior_price
FROM price_history ph;

-- v_price_movers: the bootstrap's "Top Movers" panel. >=5% change
-- between current and immediately-prior price, per item per account.
-- Bootstrap query slices to top 10 by abs(change).
CREATE OR REPLACE VIEW v_price_movers AS
SELECT
  rh.item_id,
  rh.account,
  rh.vendor_id,
  rh.price          AS current_price,
  rh.prior_price,
  (rh.price - rh.prior_price)                                       AS change,
  ROUND((((rh.price - rh.prior_price) / rh.prior_price) * 100)::numeric, 1) AS pct_change,
  CASE WHEN rh.price > rh.prior_price THEN 'up' ELSE 'down' END     AS direction
FROM v_price_history_ranked rh
WHERE rh.rn = 1
  AND rh.prior_price IS NOT NULL
  AND rh.prior_price <> 0
  AND ABS(((rh.price - rh.prior_price) / rh.prior_price) * 100) >= 5;

-- v_inventory_items_with_price_at_last_count: D5. priceAtLastCount
-- is gone from inventory_items; this view derives it from the most
-- recent submitted/corrected session's count_items row for each item.
CREATE OR REPLACE VIEW v_inventory_items_with_price_at_last_count AS
SELECT
  ii.*,
  (
    SELECT ci.price_at_count
      FROM count_items ci
      JOIN count_sessions cs ON cs.id = ci.session_id
     WHERE ci.item_id  = ii.id
       AND cs.status   IN ('submitted', 'corrected')
     ORDER BY cs.submitted_at DESC NULLS LAST, ci.saved_at DESC
     LIMIT 1
  ) AS price_at_last_count
FROM inventory_items ii;

-- ═══════════════════════════════════════════════════════════════
-- RLS posture: PARKED per D1
-- ═══════════════════════════════════════════════════════════════
-- Tables are RLS-ready (canonical account on every table) but RLS
-- itself stays off until a dedicated pre-go-live PR. Match the vendor
-- + invoice schema posture (DISABLE explicitly so the file is self-
-- describing and survives DROP/CREATE iterations).

ALTER TABLE inventory_items      DISABLE ROW LEVEL SECURITY;
ALTER TABLE item_aliases         DISABLE ROW LEVEL SECURITY;
ALTER TABLE storage_locations    DISABLE ROW LEVEL SECURITY;
ALTER TABLE count_sessions       DISABLE ROW LEVEL SECURITY;
ALTER TABLE count_items          DISABLE ROW LEVEL SECURITY;
ALTER TABLE price_history        DISABLE ROW LEVEL SECURITY;
ALTER TABLE review_queue         DISABLE ROW LEVEL SECURITY;
ALTER TABLE merge_history        DISABLE ROW LEVEL SECURITY;
ALTER TABLE merge_history_items  DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- GRANTS
-- ═══════════════════════════════════════════════════════════════
-- Match the convention from vendor + invoice schemas:
--   service_role:  full DML
--   anon, authenticated: metadata-only (REFERENCES/TRIGGER/TRUNCATE)
-- PostgREST requires these explicit grants; without them every
-- supabase-js call returns "permission denied for table X" even with
-- RLS disabled.

GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON inventory_items      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON item_aliases         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON storage_locations    TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON count_sessions       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON count_items          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON price_history        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON review_queue         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON merge_history        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON merge_history_items  TO service_role;

GRANT REFERENCES, TRIGGER, TRUNCATE ON inventory_items      TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON item_aliases         TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON storage_locations    TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON count_sessions       TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON count_items          TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON price_history        TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON review_queue         TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON merge_history        TO anon, authenticated;
GRANT REFERENCES, TRIGGER, TRUNCATE ON merge_history_items  TO anon, authenticated;

-- Views inherit ownership/grants from underlying tables but supabase-
-- js still needs an explicit SELECT grant on each view to expose them
-- through PostgREST.
GRANT SELECT ON v_current_count_state                          TO service_role, anon, authenticated;
GRANT SELECT ON v_current_count_items                          TO service_role, anon, authenticated;
GRANT SELECT ON v_count_session_totals                         TO service_role, anon, authenticated;
GRANT SELECT ON v_price_history_ranked                         TO service_role, anon, authenticated;
GRANT SELECT ON v_price_movers                                 TO service_role, anon, authenticated;
GRANT SELECT ON v_inventory_items_with_price_at_last_count     TO service_role, anon, authenticated;

GRANT EXECUTE ON FUNCTION merge_inventory_items(text, text[], text, text) TO service_role;

# Finance Stack Migration: Plan

**Status:** Working reference for Project 3. Every PR in Project 3 traces back to this artifact.
**Substrate:** `docs/FINANCE_STACK_AUDIT.md` (PR #83, merged 2026-05-28). The audit is the verified code reality. This plan is the migration design built on top of it.
**Briefs:** THREESYSTEMS, VENDOR_WIDGET, INVOICE_CAPTURE, SMART_INVENTORY (in chat at decision time).

---

## 1. Scope Statement

### In scope

The complete finance stack moves from Google Sheets to Postgres:

- **Vendor system** (HUB sheet): `vendor_master`, `vendor_accounts`, vendor aliases pipe-string normalized to a separate table.
- **Invoice Capture** (COLLECTION sheet): `invoice_submissions_26`, with rejection metadata factored to a separate `invoice_rejections` table.
- **AI_LINE_ITEMS** (separate spreadsheet, 9 per-account tabs): collapses to single `ai_line_items` table with `account_key` column.
- **GL_CODES** (separate spreadsheet, 12 per-account tabs + 2 utility tabs): collapses to single `gl_codes` table with `account_key` column + `is_purchasing` boolean.
- **Smart Inventory** (INVENTORY sheet, 8 tables + the new `zone_corrections` tab): lift-and-shift. Schema mirrors current Sheets structure; Kevin continues building post-migration.
- **Railway cron** (separate `kitchfix-inventory-cron` repo): migrates last, in two PRs (dual-write swap, then PG-only read swap).
- **Cross-cutting cleanups** delivered alongside their respective modules: vendor matcher consolidation, CATEGORIES unification, accountMatch removal, dataStore.js split, dead-code cleanup (getAllVendors, resolveVendorId, VendorAddModal.js).

### Out of scope

- **Post-migration Smart Inventory product development.** The 7 stub handlers stay as stubs. Kevin builds the Stage 2 features (typical-purchase analysis, anomaly detection, auto-suggest items, automatic price updates) on the Postgres foundation after migration.
- **The Stage 2 reconciliation loop.** Today the cron reads invoices nightly and matches against item_catalog. The future "live" loop is a follow-up project, not Project 3.
- **AI prompt rewrites.** Photo gate / OCR / consistency check / line item extraction / dedup similarity scan all keep their current prompts. Migration touches the data layer, not the AI layer.
- **Auth model rebuild.** OPS_LEADERSHIP_EMAILS allow-list stays as the gate during this migration (per AUTH_MODEL.md decision). Role-table migration is a separate Stage 2 effort.
- **Drive storage move to Supabase Storage.** Files continue to live in Google Drive. Only the URL fields move to PG.
- **Gmail send path.** Email infrastructure unchanged. `sendInvoiceEmail`, `sendRejectionEmail`, `sendEmailSA` all stay.
- **Slack webhooks.** No change.
- **Bill.com / Rippling integration.** Stamped PDF format stays byte-identical.

### Why this scope

Finish line: every production table that finance touches reads from Postgres. After Project 3 completes, the Sheets layer is a rollback target only. New product work (Stage 2 features) builds on PG directly without dual-write complexity.

---

## 2. Target Architecture

### 2.1 Table inventory

13 PG tables (12 net new + the existing `news_interactions`/`accounts`/`contacts`/`hero_images`/`work_locations`/`submissions` which were migrated earlier):

| # | Table | Source | Notes |
|---|---|---|---|
| 1 | `vendors` | HUB.vendor_master | Renamed; drop `lastInvoiceDate` per Q4 |
| 2 | `vendor_accounts` | HUB.vendor_accounts | Drop dead cols (N/O/P/V); soft-delete via deleted_at |
| 3 | `vendor_aliases` | NEW (extracted from vendors.aliases pipe-string) | Per VENDOR_WIDGET brief recommendation |
| 4 | `invoice_submissions` | COLLECTION.invoice_submissions_26 | Renamed; add generated invoice_number_normalized |
| 5 | `invoice_rejections` | NEW (factored from invoice_submissions cols R-U) | Separate table per INVOICE_CAPTURE brief |
| 6 | `ai_line_items` | AI_LINE_ITEMS (9 per-account tabs) | Collapses to single table with account_key |
| 7 | `gl_codes` | GL_CODES (12 per-account tabs + utility tabs) | Collapses; adds `is_purchasing` boolean per Q8 |
| 8 | `inventory_items` | INVENTORY.item_catalog | Renamed; primary_vendor FK to vendors.id per Q1 |
| 9 | `storage_locations` | INVENTORY.storage_locations | Lift-and-shift |
| 10 | `count_sessions` | INVENTORY.count_sessions | Add GENERATED grand_total |
| 11 | `count_items` | INVENTORY.count_items | Surrogate UUID PK per Q7; GENERATED extended_price |
| 12 | `item_aliases` | INVENTORY.item_aliases | Lift-and-shift |
| 13 | `price_history` | INVENTORY.price_history | UNIQUE on (item_id, source_or_invoice_id) for cron idempotency |
| 14 | `merge_history` | INVENTORY.merge_history | mergedItemIds JSONB per Q2 |
| 15 | `review_queue` | INVENTORY.review_queue | Lift-and-shift |
| 16 | `zone_corrections` | INVENTORY.zone_corrections | Schema captured live (audit Section 6) |

That's 16 tables, not 13. The plan covers all of them; the "13" figure in the user prompt was rounded.

### 2.2 DDL (the full schema)

All tables use `gen_random_uuid()` for surrogate keys (Postgres extension `pgcrypto`). All timestamps are `TIMESTAMPTZ`. All BOOLEAN columns default sensibly. Soft-delete via `deleted_at TIMESTAMPTZ` per Q5.

#### `vendors`

```sql
CREATE TABLE vendors (
  id              TEXT PRIMARY KEY,                          -- vendorId, e.g. "FRE-448"
  name            TEXT NOT NULL,
  category        TEXT,
  website         TEXT,
  notes           TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_uuid     UUID UNIQUE,                                -- F19b idempotency
  deleted_at      TIMESTAMPTZ                                 -- soft-delete (replaces 'DELETED' sentinel)
);

CREATE INDEX vendors_name_idx ON vendors (lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX vendors_category_idx ON vendors (category) WHERE deleted_at IS NULL;
```

Notes:
- `lastInvoiceDate` (col H of vendor_master) dropped per Q4. 0/35 fills, no consumers.
- Aliases extracted to separate `vendor_aliases` table.
- All queries filter `WHERE deleted_at IS NULL`.

#### `vendor_aliases`

```sql
CREATE TABLE vendor_aliases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  alias_text      TEXT NOT NULL,
  alias_normalized TEXT GENERATED ALWAYS AS (lower(regexp_replace(alias_text, '[^a-zA-Z0-9 ]', '', 'g'))) STORED,
  source          TEXT NOT NULL,                              -- 'manual', 'ocr_learned', 'merge'
  learned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  learned_by      TEXT,                                       -- email or 'system'

  UNIQUE (vendor_id, alias_normalized)                        -- prevent duplicate aliases per vendor
);

CREATE INDEX vendor_aliases_alias_idx ON vendor_aliases (alias_normalized);
```

Notes:
- Backfill from `vendor_master.aliases` pipe-separated string. Each piped alias becomes a row.
- `alias_normalized` GENERATED column powers the fuzzy-match lookup.
- UNIQUE constraint prevents the multi-writer race (learnVendorAlias / vendor-merge / vendor-master-update all append).

#### `vendor_accounts`

```sql
CREATE TABLE vendor_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id             TEXT NOT NULL REFERENCES vendors(id),
  account_key           TEXT NOT NULL CHECK (account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$' OR account_key = 'CORP'),
                                                                      -- enforce canonical "CIN - OH" format per S3
  customer_account_num  TEXT,
  sales_rep_name        TEXT,
  sales_rep_phone       TEXT,
  sales_rep_email       TEXT,
  delivery_days         TEXT,
  cutoff_time           TEXT,
  delivery_method       TEXT,
  portal_url            TEXT,
  portal_username       TEXT,                                          -- plaintext per Q6
  portal_password       TEXT,                                          -- plaintext per Q6
  payment_terms         TEXT,
  min_order             TEXT,
  active                BOOLEAN NOT NULL DEFAULT true,
  created_by            TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_notes         TEXT,
  client_uuid           UUID UNIQUE,                                   -- F19b idempotency

  UNIQUE (vendor_id, account_key)
);

CREATE INDEX vendor_accounts_account_idx ON vendor_accounts (account_key);
CREATE INDEX vendor_accounts_active_idx ON vendor_accounts (account_key, active);
```

Notes:
- Dead cols dropped: N/O/P (contact name/email/phone, 0/54 fills), V (reserved unused).
- Plaintext credentials per Q6 (intentional, surfaced only in admin tools).
- CHECK constraint on account_key enforces canonical spaces format per S3. accountMatch tolerance becomes unnecessary.
- No deleted_at on vendor_accounts. Use `active = false` for soft-delete (matches today's behavior).

#### `invoice_submissions`

```sql
CREATE TABLE invoice_submissions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_uuid                 UUID UNIQUE,                              -- F25 idempotency
  submitted_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitter_email             TEXT NOT NULL,
  account_key                 TEXT NOT NULL,
  vendor_name                 TEXT NOT NULL,                            -- display name (may differ from canonical due to alias)
  vendor_id                   TEXT NOT NULL REFERENCES vendors(id),
  invoice_number              TEXT,
  invoice_number_normalized   TEXT GENERATED ALWAYS AS (
                                  regexp_replace(coalesce(invoice_number, ''), '^#?0*', '')
                              ) STORED,
  invoice_date                DATE,
  total_amount                NUMERIC(12, 2) NOT NULL,
  gl_breakdown                JSONB NOT NULL,
  drive_urls                  TEXT[] NOT NULL DEFAULT '{}',
  page_count                  INTEGER NOT NULL DEFAULT 1,
  email_sent                  BOOLEAN NOT NULL DEFAULT false,
  status                      TEXT NOT NULL DEFAULT 'sent'
                                CHECK (status IN ('sent','returned','corrected','deleted')),
  status_updated_at           TIMESTAMPTZ,
  type                        TEXT NOT NULL DEFAULT 'invoice'
                                CHECK (type IN ('invoice','credit')),
  raw_drive_url               TEXT,
  corrected_from_uuid         UUID REFERENCES invoice_submissions(id),
  dupe_override               BOOLEAN NOT NULL DEFAULT false,
  ai_scan_complete            BOOLEAN NOT NULL DEFAULT false
);

-- F24 field-based dedup as partial unique index
CREATE UNIQUE INDEX invoice_submissions_field_dedup_idx
  ON invoice_submissions (vendor_id, invoice_number_normalized, invoice_date, total_amount)
  WHERE status NOT IN ('corrected','deleted')
    AND corrected_from_uuid IS NULL
    AND dupe_override = false;

CREATE INDEX invoice_submissions_account_idx ON invoice_submissions (account_key, submitted_at DESC);
CREATE INDEX invoice_submissions_status_idx ON invoice_submissions (status, submitted_at DESC);
```

Notes:
- `client_uuid` UNIQUE replaces F25 read-then-write idempotency check.
- `invoice_number_normalized` is the GENERATED form for F24 dedup (strips leading '#' and leading zeros). The partial UNIQUE INDEX enforces F24 at DB level.
- Rejection metadata (cols R-U) factored to `invoice_rejections`.
- Status enum replaces the freeform string today.

#### `invoice_rejections`

```sql
CREATE TABLE invoice_rejections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id       UUID NOT NULL REFERENCES invoice_submissions(id) ON DELETE CASCADE,
  rejected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  rejected_by         TEXT NOT NULL,
  reason              TEXT,                                              -- comma-separated reasons today
  note                TEXT,
  unrejected_at       TIMESTAMPTZ,                                       -- set when admin un-rejects
  unrejected_by       TEXT,

  UNIQUE (submission_id, rejected_at)                                    -- allow re-rejection history
);

CREATE INDEX invoice_rejections_submission_idx ON invoice_rejections (submission_id);
```

Notes:
- Today rejection lives on the submission row (cols R-U). Migration moves to dedicated history table.
- Unreject becomes a column update on the most-recent row, not a row delete (audit trail).

#### `ai_line_items`

```sql
CREATE TABLE ai_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_uuid    UUID NOT NULL REFERENCES invoice_submissions(id) ON DELETE CASCADE,
  account_key     TEXT NOT NULL,                                         -- collapses per-account tab structure
  vendor_name     TEXT NOT NULL,
  invoice_number  TEXT,
  invoice_date    DATE,
  line_num        INTEGER NOT NULL,
  description     TEXT NOT NULL,
  quantity        NUMERIC,
  unit            TEXT,
  unit_price      NUMERIC,
  extended_price  NUMERIC,
  category        TEXT,                                                   -- 10-bucket OCR enum
  confidence      TEXT,
  raw_json        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (invoice_uuid, line_num)                                         -- cron idempotency at write time
);

CREATE INDEX ai_line_items_account_invoice_idx ON ai_line_items (account_key, invoice_date DESC);
CREATE INDEX ai_line_items_invoice_idx ON ai_line_items (invoice_uuid);
```

Notes:
- Per-account tabs collapse to a single table. `account_key` carries the per-account distinction.
- UNIQUE (invoice_uuid, line_num) closes the cron re-processing race at the schema level.

#### `gl_codes`

```sql
CREATE TABLE gl_codes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key     TEXT NOT NULL,                                          -- per-account tab collapses
  category        TEXT,                                                   -- parsed from header rows
  code            TEXT NOT NULL,
  name            TEXT,
  is_purchasing   BOOLEAN NOT NULL DEFAULT true,                          -- Q8: replaces parseGLCodes business-rule filter
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (account_key, code)
);

CREATE INDEX gl_codes_account_idx ON gl_codes (account_key) WHERE active = true AND is_purchasing = true;
```

Notes:
- Per Q8: migrate raw, then add `is_purchasing` boolean. Existing `parseGLCodes` filter logic (EXCLUDED_CATEGORIES, EXCLUDED_ITEMS, SECTION_MARKERS) becomes a backfill-time classification rather than runtime.
- Application layer queries with `WHERE is_purchasing = true` to get the same filter behavior.

#### `inventory_items`

```sql
CREATE TABLE inventory_items (
  id                   TEXT PRIMARY KEY,                                  -- itemId, "inv_XXX" format preserved
  account_key          TEXT NOT NULL,
  name                 TEXT NOT NULL,
  category             TEXT NOT NULL DEFAULT 'Uncategorized',
  unit                 TEXT NOT NULL DEFAULT 'EA',
  location_id          TEXT REFERENCES storage_locations(id),
  primary_vendor_id    TEXT REFERENCES vendors(id),                       -- Q1: FK to vendors, not freeform
  last_price           NUMERIC,
  last_price_date      DATE,
  last_price_vendor    TEXT,                                              -- vendor on the invoice that set this price (may differ from primary)
  price_at_last_count  NUMERIC,
  active               BOOLEAN NOT NULL DEFAULT true,
  linked_to_invoice    BOOLEAN NOT NULL DEFAULT false,
  is_variety_group     BOOLEAN NOT NULL DEFAULT false,
  created_by           TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  status               TEXT CHECK (status IN ('excluded', 'archived') OR status IS NULL),
  notes                TEXT,
  last_verified        DATE,

  UNIQUE (account_key, lower(name)) DEFERRABLE INITIALLY DEFERRED         -- BR4: replaces dedup tools
);

CREATE INDEX inventory_items_account_active_idx ON inventory_items (account_key, active);
CREATE INDEX inventory_items_location_idx ON inventory_items (location_id);
```

Notes:
- `primary_vendor_id` FK to vendors per Q1. Migration backfill resolves the freeform string to a vendor ID via fuzzyMatchVendor. Unresolvable strings leave the FK null + log for review.
- UNIQUE (account_key, lower(name)) replaces both dedup tools per BR4. New duplicate inserts fail at constraint; existing duplicates resolved during backfill via merge.
- DEFERRABLE INITIALLY DEFERRED allows multi-row merge transactions to temporarily violate the constraint within a transaction.
- `is_purchasing` from gl_codes is the model.

#### `storage_locations`

```sql
CREATE TABLE storage_locations (
  id                  TEXT PRIMARY KEY,                                   -- locationId, "loc_XXX"
  account_key         TEXT NOT NULL,
  name                TEXT NOT NULL,
  icon                TEXT NOT NULL DEFAULT 'box',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  active              BOOLEAN NOT NULL DEFAULT true,
  parent_location_id  TEXT REFERENCES storage_locations(id),              -- self-ref for sub-zones
  color               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX storage_locations_account_active_idx ON storage_locations (account_key, active, sort_order);
```

Notes:
- Cols 6-7 reserved/empty in Sheets dropped per BUILD RULE.

#### `count_sessions`

```sql
CREATE TABLE count_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id         TEXT,                                                 -- "sess_XXX" preserved during backfill for cross-ref
  account_key       TEXT NOT NULL,
  period_name       TEXT NOT NULL,
  started_by        TEXT NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','submitted','corrected')),
  submitted_by      TEXT,
  submitted_at      TIMESTAMPTZ,
  total_food        NUMERIC NOT NULL DEFAULT 0,
  total_packaging   NUMERIC NOT NULL DEFAULT 0,
  total_supplies    NUMERIC NOT NULL DEFAULT 0,
  total_snacks      NUMERIC NOT NULL DEFAULT 0,
  total_beverages   NUMERIC NOT NULL DEFAULT 0,
  grand_total       NUMERIC GENERATED ALWAYS AS (
                      total_food + total_packaging + total_supplies + total_snacks + total_beverages
                    ) STORED
);

CREATE INDEX count_sessions_account_status_idx ON count_sessions (account_key, status, submitted_at DESC);
```

Notes:
- `grand_total` GENERATED replaces the manual sum currently done in `handleCountSubmit`.
- Status enum.

#### `count_items`

```sql
CREATE TABLE count_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),         -- Q7: surrogate UUID
  session_id          UUID NOT NULL REFERENCES count_sessions(id) ON DELETE CASCADE,
  location_save_id    TEXT NOT NULL,                                      -- identifies a save batch; latest per location wins on read
  item_id             TEXT NOT NULL REFERENCES inventory_items(id),
  quantity            NUMERIC NOT NULL DEFAULT 0,
  unit                TEXT NOT NULL,                                      -- snapshot of catalog unit at count time
  price_at_count      NUMERIC NOT NULL DEFAULT 0,
  price_vendor        TEXT,
  extended_price      NUMERIC GENERATED ALWAYS AS (quantity * price_at_count) STORED,
  location_id         TEXT REFERENCES storage_locations(id),              -- snapshot of catalog location_id
  saved_by            TEXT NOT NULL,
  saved_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  none_on_hand        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX count_items_session_loc_saved_idx ON count_items (session_id, location_id, saved_at DESC);
CREATE INDEX count_items_session_item_idx ON count_items (session_id, item_id);
```

Notes:
- Append-only ledger per SMART_INVENTORY brief gotcha. Latest locationSaveId per location wins on read. Same pattern as Sheets.
- `extended_price` GENERATED.
- Read pattern: window function or view to project current state per location.

#### `price_history`

```sql
CREATE TABLE price_history (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id                 TEXT NOT NULL REFERENCES inventory_items(id),
  account_key             TEXT NOT NULL,
  vendor                  TEXT,                                            -- vendor on this invoice/verify
  price                   NUMERIC NOT NULL,
  effective_date          DATE NOT NULL,
  source_or_invoice_id    TEXT NOT NULL,                                   -- 'manual-add' | 'manual-verify' | invoice UUID
  recorded_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (item_id, source_or_invoice_id)                                   -- cron idempotency at write time
);

CREATE INDEX price_history_item_date_idx ON price_history (item_id, effective_date DESC);
CREATE INDEX price_history_account_idx ON price_history (account_key, recorded_at DESC);
```

Notes:
- UNIQUE constraint replaces the cron's read-then-filter idempotency check.

#### `item_aliases`

```sql
CREATE TABLE item_aliases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_text      TEXT NOT NULL,
  item_id         TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  vendor          TEXT,
  confidence      NUMERIC,                                                  -- 60-100 from cron
  learned_by      TEXT NOT NULL,                                             -- 'ai_cron' | 'item_review' | email
  learned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (alias_text, vendor)                                                -- prevent dup aliases for same vendor
);

CREATE INDEX item_aliases_item_idx ON item_aliases (item_id);
CREATE INDEX item_aliases_alias_idx ON item_aliases (lower(alias_text));
```

#### `merge_history`

```sql
CREATE TABLE merge_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key         TEXT NOT NULL,
  performed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  performed_by        TEXT NOT NULL,
  keeper_item_id      TEXT REFERENCES inventory_items(id),
  keeper_name         TEXT,
  merged_item_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,                    -- Q2: stay as JSONB
  merged_names        JSONB NOT NULL DEFAULT '[]'::jsonb,
  action              TEXT NOT NULL CHECK (action IN ('merge','keep_separate','exclude')),
  ai_group_id         TEXT
);

CREATE INDEX merge_history_account_action_idx ON merge_history (account_key, action, performed_at DESC);
CREATE INDEX merge_history_keeper_idx ON merge_history (keeper_item_id);
```

#### `review_queue`

```sql
CREATE TABLE review_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description         TEXT NOT NULL,                                          -- original invoice description
  vendor              TEXT NOT NULL,
  invoice_uuid        UUID REFERENCES invoice_submissions(id),
  invoice_date        DATE,
  account_key         TEXT NOT NULL,
  matched_item_id     TEXT REFERENCES inventory_items(id),                    -- probable match from AI; null if action='new'
  canonical_name      TEXT,                                                   -- cron's suggested clean name
  confidence          NUMERIC NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','accepted','rejected')),
  decided_by          TEXT,
  decided_at          TIMESTAMPTZ,
  decision_note       TEXT,
  queued_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX review_queue_account_status_idx ON review_queue (account_key, status, queued_at DESC);
```

Notes:
- Cols 10-12 reserved in Sheets become `decided_by`, `decided_at`, `decision_note`.

#### `zone_corrections`

```sql
CREATE TABLE zone_corrections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id            TEXT,                                                 -- "corr_XXX" preserved during backfill
  account_key          TEXT NOT NULL,
  performed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  performed_by         TEXT NOT NULL,
  item_id              TEXT REFERENCES inventory_items(id),
  item_name            TEXT,
  ai_suggested_zone    TEXT,
  actual_zone          TEXT,
  item_category        TEXT
);

CREATE INDEX zone_corrections_account_idx ON zone_corrections (account_key, performed_at DESC);
```

Notes:
- Schema captured live during audit. 9 cols, currently 0 rows.

### 2.3 Triggers and functions

#### Vendor alias auto-learn (replaces today's read-modify-write)

Today `learnVendorAlias` reads vendor_master row, checks if alias exists in pipe-string, appends if not. Race condition with concurrent writes (vendor-merge, vendor-master-update).

PG replacement: a trigger on `vendor_aliases` INSERT does nothing - the UNIQUE constraint on (vendor_id, alias_normalized) prevents duplicates at write time. Application layer becomes:

```sql
INSERT INTO vendor_aliases (vendor_id, alias_text, source, learned_at, learned_by)
VALUES ($1, $2, 'ocr_learned', now(), 'system')
ON CONFLICT (vendor_id, alias_normalized) DO NOTHING;
```

Single-statement, no race.

#### Vendor merge (replaces today's 3 sequential Sheets calls)

PG transaction:

```sql
BEGIN;
  -- 1. Reassign vendor_accounts.vendor_id from dupes to keeper
  UPDATE vendor_accounts SET vendor_id = $keeper_id
    WHERE vendor_id = ANY($dupe_ids);

  -- 2. Soft-delete dupes
  UPDATE vendors SET deleted_at = now() WHERE id = ANY($dupe_ids);

  -- 3. Append dupe names as aliases (each ON CONFLICT DO NOTHING)
  INSERT INTO vendor_aliases (vendor_id, alias_text, source, learned_by)
    SELECT $keeper_id, name, 'merge', $email FROM vendors WHERE id = ANY($dupe_ids)
    ON CONFLICT (vendor_id, alias_normalized) DO NOTHING;

  -- 4. Audit row
  INSERT INTO merge_history (...) VALUES (...);
COMMIT;
```

Atomic. Partial failure rolls back.

### 2.4 RLS policies

**TBD - separate decision before any PR ships.**

Today access is "any authenticated user can read/write all finance tables" (intentional per TEAM_KNOWLEDGE for floor operations). The cutover from `OPS_LEADERSHIP_EMAILS` allow-list to RLS-based role checking is a separate AUTH_MODEL.md follow-up.

For Project 3 migration: PG access via `service_role` only. Disable RLS on all finance tables OR set permissive RLS policies (no row-level filtering). Application-layer admin gates (OPS_LEADERSHIP_EMAILS) remain authoritative.

See Section 8 Open Items.

---

## 3. Decision Log

All 17 decisions plus 8 resolved during audit review (PR #83). Format: ID | Decision | Reasoning | Implication.

### Schema decisions

| ID | Decision | Reasoning | Implication |
|---|---|---|---|
| Q1 | `inventory_items.primary_vendor_id` is FK to `vendors.id`, NOT freeform | Long-term data health. Vendor renames propagate. No string-vs-FK confusion. | Backfill must resolve freeform string -> vendor_id via fuzzyMatchVendor. Unresolvable strings log + leave null. |
| Q2 | `merge_history.merged_item_ids` is JSONB, NOT junction table | Lift-and-shift friendly. The merged_item_ids array is read-as-snapshot, never joined. Stays consistent with the Sheets JSON-string today. | Migration unchanged from current write pattern. PG just types the JSON. |
| Q3 | `zone_corrections` schema captured live: 9 cols | Real recon during audit | Schema in Section 2.2 above |
| Q4 | DROP `vendor_master.lastInvoiceDate` (col H) | 0/35 fills. No consumers. Dead per audit. | Not in vendors PG schema |
| Q5 | Soft-delete via `deleted_at TIMESTAMPTZ` everywhere; drop `notes='DELETED'` sentinel | Conventional Postgres pattern. Easier to query (`WHERE deleted_at IS NULL`). | All migrated tables that had soft-delete pattern adopt deleted_at. Backfill maps 'DELETED' notes to deleted_at timestamp. |
| Q6 | Plaintext portal credentials STAY | Intentional per TEAM_KNOWLEDGE. Shift continuity. Encryption adds zero risk reduction (real exposure is the API surface, not at-rest data). | vendor_accounts.portal_username + portal_password are TEXT not bytea. RLS / access-control hardening is a separate Stage 2 effort. |
| Q7 | `count_items` PK is surrogate UUID, NOT composite (session, save, item) | Append-only ledger benefits from a simple PK. Joins use FK to count_sessions. Conceptual key (session_id, location_save_id, item_id) NOT enforced at DB level - replay semantics demand multiple rows per logical position. | Backfill generates UUIDs. Composite query in code becomes an ORDER BY saved_at DESC. |
| Q8 | `gl_codes` migrates raw + adds `is_purchasing` BOOLEAN | `parseGLCodes` filter logic moves from runtime to backfill-time classification. Future GL_CODES tab changes only require updating `is_purchasing`. | Backfill classifies each code. Application queries with `WHERE is_purchasing = true`. |

### Business rules

| ID | Decision | Reasoning | Implication |
|---|---|---|---|
| BR1 | vendor-merge admin gate fix BUNDLED into PR 5.2 (handler rewire) | One-line fix, in the same file getting rewired anyway. No reason to ship separately. | PR 5.2 description notes the security fix. |
| BR2 | Filename format unification DEFERRED to backlog | Cosmetic. drive.js + invoiceActions.js continue to have duplicate builders. Acceptable maintenance burden. | No action this project. |
| BR3 | Smart Inventory stub handlers STAY AS STUBS | Migration is lift-and-shift. Kevin continues building post-migration. | The 7 "Week 3"/"Week 4" handlers stay returning the same error strings. |
| BR4 | Retire BOTH dedup tools. Add PG UNIQUE(account_key, lower(name)) on inventory_items | Schema-level constraint replaces runtime tool. ai-similarity-check handler keeps covering the "similar but not equal" admin case from UI. | Drop `handleDedupCatalog` from inventoryActions.js. Drop the `DEDUP=1` mode from cron index.js. Backfill must resolve duplicates first. |

### Scope decisions

| ID | Decision | Reasoning | Implication |
|---|---|---|---|
| S1 | Vendor matchers (7 implementations) CONSOLIDATE to `src/lib/vendorMatching.js` during PR 5.2 | Single source of truth. Each consumer (OCR, search, dedup, cron, admin) imports from the canonical lib. | New file. 7 sites refactored to import from it. Cron will use its own version (different repo) but the algorithm matches. |
| S2 | CATEGORIES constant UNIFIES during PR 5.2 | 5 declarations consolidate to one shared const. | New file `src/lib/vendorEnums.js` exports CATEGORIES + CATEGORY_COLORS + PAYMENT_TERMS + DELIVERY_METHODS. 5 components import. |
| S3 | DELETE both accountMatch implementations. Enforce canonical "CIN - OH" via PG CHECK constraint | Backfill normalizes any non-canonical values. Future writes constrained at schema level. accountMatch becomes obsolete. | vendor_accounts gets the CHECK constraint shown in 2.2. Backfill includes a normalization step for any accidentally-stored hyphen-format keys. |

### Deferred work

| ID | Decision | Reasoning | Implication |
|---|---|---|---|
| D1 | RESOLVED: VendorAddModal.js zero external usage. **Deletion candidate.** | Grep showed only its own file references it. Newer 4-step VendorSetup.js replaces it across all consumers. | Delete during PR 5.2 cleanup. |
| D2 | DROP `HUB_SHEET_ID` dead config during cron migration PR 1 | Vestigial env var. Declared but unused. | Delete during cron PR 1. Update Railway env var list. |
| D3 | Vestigial user-OAuth helpers in sheets.js (`readSheet`, `appendRow`, etc.): DEFER | No production code uses them. Removing is a separate cleanup PR (not in finance scope). | Backlog item. Not in Project 3. |
| D4 | Two subject encoders in gmail.js: BACKLOG | Cosmetic. Not blocking migration. | Backlog. |
| D5 | dataStore.js SPLIT during PR 4.1 (BEFORE vendor module is added) | File already 1994 LOC. Adding 3 new modules (vendor, invoice, inventory) without splitting first means 3000+ LOC mid-migration. | New file structure in PR 4.1: `src/lib/dataStore/index.js` + per-module files. See Section 4 Module 4. |

### Code organization

| Item | Decision |
|---|---|
| dataStore split structure | `src/lib/dataStore/index.js` (re-exports), `shared.js` (3 primitives), per-module files: `newsInteractions.js`, `directory.js`, `submissions.js`, `vendor.js`, `invoice.js`, `inventory.js`. |
| Vendor matching library | `src/lib/vendorMatching.js` (new, canonical implementation; replaces 7 sites). |
| Vendor enums library | `src/lib/vendorEnums.js` (new, single source for CATEGORIES + CATEGORY_COLORS + PAYMENT_TERMS + DELIVERY_METHODS). |
| Account key validation | CHECK constraint on vendor_accounts (and similar tables) enforces canonical "CIN - OH" format. |
| RLS policy | TBD - permissive default during Project 3; AUTH_MODEL.md follow-up adds row-level filtering later. |

---

## 4. Migration Sequence

5 modules, ~13 PRs, ~105-145 hours total. Each module ships its PRs in order; modules can overlap if review bandwidth allows.

### Module 4: dataStore.js refactor (PRE-REQUISITE)

Prepares the file for the 3 new finance modules. Pure refactor; no behavior change.

#### PR 4.1: dataStore.js split

**Goal:** Extract the current dataStore.js into per-module files under `src/lib/dataStore/`.

**Changes:**
- Create `src/lib/dataStore/` directory.
- Move 3 shared primitives (`coordinatedWrite`, `deleteRecord`, `replaceScope`) to `shared.js`.
- Extract each module section: `newsInteractions.js`, `directory.js`, `submissions.js`. Each file exports its own `getX` / `upsertX` / etc.
- Create `src/lib/dataStore/index.js` that re-exports everything for backward compatibility (so callers using `@/lib/dataStore` keep working without updating imports).

**Verification:**
- `npm run build` clean.
- `npx eslint` clean.
- Run all existing module smoke tests (submissions byte-equal smoke test from PR B, directory dual-write check).
- Production smoke check after deploy: news_interactions, directory, submissions all reading + writing correctly.

**Estimated: 6-8 hours**

**Dependencies:** None. Must merge before Module 5.

---

### Module 5: Vendor migration

#### PR 5.1: PG schema + dataStore/vendor.js adapters (dormant)

**Goal:** Run the DDL for `vendors`, `vendor_accounts`, `vendor_aliases`. Create dormant adapters in `dataStore/vendor.js`.

**Changes:**
- Supabase SQL: 3 CREATE TABLE statements + indexes (per Section 2.2).
- New file `src/lib/dataStore/vendor.js`: orchestrators `getVendors`, `getVendor`, `upsertVendor`, `upsertVendorAccount`, `deactivateVendorAccount`, `learnVendorAlias`, `mergeVendors`. Each dispatches via `isDualWrite` / `isReadFromPostgres`.
- Re-export from `dataStore/index.js`.
- Add `vendor_master`, `vendor_accounts`, `vendor_aliases` to the cutover.js flag table (passive - flags off by default).

**Verification:**
- DDL applied to Supabase, tables empty.
- Build + lint clean.
- Flags off = byte-identical to today. (Handler in invoiceActions.js still hits Sheets directly.)

**Estimated: 8-10 hours**

#### PR 5.2: Handler rewire + cross-cutting cleanup

**Goal:** invoiceActions.js vendor section routes through `dataStore/vendor.js`. Cross-cutting cleanup bundled.

**Changes:**
- Rewire 9 vendor handlers in invoiceActions.js (handleVendorList, Get, Update, MasterUpdate, Deactivate, Reactivate, Merge, learnVendorAlias internal, vendor-add inline) to use orchestrators.
- **BR1:** Add `OPS_LEADERSHIP_EMAILS.includes(email)` check at top of handleVendorMerge.
- **S1:** Create `src/lib/vendorMatching.js`. Consolidate the 7 implementations:
  1. `fuzzyMatchVendor` (invoiceActions.js) - canonical
  2. `learnVendorAlias` normalization - imports from vendorMatching
  3. `vendor-search` API path - imports from vendorMatching
  4. VendorAddModal client Levenshtein - imports normalize helper
  5. VendorAdminView client Levenshtein - imports normalize helper
  6. Cron `normalizeName` - separate repo, gets its own copy (or shared library if added later)
- **S2:** Create `src/lib/vendorEnums.js`. CATEGORIES + CATEGORY_COLORS + PAYMENT_TERMS + DELIVERY_METHODS exported as named constants. Update 5 component files to import.
- **D1:** Delete `src/app/ops/components/vendors/VendorAddModal.js`. Confirmed zero external imports.
- **L8/L9:** Delete `getAllVendors` + `resolveVendorId` from `opsUtils.js`. Drop the unused import in inventoryActions.js line 9.

**Verification:**
- Build + lint clean.
- Smoke test all 9 vendor handler actions via UI (list, get, add, update, master-update, deactivate, reactivate, merge).
- Byte-equal comparison of vendor-list output before/after PR.
- Check that the now-shared vendor matching library produces the same results as the old per-site implementations on a fixed set of test vendor names.

**Estimated: 8-12 hours**

#### PR 5.3: Backfill script

**Goal:** Populate `vendors`, `vendor_accounts`, `vendor_aliases` from Sheets.

**Changes:**
- `scripts/backfill-vendor.mjs` using the shared runner.
- 3-table sequential backfill (vendors -> vendor_accounts -> vendor_aliases).
- vendor_aliases backfill splits the pipe-string into individual rows.
- Idempotency: ON CONFLICT DO NOTHING for vendor_aliases (UNIQUE constraint catches duplicates).

**Verification:**
- Dry-run: expect 35 vendors, 54 vendor_accounts, ~150+ aliases (sum of pipe-split aliases across all vendors).
- Execute: verify counts in PG match.
- Spot check: pick 3 vendors, verify all their accounts + aliases backfilled correctly.

**Estimated: 2-3 hours**

#### PR 5.4: Vendor-merge atomicity

**Goal:** Wrap the 3-step vendor merge in a PG transaction (today: 3 sequential Sheets calls, not atomic).

**Changes:**
- `dataStore/vendor.js` `mergeVendors` orchestrator wraps PG side in a transaction (BEGIN/COMMIT).
- Sheets side stays 3 sequential calls (best we can do; Sheets has no transaction primitive).

**Verification:**
- Trigger a merge on test vendor pair. Verify either all 3 PG ops succeed or all roll back.

**Estimated: 2-3 hours**

#### Cutover sequence (Module 5)

1. Vercel env: `DUAL_WRITE_TABLES` += `vendor_master,vendor_accounts,vendor_aliases`
2. Wait for deploy. Verify dual-write working via one live vendor edit through admin UI. Compare Sheets row to PG row.
3. Run `npm run backfill:vendor -- --execute`.
4. Verify PG counts match Sheets.
5. Vercel env: `READ_FROM_POSTGRES_OPS` += `vendor_master,vendor_accounts,vendor_aliases` (or whatever per-module flag the ops module uses).
6. Wait for deploy. Verify vendor portal reads correctly. Spot check `vendor-search`, `vendor-list`, OCR vendor match.

**Module 5 total: 20-28 hours.**

---

### Module 6: Invoice migration

#### PR 6.1: PG schema + dataStore/invoice.js adapters (dormant)

**Goal:** DDL for `invoice_submissions`, `invoice_rejections`, `ai_line_items`, `gl_codes`. Dormant adapters.

**Changes:**
- Supabase SQL: 4 CREATE TABLE statements + indexes + the F24 partial unique index.
- New file `src/lib/dataStore/invoice.js`: orchestrators for submit, history, admin-list, reject, unreject, dismiss-dupe, delete-dupe, duplicate-check, GL bootstrap.
- Cutover flags added.

**Estimated: 10-14 hours**

#### PR 6.2: Handler rewire

**Goal:** invoiceActions.js invoice section routes through `dataStore/invoice.js`. GL bootstrap moves to PG query.

**Changes:**
- Rewire 9 invoice handlers + `handleInvoiceGet` bootstrap reads.
- AI handlers (`invoice-photo-gate`, `invoice-ocr`, `invoice-consistency-check`) stay as-is - they are AI calls, not data writes.
- GL enrichment in invoice-submit now uses `gl_codes` PG table instead of GL_CODES sheet.
- `parseGLCodes` runtime filter (EXCLUDED_CATEGORIES, etc.) becomes obsolete - replaced by `WHERE is_purchasing = true`.
- F24 dedup check shifts from JS read-then-filter to PG INSERT with partial unique index handling.
- F25 idempotency shifts from read-then-write to PG UNIQUE on client_uuid.
- `triggerAIScan` async fire-and-forget preserved.
- `LINE_ITEM_HEADERS` const becomes obsolete (table has schema; no per-tab headers).
- `ensureLineItemTab` becomes obsolete.
- `GL_TAB_MAP` becomes obsolete (PG query uses account_key, no tab name lookup).

**Estimated: 14-18 hours**

#### PR 6.3: Backfill

**Goal:** Populate `invoice_submissions`, `invoice_rejections`, `ai_line_items`, `gl_codes`.

**Changes:**
- `scripts/backfill-invoice.mjs` using the shared runner.
- 4-table backfill (largest data volume of the project):
  - `invoice_submissions`: read invoice_submissions_26 from COLLECTION.
  - `invoice_rejections`: extract rows from invoice_submissions_26 where cols R-U populated.
  - `ai_line_items`: 9 per-account tabs collapse to one table. ~3800 rows.
  - `gl_codes`: 12 per-account tabs + classify is_purchasing for each row.

**Estimated: 4-6 hours**

#### Cutover sequence (Module 6)

Same shape as Module 5. Watch for AI scan dependency: any new submission during the dual-write window triggers triggerAIScan which writes to AI_LINE_ITEMS. Dual-write must include AI_LINE_ITEMS from the start so the cron sees both.

**Module 6 total: 28-38 hours.**

---

### Module 7: Smart Inventory migration

#### PR 7.1: PG schema + dataStore/inventory.js adapters (dormant)

**Goal:** DDL for 8 tables + zone_corrections. Dormant adapters.

**Changes:**
- Supabase SQL: 8 CREATE TABLE statements + indexes.
- New file `src/lib/dataStore/inventory.js`: orchestrators for bootstrap, count-save, count-submit, add-item, verify-price, archive, exclude, reactivate, batch-move, merge, keep-separate, review-accept, ai-similarity-check, save-locations, save-sort-order, add-sub-zone, update-location, deactivate-location, dedup-catalog (RETIRED per BR4).
- Cutover flags added.

**Estimated: 10-14 hours**

#### PR 7.2: Handler rewire

**Goal:** inventoryActions.js 30+ handlers route through `dataStore/inventory.js`.

**Changes:**
- Rewire all non-stub handlers.
- **BR4:** Remove `handleDedupCatalog` (entire function deleted).
- **S3:** Remove `accountMatch` from inventoryActions.js line 14. CHECK constraint on PG account_key enforces canonical format. All callers using accountMatch tolerance now compare directly.
- Drop opsUtils cache layer where unnecessary (PG already handles read latency; cachedRead becomes a no-op wrapper or gets removed).
- Stub handlers (handleScan, handleHistoryGet, handleReviewQueueGet, handleAdminCorrect, handlePrint, handleResolveQueue, handleUpdateItem) STAY AS STUBS per BR3.

**Estimated: 14-18 hours**

#### PR 7.3: Backfill

**Goal:** Populate 8+ inventory tables.

**Changes:**
- `scripts/backfill-inventory.mjs` using shared runner.
- 9-table backfill in dependency order:
  1. `storage_locations` (no dependencies)
  2. `inventory_items` (needs storage_locations.id for FK; needs vendors.id for primary_vendor_id resolution)
  3. `item_aliases` (needs inventory_items.id)
  4. `count_sessions` (no dependencies)
  5. `count_items` (needs count_sessions.id + inventory_items.id)
  6. `price_history` (needs inventory_items.id + invoice_submissions.id for invoice-sourced rows)
  7. `merge_history` (no FK; references item ids as text in JSONB)
  8. `review_queue` (needs invoice_submissions.id + inventory_items.id)
  9. `zone_corrections` (needs inventory_items.id)
- inventory_items backfill includes the primary_vendor resolution step (Q1): map freeform string -> vendors.id via fuzzyMatchVendor. Unresolvable strings logged.

**Estimated: 6-8 hours**

#### Cutover sequence (Module 7)

Critical ordering with cron:
- intranet dual-write enabled BEFORE cron PR
- cron reads stay on Sheets during intranet dual-write window
- Once Module 8 PR 1 deploys (cron dual-write), can proceed with intranet READ flag flip

**Module 7 total: 30-40 hours.**

---

### Module 8: Cron migration (separate repo)

#### Cron PR 1: Dual-write swap

**Goal:** The 4 cron data helpers (`readTab`, `appendRows`, `updateRange`, `getTabNames`) now write to PG in addition to Sheets. Reads stay on Sheets.

**Changes:**
- Add Supabase client to cron package.json.
- Modify `appendRows` and `updateRange` to fire writes to both Sheets and PG.
- Reads continue to hit Sheets.
- **D2:** Drop `HUB_SHEET_ID` env var declaration (line 27).

**Verification:**
- Manual Railway run with DEDUP=0 (normal nightly mode).
- Verify rows land in both Sheets and PG.
- One full nightly cycle observed without errors.

**Estimated: 4-6 hours**

#### Cron PR 2: PG-only read swap

**Goal:** Cron reads from PG, writes to PG only. Sheets I/O dropped entirely.

**Changes:**
- All 4 helpers swap to Supabase client.
- `getTabNames` becomes `SELECT DISTINCT account_key FROM ai_line_items`.
- Drop `googleapis` dependency from cron package.json.

**Verification:**
- Manual Railway run. Verify accounts processed, rows written to PG.
- One full nightly cycle observed without errors.

**Estimated: 3-4 hours**

**Module 8 total: 11-14 hours.**

---

### Project 3 schedule

| Module | PRs | Estimated hours |
|---|---|---|
| 4. dataStore split | 1 | 6-8 |
| 5. Vendor | 4 | 20-28 |
| 6. Invoice | 3 | 28-38 |
| 7. Smart Inventory | 3 | 30-40 |
| 8. Cron (separate repo) | 2 | 11-14 |
| Buffer (PR D equivalents) | - | 8-12 |
| **TOTAL** | **13** | **105-145** |

Buffer accounts for cutover-verification finds (like PR #78 timestamp drift in submissions migration).

---

## 5. Cutover Protocol

Each module's cutover follows the same shape:

1. **Pre-flight:** verify PG schema applied. Verify dataStore adapters present. Verify dual-write flag NOT yet set (no dual-write yet).
2. **Enable dual-write:** Vercel env `DUAL_WRITE_TABLES` += `<module tables>`. Wait for deploy. Verify deploy succeeded.
3. **Single-row smoke test:** make one live edit through the production UI. Check PG row appeared and matches the Sheets row byte-for-byte (using normalize functions for any format differences).
4. **Run backfill:** `npm run backfill:<module> -- --execute`. Verify counts.
5. **Read-flip:** Vercel env `READ_FROM_POSTGRES_<MODULE>` = `<tables>`. Wait for deploy.
6. **Verification:** load the production UI. Spot check 3+ flows. Run any module-specific verification scripts.
7. **Rollback ready:** if anything looks wrong, REMOVE the READ flag (Vercel env edit). Reads revert to Sheets immediately on redeploy. Dual-write keeps PG state current during the rollback period.

### Vercel env progression

| Step | Env var changes |
|---|---|
| Start of Module 5 cutover | `DUAL_WRITE_TABLES` += `vendor_master,vendor_accounts,vendor_aliases` |
| Module 5 read-flip | `READ_FROM_POSTGRES_OPS` += `vendor_master,vendor_accounts,vendor_aliases` |
| Start of Module 6 cutover | `DUAL_WRITE_TABLES` += `invoice_submissions_26,ai_line_items,gl_codes,invoice_rejections` |
| Module 6 read-flip | `READ_FROM_POSTGRES_OPS` += `invoice_submissions_26,ai_line_items,gl_codes,invoice_rejections` |
| Start of Module 7 cutover | `DUAL_WRITE_TABLES` += `item_catalog,storage_locations,count_sessions,count_items,item_aliases,price_history,merge_history,review_queue,zone_corrections` |
| Module 7 read-flip | `READ_FROM_POSTGRES_OPS` += (same 9 tables) |
| Cron PR 1 deploys | No Vercel env change. Cron operates on its own env vars in Railway. |
| Cron PR 2 deploys | Drop `HUB_SHEET_ID` from Railway env. |
| End of project | Optional: drop tables from `DUAL_WRITE_TABLES`. NOT recommended per cutover.js DECOMMISSION NOTE - leave Sheets writes active as rollback net. |

### Cron coordination special handling

Cron fires at 6am UTC. Flips must happen during the 23-hour idle window (between 6:30am UTC and 5:30am UTC the next day - leave buffer on each side).

Specific rules:
- **Cron PR 1 deploy:** any time outside the 6am UTC fire window. Verify on the next nightly cron run.
- **Cron PR 2 deploy:** same. Plus, Module 7 read-flip must be deployed and stable BEFORE Cron PR 2 deploys.
- **Module 7 read-flip:** any time outside the 6am UTC fire window. The intranet reads switch to PG; the cron continues writing to PG (since it's been dual-writing since Cron PR 1). No coordination race.

If something looks wrong during cron testing: rollback by deploying the previous cron version + clearing Railway env vars added in PR 1.

### Rollback procedure (per module)

If post-flip the UI looks broken:

1. **Immediately remove the READ flag from Vercel env.** Production reverts to Sheets on next deploy.
2. **Investigate.** Sheets and PG are still in sync (dual-write active). Compare expected vs actual reads.
3. **Fix:** either a code bug in the dataStore orchestrator or a schema/index issue.
4. **Re-flip the READ flag.** Verify.
5. If pattern repeats: keep dual-write active indefinitely. PG-as-read-source is optional. Sheets remains the source of truth until the orchestrator is confirmed correct.

---

## 6. Risk Register

| ID | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| R1 | Cron + intranet write-coordination bugs during dual-write window | HIGH | Cron PR 1 ships only after Module 7 fully cut over (intranet dual-write enabled, read-flip done). One-way coupling means intranet's writes to merge_history hit PG via intranet's dual-write; cron reads those PG rows directly. No Sheets->PG drift possible. | Kevin |
| R2 | vendor_master.aliases auto-learning race (3 writers today) | MEDIUM -> LOW | PG migration eliminates race via UNIQUE constraint on (vendor_id, alias_normalized). ON CONFLICT DO NOTHING is atomic. | Schema design |
| R3 | Bill.com / Rippling stamped PDF format dependency | HIGH | Migration touches data layer, not PDF generation. stampInvoice.js unchanged. Test against actual Bill.com import using a sample stamped PDF before any PR ships. | Manual verification |
| R4 | AI cost spike if migration logic re-triggers OCR on existing invoices | HIGH | All AI handlers (photo-gate, ocr, consistency-check, line-item-scan) stay as-is. Migration touches data writes only, never re-invokes the AI handlers. Verification: monitor Anthropic API cost during cutover windows. Set alert at 2x baseline. | Monitoring |
| R5 | Backfill duration for AI_LINE_ITEMS (~3800 rows + per-account complexity) | MEDIUM | Backfill is one-time, off-hours. Run on a Saturday morning when no live invoice submissions expected. Backfill script has dry-run mode + per-account chunking. | Backfill design |
| R6 | Schema decision regrets (e.g., primary_vendor FK is wrong, JSONB merged_item_ids is wrong) | MEDIUM | Schema decisions are reversible via ALTER TABLE. Most risk is in primary_vendor FK: unresolvable freeform strings during backfill must be logged loudly so Kevin can review before cutover. | Backfill verification |
| R7 | accountMatch removal breaks something not yet identified | MEDIUM | Audit identified 2 callers (inventoryActions.js, cron). Both adapt to the new canonical format. Test thoroughly during backfill (any rows with non-canonical account_key must be normalized in-flight). | PR 7.2 verification |
| R8 | CHECK constraint on account_key fails backfill if any row has non-canonical format | MEDIUM | Backfill normalizes any non-canonical values before INSERT. If backfill encounters a value it can't normalize, log loudly and skip the row. Cutover not allowed until skip count = 0. | Backfill design |
| R9 | F24 dedup partial UNIQUE INDEX rejects valid corrections | LOW | Index excludes `status='corrected'` rows + rows with `corrected_from_uuid` set. Verify with a corrected submission backfill. | Index design |
| R10 | Vendor matcher consolidation breaks OCR vendor detection | MEDIUM | Before PR 5.2 ships, run the new shared lib against a representative set of OCR'd vendor names + verify output matches today's fuzzyMatchVendor. Document any intentional behavior changes. | PR 5.2 verification |
| R11 | dataStore.js split (PR 4.1) breaks an import that's not surfaced by build/lint | LOW | Mitigation: `dataStore/index.js` re-exports everything. All existing callers using `@/lib/dataStore` keep working. Verification: grep for `@/lib/dataStore` and confirm all callers still resolve. | PR 4.1 verification |
| R12 | Cron uses different vendor matching algorithm than intranet | LOW | Cron is a separate repo with its own normalizeName. New `src/lib/vendorMatching.js` is intranet-only. Document this as intentional. Future: extract to a shared npm package if it becomes a problem. | Documentation |
| R13 | Plaintext portal credentials surface in unexpected logs / responses | MEDIUM | Existing code already returns them in vendor-list response (intentional per TEAM_KNOWLEDGE). Migration must not introduce new surfaces. Code review: any new log statement, API field, or admin tool that touches portal_password requires explicit Kevin sign-off. | Code review |
| R14 | dataStore.js > 3000 LOC mid-migration if PR 4.1 doesn't ship first | LOW | PR 4.1 is the dependency for all subsequent finance work. Block Module 5 until PR 4.1 ships. | Sequencing |
| R15 | RLS policies missing or incorrect at cutover | TBD | Today: PG access only via service_role. No RLS needed for migration. Separate AUTH_MODEL.md follow-up adds row-level filtering. | Out of Project 3 scope |

---

## 7. What Stays Unchanged

Verbatim from THREESYSTEMS brief "Things that should NOT change in the migration":

- **Service-account-only writes (universal pattern).** User OAuth stays identity-only.
- **Cross-account visibility** (intentional for floor operations).
- **Plaintext portal credentials** (intentional for shift continuity).
- **Photo Gate leniency** (only blocks non-documents). Tightening it generates support tickets.
- **AI prompt-embedded rules** (unit normalization, vendor name patterns, etc.). Iteration speed > codification.
- **count_items append-only pattern.** Audit trail.
- **Stamped PDF format.** Bill.com/Rippling depend on it.
- **Slack notification webhooks.** AP, ops, and cron team all watch these channels.

In addition, this migration explicitly preserves:

- **All AI handlers** (photo-gate, ocr, consistency-check, line-item-scan, ai-similarity-check). Data layer only.
- **Drive folder structure** and PDF filename format (cosmetic unification deferred to backlog per BR2).
- **Gmail send path.** Two encoder coexistence deferred to backlog per D4.
- **F19a/F19b/F24/F25 idempotency semantics.** Moved from runtime checks to PG constraints, but the user-facing contract is unchanged.
- **MAINTENANCE_MODE flag in InvoiceTool.js.** Operator bypass list stays.
- **localStorage state in InvoiceTool.js** (last_account, offline_queue, recent_vendors, gl_usage).
- **The 7 Smart Inventory stub handlers.** They keep returning "Week 3" / "Week 4" per BR3.

---

## 8. Open Items After Planning

These need Kevin's input before specific PRs can ship:

### RLS policy decision (BLOCKS no PR; needed before AUTH_MODEL.md follow-up)

- **Today:** all finance PG tables accessible only via service_role (default). No RLS policies on the tables.
- **Stage 2 (future):** RLS based on `users.role` per AUTH_MODEL.md.
- **Project 3 decision:** stay with service-role-only access. Application layer admin gates (OPS_LEADERSHIP_EMAILS) remain authoritative.

This is the working assumption. Confirm before PR 5.1 ships.

### primary_vendor resolution during backfill (BLOCKS PR 7.3)

- **Q1 decision:** primary_vendor is FK to vendors.id.
- **Backfill challenge:** today's item_catalog.primaryVendor is freeform string. Some strings won't resolve to any vendor (typos, dropped vendors).
- **Decision needed:** for unresolvable strings, do we:
  - (a) Leave null + log for Kevin to manually fix?
  - (b) Auto-create a "placeholder" vendor for each unique unresolvable string?
  - (c) Reject the inventory_items row entirely and require Kevin to resolve before cutover?
- **Recommendation: (a)** - log loudly, leave null, run cutover, fix manually post-cutover.

Confirm before PR 7.3 ships.

### BR4 dedup constraint timing (BLOCKS PR 7.1)

- **Decision:** retire both dedup tools. Add UNIQUE (account_key, lower(name)) on inventory_items.
- **Backfill challenge:** Sheets data may already have duplicates that violate this constraint.
- **Decision needed:** how do we handle existing duplicates during backfill?
  - (a) Backfill in two phases: load without constraint, run a dedup pass, then add the constraint
  - (b) Resolve duplicates manually before backfill (Kevin reviews + merges them via ai-similarity-check)
  - (c) Add the constraint as DEFERRABLE INITIALLY DEFERRED + let the backfill transaction roll up duplicates
- **Recommendation: (a) or (b)**. (a) is automated but yields stale audit trail (merges happen without merge_history records). (b) is manual but cleaner.

Confirm before PR 7.1 ships.

### Cutover order: Module 5 before Module 6, or together?

- **Default:** sequential (Module 5 fully cut over, then Module 6 starts).
- **Alternative:** Module 5 PRs and Module 6 PRs can ship in parallel since their tables don't share dependencies (invoice_submissions FK to vendors but the FK doesn't activate until both are migrated).
- **Decision needed:** prefer sequential (safer, easier rollback) or parallel (faster but more cognitive load)?
- **Recommendation: sequential**, but ship Module 6 PR 6.1 (schema only) concurrent with Module 5 to save calendar time.

### Stub handler explicit list (informational; no PR blocked)

Per BR3, the 7 stub handlers stay as stubs. The plan needs to be explicit about which ones:

1. `handleUpdateItem` (line 398): returns "Week 3"
2. `handleScan` (line 1060): returns "Week 3"
3. `handleHistoryGet` (line 1061): returns `{ success: true, sessions: [] }`
4. `handleReviewQueueGet` (line 1062): returns `{ success: true, items: [] }`
5. `handleResolveQueue` (line 817): returns "Week 3"
6. `handleAdminCorrect` (line 1059): returns "Week 4"
7. `handlePrint` (line 1154): returns "Week 3"

All stay returning the same response strings post-migration.

### `is_purchasing` classification rule (BLOCKS PR 6.3)

- **Q8 decision:** add `is_purchasing` to gl_codes.
- **Classification rule:** today the runtime filter excludes:
  - Categories: `income`, `kitchen labor costs`, `meal service`, `wages`, `insurance`, `professional fees`
  - Items: `telephone expense`, `paid time off`, `medical/dental/vision`, `charitable contributions`
- **Decision needed:** confirm this classification rule for backfill. Any additional categories/items to exclude?

Confirm before PR 6.3 ships.

---

## 9. Document Maintenance

This document is the working reference for Project 3. Expect it to evolve.

### Update rules

- **When a decision changes:** update Section 3 with a new row showing the new decision + date + reason. Don't delete the old row; add a "Superseded by" note.
- **When a PR ships:** link the PR # from the relevant module/PR in Section 4. Example: change `#### PR 5.1: ...` to `#### PR 5.1 (shipped #93): ...`.
- **When a risk materializes:** update Section 6 with what happened + how it was mitigated. Add new risks as they emerge.
- **When the cutover sequence changes:** update Section 5 + the corresponding module in Section 4.

### Versioning

This doc is canonical only on `main`. Working changes during a PR should be committed to that PR's branch + merged together with the code.

### Cross-references

- `docs/FINANCE_STACK_AUDIT.md` (PR #83): the code-level audit this plan builds on.
- `docs/SUPABASE_MIGRATION.md`: the older strategic doc for the migration as a whole. Contains the original schema sketches for vendor + invoice that this plan refines.
- `docs/AUTH_MODEL.md`: the future RLS decision. Project 3 stays out of scope for this.
- `docs/PROJECT_DASHBOARD.md`: tracks PRs shipped. Update as Project 3 PRs land.

### End of plan

---

*Generated 2026-05-28. Substrate: PR #83 (audit). Builds on Kevin's locked decisions.*

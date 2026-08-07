-- kpi-8ba-presence-and-earning-type-map.sql
--
-- KPI PR 8b - part A: presence projection + earning_type_map.
--
-- Two independent infrastructure pieces that PR 8b's derivation depends
-- on. Neither renders anything by itself. PR B builds `labor_actuals`,
-- the nightly derivation, and the /kpi/labor page on top of both.
--
-- Motivation, from four probe rounds and four paystub reconciliations
-- (2026-08-04 through 2026-08-07):
--
-- 1. Presence projection.
--    rippling_raw_pay_segments is append-only and correctly retains rows
--    for pay-segment IDs Rippling has since retired. On 2026-08-06, 753
--    IDs in the raw table were absent from Rippling's current walk.
--    Summing the _latest view includes those retired IDs alongside their
--    live replacements, reporting $843,065 against a true $717,486 -
--    17.5% over truth, every account affected. The raw table cannot
--    carry the live/retired distinction by design (it must keep both
--    observations for audit). Presence is the projection that answers
--    "which rippling_ids did the last successful walk actually see."
--    Written on successful walk, replaced atomically, gated on
--    plausibility so a broken API returning zero rows does not empty
--    the table.
--
-- 2. earning_type_map + earning_type_unmapped.
--    Rippling's `overtime_multiplier` field is null on every non-OT
--    earning type including `Holiday Double Rate`, which pays 2x - the
--    doubling lives in the rate, not the multiplier. Rippling has also
--    been observed changing earning-type NAMES three ways in four
--    months: two spellings of overtime (`Overtime(1.5x Base)` and
--    `1.5x Overtime`), a rename of regular time from `Base Pay` to
--    `Regular` at the 2026-06-29 pay run (measured: zero time_entry.id
--    carrying both labels), and a third naming convention on paystubs
--    (`Base Pay` even where the API returns `Regular`). Any regex
--    classifier is fragile against that. A lookup table with unmapped
--    types routing to a visible bucket per N5 is the durable fix.
--
--    earning_type_unmapped is the visibility surface. D37 requires
--    unmapped types be visible; a scrolling GitHub Actions log line is
--    not visible. Two earning types have already surfaced only after
--    external evidence forced them out - Holiday Double Rate went
--    unnoticed until a VP questioned a number, PTO Hours until Kevin
--    pulled paystubs. The derivation upserts every unmapped name it
--    sees into this table with running counts + magnitude, so a sixth
--    type surfaces as a DB row a human can query, not a log line no
--    one reads. Rows are never deleted; when Kevin maps a new type,
--    `resolved_at` is set and the record of how long the type was
--    unmapped stays as the answer to "how long were we misfiling
--    this."
--
-- Design decisions committed in playbook v0.7 (D36, D37):
--
--   D36 - Presence FILTERS in the derivation; orphans surface as
--         coverage gaps. Never fall back to a retired observation,
--         never reconstruct a figure for a labor fact with no present
--         row. Orphan counts emit per account nightly; the affected
--         week reads `hours_only`.
--
--   D37 - Earning types resolve through `earning_type_map`. Never a
--         name regex, never `overtime_multiplier`. Unmapped types
--         route to a visible bucket and are never silently treated
--         as regular.
--
-- This PR:
--   - Adds tables + one atomic RPC.
--   - Does NOT create labor_actuals, labor_unattributed, any derivation,
--     or any presence-filter on an existing query. That is PR B.
--   - Does NOT backfill historical presence. Presence describes now,
--     not then. First successful walk after apply establishes the
--     current set.
--
-- Grants:
--   service_role gets what it needs to write walks + swap presence.
--   No UPDATE on rippling_current_presence (swap is DELETE + INSERT
--   inside the RPC). No INSERT on earning_type_map after seed
--   (additions go through a follow-up migration for auditability).
--
-- Applied: NOT YET (PR under review). Transactional; failure rolls
-- back the entire migration.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
BEGIN
  -- Half-applied guards: if any of the three tables already exists,
  -- assume a prior aborted apply. Do not attempt to reconcile in-place.
  IF to_regclass('public.rippling_walks') IS NOT NULL
     AND to_regclass('public.rippling_current_presence') IS NULL THEN
    RAISE EXCEPTION 'kpi-8ba pre-flight: rippling_walks exists but rippling_current_presence does not. Drop rippling_walks first and re-apply.';
  END IF;
  IF to_regclass('public.rippling_current_presence') IS NOT NULL
     AND to_regclass('public.rippling_walks') IS NULL THEN
    RAISE EXCEPTION 'kpi-8ba pre-flight: rippling_current_presence exists but rippling_walks does not. Drop rippling_current_presence first and re-apply.';
  END IF;
END $$;

-- ─── rippling_walks ────────────────────────────────────────────────
-- One row per (kind, walk attempt). Every attempt logs, whether it
-- succeeds or fails. A skipped nightly is diagnosable by absence of a
-- recent row for a kind; a broken API is diagnosable by a `failed` or
-- `failed_plausibility` row.
CREATE TABLE IF NOT EXISTS rippling_walks (
  id             BIGSERIAL PRIMARY KEY,
  kind           TEXT        NOT NULL CHECK (kind IN ('time_entries','pay_segments','workers','time_entry_zo')),
  source         TEXT        NOT NULL CHECK (source IN ('backfill','nightly','manual')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  status         TEXT        NOT NULL DEFAULT 'in_progress'
                 CHECK (status IN ('in_progress','success','failed','failed_plausibility')),
  ids_seen       INTEGER,
  pages          INTEGER,
  duration_sec   NUMERIC(10,2),
  error_message  TEXT
);

CREATE INDEX IF NOT EXISTS rippling_walks_kind_started_idx
  ON rippling_walks (kind, started_at DESC);

CREATE INDEX IF NOT EXISTS rippling_walks_status_idx
  ON rippling_walks (status);

-- ─── rippling_current_presence ─────────────────────────────────────
-- The "which IDs did Rippling return in the last successful walk"
-- projection. Rewritten atomically by commit_walk_success(). Steady-
-- state size across all four kinds: ~19k rows total on today's data
-- (9,405 + 4,304 + 1,126 + 4,100).
CREATE TABLE IF NOT EXISTS rippling_current_presence (
  kind         TEXT   NOT NULL CHECK (kind IN ('time_entries','pay_segments','workers','time_entry_zo')),
  rippling_id  TEXT   NOT NULL,
  walk_id      BIGINT NOT NULL REFERENCES rippling_walks(id),
  PRIMARY KEY (kind, rippling_id)
);

CREATE INDEX IF NOT EXISTS rippling_current_presence_walk_idx
  ON rippling_current_presence (walk_id);

-- ─── earning_type_map ──────────────────────────────────────────────
-- Lookup keyed on `merged_earning_type_name` (the field on every
-- pay-segment payload). Seeded with the five types observed portfolio-
-- wide across probe rounds E and R2 and validated against four paystubs
-- 2026-08-07.
CREATE TABLE IF NOT EXISTS earning_type_map (
  merged_earning_type_name TEXT PRIMARY KEY,
  multiplier   NUMERIC(3,1) NOT NULL,
  bucket       TEXT NOT NULL CHECK (bucket IN ('regular','overtime','double_time','unmapped')),
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT
);

INSERT INTO earning_type_map (merged_earning_type_name, multiplier, bucket, notes) VALUES
  ('Base Pay',            1.0, 'regular',
   'Pre-2026-06-29-pay-run label for regular time. Rippling changed to Regular; both must map identically. Verified against paystub 2026-08-07 (paystub displays Base Pay while API returns Base Pay or Regular per era).'),
  ('Regular',             1.0, 'regular',
   'Post-2026-06-29-pay-run label for regular time. Same pay behaviour as Base Pay; the difference is temporal, not semantic.'),
  ('Overtime(1.5x Base)', 1.5, 'overtime',
   'One of two OT spellings observed portfolio-wide. Multiplier = 1.5 exact.'),
  ('1.5x Overtime',       1.5, 'overtime',
   'Second OT spelling observed on the same portfolio, same accounts.'),
  ('Holiday Double Rate', 2.0, 'double_time',
   'overtime_multiplier is null on this type; the doubling lives in the rate itself. Counts toward the weekly 40-hour OT threshold per P6.2. Any classifier keying on overtime_multiplier > 1.0 misfiles this as regular.')
ON CONFLICT (merged_earning_type_name) DO NOTHING;

-- ─── earning_type_unmapped ─────────────────────────────────────────
-- Visibility surface for earning types the derivation encounters that
-- are not in earning_type_map. Upserted on first sight; running totals
-- updated on every subsequent sighting. When Kevin maps the type in a
-- follow-up migration, resolved_at is set - the row stays as the record
-- of how long the type was unmapped.
--
-- Why running totals rather than a foreign key to raw rows: magnitude
-- must be visible without a join. A chef or Kevin querying this table
-- should see the dollar exposure of an unmapped type immediately, not
-- have to construct a query against the raw pay-segments table.
CREATE TABLE IF NOT EXISTS earning_type_unmapped (
  merged_earning_type_name TEXT PRIMARY KEY,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurrence_count INTEGER     NOT NULL DEFAULT 0,
  total_hours      NUMERIC     NOT NULL DEFAULT 0,
  total_amount     NUMERIC     NOT NULL DEFAULT 0,
  resolved_at      TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS earning_type_unmapped_unresolved_idx
  ON earning_type_unmapped (last_seen_at DESC) WHERE resolved_at IS NULL;

-- ─── RPC: commit_walk_success ──────────────────────────────────────
-- Single atomic operation. Called by scripts/rippling_sync.mjs after
-- each walk that returns ok=true. Does the plausibility check, swaps
-- presence for the kind, and marks the walk row success or
-- failed_plausibility - all in one transaction.
--
-- Plausibility rule: new_count must be >= 50% of the most recent
-- successful walk's ids_seen for the same kind. Below that, refuse
-- the swap and mark the walk failed_plausibility. Additional floor:
-- never allow an empty walk (< min_examined, default 1) to succeed.
--
-- First-run bootstrap: if no prior successful walk exists for the
-- kind, only the min_examined floor applies. This lets the first
-- walk after apply establish the baseline.
--
-- SECURITY DEFINER because it needs to DELETE from
-- rippling_current_presence, which service_role also has directly -
-- but centralising the swap in one function keeps the invariant
-- (atomic swap + walk status update in one transaction) enforceable.
CREATE OR REPLACE FUNCTION commit_walk_success(
  p_walk_id       BIGINT,
  p_kind          TEXT,
  p_ids           TEXT[],
  p_pages         INTEGER,
  p_duration_sec  NUMERIC,
  p_min_examined  INTEGER DEFAULT 1
) RETURNS TABLE(result_status TEXT, ids_written INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prev_count INTEGER;
  new_count  INTEGER;
BEGIN
  new_count := COALESCE(array_length(p_ids, 1), 0);

  -- Verify walk exists and is in_progress for this kind
  IF NOT EXISTS (
    SELECT 1 FROM rippling_walks
    WHERE id = p_walk_id AND kind = p_kind AND status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'commit_walk_success: walk id=% kind=% not found or not in_progress', p_walk_id, p_kind;
  END IF;

  -- Get most recent successful walk's count for this kind
  SELECT ids_seen INTO prev_count
  FROM rippling_walks
  WHERE kind = p_kind AND status = 'success'
  ORDER BY completed_at DESC
  LIMIT 1;

  -- Floor: never allow a walk below the minimum. Zero is never plausible.
  IF new_count < p_min_examined THEN
    UPDATE rippling_walks
    SET status         = 'failed_plausibility',
        completed_at   = NOW(),
        ids_seen       = new_count,
        pages          = p_pages,
        duration_sec   = p_duration_sec,
        error_message  = format('walk returned %s rows; below min_examined=%s', new_count, p_min_examined)
    WHERE id = p_walk_id;
    RETURN QUERY SELECT 'failed_plausibility'::TEXT, 0;
    RETURN;
  END IF;

  -- Half-of-previous check (only when we have a previous baseline).
  -- prev_count is INTEGER; cast to NUMERIC so /2 is real division not
  -- integer truncation. Immaterial in practice on today's row counts
  -- but the rounded threshold is clearer to state and read.
  IF prev_count IS NOT NULL AND new_count < (prev_count::NUMERIC / 2) THEN
    UPDATE rippling_walks
    SET status         = 'failed_plausibility',
        completed_at   = NOW(),
        ids_seen       = new_count,
        pages          = p_pages,
        duration_sec   = p_duration_sec,
        error_message  = format('walk returned %s rows; previous successful walk had %s (below 50%% threshold)', new_count, prev_count)
    WHERE id = p_walk_id;
    RETURN QUERY SELECT 'failed_plausibility'::TEXT, 0;
    RETURN;
  END IF;

  -- Atomic swap: upsert new set, then delete anything under this kind
  -- that is not tagged with this walk's id.
  INSERT INTO rippling_current_presence (kind, rippling_id, walk_id)
  SELECT p_kind, unnest(p_ids), p_walk_id
  ON CONFLICT (kind, rippling_id) DO UPDATE
    SET walk_id = EXCLUDED.walk_id;

  DELETE FROM rippling_current_presence
  WHERE kind = p_kind AND walk_id <> p_walk_id;

  -- Mark walk success
  UPDATE rippling_walks
  SET status        = 'success',
      completed_at  = NOW(),
      ids_seen      = new_count,
      pages         = p_pages,
      duration_sec  = p_duration_sec
  WHERE id = p_walk_id;

  RETURN QUERY SELECT 'success'::TEXT, new_count;
END $$;

-- ─── Grants ────────────────────────────────────────────────────────
-- rippling_walks: full CRUD except DELETE (walk history is audit).
GRANT SELECT, INSERT, UPDATE ON rippling_walks TO service_role;
GRANT USAGE, SELECT ON SEQUENCE rippling_walks_id_seq TO service_role;

-- rippling_current_presence: SELECT + INSERT + DELETE (needed for swap).
-- The RPC does the atomic version; direct access is available for
-- integrity checks and PR B's read path.
GRANT SELECT, INSERT, DELETE ON rippling_current_presence TO service_role;

-- earning_type_map: SELECT only. Seed rows land via this migration;
-- future additions land via a follow-up migration for auditability
-- (same discipline as the department map).
GRANT SELECT ON earning_type_map TO service_role;

-- earning_type_unmapped: SELECT + INSERT + UPDATE. Derivation upserts
-- (insert on first sight, update running totals + last_seen_at after).
-- No DELETE - resolution sets resolved_at rather than removing the row,
-- so the history of how long a type was unmapped survives.
GRANT SELECT, INSERT, UPDATE ON earning_type_unmapped TO service_role;

-- RPC executable by service_role
GRANT EXECUTE ON FUNCTION commit_walk_success(BIGINT, TEXT, TEXT[], INTEGER, NUMERIC, INTEGER) TO service_role;

-- ─── Post-flight sanity ────────────────────────────────────────────
DO $$
BEGIN
  -- Seed integrity
  IF (SELECT COUNT(*) FROM earning_type_map) <> 5 THEN
    RAISE EXCEPTION 'post-flight: earning_type_map should have exactly 5 seed rows, has %', (SELECT COUNT(*) FROM earning_type_map);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM earning_type_map WHERE merged_earning_type_name = 'Holiday Double Rate') THEN
    RAISE EXCEPTION 'post-flight: earning_type_map missing Holiday Double Rate seed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM earning_type_map WHERE bucket = 'double_time') THEN
    RAISE EXCEPTION 'post-flight: earning_type_map missing double_time bucket row';
  END IF;

  -- Presence + walks + unmapped empty at apply time
  IF (SELECT COUNT(*) FROM rippling_walks) <> 0 THEN
    RAISE EXCEPTION 'post-flight: rippling_walks should be empty at apply time';
  END IF;
  IF (SELECT COUNT(*) FROM rippling_current_presence) <> 0 THEN
    RAISE EXCEPTION 'post-flight: rippling_current_presence should be empty at apply time';
  END IF;
  IF (SELECT COUNT(*) FROM earning_type_unmapped) <> 0 THEN
    RAISE EXCEPTION 'post-flight: earning_type_unmapped should be empty at apply time';
  END IF;

  -- Grants
  IF NOT has_table_privilege('service_role', 'rippling_walks', 'INSERT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing INSERT on rippling_walks';
  END IF;
  IF NOT has_table_privilege('service_role', 'rippling_current_presence', 'DELETE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing DELETE on rippling_current_presence (needed for swap)';
  END IF;
  IF NOT has_table_privilege('service_role', 'earning_type_map', 'SELECT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing SELECT on earning_type_map';
  END IF;
  IF has_table_privilege('service_role', 'earning_type_map', 'INSERT') THEN
    RAISE EXCEPTION 'post-flight: service_role has INSERT on earning_type_map (should be SELECT-only; additions go through follow-up migrations)';
  END IF;
  IF NOT has_table_privilege('service_role', 'earning_type_unmapped', 'INSERT') THEN
    RAISE EXCEPTION 'post-flight: service_role missing INSERT on earning_type_unmapped';
  END IF;
  IF NOT has_table_privilege('service_role', 'earning_type_unmapped', 'UPDATE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing UPDATE on earning_type_unmapped';
  END IF;
  IF has_table_privilege('service_role', 'earning_type_unmapped', 'DELETE') THEN
    RAISE EXCEPTION 'post-flight: service_role has DELETE on earning_type_unmapped (should be SELECT/INSERT/UPDATE only; resolution sets resolved_at rather than removing the row)';
  END IF;

  -- RPC exists and is executable
  IF NOT has_function_privilege('service_role',
    'commit_walk_success(bigint, text, text[], integer, numeric, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'post-flight: service_role missing EXECUTE on commit_walk_success';
  END IF;
END $$;

COMMIT;

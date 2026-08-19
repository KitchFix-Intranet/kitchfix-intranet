-- rippling-presence-external-id-view.sql
--
-- Presence extension · defence in depth for the 2026-08-19 rippling_id
-- re-issue class. Adds a view `rippling_current_presence_ext` that
-- joins `rippling_current_presence` to `rippling_raw_pay_segments_latest`
-- and exposes `external_id` alongside the presence row. Any future
-- consumer that wants the logical-segment dedup key can SELECT from
-- the view instead of re-implementing the JSONB unpack + join.
--
-- The hotfix (#716) put the dedup where it belongs first - inside the
-- derive's pay-segment load, so today's write path is safe. This view
-- exists so a NEW consumer (a probe, a report, a follow-on derive)
-- does not have to know about the re-issue class to write correct
-- code. See scripts/_probe_derive_pay_segments_s1i.mjs header for the
-- rule "measure the input, consume deduped".
--
-- Header choices, cited so a future reader does not "clean them up":
--
--   VIEW, not a table:
--     Presence itself is populated by commit_walk_success() (kpi-8ba)
--     which does not touch pay-segment payloads. Adding an
--     external_id column to the presence table would require changing
--     the RPC to unpack the payload on every walk commit, which
--     mutates the source of truth for defensive purposes. A view is
--     read-side only, cannot lie about the join, and is free to
--     recompute on every SELECT. Zero write-path risk.
--
--   Kind-scoped join:
--     Only `pay_segments` currently has `external_id` semantics. The
--     view LEFT JOINs pay-segment _latest to fetch external_id for
--     that kind and returns NULL for every other kind. When another
--     kind (e.g. compensations) gains a stable external key, extend
--     with a UNION or CASE branch here - the join is the natural
--     documentation of "what is deduppable".
--
--   LEFT JOIN, not INNER:
--     A rippling_id in presence but missing from _latest is an
--     inconsistency worth noticing at read time, not silently
--     dropping. Consumer can filter WHERE external_id IS NOT NULL
--     when they want dedup, and can COUNT(*) FILTER (WHERE
--     external_id IS NULL) to catch drift between presence and the
--     _latest view.
--
--   No dedup baked into the view:
--     The view exposes external_id per rippling_id one-to-one. A
--     consumer that wants dedup does SELECT DISTINCT ON (external_id)
--     or GROUP BY external_id explicitly. Baking dedup in would hide
--     the re-issue signal that S1i measures; better to leave that
--     surface visible.
--
--   Grants mirror rippling_current_presence:
--     SELECT to service_role. Views inherit their base tables' RLS,
--     but explicit GRANT keeps the intent auditable.
--
-- Applied: TBD in Supabase Studio.

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.rippling_current_presence') IS NULL THEN
    RAISE EXCEPTION 'presence-ext pre-flight: rippling_current_presence missing - kpi-8ba must land first';
  END IF;
  IF to_regclass('public.rippling_raw_pay_segments_latest') IS NULL THEN
    RAISE EXCEPTION 'presence-ext pre-flight: rippling_raw_pay_segments_latest missing - kpi-8a must land first';
  END IF;
END $$;

-- ─── rippling_current_presence_ext view ─────────────────────────────
-- One row per (rippling_id, kind) from presence, plus the logical
-- dedup key (external_id) for pay_segments. Other kinds get NULL.
-- Consumer semantics:
--   dedup pay_segments: SELECT DISTINCT ON (external_id) ...
--     WHERE kind = 'pay_segments' AND external_id IS NOT NULL
--   detect drift:       SELECT COUNT(*) FROM ... WHERE kind = 'pay_segments'
--     AND external_id IS NULL      -- rippling_id in presence but no
--                                     matching row in _latest view
CREATE OR REPLACE VIEW rippling_current_presence_ext AS
SELECT
  p.rippling_id,
  p.kind,
  p.walk_id,
  CASE
    WHEN p.kind = 'pay_segments' THEN r.payload->>'external_id'
    ELSE NULL
  END AS external_id
FROM rippling_current_presence p
LEFT JOIN rippling_raw_pay_segments_latest r
  ON p.kind = 'pay_segments'
 AND p.rippling_id = r.rippling_id;

-- ─── Grants ─────────────────────────────────────────────────────────
GRANT SELECT ON rippling_current_presence_ext TO service_role;

-- ─── Post-flight ────────────────────────────────────────────────────
DO $$
DECLARE
  v_sel BOOLEAN;
  total_rows BIGINT;
  ps_rows BIGINT;
  ps_with_ext BIGINT;
BEGIN
  IF to_regclass('public.rippling_current_presence_ext') IS NULL THEN
    RAISE EXCEPTION 'post-flight: rippling_current_presence_ext missing';
  END IF;

  v_sel := has_table_privilege('service_role', 'rippling_current_presence_ext', 'SELECT');
  IF NOT v_sel THEN
    RAISE EXCEPTION 'post-flight: service_role missing SELECT on rippling_current_presence_ext';
  END IF;

  -- Sanity: view row count matches the base presence row count.
  -- The LEFT JOIN cannot inflate; every presence row appears exactly
  -- once. If this is not true, the join has a duplicate on the
  -- _latest side which would indicate the DISTINCT ON in the
  -- _latest view is broken - not this migration's bug, but worth
  -- surfacing.
  SELECT COUNT(*) INTO total_rows FROM rippling_current_presence_ext;
  IF total_rows <> (SELECT COUNT(*) FROM rippling_current_presence) THEN
    RAISE EXCEPTION 'post-flight: view row count (%) does not match presence row count (%) - LEFT JOIN inflated', total_rows, (SELECT COUNT(*) FROM rippling_current_presence);
  END IF;

  -- Report pay_segments coverage.
  SELECT COUNT(*) INTO ps_rows FROM rippling_current_presence_ext WHERE kind = 'pay_segments';
  SELECT COUNT(*) INTO ps_with_ext FROM rippling_current_presence_ext WHERE kind = 'pay_segments' AND external_id IS NOT NULL;
  RAISE NOTICE 'presence-ext post-flight PASS - view present, service_role SELECT granted, total_rows=% pay_segments=% with_external_id=%', total_rows, ps_rows, ps_with_ext;
END $$;

COMMIT;

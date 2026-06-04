-- ════════════════════════════════════════════════════════════════════════════
-- INV-1 follow-up: widen price_history UNIQUE key
-- ════════════════════════════════════════════════════════════════════════════
-- Original constraint UNIQUE (item_id, source_or_invoice_id) assumed
-- one price entry per (item, invoice). INV-3 backfill discovered the
-- cron actually writes line-item-level entries, so a single invoice can
-- legitimately produce multiple price_history rows for the same item at
-- distinct prices (Shape B1: 59 keys / 87 rows in the audit). Within-run
-- exact-duplicate writes from the cron (Shape A1: 44 keys / 92 rows) are
-- a separate cron loop bug tracked under Module 8.
--
-- The new key (item_id, source_or_invoice_id, price) preserves the
-- intent (one row per distinct line) while accommodating the cron's
-- real write pattern. A1 within-run dupes are deduped in the INV-3
-- backfill (scripts/backfill-inventory.mjs Phase 5). The cron's
-- ON CONFLICT pattern moves from
--   ON CONFLICT (item_id, source_or_invoice_id) DO NOTHING
-- to
--   ON CONFLICT (item_id, source_or_invoice_id, price) DO NOTHING
-- (cron update lands with the Module 8 cron migration).
--
-- Safe because price_history is currently empty (INV-3 Phase 5 rolled
-- back during the original apply attempt).
--
-- USAGE
--   Paste this whole file into Supabase Studio's SQL editor and run.
--   Then: node --env-file=.env.local scripts/verify-inv-1-price-unique-fix.mjs
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE price_history
  DROP CONSTRAINT price_history_item_id_source_or_invoice_id_key;

ALTER TABLE price_history
  ADD CONSTRAINT price_history_item_id_source_or_invoice_id_price_key
  UNIQUE (item_id, source_or_invoice_id, price);

-- ── merge_inventory_items RPC: keep NOT EXISTS check aligned with key ──
-- Only Phase 3 (price_history reassignment) changes: the NOT EXISTS
-- check now also matches on price. Without this, two B1 line items on
-- the dupe item at different prices would have one wrongly dropped at
-- merge time. The rest of the RPC (idempotency guard, alias
-- reassignment, archival, header + junction inserts) is unchanged
-- from the inv-1 schema.

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
  v_existing_merge_id     uuid;
  v_keeper                inventory_items%ROWTYPE;
  v_account               text;
  v_aliases_reassigned    int := 0;
  v_prices_reassigned     int := 0;
  v_dupes_archived        int := 0;
  v_dupe_id               text;
  v_dupe_row              inventory_items%ROWTYPE;
  v_dupe_count            int := COALESCE(array_length(p_dupe_ids, 1), 0);
BEGIN
  SELECT * INTO v_keeper FROM inventory_items WHERE id = p_keeper_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'merge_inventory_items: keeper % not found', p_keeper_id;
  END IF;
  IF v_keeper.status <> 'active' THEN
    RAISE EXCEPTION 'merge_inventory_items: keeper % is not active (status=%)', p_keeper_id, v_keeper.status;
  END IF;
  v_account := v_keeper.account;

  SELECT mh.id INTO v_existing_merge_id
    FROM merge_history mh
   WHERE mh.action = 'merge'
     AND mh.keeper_item_id = p_keeper_id
     AND (
       SELECT COUNT(*) FROM merge_history_items
        WHERE merge_id = mh.id AND role = 'merged'
     ) = v_dupe_count
     AND NOT EXISTS (
       SELECT 1 FROM unnest(p_dupe_ids) AS dupe_id
        WHERE NOT EXISTS (
          SELECT 1 FROM merge_history_items
           WHERE merge_id = mh.id
             AND role     = 'merged'
             AND item_id  = dupe_id
        )
     )
   ORDER BY mh.created_at DESC
   LIMIT 1;

  IF v_existing_merge_id IS NOT NULL THEN
    RETURN json_build_object(
      'merge_id',             v_existing_merge_id,
      'aliases_reassigned',   0,
      'prices_reassigned',    0,
      'dupes_archived',       0,
      'idempotent',           true
    );
  END IF;

  IF p_canonical_name IS NOT NULL AND p_canonical_name <> v_keeper.name THEN
    UPDATE inventory_items
       SET name = p_canonical_name,
           updated_at = now()
     WHERE id = p_keeper_id;
  END IF;

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

  DELETE FROM item_aliases WHERE item_id = ANY(p_dupe_ids);

  -- Phase 3 reassignment: NOT EXISTS guards against UNIQUE key collisions.
  -- Widened to (item_id, source_or_invoice_id, price) so B1 line-item
  -- entries at different prices on the dupe survive.
  WITH reassigned AS (
    UPDATE price_history
       SET item_id = p_keeper_id
     WHERE item_id = ANY(p_dupe_ids)
       AND NOT EXISTS (
         SELECT 1 FROM price_history existing
          WHERE existing.item_id              = p_keeper_id
            AND existing.source_or_invoice_id = price_history.source_or_invoice_id
            AND existing.price                = price_history.price
       )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_prices_reassigned FROM reassigned;

  DELETE FROM price_history WHERE item_id = ANY(p_dupe_ids);

  WITH archived AS (
    UPDATE inventory_items
       SET status = 'archived',
           updated_at = now()
     WHERE id = ANY(p_dupe_ids)
       AND status <> 'archived'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_dupes_archived FROM archived;

  INSERT INTO merge_history (
    account, keeper_item_id, canonical_name, action, email
  ) VALUES (
    v_account, p_keeper_id, COALESCE(p_canonical_name, v_keeper.name), 'merge', p_email
  ) RETURNING id INTO v_merge_id;

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

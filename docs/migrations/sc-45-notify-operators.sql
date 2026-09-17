-- ═══════════════════════════════════════════════════════════════════
-- sc-45-notify-operators
--
-- Decouple operator-notification suppression from qbo_mode. Pre-
-- training punch list item 4 (Kevin ruling 2026-09-17).
--
-- WHY
-- Today `qbo_mode` on sc_qbo_account_map couples two decisions:
--   1. Which QBO customer receives the invoice draft (test ZZ TEST
--      22463 vs the account's real customer_id).
--   2. Who receives the four notification types (N1 invoice-ready,
--      N2 push-failed, N3.reminder Sunday, N3.urgent Monday).
--
-- resolveRecipients in src/lib/billing/recipients.js short-circuits
-- to Kevin-only when mode='test'. The intended weekend-shape for
-- CIN-AZ + TXR-AZ has real QBO invoices going out (mode='live')
-- with notifications held to Kevin alone until Monday. Under the
-- current schema those cannot be requested independently.
--
-- SHAPE
-- New column `notify_operators BOOLEAN NOT NULL DEFAULT TRUE`.
--   TRUE  - resolveRecipients emits the live-mode recipient set for
--           every notification type. Current behavior.
--   FALSE - resolveRecipients emits { to: [Kevin], cc: [] } for every
--           notification type, regardless of qbo_mode. Mirrors the
--           test-mode recipient collapse but does NOT touch the QBO
--           customer fence.
--
-- Both structural overrides collapse to Kevin, so ordering between
-- them is immaterial (one wins, both would have anyway).
--
-- DEFAULT
-- TRUE preserves current live-mode behavior for every existing row.
-- No backfill required. Kevin sets FALSE only on accounts entering
-- the silent-operators weekend.
--
-- CONSUMERS THAT MUST LAND IN THE SAME PR
--   - src/lib/billing/recipients.js
--       Second structural override after the mode='test' branch,
--       collapsing to Kevin when accountMap.notifyOperators === false.
--   - src/lib/scWeekFinalize.js:511
--       Add notifyOperators to resolverAccountMap normalizer:
--         `notifyOperators: accountMap.notify_operators !== false`
--       The SELECT * at line 483 picks up the new column.
--   - src/app/api/cron/sc-chase/route.js
--       Add notify_operators to the two explicit SELECT column lists,
--       and thread notifyOperators through the two accountMap objects
--       passed to fireN3.
--
-- Three-block Studio pattern (preflight / main / postflight).
-- Idempotent: block B's ADD COLUMN IF NOT EXISTS is a no-op after
-- the first apply.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK A: preflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm the column does NOT exist yet (pre-apply state).
-- Expected: zero rows.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_account_map'
  AND column_name  = 'notify_operators';

-- Snapshot current sc_qbo_account_map contents so post-apply
-- diffs are visible. Expected: N rows, no notify_operators
-- column present.
SELECT account_key, qbo_mode, cadence, active
FROM sc_qbo_account_map
ORDER BY account_key;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK B: main (single transaction, idempotent)
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE sc_qbo_account_map
  ADD COLUMN IF NOT EXISTS notify_operators BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN sc_qbo_account_map.notify_operators IS
  'When FALSE, resolveRecipients (recipients.js) collapses every notification (N1, N2, N3.reminder, N3.urgent) to Kevin only regardless of qbo_mode. Decouples silent-operator behavior from the QBO customer fence. Default TRUE preserves existing live-mode recipients. sc-45 (2026-09-17).';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- BLOCK C: postflight (READ-ONLY - safe to re-run)
-- ═══════════════════════════════════════════════════════════════════

-- Confirm the column exists with the expected shape.
-- Expected: one row, data_type=boolean, is_nullable=NO,
--          column_default=true.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'sc_qbo_account_map'
  AND column_name  = 'notify_operators';

-- Confirm every existing row shows notify_operators=true (the
-- backfill via DEFAULT). Expected: every row true.
SELECT account_key, qbo_mode, notify_operators
FROM sc_qbo_account_map
ORDER BY account_key;

-- Kevin's Friday flip (pilots enter silent-operators live mode):
--   UPDATE sc_qbo_account_map
--      SET qbo_mode = 'live',
--          notify_operators = FALSE,
--          changed_at = now()
--    WHERE account_key IN ('CIN - AZ', 'TXR - AZ');
--
-- Monday morning restore (silent window closes):
--   UPDATE sc_qbo_account_map
--      SET notify_operators = TRUE,
--          changed_at = now()
--    WHERE account_key IN ('CIN - AZ', 'TXR - AZ');

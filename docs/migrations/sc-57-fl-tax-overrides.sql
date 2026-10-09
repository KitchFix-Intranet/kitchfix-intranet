-- sc-57 - FL line-level tax overrides
-- Kevin ruling 2026-10-07 (Sebastian billing meeting), Chat-Claude design 2026-10-09.
-- Sets three sc_qbo_service_map rows to non-taxable. Data only; no schema change.
-- Mechanism is identical to the live CIN - AZ coffee/fountain overrides
-- (items 3371/3372, tax_override='NON'); buildInvoicePayload already emits a
-- line-level NON TaxCodeRef when tax_override is set.
-- Kevin applies this in Studio. Three blocks, run one at a time.

-- ============================================================
-- BLOCK A - preflight (read-only). Confirm the 3 target rows.
-- ============================================================
SELECT account_key, qbo_item_id, COALESCE(tax_override,'(null)') AS tax_override,
       invoice_slot, active
FROM sc_qbo_service_map
WHERE (account_key='TBR - FL' AND qbo_item_id='3392')
   OR (account_key='TBJ - FL' AND qbo_item_id IN ('3432','3433'))
ORDER BY account_key, qbo_item_id;
-- EXPECT: exactly 3 rows, all tax_override = (null), all active = true.
-- If the count is not 3, or any already has a non-null tax_override, STOP and
-- report - do not run Block B.

-- ============================================================
-- BLOCK B - main (one transaction).
-- ============================================================
BEGIN;
UPDATE sc_qbo_service_map
   SET tax_override = 'NON', changed_at = now()
 WHERE active = true
   AND tax_override IS DISTINCT FROM 'NON'
   AND ( (account_key='TBR - FL' AND qbo_item_id='3392')       -- Extended Day Labor: payroll reimbursement, not revenue
      OR (account_key='TBJ - FL' AND qbo_item_id IN ('3432','3433')) );  -- MiLB + MLB pantry: non-taxable pass-through
-- EXPECT: UPDATE 3
COMMIT;

-- ============================================================
-- BLOCK C - postflight (read-only). Confirm.
-- ============================================================
SELECT account_key, qbo_item_id, tax_override, invoice_slot
FROM sc_qbo_service_map
WHERE (account_key='TBR - FL' AND qbo_item_id='3392')
   OR (account_key='TBJ - FL' AND qbo_item_id IN ('3432','3433'))
ORDER BY account_key, qbo_item_id;
-- EXPECT: all 3 rows now tax_override = 'NON'.

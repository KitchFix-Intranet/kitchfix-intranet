-- purchasing-11: comment on purchasing_actuals.vendor_or_merchant so the
-- next code walk finds the resolved-name view without a code trip-up.
--
-- Context: R15 investigation found the raw column stores bill.com
-- vendor IDs on billcom rows and merchant strings on rippling_spend
-- rows.  Any consumer that reads it directly and treats it as a
-- display name gets a UUID for every bill.com row - the "Beau Davis
-- Electric" resolve pattern.  All display paths resolve via
-- v_purchasing_actuals_billcom_named; nothing but that view should
-- read vendor_or_merchant for a name.
--
-- One column comment, non-destructive, idempotent.

COMMENT ON COLUMN purchasing_actuals.vendor_or_merchant IS
  'Raw source-of-truth: billcom rows store bill.com vendor UUIDs; rippling_spend rows store the merchant string. Do NOT read this as a display name - use v_purchasing_actuals_billcom_named (joins billcom_ref_vendors) for the resolved name. See R15 investigation notes (2026-08-27).';

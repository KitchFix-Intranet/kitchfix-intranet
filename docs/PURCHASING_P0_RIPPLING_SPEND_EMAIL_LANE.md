# RIPPLING SPEND - THE SCHEDULED-REPORT EMAIL LANE (path 4a) - design note

Kevin confirmed 2026-08-18: Rippling custom reports CAN be scheduled to email. That makes this
a real unattended lane, not a fallback. It runs regardless of what CC's API spike finds - if
the spike lands path A or B this lane is retired; if C, this IS the source.

## The shape

  Rippling report (scheduled, daily 06:00 CT, CSV attachment)
      -> a dedicated inbox or label in the KitchFix Gmail
      -> a small ingest job (nightly, alongside the bill.com sync) that reads the newest
         attachment via the Gmail integration already wired to this stack
      -> parses CSV against a FIXED, VERSIONED column contract
      -> upserts into `rippling_spend_raw` (idempotent on transaction id)
      -> derive step maps merchant / category / department -> site + GL line
      -> lands in `purchasing_actuals` beside bill.com rows, source = 'rippling_spend'

## The report Kevin builds (Rippling admin) - column contract v1

Build one saved report on Spend transactions with EXACTLY these columns, in this order. The
parser is keyed on header names, so names matter more than order, but keep the order for
sanity:
  transaction_id        (Rippling's id - the idempotency key; MUST be present)
  transaction_date
  posted_date
  amount
  currency
  merchant_name
  merchant_category      (MCC or Rippling's category label)
  cardholder_name        (needed to map to site via user_accounts; not displayed anywhere)
  card_last4
  department             (or entity / work location - whichever Rippling carries per card)
  gl_account             (if Spend is coded in Rippling; blank is fine, we map)
  memo
  receipt_status
  approval_status
Then: Schedule -> daily -> deliver to <inbox> -> CSV. Set the date filter to "yesterday" or
"last 7 days" (7 is safer - late-posting transactions get picked up; idempotency dedupes).

Once the first email arrives, forward it and I will write the parser to the actual headers.

## Site attribution - the hard part, and how it resolves

Card transactions do not carry an account_key. Three fallbacks, in order:
  1. department / entity on the card -> maps to a site if Rippling cards are issued per site
  2. cardholder -> user_accounts (already 31 rows from the SC work) -> their home account
  3. unmapped -> an exception bucket that surfaces on the board as "unattributed card spend"
     with a count, never silently dropped
GL line: merchant_category is a decent proxy (fuel MCCs -> 3500.4, restaurant/grocery ->
3200.1, hardware -> 3400.2), but the honest v1 is a lookup table Kevin/Sebastian maintain per
merchant, seeded from the first month of data. Anything unmapped lands in an "uncoded card
spend" bucket - visible, not hidden.

## Idempotency + failure posture (same rules as labor)

Upsert on transaction_id. A re-sent report never double-counts. If no email arrives for 48h the
SYSTEM strip shows the card lane as stale, exactly like the payroll feed. A malformed CSV is
rejected whole and logged - never partially loaded.

## What Kevin does now
  1. Build the report with the columns above.
  2. Schedule it to email. Send the first one to the inbox Kevin picks (a label works too).
  3. Tell me the inbox/label; I will read the first attachment via Gmail and write the
     contract to the real headers.

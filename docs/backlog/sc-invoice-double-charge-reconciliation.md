# SC-generated invoices · double-charge reconciliation probe

**Filed:** 2026-09-18, during sc-48 (SC-generated invoice numbers).
**Status:** Open. Not blocking the sc-48 ship.
**Priority when reopened:** high once live invoice volume grows. AZ
pilots are live now; risk is present, not theoretical.

---

## Read this line first

**Sebastian's ruling on sc-48 was about invoice NUMBERS.** His words:
"No problem if a # is skipped. Duplicate invoice #s is where the
issue would be."

**This risk is about invoice INVOICES, not invoice numbers.** It
produces two real invoices carrying two DIFFERENT numbers for one
service week - both correctly numbered under the burn model, but
one of them is a phantom Sebastian never intended to raise.

**The next person reading "duplicates are the problem" must not
conclude the risk is handled.** It is not. Sebastian's ruling
prevents same-number duplicates. This backlog item prevents
different-number-same-service-week duplicates. Different failure
modes, same downstream harm - a client billed twice for one
week - detected by different means.

---

## The failure mode

`qboAdapter.postInvoiceDraft` under sc-48 reserves `KF000000042`,
injects it into the payload, POSTs to QBO, awaits response.

**Two seams where a 2xx response leaves the ledger recording
`failed` while QBO actually created the invoice:**

1. `qboAdapter.js:527` — HTTP 2xx with a body that does not parse
   as JSON. QBO stored the invoice with our sent DocNumber, our
   side records `failed` because we cannot read the response.
2. Network drop mid-response, post-commit — TCP RST between QBO's
   commit and our client seeing the response body. Rare but real
   on any network path with proxies (we go through an ngrok
   tunnel; that path has more moving parts than a direct call).

**On retry** (manual, via `buildRetryLink` — the current retry
path from `scWeekFinalize.js:437`):

- `readLiveLedgerRow` at `qboAdapter.js:254-268` filters on
  `status='created' AND is_test=false`. The `failed` row from
  attempt 1 does not match; idempotency short-circuit does not
  fire.
- Fresh `nextval` reserves `KF000000043`.
- POST succeeds. Ledger records `created` with `qbo_doc_number =
  KF000000043` and `qbo_invoice_id = <new QBO Id>`.

**Result**: QBO now holds two live invoices for `(account, week,
slot)` - `KF000000042` from the first (silently-succeeded) attempt
and `KF000000043` from the retry. Both are real. Both are charged.
No collision on DocNumber because they differ. Sebastian discovers
via reconciliation, if at all.

---

## Estimated likelihood

Two independent probability estimates:

**Class A · 2xx non-JSON**. QBO's Intuit API is well-behaved. In
the current 17 test + 6 live pushes, zero non-JSON 2xx responses
observed. Baseline: **<1 in 1,000 pushes**.

**Class B · Network drop mid-response**. We route through an
ngrok tunnel + a proxy Josh maintains. Proxy availability is not
five-nines. Estimated: **~1 in 500 pushes** during proxy hiccups.

Combined per-push failure probability: **~1 in 300**.

**Projected impact over 12 months**:

- AZ pilots today: 2 accounts × ~4 pushes/month = 8 pushes/month
  = ~100 pushes/year.
- Adding more accounts as sc-45's `notify_operators` flip covers
  them: 6-8 accounts × 4 pushes/month = ~350 pushes/year at full
  rollout.
- **Expected double-charge events**: 0.3 - 1.2 per year at
  current volume, higher as more accounts flip live.

Rare is not never. The risk grows with adoption.

---

## Recommended probe

Daily cron. One query, two directions.

**Direction 1 — orphan QBO invoices** (the load-bearing signal):

```sql
-- Every KF-prefixed DocNumber in QBO that does NOT appear in
-- sc_export_ledger. These are invoices QBO stored that we have
-- no record of - either a bug in our ledger write path OR the
-- Case D double-charge described above.
--
-- Runs against a periodically-refreshed local mirror of QBO
-- invoices (there is no direct QBO->Postgres FK; the reconciler
-- pulls `SELECT * FROM Invoice WHERE DocNumber LIKE 'KF%'` from
-- QBO and stages it before running this).
SELECT qbo_invoice_id, qbo_doc_number, qbo_txn_date, qbo_total
FROM qbo_invoice_mirror
WHERE qbo_doc_number LIKE 'KF%'
  AND qbo_doc_number NOT IN (
    SELECT qbo_doc_number FROM sc_export_ledger
    WHERE qbo_doc_number IS NOT NULL
  );
```

Expected result: zero rows in normal operation. Any row here is
the smoke on a Case D event.

**Direction 2 — orphan ledger rows** (informational, not alarming):

```sql
-- Every KF-prefixed DocNumber in sc_export_ledger that does NOT
-- appear in QBO. These are usually fence-rejected rows (never
-- attempted the POST - qbo_doc_number is null for those, so
-- filtered out) or push-failed rows where QBO genuinely never
-- created the invoice.
SELECT id, account_key, week_start, invoice_slot, qbo_doc_number,
       status, attempt, error, created_at
FROM sc_export_ledger
WHERE qbo_doc_number LIKE 'KF%'
  AND status IN ('failed')
  AND qbo_doc_number NOT IN (
    SELECT qbo_doc_number FROM qbo_invoice_mirror
    WHERE qbo_doc_number IS NOT NULL
  );
```

Expected result: rows here are gap events (attempt made, QBO
never stored). No action, just visibility.

**Alerting rule**: any row in Direction 1 = page Kevin.
Direction 2 informational only.

---

## Cost estimate

- **QBO mirror table + refresh cron**: half a day. `sc_qbo_invoice_mirror`
  with columns (`qbo_invoice_id`, `qbo_doc_number`, `qbo_customer_id`,
  `qbo_txn_date`, `qbo_total_cents`, `synced_at`). Refresh cron pulls
  Invoice records with `DocNumber LIKE 'KF%'` from QBO daily; upserts.
- **Reconciliation probe**: 1 hour. Two SELECTs + Slack integration
  for Direction-1 alerts.
- **Backfill**: not needed for the current 6 live invoices - they
  pre-date sc-48 and carry `qbo_doc_number = null`, so they never
  appear in either direction.

Total: 1 day of build, mostly the mirror refresh.

---

## Why not fix sc-48 to eliminate this class

Considered and rejected:

- **Detect "same payload_hash reappeared after failed" at
  reservation time**. Under sc-48, `payload_hash` is computed
  post-DocNumber-injection, so each attempt has a distinct hash.
  Would require recomputing an alternate content-only hash. Adds
  a second identifier without eliminating the race.
- **Look up QBO by our sent DocNumber before reserving a new one
  on retry**. Requires a QBO API call per retry, doubles the
  latency, and the "QBO stored what we sent" case is exactly the
  case where QBO's search for that DocNumber may not have caught
  up to it yet.
- **Return the failed number to the pool instead of burning**.
  Kevin ruled against this earlier in sc-48 for the correct
  reason: returning risks same-number duplicates, which is what
  Sebastian's ruling protects against. The trade wraps around.

**Detection is the right layer.** The gap-permitting burn design
is safe on the number axis; the reconciliation probe is the
detector for the invoice axis.

---

## Ordering when this reopens

1. Land the QBO mirror table + daily refresh (separate PR).
2. Ship the two-direction reconciliation probe + Slack alert on
   Direction 1.
3. First observed alert: manual triage. Kevin + Sebastian decide
   which invoice to void in QBO. Ledger annotated.
4. If alerts recur, revisit the "detect at reservation" approach
   with the mirror as the lookup source.

Not urgent while pilot volume is small. Should ship before the
first non-pilot account flips live.

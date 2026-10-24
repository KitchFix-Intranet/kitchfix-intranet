# Genuinely-unresolvable vendor-credit gate

**Filed:** 2026-09-04, from R-71 Stage 2 followup.
**Rewritten:** 2026-09-04, after root cause changed the shape of the gate.
**Status:** Deferred. Not scheduled.
**Trigger to unpark:** any operator report of a missing vendor credit;
or a Slack post from the guard once it lands; or as soon as the R-71
arc calms.

---

## What changed since the first draft

The first draft of this file (2026-09-04 morning) proposed a nightly
guard that would fire whenever the non-billed-back total of null-GL
credits moved above `$0`. That was based on the diagnosis that credits
without a chart-of-accounts classification were vanishing silently.

**The diagnosis was wrong.** All 113 supposedly-null-GL credits carried
proper chart_of_account_id values on their line items.
`billcom_ref_accounts` holds 1,072 rows;
`scripts/purchasing_billcom_credits_sync.mjs:87` was loading via
`.range(0, 9999)` which Supabase silently caps at 1000. The 72
truncated rows held the mappings these credits needed. Root cause was
pagination truncation in our loader, not vendor misclassification.

The pagination fix + HIT_CAP guard shipped in PR #1019 addresses the
root cause. Of the 113 credits re-derived:
- 106 go to `1385.X` inventory accounts (reimbursable bucket -
  correctly invisible on the KPI cost surface)
- 3 go to `1374.1` (reimbursable, invisible)
- 3 go to `3200.1.2` food (visible on TXR - AZ food line, -$71.13)
- 1 to `1373.5` (reimbursable, invisible)

**Zero credits are genuinely unclassified.** A guard that would have
fired every day on 113 correctly-classified inventory credits is the
"check nobody can fail" problem in reverse: a check that always fails
teaches people to ignore it.

## The right shape of the gate

The gate should fire only when the sync itself finds a
chart_of_account_id that IS present on the credit line but ABSENT from
`billcom_ref_accounts` after a **successful, untruncated** reference
refresh. That is a real data-side defect (either bill.com added a new
chart entry between the last ref refresh and now, or the vendor is
using a coa id we've never seen). Everything else that would have
looked like "null-gl" is either:

- ingested but not maintained (billcom_ref_accounts refresh failed) -
  caught by the bills-sync's `HIT_CAP` guard at
  `scripts/purchasing_billcom_sync.mjs:260`
- pagination truncation on our side - caught by the credits sync's
  new `loadWithCapGuard()` (PR #1019)
- correctly classified to a non-COGS bucket (inventory, reimbursable) -
  intentionally not on the KPI surface

Nothing left for the nightly gate to fire on except the genuine case.

## What to build

Add a check that runs at the END of the credits sync (after the
derive step completes and after HIT_CAP verification passes). Query:

```sql
SELECT COUNT(*)                      AS unresolvable_lines,
       COUNT(DISTINCT source_bill_id) AS credits,
       SUM(amount)                    AS dollars
FROM   purchasing_actuals
WHERE  source = 'billcom_credit'
  AND  gl_line_code IS NULL
  AND  posting_date >= (NOW() - INTERVAL '30 days');
```

If `unresolvable_lines > 0`:
- Enumerate the offending `chart_of_account_id` values by joining
  `purchasing_actuals` back to `billcom_raw_vendor_credit_lines_latest`
  on `source_line_id`.
- Emit a loud signal (Slack post to ops channel with per-vendor
  breakdown, the missing coa ids, and the dollar total).
- Non-zero exit from the sync so the workflow shows RED.

If `unresolvable_lines = 0`: one-line "credits gate: clean" log
entry, exit 0. Presence of that log line is the "the check ran"
freshness signal - absence means the guard itself failed to run, per
the "health signals survive the pipeline" rule.

**Do NOT threshold on non-billed-back totals or on any raw null-gl
count.** Both are pre-remediation shapes that fire on correct
behaviour. The only signal worth waking someone up for is "we
ingested a credit that references a chart entry our reference table
does not have."

## Related guards this depends on

- `loadWithCapGuard()` in
  `scripts/purchasing_billcom_credits_sync.mjs` (PR #1019) - the sync
  fails loudly on Supabase-side truncation of ref-accounts, so any
  null-gl remaining after a successful sync really is unresolvable.
- Bills sync `HIT_CAP` at `scripts/purchasing_billcom_sync.mjs:260` -
  fails the refresh of billcom_ref_accounts if bill.com's
  `/chartOfAccounts` cursor doesn't exhaust. If ref-accounts is
  truncated on the bill.com side, the credits derive would see stale
  mappings and this gate would fire spuriously. The bills-side guard
  prevents that.

Both must pass before this gate's signal means what it claims.

## Cost estimate

Small. Maybe 30 lines including the SQL, the Slack payload, and a
smoke test. Half a day. Cheaper than the first draft because the
guard scope shrank dramatically once the root cause was diagnosed.

## Related

- `scripts/probes/audit_null_gl_credits.mjs` - on-demand deep-dive
  audit; keep as a probe.
- `scripts/probes/audit_null_gl_credits_csv.mjs` - CSV export tool
  with the applied-bill fanout that surfaced the diagnosis.
- PR #1019 - HIT_CAP guard + nightly workflow inclusion + one-off
  re-derive of the original 113 credits.
- R-71 Stage 2 PR #1016 - the arc that surfaced the whole class.

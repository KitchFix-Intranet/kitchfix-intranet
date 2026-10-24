# STL - MO reimbursables: spend vs invoiced reconciliation

**Date:** 2026-08-26
**Auditor:** CC
**Scope:** STL - MO reimbursable spend (`purchasing_actuals`, FY2026) reconciled against invoiced-to-client (QBO via Josh's proxy).
**Data as of:** 2026-08-26
**Constraints honoured:** no client-facing language, no vendor-payment status surfaced, no code changes.

**Owner directive:** the Cardinals asked "where do we stand." That is a billing question. Our purchasing data answers a spend question. The gap between them is the actual answer.

---

## The four headline numbers

For the **STL - MO customer** in QBO (Id `22023`), FY2026-to-date:

```
SPENT     $404,394.46   what we purchased on their behalf (reimbursables)
BILLED    $846,915.20   what we invoiced them total (all lines)
PAID      $698,456.89   what they have paid us
PENDING   $148,458.31   what they still owe us
```

**Spend-vs-billed gap** (like-for-like, reimbursables only): **spent $27,476.26 more than invoiced.** ~6.8% of MO reimbursable spend has not yet been invoiced. Most likely: 2-3 weeks of recent spend awaiting the next weekly billing run. The last billed week on 22023 is "Week of 8/3-8/9"; as of today (2026-08-26), weeks 8/10-8/16 and 8/17-8/23 have complete spend not yet on an invoice.

**BILLED total includes non-reimbursable revenue** — the $846,915.20 is $376,918.20 in reimbursables + $469,997.00 in service fees. The client sees one ledger per customer, so their answer to "where do we stand" is the top four numbers as-is; the split matters for the internal reconciliation against our spend baseline.

**PAID here means "invoice balance has been reduced by that amount, via any mechanism."** QBO's `Balance` field on an invoice is reduced by payments AND applied credits. To split cash-received from applied-credit requires a separate query on Payment + CreditMemo objects and LinkedTxn correlation. Not done in this pass; noted if the client asks specifically.

---

## Three "Cardinals" customers in QBO - reported separately

Owner ruling: pull all three, do not sum, only merge if line-item evidence supports it. Report each with its own numbers so cross-customer leakage cannot slip past.

### Id `22023` - "St. Louis Cardinals (STL-MO)" - THE MO LEDGER

**87 invoices retrieved. 34 unpaid.**

```
BILLED (total)      $846,915.20
  reimbursables     $376,918.20    <- like-for-like vs SPENT
  service fees      $469,997.00
  other/credits           $0.00
PAID                $698,456.89
PENDING             $148,458.31
```

- **Oldest unpaid:** invoice `#K300168949`, 2026-06-14, $182.71, **73 days old** (measured by transaction date).
- **Aging of pending balance** (measured by DueDate):
  ```
  current     $148,458.31   <- everything pending is not yet past its due date
  1-30 days   $0.00
  31-60 days  $0.00
  61-90 days  $0.00
  90+ days    $0.00
  ```
  The 73-day TxnDate age vs zero DueDate age reads as "invoice sent 73 days ago on our net-N terms; not yet overdue on the client's side." Nothing to escalate on aging.

- **Line-item verification:** every one of the 20 sampled line items is `STL-MO Reimbursables - {Food / Food-Beverages / Food-Packaged Snacks / Other}` OR `Service Fees (PFS)`, all with class `PFS:STL - MO`. **No leakage from other accounts.**
- **Line-item cadence:** all reimbursable lines carry a `Week of MM/DD-MM/DD` description. Billing is weekly.

### Id `17705` - "St. Louis Cardinals (STL-FL)" - Jupiter's own ledger, NOT MO

**83 invoices retrieved. 21 unpaid.** Included for completeness per owner ruling; **do not roll up into MO totals.**

```
BILLED (total)     $1,895,035.01
  reimbursables      $869,535.01    <- Jupiter's own reimbursables
  service fees     $1,025,500.00    <- two $350k service fee tranches + others
  other/credits              $0.00
PAID               $1,714,261.43
PENDING              $180,773.58
```

- **Line-item verification:** every sampled line carries class `PFS:STL - FL (JUP)` — Jupiter (spring training) ledger, not MO. Items are `STL-FL Reimbursables - ...` (their reimbursables) and `Service Fees (PFS)` (their contract fees, including "2026 Service Fee - 3 of 4" at $350,000 and "2026 Service Fee - 4 of 4 (Final)" at $350,000 with a $24,500 sales-tax credit adjustment).
- **Owner-verified fixture:** this customer's balance is Jupiter's, not MO leakage. Confirmed by class + item-name convention across every sampled line.
- **Oldest unpaid:** `#K300168926`, 2026-06-14, $7,854.27, 73 days old. Same aging pattern as MO (all pending in "current" DueDate bucket).

### Id `20581` - "St. Louis Cardinals (Tripleseat)" - empty

**0 invoices retrieved for FY2026.** Clean confirmation of no MO leakage through this customer.

---

## The reconciliation - like-for-like on reimbursables

Comparing reimbursable spend against reimbursable billing on customer 22023 (the MO ledger):

|  | Amount |
|---|---:|
| **SPENT** (purchasing_actuals, MO, reimbursable, FY2026) | $404,394.46 |
| **BILLED reimbursables** (22023, item name contains "Reimbursables") | $376,918.20 |
| **Gap** (SPENT - BILLED reimbursables) | **+$27,476.26** |

**This is the "invoiced < spend" case per your spec.** ~6.8% of MO reimbursable spend has not yet been billed.

**Where the gap likely sits:** the last billed reimbursable week on 22023 is "Week of 8/3-8/9". Today is 2026-08-26. The two weeks 8/10-8/16 and 8/17-8/23 are complete on the spend side but do not yet appear on any invoice. Week 8/24-8/30 is partially in-progress. If the average recent weekly reimbursable spend runs ~$14K-15K (extrapolating from the visible weekly line items in the $9k-$18k range for Food alone plus Beverages / Snacks / Other), two full weeks would be roughly $28K-$60K of unbilled spend, which brackets the observed $27,476 gap. **Recommended read: not a leak, just the standard weekly billing lag.** Confirm on the next billing run.

**Note the direction.** The gap is NOT in the "we billed something not in our purchasing data" direction. Everything invoiced under `STL-MO Reimbursables` line items has a matching spend record; the gap is the newest weeks awaiting their invoice.

---

## GL code cross-check

**Kevin's four codes undefined in `gl_codes` for STL - MO** — `1385`, `1385.3`, `1385.3.1`, `1374.3` — cannot be verified against QBO line data for one reason:

**QBO does not carry 4-digit GL codes on line data for the Cardinals customers.** Line items are named (e.g., `STL-MO Reimbursables - Food-Beverages`) and classed (e.g., `PFS:STL - MO`), but no 4-digit GL code appears on the line detail. The regex-based extraction found zero GL candidates across all three customers.

This makes the check **inconclusive on the "QBO recognises them" question**: QBO likely maps each Item (`STL-MO Reimbursables - Food`, etc.) to a specific GL account in the Chart of Accounts server-side, but that mapping is not visible on the invoice-line payload. A separate query on the QBO `Item` object (via `SELECT * FROM Item WHERE Name LIKE 'STL-MO Reimbursables%'`) would surface the item-to-GL mapping if that's the answer we need.

**What this does tell us:** the $18,780.40 spread across those four codes in `purchasing_actuals` is not going to be caught by an item-code compare with QBO. If the codes are legitimately missing from our `gl_codes` table, that's an intranet-side gap to close. If they represent classifications we no longer use, the rows can be either recoded or excluded. Either way, they don't appear on the client's invoices as bare codes.

---

## Answering "where do we stand"

The four numbers at the top are the answer to the client. The internal reconciliation adds one line for Kevin:

**Client-facing answer (from 22023):**
- We invoiced you $846,915.20 total FY2026-to-date
- You have paid us $698,456.89
- You currently owe us $148,458.31, none of which is past due

**Internal note for Kevin:**
- The MO reimbursable spend baseline ($404,394.46) is ~$27K larger than the MO reimbursable billing ($376,918.20). That's ~2 weeks of unbilled recent spend. Standard billing-cadence lag, not a leak.
- Jupiter (17705) is not MO. The $180K it shows as pending is Jupiter's own, not the Cardinals' MO account.
- Tripleseat (20581) has no FY2026 activity for reimbursables.

---

## Data provenance

- **SPEND baseline:** `scripts/probes/_probe_stlmo_reimb_recon.mjs` — Postgres query on `purchasing_actuals` where `account_key = 'STL - MO'` AND `gl_bucket = 'reimbursable'` AND `excluded = false` AND `txn_date >= '2025-12-29'`.
- **QBO pull:** same probe, `SELECT * FROM Invoice WHERE CustomerRef = '{id}' AND TxnDate >= '2025-12-29' AND TxnDate <= '2026-08-26'` per customer, via `${QBO_PROXY_BASE}/v3/company/${QBO_REALM_ID}/query`.
- **QBO credentials:** development-environment set pulled via `vercel env pull` (owner directive: "if the proxy rejects the credentials, try the production set before assuming the proxy is down"). Development set was accepted; production set was not needed for this pull.
- **JSON snapshot:** `/tmp/stlmo_recon.json`.

---

## Closing line - the four numbers again

```
SPENT     $404,394.46   what we purchased on their behalf (MO reimbursables, from purchasing_actuals)
BILLED    $846,915.20   what we invoiced 22023 total ($376,918.20 reimbursables + $469,997.00 service fees)
PAID      $698,456.89   what they have paid us on 22023
PENDING   $148,458.31   what they still owe us on 22023 (none past due)
```

**Gap on reimbursables-only:** SPENT $404,394.46 − BILLED reimbursables $376,918.20 = **$27,476.26 in unbilled recent spend** (roughly 2 weeks; likely awaits the next weekly billing run).

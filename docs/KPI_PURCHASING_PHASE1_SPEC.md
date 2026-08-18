# KPI PURCHASING - PHASE 1 SPEC: the data layer
# 2026-08-18. Phase 0 is CLOSED - every source is confirmed by a live pull. No UI in this phase.

## 0. What Phase 0 settled (do not re-litigate)

  bill.com    SOURCE OF RECORD for vendor spend. Proxy endpoints live (Josh, 08-18):
              /billcom/bills/filtered?invoiceDateStart&invoiceDateEnd  (v2 envelope:
              response_data[]; server-side date filter; max 500/page; start offset)
              /billcom/chartofaccounts  (1,072 rows over 2 pages of 999; accountNumber IS
              our GL number - 3200.1 General Food, 3400.2 Supplies, 1371 TBJ Complex Pantry)
              /billcom/classes  (51; the 13 that matter map 1:1 to sites + CORP + CHI)
              /billcom/departments  (unused in FY2026 - ignore for v1)
              Line items carry chartOfAccountId AND actgClassId. Header amount == sum of line
              amounts on 409/409 P8 bills. 132 of 409 bills split across GL codes -> LINE-ITEM
              GRAIN IS MANDATORY.
  Rippling    `spend_transaction_line_item_zo` reachable on the existing key (CC spike #705).
              Amount, category id, department {id, display_value}, work_location, merchant via
              FK display_value. Parent object 400 (Rippling bug, ticket filed by Kevin).
  Invoice     Not the spend source. Category granularity + real-time + line items + the
  Capture     coverage KPI. Its audit (CC prompt P0d) runs in parallel to this phase.
  Budgets     Already in kpi_budgets, all 32 lines. Nothing to load.
  QBO         Not a route. Proxy blocks Purchase/Bill/JournalEntry/Account/Vendor.

## 1. Tables (schema-only migrations, applied by Kevin one statement at a time)

  billcom_raw_bills            one row per bill (v2 header). PK id. Columns: the v2 header
                               fields we use (vendorId, invoiceNumber, invoiceDate,
                               glPostingDate, amount, paidAmount, dueAmount, approvalStatus,
                               paymentStatus, createdTime, updatedTime, isActive) + raw jsonb
                               + content_hash + first_seen_at / last_seen_at + fetch_source.
                               UNIQUE (id). Content-hash uniqueness per the kpi-8a pattern so
                               refetching a period is a no-op.
  billcom_raw_bill_lines       one row per line item. PK id. billId FK, amount,
                               chartOfAccountId, actgClassId, departmentId, description,
                               lineOrder + raw jsonb + content_hash. UNIQUE (id).
  billcom_ref_accounts         chart of accounts snapshot: id, accountNumber, name,
                               accountType, isActive, parent. Refreshed nightly, full replace.
  billcom_ref_classes          id, name, isActive. Refreshed nightly.
  billcom_class_site_map       actgClassId -> account_key. SEEDED (13 rows, below) with an
                               `excluded` boolean for CORP and CHI. Owner-maintained.
  rippling_raw_spend_lines     one row per spend line item (id PK, external_id, amount,
                               currency, category_id, department_id, department_label,
                               work_location_id, work_location_label, merchant_name,
                               parent_txn_id, updated_at, embedded_document_id) + raw jsonb +
                               content_hash + first_seen_at. Same fetch_source stamping as
                               labor.
  spend_category_map           category_id -> label -> gl_line_code (nullable until Kevin
                               labels it). Populated with CANDIDATES by the first sync.
  spend_department_site_map    department_id -> department_label -> account_key (nullable),
                               `excluded` boolean (CORP prefixes 50xx-59xx default TRUE).
                               Populated with candidates by the first sync.
  purchasing_actuals           THE FACT TABLE the board reads. One row per (source,
                               source_line_id). Columns: source in ('billcom','rippling_spend',
                               'upload'), source_bill_id, source_line_id, account_key (nullable
                               -> unattributed), gl_line_code (nullable -> uncoded), gl_bucket
                               in ('pl_cogs','reimbursable','sga','other'), txn_date,
                               posting_date, amount, vendor_or_merchant, paid boolean,
                               derived_at. UNIQUE (source, source_line_id).
                               REVOKE TRUNCATE from anon/authenticated (money-adjacent).

  Views (for the route, not for the client):
  v_purchasing_by_site_period    account_key x fiscal period x gl_line_code -> sum(amount),
                                 count(lines), count(distinct bills), paid_amount
  v_purchasing_by_site_week      same at week grain (fiscal weeks, Mon-Sun, same enumerator
                                 as labor's periods.js)

## 2. The nightly sync (extend rippling-sync.yml or add purchasing-sync.yml - CC's call, say
   which; both run at 07:00 UTC unattended)

  billcom step
    a. refresh billcom_ref_accounts (2 pages) and billcom_ref_classes (full replace)
    b. bills: for the trailing window [today - 45d, today] via /bills/filtered on invoiceDate
       - 45 days because entry lag p90 is 16d and we want late-entered bills for a closed
       period to still land. Page with start/max=500 until empty. Upsert header + lines by
       content hash. ALSO on the 1st of each fiscal period: a full FY-to-date pass (one
       filtered call per period) so anything edited retroactively is caught.
    c. derive: rebuild purchasing_actuals rows for every bill touched in (b):
         account_key  = class_site_map[line.actgClassId].account_key
                        (null if class unmapped; row still written, account_key null)
         excluded     = class_site_map.excluded (CORP, CHI) -> row written with account_key
                        null AND excluded=true so it never sums anywhere but is auditable
         gl_line_code = ref_accounts[line.chartOfAccountId].accountNumber
         gl_bucket    = prefix rule: 32/34/35 -> pl_cogs · 13 -> reimbursable · 5 -> sga ·
                        else other
         txn_date     = bill.invoiceDate  (ACCRUAL - owner ruling 6.1: invoice date, not
                        payment date)
         posting_date = bill.glPostingDate
         paid         = paymentStatus in the paid set (v2 codes: confirm which numeric values
                        mean paid by cross-checking against paidAmount == amount; report the
                        mapping you settled on)
  rippling step
    a. walk custom-objects/spend_transaction_line_item_zo/records with the existing client,
       cursor-walk, upsert by content hash into rippling_raw_spend_lines
    b. upsert candidates into spend_category_map (every distinct category_id + a merchant
       sample) and spend_department_site_map (every distinct department id + label). Never
       overwrite a row Kevin has labelled.
    c. derive into purchasing_actuals: account_key from department map (null if unlabelled or
       excluded), gl_line_code from category map (null if unlabelled), gl_bucket from the same
       prefix rule, txn_date = first_seen_at (flag approx_date=true until the parent object
       is readable), amount, merchant.
  probes (in the job, printed, fail the job on any FAIL)
    - sum(billcom_raw_bill_lines.amount) per bill == billcom_raw_bills.amount, to the cent
    - purchasing_actuals billcom rows for a period == sum of raw lines for that period
    - no (source, source_line_id) duplicate
    - CORP + CHI rows have account_key null AND excluded=true; sum over excluded rows for
      any site view == 0
    - the aggregate (ALL) for any period == sum of the 11 member sites, to the cent
    - unattributed count and uncoded count reported as numbers, per source
    - Rippling acceptance: CIN - AZ 5006.1 / 5016.6 card spend present in rippling rows

## 3. The route: /api/kpi/purchasing

  Mirrors /api/kpi/labor's contract exactly (same range resolution via periods.js, same
  account / aggregate / region paths, same PSEUDO_KEYS, same envelope exclusion mechanics
  as V25-1). Returns:
    range, fiscal context (period_no, week_no, elapsed_frac, closed weeks) - same as labor
    budget: per gl_line_code for the range from kpi_budgets (same budgetForRange enumerator
            as labor: period amount / 4 per fiscal week in range)
    actuals: per gl_line_code x per fiscal week: amount, lines, bills, paid_amount, by source
    categories: the ADAPTIVE list for this account/range - every gl_line_code with budget >0
                OR actual >0 in range, in priority order 3200.1, 3200.2, 3400.1, 3400.2,
                3400.5, 3500.x, then reimbursable 13xx, then sga. Each with: budget, spent,
                variance, pace_pct (in progress) or final (closed), bucket.
    totals: pl_cogs {budget, spent, variance}, reimbursable {spent, billed_to_client},
            sga {spent}, and card {spent, unattributed, uncoded}
    coverage: bills_in_range, last_bill_created_at, days_since_last_bill,
              lines_unattributed, lines_uncoded, invoice_capture_matched_pct (from the P0d
              audit's join, once landed - null until then)
    provisional: true when range end + 16 days > today (entry lag p90) - the board renders
                 the period as provisional until then
    freshness: last billcom sync, last rippling sync, last derive
  Sentinel for every PR from now on (the purchasing equivalent of CIN - OH 06/29):
    TBR - FL, P8 (2026-07-13..08-09), gl 3200.1 = the value the first derive produces,
    frozen in the PR body and re-asserted on every subsequent PR.

## 4. Out of scope for Phase 1
  No UI. No board. No Invoice Capture writes. No Rippling parent-object work (blocked).
  No card upload lane (Phase 2 if the email report is needed). No Overview roll-up.

## 5. Seed - billcom_class_site_map (13 rows)
  cls01XDVUJNKWWE718yt  STL - FL         cls01GKCFIDLEGD46sa7  TXR - TX - H
  cls01MJNJVUSTRT46sa5  TBJ - FL         cls01HQLOOGQSHY6pqrj  CIN - OH
  cls01FITMWDEUUS4yjvx  TBR - FL         cls01LVIFFEPKYQ6k3i7  TXR - TX - V
  cls01HJFZJLQFXD5ezf3  TXR - AZ         cls01TVGQFCHAZW6lfo4  CIN - KY
  cls01LIGHCBKRZC50y8m  CIN - AZ         cls01GVPEPCCGSM46sa6  TBJ - NY
  cls01XGEJEVHCCR6sne7  STL - MO         cls01JPNBTZOZZH46saa  CORP      excluded=true
                                         cls01TPHLWNLIDR471s9  CHI       excluded=true
  Verified against /billcom/classes names on 2026-08-18: 13/13 match.

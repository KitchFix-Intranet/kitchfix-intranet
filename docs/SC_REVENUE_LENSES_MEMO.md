# SC revenue lenses - audit + memo (2026-07-09)

Read-only investigation. No repo changes. Sources cited inline; workbooks read via
openpyxl at `/Users/kevinfietek/Documents/Claude /Service Calendars/`.

---

## Part A - which price bills the client (Excel vs docs vs Kevin's 2026-07-09 claim)

### Verdict per account shape

Direct workbook evidence resolves the contradiction cleanly. **Kevin's 2026-07-09
statement is correct**; ACCOUNT_SERVICES_BRIEF line 33 is wrong for the SF% accounts.

| Shape | Accounts | What the invoice math actually is | Where SF lands |
|---|---|---|---|
| **PDC + SF%** | CIN-AZ (30%), TXR-AZ (20%), TBR-FL MiLB (25%) | Per-meal invoice = **actuals-tab price** × counts. Actuals-tab price is the projections-tab price × (1 - SF%). | SF paid separately as a flat annual (CIN-AZ $402,016) or as the deposit/amortization mechanic (TXR-AZ 20% deposit; TBR-FL MiLB $382,448 front-load). |
| **PDC + flat SF (no per-meal discount)** | TBJ-FL ($452,812/yr) | Per-meal invoice = projections-tab price × counts. Projections-tab and actuals-tab prices are **identical**. | SF flat annual, invoiced monthly (Jan/Feb/Mar), independent of per-meal. |
| **Per-meal, no SF** | CIN-KY, TBJ-NY | Per-meal invoice = projections-tab price × counts. Projections = actuals = full rate. | None. |
| **Flat_fee** | CIN-OH, STL-MO, STL-FL, TXR-TX-H/V | No per-meal invoice. Client pays contracted flat fee. Per-meal rate in the sheet is planning-only tracking. | Fee schedule. |

### Cited workbook proof (SF% accounts)

**CIN-AZ - `REDS AZ - Service Calendar 2026 (4).xlsx`, tab `Goodyear, AZ - 2026 - Actuals`, row 2:**
- G2 (Breakfast MLB): `=29.00888*0.7` = $20.31
- M2 (Breakfast MiLB): `=18.42147*0.7` = $12.90
- S2 (Pre-Game Snack): `=7.31456*0.7` = $5.12
- Y2 (Continental +): `=9.08086*0.7` = $6.36

Actuals-tab Total Revenue formula (AF3) is the SAME shape as the projections-tab
formula: `sum(count × row2_price)`. Two tabs, two revenues, two lenses. The 0.7 factor
literally lives in the price cells.

**TXR-AZ - `TXR AZ - Service Calendar - 2026 (4).xlsx`, tab `Actuals - 2026`, row 2:**
- G2/I2/K2 (MLB Breakfast/Lunch/Dinner): `=35.72125*0.8` = $28.58
- Q2/S2/U2 (MiLB Breakfast/Lunch/Dinner): `=17.86575*0.8` = $14.29

Same mechanic, 20% instead of 30%.

**TBR-FL - `Tampa Bay Rays Service Calendar - 2026 (3).xlsx`, tab `TBR-2026 - Actuals`, row 2:**
- MLB rows (G2/I2/K2 etc.): plain values `35.63 / 39.48 / 111.84 / 162.17` = same as projections tab (no discount).
- MiLB rows: `W2` (Breakfast-MiLB): `=23.77*0.75` = $17.83; `AC2` (Dinner): `=27.9491*0.75` = $20.96.

Confirms per docs: MLB no discount, MiLB 25% discount.

### The projection tab's built-in billing summary (below the daily grid)

Each SF% projections tab has an ANNUAL BILLING SUMMARY block that models the invoice
mechanic explicitly.

**CIN-AZ projections tab rows 388-410:**
- AF389 = SUM of raw meal totals across groups (label: "Meals to which the service fee is applied")
- AF390 = sum of daily "Total Revenue" at full rate (label: "Total est. sum of meals")
- **AF392 = `=AF390*E362` where E362=0.30 → "Service fee (30%) allocation based on est. meals served"**
- AF396 = `=SUM(AF390, AF394)` → "Total Estimated yearly investment in 2026 plus tax"
- Rows 399-406: "**Post Service-fee Per Head Pricing**" - each line = `=G2*(1-$E$362)` = the actuals-tab price.

**TXR-AZ projections tab rows 361-373:**
- AJ361 = "Total Investment" (sum of daily Total Revenue at full rate)
- AJ362 = `=AJ361*$E$362` where E362=0.20 → "Service Fee Investment"
- AJ363 = `=AJ361-AJ362` → "**Post-Service Fee Investment**" (== billing to client per-meal side)
- Row 365 header: "Investment | Service | Price | **Price Post Fee** | Quantity"
  - AL366 = full price; AM366 = `=I2*(1-$E$362)` = actuals-tab / bill rate

**TBJ-FL projections tab rows 361-367:**
- AX361 = "Meal Rev" (sum of daily Total Revenue at full rate, which = actuals tab in this account)
- AX362 = $496,354 = "Service Fee" (hardcoded annual fee)
- AX363 = `=SUM(AX361:AX362)` → "**Grand Total**" (all-in KPI number)
- AX365-AX367 = Total Investment / Service Fee Investment / Post-SF Investment

**Reading of the sheets, plain:** the projections tab AT the full-retail rate is the
ops/KPI lens ("what the client's service is worth all-in"). The **Post Service-fee Per
Head Pricing** block (CIN-AZ r399) explicitly labels the 70% price as the per-head bill
rate. The actuals tab IS the invoice - rows 401-406 point at the same numbers.

### Verdict on the double-collection question

**No double-collection under Kevin's read.** The SF is 30% of the projected budget
(paid once, flat annual). The per-meal invoice is at 70% × counts. Total invoiced to
the client per meal = SF flat + 70% × counts. Total *value* delivered = 100% × counts.
The 30% delta is absorbed by the SF, which is settled OUT-OF-BAND from the meal
invoices. If billing were at the projection (100%) price + SF flat, the client would
be double-billed. Excel proves the actuals-tab / 70% price is the per-meal invoice
line.

**The docs' contradiction:**
- ACCOUNT_SERVICES_BRIEF line 33 ("projection is billing rate"): WRONG for SF% accounts.
- CONTRACT_BILLING_SUMMARY line 87 ("billed at the 70% cost basis"): CORRECT.
- SC_KPI_PUSH_CONTRACT line 39-45 ("actuals at 70% of projected price... matches the P&L
  and the invoice"): CORRECT.
- SC_SPREADSHEET_MAPPING line 66 ("canonical should be $29.01 the bill rate"): WRONG on
  both counts (see Part C).

---

## Part B - the three totals in the Excel model

### B1 - PROJECTIONS tab totals ("budgeting using contract fees broken out per meal")

Formula chain, CIN-AZ:
- Row 2: full/retail per-meal prices ($29.01 MLB, $18.42 MiLB, $7.31 Snack, $9.08 Cont+)
- Row 3+ (daily): AF = `sum(count × row2_price)` per day
- Row 360 (annual total per column): `SUM(col_3:col_359) * col_row2_price`
- Row 389-390: grand total meals × full rate = "Total est. sum of meals"

**This is a full-retail-value forecast.** It reconciles to the CIN-AZ contract's 2023
budget line (30% of $1,340,056 = $402,016 SF) only by the mechanic in Row 392 (30% ×
projected meal revenue = SF). It does NOT reconcile directly to the operative 2026 SF
number ($402,016 flat) because 2026 prices have escalated via CPI without the SF being
recomputed as 30% of the escalated revenue.

**TBJ-FL projections tab** (r363 "Grand Total") = per-meal revenue + $496,354 SF. TBJ-FL
projection prices = actuals-tab prices (no 70/30 split), so this Grand Total IS the
all-in operator target.

### B2 - ACTUALS tab totals ("billing generated from the actuals tab")

Formula chain, CIN-AZ:
- Row 2: literal formulas `=full_price * 0.70` → $20.31 MLB, $12.90 MiLB, $5.12 Snack, $6.36 Cont+
- Row 3+ (daily): AF = `sum(count × row2_price)` per day - identical formula to projections tab
- Row 360 (annual total): same shape

**This is the per-meal invoice line item.** Contract bible + KPI push contract both
call it out. `SUM(AF3:AF359)` on the actuals tab = the total per-meal amount invoiced
to the client for the year (before tax, at the SF-stripped rate).

Contract-bible confirms: the per-meal invoice is billed bi-weekly in arrears (CIN-AZ
Section V(B)), Net 30. The actuals-tab Total Revenue for each bi-weekly window rolls
into that invoice.

### B3 - Operator KPI / all-in revenue lens

Kevin's stake: "operators' KPIs and budgets and COGS goals go off total revenue, all-in
WITH service fees."

**In the workbooks, this is the PROJECTIONS-tab Total Revenue for SF% accounts** (which
= counts × 100% price, and 100% × counts = per-meal at bill rate + SF% × counts = the
value the operator is measured on).

Concretely CIN-AZ:
- Projections-tab AF360 (annual sum) = 100% price × projected meals = the ops target.
- Or equivalently, actuals-tab AF360 + AF390 × 30% (per-meal bill line + derived SF).

**For flat-SF accounts (TBJ-FL, TBR-FL MiLB partial):**
- Ops/KPI = per-meal revenue (at full = bill rate, no discount) + flat SF ($452,812 for
  TBJ-FL, split monthly). TBJ-FL projections tab row 363 explicitly computes this as
  "Grand Total".

**For no-SF accounts (CIN-KY, TBJ-NY):**
- Ops/KPI = per-meal revenue = per-meal invoice. Same number, no ambiguity.

**For flat_fee accounts (CIN-OH, STL-MO, STL-FL, TXR-TX-H/V):**
- Ops/KPI = contracted flat fee (from `sc_fee_schedule`). Per-meal is not revenue; the
  workbook's per-meal Total Revenue is planning-only.

Formal definition of the ops/KPI lens per account shape:

| Shape | Ops/KPI revenue |
|---|---|
| SF% | `full_rate × counts` (== `invoice_line × counts + SF_flat_annual_prorated`) |
| Flat SF | `full_rate × counts + SF_flat_annual_prorated` (where full = invoice rate) |
| No SF | `full_rate × counts` (== invoice) |
| Flat fee | `fee_schedule_amount_prorated` (per-meal is $0) |

---

## Part C - what PG actually holds (from Kevin's paste + view SQL)

CSV read: `/Users/kevinfietek/Downloads/Supabase Snippet Untitled query.csv` (214 rows,
11 accounts).

### Row-count map

| Account | `projected` rows | `actual` rows |
|---|---|---|
| CIN - AZ | 27 | 24 |
| CIN - KY | 5 | 0 |
| CIN - OH | 8 | 0 |
| STL - FL | 22 | 0 |
| STL - MO | 8 | 0 |
| TBJ - FL | 23 | 0 |
| TBJ - NY | 6 | 0 |
| TBR - FL | 24 | 11 |
| TXR - AZ | 22 | 18 |
| TXR - TX - H | 8 | 0 |
| TXR - TX - V | 8 | 0 |

`actual` rows exist for exactly the three SF% accounts (CIN-AZ, TXR-AZ, TBR-FL). Every
other account has only `projected` rows - the view's `pr_act LATERAL` falls through and
`COALESCE(pr_act.price, pr_proj.price)` picks up projected. That's the expected fallback
for non-discounted accounts.

### But: 'projected' rows are ALREADY the SF-stripped invoice price

Latest CIN-AZ prices per (service, kind):

| Group / Service | `projected` | `actual` | Expected sticker | Expected invoice |
|---|---|---|---|---|
| Major League Breakfast | $20.31 | $14.22 | $29.01 | $20.31 |
| Minor League Breakfast | $12.90 | $9.03 | $18.42 | $12.90 |
| Minor League Pre-Game Snack | $5.12 | $3.58 | $7.31 | $5.12 |
| Rehab Continental Plus | $6.36 | $4.45 | $9.08 | $6.36 |

**`projected` rows in PG hold the ACTUALS-tab / SF-stripped invoice price**, not the
full sticker. This lines up with the seed script comment (`_seed_sc_from_xlsx.mjs`
lines 440-445), which cites the 2026-06-16 incident: Kevin manually corrected CIN-AZ
prices via SQL from $18.42/$29.01 to $12.90/$20.31 (the SF-stripped values). That
correction sits on the `projected` rows because at that time `price_kind` was either
default-projected or the column didn't exist yet.

### And: 'actual' rows are DOUBLE-DISCOUNTED

sc-8b's backfill (migration lines 140-182) INSERTs actual rows as `projected × factor`
(0.70 for CIN-AZ, 0.80 for TXR-AZ, 0.75 for TBR-FL Minor League). It assumed `projected`
still held the sticker. It did not, because of the 2026-06-16 correction.

Result: `actual` = (SF-stripped) × 0.70 = full × 0.49. CIN-AZ MiLB Breakfast `actual`
= $9.03 = **49% of $18.42, not 70%**. The note column on those rows still literally
reads *"actual = projected * 0.70 (CIN-AZ contracted rate, 30% Service Charges line on
P&L)"*, but the math is wrong now because `projected` shifted underneath.

Same shape TXR-AZ:

| Service | `projected` | `actual` | Expected sticker | Expected invoice |
|---|---|---|---|---|
| Major League Breakfast | $28.58 | $22.86 | $35.72 | $28.58 |
| Minor League Breakfast | $14.29 | $11.43 | $17.87 | $14.29 |

`actual` = $22.86 = 64% of $35.72, not 80%.

Same shape TBR-FL Minor League:

| Service | `projected` | `actual` | Expected sticker | Expected invoice |
|---|---|---|---|---|
| Dinner | $20.96 | $15.72 | $27.95 | $20.96 |
| Breakfast - MiLB | $17.83 | $13.37 | $23.77 | $17.83 |

`actual` = $15.72 = 56% of $27.95, not 75%.

### View math today

`sc_daily_revenue` (sc-8b migration lines 214-289):
- `projected_revenue = projected_count × pr_proj.price`
- `actual_revenue = actual_count × COALESCE(pr_act.price, pr_proj.price, 0)`

For CIN-AZ MiLB Breakfast, projected day = 100 meals, saved actual = 100 meals:
- `projected_revenue` = 100 × $12.90 = $1,290 → **matches the per-meal invoice line
  item.**
- `actual_revenue` = 100 × $9.03 = $903 → **understates the invoice by ~30%.**

For CIN-KY / TBJ-FL / STL-MO / etc. (no `actual` rows): actual_revenue falls back to
projected × counts, and since projected here == invoice rate, actual_revenue matches
the per-meal invoice line correctly.

### The lens the live app shows (definitive)

- **App projected side (grayed `~$X`):** `projected_count × projected_price` = per-meal
  invoice value at the projected count. This is the **billing lens on the projection
  side**, not the ops/KPI (all-in) lens.
- **App actual side (green `$X` after save):**
  - Non-SF accounts: correct per-meal invoice (`actual_count × projected_price`, invoice
    rate).
  - SF% accounts (CIN-AZ / TXR-AZ / TBR-FL MiLB): **UNDERSTATED by the SF factor
    squared**. CIN-AZ shows 49% of full rate instead of 70%. 30% miss on the invoice
    lens for CIN-AZ; 20% miss for TXR-AZ; 25% miss for TBR-FL MiLB.
- **Kevin's screenshot ($12.90 / $6.36):** confirmed - that's the modal group header
  reading `data.serviceGroups[s].price` which loads with
  `.eq("price_kind","projected")` at `dataStore/serviceCalendar.js:335`. It's the
  invoice per-meal rate (correct for the projected side; header is not affected by the
  double-discount).
- **Bundle 1 (#361) server-authoritative saved totals** read `actual_revenue` from the
  view. On CIN-AZ, the toast/header now reports 49%-of-sticker, not the invoice.
- **Neither app surface shows the ops/KPI (all-in) lens for SF% accounts.**

### Sizing on a real day (CIN-AZ, 100 MiLB + 50 MLB + 15 Cont+)

| Lens | Formula | Value |
|---|---|---|
| Ops/KPI (all-in, ~ P&L "2400.1 Meal Service") | 100×$18.42 + 50×$29.01 + 15×$9.08 | **$3,428** |
| Per-meal invoice (correct, per contract) | 100×$12.90 + 50×$20.31 + 15×$6.36 | **$2,401** |
| App projected_revenue TODAY | 100×$12.90 + 50×$20.31 + 15×$6.36 | $2,401 |
| App actual_revenue TODAY (after save) | 100×$9.03 + 50×$14.22 + 15×$4.45 | **$1,680** |

Between projected and actual on the same day: **the app shows a 30% drop the moment
the operator saves the actuals**, from $2,401 (projected read of invoice) to $1,680
(actual read = double-discounted). Neither number matches the ops/KPI target of
$3,428. TXR-AZ has the same shape at 20%; TBR-FL MiLB at 25%.

**This is the SC-051 fix (#361) exposing a pre-existing PG state issue.** #361
correctly unified all surfaces on view-authoritative dollars; the view is correct given
its inputs; the inputs are wrong (data problem, not code problem).

---

## Part D - `SC_REVENUE_LENSES.md` (draft memo content)

Three revenue lenses, formal definitions per account shape, with sample numbers from
CIN-AZ (100 MiLB + 50 MLB + 15 Cont+ day):

### 1. Billing lens - the invoice math

- **SF% accounts (CIN-AZ, TXR-AZ, TBR-FL MiLB):**
  - Per-meal invoice line = `sticker × (1 - SF%) × count` = **$2,401** on the sample.
  - SF paid separately: flat annual fee, invoiced on its own schedule (CIN-AZ Feb1/Mar15,
    TBJ-FL Jan/Feb/Mar, TBR-FL front-loaded 2024).
  - Already-collected-via-SF component = `sticker × SF% × count` = the operator's
    "still to charge" gap under Kevin's 2026-07-09 statement.
- **Flat-SF accounts (TBJ-FL):** per-meal invoice = sticker × count (no discount). SF
  a separate flat annual.
- **No-SF (CIN-KY, TBJ-NY):** per-meal invoice = sticker × count.
- **Flat_fee (CIN-OH, STL-MO, STL-FL, TXR-TX-H/V):** no per-meal invoice; contracted
  fee via `sc_fee_schedule`.

**Where PG holds it today:** `projected` rows already carry this rate (Kevin's
2026-06-16 correction). Per-meal invoice on the projection side = correct.
`actual_revenue` from the view is UNDERSTATED for SF% accounts due to sc-8b's
double-discount.

### 2. Ops/KPI lens - the all-in figure operators are measured on

- **All accounts:** the sum operators are held to on P&L review.
- **SF% accounts:** `sticker × count` = per-meal-at-invoice + SF-derived. Sample:
  **$3,428**.
- **Flat-SF accounts (TBJ-FL):** `sticker × count + SF_flat_prorated`. Roughly $228K
  invoice + $452K SF = $680K/year ops target.
- **No-SF accounts:** `sticker × count`. Equals billing.
- **Flat_fee accounts:** `sc_fee_schedule` amount prorated to period. Per-meal is $0
  by contract.

**How to compute from PG today for SF% accounts:** requires either (a) a *sticker*
price set that PG does not currently hold (Kevin's manual correction removed it), or
(b) apply an SF% multiplier `1 / (1 - SF%)` on top of `projected_revenue`, or (c) fold
per-account SF prorated in.

### 3. Cost-basis lens - internal margin view

**Not present in PG or the app in any independent form.** The 70% rate was called
"cost basis" in some doc language (ACCOUNT_SERVICES_BRIEF line 43-44) but that phrasing
is *behavioral*, not accounting - it's the per-meal invoice, not a food-cost figure.
True cost basis (labor + food + supplies per meal) lives in COGS pipelines out of SC
scope (SC_KPI_PUSH_CONTRACT line 51-58 confirms). Recommend: retire the "cost basis"
language from ACCOUNT_SERVICES_BRIEF - it conflates SF-stripped invoice with COGS.

### Recommendation A - Export columns

For the future Excel-export feature, each account shape carries different columns.
Priorities align with operator use: their KPI/budget number leads.

| Shape | Summary sheet columns | Daily sheet columns |
|---|---|---|
| SF% (CIN-AZ / TXR-AZ / TBR-FL MiLB) | KPI Rev (all-in), Per-meal Invoice, SF-flat prorated for the range, Total Meals | Date, per-service counts, Daily per-meal invoice, Daily KPI-lens rev |
| Flat-SF (TBJ-FL) | KPI Rev (per-meal + prorated SF), Per-meal Invoice, SF prorated for the range, Total Meals | Same shape; SF is a constant band, not per-day |
| No-SF (CIN-KY, TBJ-NY) | Rev (per-meal invoice = KPI = one number), Total Meals | Date, per-service counts, Daily rev |
| Flat_fee (CIN-OH, STL-MO, STL-FL, TXR-TX-H/V) | KPI = prorated fee amount, planning-only Meal Value | Date, counts (planning), fee prorated (period-day allocation) |

The lead column on SF% and flat-SF should be **KPI Rev**, not the per-meal invoice.
Operators budget against KPI; billing is finance's job.

### Recommendation B - Live-app implications (findings, not directives)

**Finding B1: `actual_revenue` for the three SF% accounts is understated by 30/20/25%.**
Direct arithmetic verification above; CIN-AZ 100+50+15 day = $1,680 vs correct $2,401.
Same shape for TXR-AZ (20% understatement) and TBR-FL MiLB (25%). The bug is data,
not code: sc-8b's backfill assumed `projected` held sticker prices; Kevin's 2026-06-16
correction had moved them to invoice rate. Fix options for Kevin to rule on:

1. **Delete the `actual` rows for CIN-AZ / TXR-AZ / TBR-FL MiLB** (`DELETE FROM
   sc_service_prices WHERE price_kind='actual' AND created_by='sc-8b-backfill'`). The
   view's `COALESCE(pr_act, pr_proj)` falls back to projected (= invoice rate) and
   actual_revenue lands at the correct invoice number. Downside: loses the two-lens
   architecture the sc-8b migration set up.
2. **Restore `projected` rows to sticker prices** ($29.01/$18.42/etc. for CIN-AZ) and
   leave sc-8b's `actual` rows in place. Then `projected_revenue` = sticker × counts
   = KPI/ops lens; `actual_revenue` = invoice-rate × counts = billing lens. Downside:
   the CIN-AZ modal group header would read $18.42 again (sticker), and every
   projected-side display would reflect KPI dollars not invoice dollars. Consumers
   (modal header, projected_revenue in the workspace) would need to switch to the
   `actual` side for the invoice-lens number.
3. **Introduce a third price_kind = 'sticker'** and treat `projected` as the invoice
   rate (current state). Keeps all app displays as-is; expands schema for the ops/KPI
   lens.

**Finding B2: neither app surface shows the ops/KPI (all-in) lens for SF% accounts.**
Regardless of which B1 option Kevin picks, the ops/KPI lens is currently invisible in
the app. The KPI push contract (SC_KPI_PUSH_CONTRACT) treats this as the eventual
Dashboard's responsibility, but during operator entry the app shows one lens (invoice
projected → invoice actual after the double-discount error is fixed). Whether operators
need the KPI-lens view on the calendar itself is a UX call.

**Finding B3: the modal projected header currently reads correctly by luck.** #361 wired
`day.priceAtDate` and the modal group header to the `projected` price_kind, which
happens to be the invoice rate today because of Kevin's correction. If Kevin picks
option 2 (restore sticker prices), every projected-side display flips lens and the
operator suddenly sees $18.42/meal instead of $12.90. Cheap follow-up: the modal footer
switch (from `data.serviceGroups[s].price` to `day.priceAtDate` in #361 already picks
up the view - both come from `projected` today, so they agree).

**Sizing:** on a typical CIN-AZ ST week (say 60 MLB + 130 MiLB + 15 Cont+ per day × 6
days), the understatement on `actual_revenue` is `0.30 × 6 × (60×20.31 + 130×12.90 +
15×6.36)` ≈ $5,600/week. Over CIN-AZ ST proper (~10 weeks): ~$56,000. That's the size
of the operator-visible KPI drop today between the projected read and the actual read.

---

## Flags

- **Doc drift:** ACCOUNT_SERVICES_BRIEF line 33 disagrees with CONTRACT_BILLING_SUMMARY
  line 87 and SC_KPI_PUSH_CONTRACT line 39-45 on which price is billing. All three
  should agree; line 33 is the outlier and reads WRONG for SF% accounts.
- **Doc drift:** SC_SPREADSHEET_MAPPING line 66 ("canonical entry should be $29.01
  the bill rate") disagrees with the current PG state, with the 2026-06-16 seed
  incident note, with CONTRACT_BILLING_SUMMARY, and with SC_KPI_PUSH_CONTRACT. Reads
  as a stale line from the pre-2026-06-16 investigation.
- **ACCOUNT_SERVICES_BRIEF "operative 2026 pricing not on file"** (line 63, 80): the
  workbook prices ARE the operative 2026 rates. What's not on file is a *contract
  amendment* explaining why 2026 escalated to $29.01 without a CPI trail. Workbooks
  cannot answer that; docs stay open.
- **CONTRACT_BILLING_SUMMARY line 87 phrasing** ("cost basis"): confusing. It's the
  invoice rate for the per-meal line, not a COGS figure. Rewording candidate.
- **sc-8b's inserted `actual` rows carry notes that are now factually wrong** (they
  claim the row equals `projected × 0.70` = 30%-off but the row is 51%-off because
  `projected` already had 30% removed). Notes need a correction if Kevin picks option
  1 or 3.
- **CIN-KY 'Umpire' / 'Snack' rows in the CSV:** 5 projected rows, not 6 (the CSV
  omitted `Umpire`). Spot check - not necessarily a data issue, but the CSV row count
  disagrees with the mapping doc's 6-service count for CIN-KY. Might be a service
  archived via `active_until` (Umpire deactivated?). Kevin can eyeball.
- **TBJ-NY 'Snack' / 'Shake' at $0** (CSV): confirmed missing prices, mapping doc
  already flags. No change from earlier state.
- **TBR-FL 'Umpire Meal' in projected but not actual** (mapping doc line 163 already
  flags): confirmed.
- **The 2026-06-16 seed comment** (`_seed_sc_from_xlsx.mjs:440-450`) still describes
  the manual correction as writing "cost-basis" values. This is where the "cost-basis"
  language leaked out of one doc and into code comments. Same cleanup as the doc-drift
  item above.

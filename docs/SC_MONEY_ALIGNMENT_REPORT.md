# SC money-model ALIGNMENT REPORT

Read-only. No repo changes, no commits, no PR. One report to align Kevin, Chat-Claude,
and CC on ONE shared model of the Service Calendar money system before any further work
lands. This report ends the game of "which doc do I trust." It answers that, in plain
language first.

**Source of truth priorities used:**
1. Excel workbook cell contents (formulas that literally construct invoices) - primary evidence.
2. Kevin's PG paste + `sc_daily_revenue` view definition - current running state.
3. Docs (with dates + citations) - stated intent, sometimes drifted from state.

**Companion evidence:** the read-only memo at `/tmp/SC_REVENUE_LENSES_MEMO.md` (workbook
audit + PG dump audit, 2026-07-09; not yet committed).

---

## Part 1 - Inventory

Every source that makes claims about SC money. One line each; authority claim; last-touched
commit. Docs that claim authority over the same territory are flagged.

### Docs (`docs/*.md`)

| Doc | Money topics covered | Authority claim | Last touched | Overlap flag |
|---|---|---|---|---|
| `SC_CONTRACT_BILLING_SUMMARY.md` | Per-account billing model, contract-derived pricing, fee schedule, passthrough, SF mechanics; resolved decisions locked 2026-06-18 | **Contract bible. "When a decision here conflicts with older notes... THIS SECTION WINS."** (lines 3-8, 11-15) | 2026-06-19 (`9c08133` "add resolved billing decisions to contract bible") | Overlaps with ACCOUNT_SERVICES_BRIEF, SC_BILLING_MODEL_AUDIT, SC_LENS_VISION on billing-mechanic explanation |
| `ACCOUNT_SERVICES_BRIEF.md` | Per-account services, billing, pricing, service fees; explicitly cites the bible + mapping + comparison as its sources | Positions itself as "Source-of-truth reference" (line 3), but **explicitly folds together the three doc sources** rather than acting as bible | 2026-06-16 (`62a3be5` "docs: KitchFix Account Services Brief") | Overlaps with bible on billing model; **line 33 outlier finding disagrees** |
| `SC_BILLING_MODEL_AUDIT.md` | Per-account audit against PG state + code; STL-FL fee promotion; TBR-FL 25% discount confirmed empirically | Explicit derivative: "consolidates [the bible's] per-account findings against current PG state and the codebase" (line 8) | 2026-06-18 dated | Extends the bible, does not compete |
| `SC_KPI_PUSH_CONTRACT.md` | What the SC pushes to the future KPI dashboard: 3-line P&L revenue breakdown (2400.1 Meal Service, 2300 Service Charges, 2200 Catering), forecast+actual, weekly->period grain | Contract for a future dashboard; downstream reader of the SC's revenue model | 2026-06-24 (`ae4b898`) | Reads the model, does not define it |
| `SC_LENS_VISION.md` | The vision for the SC as the operators' planning tool + the KPI's revenue engine; section 5 covers revenue model + per-account billing mechanics | Vision doc / north star; not a spec | 2026-06-24 (`ae4b898`, same PR as KPI contract) | Overlaps with bible on billing mechanics; agrees with it |
| `archive/SC_PRICE_COMPARISON.md` (archived 2026-07-17) | Table of projection-tab vs actuals-tab prices for every service, every account, from the workbooks | Data doc - report on the sheets. States facts, does not rule | 2026-06-15 (`1ac0e44`) | Fed the bible + mapping doc; superseded by pricing-summit PRICE_AUDIT + EVIDENCE_* |
| `SC_SPREADSHEET_MAPPING.md` | Per-account sheet layout (which column is what service, dates, structure). Contains a ruling on canonical price direction | Data doc + one ruling ("canonical entry should be the bill rate," CIN-AZ line 66) | 2026-06-15 (`1ac0e44`) | **Line 66 ruling is now stale** vs 2026-06-16 manual correction + bible + PG |
| `SC_REDESIGN_SPEC.md` | Redesign spec for the calendar UI; mentions revenue framing per lens | UI spec. Reads the money model, does not define it | Multiple recent | Not a money authority |
| `SC_DRILLDOWN_DECISIONS.md` | Records design decisions for the drill-in flow | Not a money authority | Multiple recent | - |
| `SC_PDC_PHASES.md` | PDC phase calendars | Not a money authority | - | - |
| `SC_ADMIN_RECON_REPORT.md`, `SC_ADMIN_STAGE2_RECON.md`, `SC_BUNDLE1_RECON.md` | Admin recon audits (fee schedule + price editor) | Data / audit docs | 2026-06 various | - |
| `ARCHITECTURE.md` | Sheets + PG dual layer, module map | Architecture, general | Recent | Doesn't cover SC money specifically |
| `GOTCHAS.md` | Lines 471-472 (SC actuals discount trap) + lines 474-475 (flat-fee not per-meal) | Hard-won lessons | 2026-06-24 (`ae4b898`) | Agrees with bible; reinforces it |
| `PROJECT_DASHBOARD.md` | Current-state orientation | Not money-authoritative | Recent | - |
| `archive/handoffs/HANDOFF_CC.md`, `archive/handoffs/HANDOFF_CHAT.md` (archived 2026-07-17), `SC_CC_HANDOFF.md` | Session handoffs | Snapshot docs | Recent | - |
| `/tmp/SC_REVENUE_LENSES_MEMO.md` | 2026-07-09 workbook-primary lens audit + PG dump audit; identifies sc-8b double-discount | NEW; not yet in repo; evidence for THIS report | 2026-07-09 | Supersedes SC_SPREADSHEET_MAPPING line 66 |
| **THIS report** | The alignment across everything | Intended as the "shared model" for Kevin+ChatClaude+CC to review before any further money work | 2026-07-09 | If accepted, becomes the go-forward reference |

**Overlap flag summary:** the doc *asserting* authority is the bible. Every other money-touching doc
either extends or reads it - EXCEPT ACCOUNT_SERVICES_BRIEF, which was written 2 days before the bible
finalized and carries a top-level executive-summary statement (line 33) that reads OPPOSITE to
everything else. That's the doc drift Part 3 pins down.

### Migrations (`docs/migrations/sc-*.sql`)

| Migration | Money role | Header claim | Landed |
|---|---|---|---|
| `sc-1-service-calendar-schema.sql` | Core tables (services, groups, prices, projections, actuals, metadata, actuals_history) | Foundation; single-price-per-service, `sc_service_prices(service_id, effective_date)` unique | Base schema |
| `sc-1b-add-non-revenue-flag.sql` | `is_non_revenue` on `sc_services`; view recreate | "Rows where has_actuals is true and has_projection is false flag ad-hoc service days" | - |
| `sc-4-config-changelog.sql` | Audit trail for price edits | - | - |
| `sc-5-fee-schedule.sql` | New table `sc_fee_schedule` for the 5 flat-fee contract-revenue lines | The contract-revenue layer; not read by the SC UI (bible §17) | PR #221 (`5be0ad7`) |
| `sc-6a-catalog-active-until.sql` | `active_until` column on services + groups (archive mechanism) | - | PR #227 (`956eb26`) |
| `sc-6b-catalog-aware-views.sql` | `sc_daily_revenue` + `sc_month_summary` recreate to honor `active_until` | Single LATERAL price join at that time | PR #229 (`666d5e1`) |
| `sc-7-changelog-latest-view.sql` | Changelog latest-per-service view (admin cap fix) | - | `bbc7546` |
| `sc-8a-price-kind-column.sql` | Adds `price_kind ('projected'|'actual')` column to `sc_service_prices` with default `'projected'`, backfills existing rows to `'projected'`, extends the UNIQUE index | "Schema change only. All existing rows become `price_kind = 'projected'`" | PR #252a4ae |
| `sc-8b-actual-prices-and-view.sql` | INSERTs `'actual'`-kind rows = `projected × (0.70/0.80/0.75)` for CIN-AZ / TXR-AZ / TBR-FL MiLB; recreates view with two LATERAL joins (`pr_proj` + `pr_act`); `actual_revenue` uses `COALESCE(pr_act.price, pr_proj.price)` | Header 6-95: "actual_revenue landing at ~$320K matches the P&L 2400.1 Meal Service line" | PR #252a4ae |

### Code (money paths)

| File | Role | Key lines |
|---|---|---|
| `src/lib/dataStore/serviceCalendar.js` | Orchestrator. Reads catalog + view; writes actuals + notes | Line 335 + 480: `.eq("price_kind", "projected")` when loading the catalog (`data.serviceGroups[s].price`); line 706: reads `projected_revenue` + `actual_revenue` from the view for day-level totals |
| `src/app/api/service-calendar/route.js` | Server actions. `sc-load`, `sc-submit-day`, `sc-add-note`, admin endpoints | Line 570-620: `sc-submit-day` echoes `savedRevenue` + `savedMeals` from `readSavedDayTotals` (PR #361) |
| `src/app/service-calendar/DayDetail.js` | Modal money display. Header hero uses `day.priceAtDate[colIndex]` (view's `pr_proj.price`) | SC-052 (#361): footer switched from `data.serviceGroups[s].price` to `day.priceAtDate` |
| `src/app/service-calendar/ServiceCalendar.js` | Aggregates. `aggregateWorkspaceMetrics` sums `day.totals.projectedRevenue` / `day.totals.actualRevenue` | Reads view-authoritative values |
| `scripts/_seed_sc_from_xlsx.mjs` | Seed. Loads projection-tab prices as sc_service_prices | Lines 440-450: comment describes the 2026-06-16 incident + why upsert switched to `ignoreDuplicates: true` |

### Money-touching PRs (git log, in chronological order of merge)

| PR / commit | What it did | When |
|---|---|---|
| `1ac0e44` | Doc set: SC_PRICE_COMPARISON (archived 2026-07-17) + SC_SPREADSHEET_MAPPING + SC_CONTRACT_BILLING_SUMMARY | 2026-06-15 |
| `62a3be5` | Doc: ACCOUNT_SERVICES_BRIEF | 2026-06-16 |
| **out-of-band Supabase edit** | **Kevin corrected CIN-AZ prices via SQL to $20.31/$12.90 (bill rate)** | **2026-06-16** |
| `560b757` | Seed: `ignoreDuplicates: true` on `sc_service_prices` to preserve the 2026-06-16 correction from re-imports | 2026-06-17ish |
| `9c08133` | Doc: contract bible amended with resolved decisions (the "RESOLVED BILLING DECISIONS" section that wins conflicts) | 2026-06-19 |
| PR #221 (`5be0ad7`) | sc-5 migration + admin surface for fee schedule + seed 5 fees | 2026-06-19 |
| PR #224 (`fee/backdate`) | Fenced backdate mode for price + fee edits | 2026-06-19 |
| PR #227 (`956eb26`) | sc-6a: `active_until` catalog archive column | 2026-06-19 |
| PR #229 (`666d5e1`) | sc-6b: catalog-aware views | 2026-06-19 |
| PR #234 (`10c94c5`) | sc-6c: catalog lifecycle admin | 2026-06-22 |
| `bbc7546` | sc-7: changelog latest view | 2026-06-22 |
| `252c4ae` "sc revenue-engine pricing fix" | sc-8a + sc-8b: added `price_kind`, backfilled `'actual'` rows as `projected × factor` | **2026-06-24** |
| `ae4b898` | Docs: SC_LENS_VISION + SC_KPI_PUSH_CONTRACT + GOTCHAS additions ("close billing-audit open items") | 2026-06-24 |
| PR #361 (`da47c63`) | Server-authoritative saved totals: toast/header echo `savedRevenue`/`savedMeals` from the view | 2026-07-09 |
| **/tmp memo** | Workbook + PG dump audit | 2026-07-09 |
| **THIS report** | Alignment | 2026-07-09 |

---

## Part 2 - The canonical model, topic by topic

Plain-language read first. Mechanism + citation next. Where sources agree, one clean statement.
Where they disagree, a pointer into Part 3.

### (a) Projections - what a projected count and projected price mean

**Plain:** A projection is a planning estimate typed into the sheet for a day - "we think we'll
serve 100 MiLB lunches." The *projected price* attached to it was, historically, the FULL sticker
value ($18.42 for CIN-AZ MiLB Lunch). The projections tab existed to build an annual BUDGET
using contract rates - a forecasted revenue at the retail rate to plan the year against.

**Mechanism:**
- Spreadsheet: projections-tab row 2 = full/sticker price; daily row = count; column AF = `SUM(count × row2_price)` = projected revenue at 100% (workbook: `REDS AZ - Service Calendar 2026 (4).xlsx` tab `Goodyear, AZ - Projected Number` row 2, `SC_REVENUE_LENSES_MEMO.md` Part B).
- PG: `sc_daily_projections(account_key, service_id, service_date, projected_count)` holds counts. `sc_service_prices(service_id, price_kind='projected', effective_date, price)` holds the price valuing them (sc-1 schema, sc-8a extended).
- View: `projected_revenue = projected_count × pr_proj.price` (sc-8b `sc_daily_revenue` line 241, `SC_REVENUE_LENSES_MEMO.md` Part C).
- App: modal group-header prices come from `data.serviceGroups[s].price`, loaded with `.eq("price_kind","projected")` (`dataStore/serviceCalendar.js:335`).

**What the projections tab is FOR:**
- **All sources agree:** budgeting/planning artifact. Not the invoice. (SC_LENS_VISION §2 "the financial frame is central"; SC_KPI_PUSH_CONTRACT §Forecast; SC_CONTRACT_BILLING_SUMMARY resolved-decisions §"per-meal / operational revenue"; ACCOUNT_SERVICES_BRIEF §Executive Summary; bible line 87 "The 30% service fee is why per-meal is billed at the 70% cost basis. $29.01 × 0.70 = $20.31" - projections are the 100% side.)

**The one drift point:** ACCOUNT_SERVICES_BRIEF:33 says the PROJECTION price is the BILLING rate (for SF% accounts). Every other source and the workbooks say the ACTUALS-tab price is the billing rate; the projections-tab price is the KPI/ops-lens rate. See Part 3.

### (b) Actuals - what saving actuals means, which price values them

**Plain:** When an operator types 100 into a MiLB Lunch cell on the actuals side, KitchFix served
100 meals that day. The actuals-tab price on the sheet ($12.90 for CIN-AZ MiLB Lunch) is what the
client owes per meal on this invoice line item. On the SF% accounts, that number is
`sticker × (1 - SF%)`. On flat-SF / no-SF / flat-fee accounts, no discount - the actuals price
equals the projections price.

**Mechanism:**
- Spreadsheet: actuals-tab row 2 for SF% accounts = LITERAL FORMULA `=sticker × factor` (CIN-AZ G2: `=29.00888 * 0.7`; TXR-AZ G2: `=35.72125 * 0.8`; TBR-FL MiLB W2: `=23.77 * 0.75`). Same daily formula shape `SUM(count × row2_price)` (workbook cells, `SC_REVENUE_LENSES_MEMO.md` Part A).
- PG: `sc_daily_actuals(account_key, service_id, service_date, actual_count)`. Sc-8b added `sc_service_prices` rows with `price_kind='actual'` at `projected × factor` for the three SF% accounts.
- View: `actual_revenue = actual_count × COALESCE(pr_act.price, pr_proj.price, 0)` (sc-8b line 242) - for non-SF% accounts, `pr_act` is NULL and it falls back to `pr_proj`.
- App: `day.totals.actualRevenue` from the view flows to the toast/aggregate; the modal header still reads `day.priceAtDate` which is `pr_proj.price` (invoice rate for the projected side).

**Which price VALUES the actuals row:**
- **Sources agree (bible / audit / lens vision / KPI contract / GOTCHAS 471):** actuals valued at the contracted/discounted price - not the sticker. This is the per-meal invoice line.

**How that's implemented:** discussed under (c) invoicing and (e) KPI lens, and the current state
issue is captured in Part 3 (sc-8b double-discount).

### (c) Invoicing / charging - the client's invoice math, per account shape

Four account shapes. Model per shape:

| Shape | Accounts | Per-meal invoice line (bi-weekly / weekly) | Service Fee line (separate) | Passthrough |
|---|---|---|---|---|
| **SF% (per-meal + SF discounts per-meal)** | CIN-AZ (30%), TXR-AZ (20%), TBR-FL MiLB (25%) | `actuals_count × actuals-tab price` = `count × (sticker × (1 - SF%))` | Yes, flat annual on separate schedule (CIN-AZ $402,016 Feb+Mar; TXR-AZ 20% deposit Jan/Feb/Mar; TBR-FL front-loaded 2024) | None inside these accounts |
| **Flat-SF (per-meal + SF independent)** | TBJ-FL ($452,812/yr) | `actuals_count × actuals-tab price` = `count × sticker` (no discount; projection = actuals price) | Yes, flat annual on separate schedule (Jan/Feb/Mar per ABR OneSheeter) | None |
| **No-SF (pure per-meal)** | CIN-KY, TBJ-NY | `count × sticker` (projection = actuals price) | None | None |
| **Flat_fee** | CIN-OH, STL-MO, STL-FL, TXR-TX-H/V | **Not per-meal.** Contracted flat fee via `sc_fee_schedule` (CIN-OH $362,500; STL-MO $473,000; STL-FL $1,400,000; TXR-TX-H $604,032; TXR-TX-V $0 covered by H) | The flat fee IS the money | Yes on some accounts (see topic (h)) |

**Source citations for the shape assignments:**
- SF% mechanic: bible line 87 explicit ("$29.01 × 0.70 = $20.31"); SC_LENS_VISION §5.2 line 109 explicit ("actuals prices are 70% of projected"); SC_KPI_PUSH_CONTRACT §"Critical: actuals use the contracted rate" lines 39-45 explicit; SC_BILLING_MODEL_AUDIT §per-account medium-tier line 69-72; GOTCHAS line 471.
- Flat-SF mechanic: bible lines 85-89 and 261-267 (TBJ-FL); ACCOUNT_SERVICES_BRIEF §TBJ-FL lines 259-299 ("service fee does NOT discount per-meal").
- Flat_fee mechanic: bible §fee schedule lines 57-70; SC_BILLING_MODEL_AUDIT §per-account lines 47-58.

**Workbook proof (SF%):** the SUM(AF3:AF359) on the actuals tab IS the per-meal-line annual invoice
at the contracted rate. That's what gets billed bi-weekly (CIN-AZ contract Section V(B) Net 30).

**The one drift point:** ACCOUNT_SERVICES_BRIEF:33 says the PROJECTION price is billed. If billing
were at 100% × counts AND the SF were also collected as a flat annual, the client would be
double-charged the SF component. Every other source (and the actuals-tab row 2 literal formulas)
say the invoice is at 70%/80%/75% × counts. See Part 3.

### (d) Service fees - three structures, per account

Locked in bible §"Service fees" + §"Fee schedule" and confirmed by SC_BILLING_MODEL_AUDIT.

| SF structure | Accounts | Amount | Billed how | On the SC or off? |
|---|---|---|---|---|
| **Percentage-based SF (discounts per-meal)** | CIN-AZ 30%, TXR-AZ 20% (deposit), TBR-FL MiLB 25% (amortization) | CIN-AZ $402,016; TXR-AZ 2025 deposit $297,419; TBR-FL 2024 one-time $382,448 | Flat annual, separate schedule; per-meal invoice arrives at the reduced rate | **Contract-revenue layer, not on the SC** (bible §17-18 "SC does not consume fee data") |
| **Flat SF (does NOT discount per-meal)** | TBJ-FL $452,812/yr | Flat annual | Split monthly Jan/Feb/Mar; per-meal invoice at full rate in parallel | **Contract-revenue layer, LATER stage** (bible §"Service fees" lines 79-89) - NOT in fee schedule yet, accepted understatement |
| **No SF** | CIN-KY, TBJ-NY | n/a | n/a | n/a |
| **Flat_fee itself** | CIN-OH, STL-MO, STL-FL, TXR-TX-H/V | See table under (c) | Various installment schedules per contract | **Contract-revenue layer via `sc_fee_schedule`** (bible §"Fee schedule") - IS in fee schedule |

**Two-layer architecture (bible §17-42):** per-meal / operational revenue lives in the SC via
`sc_daily_revenue`. Contract revenue (flat fees + service fees + postseason add-ons) lives in the
admin + future KPI dashboard via `sc_fee_schedule` and (still) NOT in the calendar's dollar
display. The Service Calendar does NOT show flat_fee revenue on-screen (bible §"The Service
Calendar does NOT consume fee data").

### (e) KPI / all-in lens - what operators are measured on

**Plain:** Operators are measured on total revenue "all-in with service fees." For a CIN-AZ ST day
serving 100 MiLB Lunch + 50 MLB Lunch + 15 Continental Plus, the KPI number the operator is held to
is:

```
100 × $18.42 + 50 × $29.01 + 15 × $9.08 = $3,428
```

(sticker × count = per-meal invoice line + derived SF portion, combined in the P&L's line 2400.1
Meal Service (Home)). Kevin's stake in the 2026-07-09 conversation: this is what operators budget
against, and what the KPI dashboard consumes.

**Mechanism per shape:**

| Shape | KPI lens = |
|---|---|
| SF% | `sticker × count` (== per-meal invoice + SF-derived portion) |
| Flat-SF | `sticker × count + SF_flat_prorated` (SF is a constant band) |
| No-SF | `sticker × count` (== invoice; single number) |
| Flat_fee | `sc_fee_schedule` amount prorated to period; per-meal is $0 by design |

**Citations:**
- SC_LENS_VISION §5.1 lines 97-104: 3-line revenue breakdown.
- SC_KPI_PUSH_CONTRACT lines 17-29: exact fields (`2400.1 Meal Service`, `2300 Service Charges`, `2200 Catering Revenue`) + forecast/actual per line.
- Bible §"Passthrough is never revenue" lines 44-56: cost passthrough excluded from KPI too.

**What today's app shows:** NEITHER the projected side NOR the actual side displays the KPI/all-in
lens for SF% accounts. Both sides display the per-meal invoice value (correct on projected side by
luck of the 2026-06-16 correction; understated by a further factor on the actual side, see Part 3).

### (f) Cost basis / margin

**Plain:** "Cost basis" in some docs means the SF-stripped invoice rate (70% for CIN-AZ). It does
NOT mean COGS. True cost basis (labor $ + food $ + supplies $ per meal) lives in downstream cost
pipelines - out of SC scope.

**Citations:**
- SC_KPI_PUSH_CONTRACT §"What the SC does NOT push" lines 49-59: COGS is out of SC scope.
- SC_LENS_VISION §2 "Scope boundary": "The calendar owns Revenue + headcount; it does not own COGS, labor, or any cost line."
- Bible + ACCOUNT_SERVICES_BRIEF use "cost basis" loosely to mean the 70% rate; the seed script comment (`_seed_sc_from_xlsx.mjs:440-445`) also uses this language.

**Cleanup candidate:** the "cost basis" phrase in ACCOUNT_SERVICES_BRIEF §Executive Summary +
bible §Resolved line 87 + seed comment line 441 conflates SF-stripped invoice rate with COGS.
Renaming to "post-SF invoice rate" would remove the confusion.

### (g) Flat-fee accounts - what the SC tracks vs where their money lives

**Plain:** For CIN-OH / STL-MO / STL-FL / TXR-TX-H/V, the operator still enters headcounts into the
SC for planning (ordering, labor, waste). The DOLLARS come from `sc_fee_schedule`, not from
`count × price`. The SC's on-screen dollar display for these accounts should be zero-priced
(planning tracking only) or drawn from the fee schedule (contract-revenue layer).

**Mechanism:**
- Per-meal prices set to $0 in PG (bible §Fee schedule lines 72-74; SC_BILLING_MODEL_AUDIT §STL-FL section).
- STL-FL: was `flat_fee` in `accounts.billing_model` all along; prices zeroed 2026-06-16.
- CIN-OH: same, `flat_fee`, prices at $25.95 planning-only in PG (audit line 141 confirms).
- Contract-revenue values in `sc_fee_schedule`: CIN-OH $362,500; STL-MO $473,000; TXR-TX-H $604,032; STL-FL $1,400,000; TXR-TX-V $0 (covered by H).

**Special case - STL-FL prorated allocation:** the $1.4M is spread PHASE-AWARE across periods per
GOTCHAS line 474-475: "P1 $45,553 ... P3 peak $407,375 ... FCL plateau $98,915 ... offseason $0."
Not flat-monthly. `sc_fee_schedule` today holds the annual $1.4M number but does NOT hold the
per-period allocation - that's a future dashboard concern.

### (h) Passthrough - never revenue

**Plain:** Some contracts include a "food, packaging, supplies" budget that KitchFix collects and
pays straight to suppliers. That money is NOT revenue - it flows through at zero margin.

**Sources agree (bible §"Passthrough is never revenue" lines 44-56; SC_KPI_PUSH_CONTRACT):**
Excluded from all revenue figures.

**Passthrough lines (excluded):**
- CIN - OH: food and disposable supplies budget (at cost, Net 30)
- STL - MO: $225,000 food/packaging/supplies budget
- STL - FL: $900,000 food/packaging/supplies budget

`sc_fee_schedule` correctly excludes these (bible §"Passthrough is never revenue" lines 61-70
"Passthrough excluded").

### (i) Non-revenue services + tax-free / flat-fee add-ons

**Plain:** Some SC line items look like services but are not billable revenue. `Fun Money` /
`Fun $$$$ Allocated` in the sheet is an internal team-event budget. `Coffee Service`, `Fountain
Beverages`, `Extra Protein - Beef/Seafood`, `MLB - Extra MTO - Sm/Med/Lrg` etc. are per-unit
flat-fee add-ons with a separate `is_flat_fee` flag; some are `is_tax_free`.

**Mechanism:**
- `sc_services.is_non_revenue` (sc-1b, 2026-06-19) flags them; view SUMs skip them for revenue rollup.
- `is_flat_fee` + `is_tax_free` set per account per bible §per-account tables.
- ACCOUNT_SERVICES_BRIEF §per-account tables confirm the assignments.

**Sources agree.** No drift.

### (j) Effective-dating

**Plain:** Price history is preserved. A CPI bump or contract renegotiation is a NEW row in
`sc_service_prices` with a later `effective_date` - the old row stays. Historic invoices continue
to price at the effective-at-that-day rate.

**Mechanism:**
- `sc_service_prices(service_id, effective_date, price_kind, price)` with UNIQUE (service_id, effective_date, price_kind) after sc-8a.
- View joins via LATERAL: latest row where `effective_date <= service_date`.
- Backdate fence in admin (PR #224) enforces `>= 2024-01-01` and `<= today` for backdate mode.

**Sources agree.** ACCOUNT_SERVICES_BRIEF §per-account tables show the current-in-effect rates;
PG holds the history.

### (k) Two-layer architecture (per-meal/operational vs contract revenue)

**Plain:** SC dollars = per-meal revenue only. Everything else (flat fees, service fees, postseason
per-game) lives in a separate "contract revenue layer" managed via admin + `sc_fee_schedule`, and
reads to the future KPI dashboard - NOT the calendar.

**Mechanism:**
- SC surface: reads `sc_daily_revenue` (view). Per-meal invoice line item.
- Admin surface: reads `sc_service_prices` (per-meal editor) + `sc_fee_schedule` (contract-revenue editor). Both surfaces manage data one place.
- KPI dashboard (future): consumes `sc_daily_revenue` per SC_KPI_PUSH_CONTRACT + `sc_fee_schedule` per bible.

**Sources agree** (bible §"The architecture" lines 17-42; ACCOUNT_SERVICES_BRIEF §Executive Summary; SC_LENS_VISION §5).

---

## Part 3 - Contradiction & drift register

Every material contradiction found, tabled. VERDICT column names which source is correct on
factual grounds (workbook evidence + code + Kevin's read); "what needs correcting" says which line
or row would need to change to make the doc set self-consistent - but this report proposes NOTHING
today, it just names the drift.

| # | Topic | Source A | Source B / Reality | Code / Data reality | VERDICT | What needs correcting |
|---|---|---|---|---|---|---|
| **D1** | Which price is the client's per-meal invoice for SF% accounts | ACCOUNT_SERVICES_BRIEF:33 - *"For actuals_drive_invoice accounts, the PROJECTION tab price is the billing rate that gets multiplied by meal counts on the invoice."* | Bible §Resolved line 87: *"per-meal is billed at the 70% cost basis. $29.01 x 0.70 = $20.31."* + SC_LENS_VISION §5.2 line 109: *"Actuals prices are 70% of projected (a contracted discount baked into the actuals tab)."* + SC_KPI_PUSH_CONTRACT lines 39-45: *"CIN-AZ: actuals at 70% of projected price... If the push used sticker prices for actuals, the dashboard would overstate revenue vs the P&L."* + GOTCHAS lines 471-472: *"Using sticker prices for actuals overstates revenue."* | Workbook: CIN-AZ actuals-tab row 2 G2 is literally `=29.00888 * 0.7` (memo Part A). Same shape TXR-AZ (`* 0.8`), TBR-FL MiLB (`* 0.75`) | **Actuals-tab price = per-meal invoice. Projection-tab price = KPI/planning lens.** Kevin's 2026-07-09 statement is correct. | ACCOUNT_SERVICES_BRIEF:33 needs a corrective rewrite. The bible wins by its own header ("this section wins conflicts"). |
| **D2** | Whether sc-8b's `'actual'` rows are `sticker × factor` today | sc-8b migration comment (line 6-95): *"actual_revenue landing at ~$320K matches the P&L 2400.1 Meal Service line"* (assumes `projected` rows still hold sticker) + notes column on the inserted rows literally reads *"actual = projected * 0.70 (CIN-AZ contracted rate)"* | Kevin's 2026-06-16 manual SQL correction moved `projected` rows to the 70%/80%/75% rate BEFORE sc-8b ran. Seed comment `_seed_sc_from_xlsx.mjs:440-445` documents this. Kevin's CSV shows: CIN-AZ `projected` = $12.90; CIN-AZ `actual` = $9.03 | View math today: `actual_revenue = actual_count × pr_act.price` = count × 49% of sticker (double-discounted, 30% understatement vs correct invoice). Same shape TXR-AZ (64% instead of 80%, 20% understatement) and TBR-FL MiLB (56% instead of 75%, 25% understatement). Memo Part C sizing example: 100+50+15 CIN-AZ day = $2,401 correct invoice vs $1,680 app-displayed | **The sc-8b comments describe intent; PG state is double-discounted.** The migration was CORRECT under the assumption `projected` held sticker; that assumption was already broken when it ran. Data issue, not code issue. | sc-8b's inserted `actual` rows' `notes` column now describes wrong math. The rows themselves are the problem. Fix is data (Part 5, Q1). |
| **D3** | Which price PG should hold as "canonical" for CIN-AZ | SC_SPREADSHEET_MAPPING:66 - *"the canonical sc_service_prices entry should be 29.00888 (the bill rate)"* + line 185 *"canonical sc_service_prices stores PROJECTION price; cost basis is internal margin tracking"* | 2026-06-16 manual correction + all other docs say $12.89 IS the bill rate (post-SF), $29.01 is the KPI/sticker. Bible + SC_LENS_VISION + SC_KPI_PUSH_CONTRACT + GOTCHAS. | PG `projected` rows for CIN-AZ = $12.89 today (Kevin's manual correction persists) | **The mapping doc's "canonical = $29.01" ruling was superseded on 2026-06-16.** Its own reasoning ("bill rate") is right; its identification of $29.01 as bill rate is wrong. | SC_SPREADSHEET_MAPPING:66 and :185 need a "superseded 2026-06-16" note pointing at bible + memo. |
| **D4** | "Cost basis" language | ACCOUNT_SERVICES_BRIEF §Executive Summary line 33: *"actuals tab price is a cost-basis tracking number for internal margin reporting"* + bible §Resolved line 87 uses "70% cost basis" | SC_LENS_VISION §5.2 line 109 uses "actuals prices are 70% of projected (a contracted discount)" - no "cost basis" framing. SC_KPI_PUSH_CONTRACT §"Critical: actuals use the contracted rate" - explicit "contracted rate", not "cost basis". GOTCHAS line 471 uses "contracted discount" | The 70% number is the per-meal invoice line, not a COGS figure. True COGS lives out of SC scope. | **"Cost basis" is misleading naming.** The 70% rate IS the per-meal invoice. Rename to "post-SF invoice rate" or "contracted per-meal rate" everywhere it appears. | Rewrite the phrase in ACCOUNT_SERVICES_BRIEF §33, bible §Resolved line 87, seed script comment line 441. |
| **D5** | Whether the KPI push spec matches PG reality | SC_KPI_PUSH_CONTRACT lines 39-45 - *"actuals at 70% of projected price... matches the P&L 2400.1 Meal Service line"* assumes `projected` holds sticker and `actual` holds contracted | PG today: `projected` = contracted, `actual` = double-discounted. Under D2's actual state, the push would understate `2400.1 Meal Service` by 30% for CIN-AZ | Nothing in the SC_KPI_PUSH_CONTRACT's math still lands correctly if we implement it now against current PG state. | **The KPI contract's spec is right; the PG state it assumes is broken.** Fix is upstream - fix PG (D2) first, then the KPI contract's math works as written. | Wait for D2 fix; KPI contract needs no rewrite. |
| **D6** | ACCOUNT_SERVICES_BRIEF's claim to authority | ACCOUNT_SERVICES_BRIEF line 3: *"Source-of-truth reference for how every KitchFix account's billing, pricing, service fees, and service calendar work."* | Bible §RESOLVED BILLING DECISIONS lines 3-8: *"Locked 2026-06-18 (Kevin + Chat-Claude, from executed contracts). This section is the source of truth; the per-account contract extraction below it is the supporting detail. When a decision here conflicts with older notes... THIS SECTION WINS."* | Bible was landed 2026-06-19; ACCOUNT_SERVICES_BRIEF was landed 2026-06-16. Chronologically, bible IS the newer authority. | **Bible wins by its own explicit header, chronology, and by every other money doc's citation.** ACCOUNT_SERVICES_BRIEF should be re-framed as a per-account digest that DEFERS to the bible on any conflict, and get a "superseded on money model by bible" banner at top. | ACCOUNT_SERVICES_BRIEF §top banner needed; line 3 wording softened; line 33 rewritten. |
| **D7** | Whether STL-FL flat_fee display gate works | SC_BILLING_MODEL_AUDIT §3.2 lines 91-113 says: "The current SC calendar treats STL-FL as per-meal display because the isFeeAccount gate requires BOTH billing_model=flat_fee AND homestandMap to be non-empty - STL-FL has zero homestand rows so falls through to per-meal." | Bible §"STL - FL is promoted to a true fee account" says the operational entry stays (chefs still enter counts) but revenue lens = $1.4M fee | STL-FL displays per-meal shape on the calendar today (fee-no-dollar variant). Contract-revenue $1.4M lives in `sc_fee_schedule` unread by the calendar UI. | Both docs are internally consistent; the gate limitation is known. **Not a contradiction - a known scope split.** Ships as-is per bible §"The calendar does not show these dollars." | No action; already reflected. |
| **D8** | Whether the 2026 operative CIN-AZ pricing is documented | ACCOUNT_SERVICES_BRIEF §CIN-AZ lines 63-64 + 80: *"The operative 2026 pricing document is not in the contracts folder on file (open question)"* + bible §Resolved line 87: *"The '$29.01 vs $20.31 gap' is NOT a missing amendment - it is this mechanic."* + SC_BILLING_MODEL_AUDIT line 48 + 69: *"operative 2026 pricing NOT in the 2023 doc - the spreadsheet $29.01 MLB Breakfast is ~62% above the 2023 base + max CPI, meaning an amendment exists out-of-band"* | Workbooks give the operative 2026 rates but not the amendment paperwork | The three docs disagree on framing: BRIEF says "not on file", bible says "not a missing amendment [the gap is the mechanic]", AUDIT says "amendment exists out-of-band". They're talking about two different gaps: (a) is the current $29.01 → $12.89 mechanic a mystery? (bible answers no, it's the 30% SF) (b) is the $17.88 (2023 contract) → $29.01 (2026 sticker) escalation documented? (BRIEF + AUDIT answer no, that trail is missing) | **The two questions were conflated.** Bible answers (a); the amendment paperwork answering (b) is genuinely missing per BRIEF + AUDIT. Both hold. | ACCOUNT_SERVICES_BRIEF §CIN-AZ Open Notes line 80 and audit line 48 point at the same real gap (amendment paperwork). Not a doc drift, a real open item - see Part 5 Q4. |

---

## Part 4 - Timeline: how the money model got here

Chronological, from git log + doc lock dates + memo evidence. This is the story that
explains the double-discount.

### 2026-06-15 - Contract analysis lands (`1ac0e44`)

Chat-Claude produced three docs off the executed contracts + workbook audit:

- `SC_PRICE_COMPARISON.md` (archived 2026-07-17 to `docs/archive/`) - data table of projection-tab vs actuals-tab prices for every account.
- `SC_SPREADSHEET_MAPPING.md` - per-account sheet layout for the seed importer.
- `SC_CONTRACT_BILLING_SUMMARY.md` - the per-account contract-language extraction.

At this point, no "resolved decisions" section in the bible yet. The mapping doc (line 66) rules
"canonical = projection tab price = $29.01 the bill rate" - a defensible-at-that-moment reading of
the raw contract language for CIN-AZ.

### 2026-06-16 - ACCOUNT_SERVICES_BRIEF lands (`62a3be5`)

The Brief consolidates the three older docs + adds Kevin's oral notes + ABR context. Written
before the bible's Resolved section. Its Executive Summary §line 33 states "PROJECTION tab price
is the billing rate" - which agrees with SC_SPREADSHEET_MAPPING's ruling from the day before. At
the time of writing this was the coherent story.

### 2026-06-16 (same day) - Kevin runs the manual SQL correction

Out-of-band Supabase Studio event. Kevin corrected CIN-AZ prices in `sc_service_prices` from the
projection-tab full rates ($29.01 / $18.42) to the actuals-tab / SF-stripped rates ($20.31 / $12.90).
**Intent:** app should display the per-meal invoice rate, not the KPI sticker. (Confirmed by the
seed script comment `_seed_sc_from_xlsx.mjs:440-445` documenting the incident.)

**This is the pivot point.** After this SQL edit, the two source docs above (mapping doc line 66,
BRIEF line 33) no longer describe PG reality. PG holds bill-rate prices; the docs describe
sticker-rate-as-canonical. Neither doc was updated. The drift starts here.

### 2026-06-17 (approx) - Seed protects the correction (`560b757`)

Kevin's re-import of CIN-KY corrections silently overwrote the CIN-AZ correction (the upsert had
`ON CONFLICT DO UPDATE`, so re-import moved prices back to sheet values). The fix: switch
`sc_service_prices` upsert to `ignoreDuplicates: true` so re-imports never clobber SQL corrections.
Seed script comment lines 440-450 capture the incident.

**Consequence:** manual-SQL becomes the mechanism for setting canonical prices, distinct from the
seed's mechanism. Docs still reflect the seed's shape.

### 2026-06-18 - Contract analysis finalized (dated in bible header)

Chat-Claude + Kevin reviewed the executed contracts and locked billing decisions. The bible's
"RESOLVED BILLING DECISIONS" section (lines 3-127) is drafted with this date, containing:
- CIN-AZ line 87: "billed at the 70% cost basis" - explicitly matching Kevin's manual correction.
- The Service Fee mechanic explained: SF flat annual paid separately; per-meal at 70%.
- The two-layer architecture (§17-42): SC per-meal / admin+dashboard fee-schedule.

**Bible now agrees with PG state** (post-correction). ACCOUNT_SERVICES_BRIEF and SC_SPREADSHEET_MAPPING
still don't. The bible's header calls itself the authority.

### 2026-06-19 - Bible commit + fee-schedule PR set (`9c08133`, PR #221)

Bible section committed. sc-5 migration + admin fee-schedule surface + seed of 5 flat-fee amounts
land (CIN-OH $362,500 / STL-MO $473,000 / TXR-TX-H $604,032 / TXR-TX-V $0 / STL-FL $1,400,000).
Two-layer architecture becomes concrete: contract revenue lives in `sc_fee_schedule`; SC doesn't
read it.

### 2026-06-19 to 2026-06-22 - Catalog lifecycle (sc-6a/b/c, PRs #227/#229/#234)

`active_until` archive column + view recreate + admin surface. Doesn't touch prices.

### 2026-06-22 - Changelog latest view (`bbc7546`)

Admin cap fix. Doesn't touch prices.

### 2026-06-24 - The pricing-fix PR + docs update (`252c4ae` + `ae4b898`)

Two PRs merged the same day, connected in intent:

**Code PR `252c4ae` "sc revenue-engine pricing fix":**
- sc-8a migration adds `price_kind` column ('projected' | 'actual'), defaults existing rows to `'projected'`, extends the UNIQUE index to include kind.
- sc-8b migration INSERTs `'actual'` rows for the three SF% accounts as `projected × factor`
  (0.70 / 0.80 / 0.75), and recreates `sc_daily_revenue` with two LATERAL joins so
  `actual_revenue` reads `pr_act.price` (falling back to `pr_proj.price` for non-discounted
  services).

**The critical assumption in sc-8b's design (documented in migration lines 6-95):**
> "actual_revenue landing at ~$320K matches the P&L 2400.1 Meal Service line"

This math only works if `projected` still holds sticker prices. **But Kevin's 2026-06-16
correction had already moved `projected` to the SF-stripped (invoice) rate.** sc-8b was written
against the DOC state (mapping doc line 66 "canonical = $29.01"), not against the PG state.

**Result: sc-8b DOUBLE-DISCOUNTED.** CIN-AZ `actual` rows landed at $12.90 × 0.70 = $9.03 (49% of
$18.42 sticker) instead of the intended $12.90 (70%). Same shape TXR-AZ (64% not 80%) and TBR-FL
MiLB (56% not 75%).

Nobody noticed at the time because:
- The view's `projected_revenue` was already showing the invoice rate correctly (Kevin's
  correction had propagated).
- The old code paths reading `data.serviceGroups[s].price` still worked (they read the
  `projected` price, which was the invoice rate, and the UI was consuming the invoice number
  as intended).
- `actual_revenue` was only lightly consumed at the time (the Bundle-1 server-echo unification
  wasn't in yet).

**Docs PR `ae4b898`:**
- Added `SC_LENS_VISION.md` with §5.2 line 109 documenting the 70% mechanic.
- Added `SC_KPI_PUSH_CONTRACT.md` with §"Critical: actuals use the contracted rate" lines 39-45.
- Added GOTCHAS.md entries 471-472 and 474-475 warning about the discount trap.
- Marked as "close billing-audit open items."

**These docs are internally consistent with the bible and workbook reality.** They correctly
describe the intended math. They did NOT catch that sc-8b's implementation double-discounts,
because they describe the intent (which is right) not the state.

### 2026-06-24 to 2026-07-07 - Section-1/2/3 SC audits + fixes (PRs #353-#363)

Bundle 3 (SC-051 / #361) unifies all SC surfaces on the view's `projected_revenue` and
`actual_revenue`. This is where the double-discount BECAME visible - the app now server-echoes
`actual_revenue` to the toast + aggregate + week-card. On CIN-AZ, actual reads as 49% of sticker
instead of 70%. But nobody explicitly compared the projected vs actual side numbers on an SF%
account until 2026-07-09.

### 2026-07-09 - Lens audit lands (`/tmp/SC_REVENUE_LENSES_MEMO.md`)

Workbook-primary audit runs, comparing the projections tab, actuals tab, docs, and PG state.
Findings:
- Every SF% workbook's actuals-tab row 2 is a literal `=sticker × factor` formula.
- Bible / lens vision / KPI contract / GOTCHAS all agree with Kevin's 2026-07-09 statement.
- ACCOUNT_SERVICES_BRIEF §33 is the outlier.
- PG holds `projected` = invoice rate (from Kevin's 2026-06-16 correction) + `actual` =
  double-discounted (from sc-8b assuming `projected` = sticker).

Kevin's Round-3 fixes (#365 SC-078 classifier, #366 SC-077 MLB no-service, etc.) merged in this
window - unrelated to the money-model issue.

### 2026-07-09 (this report) - Alignment

This report consolidates the memo evidence + doc inventory + timeline into the ONE shared model
all three parties (Kevin, Chat, CC) can review before any next step. No code, doc, or data
changes proposed yet.

---

## Part 5 - Open questions for Kevin

Numbered decisions. Each has options; no default recommendation is pre-baked into the doc/code
until Kevin picks.

### Q1 - Step-A fix for the sc-8b double-discount (data, not code)

**Question:** Which mechanic should PG use to represent the two lenses (invoice vs KPI/sticker),
so `sc_daily_revenue.actual_revenue` matches the P&L 2400.1 Meal Service line?

**Options:**

**Option 1 - Delete the `'actual'` rows for CIN-AZ / TXR-AZ / TBR-FL MiLB.**

```sql
BEGIN;
DELETE FROM sc_service_prices
 WHERE price_kind = 'actual' AND created_by = 'sc-8b-backfill';
COMMIT;
```

View's `COALESCE(pr_act.price, pr_proj.price)` falls back to the `projected` row, which today
holds the invoice rate ($12.89). `actual_revenue = actual_count × invoice_rate` = the correct
per-meal invoice number. The KPI/sticker lens becomes unreachable via this schema (which was
already the case before sc-8a landed).

Pros: cleanest, one-line fix, mirrors the pre-sc-8a state that already worked. Idempotent under
sc-8b's own rollback plan (migration lines 108-114).

Cons: loses the two-lens capability at the price layer. If we ever want to compute the KPI/all-in
lens (sticker × count) inside PG, we'd need to restore it later - either by re-running sc-8b
after fixing the assumption, or by introducing a third kind (Option 3).

**Option 2 - Restore `'projected'` rows to sticker prices ($29.01 / $18.42 / $9.08 for CIN-AZ), leave the sc-8b `'actual'` rows in place.**

Update the `projected` rows to the workbook sticker values via a targeted UPDATE. The sc-8b
`actual` rows are already at 0.7 × sticker (they landed at 0.7 × the current `projected` = 0.49
× sticker; restoring `projected` back to sticker makes them 0.7 × sticker = correct invoice rate).

Pros: gives PG BOTH lenses correctly (`projected` = KPI/sticker; `actual` = invoice rate). Under
Bundle 1's #361 wiring, `projected_revenue` would then show KPI value and `actual_revenue` would
show invoice value on the same day.

Cons: **the app's projected-side displays flip lens.** Modal group header for CIN-AZ MiLB Breakfast
becomes $18.42 (KPI/sticker); grayed projected revenue on the tile becomes count × $18.42. The
operator would suddenly see a KPI target on the projected side and a discounted number on the
actual side. That's the semantically correct behavior IF the operator wants both lenses visible,
but it's a large UX change. Also requires re-verifying every consumer of `data.serviceGroups[s].price`
because they'll all shift from invoice to KPI.

**Option 3 - Introduce a third `price_kind = 'sticker'`. Keep `projected` = invoice rate (current state), fix `actual` to also = invoice rate, and store the KPI/sticker separately.**

Add sticker rows for the three SF% accounts. The view could keep exposing `actual_revenue` at
invoice rate + add `sticker_revenue` for the KPI lens. Preserves the current app behavior
(projected side reads invoice), fixes the actual side to also read invoice, gives a clean
namespace for the KPI/all-in lens.

Pros: no app UX flip; clean semantics; KPI dashboard has a first-class column to consume.

Cons: schema surface grows; requires an sc-8c migration. Fine, but more work.

**Kevin's decision needed:** which option, or a combination?

**Adjacent factual note:** `actual` rows carry a `notes` string that will be materially wrong under
Option 1 (deleted) or Option 2 (needs the notes rewritten). Whichever option, the note should be
corrected or removed.

### Q2 - Sticker / KPI-lens scope (Step B)

**Question:** Does the app itself need to show the KPI/all-in lens for SF% accounts, or is it OK
to defer that to the KPI dashboard?

**Options:**
- **Defer to KPI dashboard.** The app continues to show invoice-lens dollars. Operators mentally
  translate to the KPI target when doing budgeting; the KPI dashboard displays the sticker × count
  breakdown. This is the current design intent per SC_LENS_VISION §5 and SC_KPI_PUSH_CONTRACT
  §5-6.
- **Show both lenses in-app.** Adds a "KPI" toggle or a subordinate phrase; operators see
  invoice + all-in together on the same day. More surface area, more UX design.
- **Show KPI lens only (drop invoice from the calendar).** Operators budget against KPI, which is
  what they're measured on. Finance owns invoicing anyway.

**Kevin's decision needed:** whichever option answers "what number does the operator plan
against, on the tile?" (that's the number the app should show as the hero.)

### Q3 - Which doc becomes THE canonical money doc going forward

**Question:** After alignment, which single doc do all three parties defer to on money model
disputes? The current answer per its own header is the bible (SC_CONTRACT_BILLING_SUMMARY.md), but
that's a per-account contract extraction doc that grew a "RESOLVED BILLING DECISIONS" section
after the fact. A cleaner arrangement would separate the money MODEL (a compact per-topic doc)
from the per-account CONTRACT extractions (the current bible body).

**Options:**
- **A: Keep the bible as-is.** Rewrite ACCOUNT_SERVICES_BRIEF §33 + add a superseded-by banner
  on SC_SPREADSHEET_MAPPING §66. Bible stays the ruler.
- **B: Promote this report + memo into a new `docs/SC_MONEY_MODEL.md` that becomes the canonical
  money-model doc.** Bible retreats to a per-account contract-extraction reference (deletes the
  RESOLVED section, points at SC_MONEY_MODEL). Other docs (BRIEF, KPI contract, LENS vision, etc.)
  cite SC_MONEY_MODEL for model + bible for contract-language details.
- **C: Fold this report into the bible as a leading section.** Consolidates but grows the bible.

**Kevin's decision needed:** which structure minimizes future drift?

### Q4 - The CIN-AZ 2026 pricing paperwork gap

**Question:** The 2023 contract's base rates ($17.88 MLB Breakfast, $11.35 MiLB Breakfast) don't
CPI-escalate to the operative 2026 rates ($29.01 / $18.42 sticker in the workbook). A separately
negotiated 2026 SOW or amendment must exist and isn't in the contracts folder. Should we hunt for
it now, or accept the workbook rates as operative for planning?

**Options:**
- **Hunt now.** Ask Ashley / Kevin's counterparty at the Reds for the 2026 SOW paperwork.
- **Accept workbook rates as operative, document the paperwork gap.** Add a note in
  ACCOUNT_SERVICES_BRIEF §CIN-AZ that the operative 2026 rates are workbook-only; get paperwork
  before the 2027 renewal decision.

**Kevin's decision needed:** priority level.

### Q5 - "Cost basis" language cleanup

**Question:** The bible + BRIEF + seed script call the 70% rate "cost basis." Semantically it's
the per-meal invoice line item, not COGS. Rename?

**Options:**
- **Rename to "post-SF invoice rate" or "contracted per-meal rate"** everywhere.
- **Leave the naming, add a footnote clarifying it's not COGS.**
- **Leave it. Kevin knows what it means.**

**Kevin's decision needed:** whether the cleanup is worth the doc edit surface.

### Q6 - TBJ-NY Buffalo Bisons

**Question:** No contract in the package (bible §Open items #1). Prices in workbook + PG are
assumption-only. Do we treat this as a data gap to close now (get a contract) or later?

**Kevin's decision needed:** urgency.

---

## Part 6 - Proposed canonicalization plan

**Do NOT execute.** These are the PRs that would follow alignment. Each depends on Kevin's
answers to Part 5.

### PR A - sc-8c: data fix

Depends on Q1's option choice. Concrete SQL migration script that either:
- Deletes the wrong `actual` rows (Option 1); or
- Restores `projected` rows to sticker (Option 2); or
- Adds a `sticker` kind (Option 3).

Includes a verify probe: post-migration query showing per-account `actual_revenue` for a known
day matches the P&L Meal Service line.

**Estimated size:** small (one SQL file, one probe script).

### PR B - Doc corrections

Depends on Q3's structure choice.

Under Option A (keep bible):
- Rewrite `ACCOUNT_SERVICES_BRIEF.md:33` to align with the bible's model.
- Add "superseded on money model" banner at the top of ACCOUNT_SERVICES_BRIEF.
- Add "superseded 2026-06-16 by manual correction; see bible + memo" banner near
  `SC_SPREADSHEET_MAPPING.md:66` and :185.
- Fix the `notes` column on sc-8b's `actual` rows if they persist under Q1 choice.

Under Option B (promote to SC_MONEY_MODEL.md):
- Create the new doc from this report + memo.
- Retire the bible's RESOLVED BILLING DECISIONS section, replacing with a pointer to
  SC_MONEY_MODEL.
- Update every other doc's citations.

**Estimated size:** medium (5-10 files touched depending on option).

### PR C - Commit the memo + this report + a canonical banner

Commit `docs/SC_REVENUE_LENSES_MEMO.md` (the workbook audit) + this report as
`docs/SC_MONEY_ALIGNMENT_REPORT.md` regardless of Q3 outcome. They're the record of how we
got here.

**Estimated size:** small (2 files, no code).

### PR D - GOTCHAS additions

Two new entries in `docs/GOTCHAS.md`:

1. **"The shifted-input backfill trap"** - if a data-transformation migration assumes an input
   column's value (like sc-8b assumed `projected` held sticker prices), verify the assumption at
   run time (via a sanity probe SELECT) before the transform runs. sc-8b would have caught its own
   error if it had asserted "CIN-AZ MiLB Breakfast projected price is $18.42 (not $12.90) before I
   multiply by 0.70."

2. **"Out-of-band Supabase corrections need coordination"** - if you SQL-edit a table that a
   subsequent migration transforms, the migration MUST re-verify the edited state before
   transforming, OR the correction must be captured as a proper migration (with a comment
   documenting the intent). The 2026-06-16 correction → sc-8b interaction is the case study.

**Estimated size:** small (one file).

### PR E - The Export feature spec (later)

Waits behind PR A + PR B. Uses the settled model to decide export columns per account shape
(memo Part D Recommendation A).

### Optional PR F - Live-app KPI lens (depends on Q2)

If Kevin's Q2 answer is "show both lenses," this is the app-side work.

### Order of operations

1. **This report** reviewed by Kevin (+ Chat if useful) → 5 decisions in Part 5.
2. **PR A** (sc-8c data fix) → PG state matches the settled model.
3. **PR C** (commit memo + report) → historical record captured.
4. **PR B** (doc corrections) → docs match the settled model.
5. **PR D** (GOTCHAS) → future migrations don't repeat the trap.
6. **PR E** (Export) → export ships against the settled model.
7. **PR F** (Live-app KPI lens, if chosen).

Nothing gets fixed until Kevin's Part-5 answers are in hand. This report itself stays
uncommitted until Kevin says it should be committed (Q3 Option choice).

---

## Appendix - fast-reference numbers

For anyone re-reading this later: what the three lenses come out to on a real CIN-AZ ST day
(100 MiLB Lunch + 50 MLB Lunch + 15 Continental Plus).

| Lens | Formula | Value |
|---|---|---|
| **KPI / ops (all-in, per P&L 2400.1)** | 100 × $18.42 + 50 × $29.01 + 15 × $9.08 | **$3,428** |
| **Per-meal invoice (correct, per contract)** | 100 × $12.90 + 50 × $20.31 + 15 × $6.36 | **$2,401** |
| **App projected_revenue TODAY** | 100 × $12.90 + 50 × $20.31 + 15 × $6.36 | $2,401 |
| **App actual_revenue TODAY (after save)** | 100 × $9.03 + 50 × $14.22 + 15 × $4.45 | **$1,680** |

Delta on the SAME day between what the operator sees when they save vs the correct invoice: **$721
understatement, ~30%.** Extrapolated to a typical CIN-AZ ST week: **~$5,600.** Extrapolated to a
10-week ST season: **~$56,000.**

Same shape TXR-AZ (20% understatement) and TBR-FL MiLB (25%). Every other account: correct today.

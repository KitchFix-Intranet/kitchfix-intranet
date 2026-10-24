# SC revenue admin discovery - 2026-08-28

> READ-ONLY follow-up to PR #888 (Overview Revenue Discovery). Kevin's correction: service charges do NOT live in a standalone table; they live in the Service Calendar (SC) and Kevin edits them through the SC admin surface. The fee schedule is managed there too. The prior audit asked the wrong question. This one finds the real representation.
> All claims labelled `[ran]` or `[code-read]` per BUILD_ACCURACY_PROTOCOL C1. No budget dollar values are enumerated per the loader-pattern rule.

---

## Executive summary

- **The SC admin surface is a fully-shipped, tightly-scoped edit layer.** `[code-read]` Nine POST actions + five GET actions live in `src/app/api/service-calendar/route.js`, all `isScAdmin`-gated against an 8-member `SC_ADMIN_EMAILS` set (`src/lib/admin.js:60-69`). Every write pairs an `sc_config_changelog` row (entity_type in `price|service|group|fee|fun_money|qbo_*`). Price editor covers Today / Future / Backdate modes with a fenced backdate path (`src/lib/scBackdateReport.js`). Fee editor writes `sc_fee_schedule` insert-only. Both surfaces mint prose-composed changelog reasons that name touched closed periods.
- **"Service charges" are not one thing; they are many differently-shaped services scattered across accounts.** `[ran]` 27 charge-shaped services live across 6 accounts today: Coffee Service + Fountain Bev + Pre-Game Snack (CIN-AZ), Snack (CIN-KY, STL-FL, TBJ-FL), Fun Money / Fun $$$$ Allocated (STL-FL, TBJ-FL), Media Meals / MLB G&G / MiLB G&G / MLB - Catering / Scout Meals (TBJ-FL), Extra Protein + Extra MTO + Road Sandwiches (TBR-FL, TXR-AZ). Flag mix: 15 `is_flat_fee`, 2 `is_non_revenue`, 2 `is_tax_free`. None carries any `price_kind='actual'` row (55 charge-shaped price rows are 100% `projected`).
- **Section 5.7 contamination does NOT visibly extend to the fee accounts' charge-shaped services.** `[ran]` CIN-OH / STL-MO / TXR-TX-H / TXR-TX-V carry ZERO charge-shaped services. STL-FL has two (Snack $0, Fun Money allocation) and both are already `is_non_revenue=true` OR at $0. So the CIN-OH $4,671.76 + STL-FL $466,216.00 bleed from the prior audit stays a per-meal fee-account issue; the charge-shaped services do not amplify it.
- **The `sc_daily_revenue` view already carries a $318M actual_revenue value on TBJ-FL "Fun $$$$ Allocated"** `[ran]` (`is_non_revenue=true`, three `import-script` seed rows with counts 3090 / 1468 / 6645 x seed price $28,472.756). It is filtered out of `sc_month_summary` totals by `FILTER (WHERE NOT is_non_revenue)` (`sc-8b-actual-prices-and-view.sql:279-283`) but any Overview reader that queries `sc_daily_revenue` directly for actual_revenue MUST apply the same filter or eat the $318M contamination. Same class of "view is right, input is wrong" as playbook §5.7.
- **The SC admin cannot produce per-period 2300 actuals today.** `[code-read]` `[ran]` No installment / recognition / allocation table exists (9 candidate names probed, all ABSENT). `sc_fee_schedule.payment_cadence` is declared informational-only (`sc-5-fee-schedule.sql:72-75`). The four canonical 2300 mappings from `SC_MONEY_MODEL.md`/`SC_CONTRACT_BILLING_SUMMARY.md` (SF% buydown on CIN-AZ / TXR-AZ / TBR-FL MiLB, flat SF on TBJ-FL, road-catering on STL-MO, contract-service-fee portion on flat-fee accounts) all live outside PG and are not addressable through today's admin surface.

---

## Part A - SC admin surface inventory

### A.1 Routes / pages

`[code-read]` The admin lives in-page under `/service-calendar?view=admin`, gated client + server. Legacy bookmark `/service-calendar/admin` redirects to the in-page mount (`src/app/service-calendar/admin/page.js:19-27`).

| Path | File | Type |
|---|---|---|
| `/service-calendar` (view=admin) | `src/app/service-calendar/page.js` | Client page. `SC_ADMINS` gate for calendar visibility. |
| `/service-calendar/admin` | `src/app/service-calendar/admin/page.js` | Server component. `redirect("/service-calendar?view=admin")`. |
| Admin panel | `src/app/service-calendar/admin/AdminPanel.js` | Three-pane host: `AccountsRail` + `CatalogPane` + `EditorRail`. |
| Rails/modals | `AccountsRail.js`, `CatalogPane.js`, `EditorRail.js`, `AdminModals.js`, `LaborBudgetsPanel.js`, `railFormHelpers.js` | Selection state + editor variants (`empty` / `fee` / `service` / `archived` / `archiveService` / `loading`). |
| CSS | `src/app/service-calendar/admin/admin.css`, `ops-sc-admin.css` | `.scav-*` class set. |
| Print/export | `src/app/api/service-calendar/print/`, `src/app/api/service-calendar/export/` | Sibling GET routes; NOT admin-write surfaces. |

### A.2 Gating

`[code-read]` `src/lib/admin.js:60-78`. Frozen Set + normalized checker.

- `SC_ADMIN_EMAILS` = 8 corporate emails (Kevin, Josh, Joe, Britt, Mariela, Sebastian, Ryan Moore, Shane Lynch). Explicitly excludes `d.inthavone@kitchfix.com` per doc comment.
- `isScAdmin(email)` = `SC_ADMIN_EMAILS.has(email.toLowerCase().trim())`.
- Server-side re-check on every admin action; client-side gate on the AdminPanel mount + on the view-mode toggle in `ServiceCalendar.js`.

### A.3 API action surface (every admin action, verbatim from `route.js`)

`[code-read src/app/api/service-calendar/route.js:848-2276]`

| Action | Method | Line | Writes to | Changelog row? | Notes |
|---|---|---|---|---|---|
| `sc-admin-all-config` | GET | 848 | READ | - | Full portfolio catalog snapshot (all accounts + services + prices). |
| `sc-admin-account-config` | GET | 862 | READ | - | Single-account catalog + fee. |
| `sc-admin-fee-list` | GET | 884 | READ | - | Current + upcoming fee per fee-managed account (`flat_fee` + CIN-AZ from `FEE_ELIGIBLE_PER_MEAL`). |
| `sc-admin-fee-history` | GET | 897 | READ | - | Full `sc_fee_schedule` history for one account. |
| `sc-admin-labor-budgets-list` | GET | 917 | READ | - | MLB-only (`DERIVE_HOMESTANDS_ACCOUNTS`). |
| `sc-admin-labor-budget-history` | GET | 936 | READ | - | Per (account, period) history. |
| `sc-admin-labor-ratio-history` | GET | 970 | READ | - | TXR-V-style `labor_ratio` history from `sc_config_changelog` where entity_type=`labor_ratio`. |
| `sc-admin-backdate-preview` | POST | 1608 | READ (dry-run) | - | Enumerates closed periods a backdate would touch; falls back to `{closedPeriods: []}` on error (owner ruling: "do not fail closed"). |
| `sc-config-update` | POST | 1660 | `sc_service_prices` (INSERT) | YES `entity_type='price'` | Prices only. Backdate opt-in via `allowBackdate: true` (floor `2024-01-01`); backdates require `creditDecision: "issue"|"none"`. Server-composes prose reason prefix naming closed periods (`scBackdateReport.js:composeBackdateReason`). |
| `sc-admin-fee-set` | POST | 1851 | `sc_fee_schedule` (INSERT) | YES `entity_type='fee'` | Amount + effectiveDate + reason + optional `paymentCadence` (`monthly-6|monthly-7|quarterly|annual`). Backdate mode identical to price. |
| `sc-admin-labor-budget-set` | POST | 1977 | `sc_labor_budgets` (supersede) | YES `entity_type='labor_budget'` | MLB-only. Period-scoped. |
| `sc-admin-labor-ratio-set` | POST | 2031 | `accounts.labor_ratio` (UPDATE) + changelog | YES `entity_type='labor_ratio'` | TXR-V-family only. |
| `sc-admin-archive-service` | POST | 2068 | `sc_services.active_until` (UPDATE) | YES `entity_type='service'` `change_type='archive'` | Backdate opt-in mirrors price. |
| `sc-admin-archive-group` | POST | 2070 | `sc_service_groups.active_until` (UPDATE) | YES `entity_type='group'` `change_type='archive'` | Cascades: services under the group inherit the group's effective active_until via view JOIN (`sc-8b:281-284`). |
| `sc-admin-reactivate-service` | POST | 2140 | `sc_services.active_until=NULL` (UPDATE) | YES `change_type='reactivate'` | |
| `sc-admin-reactivate-group` | POST | 2141 | `sc_service_groups.active_until=NULL` | YES `change_type='reactivate'` | |
| `sc-admin-add-service` | POST | 2178 | `sc_services` INSERT + initial `sc_service_prices` INSERT | YES `entity_type='service'` `change_type='create'` | Flags: `isFlatFee`, `isTaxFree`, `isNonRevenue`. |
| `sc-admin-add-group` | POST | 2236 | `sc_service_groups` INSERT | YES `entity_type='group'` `change_type='create'` | |
| `sc-config-request` | POST | 2279 | `submissions` (module=`service_calendar`) | NO (writes to submissions table, not changelog) | Non-admin path for site-lead requests. |

Total admin write actions: 9 (excluding preview + config-request). Every one lands a `sc_config_changelog` row atomically-adjacent to the entity insert/update.

### A.4 What each write path edits

`[code-read src/lib/dataStore/serviceCalendar.js exports around lines 524-3288]`

| Entity | Writer function | Backing table | INSERT-only? |
|---|---|---|---|
| Prices | `updateServiceConfig` (line 2586) | `sc_service_prices` | YES (`sc-8a` UNIQUE `(service_id, effective_date, price_kind)`; upserts on that key) |
| Fee schedule | `updateFeeSchedule` (line 3288) | `sc_fee_schedule` | YES (no UNIQUE; a same-day correction is a new row with later `created_at`; sc-5:16-22) |
| Add service | `addServiceWithAudit` (line 2964) | `sc_services` + `sc_service_prices` initial | YES (adds) |
| Add group | `addServiceGroup` (line 3018) | `sc_service_groups` | YES |
| Archive service | `archiveService` (line 2716) | `sc_services.active_until` | UPDATE (single column) |
| Archive group | `archiveServiceGroup` (line 2817) | `sc_service_groups.active_until` | UPDATE |
| Reactivate service | `reactivateService` (line 2766) | `sc_services.active_until=NULL` | UPDATE |
| Reactivate group | `reactivateServiceGroup` (line 2866) | `sc_service_groups.active_until=NULL` | UPDATE |
| Labor budgets | `updateLaborBudget` (`src/lib/dataStore/laborBudgets.js`) | `sc_labor_budgets` supersede | INSERT (supersede pattern) |
| Labor ratio | `updateLaborRatio` (`src/lib/dataStore/laborBudgets.js`) | `accounts.labor_ratio` | UPDATE + changelog |

### A.5 Backdate path (price + fee)

`[code-read src/lib/scBackdateReport.js:40-155, src/app/api/service-calendar/route.js:1660-1971]`

- `describeBackdateImpact({type, accountKey, effectiveDate, serviceId?, newPrice?})` reads `sc_daily_revenue` for the affected date range, joins the closed-period lock table (`sc_period_locks` per sc-25), and returns `{closedPeriods, affectedDayCount, revenueDeltaCents, deltaSource}`.
- `composeBackdateReason({closedPeriods, affectedDayCount, revenueDeltaCents, operatorReason})` prepends a prose prefix naming touched periods; the delta is only rendered for `type='price'` (fee explicitly does NOT get a numeric delta - `route.js:1936-1944` says "sc_daily_revenue does not include fee amounts, and a per-period fee-attribution figure is a proration + payment-cadence design question").
- Server ALWAYS composes; a client-authored prefix is stripped defense-in-depth.
- Owner ruling: preview failure falls back to `closedPeriods: []`, write proceeds. Preview is a decoration, not a gate.
- Price backdates require an explicit `creditDecision: "issue"|"none"` recorded in `sc_config_changelog.new_value` JSONB (K-7 AP notification is Track B - not wired; only the choice is recorded).

### A.6 `sc_config_changelog` current distribution `[ran]`

96 rows total across all entity_types + change_types:

```
fee|create: 5             (one per fee account, from the 2026-06-19 seed)
group|create: 1
price|update: 36
qbo_account_map|create: 2
qbo_account_map|update: 4
qbo_service_map|create: 22
qbo_service_map|update: 26
```

Every fee account has exactly 1 fee-entity-type changelog row (the seed). The CIN-OH + STL-MO CPI escalations landed as `changed_by='kf-fee-escalation-2026-07'` seed rows without a distinct escalation-changelog history separate from the create - i.e. the "supersede history" the prior audit named as not-measured is confirmed absent here.

### A.7 Coverage of the fee-list expected set `[ran]`

The `loadFeeSchedule` orchestrator (dataStore:3061-3145) walks `flat_fee` + `FEE_ELIGIBLE_PER_MEAL = ["CIN - AZ"]`. 6 accounts eligible; 5 have rows in `sc_fee_schedule`. CIN-AZ is eligible-but-empty (renders in the admin surface with `current: null, upcoming: null`). The 8-mem admin can Add-Fee on CIN-AZ via `sc-admin-fee-set`; nothing is written today.

---

## Part B - How service charges are represented

### B.1 Total service surface `[ran]`

Portfolio: 105 services across 11 accounts (CORP excluded). 24 groups. 165 total `sc_service_prices` rows; 100% `price_kind='projected'`; ZERO `price_kind='actual'` rows exist anywhere.

### B.2 Charge-shaped services (per account) `[ran]`

Charge-shaped defined as service names matching `/coffee|fountain|extra protein|extra mto|road (sandwiches|food)|labor fee|fun money|fun \$|snack|pantry|media|scout|catering|owners? week|fantasy/i`.

| Account | Charge-shaped services (name / group / flags) |
|---|---|
| CIN - AZ | "Pre-Game Snack" (Minor League) `-` · "Coffee Service" (Minor League) `flat_fee+tax_free` · "Fountain Bev" (Minor League) `flat_fee+tax_free` |
| CIN - KY | "Snack" (Louisville Bats) `-` |
| CIN - OH | (none) |
| STL - FL | "Snack" (MiLB) `-` · "Fun Money allocation" (Fun Money) `flat_fee+non_rev` |
| STL - MO | (none) |
| TBJ - FL | "Snack" (Major League - PDC) `-` · "Fun $$$$ Allocated" (Other) `flat_fee+non_rev` · "Media Meals" (Other) `-` · "MLB G&G - Pantry" (Other) `-` · "MLB - Catering" (Other) `-` · "Scout Meals" (Other) `-` · "MiLB G&G - Pantry" (Other) `-` |
| TBJ - NY | (none) |
| TBR - FL | "MLB - Extra MTO - Sm" (Major League) `flat_fee` · "MLB - Extra MTO - Med" (Major League) `flat_fee` · "MLB - Extra MTO - Lrg" (Major League) `flat_fee` · "Extra Protein - Beef/Seafood" (Minor League + Major League) `flat_fee` · "Extra Protein - Chicken/Pork" (Minor League + Major League) `flat_fee` · "Road Sandwiches - MiLB" (Minor League) `-` |
| TXR - AZ | "Regular Snack" (Minor League) `-` · "Pre-Game Hot Snack" (Minor League) `-` · "Extra Protein - Beef/Seafood" (Major League + Minor League) `flat_fee` · "Extra Protein - Chicken/Pork" (Major League + Minor League) `flat_fee` |
| TXR - TX - H | (none) |
| TXR - TX - V | (none) |

Total: 27 charge-shaped services on 6 of 11 accounts. **Note the shape of the finding: four of the five flat_fee accounts carry zero charge-shaped services.** The fifth (STL-FL) carries Fun Money (`non_rev=true`) and Snack ($0). The remaining charge-shaped surface lives on the per-meal + hybrid accounts.

### B.3 Every `sc_service_prices` row for charge-shaped services `[ran]`

54 total rows across the 27 services; 100% `price_kind='projected'`. Effective-dates: 2026-01-01 (seed) or 2026-06-16 / 2026-06-17 (Price Review v3 corrections). Concrete rows:

- **CIN - AZ**
  - "Pre-Game Snack": `projected 2026-01-01 $7.31456` · `projected 2026-06-16 $5.12019` (Price Review v3 correction)
  - "Coffee Service" flat_fee tax_free: `projected 2026-01-01 $511.05293` (per-week rate)
  - "Fountain Bev" flat_fee tax_free: `projected 2026-01-01 $283.91714` (per-week rate)
- **CIN - KY** "Snack": `projected 2026-01-01 $8.64448`
- **STL - FL**
  - "Snack": `projected 2026-01-01 $0.00000` · `projected 2026-06-16 $0.00000`
  - "Fun Money allocation" flat_fee non_rev: `projected 2026-01-01 $25000.00000` · `projected 2026-06-16 $0.00000`
- **TBJ - FL**
  - "Snack": `projected 2026-01-01 $1.70396`
  - "Fun $$$$ Allocated" flat_fee non_rev: `projected 2026-01-01 $28472.75600` · `projected 2026-06-17 $0.00000` (Joe review)
  - "Media Meals": `projected 2026-01-01 $16.00000` · `projected 2026-06-16 $16.00000`
  - "MLB G&G - Pantry": `projected 2026-01-01 $1.70396`
  - "MLB - Catering": `projected 2026-01-01 $38.00000`
  - "Scout Meals": `projected 2026-01-01 $11.55000`
  - "MiLB G&G - Pantry": `projected 2026-01-01 $1.70396`
- **TBR - FL** (all `flat_fee` per-unit add-ons on top of MLB per-meal)
  - MLB Extra MTO Sm/Med/Lrg: `$5.00 / $10.00 / $15.00`
  - Extra Protein Beef/Seafood (MLB + MiLB): `$162.16712`
  - Extra Protein Chicken/Pork (MLB + MiLB): `$111.83796`
  - Road Sandwiches - MiLB: `$15.00000`
- **TXR - AZ**
  - Regular Snack: `projected 2026-01-01 $7.35950` · `projected 2026-06-16 $5.88760`
  - Pre-Game Hot Snack: `projected 2026-01-01 $13.66325` · `projected 2026-06-16 $10.93060`
  - Extra Protein Beef/Seafood (MLB + MiLB): `$165.00`
  - Extra Protein Chicken/Pork (MLB + MiLB): `$115.00`

### B.4 Cross-reference to `SC_MONEY_MODEL.md` + `ACCOUNT_MODEL_MATRIX.md` `[code-read]`

**How SC-visible charge-shaped services map to P&L 2300 vs 2400.1 (per docs; NOT resolved by this pass):**

| Account | Service | Docs say P&L books it to |
|---|---|---|
| CIN - AZ | Coffee Service ($511/wk) | Contract §IV.B `[ACCOUNT_CIN-AZ.md:57]` bills flat weekly; not explicitly per-line mapped in the P&L. Almost certainly **2200 Catering** (weekly beverage service). Not verified. |
| CIN - AZ | Fountain Bev ($283.92/wk) | Same as Coffee - flat weekly beverage; likely **2200**. Not verified. |
| CIN - AZ | Pre-Game Snack ($5.12) | Per-meal-like billing but not itemized in the P&L 2300/2400.1 split; likely rolls into **2400.1** with the per-meal invoice line. |
| CIN - AZ | Service Fee $445,716/yr (NOT a service row - `sc_fee_schedule` is empty for CIN-AZ; SF is out-of-band per D19) | **2300 Service Charges** per `ACCOUNT_CIN-AZ.md:38` note ("$445,716 coincides exactly with the P&L 2300 line") - **but the SF is out-of-band by design; there is no PG lane for it.** |
| CIN - KY | Snack ($8.64) | Rolls with per-meal into **2400.1**. |
| STL - FL | Fun Money allocation | `is_non_revenue=true` today; if converted it books to a NON-revenue line (planning-only). |
| STL - FL | Snack ($0) | Non-revenue-by-price today. |
| TBJ - FL | Fun $$$$ Allocated ($28,472.76 or $0 post 6/17) | `is_non_revenue=true` today; excluded from `sc_month_summary` totals via FILTER. |
| TBJ - FL | Media Meals / MLB Catering / Scout Meals / Pantry lines | Per-meal-like or per-unit; the per-meal ones roll into **2400.1** with the per-meal invoice; Catering ($38) and Pantry lines are likely **2200 Catering Revenue** but not verified. |
| TBR - FL | Extra Protein (all 4 lines), Extra MTO (all 3 lines), Road Sandwiches, Labor Fee $280 | Per-unit add-ons that appear on the same per-meal invoice; the doc `ACCOUNT_TBR-FL.md:81` shows them summed with per-meal lines on a real MiLB invoice K300168871. Likely **2400.1** with the meal service line; possibly **2200** for Road Sandwiches. Not verified. |
| TXR - AZ | Extra Protein (all 4 lines) | Same as TBR-FL - per-unit add-ons on the per-meal invoice. Likely **2400.1**. |

**Where 2300 lives when the SC does not carry it:**
- **CIN-AZ / TXR-AZ / TBR-FL MiLB SF%:** the SF% buydown is the 2300 quantity per `SC_MONEY_MODEL.md:169-176`. Computed from `sticker × count × SF%` (or `(sticker - post_SF) × count`), not stored anywhere in PG. SC prices carry only the post-SF invoice rate.
- **TBJ-FL flat SF ($452,812/yr or $515,712 post-negotiation):** billed on its own schedule, `billing_model=actuals_drive_invoice` so it is out-of-band from `sc_fee_schedule`. NO PG lane.
- **STL-MO Road Catering ($50,000/yr):** the $50K management fee books to P&L 2300 per `ACCOUNT_STL-MO.md:79` (spread P3-P9 at $7,143/period). NO PG lane; not in `sc_fee_schedule` (STL-MO's row is the $489,497 escalated main fee).
- **Flat-fee accounts CIN-OH / STL-MO / STL-FL / TXR-TX-H:** D1 says the SF portion books to 2400.1 uniformly on the P&L. The 2300 line on the P&L for these accounts is either $0 or an add-on (e.g. STL-MO road catering).

### B.5 View mechanics for charge-shaped services `[code-read]`

`sc_daily_revenue` (`sc-8b-actual-prices-and-view.sql:241-313`) does NOT filter on `is_flat_fee` or `is_non_revenue`. It EXPOSES those flags. `sc_month_summary` (`sc-8b:279-283`) DOES filter revenue totals with `FILTER (WHERE NOT is_non_revenue)`. So:

- A per-unit `flat_fee` service (Extra Protein, Extra MTO, Coffee Service) contributes `actual_count × price` to `actual_revenue`. It is NOT a per-meal count; it is a per-unit count (case, week, etc.), so the count schema is what the operator entered.
- An `is_non_revenue` service (Fun Money) contributes to `sc_daily_revenue.actual_revenue` in the raw view but is EXCLUDED from `sc_month_summary` totals. Any Overview reader that reads `sc_daily_revenue.actual_revenue` directly without a `NOT is_non_revenue` filter WILL include Fun Money.

---

## Part C - Can the SC produce per-period 2300 actuals today?

### C.1 FYTD summary for charge-shaped services `[ran]`

Range: 2025-12-29 through 2026-08-28. sc_daily_revenue total rows FYTD: 18,487; charge-shaped rows: 3,986.

| Account | Rows | Services | rows_proj>0 | rows_act>0 | SUM projected_revenue | SUM actual_revenue | Periods covered |
|---|---|---|---|---|---|---|---|
| CIN - AZ | 729 | 3 | 110 | 114 | $39,802.52 | $44,072.18 | 1-9 |
| CIN - KY | 159 | 1 | 44 | 28 | $17,116.07 | $7,780.03 | 4-9 |
| STL - FL | 244 | 2 | 0 | 1 | $0.00 | $25,000.00 | 1-9 |
| TBJ - FL | 589 | 7 | 0 | 67 | $0.00 | **$318,996,483.92** | 1-9 |
| TBR - FL | 1,109 | 8 | 0 | 50 | $0.00 | $17,644.41 | 1,2,4-9 |
| TXR - AZ | 1,156 | 6 | 165 | 147 | $129,214.94 | $141,637.25 | 1-9 |

**The $318,996,483.92 line is the finding.** TBJ-FL "Fun $$$$ Allocated" (`is_non_revenue=true`) has three rows with `actual_count` of 3,090 / 1,468 / 6,645 (all `import-script`, dated 2026-03-03 / 2026-03-10 / 2026-05-06) × the $28,472.756 seed price = the $318M. `sc_month_summary` filters this out; a naive `sc_daily_revenue` reader does not. Six additional `k.fietek@kitchfix.com` rows exist with `actual_count=0`.

STL-FL "Fun Money allocation" contributes $25,000 (1 row with `actual_count=1` × the pre-6/16 $25,000 seed price). Same mechanism; smaller number. Also `is_non_revenue`.

### C.2 Per-service breakdown for the meaningful (non-Fun-Money) rows `[ran]`

- **CIN - AZ**: Coffee Service $17,886.85 act (33 rows), Fountain Bev $9,085.35 act (32), Pre-Game Snack $17,099.98 act (49). All three services actively logging actuals through August.
- **CIN - KY**: Snack $7,780.03 act (28 rows across P4-P9).
- **STL - FL**: Snack $0 act (0 rows>0), Fun Money $25,000 (see above).
- **TBJ - FL** (excluding Fun $$$$ Allocated $318M): Media Meals $800 (1 row), MiLB G&G - Pantry $6,134.26 (21), MLB G&G - Pantry $2,796.20 (34), Scout Meals $6,468 (8), Snack $0, MLB - Catering $0.
- **TBR - FL**: Extra Protein Chicken/Pork MiLB $1,789.41 (16), Road Sandwiches - MiLB $15,855 (34). Every MLB add-on (Extra Protein × 2, Extra MTO × 3) has zero actuals FYTD.
- **TXR - AZ**: Extra Protein Beef/Seafood MLB $3,300 (3), Extra Protein Beef/Seafood MiLB $18,975 (3), Pre-Game Hot Snack $64,766.54 (48), Regular Snack $54,595.71 (93). Extra Protein Chicken/Pork (both groups) at $0.

### C.3 Structure to produce per-period 2300 - feasibility per account

**None of these are 2300-mappable straight from `sc_daily_revenue` today, for four different reasons:**

1. **CIN-AZ / TXR-AZ / TBR-FL MiLB SF% buydown = the 2300 quantity.** Formula: `sticker_price × actual_count × SF%`. The SC does not carry `sticker` (only post-SF `projected`). The buydown cannot be re-derived from `sc_service_prices` alone; it needs either (a) a `sticker` price row (`price_kind='sticker'` - does not exist), or (b) a hardcoded SF% per account plugged into the reader. Neither exists.

2. **TBJ-FL flat SF ($515,712 negotiated / $452,812 base).** The SF is billed on its own schedule (3x monthly Jan/Feb/Mar per ABR OneSheeter, per `SC_CONTRACT_BILLING_SUMMARY.md`). NO PG table. `billing_model=actuals_drive_invoice` explicitly excludes it from `sc_fee_schedule`.

3. **STL-MO Road Catering $50K/yr.** Books to 2300 per `ACCOUNT_STL-MO.md`. NO PG table. Not a service (no `sc_services` row for it). Not in `sc_fee_schedule` (that row is the $489,497 main fee).

4. **Charge-shaped services that ARE in the SC.** Media Meals, Scout Meals, MLB Catering, Pantry lines, Coffee Service, Fountain Bev, Extra Protein/MTO, Road Sandwiches. These roll into the per-meal invoice on the invoice PDF (per doc references). Whether they book to 2400.1 (per-meal invoice component), 2200 (catering revenue), or 2300 (service charges) is a per-account chart-of-accounts question NOT captured in the SC. The dataStore has no `line_code` on `sc_services` or `sc_service_prices`.

### C.4 Section 5.7 contamination extension `[ran]`

**Does the §5.7 mechanism (`COALESCE(pr_act.price, pr_proj.price)` fires the projected price when no `actual` row exists) touch service-charge services on the fee accounts?**

Answer: **No, because four of five fee accounts carry ZERO charge-shaped services, and the fifth (STL-FL) has only Fun Money (`non_rev=true`, $25,000 hit already visible above) and Snack ($0).**

Fee-account charge-shaped rows FYTD:
- CIN - OH: 0 charge-shaped rows
- STL - MO: 0 charge-shaped rows
- TXR - TX - H: 0 charge-shaped rows
- TXR - TX - V: 0 charge-shaped rows
- STL - FL: 244 charge-shaped rows (Fun Money allocation + Snack), $25,000 actual_revenue (all Fun Money; already `non_rev`)

**So the fee-account bleed measured in the prior audit (CIN-OH $4,671.76 + STL-FL $466,216.00) stays in the per-meal (non-charge-shaped) services and does not compound through the charge-shaped surface.** The Fun-Money $25,000 on STL-FL is a different mechanism (Fun Money has `is_non_revenue=true`, so filtered by `sc_month_summary`; the prior audit's numbers came from raw `sc_daily_revenue`).

**Separately: the $318M Fun $$$$ Allocated hit on TBJ-FL is a per-meal-account contamination of the same "view is right, input is wrong" class as §5.7 - a stale seed price on a service whose flag was later flipped to non-revenue, but the price row was not re-zeroed until 2026-06-17. Any Overview reader that touches `sc_daily_revenue.actual_revenue` and does not apply `WHERE NOT is_non_revenue` will report $318M of phantom TBJ-FL revenue.**

### C.5 Named blockers for per-period 2300 actuals

- **B-C1: No SF% component derivable from SC.** CIN-AZ / TXR-AZ / TBR-FL MiLB need a `sticker` price alongside the `post-SF` price, or an account-scoped `sf_percent` field. Neither exists.
- **B-C2: No TBJ-FL flat SF in PG.** `billing_model=actuals_drive_invoice` is the correct classification for per-meal but hides the flat SF entirely.
- **B-C3: No STL-MO Road Catering line.** Neither a `sc_services` row nor a `sc_fee_schedule` row exists for the $50K/yr management fee.
- **B-C4: No `line_code` on SC services.** `sc_services` and `sc_service_prices` do not carry the P&L account code they roll to. Determining which charge-shaped service = 2300 vs 2400.1 vs 2200 is a docs-only question today.
- **B-C5: No installment / recognition table (see Part D).** Even if the SF quantities were computable, the per-period distribution (D-J-F frontloading, quarterly, monthly-6, etc.) has no compute lane.
- **B-C6: Non-revenue filter discipline is manual.** Any reader that queries `sc_daily_revenue.actual_revenue` inherits the $318M Fun-Money hit unless it applies `WHERE NOT is_non_revenue`. `sc_month_summary` is the only view that does so today.

---

## Part D - Fee-schedule admin state

### D.1 `sc_fee_schedule` current rows `[ran]`

5 rows total. Every row created 2026-06-19T15:53:30-31Z:

| account_key | amount | eff_date | period_type | payment_cadence | covered_by | changed_by |
|---|---|---|---|---|---|---|
| CIN - OH | $376,686.00 | 2026-01-01 | annual | monthly-6 | - | kf-fee-escalation-2026-07 |
| STL - FL | $1,400,000.00 | 2026-01-01 | annual | quarterly | - | seed-script |
| STL - MO | $489,497.00 | 2026-01-01 | annual | monthly-6 | - | kf-fee-escalation-2026-07 |
| TXR - TX - H | $604,032.00 | 2026-01-01 | annual | monthly-6 | - | seed-script |
| TXR - TX - V | $0.00 | 2026-01-01 | annual | (null) | TXR - TX - H | seed-script |

**No other accounts have rows** (CIN-AZ is fee-eligible per `FEE_ELIGIBLE_PER_MEAL` but no fee has been seeded; the admin can add one via `sc-admin-fee-set`).

### D.2 What Kevin can edit via the SC admin UI today `[code-read]`

`[route.js:1851-1971 + dataStore:3194-3288]`

Editable through `sc-admin-fee-set`:
- `amount` (NUMERIC, >= 0)
- `effectiveDate` (Today / Future / Backdate mode - allowBackdate=true opts out of the today-or-future floor)
- `reason` (required, <= 280 chars; server prepends closed-period prefix on backdates)
- `requestedBy` (optional)
- `paymentCadence` (`monthly-6` / `monthly-7` / `quarterly` / `annual`; nullable)

NOT editable through the admin UI today:
- `period_type` (schema CHECK `('annual')` only; the enum has no other value - `sc-5:69-71`)
- `covered_by_account_key` (write path DOES pass it through if the caller supplies it (`dataStore:3225-3227`), but the UI has no field for it; the TXR-TX-V bundled marker was written by seed-script)
- Same-day corrections: the schema allows them (no UNIQUE on `(account_key, effective_date)`; corrections are new rows with same eff_date + later created_at). The UI does not appear to have a distinct "correction" mode; a same-date write just becomes a new supersede row.

Studio-only or absent entirely:
- **Installments / recognition / per-period allocation**: 9 candidate tables probed, ALL ABSENT (`sc_fee_installments`, `sc_fee_recognition`, `sc_fee_allocation`, `sc_fee_periods`, `sc_installment_schedule`, `sc_revenue_recognition`, `kpi_service_charge_allocation`, `pnl_service_charges`, `sc_service_charge_actuals`). There is no installment ledger anywhere in the schema.
- **Escalation supersede history separate from the seed**: the CIN-OH + STL-MO CPI-escalated seeds landed as CREATE rows, not UPDATE-on-top-of-base rows. `sc_fee_schedule` for these accounts holds only one row each. Prior base $362,500 (CIN-OH) / $473,000 (STL-MO) exists only in the docs (`SC_MONEY_MODEL.md:325-327`) and (assumed) `sc_config_changelog` old_value JSONB - **not verified this pass**.

### D.3 The cadence question (echoed from PR #888 with additional evidence) `[code-read]` `[ran]`

**Still: cannot produce a per-period P1-P13 fee figure from `sc_fee_schedule` alone.**

- `payment_cadence` is declared informational-only in the migration comment (`sc-5-fee-schedule.sql:72-75`): "Schema does not drive any compute from this field."
- No start-month column. `monthly-6` for CIN-OH means Mar-Aug per contract but nothing in PG records that.
- No installment table. No per-period mapping.
- STL-FL's phase-aware allocation ($45k / $171k / $407k peak / etc. per `SC_MONEY_MODEL.md:233-235`) lives in `PFS Service Fees 2026.xlsx` (finance-owned) and `PL_2026_APPENDIX.md`, not in Postgres.

### D.4 Report surface as-is (no proposal)

The admin surface today lets Kevin edit the annual amount and cadence label with full audit. It does NOT let him or the KPI dashboard reader produce per-period 2300 or 2400.1 actuals from those inputs.

---

## Part E - Coverage map

**Presence-only per account (no budget dollar values); "SC holds" = a `sc_services` row / `sc_service_prices` row / `sc_fee_schedule` row exists; "budget expects" = FY2026 `kpi_budgets` row present.**

| Account | 2300 budget row? | SC service-charge services (count) | SC service-charge actuals FYTD (rows with act>0) | SF/2300-mappable SC surface? | 2400.1 budget row? | SC per-meal / fee surface for 2400.1? |
|---|---|---|---|---|---|---|
| CIN - AZ | YES (13 periods) | 3 (Coffee, Fountain, Pre-Game Snack) | 114 | Partial - $445,716/yr SF is out-of-band; per-unit charge services are in SC but line-code binding is doc-only | YES | `sc_daily_revenue.actual_revenue` (per-meal) - PARTIAL |
| CIN - KY | YES (13 periods) | 1 (Snack) | 28 | No | YES | `sc_daily_revenue` per-meal - PARTIAL |
| CIN - OH | YES (13 periods) | 0 | 0 | No | YES | `sc_fee_schedule` (annual, per-period BLOCKED per Part D) |
| STL - FL | YES (13 periods) | 2 (Fun Money non_rev + Snack $0) | 1 (Fun Money $25k, `non_rev` - excluded from month_summary) | No | YES | `sc_fee_schedule` (annual $1.4M, per-period BLOCKED) |
| STL - MO | YES (13 periods) | 0 | 0 | No - Road Catering $50k/yr not in PG anywhere | YES | `sc_fee_schedule` (annual, per-period BLOCKED) |
| TBJ - FL | YES (13 periods) | 7 (Snack, Fun $$$$ non_rev, Media Meals, Pantry x2, Catering, Scout) | 67 (incl. $318M Fun $$$$ non_rev bleed - filter needed) | No - $515,712/yr SF is out-of-band (billing_model=actuals_drive_invoice) | YES | `sc_daily_revenue` per-meal - PARTIAL |
| TBJ - NY | YES (13 periods) | 0 | 0 | No (no SF) | YES | `sc_daily_revenue` per-meal - READY |
| TBR - FL | YES (13 periods) | 8 (Extra Protein x4, Extra MTO x3, Road Sandwiches; BGC lives in group "Boys & Girls Club") | 50 | Partial - MiLB 25% SF is out-of-band; per-unit add-ons in SC but line-code binding doc-only | YES | `sc_daily_revenue` per-meal - PARTIAL |
| TXR - AZ | YES (13 periods) | 6 (Regular Snack, Pre-Game Hot Snack, Extra Protein x4) | 147 | Partial - 20% SF is out-of-band; per-unit add-ons in SC | YES | `sc_daily_revenue` per-meal - PARTIAL |
| TXR - TX - H | YES (13 periods) | 0 | 0 | No | YES | `sc_fee_schedule` (annual, per-period BLOCKED) |
| TXR - TX - V | YES (13 periods) | 0 | 0 | No | YES | `sc_fee_schedule` bundled $0 + Sheets `labor_sold_revenue` (per §4.6 direct sales, still Sheets) |

**Summary counts:**
- Accounts with a SC service-charge surface at all: 6 of 11.
- Accounts where the SC can plausibly produce a 2300-mappable per-period actual today: 0 of 11.
- Accounts where the SC service-charge surface risks contaminating a 2300 or 2400.1 rollup if read raw: 2 of 11 (TBJ-FL Fun $$$$ $318M, STL-FL Fun Money $25K - both `is_non_revenue=true`, both filtered by `sc_month_summary` but NOT by `sc_daily_revenue`).

---

## Completeness map (C2)

| Part | Status | Reason |
|---|---|---|
| A - SC admin surface inventory | **DONE** | Routes, gating, 18 GET/POST actions with line-cites, each write path's backing table + changelog binding, backdate mechanics, changelog current distribution. |
| B - service-charge representation | **DONE** | 27 charge-shaped services enumerated per account with flag mix; 54 price rows dumped verbatim; portfolio-wide price_kind distribution counted; cross-reference to SC_MONEY_MODEL for how each account's SF/2300 lives outside PG. |
| C - can SC produce per-period 2300 today | **DONE** | FYTD sc_daily_revenue measured per account for charge-shaped services; per-service breakdown; $318M Fun-Money bleed named; §5.7 contamination extension checked (fee accounts carry no charge-shaped services); 6 blockers named for 2300-mappable rollups. |
| D - fee-schedule admin state | **DONE** | 5 rows dumped; editable-vs-Studio-only vs absent lane enumerated; installment/recognition/allocation lane confirmed absent via 9 candidate probes; cadence question re-answered with new schema-comment evidence. |
| E - coverage map | **DONE** | 11-row per-account table with 6 presence columns (2300 budget, SC service-charge count, SC actuals rows, SF-mapping status, 2400.1 budget, SC per-meal/fee surface). Summary counts included. |

---

## Acceptance echo (C4)

- **Part A** "Map every admin-side SC surface with file:line for each finding" - `[code-read]` - 18 actions enumerated with route.js line numbers; 10 dataStore exports with line numbers; gating in `src/lib/admin.js:60-78`; backdate helper cited at `src/lib/scBackdateReport.js` and integration at `route.js:1660-1971`.
- **Part B** "Search sc_service_groups / sc_services / sc_service_prices for service-charge-shaped entries on every account. Cross-reference ACCOUNT_SERVICES_BRIEF and SC_CONTRACT_BILLING_SUMMARY. State (do NOT resolve) how each would map to P&L 2300 vs 2400.1." - `[ran]` `[code-read]` - 27 charge-shaped services per account with flag+group+prices dumped; canonical 2300/2400.1 mapping stated per docs (SC_MONEY_MODEL.md §e); four different lanes for where 2300 lives (SF% buydown, flat SF, road catering, flat-fee) enumerated with "which account, why not in PG".
- **Part C** "Walk the STRUCTURE that would produce per-period P1-P8 service-charge actuals. Name every gap. Note whether §5.7 contamination touches service-charge revenue too." - `[ran]` - 6 blockers named (B-C1..B-C6); §5.7 extension checked = 4 of 5 fee accounts carry ZERO charge-shaped services so no compounding; STL-FL's charge surface is Fun Money + Snack, non-contaminating today. Additional finding: TBJ-FL Fun $$$$ Allocated $318M raw `sc_daily_revenue` hit is a distinct "view right, input wrong" case gated by is_non_revenue but exposed on raw view reads.
- **Part D** "What can Kevin edit on sc_fee_schedule through the UI today vs Studio-only? What exists admin-side for installments/recognition?" - `[code-read]` `[ran]` - Editable fields listed with validation rules; period_type CHECK-locked to annual; covered_by_account_key write-path-present but UI-absent; installment/recognition/allocation lane probed 9 candidates, ALL ABSENT; escalation supersede history for CIN-OH/STL-MO not verified this pass (named).
- **Part E** "Per account, what SC holds for service charges and fees vs what a 2300 / 2400.1 budget row expects an actual for. Presence-level only, no budget dollars." - `[ran]` - 11-row table with 6 presence columns + 3 summary counts. Zero accounts can produce 2300 actuals from the SC alone today.

---

## Unmeasurable as written + blocked items (named, not worked around)

1. **Per-account SF% component quantity for CIN-AZ / TXR-AZ / TBR-FL MiLB** - unmeasurable from PG today. Requires either a `sticker` price row (`price_kind='sticker'` does not exist) or an account-scoped `sf_percent` field (does not exist). The doc-truth SF% values (30% / 20% / 25%) live in `SC_MONEY_MODEL.md` + per-account pricing-summit files. Blocker B-C1.
2. **TBJ-FL flat SF ($515,712 negotiated / $452,812 base) per-period actuals** - unmeasurable. `billing_model=actuals_drive_invoice` deliberately excludes the SF from `sc_fee_schedule`. No PG lane. Blocker B-C2.
3. **STL-MO Road Catering $50K/yr per-period actuals** - unmeasurable. Neither a `sc_services` row nor a `sc_fee_schedule` row. Docs-only line item. Blocker B-C3.
4. **P&L line_code binding for charge-shaped services** - `sc_services` and `sc_service_prices` carry no P&L account code. Whether TBR-FL's Extra Protein rolls to 2400.1 or 2200, whether TBJ-FL's Scout Meals rolls to 2400.1 or 2300, cannot be answered from PG. Blocker B-C4.
5. **Per-period allocation table for `sc_fee_schedule`** - the whole installment / recognition / allocation lane is ABSENT (9 candidate tables probed). Every fee account is blocked on per-period 2400.1 (or 2300 for accounts where the fee books to 2300) rendering. Blocker B-C5.
6. **`is_non_revenue` filter discipline** - `sc_daily_revenue.actual_revenue` returns Fun Money for TBJ-FL ($318M) and STL-FL ($25K). Any consumer reading the raw view without applying `WHERE NOT is_non_revenue` will report these as revenue. Blocker B-C6.
7. **`sc_fee_schedule` escalation supersede history for CIN-OH + STL-MO** - not measured this pass. The CPI-escalated seed rows overwrote the base rate rather than laying on top of it; the base $362,500 (CIN-OH) / $473,000 (STL-MO) values exist only in docs and (assumed) `sc_config_changelog.old_value` JSONB. Would need to query `sc_config_changelog` where `entity_type='fee'` AND `account_key IN (...)`, which returned 1 create row per account and no update rows in the count probe.
8. **CIN-AZ fee-list eligibility but empty schedule** - `FEE_ELIGIBLE_PER_MEAL=["CIN - AZ"]` classifies CIN-AZ as fee-managed for the admin surface, but `sc_fee_schedule` has no CIN-AZ row. The $445,716/yr Service Fee that `ACCOUNT_CIN-AZ.md:38` describes as coinciding with the P&L 2300 line has no PG representation whatsoever. This is by design (D19: "CIN-AZ's $445,716 Service Fee stays out of Postgres") but the admin surface being ready + the fee being absent is a discoverable-blank-slate the site owner should be aware of.
9. **Charge-shaped surface presence gap for CIN-OH, CIN-KY (partial), STL-MO, TBJ-NY, TXR-TX-H, TXR-TX-V** - 5 accounts have zero charge-shaped services, and CIN-KY has only "Snack". If any of these accounts' P&Ls book to 2300 (e.g. STL-MO Road Catering), the SC admin has no path to represent it today. Blocker B-C3 covers STL-MO; the others are not doc-cited as 2300 producers.
10. **Prior audit "STL-FL Fun Money `is_non_revenue=true` planned" finding is stale** - the current probe shows `is_non_revenue=true` IS applied to both STL-FL "Fun Money allocation" and TBJ-FL "Fun $$$$ Allocated". The flag conversion has landed. What has NOT landed is a zeroing of the stale seed prices ($25K seed on STL-FL until 2026-06-16; $28,472.756 on TBJ-FL until 2026-06-17) plus retro-zeroing on the pre-cutover `sc_daily_actuals` rows that still hold the pre-flag `actual_count` values (3090/1468/6645 on TBJ-FL). The view's flag filter (in `sc_month_summary` only, not `sc_daily_revenue`) is the operative guard today.

---

*END - written by the Master KPI CC seat, 2026-08-28. Follow-up to PR #888.*

# SC billing recon R1 - CC read-only audit

**Date:** 2026-08-06
**Branch:** `docs/sc-billing-recon-r1`
**Scope:** Read-only recon of the SC side of the SC -> QuickBooks billing pipeline. Answers C-1 through C-12 per the ruling.
**Fences honored:** SELECT only. No schema changes, no migrations, no code edits, no external API calls. Every claim labeled `[ran]` (query + result pasted) or `[code-read]` (`file:line`).

## Completeness map

| Item | Status | Where |
|---|---|---|
| C-1  CIN - OH fee integrity | DONE | [C-1](#c-1-cin---oh-fee-integrity) |
| C-2  Period lock mechanics | DONE | [C-2](#c-2-period-lock-mechanics) |
| C-3  Week identity | DONE | [C-3](#c-3-week-identity) |
| C-4  Backdate record shape | DONE | [C-4](#c-4-backdate-record-shape-post-620) |
| C-5  Admin gate membership | DONE | [C-5](#c-5-admin-gate-membership) |
| C-6  Operator export data path | DONE | [C-6](#c-6-operator-export-data-path) |
| C-7  #615 placeholder | DONE | [C-7](#c-7-615-placeholder) |
| C-8  By-service-week detectability | DONE | [C-8](#c-8-by-service-week-detectability) |
| C-9  SC-side mapping raw material | DONE | [C-9](#c-9-sc-side-mapping-raw-material) |
| C-10 TXR - AZ price truth spot-check | DONE | [C-10](#c-10-txr---az-price-truth-spot-check) |
| C-11 Feasibility proof - real invoice reconcile | DONE | [C-11](#c-11-the-feasibility-proof---reconcile-a-real-invoice) |
| C-12 Risk sweep | DONE | [C-12](#c-12-risk-sweep) |

---

## C-1 CIN - OH fee integrity

**Verdict: DRIFT WITH DOCUMENTED REASON (in the row itself) + CHANGELOG GAP (finding).**

The current live fee is **$376,686** on effective 2026-01-01, one row in `sc_fee_schedule`. The reason field explains the divergence from the $362,500 bible: **2026 CPI escalation per contract §2.a**. Finance-confirmed via PFS Service Fees 2026.

BUT: **`sc_config_changelog` has only ONE row for this fee** (the initial seed at $362,500). The CPI escalation to $376,686 was applied by a script named `kf-fee-escalation-2026-07` and left no matching changelog entry.

**Row in `sc_fee_schedule` (1 row total for CIN - OH):** [ran]
```sql
SELECT * FROM sc_fee_schedule WHERE account_key='CIN - OH';
```
```json
{
  "id": "5f4cd389-72db-41f0-9f9b-f2f02319a45c",
  "account_key": "CIN - OH",
  "amount": 376686,
  "effective_date": "2026-01-01",
  "period_type": "annual",
  "payment_cadence": "monthly-6",
  "covered_by_account_key": null,
  "reason": "CPI escalation per contract §2.a: base $362,500 → $376,686 (2026 CPI-U Food Away from Home, Aug 2024→Aug 2025). Finance-confirmed (PFS Service Fees 2026). LEDGER §W.",
  "requested_by": null,
  "changed_by": "kf-fee-escalation-2026-07",
  "created_at": "2026-06-19T15:53:30.536428+00:00"
}
```

**`sc_config_changelog` fee rows for CIN - OH (1 row total):** [ran]
```sql
SELECT * FROM sc_config_changelog WHERE account_key='CIN - OH' AND entity_type='fee';
```
```json
{
  "id": "aec651c5-81ab-462b-bf60-d2dfb041e1c5",
  "account_key": "CIN - OH",
  "entity_type": "fee",
  "entity_id": null,
  "entity_label": "CIN - OH",
  "change_type": "create",
  "old_value": null,
  "new_value": { "amount": 362500, "periodType": "annual", "paymentCadence": "monthly-6", "coveredByAccountKey": null },
  "effective_date": "2026-01-01",
  "reason": "Seed: locked 2026 contract-year annual fee from SC_CONTRACT_BILLING_SUMMARY.md (Bundle 1 Stage 2).",
  "requested_by": null,
  "changed_by": "seed-script",
  "changed_at": "2026-06-19T15:53:30.63417+00:00"
}
```

**One-line verdict:** *legitimate contractual CPI update, but the escalation script bypassed the changelog write*. The billing arc must not assume `sc_config_changelog` is complete for fee history. `sc_fee_schedule.created_at` matches the seed changelog second-for-second (`2026-06-19T15:53:30`), suggesting the escalation script **UPDATEd the existing row in place** (amount + reason + changed_by), rather than inserting a new effective-date-keyed row.

**Billing-arc consequence:** if the invoice-builder ever needs to prove "the CPI escalation was applied on date X by actor Y," it has to read `sc_fee_schedule.changed_by` + `.reason`, not the changelog. Flag, do not fix.

---

## C-2 Period lock mechanics

**All [code-read].**

**The migration** ([`docs/migrations/sc-25-period-lock.sql:1-401`](../migrations/sc-25-period-lock.sql)) adds four schema objects:

1. `sc_daily_actuals_history.change_type TEXT NOT NULL DEFAULT 'update'` with CHECK `('update', 'delete')` (`sc-25:152-167`)
2. `sc_daily_actuals` BEFORE DELETE trigger + `sc_daily_actuals_delete_audit()` function (`sc-25:209-231`)
3. `sc_is_period_closed(account_key TEXT, period TEXT) RETURNS BOOLEAN` (`sc-25:286-308`)
4. `sc_is_day_locked(account_key TEXT, service_date DATE) RETURNS BOOLEAN` (`sc-25:335-357`)

**The exact input that decides "locked"** (v1, the "swap point"): `sc_is_period_closed` reads `MAX(service_date) FROM sc_day_metadata WHERE account_key=$1 AND period=$2`; returns TRUE when `(max_date + 3 grace_days) < CURRENT_DATE`. Unknown period returns TRUE (fail-safe). (`sc-25:286-308`)

`sc_is_day_locked` resolves the day's period from `sc_day_metadata`; unknown day returns TRUE; otherwise delegates. (`sc-25:335-357`)

**The application-layer helper** ([`src/lib/scPeriodLock.js:35-87`](../../src/lib/scPeriodLock.js)):
```js
export async function assertDaysUnlockedForWrite(accountKey, dates, email) {
  ...
  if (isScAdmin(email)) return null;   // SLT bypass
  const results = await Promise.all(
    uniqueDates.map((d) => supa.rpc("sc_is_day_locked", { p_account_key: accountKey, p_service_date: d }))
  );
  ...
  return { code: "PERIOD_LOCKED", lockedDates, message };
}
```
- SLT bypass = `isScAdmin(email)` short-circuit BEFORE the RPC ([`scPeriodLock.js:42`](../../src/lib/scPeriodLock.js)).
- Refusal shape: `{ code: "PERIOD_LOCKED", lockedDates, message }`, machine-readable code + array.

**Every write-path caller of `assertDaysUnlockedForWrite`** (grep of `src/`):
| File:line | Action | Protected |
|---|---|---|
| `src/app/api/service-calendar/route.js:902` | `sc-submit-day` (single-day save) | YES |
| `src/app/api/service-calendar/route.js:1052` | `sc-reset-day` (delete actuals) | YES |
| `src/app/api/service-calendar/route.js:1095` | `sc-bulk-submit` (bulk save) | YES |
| `src/app/api/service-calendar/route.js:1984` | `sc-submit-closeout` (MLB homestand) | YES |

**Write paths that DO NOT enforce** (explicit list per the migration's own comment `sc-25:73-84` + verified by grep):

1. **`sc-add-note`** - `src/app/api/service-calendar/route.js`. Notes stay open on a locked period per owner ruling (`sc-25:26-27`).
2. **`sc-config-update`** (price edits) - `src/app/api/service-calendar/route.js:1246-1408`. Backdated price changes to closed periods **allowed, warned, recorded** (Admin PR 1, 2026-08-04). See C-4.
3. **`sc-admin-fee-set`** (fee edits) - `src/app/api/service-calendar/route.js:1416-...`. Same shape as price.

**Override mechanism:** application-side. `isScAdmin(email)` in `assertDaysUnlockedForWrite:42` short-circuits before the RPC. See C-5 for the source of the allowlist.

**The swap point** (`sc-25:236-266`): when AP starts pulling periods, replace `sc_is_period_closed`'s body to consult a `sc_period_locks` table. Zero caller changes required. The 3-day grace constant disappears in v2 (the pull IS the confirmation).

---

## C-3 Week identity

**Verdict: no Mon-Sun week column in the base tables; a per-period-relative `week_label` exists on `sc_daily_revenue` (the view). The Mon-Sun invoicing week must be DERIVED from `service_date`.**

**`sc_day_metadata` columns** [ran]:
```
account_key, created_at, created_by, event_label, game_time, game_type,
id, notes, period, service_date, updated_at, updated_by, week_label
```
Yes, `week_label` exists on `sc_day_metadata` too - but see the boundary-reset finding below.

**Does `sc_day_metadata.period` ever hold decimals (1.1, 1.2 from the spreadsheet)?** [ran]
```sql
SELECT account_key, period FROM sc_day_metadata WHERE period LIKE '%.%' LIMIT 20;
-- 0 rows.
```
**Decimal sub-week periods DID NOT survive import.** Distinct `period` values (from a 200-row sample): `1, 2, 3, 4, 5, 6, 7, 8`. Bare integer strings only.

**`week_label` on `sc_daily_revenue`** [ran]: populated with values like `"Week 1"`, `"Week 2"`, `"Week 3"`, `"Week 4"`.

**Boundary trace (TXR - AZ, 2026-07-01 -> 2026-08-15):** [ran]
```
2026-07-01 -> "Week 3"
2026-07-06 -> "Week 4"     (Mon)
2026-07-13 -> "Week 1"     (Mon, period boundary - Week resets)
2026-07-20 -> "Week 2"     (Mon)
2026-07-27 -> "Week 3"     (Mon)
2026-08-03 -> "Week 4"     (Mon)
2026-08-10 -> "Week 1"     (Mon, period boundary - Week resets)
```

**`week_label` resets to `"Week 1"` at every period boundary.** It is a within-period week counter, not a straight ISO week or a Mon-Sun invoicing key. Boundaries land on Mondays but the label recycles.

**Verdict:** the Mon-Sun invoicing week must be derived from `service_date` (e.g., `date_trunc('week', service_date)` in PG or client-side `service_date -> Monday`). `week_label` is useful for within-period display but not sufficient as the sole invoicing key when a week crosses a period boundary. No new schema needed.

---

## C-4 Backdate record shape (post-#620)

**Verdict: PARTIAL. Structured columns capture (account, service, old/new price, effective_date, actor). Affected-span + dollar-delta land inside the `reason` TEXT prefix - parseable but not structured.**

**Where a price backdate lands** [code-read]:
- `sc_service_prices` (upsert, key `(service_id, effective_date, price_kind)`) - `src/lib/dataStore/serviceCalendar.js:2518-2528`
- `sc_config_changelog` row - `src/lib/dataStore/serviceCalendar.js:2538-2551`

Changelog schema (from a live sample) [ran]:
```
account_key, change_type, changed_at, changed_by, effective_date,
entity_id, entity_label, new_value, old_value, reason,
requested_by, entity_type, id
```

**Where a fee backdate lands** [code-read]: `sc_fee_schedule` + `sc_config_changelog`. `src/app/api/service-calendar/route.js:1416-...`, calling `updateFeeSchedule` in `src/lib/dataStore/serviceCalendar.js`.

**Can an email be built purely from what's recorded?** By field:

| Field the ruling asks for | Where it lives | Recorded? |
|---|---|---|
| account_key | `sc_config_changelog.account_key` | YES, structured |
| service | `entity_id` + `entity_label` | YES, structured |
| old price / new price | `old_value.price` / `new_value.price` (JSONB) | YES, structured |
| effective_date | `effective_date` | YES, structured |
| actor | `changed_by` (session email) + `requested_by` (typed name) | YES, structured |
| **affected span (day count)** | Buried in `reason` prefix text | PARSEABLE ONLY (in the prefix format `[Backdate touched closed period Pn, 43 days]`) |
| **revenue delta ($)** | Buried in `reason` prefix text when available | PARSEABLE ONLY (`[Backdate touched closed period Pn, 43 days ($-1,234.56)] reason`) |

**Prefix generator:** `src/lib/scBackdateReport.js:404-` `composeBackdateReason({ closedPeriods, affectedDayCount, revenueDeltaCents, operatorReason })`.

Fee backdates do NOT get a revenue delta by design (owner ruling; see `src/app/api/service-calendar/route.js:1501-1509` comment).

**One-line answer:** yes an email can be built, but the day-count + $-delta must be parsed from a canonical prefix inside `reason`, not read as first-class columns. If the billing arc wants these as structured fields, that's a schema change - flag, do not fix.

**Additional finding (surfaced by C-1):** if a fee edit bypasses this path (as `kf-fee-escalation-2026-07` did on CIN - OH), the changelog carries no entry at all. The email would show a $ figure inconsistent with the changelog history.

---

## C-5 Admin gate membership

**Source:** hardcoded, `Object.freeze(new Set([...]))`, `src/lib/admin.js:60-69`. **Not env, not table, not role.** [code-read]

Membership is a set of eight lowercased emails covering four roles (Director of Ops, CEO, VP Ops, Director of Culinary, HR, Finance, and two regional directors). Per the file's own comment (`admin.js:44-58`), the list is "hardcoded so adds/removes are 1-line PRs and visible in git history." Distinct from `OPS_LEADERSHIP_EMAILS` above it.

`isScAdmin(email)` normalization: `email.toLowerCase().trim()` + `has()`. `admin.js:77-78`.

**Emails not pasted per ruling.** Sebastian Castro (Finance) is a member of the SC_ADMIN_EMAILS set - relevant for the billing arc since he's the accountant driving the QB pipeline design; his gate is already in place.

---

## C-6 Operator export data path

**Verdict: Mon-Sun per-service-per-day slice is ALREADY computable from `sc_daily_revenue` with no new schema.** [code-read + ran on view schema]

**Route:** `src/app/api/service-calendar/export/route.js:21-72`. GET with query params `account`, `scope` (period|month|year), `year`, `period`, `month`. Session auth only (Q2 ruling: no admin gate; all authenticated operators may export). Emits `.xlsx`.

**Bulk data pull:** `src/lib/export/scWorkbook.js:230-251` `loadViewRows` reads `sc_daily_revenue`:
```js
supa.from("sc_daily_revenue")
    .select("*")
    .eq("account_key", accountKey)
    .gte("service_date", first)
    .lte("service_date", last)
    .order("service_date").order("service_id")
    .range(from, from + 1000 - 1);   // pages through 1000-row chunks until empty
```

**Money source** (from the file's own header comment `scWorkbook.js:16-25`): "Per-day dollar figures come from `sc_daily_revenue` (effective-dated LATERAL price join). NEVER read the catalog price and multiply."

**Time slicing** (`scWorkbook.js` `resolveRange` and `L1 BY WEEK block`): period scope uses `sc_day_metadata.periodRanges`; month scope uses YYYY-MM; year uses full year. Every scope walks days between `range.first` and `range.last`.

**`sc_daily_revenue` view schema** [ran]:
```
account_key, actual_count, actual_price_at_date, actual_price_effective_date,
actual_revenue, day_notes, event_label, game_time, game_type, group_name,
has_actuals, has_projection, is_flat_fee, is_non_revenue, is_tax_free,
period, price_at_date, price_effective_date, projected_count,
projected_revenue, service_date, service_id, service_name, week_label
```

**Verdict:** the view already returns per-service-per-day rows with `actual_count`, `actual_price_at_date`, `actual_revenue`, `service_name`, `group_name`, `period`, `week_label`, plus flags (`has_actuals`, `is_non_revenue`, `is_flat_fee`, `is_tax_free`). Grouping these by Mon-Sun (derived from `service_date`) yields the invoicing atom directly. **No new schema required** for the invoice-builder feasibility path.

Pagination note: 1000-row PAGE constant matches Supabase PostgREST default. See C-12.

---

## C-7 #615 placeholder

**Merge commit `f46daec`, feature commit `7eb5fe0` (2026-08-04).** [ran]

**Files added/touched (1 file):** [ran]
```
$ git show --stat --name-status 7eb5fe0
M  src/app/service-calendar/season/ExportControl.js
```

**What exists today** in `src/app/service-calendar/season/ExportControl.js` (verified by grep, still present):
- Line 262-306: `billingPeriodItem(period)` factory - returns a menu item with `disabled: true`, `comingSoon: true`, `label: "Excel - Period Close Billing"`, `disabledSub: "available at period close"`, `disabledTitle: "Excel period-close billing - not yet built; will become available once every day in the period is entered."`
- Placement: after `xlsxItem(period)`, before `pdfPeriodItem`.
- Every account (fee + per-meal). Period drill only.
- **Renderer check** at line 197: `{item.comingSoon ? <span className="sc-export-menu-item-tag">COMING SOON</span> : null}`. Button element carries no HTML `href`; `startDownload` gates on `!item.disabled` at line 191.

**No new route, no filename, no API action.** The arc extends this placeholder rather than rebuilds.

---

## C-8 By-service-week detectability

**Verdict: `sc_daily_projections` sum-per-date is the current best signal for "week that had service." `sc_daily_actuals` is severely under-populated (see C-11).**

**CIN - KY, 2026-07-13..2026-08-09:** [ran]

Actuals total per date (`sc_daily_actuals`):
```
2026-07-13  total=38
2026-07-14  total=45
(no other dates have actuals)
```

Projections total per date (`sc_daily_projections`):
```
2026-07-13..07-27  proj_total=0 all days
2026-07-28  proj_total=135
2026-07-29  proj_total=90
2026-07-30  proj_total=135
2026-07-31  proj_total=135
2026-08-01  proj_total=135
2026-08-02  proj_total=45
2026-08-03..08-09  proj_total=0
```
**Week of 2026-07-27..2026-08-02** clearly is a service week (proj > 0 on 6 of 7 days; sum 675). **Week 2026-08-03..2026-08-09** clearly is not (proj = 0 all week).

**TBJ - NY, 2026-07-13..2026-08-09:** [ran]

Actuals total per date:
```
2026-07-27  total=100
(no other dates)
```

Projections total per date:
```
2026-07-13..07-20  0
2026-07-21..07-25  90 each day (Mon-Fri)
2026-07-26..08-03  0
2026-08-04..08-08  90 each day
2026-08-09         0
```
**Week 2026-07-20..2026-07-26** = service week (5 weekdays projected). **Week 2026-08-03..2026-08-09** = service week (5 weekdays projected). Weekend days project 0, matching the AAA operational pattern.

**Recommended detection query for the billing arc:**
```sql
SELECT DATE_TRUNC('week', service_date + INTERVAL '1 day') - INTERVAL '1 day' AS week_start_monday,
       SUM(projected_count) AS wk_proj,
       SUM(actual_count)    AS wk_act
FROM sc_daily_revenue
WHERE account_key = $1 AND service_date >= $2 AND service_date < $3
GROUP BY 1
HAVING SUM(projected_count) > 0 OR SUM(actual_count) > 0;
```
(Mon-Sun grouping: PG `date_trunc('week', ...)` returns Monday.)

Fallback: `has_projection` and `has_actuals` boolean columns already exist on the view.

---

## C-9 SC-side mapping raw material

**Six per-meal accounts, every active service, current effective price (today = 2026-08-06).** [ran]

Legend: `NR` = `is_non_revenue`, `FF` = `is_flat_fee`, `TF` = `is_tax_free`. Prices stored at 4 decimals.

### CIN - AZ (13 services)

| group | service | price (today) | effective_date | flags |
|---|---|---|---|---|
| Major League | Breakfast | $20.3100 | 2026-06-18 | |
| Major League | Dinner | $20.3062 | 2026-06-16 | |
| Major League | Lunch | $20.3062 | 2026-06-16 | |
| Minor League | Breakfast | $12.8950 | 2026-06-16 | |
| Minor League | Coffee Service | $511.0529 | 2026-01-01 | FF TF |
| Minor League | Dinner | $12.8950 | 2026-06-16 | |
| Minor League | Fountain Bev | $283.9171 | 2026-01-01 | FF TF |
| Minor League | Lunch | $12.8950 | 2026-06-26 | |
| Minor League | Pre-Game Snack | $5.1202 | 2026-06-16 | |
| Rehab | Breakfast | $12.8950 | 2026-06-16 | |
| Rehab | Continental Plus | $6.3566 | 2026-06-16 | |
| Rehab | Dinner | $12.8950 | 2026-06-16 | |
| Rehab | Lunch | $12.8950 | 2026-06-16 | |

### TXR - AZ (13 services)

| group | service | price (today) | effective_date | flags |
|---|---|---|---|---|
| Major League | Breakfast | $28.5770 | 2026-06-16 | |
| Major League | Dinner | $28.5770 | 2026-06-16 | |
| Major League | Extra Protein - Beef/Seafood | $165.0000 | 2026-01-01 | FF |
| Major League | Extra Protein - Chicken/Pork | $115.0000 | 2026-01-01 | FF |
| Major League | Lunch | $28.5770 | 2026-06-16 | |
| Minor League | Breakfast | $14.2926 | 2026-06-16 | |
| Minor League | Continental Breakfast | $6.5600 | 2026-06-16 | |
| Minor League | Dinner | $14.2926 | 2026-06-16 | |
| Minor League | Extra Protein - Beef/Seafood | $165.0000 | 2026-01-01 | FF |
| Minor League | Extra Protein - Chicken/Pork | $115.0000 | 2026-01-01 | FF |
| Minor League | Lunch | $14.2926 | 2026-06-16 | |
| Minor League | Pre-Game Hot Snack | $10.9306 | 2026-06-16 | |
| Minor League | Regular Snack | $5.8876 | 2026-06-16 | |

### TBJ - FL (21 services)

| group | service | price (today) | effective_date | flags |
|---|---|---|---|---|
| Major League - PDC | Breakfast | $23.1178 | 2026-01-01 | |
| Major League - PDC | Dinner | $23.1178 | 2026-01-01 | |
| Major League - PDC | Lunch | $23.1178 | 2026-01-01 | |
| Major League - PDC | Post Game Meal | $23.1178 | 2026-01-01 | |
| Major League - PDC | Snack | $1.7040 | 2026-01-01 | |
| Major League - PDC | Umpire | $23.1178 | 2026-01-01 | |
| Minor League - PDC | Breakfast | $11.5537 | 2026-01-01 | |
| Minor League - PDC | Dinner | $11.5537 | 2026-01-01 | |
| Minor League - PDC | Lunch | $11.5537 | 2026-01-01 | |
| Other | Fun $$$$ Allocated | $0.0000 | 2026-06-17 | NR FF |
| Other | Media Meals | $16.0000 | 2026-06-16 | |
| Other | MiLB G&G - Pantry | $1.7040 | 2026-01-01 | |
| Other | MLB - Catering | $38.0000 | 2026-01-01 | |
| Other | MLB G&G - Pantry | $1.7040 | 2026-01-01 | |
| Other | Scout Meals | $11.5500 | 2026-01-01 | |
| Other | Team Canada | $11.5537 | 2026-01-01 | |
| Single A Jays | Breakfast | $16.5097 | 2026-01-01 | |
| Single A Jays | Post-Game | $16.5097 | 2026-01-01 | |
| Single A Jays | Pre-Game | $16.5097 | 2026-01-01 | |
| SSM | Florida Ops - PDC | $11.5500 | 2026-01-01 | |
| SSM | Stadium Staff Meals | $16.5097 | 2026-01-01 | |

### TBR - FL (20 services)

| group | service | price (today) | effective_date | flags |
|---|---|---|---|---|
| Boys & Girls Club | B&G Lunch | $6.5000 | 2026-01-01 | TF |
| Major League | Breakfast | $35.6273 | 2026-01-01 | |
| Major League | Dinner | $39.4820 | 2026-01-01 | |
| Major League | Extra Protein - Beef/Seafood | $162.1671 | 2026-01-01 | FF |
| Major League | Extra Protein - Chicken/Pork | $111.8380 | 2026-01-01 | FF |
| Major League | Lunch | $39.4820 | 2026-01-01 | |
| Major League | MLB - Extra MTO - Lrg | $15.0000 | 2026-01-01 | FF |
| Major League | MLB - Extra MTO - Med | $10.0000 | 2026-01-01 | FF |
| Major League | MLB - Extra MTO - Sm | $5.0000 | 2026-01-01 | FF |
| Major League | Umpire Meal | $39.4820 | 2026-01-01 | |
| Minor League | AFTER HOURS MEALS | $20.9618 | 2026-06-16 | |
| Minor League | Breakfast - MiLB | $17.8275 | 2026-01-01 | |
| Minor League | Breakfast - MiLB ST | $17.8275 | 2026-06-16 | |
| Minor League | Dinner | $20.9618 | 2026-06-16 | |
| Minor League | Extended Day Labor | $280.0000 | 2026-01-01 | FF |
| Minor League | Extra Protein - Beef/Seafood | $162.1671 | 2026-01-01 | FF |
| Minor League | Extra Protein - Chicken/Pork | $111.8380 | 2026-01-01 | FF |
| Minor League | Lunch - MiLB | $21.6750 | 2026-01-01 | |
| Minor League | Lunch - MiLB ST | $21.6750 | 2026-06-16 | |
| Minor League | Road Sandwiches - MiLB | $15.0000 | 2026-01-01 | |

### CIN - KY (5 services)

| group | service | price (today) | effective_date | flags |
|---|---|---|---|---|
| Louisville Bats | Breakfast | $25.9542 | 2026-01-01 | |
| Louisville Bats | Lunch | $25.9542 | 2026-01-01 | |
| Louisville Bats | Post-Game | $25.9542 | 2026-01-01 | |
| Louisville Bats | Snack | $8.6445 | 2026-01-01 | |
| Louisville Bats | Umpire | $25.9542 | 2026-01-01 | |

### TBJ - NY (6 services)

| group | service | price (today) | effective_date | flags |
|---|---|---|---|---|
| Buffalo Bisons | Breakfast | $27.3400 | 2026-01-01 | |
| Buffalo Bisons | Lunch | $27.3400 | 2026-01-01 | |
| Buffalo Bisons | Post-Game | $27.3400 | 2026-01-01 | |
| Buffalo Bisons | Shake | $0.0000 | 2026-01-01 | |
| Buffalo Bisons | Snack | $0.0000 | 2026-01-01 | |
| Buffalo Bisons | Umpire | $27.3400 | 2026-01-01 | |

**Full service_ids and JSON output preserved in probe transcript (not pasted here to keep the doc scannable; ask for the full paste if needed for QB item mapping).**

---

## C-10 TXR - AZ price truth spot-check

**Verdict: SC MATCHES the QB invoice line rates (14.29, 5.89, 10.93). QB item master (13.94, 5.74, 10.66) is STALE.**

Three-way table [ran]:

| service | SC price (today) | QB invoice line rate | QB item master rate | agreement |
|---|---|---|---|---|
| Minor League / Breakfast | $14.2926 | $14.29 | $13.94 | **SC = invoice** (rounds to 14.29). Item master lags. |
| Minor League / Lunch | $14.2926 | $14.29 | $13.94 | **SC = invoice**. |
| Minor League / Dinner | $14.2926 | $14.29 | $13.94 | **SC = invoice**. |
| Minor League / Regular Snack | $5.8876 | $5.89 | $5.74 | **SC = invoice** (rounds to 5.89). |
| Minor League / Pre-Game Hot Snack | $10.9306 | $10.93 | $10.66 | **SC = invoice** (rounds to 10.93). |

Every SC price has an `effective_date = 2026-06-16` (the current row) and a `2026-01-01` prior row:

| service | prior (2026-01-01) | current (2026-06-16) | change |
|---|---|---|---|
| Breakfast | $17.8657 | $14.2926 | -$3.57 |
| Lunch | $17.8657 | $14.2926 | -$3.57 |
| Dinner | $17.8657 | $14.2926 | -$3.57 |
| Regular Snack | $7.3595 | $5.8876 | -$1.47 |
| Pre-Game Hot Snack | $13.6632 | $10.9306 | -$2.73 |

**Interpretation:** the meal rates were reduced by ~20% on 2026-06-16 (mid-contract adjustment). QB's per-line rates were updated to reflect that. **QB's item master was not.** SC is the authoritative rate source per contract; QBO uses per-line rates at write time.

**Billing-arc consequence:** the QBO adapter must write per-line rates (not rely on the QB item master). Confirmed by observed live invoice behavior.

---

## C-11 THE FEASIBILITY PROOF - reconcile a real invoice

**Verdict: (c) ABSENT/STALE for both invoice weeks. SC has partial actuals; where actuals exist they don't match invoice quantities. All actuals in scope are hand-entered by `k.fietek@kitchfix.com` - test data, not operational records.**

### Invoice K300168954 - Mon 2026-07-27 -> Sun 2026-08-02

**Invoice line items** (from ruling):
- 6x MiLB Breakfast/Lunch/Dinner at 200/day @ $14.29 (description "Breakfast - 100 & Lunch - 100" - the invoice combines these on a single "meal" line)
- Regular Snack per day: 80, 55, 50, 65, 55, 50 @ $5.89
- **Pre-tax subtotal $19,238.95**

**SC actuals per service, week rollup Mon-Sun** [ran, via `sc_daily_revenue`]:

| service | actual units | actual $ | projected units | projected $ |
|---|---|---|---|---|
| Breakfast | 80 | $1,143.41 | 160 | $2,286.82 |
| Continental Breakfast | 0 | $0.00 | 0 | $0.00 |
| Dinner | 300 | $4,287.78 | 600 | $8,575.56 |
| Extra Protein - Beef/Seafood | 0 | $0.00 | 0 | $0.00 |
| Extra Protein - Chicken/Pork | 0 | $0.00 | 0 | $0.00 |
| Lunch | 200 | $2,858.52 | 400 | $5,717.04 |
| Pre-Game Hot Snack | 200 | $2,186.12 | 400 | $4,372.24 |
| Regular Snack | 60 | $353.26 | 120 | $706.51 |
| **TOTAL** | | **$10,829.08** | | **$21,658.17** |
| **Invoice pre-tax subtotal** | | **$19,238.95** | | |

**Per-day slice** [ran]:
```
2026-07-27  no actuals
2026-07-28  no actuals
2026-07-29  no actuals
2026-07-30  Breakfast=0, Lunch=100, Dinner=100, PreGame=100, RegSnack=0, ContBkfst=0, ExtraProteinC/P=0, ExtraProteinB/S=0  [ACTUALS]
2026-07-31  Breakfast=0, Lunch=100, Dinner=100, PreGame=100, RegSnack=0, ContBkfst=0                                        [ACTUALS]
2026-08-01  Breakfast=80, Lunch=0, Dinner=100, PreGame=0, RegSnack=60, ContBkfst=0                                          [ACTUALS]
2026-08-02  no actuals
```

**Comparison to invoice quantities:**
- Invoice claims 200 combined Bkfst+Lunch every day for 6 days = 1,200 combined units. SC has 80+100+80 = 260 combined units across 3 days. **Delta: -940 units (~-$13,435).**
- Invoice claims 355 total Regular Snack units. SC has 60. **Delta: -295 units (~-$1,737).**
- Actuals `created_by` = `k.fietek@kitchfix.com` on every row - hand-entered by owner.

**Verdict: ABSENT/STALE.** SC lacks operational actuals for this invoice week. What is there is test data by owner. The seed/backfill work the pilot needs is to import the live spreadsheet counts for TXR - AZ into `sc_daily_actuals` before this invoice week could be sourced from SC.

**Interesting adjacent finding**: `projected_revenue` = $21,658.17, close to the invoice's $19,238.95 (delta -12%). The PROJECTIONS approximately match invoiced totals. The ACTUALS are the gap.

### Invoice K300168897 - Mon 2026-07-20 -> Sun 2026-07-26

**Invoice line summary** (from ruling): 6 days of MiLB Bkfst/Lunch/Dinner at qty 175, 250, 175, 175, 223, 150 @ $14.29 = 1,148 units total = ~$16,405 pre-tax on the meal lines (snacks add on top).

**SC actuals week rollup** [ran]:

| service | actual units | actual $ | projected units | projected $ |
|---|---|---|---|---|
| Breakfast | 0 | $0.00 | 0 | $0.00 |
| Continental Breakfast | 0 | $0.00 | 0 | $0.00 |
| Dinner | 150 | $2,143.89 | 900 | $12,863.34 |
| Lunch | 150 | $2,143.89 | 900 | $12,863.34 |
| Pre-Game Hot Snack | 125 | $1,366.33 | 750 | $8,197.95 |
| Regular Snack | 0 | $0.00 | 0 | $0.00 |
| **TOTAL** | | **$5,654.10** | | **$33,924.63** |
| **Invoice meal lines (approx)** | | **~$16,404.92** | | |

**Only 1 day of actuals in the entire week: 2026-07-25** (Lunch=150, Dinner=150, PreGame=125). Days 7/20, 7/21, 7/22, 7/23, 7/24, 7/26 all have no actuals.

**Verdict: ABSENT/STALE.** Same pattern. The invoice week has 1/7 days of actuals; that one day's quantities don't align with the invoice pattern either.

**Cross-week comparison**: for week 2026-07-20..07-26 the projected total $33,924.63 is MUCH higher than the invoice's ~$16,405 (2x). The prior week's over-projection suggests either the plan was aspirational, spring training slowed the count, or projections carry stale figures that pre-date the June 16 rate cut being applied at half-strength somewhere. This is a distinct discrepancy from the actuals gap and worth its own recon if the billing arc plans to derive AP checkbacks from `projected_revenue`.

---

## C-12 Risk sweep

Naming things that could bite the three components the arc will add: per-week finalize state + invoice-builder function + QBO adapter.

**All [code-read] except where marked.**

### R-1 - Supabase pagination default (1,000 rows) is real and applies

`src/lib/export/scWorkbook.js:231-249` `loadViewRows` explicitly pages by `PAGE = 1000`. Any invoice-builder that runs a single `.select("*").eq(...).gte(...).lte(...)` on `sc_daily_revenue` without pagination will silently truncate for accounts with heavy weeks or wide date ranges. The scWorkbook pattern (loop `.range(from, from + PAGE - 1)` until empty) is the reference. **Not visible in dev; visible in prod at scale.**

### R-2 - Fee changelog gap (surfaced by C-1)

`sc_fee_schedule` can be updated by a script bypassing `sc_config_changelog`. If the invoice-builder or an AP-facing audit trail relies on the changelog as the source of truth for fee history, it will be wrong for at least one existing case (CIN - OH, kf-fee-escalation-2026-07). Flag; the arc's design must either (a) also read `sc_fee_schedule.changed_by`+`.reason`, or (b) demand a backfill migration that writes the missing changelog row.

### R-3 - Actuals-vs-projections divergence is severe today (C-11)

The pilot cannot invoice from `actual_revenue` today. Every per-meal account will need seed backfill (or dual-write for the transition weeks). This is not a code risk; it's a data-readiness risk that affects the finalize-state design (a "closed and ready to invoice" week needs the actuals to actually be in). Flag: design the finalize action to require `has_actuals=true` for every service-day the projections thought would run, and to distinguish "closed as invoiced" from "closed as no-service" (see the "no-service day" storage banked finding in `SC_ROAD_TO_CUTOVER.md`).

### R-4 - Period boundary vs. week boundary mismatch

A Mon-Sun week that spans two periods (e.g., week 2026-07-13..07-19 straddling P7/P8 for some accounts) has no single `period` value on the aggregate row. `week_label` resets at period boundaries (C-3), so `week_label` also cannot be the sole invoicing key. **Invoice-builder must key on `(account_key, week_start_monday)` derived from `service_date`, not on `period` or `week_label` alone.** The finalize state design also needs to answer: does a period close force close the still-open trailing days of a straddling week, or leave them open? Owner ruling required; flag.

### R-5 - Non-revenue + flat-fee flag handling

`sc_daily_revenue` includes `is_non_revenue` and `is_flat_fee` flags per row. The invoice-builder must exclude `is_non_revenue=true` rows (e.g., TBJ - FL / Other / "Fun $$$$ Allocated" at $0.00) and treat `is_flat_fee=true` services (Coffee Service, Fountain Bev, Extra Protein, Extended Day Labor) as fixed-rate line items regardless of count. Not a code risk today - just a construct the invoice-builder must implement correctly from day one.

### R-6 - Cache-Control on export route

`src/app/api/service-calendar/export/route.js:66` sets `Cache-Control: no-store` on the xlsx download. Any QBO-adapter-triggered download that relies on browser or CDN caching for repeated invoicing runs will need to add its own cache layer or accept the recomputation cost. Minor.

### R-7 - Auth boundary on the export route

`src/app/api/service-calendar/export/route.js:22-25` gates only on session presence (any authenticated user can export the workbook). If the QBO adapter is a server-side scheduled job, it needs a service-role path, not this auth-session path. Not a bug; the arc will need its own service-side entry point.

### R-8 - The `sc_daily_revenue` view is a VIEW not a table

Full read via `.from("sc_daily_revenue").select("*")` returned 24 columns including derived ones (`has_actuals`, `has_projection`, `week_label`, `event_label`, `day_notes`, `game_time`, `game_type`, `actual_price_at_date`, `actual_price_effective_date`, `price_at_date`, `price_effective_date`). Reads are fine, but the arc cannot INDEX or CONSTRAIN this - constraints belong on `sc_daily_actuals` / `sc_service_prices` / `sc_fee_schedule`. Also: PostgREST view relationships are hit-or-miss - my first C-11 join attempt `.from("sc_daily_revenue").select("...sc_services(...)")` failed with `Could not find a relationship between 'sc_daily_revenue' and 'sc_services' in the schema cache`, which forced a manual name lookup. **The QBO adapter's read path should use two round-trips (view + name lookup) or a materialized snapshot, not a nested-select join.**

### R-9 - `sc-add-note` bypasses period lock by design (C-2)

Not a bug, an owner ruling. If the billing arc adds a "invoice sent" or "AP pulled" note to a closed period, that write path stays open. Good for record-keeping; be aware the note surface is the ONLY user-facing write that survives period close.

### R-10 - The 3-day grace window on `sc_is_period_closed` (v1)

Currently a hardcoded `c_grace_days := 3` inside the plpgsql body (`sc-25:294`). Fine as a proxy; disappears in v2 when AP-has-pulled becomes the check. Not a risk unless the billing arc lands v2's replacement function while still assuming the grace exists.

### R-11 - QB item master is STALE (C-10)

Not an SC-code risk, but calling it out because the arc must anchor on SC-side rates. If a future maintainer wires the QBO adapter to fall back to QB's item master when SC doesn't have a rate, they will bill 20% lower on 5 TXR - AZ services. **Flag in the adapter's docstring when it lands.**

---

## Summary

Bright spots for the arc:
- `sc_daily_revenue` view already carries everything the invoice-builder needs (per-service-per-day units, prices, revenue, non-revenue flags).
- Period lock is cleanly split (v1 date proxy today, swap point to AP-pulled ready).
- Admin gate is a simple frozen Set in one file; adds are 1-line PRs.
- QB Online writes per-line rates from what the invoice carries - SC-side rates ARE the source of truth. QB item master is stale but not on the write path.

Load-bearing gaps:
- **Actuals are severely under-populated** for both pilot invoice weeks (C-11). Seed program becomes gating for cutover.
- **Fee changelog is incomplete** (C-1 script bypass). Do not treat as authoritative for fee history without a backfill.
- **`week_label` cannot be the sole invoicing key** (C-3 boundary reset). Derive Mon-Sun from `service_date`.
- **Backdate email needs prefix parsing** for day-count + delta (C-4). Structured columns cover the other fields.

The arc can proceed on the code side. Data-readiness is the bigger blocker.

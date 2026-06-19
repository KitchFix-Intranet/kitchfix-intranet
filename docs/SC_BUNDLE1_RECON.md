# Service Calendar - Bundle 1 Recon

**To:** Chat-Claude (for the Bundle 1 build scoping)
**From:** CC (read-only diagnostic)
**Date:** 2026-06-18
**Origin/main SHA:** `cb89fd7` (Merge PR #210 news-admin)
**Worktree:** `/Users/kevinfietek/dev/kitchfix-bundle1-recon` on `chore/sc-bundle1-recon`
**Live probe:** ran (`scripts/_probe_bundle1_recon.mjs`, untracked)

Read-only throughout. No edits, no commits, no migrations.

---

## CONTRACT BIBLE STATUS (flagging up top)

**The "RESOLVED BILLING DECISIONS (contract bible)" section is NOT present in `docs/SC_CONTRACT_BILLING_SUMMARY.md` on `cb89fd7`.** The doc still has its original `Per-account contract terms` (line 35), `Contract vs spreadsheet rate comparison` (line 429), `Schema implications` (line 532), `Billing model validation` (line 574) sections - no resolved-decisions banner at the top.

Per the task spec instruction, I am using the locked Part C values as authoritative:

| Account | Locked fee |
|---|---|
| CIN-OH | $362,500 (+ CPI) |
| STL-MO | $473,000 (service portion: $423K meals + $50K road; passthrough excluded) |
| TXR-TX-H | $604,032 |
| TXR-TX-V | $0 (covered by H) |
| STL-FL | $1,400,000 (Florida Services fee; $900K passthrough excluded) |

If Kevin lands that banner before the build prompt, Chat-Claude should re-check it against these values.

---

## PART A - calendar revenue read-path

### A.1 How the calendar gets revenue today (end-to-end trace)

**Year view (year cards + year banner):** ALREADY DB-sourced via `sc_month_summary`.
- `loadYearSummaryPostgres` at `serviceCalendar.js:707-986` reads `sc_month_summary` directly (line 720). The view computes `total_actual_revenue` and `total_projected_revenue` per month with the price-at-date `LATERAL` join (sc-1b:131-132).
- Route `sc-year-summary` at `route.js:328-369` forwards `m.totalActualRevenue` / `m.totalProjectedRevenue` as `actualRevenue` / `projectedRevenue` to the client (lines 356-357).
- Calendar uses these at `ServiceCalendar.js:917`: `const displayRev = hasActuals ? md.actualRevenue : (md?.projectedRevenue || 0);` - rendered as the `$XXk` figure on each year card (line 1038).
- **Year-card revenue is correct against the canonical view.**

**Month view (metrics strip, day tiles, week summary, month footer): JS-side compute, NOT view-sourced.**
- Route `sc-load` action calls `transformDays(monthData.days)` at `route.js:283`.
- **The route's `transformDays` at `route.js:159-187` STRIPS revenue from the orchestrator's payload.** It only forwards per-day `projected: {[serviceId]: count}` and `actual: {[serviceId]: count}` plus meta. The orchestrator's `loadMonthDataPostgres` at `serviceCalendar.js:527-616` reads `sc_daily_revenue` and assembles per-day + per-service `projectedRevenue`/`actualRevenue` plus per-service `priceAtDate` (lines 574-578), but **none of these reach the UI**.
- Calendar then has no choice but to recompute revenue JS-side:
  - `priceLookup` at `ServiceCalendar.js:169`: a map of `serviceId -> services[].price` (the orchestrator's "as-of-today" price from `loadAccountConfig`).
  - `metrics` useMemo at `:171-195`: sums `pv * price` for each (day, service). The `price` is the SAME current-price for every day in the visible month.
  - `daySummary` useCallback at `:317-325`: per-day `actual_count * priceLookup` for tile + week-summary revenue.
  - Display sites: tile rev at `:759-760`, week rev at `:786`, month-footer rev at `:843`.

**Smoking gun**: `transformDays:163-166` loops services but only captures count, not the view's revenue. The route's design throws away the very fields that would make the month view DB-canonical.

### A.2 Drift confirmed live (CIN-AZ Major League Breakfast)

Live probe of `sc_service_prices` for CIN-AZ Major League Breakfast:

```
4 dated rows for service 1e5a337d-610b-4b7d-9154-3f8787e8ccf8:
  eff=2026-06-18 price=20.32      by=k.fietek note="Testing"
  eff=2026-06-17 price=20.30622   by=k.fietek note=""
  eff=2026-06-16 price=20.30622   by=k.fietek note="Billing rate: 70% of full rate (30% SF billed separately)"
  eff=2026-01-01 price=29.00888   by=import-script note=""
```

`sc_daily_revenue` for service-dates 2026-06-10 through 2026-06-25:

```
service_date  price_at_date  actual_count  actual_revenue
2026-06-10    29.00888       0             0
2026-06-11    29.00888       0             0
...
2026-06-15    29.00888       0             0
2026-06-16    20.30622       0             0
2026-06-17    20.30622       0             0
2026-06-18    20.32          0             0
2026-06-19    20.32          0             0
...
2026-06-25    20.32          0             0
```

Orchestrator's `loadAccountConfig` would return `20.32` (latest <= today). The calendar's `priceLookup[serviceId] = 20.32` for every day in the visible month.

**The drift on Jun 10-15 is real**: view says `29.00888`, JS-side compute says `20.32` (32% understatement). Today the dollar drift is $0 because every `actual_count` in the pre-edit window is 0. **The mechanism is armed and will activate the moment any actual is entered for a date earlier than the latest effective_date.** Same exposure for every account that has > 1 dated price row (53 of 105 services per the prior recon).

The year card revenue for June would show $0 (view computes correctly to $0), but if there were a non-zero actual on Jun 10-15, the month-view tile + week + footer would show a 32% understatement while the year card would show the correct value. **The year and month surfaces would visibly disagree.**

### A.3 The views (re-quoted from sc-1b)

**`sc_daily_revenue`** (sc-1b:55-105) - the LATERAL pick that prices each service-day by `effective_date <= service_date`:

```sql
... LEFT JOIN LATERAL (
  SELECT price, effective_date AS price_effective_date
  FROM sc_service_prices
  WHERE service_id = sd.service_id
    AND effective_date <= sd.service_date
  ORDER BY effective_date DESC
  LIMIT 1
) pr ON TRUE
```

Exposes `price_at_date`, `projected_revenue` (= projected_count × price_at_date), `actual_revenue` (= actual_count × price_at_date), plus the `is_non_revenue` flag.

**`sc_month_summary`** (sc-1b:123-135) - aggregates by month with `FILTER (WHERE NOT is_non_revenue)` on the 3 revenue totals:

```sql
SUM(projected_revenue) FILTER (WHERE NOT is_non_revenue) AS total_projected_revenue,
SUM(actual_revenue)    FILTER (WHERE has_actuals AND NOT is_non_revenue) AS total_actual_revenue,
SUM(actual_revenue - projected_revenue) FILTER (WHERE has_actuals AND NOT is_non_revenue) AS revenue_variance
```

**These views are the right source.** They already implement effective-dated pricing + non-revenue exclusion. The bug is that the route doesn't forward their values into the month-view payload.

### A.4 What the swap requires

**Minimal mechanical change in the route's `transformDays` at `route.js:159-187`:** also forward the per-day revenue + per-service revenue + priceAtDate that the orchestrator already produces. Add to each day:

```js
totals: { projectedRevenue, actualRevenue },  // already on the orchestrator's day at line 608
services: d.services.map(s => ({
  serviceId: s.serviceId,
  projectedCount: s.projectedCount,
  actualCount: s.actualCount,
  projectedRevenue: s.projectedRevenue,
  actualRevenue: s.actualRevenue,
  priceAtDate: s.priceAtDate,
})),
```

The existing `projected: {[id]: count}` and `actual: {[id]: count}` maps can stay for backwards compatibility, or be replaced. Either works; replacing them simplifies the client.

**Then in `ServiceCalendar.js`:**
- `metrics` useMemo (`:171-195`): swap the inner `pv * price` math for `day.totals.projectedRevenue` / `day.totals.actualRevenue`. `priceLookup` becomes display-only (for showing the as-of-today price next to a service name).
- `daySummary` useCallback (`:317-325`): swap to `day.totals.{actualRevenue|projectedRevenue}` for the tile + week-summary display.
- `enteredProjRev` (the pace denominator at `:189`): swap to sum `day.totals.projectedRevenue` for days with actuals only. Pace math holds.

**Surfaces that visibly change after the swap (and SHOULD - this is the fix):**
- **Day tile revenue** (line 759-760): correct against effective-dated history for any day before the latest price change.
- **Week summary rev** (line 786): correct.
- **Month footer rev** (line 843): correct.
- **Metrics strip "Revenue" tile** (line 594): correct.
- **Pace tile** (line 599-606): correct (denominator + numerator both swap).

Surfaces that DON'T change: year-card rev + year-banner (already DB-sourced).

### A.5 Pagination + view treatment of flat-fee services

**Pagination:** `loadMonthDataPostgres` already uses `fetchAllPaginated` (line 536). Single-month read is at most ~650 rows (TBJ-FL's 21 services × 31 days). The orchestrator is safe; the route's payload shape change doesn't add rows. **No pagination concern for Bundle 1's Part A swap.** For the year-view side, `loadYearSummaryPostgres` already uses `fetchAllPaginated` (line 750-761) - 12 months × ~650 rows = ~7800 rows, pre-existing.

**Views and `is_flat_fee`:** `sc_daily_revenue` exposes `s.is_flat_fee` (sc-1b:66) but does NOT filter on it. Flat-fee services (per-service flag) still get `count × price_at_date` in the revenue compute. Live: `is_flat_fee=TRUE` on 16 of 105 active services across 5 accounts (CIN-AZ 2, STL-FL 1, TBJ-FL 1, TBR-FL 8, TXR-AZ 4). These are per-meal services with package-style pricing (e.g. "Coffee Service $450/week"). The view treats them as normal revenue; whether that's right is per-account business logic, NOT a Bundle 1 question. Flag only.

### A.6 Fee accounts on the calendar - locked architecture

Per the locked architecture: **fee accounts show operational data only, no dollar figure.** Not zero, not fee-derived. The calendar never reads the fee schedule.

**How fee accounts currently show revenue:**

Live confirmed: all 4 MLB fee accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V) and STL-FL have 100% of their per-meal prices at **$0.00 effective 2026-06-16** (Joe's price review):

```
CIN - OH        4 svc | non-zero prices: 0 | sum: $0.00
STL - MO        4 svc | non-zero prices: 0 | sum: $0.00
TXR - TX - H    4 svc | non-zero prices: 0 | sum: $0.00
TXR - TX - V    4 svc | non-zero prices: 0 | sum: $0.00
STL - FL       11 svc | non-zero prices: 0 | sum: $0.00
```

So `meals × $0 = $0` everywhere on these accounts today. Fee accounts' calendar revenue is **already $0 by data accident, not by design**. The Bundle 1 fix is to make this DESIGN: fee accounts get NO revenue figure on the calendar UI at all (not $0, just absent).

**Existing fee-display fork in the calendar** already gates on `isFeeAccount` (the 4 MLB accounts), so most surfaces have a fee branch already - they just don't yet hide the dollar fields. Specifically:

- Fee year card already shows `N HS` (homestand count) instead of dollars (`ServiceCalendar.js:1028-1034`). Already correct - no $ figure.
- Fee year banner already shows `X of Y game days recorded + Z meals recorded YTD` (lines 866-870). No $ figure. Already correct.
- Fee month-view metrics already lead with Homestand + Game days + Meals delivered (`:556-580`). No $ figure. Already correct.
- Fee month-view tiles show `vs OPP + HSx + N meals` (`:723-732`). No $ figure. Already correct.
- Fee month-footer shows `gameDaysEntered/gameDays game days this month` (`:837-838`). No $ figure. Already correct.

**The 4 MLB fee accounts are already operational-only on the calendar.** Bundle 1's Part A "fee accounts go operational-only" is already done for them.

**STL-FL is the gap.** STL-FL's `isFeeAccount` is FALSE today because the gate requires `billing_model='flat_fee' AND !!homestandMap`, and STL-FL has zero homestand rows. So STL-FL falls through to per-meal display - which shows $0 revenue everywhere (because all its prices are $0). This is the same end result (no real $ figure) but for the wrong reason. See Part D for the STL-FL promotion mechanic.

---

## PART B - backdate mode

### B.1 What blocks a past date today

**Route validation** at `route.js:506-525`:

```js
const today = new Date().toISOString().slice(0, 10);
const yesterday = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
})();
for (const c of changes) {
  if (c.type !== "price") continue;
  if (!c.effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(c.effectiveDate)) {
    return NextResponse.json(
      { success: false, error: "effectiveDate required on price changes (YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  if (c.effectiveDate < yesterday) {
    return NextResponse.json(
      { success: false, error: "effectiveDate must be today or future (backdate is not supported in this stage)" },
      { status: 400 }
    );
  }
```

**PriceEditPanel UI** at `PriceEditPanel.js:55-79`:

```js
const [effMode, setEffMode] = useState("today");   // "today" | "future"
const [futureDate, setFutureDate] = useState("");
const today = useMemo(() => localToday(), []);
const tomorrow = useMemo(() => localTomorrow(), []);
const effDate = effMode === "today" ? today : futureDate;
const effReady = effMode === "today" || (effMode === "future" && /^\d{4}-\d{2}-\d{2}$/.test(futureDate) && futureDate >= tomorrow);
```

The Future date picker has `min={tomorrow}` (line 171) so the UI can't even pick a past date.

### B.2 What enabling backdate touches

**Code-side changes needed:**

1. **Route validation**: relax the `c.effectiveDate < yesterday` check (route.js:520). Either drop it entirely (the UI is the backstop) or accept any valid YYYY-MM-DD. Per locked architecture, backdate is a fenced 3rd mode - so keep some validation: format check stays, but the date range guard drops.

2. **PriceEditPanel UI**: add a 3rd radio "Backdate" with its own past-date picker (`max={yesterday}`), and a clear warning block listing the date range that would recompute. New state branch in `effMode`.

3. **Orchestrator + view: NO change needed.** The orchestrator's price upsert (`serviceCalendar.js:1163-1172`) uses `effective_date: ch.effectiveDate || today` and an `onConflict: "service_id,effective_date"` upsert - a past date inserts a NEW dated row exactly the same as a future date. The view's LATERAL pick then recomputes any service-date >= the backdate row's effective_date the next time the view is queried. **The backend already handles backdate correctly.**

4. **Changelog**: already takes `effective_date` (sc-4-config-changelog.sql:46) and `change_type='update'`. Audit row writes correctly with the past date. **No change.**

**Bundle 1 backdate is purely a UI gate + route validation relax.** Mechanically it's small. The risk surface is in the warning UX (B.3-B.4), not the code change.

### B.3 The danger surface (what backdate silently moves)

**Recompute is live, via the view.** A backdated price row instantly changes every `sc_daily_revenue` row whose `service_date >= effective_date` for that service. Nothing is cached; nothing is frozen.

Surfaces that re-derive from the view (will reflect the new price for past days as soon as they're rendered):

- **Year-card rev** (`actualRevenue`/`projectedRevenue` from `sc_month_summary`): retroactively updates. Past months that were "closed" visually re-shift.
- **Year-banner `meals YTD`**: meal counts are unchanged (backdate is a price change, not a count change). YTD dollar isn't displayed on the banner today, so no visible change there.
- **Month-view metrics + tiles + week + footer**: AFTER Part A swap, all surfaces re-derive from the view, including the past-month rev figures.
- **The new `sc_config_changelog` entry**: records the change with `old_value`, `new_value`, `effective_date`, `reason`, `requested_by` - a permanent record of the backdate.

What does NOT re-derive (immutable downstream):
- **Invoices**: none exist as a structured artifact in this codebase. The intranet doesn't produce invoices today; the SC tool tracks data that feeds invoicing OUTSIDE the app.
- **Exports**: `grep "export\|csv\|pdf"` in src/app/api/service-calendar/route.js: no export endpoints. Anything exported manually (xlsx, PDF) is its own external artifact - immutable to a DB change, but only because it left the system.
- **The `sc_daily_actuals_history` audit trail**: captures `actual_count` changes, NOT prices. A backdate doesn't touch actuals so this table is unaffected.

**Net: a backdate retroactively reshapes every revenue-reporting surface that reads `sc_daily_revenue` or `sc_month_summary`. The fee schedule (Bundle 1 Part C) is NOT affected** (it has its own table; calendar revenue doesn't feed it).

### B.4 The "closed day" concept

**There is no formal Close Day mechanic in the data or code today.** Grep for "closed" / "Close Day" / "lock" / "closed_at" in src/app/service-calendar and src/lib/dataStore:

- `LOCK_DAYS = 7` constant (`serviceCalendar.js:73`) - drives the `isLocked` boolean returned with each day. Used only for status classification ("overdue" = past + locked, no actuals). **Locked does NOT mean closed/invoiced.** It means "operator entry window has passed."
- The dayContext helper at `serviceCalendar.js:104-116` computes `isPast` + `isLocked` from the LOCK_DAYS threshold.
- No "frozen month" flag, no `closed_at` column, no anti-edit gate beyond the LOCK_DAYS warning surface.

Operationally, "closed" today = "the operator already invoiced this period externally, based on what the calendar showed at the time." The calendar has no awareness of when that happened.

**Implication for the backdate warning copy:** the UI can name the date range that recomputes (`Backdating to YYYY-MM-DD will recompute N service days from that date forward`), but it CAN'T say "X of those days were already invoiced" because the system doesn't know. The warning should:

- State the date range that recomputes (calculable from `effective_date` to today).
- State that the change is permanent (audited in the changelog) and reversible only by another change (insert a corrective dated row).
- Require an explicit reason (already required from Stage 2 - reinforce it for backdate).
- **NOT promise that downstream invoices will be re-issued.** That's a human task outside the system.

### B.5 Recommended backdate-fence UX

- **Radio**: `Today / Future date / Backdate`. Backdate gets its own past-date picker with `max={today_minus_1}`.
- **Warning block** (only visible when Backdate selected): "Backdating to {date} will recompute {N} service days from that date forward. Days that were already invoiced will NOT be auto-adjusted on the invoice; the change is recorded in the change log only."
- **Reason field**: already required for all changes. For backdate, recommend bumping the placeholder text from "Why is this price changing?" to "Why is this price being applied to past dates?" - same field, different prompt.
- **Confirmation friction**: a second confirm step (single dialog "I understand this changes historical revenue for {N} days. Proceed?") since Save -> save-in-place flow today is one-click. Cheap to add, meaningful for the fenced sharp edge.
- **Server-side**: the validation relax should still keep the format check (`^\d{4}-\d{2}-\d{2}$`) and the reason-required check. Just drop the `< yesterday` rejection.

---

## PART C - fee schedule (contract-revenue layer)

### C.1 Live confirmed: no fee table exists

```
sc_fee_schedule:  NOT FOUND
fee_schedule:     NOT FOUND
sc_flat_fees:     NOT FOUND
sc_annual_fees:   NOT FOUND
sc_contract_fees: NOT FOUND
```

### C.2 Pattern to mirror

**`sc_service_prices`** (sc-1:127-148) is the effective-dated value pattern. Key elements:
- UUID PK, `service_id` FK, `price NUMERIC(12,5)`, `effective_date DATE NOT NULL`, `created_by TEXT NOT NULL`, `created_at`, `notes`.
- `UNIQUE (service_id, effective_date)` - prevents two rows for the same (entity, date).
- Index `(service_id, effective_date DESC)` for the LATERAL pick.
- View's LATERAL: `WHERE service_id = ... AND effective_date <= ... ORDER BY effective_date DESC LIMIT 1` (sc-1b:95-102).

**`sc_config_changelog`** (sc-4:32-66) has the audit pattern. Key for Bundle 1:
- `entity_type` already includes `'fee'` in the CHECK (sc-4:43). **Drop-in ready for fee writes.**
- `change_type` already includes `'create'` and `'update'` (sc-4:48). Same.
- `reason TEXT NOT NULL CHECK (length(trim(reason)) > 0 AND length(reason) <= 280)`. Same as prices.
- `requested_by`, `changed_by`, `changed_at`, `old_value JSONB`, `new_value JSONB`, `effective_date DATE`. Same.

**For the fee orchestrator code: mirror `updateServiceConfig`'s price branch** (`serviceCalendar.js:1158-1196`). Read the prior as-of-today fee for `old_value`, upsert the new dated row, write the changelog row with `entity_type='fee'`. The same upsert-and-changelog atomicity (changelog insert fails -> whole op fails) applies.

### C.3 Proposed fee-table DDL

Migration file: `sc-5-fee-schedule.sql` (continues the `sc-N-*` numbering). Patterns match sc-1 (UUID default, account_key regex, RLS-disabled, GRANT to service_role).

```sql
-- ═══════════════════════════════════════════════════════════════════
-- sc-5-fee-schedule.sql
-- Service Calendar - contract fee schedule (Module SC, Bundle 5)
--
-- Effective-dated fee amounts per account. The contract-revenue layer's
-- backbone. Lives in the admin; read by the future KPI dashboard.
-- The Service Calendar does NOT consume this table - operational
-- meal tracking stays in sc_daily_revenue, billed revenue lives here.
--
-- Pattern mirrors sc_service_prices: a fee change is a NEW dated row,
-- never an overwrite. The current fee for an account is the row with
-- the largest effective_date <= today. (Apply this with a LATERAL pick
-- when the KPI dashboard reads it; no view created at this stage.)
--
-- Apply in Supabase Studio. Verify via probe before code merges.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sc_fee_schedule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key     TEXT NOT NULL CHECK (
                    account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$'
                    OR account_key = 'CORP'
                  ),
  fee_amount      NUMERIC(12,2) NOT NULL CHECK (fee_amount >= 0),
  effective_date  DATE NOT NULL,
  -- Period type covers what the fee is for. 'annual' for now; future
  -- bundles may add 'monthly', 'quarterly', 'season'. Constrained so
  -- writers don't drift.
  period_type     TEXT NOT NULL DEFAULT 'annual' CHECK (
                    period_type IN ('annual')
                  ),
  -- Informational only - the operator's mental model of how the
  -- annual fee gets paid. The KPI dashboard can surface this for
  -- "next installment due X" but it does NOT drive any compute.
  payment_cadence TEXT CHECK (
                    payment_cadence IS NULL
                    OR payment_cadence IN ('monthly-6', 'monthly-7', 'quarterly', 'annual')
                  ),
  -- For TXR-TX-V: marker that the fee is bundled into another
  -- account's contract. A $0 fee with covered_by_account_key set
  -- means "do not bill separately; the named account carries the
  -- contract." Lets the KPI dashboard avoid double-counting.
  covered_by_account_key TEXT,
  notes           TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_sc_fee_schedule_account_date
    UNIQUE (account_key, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_sc_fee_schedule_lookup
  ON sc_fee_schedule (account_key, effective_date DESC);

COMMENT ON TABLE sc_fee_schedule IS
  'Contract fee amounts per account, effective-dated. Mirrors sc_service_prices: '
  'a fee change is a new dated row, never an overwrite. The Service Calendar '
  'does NOT consume this table; the future KPI dashboard does. Audited via '
  'sc_config_changelog (entity_type=fee).';

ALTER TABLE sc_fee_schedule DISABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════
-- GRANTs - mirror sc_service_prices full-CRUD (admin can update / delete
-- dated rows directly if needed; the changelog captures every write).
-- Tighter SELECT+INSERT only would be possible but would prevent a quick
-- correction of a typo in the same-day window without a fix-up row.
-- ═══════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
  ON sc_fee_schedule TO service_role;
GRANT REFERENCES, TRIGGER, TRUNCATE ON sc_fee_schedule TO anon, authenticated;
```

**NOT NULL hazards / no-default columns to watch on INSERT:**
- `account_key`, `fee_amount`, `effective_date`, `created_by` - all NOT NULL no-default. Required on every insert. The orchestrator must always supply them.
- `period_type` - NOT NULL but has DEFAULT 'annual'. Safe to omit.
- `payment_cadence`, `covered_by_account_key`, `notes` - nullable. Safe to omit.

**Why I picked full-CRUD instead of tighter SELECT+INSERT** (the changelog uses tight grants): the changelog is the audit table; data integrity for the *fees themselves* lives in the changelog, not in restricting writes on the fee table. The fee table is the "current state" surface; if an admin types $362,500 instead of $326,500, allowing an UPDATE in the same-day cadence (mirroring the price upsert-by-same-date behavior) keeps the UX consistent. Justifying inline in the SQL comment.

### C.4 Fee data reaches the future KPI dashboard, NOT the calendar

**Confirm: nothing in the Service Calendar reads `sc_fee_schedule`.** No surface in `ServiceCalendar.js`, `loadAccountConfig`, `loadMonthData`, `loadYearSummary`, `sc_daily_revenue`, or `sc_month_summary` touches it.

**Standalone read pattern**: add a new orchestrator fn `loadFeeSchedule({ accountKey?, asOfDate? })` that does the LATERAL pick (latest row per account where `effective_date <= asOfDate`). The KPI dashboard (later build) will consume it; nothing in Bundle 1 does. **Do NOT fold fee revenue into `sc_daily_revenue` or `sc_month_summary`.** That preserves the locked architecture: per-meal/operational view stays per-meal; contract revenue stays separate.

### C.5 Admin section IA + new actions

**Slots into the existing admin shell** (`AdminClient.js` from Stage 2). Today the shell has 2 states: `view === "overview"` and `view === "account"`. For Bundle 1 add a 3rd top-level view `"fees"`:

```
/service-calendar/admin
  ├ overview (existing)
  ├ <account>/editor (existing - per-account prices)
  └ fees (NEW - flat list of fee accounts + per-account fee editor)
```

The admin landing keeps the per-meal overview. A nav element (link or button) in the existing shell switches to the `fees` view. The fees view shows:
- 5 fee accounts (4 MLB + STL-FL after Part D promotion). TXR-TX-V appears with a `covered by H` badge instead of an editable amount.
- Each row: account key + name + level chip + current fee + since-date.
- Click a row -> per-account fee editor inline (mirrors PriceEditPanel.js).
- Edit panel: new fee amount, effective date (Today / Future date - backdate becomes available once Part B lands), required reason, optional requested-by.

**New action-dispatch actions** in `src/app/api/service-calendar/route.js` (action-dispatch per CONVENTIONS.md):

| Action | Method | Body / Query | Purpose |
|---|---|---|---|
| `sc-admin-fee-list` | GET | none | Returns all 5 fee accounts' current fee + history (each account's full dated rows). Gated `isScAdmin`. |
| `sc-admin-fee-set` | POST | `{accountKey, feeAmount, effectiveDate, reason, requestedBy?}` | Insert a new dated fee row + changelog row. Gated `isScAdmin`. |

Following the price-editor pattern: validation in the route (`effectiveDate` format, `reason` non-empty + 280 cap, fee_amount >= 0). The 1-day-grace floor on backdate stays consistent with the prices flow.

### C.6 TXR-TX-V handling: "bundled / covered"

**Recommendation: `covered_by_account_key` column on `sc_fee_schedule`.** A row for TXR-TX-V with `fee_amount = 0` and `covered_by_account_key = 'TXR - TX - H'` means "this account is contractually bundled into TXR-TX-H; don't bill separately." The admin UI shows the field instead of an editable amount; the KPI dashboard sums `fee_amount` and TXR-TX-V contributes $0 by data, with the `covered_by` field giving the human-readable reason.

**Why this over a separate flag or a foreign-key reference:**
- A flag (`is_bundled BOOLEAN`) doesn't say WHICH account covers it. The KPI dashboard needs to know to avoid surfacing TXR-TX-V as "$0 - missing data."
- A FK to another fee_schedule row is over-engineered for one TXR-TX-V edge case.
- A nullable TEXT column with the parent account_key is light, self-documenting, and matches the rest of the schema's TEXT-keyed pattern.

Bonus: if a future audit shows a different relationship pattern (e.g. STL-FL is an amendment to STL-MO), the column is reusable without schema change.

---

## PART D - STL-FL promotion

### D.1 Current state (live confirmed)

```
account: STL - FL
  level: PDC
  billing_model: flat_fee
  region: East
sc_homestand_schedule rows: 0
sc_services (not deleted, active=true): 11
  - 10 per-meal services (Breakfast, Lunch, Snack, Pre-game, Post-Game, etc.)
  - 1 flat-fee non-revenue service ("Fun Money allocation")
All 11 services priced $0.00 effective 2026-06-16.
```

The 11 services include duplicates (`Breakfast - ST` appears twice, `Lunch - ST` appears twice) - likely a seed quirk. Out of scope; flagged for Kevin.

### D.2 Admin overview promotion mechanic

**Current filter** at `AccountsOverview.js:76`:
```js
const isFee = (a) => a.billingModel === "flat_fee" && String(a.level || "").toUpperCase() === "MLB";
```

STL-FL is `flat_fee + PDC` -> excluded from the fee group today.

**Cleanest promotion: drop the `level === "MLB"` clause.** With it dropped, the filter becomes simply `billingModel === "flat_fee"`. STL-FL joins CIN-OH / STL-MO / TXR-TX-H / TXR-TX-V in the fee group. No new flag, no new column, no special-case for STL-FL.

**Does this break the MLB-fee detection?** No - the only purpose of the filter is to populate the "Fee accounts" section in the admin overview. Removing the MLB constraint just adds STL-FL to that list. STL-FL gets the same "Fee schedule coming soon" caption (which Bundle 1's Part C UI replaces with the actual fee schedule entry).

**What stays unchanged for STL-FL:**
- `level='PDC'` (correct per geography; the Cardinals' Jupiter complex is PDC operationally).
- `billing_model='flat_fee'` (correct per contract).
- Operators can still enter per-meal actuals (the calendar's `isFeeAccount` gate keeps STL-FL on per-meal display because `homestandMap` is empty - per Part A.6, this is fine post-Bundle-1 since fee accounts show no dollar figure anyway and the per-meal display is fundamentally an operational tracker).

### D.3 Critical grep: STL-FL references that key off PDC-level or per-meal

```
src/lib/dataStore/serviceCalendar.js:515 (comment)
  "STL-FL is flat_fee but has zero homestand rows; homestandMap is empty for
   it and classify() falls back to the per-meal path."
   -> The behavior described continues. Operators see per-meal display.
      No code change needed here; the comment stays accurate.

src/lib/dataStore/serviceCalendar.js:613, 623, 648, 650, 655, 692 (gates)
  All gate on `billingModel === "flat_fee" && hasHomestandData`. STL-FL has
  empty homestandMap, so it stays on the per-meal branch. No code change.
  Same as today.

src/app/service-calendar/ServiceCalendar.js:191-193 (comment)
  Describes the gate. Comment stays accurate post-promotion.

src/app/service-calendar/ServiceCalendar.js:200-202 (the isFeeAccount gate)
  Same logic. STL-FL stays per-meal-display because homestandMap is empty.

src/app/api/service-calendar/route.js:286-299 (comment + skip)
  Skips fetching homestand context for STL-FL. Stays correct.

src/lib/incidentSchema.js:141 (label only)
src/lib/stampInvoice.js:37 (account code parsing)
src/lib/drive.js:53 (account code parsing)
src/lib/dataStore/invoice.js:150 (account code mapping)
  None of these are revenue logic. No impact.

src/app/service-calendar/admin/AccountsOverview.js:76 (filter)
  The ONE site that needs adjustment per D.2.
```

**Net: one file, one line.** Drop `&& level === "MLB"` from the admin overview's `isFee` predicate. Everything else holds.

### D.4 STL-FL's $0 per-meal services - disposition

Recommend: **leave-active, do not deactivate.** Reasoning:

- Per the never-hard-delete rule, deactivation would NOT delete the rows - just flip `active=false`. So data preservation is the same either way.
- Keeping them active lets operators continue entering actuals at $0 prices for operational tracking (meal counts). This is internal data, not billing - per the locked architecture, fee accounts track ops, not dollars.
- Deactivating them would HIDE them from the per-meal editor + the day-detail entry form. Then operators couldn't log STL-FL meal counts, which would silently kill the operational tracking that Kevin's spec says should continue.
- The calendar's per-meal display for STL-FL will show $0 revenue figures via the current per-meal path. After Part A's swap the figures are correct against the view (also $0). The display reads "0 meals × $0 = $0" - benign noise. UX polish (suppressing $0 figures on fee accounts) can come later as a separate ticket.

If Kevin wants STL-FL to feel like a fee account in the calendar UI (no $0 figures showing): that's a separate piece - extending the `isFeeAccount` calendar gate to recognize STL-FL via a non-homestand path. Possible later, not required for Bundle 1.

---

## PART E - bundle mechanics + safety + sequence

### E.1 Migration sequence (`sc-5-fee-schedule.sql` only)

- One additive migration. No view recreate. No `DROP VIEW` cascade.
- NOT NULL no-default columns: `account_key`, `fee_amount`, `effective_date`, `created_by`. Listed in C.3.
- Apply-in-Studio-first + verify-probe pattern, per the 2026-06-12 silent-gap incident rule (CLAUDE.md Danger Zone).
- Verify probe should confirm:
  - Table exists, SELECT works.
  - 6 expected columns: `id, account_key, fee_amount, effective_date, period_type, payment_cadence, covered_by_account_key, notes, created_by, created_at` (10 columns total).
  - CHECK constraints fire: bad `account_key` regex, negative `fee_amount`, bad `period_type`, bad `payment_cadence`.
  - GRANT pattern: service_role can SELECT + INSERT + UPDATE + DELETE.
- Mirror `_probe-sc-4-changelog-verify.mjs` structure for naming + flow.

### E.2 Confirmed: NO view recreate required for Bundle 1

The calendar accuracy swap (Part A) is a route-payload change + a JS-side compute swap. **No DDL.**

The fee schedule (Part C) adds `sc_fee_schedule` table but does NOT touch `sc_daily_revenue` or `sc_month_summary`. The fee table is a standalone read source for the future KPI dashboard. **No view change.**

The backdate mode (Part B) is route validation relax + UI mode addition. **No DDL.**

The STL-FL promotion (Part D) is one line in `AccountsOverview.js`. **No DDL.**

**If at any point Bundle 1 implementation grows to require a view recreate, that's a Loud Stop. The whole point of the locked architecture is that the fee schedule lives next to, not inside, the view stack.**

### E.3 Conventions

- **Action dispatch**: `sc-admin-fee-list` (GET), `sc-admin-fee-set` (POST). Hyphenated lowercase per CONVENTIONS.md:31. Add to existing `src/app/api/service-calendar/route.js`; do NOT create a sub-route. Gated `isScAdmin` server-side.
- **CSS prefix**: `sc-admin-` for fee section (reuses Stage 2 admin prefix). Add to `ops-sc-admin.css`. Brand navy `#153968` + brand green `#0F6E56` only.
- **GOTCHAS to apply to Bundle 1**:
  - **UTC date trap** (GOTCHAS.md:105-121, also flagged in Stage 2 recon): `effectiveDate` for fees must be computed client-side from the operator's local clock, sent explicitly. Same pattern as PriceEditPanel.js.
  - **Pagination** (GOTCHAS-implied via `fetchAllPaginated`): fee table is bounded at ~5 accounts × N dated rows. No pagination concern for Bundle 1.
  - **Route-rename footgun** (handoff doc; covered in prior SC handoffs): the route should NOT rename orchestrator field names for the new fee actions. Pass `feeAmount` / `effectiveDate` / `reason` through to the orchestrator with the same names.
  - **Currency from Sheets** (GOTCHAS.md:12): not relevant - fee schedule is PG-direct, no Sheets path.
  - **str_replace whitespace** (GOTCHAS.md:192): build mechanics. CC-specific.

### E.4 Internal build sequence

**Kevin's proposed order: (A) calendar reads the view + fee accounts go operational-only; (B) fee schedule admin section + migration / Part D; (C) backdate mode.**

**My recommendation: keep this order.** Reasoning:

1. **Part A (calendar accuracy) first.** It's the accuracy backbone - if a mid-period price change exists (and one does, the Stage 2 test edit), the calendar is currently lying about past-day revenue. Fix this before anything else, because Part B's backdate mode RELIES on the view being the truth (otherwise a backdated price wouldn't visibly flow to revenue). Part A is a route + JS swap, low blast radius.

2. **Part C (fee schedule) + D (STL-FL promotion) second.** Independent from A; one migration; one new admin section. STL-FL's promotion is a single-line change in the admin overview, lands naturally with the fee section. The migration is the apply-in-Studio-first step that gates the code merge.

3. **Part B (backdate) last.** Independent from A and C. The route + UI changes touch the price editor only. The warning UX is the highest-care item; do it after A so backdated changes correctly reflow to the calendar (per E.2 they already would, but doing A first makes the warning copy true: "this WILL reflow your calendar's revenue figures for past days").

**Dependency graph:**
- A is independent.
- C is independent.
- D depends on C (the fee schedule UI is where STL-FL needs to appear; the overview filter change is meaningless without the fee section to put STL-FL in).
- B is independent.

**Could B/C/D run in parallel?** Yes, technically. But sequencing as Kevin proposed gives reviewable PRs that each ship a coherent piece. Recommend keeping it sequential.

---

## Gaps - needs live verification in Supabase Studio

1. **`SC_CONTRACT_BILLING_SUMMARY.md` "RESOLVED BILLING DECISIONS" banner.** Not present on `cb89fd7`. Confirm with Kevin whether to wait for the banner before Chat-Claude writes the build prompt, or proceed using the Part C locked values.

2. **STL-FL service duplicates.** `Breakfast - ST` and `Lunch - ST` each appear twice in `sc_services` for STL-FL. Either a seed quirk or two distinct services with identical names. Probably benign (both priced $0) but worth a Studio look + cleanup decision.

3. **`sc_config_changelog` audit-integrity post-Bundle-1.** Bundle 1's `sc-admin-fee-set` will write changelog rows with `entity_type='fee'`. The changelog's tight SELECT+INSERT GRANT (sc-4:74) means the orchestrator can never UPDATE a fee changelog row. Verify the fee orchestrator code does NOT need to update any changelog row mid-operation; if it did, the operation would fail. Expected: same atomicity as price changes - insert row + done. Confirm at code-review time.

4. **Whether any sc_services in production have `is_flat_fee=TRUE` AND a non-zero price.** The view treats those as normal per-meal revenue (count × price). Live probe shows 16 such services across 5 accounts (CIN-AZ 2, STL-FL 1, TBJ-FL 1, TBR-FL 8, TXR-AZ 4). These are services like "Coffee Service $450/week" - the price is the weekly rate, multiplied by `count` (number of weeks?) gives revenue. **Is this semantically correct in the view?** Out of scope for Bundle 1 (not a fee-account question), but flag for product when the operational accuracy review happens.

5. **Backdate behavior on a price that's already been "consumed" by exported invoices.** Out of system today, but a Bundle 1 future-stage consideration. The warning UX (B.5) names this risk; the system can't enforce against it because invoices don't live in the app.

---

## Riskiest part of Bundle 1 - my read

**The transformDays payload change.** It is mechanically small (15-25 lines in `route.js`) but it's the load-bearing change for the entire month view's accuracy. Two specific risk vectors:

1. **Wire format drift**: every client surface that reads `data.days[i].projected[serviceId]` or `data.days[i].actual[serviceId]` (the count maps) must keep working OR be migrated to the new revenue-bearing shape. If the transformDays change adds new fields but ALSO renames or drops the count maps, the calendar's `metrics` useMemo + month-view tile rendering + DayDetail's input form all break simultaneously. **Safest path: ADD the new fields, do NOT rename or remove the existing ones, swap the consumers one surface at a time.** Then a follow-up PR drops the now-unused count maps.

2. **Identity check between view-computed and JS-computed revenue at swap time.** When Part A lands, every revenue figure on the screen shifts by exactly the price-drift amount. For accounts without future-or-past-dated prices (i.e. only the 2026-01-01 seed row), the swap is silent (price is the same on every day). For accounts WITH multiple dated rows - the 53 of 105 services per the prior recon - the swap visibly moves the numbers. **A pre-merge sanity check: compute the view's `sc_month_summary.total_actual_revenue` for a few sample (account, month) pairs and compare to the JS-side compute on the preview deploy.** Where they diverge, that's the fix landing correctly. Where they unexpectedly agree, the swap may not have wired through.

**The backdate UX is the second-riskiest** (a wrong warning copy could mislead Kevin and Joe into making changes they don't realize reshape past-period revenue), but the code change itself is small. The fee schedule + STL-FL promotion are low-risk additive changes.

End of report.

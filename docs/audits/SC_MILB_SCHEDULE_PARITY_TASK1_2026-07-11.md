# SC MiLB schedule parity - Task 1 investigation + gating recommendation

Date: 2026-07-11
Scope: read-only investigation. Verifies account_keys, maps the current gate, chooses the schedule-accounts gating shape.
Bundle: Louisville Bats + Buffalo Bisons full-parity schedule (Path A).

## Verified facts

### Account keys (both AAA, both per-meal)

| Account         | account_key   | level | billing_model          | home tz             | ET label |
|-----------------|---------------|-------|------------------------|---------------------|----------|
| Louisville Bats | `CIN - KY`    | AAA   | `actuals_drive_invoice`| America/New_York    | ET       |
| Buffalo Bisons  | `TBJ - NY`    | AAA   | `actuals_drive_invoice`| America/New_York    | ET       |

Verified against `docs/archive/migration/SHEETS_AUDIT_DATA_SIDE.md` (archived 2026-07-17), `docs/SC_ADMIN_RECON_REPORT.md`, `docs/SC_SPREADSHEET_MAPPING.md`, and `src/lib/dataStore/invoice.js`. Both use the same spaced-hyphen convention as the MLB fee accounts.

Neither is in the current `sc_homestand_schedule` table (loader gates on `billing_model = 'flat_fee'`).

### `accounts` table live columns
Per `docs/SC_ADMIN_RECON_REPORT.md` §H: `active, address, billing_model, city, created_at, drive_url, gmap_url, homestand_url, stadium_header_url, stadium_name, state, team_key, timezone, updated_at` (+ more). The DDL is not in this repo (predates the SC bundle). Notably: `has_homestand_schedule` does NOT exist yet; `timezone` DOES exist (not used by the reader today).

### Current gate (three call sites, all identical shape)
1. `src/lib/dataStore/serviceCalendar.js:720` (`loadMonthDataPostgres`)
2. `src/lib/dataStore/serviceCalendar.js:957` (`loadYearSummaryPostgres`)
3. `src/app/api/service-calendar/route.js:411` (response payload assembly)

All read `billing_model` for the account, then:
```js
if (billingModel === "flat_fee") {
  homestandMap = await loadHomestandContext(accountKey, first, last);
}
```

`STL - FL` is `flat_fee` but has zero schedule rows, so the loader fires against it and returns `{}` (harmless, one wasted query).

### Other `billing_model === 'flat_fee'` uses (NOT the schedule gate)
- `classifyDayStatus` (fee-account classify branch, dataStore serviceCalendar.js:210 and :244)
- `resolveDayKind` (dayResolvers.js:99, drives the `fee-no-dollar` fallback for STL-FL)
- `resolveDayKind` (dayResolvers.js:98, `hasHomestandSchedule` alone routes to `mlb-fee`)
- `AccountsOverview.js:80` (admin `isFee` filter)
- `ServiceCalendar.js:1001` (`isFeeAccount`)

These are REVENUE-SHAPE concerns (fee vs per-meal), not SCHEDULE-PRESENCE concerns. They must not change for CIN-KY / TBJ-NY (both still per-meal financially).

### Current MiLB day/night + game_time source (Louisville/Buffalo today)
- `game_type` TEXT on `sc_day_metadata` (manually entered by operators) is parsed for "day"/"night" in `PeriodWorkspace.js:905`.
- `game_time` TEXT on `sc_day_metadata` (manually entered) is cleaned by `formatMilbHomeGameTime()` (strips AM/PM).
- No home/away tracking. AWAY = absence of projections (blank tile).

### Current UI `hasHomestandSchedule` prop
Derived at `ServiceCalendar.js:1002` from `!!data?.homestandMap` (server-side response). Threaded through `SeasonShell`, `PeriodWorkspace`, `PeriodCard`, `StateLegend`, `LegendInfoPopup`, `legendItems.js`, `resolveDayKind`. `resolveDayKind` currently returns `"mlb-fee"` from this flag alone - which would route CIN-KY / TBJ-NY into the mlb-fee (no-$) render if they got the flag naively.

## Recommendation - Path A: `has_homestand_schedule BOOLEAN` on `accounts`

The two options in the brief are functionally similar for these two clubs, but they diverge on future maintenance:

| Option                                 | Add another club later                    | Coupling                                                   |
|----------------------------------------|-------------------------------------------|------------------------------------------------------------|
| **A. `has_homestand_schedule` flag**   | Flip the flag in Studio                   | Orthogonal to billing_model. Data-driven.                  |
| B. Widen gate to allowlist / bm-union  | Edit code (3 call sites) + ship + deploy  | Ties schedule presence to billing enum. Hardcoded list.    |

**Recommend Option A.** Reasons:
1. **Orthogonal semantics.** "Has a schedule" is not the same as "is fee-billed." STL-FL (flat_fee, no schedule) already proves the two axes are independent. Locking them together is drift-prone.
2. **Data-driven scaling.** Adding Toledo, Nashville, Sugar Land later = one Studio update, no code deploy.
3. **Grep-clean.** The reader keeps a single conceptual flag (`hasHomestandSchedule`) with the same name it already uses in the UI.
4. **Fits the SC recon note.** `docs/SC_ADMIN_RECON_REPORT.md:497` already suggests `has_homestand_schedule` as the correct fee-editor gate (a separate concern - same signal).

### Downstream implications (all still in-scope for the bundle)
- **Gate migration** (Task 2 territory): 3 call sites change from `billingModel === "flat_fee"` to reading `has_homestand_schedule` (Task 4). Backwards-compatible for the 4 MLB fee accounts (flag=true), STL-FL (flag=false, previously fired an empty query - now skips it), MiLB (flag=true for CIN-KY/TBJ-NY, false for the rest - previously never queried at all).
- **`resolveDayKind` fix**: needs a two-signal check for `mlb-fee` (avoid MiLB-with-schedule falling into the no-$ render).
  ```js
  if (hasHomestandSchedule && billingModel === "flat_fee") return "mlb-fee";
  if (billingModel === "flat_fee") return "fee-no-dollar"; // STL-FL
  if (category === "MiLB") return "milb";                  // MiLB, incl. Louisville/Buffalo
  return "per-meal";
  ```
  Louisville/Buffalo stay in the `milb` render (per-meal financials preserved) and pick up opponent/dayNight/gameTime from `homestandMap`.
- **`classifyDayStatus` AWAY routing** (per-meal branch): needs a lookup for `hs?.dayType === "AWAY"` in the per-meal branch when the account has schedule data. Otherwise Louisville/Buffalo AWAY days won't route to the "away" status (teal tile). One-line addition ahead of the per-meal defaults.
- **`buildLargeContent` milb branch**: widens to read `homestandMap[day.date]` for `opponent`, `dayNight`, and `pillTime`. Precedence: schedule wins; falls back to `game_type` text and `formatMilbHomeGameTime()` when the schedule row is missing (defensive, and preserves the render for any MiLB account NOT in the schedule).
- **`gameTimeFormat.js`**: extend `ACCOUNT_HOME_TZ` with two entries (both America/New_York, "ET").

### Implementation shape for the flag
```sql
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS has_homestand_schedule BOOLEAN NOT NULL DEFAULT false;

UPDATE accounts
   SET has_homestand_schedule = true
 WHERE team_key IN (
   'CIN - OH',      -- Cincinnati Reds (MLB, flat_fee)
   'STL - MO',      -- St. Louis Cardinals (MLB, flat_fee)
   'TXR - TX - H',  -- Texas Rangers home (MLB, flat_fee)
   'TXR - TX - V',  -- Texas Rangers visitor (MLB, flat_fee)
   'CIN - KY',      -- Louisville Bats (MiLB, actuals_drive_invoice)  -- NEW
   'TBJ - NY'       -- Buffalo Bisons  (MiLB, actuals_drive_invoice)  -- NEW
 );
```

## Next step - Task 2 unblocked

Task 2 migration will:
- Add `accounts.has_homestand_schedule` + set TRUE for the 6 accounts above.
- Add `sc_homestand_schedule.is_doubleheader BOOLEAN NOT NULL DEFAULT false` (per brief ruling 2).
- INSERT the Louisville + Buffalo HOME + AWAY rows produced by the extractor (Task 3) with DH-compression and shadow-preferred handling matching sc-13's pattern.
- Probes: per-club HOME/AWAY counts, day_night coverage on GAME rows, DH-flagged rows, zero-leak on other accounts.

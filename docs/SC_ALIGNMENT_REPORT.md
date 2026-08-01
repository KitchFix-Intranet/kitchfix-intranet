# Service Calendar Alignment Report

**Generated:** 2026-07-17 by Claude Code (read-only synthesis).
**Purpose:** single, code-grounded synthesis for the Stage-4 design director (the fresh Chat-Claude). Every non-obvious claim cites a `file:line` (code) or `DOC.md §section` (doc). Where code and doc disagree, code wins and the doc is flagged in §9 as drift.
**Base branch:** `docs/sc-alignment-report` off `origin/main` at `ab2452e` (Merge PR #449).

---

## Table of contents

1. [What the SC is](#1-what-the-sc-is)
2. [Inception to current state](#2-inception-to-current-state)
3. [Defining characteristics](#3-defining-characteristics)
4. [How the engine works (data flow, end to end)](#4-how-the-engine-works-data-flow-end-to-end)
5. [Design decisions and the why](#5-design-decisions-and-the-why)
6. [The money model in operating terms](#6-the-money-model-in-operating-terms)
7. [Landmines / gotchas](#7-landmines--gotchas)
8. [Current state and what's next](#8-current-state-and-whats-next)
9. [Doc-drift flags (P2)](#9-doc-drift-flags-p2)
10. [Open questions / UNKNOWNs](#10-open-questions--unknowns)

---

## 1. What the SC is

The Service Calendar (SC) is the intranet module that tracks per-service meal counts across 11 accounts. Chefs record projections + daily actuals per service; the module computes revenue from actuals x effective-dated per-service prices. **Purpose:** run the meal-count operation on the floor AND feed the billing / P&L layer with truthful per-day counts + revenue.

**User poles** (from `docs/DESIGN_PRINCIPLES.md` §Floor-first + `docs/DESIGN_SYSTEM_REFERENCE.md` §142):
- **Floor chef** (mobile, "38°F walk-in cooler with wet hands"): enters daily actuals, sees projections + recent history. Comfortable density enforced by the <1024px viewport rule.
- **Director** (desktop, triage + admin): year overview, per-account drill, admin panels for prices + fees + catalog lifecycle. Density mode on desktop for SC entry per `DESIGN_SYSTEM_REFERENCE.md:142`.

**Operational problem it solves.** Before SC-on-PG, per-account meal projections + actuals lived across 11 Google Sheets Service Calendar workbooks (one per account). Chefs entered counts into per-day cells; formulas computed revenue at sticker rate; the workbooks were the billing feed. Every price change or SF discount required a spreadsheet edit per account; the "projections" and "actuals" tabs drifted; account files disagreed. The PG-backed SC unified per-service pricing (effective-dated), per-day projections + actuals, and per-account billing shape into one queryable system.

**The 11 accounts** (`docs/modules/SERVICE_CALENDAR.md:32-45`):

| team_key | Entity | Level | billing_model | Homestand? | Overlay? | Rendered kind |
|---|---|---|:-:|:-:|:-:|---|
| CIN - AZ | Cincinnati Reds / Goodyear PDC | PDC | `per_meal` | false | false | per-meal |
| CIN - KY | Louisville Bats | AAA | `actuals_drive_invoice` | **true** | false | mlb-per-meal |
| CIN - OH | Cincinnati Reds / GABP | MLB | `flat_fee` | **true** | false | mlb-fee |
| STL - FL | Cardinals Palm Beach / Jupiter | PDC | `flat_fee` | false | **true** | fee-no-dollar (overlay) |
| STL - MO | Cardinals Busch Stadium | MLB | `flat_fee` | **true** | false | mlb-fee |
| TBJ - FL | Blue Jays Dunedin PDC + Single-A | PDC | `actuals_drive_invoice` | false | **true** | per-meal (overlay) |
| TBJ - NY | Buffalo Bisons | AAA | `actuals_drive_invoice` | **true** | false | mlb-per-meal |
| TBR - FL | Tampa Bay Rays PDC + BGC | PDC | `per_meal` | false | false | per-meal |
| TXR - AZ | Rangers Surprise PDC | PDC | `per_meal` | false | false | per-meal |
| TXR - TX - H | Rangers Globe Life Home | MLB | `flat_fee` | **true** | false | mlb-fee |
| TXR - TX - V | Rangers Globe Life Visiting | MLB | `flat_fee` | **true** | false | mlb-fee |

`billing_model` is the historical shape column; the two BOOLEAN flags `has_homestand_schedule` and `has_schedule_overlay` are orthogonal and gate schedule behavior (see §3).

---

## 2. Inception to current state

Dated arc with PR numbers where discoverable.

### Pre-migration / Sheets era

| Date | Event | Ref |
|---|---|---|
| 2026-03-31 | Service Calendar v1 pushed (Sheets-based module) | commit `0f84fae` |
| 2026-06-12 | Supabase migration project CLOSED; SC identified as "the one genuine migration remaining" | `docs/MIGRATION_PROJECT_CLOSEOUT.md` |
| 2026-06-15 | SC PG cutover decision + Account Services Brief drop | PR #149 (`53cab64`) |

### SC schema landing (sc-1 through sc-19)

| Date | PR | Migration | Adds |
|---|---|---|---|
| 2026-06-15 | #149 | `sc-1` + `sc-1b` | base schema (services / groups / prices / projections / actuals / metadata / actuals_history) + `is_non_revenue` flag |
| 2026-06-17 | no-PR-found | `sc-2` | `sc_homestand_schedule` table + HUB seed |
| 2026-06-17 | no-PR-found | `sc-3` | `user_accounts` seed from contacts |
| 2026-06-18 | #209 | `sc-4` | `sc_config_changelog` (fee + price audit trail) |
| 2026-06-19 | #221 | `sc-5` | `sc_fee_schedule` (5 flat-fee lines) |
| 2026-06-19 | #227 | `sc-6a` | `active_until` DATE column on services + groups (archive mechanism) |
| 2026-06-19 | #229 | `sc-6b` | catalog-aware view recreate honoring `active_until` |
| 2026-06-22 | no-PR-found | `sc-7` | changelog-latest-per-service view |
| 2026-06-24 | no-PR-found | `sc-8a` / `sc-8b` | `price_kind` column (schema) + `actual`-kind price backfill (the double-discount saga; see §7) |
| 2026-07-09 | #368 | `sc-8c` + `sc-9` | rollback of 53 broken `actual` rows + day-note ledger table |
| 2026-07-10 | #381 | `sc-11` | `sc_phase_calendar` (PDC phase blocks) |
| 2026-07-10 | #385 | `sc-12` | MLB schedule reconciliation (PDF truth audit) |
| 2026-07-10 | #389 | `sc-13` | AWAY schedule load + render (`game_pk` column) |
| 2026-07-11 | #393 / #394 | `sc-15` | `game_time TIMESTAMPTZ` + `day_night` + backfill from statsapi |
| 2026-07-11 | #402 | `sc-16` | MiLB schedule parity: CIN-KY + TBJ-NY get homestand rows |
| 2026-07-11 | #403 (reverted #404, relanded #406) | `sc-16` reader | silent-gap incident 2026-07-11: reader merged before Studio-apply; every `accounts` SELECT 500'd until revert. Origin of the migration-gate CI (#416) |
| 2026-07-11 | #410 | `sc-17` | STL-FL home-game overlay (FSL PDC) |
| 2026-07-11 | #411 | `sc-17b` | TBJ-FL Dunedin overlay (FSL PDC) |
| 2026-07-12 | #412 | `sc-18` | game-day corner wedge (sm tiles) |
| 2026-07-12 | #413 | `sc-19` | Spring Training visual (sun-copper wedge + ST pill) |
| 2026-07-14 | #431 | `sc-19b` | date-drift safe subset (schedule-truth audit closeout) |

### SC redesign arc (mid-2026)

Design-review PR waves (from `docs/PROJECT_DASHBOARD.md:18` + spot-checked against `git log main --oneline`):

| Wave | PRs | Outcome |
|---|---|---|
| Foundation redesign | #265-#274 | spec + audit + stage-0..6 sequence (day-square atom, period view, drill wiring, polymorphism, dead-code removal) |
| Design polish arc | #321-#333 | consolidated chrome header, colors data-fix, WAI-ARIA grid, month drill-in un-deprecation, meals-first tiles, exception chips, projection pill, today frame, nav-refresh cluster |
| DayDetail rebuild | #344-#351 | scoreboard header + live total + clubhouse cards + hybrid review/success + tightened rows + Match footer + submission toast + overview polish set |
| SC design audit + journey polish | #353-#363 | 63 audit findings across overview / drill-in / submissions, 2 sev-4 kills, unified money on effective-dated view totals |
| Owner rounds 2-3 | #365-#367 | entered-only header, authored notes ledger, entry-aware homestand classifier, MLB rainout no-service flow |
| Money-model alignment | #368 + sc-8c run | sc-8b double-discount removed; all `actual_revenue` history self-healed via view fallback |
| Cleanup phase | #370-#373 | C3 docs + audit archive; C2 dead reads + CSS tokenization; C1a glyph + format + legend + `<ProgressBar>` extraction; C1b dirty-guard value snapshot + save AbortController |
| Operator Excel export | #374 | 3-sheet workbook (Summary + Daily detail + Notes ledger) |
| F1 History + F2 home account + F3 save-queue resilience | #375, #377, #378 | Activity ledger merge (notes + actuals-edit trail) + role-driven landing + localStorage-backed save queue with backoff |
| P1 trust + polish | (multi-PR) | one completeness rule across cards; top-nav re-runs F2 landing |
| P2 notes UX + F6 phase foundation | (sc-9 + sc-11) | ride-along notes + BY PHASE export |
| PDF schedule export | #419 / #420 / #422 + corrective | 4 sheets (Season / Ops Calendar / drill scope PDF + Excel); MLB + AAA drill live; PDC/PDCO drill PDF PARKED behind Coming Soon |
| Design-review-4-in-1 | #409 | actionable-only counters, legend swatches, chrome drill row Today pill, today date badge pill |
| Nav matrix + Migration gate CI | #407 / #408 / #416 | required status checks on main; `applied in Studio: YES` comment gates migration PRs |

### Pricing certification arc (post-#444)

| Date | PR | Event |
|---|---|---|
| 2026-07-15 | #437 | pricing summit synthesis |
| 2026-07-15 | #438 | CIN-AZ pilot account digest |
| 2026-07-15..16 | #439-#443 | Batches 1-2 + invoice enrichment + ledger collapse |
| 2026-07-16 | #444 | Batch-3 (TBJ-FL, TBR-FL, TXR-AZ) + BGC digest -- 11/11 accounts complete |
| 2026-07-17 | #447 | doc-cleanup + archive sweep + STL-FL R25 vector reversal + Fauzia→Lessard rename |
| 2026-07-17 | #449 | phase-docs handoff (2 handoffs + 2 reports + PRICE_BOOK + 3 scripts + LEDGER append + register FINAL DISPOSITIONS) |

### Stage 4 (now)

**Not started.** `docs/pricing-summit/HANDOFF_STAGE4.md:91`: "billing price displayed next to every service in the SC input screens; Kevin drives with SCREENSHOTS." The design director is a fresh Chat-Claude (fresh file-share quota); CC (this session's successor) executes. Likely surfaces: `src/app/service-calendar/DayDetail.js` (entry modal, 1408 LOC) + `admin/PriceEditPanel.js`; season / period views secondary.

---

## 3. Defining characteristics

### 3a. Three display modes (rendered kind)

Derived by `resolveDayKind()` (`src/app/service-calendar/dayResolvers.js`) + consumed in `ServiceCalendar.js:1037-1042`:

| Mode | Predicate | Accounts | Financial frame |
|---|---|---|---|
| **homestand-fee** (`mlb-fee`) | `hasHomestandSchedule && isFeeAccount` | CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V | contract-driven; per-day $0; homestand rhythm |
| **operational-only** (`fee-no-dollar`) | `!hasHomestandSchedule && isFeeAccount` | STL-FL | per-day $0 by design; overlay adds HOME-game chips |
| **per-meal** | `!isFeeAccount` | CIN-AZ, CIN-KY, TBJ-FL, TBJ-NY, TBR-FL, TXR-AZ | actual_count × post-SF invoice rate = per-day revenue |

Two per-meal accounts (CIN-KY, TBJ-NY) additionally carry `has_homestand_schedule=true` after sc-16 for schedule rhythm. That combination is where the P2 drift in §9 lives.

### 3b. Two-flag schedule model (orthogonal)

Per `docs/modules/SERVICE_CALENDAR.md:23-46`:

| Flag | Column | Purpose | Classification-driving? |
|---|---|---|:-:|
| Homestand schedule | `accounts.has_homestand_schedule BOOLEAN NOT NULL DEFAULT false` | Full schedule (HOME + AWAY). Gates `resolveDayKind`, `classifyDayStatus`, actionable-day counters. | Yes |
| Schedule overlay | `accounts.has_schedule_overlay BOOLEAN NOT NULL DEFAULT false` | HOME games only, informational. Additive to whatever kind the account already renders as. | No |

`sc-17` (STL-FL) and `sc-17b` (TBJ-FL) landed the overlay flag rather than flipping `has_homestand_schedule` because flipping the latter would (per `docs/audits/SC_17_INVESTIGATION_2026-07-11.md`): (a) route `resolveDayKind` to `"mlb-fee"` (loses no-$ discipline); (b) classify rowless dates as `"off-season"` (catastrophic for a daily-serving PDC); (c) collapse actionable-day counters.

### 3c. Four billing shapes (per `docs/SC_MONEY_MODEL.md:19-32`)

| Shape | Per-meal invoice | SF | Examples |
|---|---|---|---|
| **SF% (discount)** | `actual_count × post-SF invoice rate` (= sticker × (1 - SF%)) | flat annual, separate | CIN-AZ (30%), TXR-AZ (20%), TBR-FL MiLB (25%) |
| **flat-SF (parallel)** | `actual_count × post-SF invoice rate` (= sticker; no discount) | flat annual, separate | TBJ-FL ($515,712/yr negotiated) |
| **no-SF** | `actual_count × sticker` | none | CIN-KY, TBJ-NY |
| **flat_fee** | not per-meal; PG per-service prices = $0 by design | fee IS the money | CIN-OH, STL-MO, STL-FL, TXR-TX-H, TXR-TX-V |

### 3d. Two-layer money model (`docs/SC_MONEY_MODEL.md:82-93`)

- **Layer 1 (per-meal / operational)**: `sc_daily_revenue` view computes `projected_revenue = projected_count × price_at_date` and `actual_revenue = actual_count × price_at_date` per (service, day). Consumed by the SC UI + Excel export.
- **Layer 2 (contract revenue)**: `sc_fee_schedule` holds flat annual amounts for fee accounts. Not read by the SC entry surface; not visible in per-day $. Consumed by the future KPI push (`docs/SC_KPI_PUSH_CONTRACT.md`).

---

## 4. How the engine works (data flow, end to end)

### 4a. Schema (from `docs/migrations/sc-*.sql`)

**Core catalog** (soft-delete via `deleted_at`; effective-dated via `active_until`):

| Table | Key columns | Migration |
|---|---|---|
| `sc_service_groups` | `id`, `account_key`, `group_name`, `sort_order`, `active`, `active_until DATE`, `deleted_at` | sc-1 + sc-6a |
| `sc_services` | `id`, `account_key`, `group_id`, `service_name`, `is_flat_fee`, `is_tax_free`, `is_non_revenue`, `sort_order`, `active`, `active_until DATE` | sc-1 + sc-1b + sc-6a |
| `sc_service_prices` | `id`, `service_id`, `price NUMERIC(12,5)`, `effective_date DATE`, `price_kind TEXT DEFAULT 'projected' CHECK IN ('projected','actual')`, `created_by`, `notes` | sc-1 + sc-8a |

`sc_service_prices` UNIQUE = `(service_id, effective_date, price_kind)` after sc-8a. Index `idx_sc_service_prices_lookup` on `(service_id, price_kind, effective_date DESC)` for the LATERAL newest-<=-service_date lookup.

**Per-day data**:

| Table | Key columns | Migration |
|---|---|---|
| `sc_daily_projections` | `id`, `account_key`, `service_id`, `service_date DATE`, `projected_count INTEGER >= 0`, `created_by`/`updated_by` | sc-1 |
| `sc_daily_actuals` | `id`, `account_key`, `service_id`, `service_date DATE`, `actual_count INTEGER >= 0`, `created_by`/`updated_by` | sc-1 |
| `sc_daily_actuals_history` | audit trail; PK on `id`; FK-less `actual_id`; fires on UPDATE of actual_count | sc-1 (BEFORE UPDATE trigger) |
| `sc_day_metadata` | `id`, `account_key`, `service_date`, `period`, `week_label`, `event_label`, `game_type`, `game_time TEXT`, `notes TEXT` (dormant post-sc-9) | sc-1 |
| `sc_day_note_entries` | authored note ledger: `id`, `account_key`, `service_date`, `note`, `author`, `created_at DEFAULT now()` | sc-9 |

Both `sc_daily_projections` and `sc_daily_actuals` have UNIQUE `(account_key, service_id, service_date)` + indexes on `(account_key, service_date)` and `(service_id, service_date)`.

**Schedule + phase**:

| Table | Key columns | Migration |
|---|---|---|
| `sc_homestand_schedule` | `id`, `account_key`, `service_date`, `day_of_week`, `day_type CHECK IN ('GAME','PREP','OPEN','CLOSE','CLEAN','AWAY','EXHIBITION')`, `opponent`, `homestand_id`, `game_pk INTEGER` (sc-13), `game_time TIMESTAMPTZ` (sc-15), `day_night CHECK IN ('day','night')` (sc-15), `is_doubleheader BOOLEAN` (sc-16) | sc-2 + sc-13 + sc-15 + sc-16 + sc-17/17b + sc-19b |
| `sc_phase_calendar` | `id`, `account_key`, `phase`, `start_date`, `end_date`, CHECK `start_date <= end_date` | sc-11 (48 rows across 5 PDCs) |

**Contract revenue**:

| Table | Key columns | Migration |
|---|---|---|
| `sc_fee_schedule` | `id`, `account_key`, `amount NUMERIC(12,2)`, `effective_date`, `period_type CHECK IN ('annual')`, `payment_cadence CHECK IN ('monthly-6','monthly-7','quarterly','annual')`, `covered_by_account_key`, `reason`, `requested_by`, `changed_by`. CHECK: `covered_by_account_key IS NULL OR amount = 0` (bundled invariant; TXR-TX-V case). No UPDATE / DELETE granted. | sc-5 |

**Auxiliary**:

- `sc_config_changelog` (sc-4) — audit trail for fee + price edits.
- `user_accounts` (sc-3) — per-user home account for F2 role-driven landing.

### 4b. The views: `sc_daily_revenue` + `sc_month_summary` (`sc-6b` + `sc-8b`)

`sc_daily_revenue` is the SC UI's authoritative read. Per-day-service row shape (from sc-8b lines 293-310):

```sql
LEFT JOIN LATERAL (
  SELECT price, effective_date AS price_effective_date
  FROM sc_service_prices
  WHERE service_id = sd.service_id
    AND price_kind = 'projected'
    AND effective_date <= sd.service_date
  ORDER BY effective_date DESC
  LIMIT 1
) pr_proj ON TRUE

LEFT JOIN LATERAL (
  SELECT price, effective_date AS price_effective_date
  FROM sc_service_prices
  WHERE service_id = sd.service_id
    AND price_kind = 'actual'
    AND effective_date <= sd.service_date
  ORDER BY effective_date DESC
  LIMIT 1
) pr_act ON TRUE
```

Row select list emits `COALESCE(pr_proj.price, 0) AS price_at_date` (planning price) and `COALESCE(pr_act.price, pr_proj.price, 0) AS actual_price_at_date`. `actual_revenue = actual_count × COALESCE(pr_act.price, pr_proj.price, 0)` — the split-price math from sc-8b.

**Catalog JOINs preserve history**: `WHERE (s.active_until IS NULL OR sd.service_date <= s.active_until)` (sc-6b) — a service archived on active_until=X is included for dates <= X and excluded for dates > X.

**Post-sc-8c state**: ZERO `actual`-kind rows exist. The view's `COALESCE` always falls back to `pr_proj.price`, and `pr_proj.price` carries the post-SF invoice rate (per the 2026-06-16 Price Review v3 correction). Every account reads correctly. Infrastructure (price_kind column, two-LATERAL view) stays; only the data half was rolled back.

`sc_month_summary` groups `sc_daily_revenue` by `(account_key, DATE_TRUNC('month', service_date))` and applies `FILTER (WHERE NOT is_non_revenue)` to the revenue aggregates (see `docs/modules/SERVICE_CALENDAR.md` schema notes). Meal counts include everything.

### 4c. The sc-8a/8b/8c pricing saga (root-cause reference)

**sc-8a** (schema-only): added `price_kind` DEFAULT 'projected' + CHECK IN ('projected','actual'); upgraded UNIQUE + index. Every existing row became 'projected' (correct — they were sticker prices at time of migration authoring).

**sc-8b** (data backfill + view recreate, merged 2026-06-24): backfilled 53 'actual'-kind rows for the three SF% accounts (CIN-AZ 24 rows × 0.70, TXR-AZ 18 × 0.80, TBR-FL Minor League 11 × 0.75) via `INSERT ... SELECT ... ON CONFLICT DO NOTHING`, computing `new_price = existing_projected_price × factor`. Recreated view with TWO LATERAL joins.

**The bug**: on **2026-06-16**, out-of-band, Kevin corrected `sc_service_prices` 'projected' rows to the post-SF invoice rate (per Joe Lessard-attested Price Review v3). sc-8b's backfill assumed sticker prices were still there. It wasn't. Result: 'actual' rows landed at ~49% (CIN-AZ = 0.70 × 0.70), 64% (TXR-AZ = 0.80 × 0.80), 56% (TBR-FL MiLB = 0.75 × 0.75) of sticker instead of the intended post-SF rates. Every entered day on those three accounts read ~30% too low on `actual_revenue` for 15 days before detection.

**sc-8c** (2026-07-09 data-only rollback): `DELETE FROM sc_service_prices WHERE price_kind = 'actual' AND created_by = 'sc-8b-backfill'` (53 rows). View's COALESCE now always falls back to `pr_proj` (already correct). Every `actual_revenue` history value self-healed on the next view read — no per-row correction needed.

**Root-cause standing lesson** (`docs/GOTCHAS.md:500-507`): "the shifted-input backfill trap" + "out-of-band Supabase corrections MUST be recorded same-day in the repo."

### 4d. `loadMonthData` end-to-end (`src/lib/dataStore/serviceCalendar.js:721-914`)

Reads `sc_daily_revenue` for the month range in parallel with `accounts` billing flags + note + history batches. Buckets rows by date. Materializes missing schedule dates so the schedule wins over view-emptiness (schedule-truth doctrine, `serviceCalendar.js:823-842`). Emits:

```
{
  days: [{
    date, period, weekLabel, eventLabel, gameType, gameTime,
    services: [{
      serviceId, serviceName, groupName,
      isFlatFee, isTaxFree, isNonRevenue,
      projectedCount, actualCount,
      priceAtDate, priceEffectiveDate,
      projectedRevenue, actualRevenue,
      hasActuals, hasProjection
    }],
    hasAnyActuals,
    totals: { projectedCount, actualCount, projectedRevenue, actualRevenue }
  }]
}
```

Per-service `priceAtDate` (line 814) is the SINGLE source of truth for the SC UI's billing display. `deltaChip` (DayDetail:128-139), scoreboard hero (DayDetail:518-524), tile rail, and week card all read this.

### 4e. Entry flow (`DayDetail.js`)

- `editValues` (line 164): `Record<colIndex, string>`. Values: `""` = untouched (ghost projection shown), `"0"` = explicitly zero, `"123"` = entered.
- `touched` (line 170): `Set<colIndex>`. Tracks which inputs the user has interacted with; seeded from actuals on mount.
- `initialValues` (line 165 comment): snapshot at mount + day-nav so `isDirty` is a value comparison (line 287): `editValues[ci] !== initialValues[ci]`.
- Ghost projections: an untouched service renders its projected count as a muted "ghost" and CONTRIBUTES NOTHING to the scoreboard hero (SC-072, DayDetail:538-544).
- `fillGroupWithProjections(group)` (line 473): "Match projections" per-group button. Copies projected → editValues for each in-service service.
- `getVal(colIndex)` (line 506): `editValues[ci] ?? "" → 0`. Save-touched-only pattern.
- `deltaChip(numVal, projVal)` (line 128): unified across entry (line ~395) and review (line ~468) after SC-064. Direction carries meaning; magnitude is weight only. Red is deliberately absent (blame connotation). Under = amber `-N`; over = green `+N`; match = green `✓`.
- Review step + save-touched-only: server-side `saveActuals` preserves untouched services (route.js:634-640 comment).
- **Server-authoritative saved totals** (route.js:674-686, SC-051): after `saveActuals`, the server re-reads `sc_daily_revenue` via `readSavedDayTotals(accountKey, date)` and returns `savedRevenue`/`savedMeals` in the response. Toast reflects effective-dated prices, not a client recompute.
- **Group header price** (DayDetail:853 entry + :1067 review): `fmtPrice(group.services[0]?.price || 0) / meal` — see §9 doc drift #1.

### 4f. `classifyDayStatus` (`src/lib/dataStore/serviceCalendar.js:220-298`) — the asymmetry

Status vocabulary: `no-service` / `entered` / `overdue` / `needs-entry` / `future` / `prep` / `off-season` / `exhibition` / `away`.

**Two branches**:
- **Fee-account branch** (`billing_model === 'flat_fee' && hasHomestandData`, line 253):
  - No `hs` row → `off-season` (invisible).
  - `hs.dayType === 'EXHIBITION'` → `exhibition` (sc-12; cream + copper ribbon; display-only).
  - `hs.dayType === 'AWAY'` → `away` (sc-13; muted date + hollow @OPP + plane glyph).
  - `hs.dayType === 'GAME'`: `s.hasAct` → `entered` (zeroed game = recorded cancellation); else `future`.
  - Non-game day (PREP/OPEN/CLOSE/CLEAN): `s.hasAct && s.anyNonZeroAct` → `entered`; else `prep`.
- **Per-meal branch** (line 278):
  - `hs?.dayType === 'AWAY'` → `away` (sc-16 short-circuit for CIN-KY / TBJ-NY).
  - `s.hasAct && !s.anyNonZeroAct` → `no-service` (all-zero saved actuals = planned off day).
  - `s.hasAct` → `entered`.
  - No actuals + all-zero projections → `no-service` (PR #167 planned-off-day rule).
  - Past + overdue → `overdue`; past → `needs-entry`; else `future`.

**Deliberate asymmetry** (line 247-252): per-meal all-zero saved actuals = `no-service` (beige/complete). Homestand GAME + `hasAct` (INCLUDING all-zero) = `entered` (a zeroed game is a tracked event — recorded cancellation). Kevin's ruling: the operator's action wins over the schedule's suggestion. See `docs/GOTCHAS.md:515` "SC classifier: per-meal zero and homestand zero mean opposite things."

### 4g. Homestand + overlay derivation

`loadHomestandContext(accountKey, first, last)` — gated on `has_homestand_schedule`. Fetches `sc_homestand_schedule` rows for the range; returns a `Map<service_date, hs>`.

`loadScheduleOverlay` — gated on `has_schedule_overlay`. HOME-only rows for STL-FL + TBJ-FL FSL PDC accounts. Feeds an additive render path — no kind / classify / counter change (`docs/modules/SERVICE_CALENDAR.md:56`).

**Materialization** (`serviceCalendar.js:823-842`): the union of `homestandMap` + `scheduleOverlayForMaterialize` dates seeds `dayBuckets` so every schedule-visible date renders even when `sc_daily_revenue` returned zero rows for that date.

### 4h. Phase strip / phase derivation

`sc_phase_calendar` (sc-11) drives the PhaseStrip visual + BY PHASE export table. 48 rows across 5 PDCs (CIN-AZ 13, TXR-AZ 10, TBR-FL 9, TBJ-FL 8, STL-FL 8). Phase names stored as-recorded per SC_PDC_PHASES.md Stage-2 canonical-vocab deferral. `phaseDerivation.js` + `phaseCalendar.js` shape the client-side render.

### 4i. Export money discipline (`src/lib/export/scWorkbook.js`)

Excel export (from PR #374) — three sheets (Summary / Daily detail / Notes ledger). Money reads effective-dated dollars from `sc_daily_revenue` (never a client recompute). DRAFT stamp while incomplete. Later expansions: Changes sheet (L4 counts, F1 History PR #375), BY OPPONENT rollup on homestand-fee accounts (L5), BY PHASE table on PDC year scope (`sc-11`). R13 rounding: extended lines 2dp, sum exact.

---

## 5. Design decisions and the why

### 5a. Foundational principles (`docs/DESIGN_PRINCIPLES.md`)

- **Floor-first** (§25-31): "The floor wins ties." Tap targets, contrast, tap-count to value all flow from the chef-in-cooler mental model.
- **Four Gates** (§33): the four checkpoints every SC change must clear. See DESIGN_PRINCIPLES for the full spec.
- **EI (Experience Intelligence) lens** (§44): read the surface as an emotional artifact, not just an information artifact.
- **Density vs Comfortable — task-tuned, not user-tuned** (§50-56): `docs/DESIGN_SYSTEM_REFERENCE.md:142` assigns **Service Calendar day-detail entry = Density (desktop) / Comfortable (mobile)**. The <1024px mobile override forces Comfortable regardless of module assignment (`DESIGN_PRINCIPLES.md:31`).
- **Tokens are law** (§58): `docs/SC_DESIGN_TOKEN_README.md` is the tokens surface; no ad-hoc hex.

### 5b. SC-specific locked decisions (`docs/SC_REDESIGN_SPEC.md:145-160`)

1. Calendar/Period toggle stays; both views are 4×3 on desktop.
2. Landing = Season level, Calendar view, toggle visible.
3. Today hero stays on the Period workspace.
4. Phases CAN span periods; period tinted by majority-phase; header names both.
5. Off-season periods rendered as "Offseason" cards, not hidden.
6. Flat-fee accounts keep the toggle; cards show completion or contract allocation, NOT per-meal $.
7. First-run shows projected data; never an empty grid for a configured account.
8. Full Season card shows: entered YTD, projected, days entered, needs-attention, overdue.
9. Day-square = universal atom; today = ring (not hue-only); colorblind-safe.
10. Human anchors on periods ("P7 · mid Jun").

### 5c. Locked color / status system

Colors per state (from `dayResolvers.js` + `DESIGN_AUDIT_LEDGER.md` findings):

| State | Color intent | Findings |
|---|---|---|
| `entered` | green | resolved via SC-018/019 CVD-sim |
| `future` / scheduled | navy | resolved via SC-017 (badge WONTFIX exception at 4.01:1, off-number WONTFIX at 4.11:1) |
| `needs-entry` | amber | resolved SC-008 (urgent-chip promoted) |
| `overdue` | red-adjacent + `!` glyph | glyph is load-bearing (SC-019 CVD note) |
| `no-service` / `off` | muted / beige | SC-017 documented AA exception (off tiles deliberately de-emphasized) |
| `prep` (fee non-GAME) | schedule-default fill | SC-078 ruling: entry beats schedule |
| `away` (sc-13) | teal fill + hollow @OPP + plane glyph | sc-13 pattern |
| `exhibition` (sc-12) | cream + copper ribbon | display-only |
| GAME-day corner wedge | indigo | sc-18 (sm tiles) |
| Spring Training | sun-copper wedge + ST pill + chrome rider | sc-19 |

### 5d. Two tracker non-negotiables

- **Visible state legend** — StateLegend component + LegendInfoPopup. Legend row swatches render in full (design-review-4-in-1 fix #409/`ba35495`).
- **Missing vs failed vs zero render distinctly** — `dayResolvers.js` classification vocabulary distinguishes `future` (no data expected yet) from `needs-entry` (past, no actuals, within LOCK_DAYS) from `overdue` (past, no actuals, beyond LOCK_DAYS) from `no-service` (all-zero saved). Failed state testable via `?debug=failed` on overview + drill scopes (post-SC-015 hook).

### 5e. Redesign audit ledger — closed vs open

From `docs/DESIGN_AUDIT_LEDGER.md` grep of the status column:

| Status | Count |
|---|---:|
| RESOLVED | 55 |
| VERIFIED (non-issue) | 9 |
| WONTFIX (documented intent / Kevin ruling) | 10 |
| OPEN | 4 |
| HYP-RUNTIME (subset of OPEN) | 4 |

**Currently open SC findings** (from `DESIGN_AUDIT_LEDGER.md:6`):
- SC-011 — 200% zoom / text-scaling parked (Kevin ruling).
- SC-014 — stale-data authority behavior unverified (runtime check needed).
- SC-015 — failed-cell legibility live (needs `?debug=failed` runtime verify).
- SC-020 — as-of pill contrast over hero photo (runtime check owed).

Total SC-### findings catalogued: 78. Post-arc addendum (`DESIGN_AUDIT_LEDGER.md:8`) covers the design-review-4-in-1 fix set (#409) landed after the ledger closed.

---

## 6. The money model in operating terms

Source: `docs/SC_MONEY_MODEL.md` (canonical; wins conflicts per line 3).

### 6a. Terminology

- **Post-SF invoice rate** = the workbook actuals-tab price = what the client is billed per meal. For SF% accounts: `sticker × (1 - SF%)`. For flat-SF, no-SF, and flat_fee-tracking accounts: sticker equals post-SF (same number). **This is the ONE per-meal-price concept the app displays.** (`MONEY_MODEL:64-68`)
- **Sticker** = the workbook projection-tab price. Historical planning number. **Never shown in the app.** (`MONEY_MODEL:62-63`)
- **"Cost basis" is BANNED terminology** as of 2026-07-09 (Q5 rename). Historical doc language sometimes called the post-SF invoice rate "cost basis"; it is not COGS, it is the invoice line. Use "post-SF invoice rate" going forward. (`MONEY_MODEL:70-73`)

### 6b. Post-SF invoice rate as the display + charge rate

`sc_service_prices.price_kind = 'projected'` today holds the post-SF invoice rate (name is historical from the sc-8a schema; content shifted 2026-06-16). App reads this via `sc_daily_revenue.price_at_date`. Every SC display surface (tile rail, week card, drill-in workspace, DayDetail scoreboard, DayDetail group header, Excel export) reads this ONE source. Client never recomputes.

### 6c. Per-service pricing

Every service has its own `sc_service_prices` row(s). Prices are effective-dated: new escalation = new row with later `effective_date`. CPI escalations land via the admin backdate flow (PR #224) into PG, never into workbooks (`docs/GOTCHAS.md:506`). Bill export must foot each service line individually before the sum — the group-header "$X/meal" is a display collapse, not the billing math (see §9 drift #1).

### 6d. Flag semantics

- **`is_flat_fee`** = flat unit rate (not per-meal count). Examples: CIN-AZ Coffee Service ($511.05/week), Fountain Bev ($283.92/week); TBR-FL Extra Protein pans ($111.84 chicken, $162.17 beef/seafood); TXR-AZ Extra Protein pans; TBR-FL Extended Day Labor ($280/day). Unit inferred from service name; PG has no unit column.
- **`is_tax_free`** = tax marker only. Still contributes revenue. Examples: CIN-AZ Coffee + Fountain (contractually tax-exempt); TBR-FL BGC B&G Lunch ($6.50, after-school supper program tax-exempt).
- **`is_non_revenue`** = excluded from revenue totals (still contributes to meal counts). Example: TBJ-FL "Fun $$$$ Allocated" ($28,472.756/yr internal team-event budget; PG stores as `is_flat_fee=true, is_non_revenue=true`). `sc_month_summary` applies `FILTER (WHERE NOT is_non_revenue)` to revenue aggregates.

### 6e. Passthrough is never revenue

Some accounts have a food/packaging/supplies budget (STL-FL $900K, STL-MO $225K, CIN-OH's food budget). KitchFix collects and passes it through to the client at cost, savings revert. **Out of SC per-meal scope entirely.** Fee accounts' SC per-meal rows carry $0 by design so no revenue leaks from the passthrough.

### 6f. Fee accounts: $0-by-design operational-only

For CIN-OH, STL-MO, STL-FL, TXR-TX-H, TXR-TX-V, PG `sc_service_prices` entries carry $0. Operators still enter meal counts (for operational planning + rollups) but no per-day $ is displayed. Revenue = the flat/escalated Service Fee from `sc_fee_schedule`, billed on its own cadence. `STL - FL` variant: `has_schedule_overlay=true` + `flat_fee` = "fee-no-dollar" rendered kind — HOME games chip additively, still no per-day $.

### 6g. PG = live price SOT; PRICE_BOOK = generated projection

Per `docs/pricing-summit/PRICE_BOOK.md` header + `docs/pricing-summit/HANDOFF_STAGE4.md:85`:
- **PG (`sc_service_prices` × `sc_services` × `sc_service_groups`)** = live price authority. Every price shown in the app is the latest-effective-date row per `(service_id, price_kind='projected')`.
- **`docs/pricing-summit/PRICE_BOOK.md`** = PG's projection at generation time. Regenerate on ANY price change (Studio apply / admin edit / backdate). Read-only book; PG owns the price.
- **`KitchFix_Service_Calendar_Price_Review_v3_FINAL.xlsx` → "Billing Price"** = ATTESTED authority (Joe Lessard-signed). PG matches signed at 2dp on 103/105 rows per `STAGE3_CERTIFICATION_AUDIT.md`; the 2 catalogued signed-side notes (Media Meals stale $15 → $16, STL-FL MiLB Snack "NEEDS PRICE") ride the signed v4 refresh.

---

## 7. Landmines / gotchas

Synthesizes SC-relevant entries from `docs/GOTCHAS.md` (headings + line numbers):

| # | Landmine | Citation |
|---|---|---|
| 1 | Currency values from Sheets are STRINGS not numbers — always `parseNum()` before math | `GOTCHAS.md:12-16` |
| 2 | Vercel runs in UTC — date comparisons need normalization | `GOTCHAS.md:105-115` |
| 3 | Em-dashes in email subjects break encoding | `GOTCHAS.md:131-135` |
| 4 | Never define a function component inside another component's render body | `GOTCHAS.md:190-212` |
| 5 | The SC toast is per-page, not the shared component | `GOTCHAS.md:214-218` |
| 6 | Same-route `router.push` preserves component state (SC `selectedAccount` persists across intra-route nav) | `GOTCHAS.md:247-251` |
| 7 | `str_replace` requires exact whitespace match | `GOTCHAS.md:263-269` |
| 8 | SC PDC phases: "Camp Name" column is source of truth, not meal-count inference | `GOTCHAS.md:494` |
| 9 | SC actuals revenue uses per-account CONTRACTED discount, not projected/sticker price | `GOTCHAS.md:497` |
| 10 | **The shifted-input backfill trap** — data-transformation migrations MUST verify existing column's SEMANTIC PROVENANCE at run time (sc-8b root cause) | `GOTCHAS.md:500` |
| 11 | **Out-of-band Supabase corrections MUST be recorded same-day in the repo** (the 2026-06-16 Price Review v3 correction that sc-8b assumed away) | `GOTCHAS.md:503` |
| 12 | CPI / escalation price updates land in PG via admin backdate flow, NEVER in sheets | `GOTCHAS.md:506-507` |
| 13 | SC flat-fee accounts: revenue is NOT per-meal; fee is phase-aware prorated (STL-FL $1.4M split across periods) | `GOTCHAS.md:509` |
| 14 | SC role data lives in `contacts.role`, NOT in code / SC_ADMIN_EMAILS / empty `users` table | `GOTCHAS.md:512` |
| 15 | **SC classifier asymmetry**: per-meal zero and homestand zero mean opposite things (`no-service` vs `entered`) | `GOTCHAS.md:515` |
| 16 | SC uses silent `.catch(() => {})` in specific tolerable-failure spots — do NOT extend the pattern | `GOTCHAS.md:523` |
| 17 | **SC migrations in `docs/migrations/*.sql` run at MERGE time (via Studio), NOT deploy time** — Vercel does not run them | `GOTCHAS.md:536` |
| 18 | Post-close-out sc- silent-gap history (2026-07-11 and 2026-07-12): discipline broke around the draft-gate rule; Migration gate CI (#416) is the mechanical fix | `GOTCHAS.md:548` |
| 19 | Hook declaration order is a runtime-only failure class | `GOTCHAS.md:164-175` |
| 20 | Extracted-function free variables are the same runtime-only class | `GOTCHAS.md:177-188` |

---

## 8. Current state and what's next

### 8a. Live

Everything in §2 arc through PR #449. Highlights:
- **Season → Period → DayDetail** drill live end-to-end. Effective-dated dollars via `sc_daily_revenue` throughout.
- **Save queue resilience** (F3, #378): localStorage-backed queue + backoff replay + N1 SYNCING badge.
- **F1 Activity ledger** (#375): notes + actuals-edit trail merged in DayDetail.
- **F2 role-driven landing** (#377): floor + `user_accounts` row → account/period/today focus.
- **F6 phase foundation** (`sc-11` + #381): 48 seeded rows + BY PHASE export.
- **PDF schedule export** (#419-#422 + corrective): 4 sheets; MLB + AAA drill PDFs live; **PDC/PDCO drill PDF PARKED** behind Coming Soon (wall-poster redesign pending, `docs/design/PDC_PRINT_REDESIGN.md`).
- **Migration gate CI** (#416): `applied in Studio: YES` comment gates migration PRs; per-SHA reset.
- **Coming Soon gate**: SC is still dev-gated behind Coming Soon; drop is Kevin's launch-roadmap step 4 (`SC_STATUS.md:109`).

### 8b. Parked (resume on Kevin's ruling)

Per `docs/SC_STATUS.md:112-116`:
- PDC/PDCO drill PDF wall-poster redesign (park 2026-07-13).
- Schedule-drift watchdog Stages 2/3 auto-draft + auto-apply (park to 2027).
- `sc_homestand_schedule` Option A (array-shape for DH + PPD makeup dates; park 2026-07-14).
- SC-011 (200% zoom / text-scaling; parked pending its own conversation).

### 8c. Confirmed future SC deliverables

Per `docs/PROJECT_DASHBOARD.md:21` + `docs/SC_CC_HANDOFF.md:501-506`:

| Deliverable | Description | Status |
|---|---|---|
| **Admin Dashboard** | Cross-account ops overview surface (separate page from the inline `ServiceConfig` drawer) | Not started; scoped |
| **Fun Money Tracker** | Non-revenue catalog tracking surface (absorbs the per-account "Fun $$$" allocations SC currently carries) | Not started; scoped |
| ~~**Close Day button**~~ | ~~One-tap per-day lock / confirmation UX.~~ **REMOVED from backlog 2026-08-01.** The scope split cleanly into two features that shipped separately: zeros half = **Mark day as no service** (`sc-submit-day` with `noService: true` writes zeros + audit note; live since #365-#367); lock half = **period lock** (sc-25 migration + `assertDaysUnlockedForWrite` helper; server-side lock on every write path, SLT override, unknown days fail safe). Nothing per-day-flag ever needed a new table. Kept struck rather than deleted so the "was scoped, was resolved as two shipped features" trail survives. | REMOVED - see the two features above |

### 8d. Stage 4 — right now

**Goal** (`HANDOFF_STAGE4.md:91`): billing price displayed next to every service in the SC input screens.

**Settled inputs** (`HANDOFF_STAGE4.md:92`):
- Default display = post-SF invoice rate (Q-8).
- Flat-fee accounts must NOT imply meal-math revenue (per-meal $0 by design). Decide visual: planning-only badge? hidden? — pending Kevin.
- TXR-TX-V shows NO prices.
- Visual treatment needed for flags: `is_flat_fee` add-ons, `is_non_revenue` (Fun $$$), tax-exempt (BGC), mixed-tax add-ons (TBR).

**Process**: critique current screens → design thesis → Kevin approves → mockups → SC-### audit-ledger discipline → CC implements. Screenshot-driven from fresh chat (file-share quota).

**Likely surfaces**: DayDetail entry modal (`src/app/service-calendar/DayDetail.js`, 1408 LOC) + admin PriceEditPanel. Season / period views secondary.

### 8e. KPI Dashboard — explicitly out of scope

`docs/SC_KPI_PUSH_CONTRACT.md:3`: "The KPI dashboard itself is a separate future project; this doc is the contract it consumes." `SC_LENS_VISION.md:168`: "The KPI dashboard itself — a separate future project; the SC's job is to expose its revenue band cleanly per SC_KPI_PUSH_CONTRACT.md." Not part of Stage 4.

---

## 9. Doc-drift flags (P2)

Kevin's two candidates VERIFIED against code, plus any others surfaced during synthesis.

### Drift #1 — DayDetail group header shows first-service price for whole group

**Verified from code:**
- `src/app/service-calendar/DayDetail.js:853` (entry view group header):
  ```js
  {!isFeeAccount && (
    <span className="sc-day-group-price">
      {accountSegment && !groupNameCarriesSegment(group.name, accountSegment) ? `${accountSegment} · ` : ""}{fmtPrice(group.services[0]?.price || 0)} / meal
    </span>
  )}
  ```
- `src/app/service-calendar/DayDetail.js:1067` (review view group header): identical pattern with `group.services[0]?.price`.

**The claim:** the header prints `group.services[0]?.price` as one "`/ meal`" for the whole group. In mixed-rate groups, this misrepresents the group. Real examples:
- **TBR-FL Minor League** — Breakfast $17.83, Lunch $21.68, Dinner $20.96 (per `docs/pricing-summit/PRICE_BOOK.md`). Header shows `$17.83 / meal` for all three lines.
- **TBR-FL Minor League** — plus flat add-ons: Extra Protein pans (per-pan flat) + Extended Day Labor (per-day flat). Header still shows one per-meal rate for the group.
- **CIN-AZ Minor League** — includes Coffee Service ($511.05/wk) + Fountain Bev ($283.92/wk) which are per-week flat, not per-meal. Header shows `$12.90 / meal` (Breakfast) for the group.

**Doc claims about the price:**
- `docs/SC_MONEY_ALIGNMENT_REPORT.md:113` says "modal group-header prices come from `data.serviceGroups[s].price`, loaded with `.eq('price_kind','projected')` (dataStore/serviceCalendar.js:335)" — treats it as one price per group, does not flag mixed-rate risk.
- `docs/SC_MONEY_MODEL.md:106` says "modal group header + tile rail + workspace strip all read this price" — same framing, no per-service header discussion.
- `docs/SC_REVENUE_LENSES_MEMO.md:391` references `day.priceAtDate` and "the modal group header" as reading from the projected price_kind.

**No doc claims per-service header pricing.** All references frame the group header as a single price. **Neither the code nor the docs surface the "mixed-rate group" case.** This is a real Stage-4 design concern: the group header pricing pattern silently mis-labels TBR-FL Minor League + CIN-AZ Minor League + likely others once Extra Protein / MTO / add-on rows are considered. Stage 4 either (a) moves the price display to each service row (per-service), or (b) keeps the header but suppresses it for mixed-rate groups.

### Drift #2 — FullSeasonCard branches on `hasHomestandSchedule` before `isFeeAccount`

**Verified from code:**
- `src/app/service-calendar/season/FullSeasonCard.js:57-80`:
  ```js
  {hasHomestandSchedule ? (
    <FeeHomestandSummary
      gameDaysEntered={...} totalGameDays={...} mealsYTD={...} feePct={...}
    />
  ) : isFeeAccount ? (
    <OperationalSummary daysRecorded={...} totalDays={...} mealsYTD={...} completionPct={...} />
  ) : (
    <PerMealSummary actualRev={...} projRev={...} daysRecorded={...} totalDays={...} mealsYTD={...} completionPct={...} />
  )}
  ```

**Confirmed:** `hasHomestandSchedule` is the first branch predicate. The `FeeHomestandSummary` component (defined line 127) renders game-days + "Contract value will surface..." caption and shows NO per-day dollars. The `PerMealSummary` component (line 91) leads with `Entered YTD` and `Projected` money.

**Prop derivation** (`src/app/service-calendar/ServiceCalendar.js:1041-1042`):
```js
const isFeeAccount = data?.account?.billingModel === "flat_fee";
const hasHomestandSchedule = !!data?.homestandMap;
```

**Consequence for CIN-KY and TBJ-NY** (both `actuals_drive_invoice` per-meal + `has_homestand_schedule=true` after sc-16):
- `isFeeAccount = false` (billing_model is `actuals_drive_invoice`, not `flat_fee`).
- `hasHomestandSchedule = true` (they have `sc_homestand_schedule` rows).
- FullSeasonCard renders `FeeHomestandSummary` (no dollars, "Contract value will surface...") despite being per-meal billing.

**Entry modal check** (DayDetail is correctly gated):
- `DayDetail.js:832`: `{!isFeeAccount && <span className="sc-day-sb-amount sc-day-sb-amount--recorded">{fmt$(summary.revenue)}</span>}` — scoreboard hero recorded amount.
- `DayDetail.js:851, 1067`: `{!isFeeAccount && (<span className="sc-day-group-price">...` — group header price.
- `DayDetail.js:872, 1106, 1123`: `{... }{isFeeAccount ? "" : ` · ${fmt$(gs.revenue)}`}` — group subtotal $.

The DayDetail entry modal is gated on `!isFeeAccount` throughout, so for CIN-KY + TBJ-NY (where `isFeeAccount=false`) it **already shows per-day dollars correctly**. The mismatch is only at the season/period summary level — the FullSeasonCard.

**Recommended fix (out of scope here):** flip the FullSeasonCard branch order to check `isFeeAccount` first, OR change the `FeeHomestandSummary` predicate to `isFeeAccount && hasHomestandSchedule`. Any Stage-4 change to price-display in the entry modal will need to be aware of this inconsistency so the season summary and the entry modal do not tell different stories.

### Drift #3 (surfaced during synthesis) — no doc distinguishes `billing_model = 'per_meal'` from `'actuals_drive_invoice'`

`docs/modules/SERVICE_CALENDAR.md:17-21` lists three billing_model values:
- `per_meal` (default): per-meal, meal-count-driven revenue.
- `flat_fee`: fixed annual contract fee.
- `actuals_drive_invoice`: per-meal but MLB-adjacent shape (AAA level).

**Code treats `per_meal` and `actuals_drive_invoice` identically.** `isFeeAccount = billing_model === 'flat_fee'` (`ServiceCalendar.js:1041`) collapses both non-`flat_fee` values into the per-meal branch. `classifyDayStatus` (`serviceCalendar.js:253`) checks `billing_model === 'flat_fee'`. Nothing in the SC codebase distinguishes the two per-meal shapes.

**Not a bug**, but the module doc's three-value taxonomy is misleading — the runtime distinction is binary (`flat_fee` vs everything else). Stage-4 designers reading only the module doc may design differently for AAA per-meal accounts than the code actually delivers.

### Drift #4 (minor) — `docs/SC_STATUS.md:105` mentions `sc_day_metadata.day_notes` column but sc-9 (2026-07-09) migrated notes into `sc_day_note_entries`

`SC_STATUS.md:105` in the mid-arc summary: "money architecture unified on effective-dated view totals returned from `sc-save`, failed states testable via `?debug=failed` on overview + drill scopes, chip pipeline unified on classified status, submission flow hardened (...) now persisted end-to-end via `sc_day_metadata.day_notes`."

Post-sc-9, notes live in `sc_day_note_entries` (author + timestamp per entry; append-only ledger). The `sc_day_metadata.notes` column is dormant per `sc-9-day-note-entries.sql:64-79`. Historical statement in SC_STATUS.md now reads as slightly ahead of its migration.

---

## 10. Open questions / UNKNOWNs

- **Stage-4 visual treatment for flat_fee accounts' per-meal $0 rows** — planning-only badge? hidden? Pending Kevin per `HANDOFF_STAGE4.md:92`.
- **Group-header price for mixed-rate groups** — no design ruling yet; per-service inline is one option, mixed-group suppression is another (see Drift #1).
- **FullSeasonCard branch-order intent** — code branches on `hasHomestandSchedule` first; module doc + design docs treat homestand + per-meal as orthogonal via the "AAA per-meal + PDC overlay + PDC per-meal" framing (`docs/modules/SERVICE_CALENDAR.md:382`). Whether the current branch order is deliberate (schedule presence "wins" the summary treatment) or accidental (drift after sc-16 added homestand rows to two AAA per-meal accounts) is UNKNOWN.
- ~~**Close Day button data-layer shape**~~ - RESOLVED 2026-08-01: Close Day was removed from the backlog. Neither per-day flag nor new table were needed; the two halves of the scope shipped as separate features (mark-no-service + sc-25 period lock).
- **Signed v4 two-cell refresh queue timing** — TBJ-FL Media Meals $15 → $16 and STL-FL MiLB Snack `NEEDS PRICE` → $0. Waiting on next Joe touchpoint; non-blocking for Stage 4 (PG is correct per Kevin's Stage-1 directive).
- **Some sc-N migration PR numbers** — a few sc-2 / sc-3 / sc-6a / sc-6b / sc-7 / sc-8a / sc-8b landed via commits without an obvious PR merge; `no-PR-found` recorded in §2 rather than fabricated.
- **KPI dashboard timing / owner** — `SC_KPI_PUSH_CONTRACT.md` is spec / pre-build; no dates in the repo. Explicitly out of Stage 4 scope.

---

## Sources verified inline

Code: `src/app/service-calendar/{DayDetail.js, ServiceCalendar.js, season/FullSeasonCard.js}`, `src/lib/dataStore/serviceCalendar.js`, `src/app/api/service-calendar/route.js`, `docs/migrations/sc-1..sc-19b.sql`.

Docs: `docs/modules/SERVICE_CALENDAR.md`, `docs/SC_STATUS.md`, `docs/PROJECT_DASHBOARD.md`, `docs/SC_MONEY_MODEL.md`, `docs/SC_MONEY_ALIGNMENT_REPORT.md`, `docs/SC_REVENUE_LENSES_MEMO.md`, `docs/SC_REDESIGN_SPEC.md`, `docs/SC_KPI_PUSH_CONTRACT.md`, `docs/SC_LENS_VISION.md`, `docs/DESIGN_PRINCIPLES.md`, `docs/DESIGN_SYSTEM_REFERENCE.md`, `docs/DESIGN_AUDIT_LEDGER.md`, `docs/GOTCHAS.md`, `docs/audits/SC_17_INVESTIGATION_2026-07-11.md`, `docs/SC_BUNDLE1_RECON.md`, `docs/SC_CC_HANDOFF.md`, `docs/pricing-summit/HANDOFF_STAGE4.md`, `docs/pricing-summit/PRICE_BOOK.md`, `docs/pricing-summit/STAGE3_CERTIFICATION_AUDIT.md`.

Git: `git log main --oneline -N`, spot-checked merge SHAs for PRs #149, #209, #221, #227, #229, #265-#274, #321-#333, #344-#351, #353-#363, #365-#368, #370-#378, #381-#413, #416-#422, #427, #430-#431, #437-#449.

# sc-14 prep - PREP / OPEN / CLOSE removal review

**Generated:** 2026-07-10
**Scope:** READ-ONLY investigation of what PREP/OPEN/CLOSE day_types touch in code + data before removing them. No migrations, no deletes, no code changes.
**Decision on the table:** Kevin has ruled the MLB Stats API is the single source of truth for the Service Calendar. PREP/OPEN/CLOSE were internal scaffolding added around homestands, not real baseball schedule facts. Removal is the next migration (sc-14).
**Prior context:** sc-12 (merged) reconciled home slate to PDF-as-truth. sc-13 (PR #389, unmerged) loads AWAY games with a 35-row PREP/CLOSE conflict list I flagged for Kevin. This doc feeds both the sc-14 scope decision AND a potential sc-13 revision.

---

## TL;DR

1. **Removal is NOT purely safe.** Two hard dependencies + one soft dependency exist that must be handled before the DELETE:
   - **Hard 1 - homestand span:** `homestandDerivation.js` computes each homestand's `startDate` / `endDate` from ALL dates with that homestand_id, including PREP/OPEN/CLOSE. Removing them tightens spans from "OPEN...CLOSE" to "first GAME...last GAME." Not a bug per Kevin's stated goal, but a visible date-range shift on the SeasonStepper + PeriodCard subtitle.
   - **Hard 2 - Ops Labor SeasonPlanner** (separate Sheets-fed feature) actively uses PREP/OPEN/CLOSE days for OT-week detection and budget-envelope math. **But** ops-labor reads from Sheets HUB, NOT from `sc_homestand_schedule` (PG). Deleting PG rows leaves Sheets untouched, so ops-labor is unaffected UNLESS Kevin also deletes from Sheets HUB or the `_seed_sc_homestand_schedule.mjs` seeder is re-run and would restore them from Sheets.
   - **Soft - SC-078 entered-non-game-day protection:** Kevin's own June 2026 ruling (SC-078) explicitly established that non-game days with recorded actuals classify as `entered` (green tile), not `prep`. The Jun 26 CIN case: 10 meals recorded on what was schedule-marked PREP. Deleting the schedule rows voids this protection - dates with real actuals become invisible off-season tiles.
2. **Two probes Kevin MUST run in Studio before the DELETE.** Both are read-only. They enumerate dates with orphan-risk data (actuals + non-zero projections + notes). Full SQL in the appendix.
3. **Interaction with sc-13 (PR #389):** the 35 conflict dates I flagged in that PR ARE the same PREP/CLOSE rows being deleted here. If sc-14 lands before or as part of sc-13, the ON CONFLICT dance dissolves and all 4 accounts get a clean 81 AWAY per season. **Recommendation: revise PR #389 to fold sc-14 in as sc-13a (delete PREP/OPEN/CLOSE) + sc-13b (AWAY load), same migration.** Cleaner final state, single transaction, no intermediate ambiguity.
4. **Recommended scope: data-only DELETE + minimal code cleanup.** Keep the `'PREP'` `'OPEN'` `'CLOSE'` `'CLEAN'` values in the day_type CHECK constraint - retiring the classifier's `"prep"` return path and the sub-branches is trivial code cleanup, but SHRINKING the CHECK domain forecloses ever re-introducing them. Delete the row data; leave the schema flexible.
5. **Blocking questions for Kevin (both before sc-14 runs):**
   - Should the seeder script `_seed_sc_homestand_schedule.mjs` be retired, or updated to filter PREP/OPEN/CLOSE out of the Sheets read so re-running it doesn't restore them?
   - For dates with recorded actuals on PREP/OPEN/CLOSE, do you want to (a) reclassify them to GAME, (b) keep the actuals but drop the schedule row (data becomes invisible on calendar - Activity ledger still has it), or (c) delete the actuals too?

---

## Task 1 - What depends on PREP/OPEN/CLOSE?

Every touchpoint traced via `grep`. Categorized as **BREAKS** (delete removes required signal), **SILENTLY CHANGES A NUMBER** (delete shifts a visible value), **HARMLESS** (delete is a no-op for that surface), or **DEAD** (code becomes dead after delete).

### 1.1 - Classifier (`src/lib/dataStore/serviceCalendar.js:229-233`)

```js
// Non-game day (PREP / OPEN / CLOSE / CLEAN): entry wins if the
// operator actually recorded a non-zero meal count. All-zero on a
// non-game day OR no actuals stays "prep" (schedule-driven default).
if (s.hasAct && s.anyNonZeroAct) return "entered";
return "prep";
```

**Category: SOFT DEPENDENCY (SC-078 protects non-game-day entries).** Post-DELETE:
- Dates with no PREP/OPEN/CLOSE row hit line 212 `if (!hs) return "off-season";`
- The SC-078 rescue path never fires (no hs to inspect for non-GAME type).
- If actuals exist on that date, they surface in `sc_daily_revenue` but the calendar tile renders as off-season (grey, no data hint).

**Verdict:** must run the SC-078 probe (see Appendix probe B) to enumerate dates where actuals exist on PREP/OPEN/CLOSE. Those are the dates that would go silently missing.

### 1.2 - Aggregate loop (`serviceCalendar.js:1080-1104`)

```js
for (const d of days) {
  if (d.dayType === "EXHIBITION" || d.dayType === "AWAY") continue;
  if (d.dayType === "GAME") { gameDays++; if (...) gameDaysEntered++; }
  else if (d.dayType) { prepDays++; }   // <- PREP/OPEN/CLOSE/CLEAN land here
  if (d.homestandId) homestandIds.add(d.homestandId);
}
```

`prepDays` is emitted on `homestandSummaryByMonth[monthKey].prepDays`.

**Category: SILENTLY CHANGES A NUMBER, then downstream mostly HARMLESS.**
- `prepDays` is consumed at `MonthCard.js:455`: `noService = gameDays === 0 && prepDays === 0`. Post-delete, prepDays is always 0 for the affected months. `noService` collapses to `gameDays === 0` - simpler and semantically correct. Not a regression.
- `homestandIds` Set - unchanged because HS-prefixed IDs come from GAME rows too. No visible change.

**Verdict:** no user-visible regression. Downstream code becomes slightly dead (the `prepDays` field on the response is emitted but no consumer reads it after the MonthCard change). Optional cleanup: remove the field from the response.

### 1.3 - HomestandDerivation (SeasonStepper)

`src/app/service-calendar/season/homestandDerivation.js:75, 97-98`:

```js
bucket.dates.push(d.date);       // pushes GAME + PREP + OPEN + CLOSE dates for the homestand
...
const startDate = bucket.dates[0];
const endDate   = bucket.dates[bucket.dates.length - 1];
```

**Category: SILENTLY CHANGES A NUMBER. THIS IS THE HIGHEST-RISK SURFACE.**

Post-delete: startDate = first GAME, endDate = last GAME. The SeasonStepper caption `"HS3 vs ARI · Jun 1 - Jun 5"` tightens to `"HS3 vs ARI · Jun 2 - Jun 4"` because OPEN 6/1 and CLOSE 6/5 no longer contribute to the range.

Consequences:
- The "now" / "done" / "next" status detection (line 100-104) uses `startDate <= todayDate <= endDate`. If today is 6/5 (was a CLOSE day), current: `"now"`. Post-delete: `"done"` (endDate 6/4 < today). This is a tighter, more accurate representation but the transition happens sooner.
- PeriodCard subtitle `deriveHomestandSubtitle` uses opponent-only accumulation (line 341 filters `d.dayType === "GAME"`). Unaffected by delete.
- `homestandIds` Set (used for `hsCount`) - unaffected (HS IDs still on GAME rows).

**Verdict:** matches Kevin's stated goal ("the actual baseball calendar, nothing layered on top"). But note this is a visible date-range shift on every homestand chip / stepper caption / month card. Kevin should preview a homestand caption pre-vs-post to confirm the tighter range reads better.

### 1.4 - Ops Labor SeasonPlanner (SEPARATE feature, Sheets-fed)

`src/app/api/ops/route.js:222-320` and `src/app/ops/components/labor/SeasonPlanner.js:186-190`.

**Ops Labor uses PREP/OPEN/CLOSE as first-class working days** for:

1. **`workingDaysPerPeriod`** (line 222-226): counts every schedule row's date against periods. `dailyRates[p] = b.hourlyBudget / workingDaysPerPeriod[p]`. Fewer working days → higher daily rate → different budget envelopes per homestand.
2. **`budgetEnvelope`** (line 270-292): sums `dailyRates[p]` for each day in the homestand. Deleting PREP/OPEN/CLOSE shrinks each homestand's envelope by their day-share.
3. **OT exposure detection** (line 296-320): counts working days per week. A week with 3 GAME + 3 PREP = 6 working days = OT certain today. Post-delete: 3 working days = no OT flag.
4. **UI text** (SeasonPlanner.js:186-188): renders `"3 games, 2 prep, 1 close"` - lines 187 + 188 would drop off.

**CRITICAL DISTINCTION:** Ops Labor reads from **Google Sheets HUB `homestand_schedule` tab**, not from `sc_homestand_schedule` in Postgres. Confirmed by `import { readSheetSA } from "@/lib/sheets"` on line 2 of `/api/ops/route.js` and the read on line 723 for `SHEET_IDS.HUB, "accounts"` etc.

**Verdict:** deleting from the PG table `sc_homestand_schedule` does NOT affect Ops Labor. Ops Labor keeps working normally. Kevin's stated scope ("the Service Calendar's schedule") lines up with this.

**BUT the seeder script `_seed_sc_homestand_schedule.mjs` reads from Sheets HUB and writes to PG.** If it's re-run post-sc-14, it would restore PREP/OPEN/CLOSE rows from Sheets. Two mitigations:
- Retire the seeder entirely (it's not on any cron; runs when Kevin invokes it).
- Add a `dayType IN ('GAME')` filter in the seeder so it only mirrors games from Sheets to PG.

Recommend the filter approach (cheap, keeps the seeder available for game-only mirroring).

### 1.5 - Ops Labor Sheets HUB itself

Kevin's decision NOT scoped here. If Kevin ALSO wants PREP/OPEN/CLOSE removed from Sheets HUB (unifying data-source), Ops Labor budget-envelope math changes. That's a separate ops-domain call - flagging for awareness, not in sc-14's scope.

### 1.6 - MonthCard footer (`MonthCard.js:453-455`)

```js
if (hasHomestandSchedule) {
  const hs = monthSummary.homestandSummary;
  return !hs || (hs.gameDays === 0 && hs.prepDays === 0);
}
```

**Category: SILENTLY CHANGES A NUMBER, but toward CLEANER SEMANTICS.**

Post-delete `hs.prepDays` is always 0, so `noService` = `gameDays === 0`. A month with only PREP days (extremely rare - homestand-adjacent months usually also have games) would previously read "has service" and post-delete reads "no service". Correct behavior; no regression.

### 1.7 - Workspace aggregate `isServiceDay` (`ServiceCalendar.js:106-113`)

```js
const isServiceDay = day.status !== "no-service"
  && day.status !== "off-season"
  && day.status !== "prep"
  && day.status !== "exhibition"
  && day.status !== "away";
```

**Category: HARMLESS.** The `"prep"` string is a valid status the classifier never emits post-delete, so this line is dead but harmless. Dead-code cleanup opportunity.

### 1.8 - `resolveDayStatus` `case "prep": return "off"` (`dayResolvers.js:77`)

**Category: DEAD** (classifier never emits `"prep"` post-delete). Cleanup opportunity.

### 1.9 - PeriodWorkspace bulk-select comment (`PeriodWorkspace.js:813`)

```js
// Off days ("off-season" / "prep") never selectable.
```

**Category: DEAD comment reference.** The gate itself (`status !== "off"`) still works because both old-`"prep"` and new-`"off-season"` resolve to atom-status `"off"`. Comment can be trimmed.

### 1.10 - Legend "Non Game day" (`legendItems.js:33-39`)

```js
{
  mod: "off",
  icon: "",
  label: "Non Game day",
  description: "Prep, open, close, or off-day between homestands.",
},
```

**Category: DEAD description text.** Post-delete, "off" only covers off-season (spring training, playoff arm's-length, etc.). The label + description are misleading and should be trimmed.

### 1.11 - Export workbook (`src/lib/export/scWorkbook.js`)

Grep found ~10 sites referencing `dayType === "GAME"` or filtering non-GAME. All are GAME-filtered predicates that naturally ignore PREP/OPEN/CLOSE - the delete only makes those filters cheaper (no rows to filter). **Category: HARMLESS.**

### 1.12 - Migration files (`docs/migrations/sc-2` + `sc-12` + `sc-13`)

Historic migrations reference PREP/OPEN/CLOSE in CHECK definitions and idempotency guards. These are frozen artifacts; sc-14 doesn't touch them. **Category: HARMLESS.**

### Summary table

| Surface | Category | Post-delete impact | Fix |
|---|---|---|---|
| classifyDayStatus (SC-078 branch) | **SOFT DEPENDENCY** | Entered-non-game-day loses schedule context; renders off-season | Probe + reclassify or accept invisibility |
| `prepDays` aggregate | Silently changes | Always 0; MonthCard `noService` simplifies | Optional field trim |
| **homestandDerivation** | **Silently changes** | Homestand span tightens to GAME range | Confirm caption preview |
| Ops Labor SeasonPlanner (Sheets-fed) | Harmless (different store) | No change to PG-scoped ops-labor | Update seeder to filter |
| MonthCard noService | Silently changes | Simpler, semantically better | None |
| Workspace `isServiceDay` "prep" | Harmless | Dead check | Dead-code trim |
| resolveDayStatus `"prep"` | Dead | Dead branch | Dead-code trim |
| Legend "Non Game day" | Dead text | Misleading description | Copy update |
| Export workbook | Harmless | Filters cheaper | None |

---

## Task 2 - Value pressure-test

Kevin's framing: "internal scaffolding, safe to remove." Pressure-testing honestly, ordered from strongest evidence of real value to weakest.

### 2.1 - EVIDENCE THAT PREP CARRIES REAL DATA (found in the codebase)

**SC-078 ruling (2026-07-09, commit series #365-367)** documented in `src/lib/dataStore/serviceCalendar.js:198-208` and `docs/DESIGN_AUDIT_LEDGER.md:173`:

> SC-078 (owner ruling 2026-07-09): entry beats schedule. The pre-Round-3 shape returned "prep" for any non-game day the moment the schedule said so, ignoring hasAct - so an entered non-game day **(Jun 26 repro: 10 meals recorded)** stayed beige.

Kevin himself recorded 10 meals on a non-game day and specifically requested a UX change to surface it as `entered` (green) instead of `prep` (grey). That's an existing operational reality: **Kevin sometimes serves meals on non-game days.** SC-078 is the mechanism protecting those entries.

Deleting the schedule rows silently voids SC-078: the tile now returns `off-season` because there's no schedule row at all. Kevin's Jun 26 case would show as an invisible grey tile despite 10 meals still in `sc_daily_actuals`.

**Verdict:** PREP CAN carry real data. Before delete, Kevin MUST know which dates have actuals.

### 2.2 - Projections attached to PREP/OPEN/CLOSE

From `/tmp/sc-audit/proj_gap.csv` (pre-sc-12 snapshot of 408 sc_homestand_schedule rows joined against sc_daily_projections):

| day_type | rows | rows with projections | rows with non-zero projected_total | sum(projected_total) |
|---|---:|---:|---:|---:|
| GAME | 324 | 324 | 321 | 60,372 |
| PREP | 70 | 70 | 1 | 180 |
| OPEN | 6 | 6 | 0 | 0 |
| CLOSE | 8 | 8 | 0 | 0 |
| CLEAN | 0 | - | - | - |

Every PREP/OPEN/CLOSE row has ~4 projection rows attached, but all projected_count = 0 EXCEPT one PREP row: **CIN-OH 2026-06-22, projected_total=180 with meta_game_type=HOME.** That's the sc-12 R3 correction case - Kevin had projections for what he KNEW was a game day (6/22 MIL), but the schedule was mis-flagged PREP. sc-12 corrected it to GAME.

Post-sc-12, this single non-zero PREP projection resolves. Every remaining PREP/OPEN/CLOSE row has `projected_count = 0` across all services.

**Verdict:** projections are template noise (zero-count shells), not real ops data. Delete-safe.

**But** deleting the schedule rows leaves ~336 zero-count projection rows orphaned (70 PREP × ~4 + 6 OPEN × 4 + 8 CLOSE × 4 = 336, minus PREP CIN-OH 6/22 which sc-12 already reclassified). They still appear in `sc_daily_revenue` (view unioning projections + actuals) and inflate `sc_month_summary.total_service_days`. Kevin should decide whether to also DELETE the projection rows for those dates.

### 2.3 - Actuals attached to PREP/OPEN/CLOSE - THE MUST-PROBE

I have no local dump of `sc_daily_actuals`. The SC-078 comment is direct evidence that at least one date (Jun 26 CIN) has recorded actuals on a non-game day. There may be others.

**Kevin MUST run Probe B (Appendix) in Studio before sc-14.** It enumerates every date that carries non-zero actuals on a PREP/OPEN/CLOSE day. Those dates are the delete-blockers - Kevin needs to decide their disposition (see blocking question 2 in TL;DR).

### 2.4 - Notes attached to PREP/OPEN/CLOSE

`sc_day_note_entries` was added in sc-9 (SC-079, 2026-07-09). A note on a PREP date would be lost from the calendar view if the schedule row is deleted (though the ledger row itself persists).

**Kevin should run Probe C (Appendix)** to check for notes on PREP/OPEN/CLOSE dates. Low priority - notes are less operationally critical than actuals - but worth knowing.

### 2.5 - OPEN and CLOSE specifically

Semantic per `sc-2-homestand-schedule.sql` comments: OPEN = "first day the ballpark opens for a homestand," CLOSE = "last day the ballpark is open." These are structural markers, not ops workflow days.

The Ops Labor SeasonPlanner text (`3 games, 1 open, 1 close`) is the only user-visible surface using OPEN/CLOSE. Since Ops Labor reads from Sheets (not PG), the SC-14 PG delete doesn't affect it.

**Verdict:** OPEN/CLOSE are cleanly structural. Delete-safe from an SC perspective. Ops Labor decision separate.

### 2.6 - Final honest read on the framing

Kevin's "internal scaffolding, safe to remove" is **mostly true but not entirely.**
- OPEN, CLOSE, CLEAN, and the ~99% of PREP that are Jun-26-style "no real entries" ARE scaffolding. Delete-safe.
- **The N PREP dates that carry recorded actuals are NOT scaffolding.** They are real ops-entered data. Probe B enumerates them; Kevin decides per case.

---

## Task 3 - Interaction with sc-13 (PR #389)

### 3.1 - The 35 conflicts dissolve

sc-13's ON CONFLICT strategy preserves 35 existing PREP/CLOSE rows because they collide with AWAY inserts on the same date. If sc-14 removes PREP/OPEN/CLOSE:

- CIN-OH: 9 conflicts → 0 conflicts → CIN-OH gets 81 clean AWAY rows (up from 72).
- STL-MO: 6 → 0 → 81 clean AWAY (up from 75).
- TXR-TX-H: 10 → 0 → 81 clean AWAY (up from 71).
- TXR-TX-V: 10 → 0 → 81 clean AWAY (up from 71).

**Yes, they fully dissolve.** Post-sc-14 the AWAY load is 100% clean, no conflict handling needed.

### 3.2 - Sequencing options

**Option A - keep sc-13 as-is, run sc-14 later:**
- sc-13 merged now → 72-75 AWAY per account (35 dates left as PREP/CLOSE).
- sc-14 later → deletes the 35 dates → those dates have NO row (should have been AWAY).
- Ugly intermediate state; sc-14 has to ALSO re-INSERT AWAY for the 35 dates.
- Two-migration coordination; higher blast risk.

**Option B - hold sc-13, run sc-14 first, then sc-13:**
- sc-14 → 84 rows delete across 4 accounts (70+6+8 = 84 total).
- sc-13 → clean 81 AWAY per account, no conflicts.
- Cleaner but sc-13 is currently open and Kevin might want the AWAY load sooner rather than later.

**Option C (RECOMMENDED) - fold sc-14 into a revised sc-13:**
- Single migration in this order: schema alters → DELETE PREP/OPEN/CLOSE rows → INSERT AWAY rows → HOME game_pk backfill.
- Zero intermediate state, single transaction.
- The PR #389 body's 35-row conflict enumeration becomes moot - none exist to enumerate.
- The migration's ON CONFLICT can simplify to plain `DO NOTHING` since no dates collide.

### 3.3 - Concrete revised-migration shape

If Kevin approves Option C, revise `docs/migrations/sc-13-away-schedule-load.sql`:

```sql
BEGIN;

-- (1) day_type CHECK expansion - AWAY added, PREP/OPEN/CLOSE/CLEAN
--     RETAINED so historic data restoration paths stay valid. Only
--     the row DATA is deleted; the schema domain stays wide.
ALTER TABLE sc_homestand_schedule ...
  CHECK (day_type IN ('GAME','PREP','OPEN','CLOSE','CLEAN','EXHIBITION','AWAY'));

-- (2) homestand_id DROP NOT NULL (same as current sc-13)

-- (3) game_pk column + partial UNIQUE (same as current sc-13)

-- (4) COMMENT ON TABLE (updated language about the removal)

-- (5) NEW: DELETE PREP/OPEN/CLOSE rows.
--     Requires Kevin to have run Probes B + C first and made
--     dispositions for any actuals-carrying dates.
DELETE FROM sc_homestand_schedule
 WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
   AND day_type IN ('PREP','OPEN','CLOSE','CLEAN');

-- (6) AWAY inserts (cleaner - can drop the conflict WHERE clause)
INSERT INTO sc_homestand_schedule ...
ON CONFLICT (account_key, service_date) DO NOTHING;

-- (7) HOME game_pk backfill (same as current sc-13)

COMMIT;
```

Plus code-side dead-code trims (dayResolvers `"prep"` case, ServiceCalendar `isServiceDay` `"prep"`, legend "Non Game day" copy) folded into the same PR.

### 3.4 - My recommendation

**Option C.** Cleanest end state, single migration, no intermediate ambiguity, no coordination burden. PR #389 is unmerged so revising it costs nothing.

If Kevin prefers to ship sc-13 as-is (AWAY load first, sc-14 later), that's fine too - Option A - but the 35-row conflict enumeration in the PR body becomes a followup punch list.

---

## Task 4 - Recommendation + scope

### 4.1 - Recommended scope: data-only DELETE + minimal code cleanup

- **Data:** DELETE PREP/OPEN/CLOSE (and CLEAN, if any) rows from `sc_homestand_schedule` for the 4 MLB fee accounts.
- **Schema:** DO NOT shrink the `day_type` CHECK. Keep the domain wide so historic data can be restored if needed. The unused values are cheap to leave in the check.
- **Code:** minor dead-code trims - `dayResolvers.js` `case "prep":`, `ServiceCalendar.js` `isServiceDay` `"prep"` check, `legendItems.js` "Non Game day" copy. All are one-line changes.
- **Seeder:** update `_seed_sc_homestand_schedule.mjs` to filter Sheets rows to `dayType === 'GAME'` before writing to PG. Prevents accidental restoration.

**Why not full removal (schema+code+values):**
- Shrinking the CHECK domain (removing `'PREP'` etc.) means a future "put them back" is a schema migration, not a data insert. Kevin doesn't need this flexibility today but the cost of keeping it is essentially zero.
- Deleting the classifier's `"prep"` return string requires more code care (statusPhrase, resolveDayStatus, StateLegend, etc.). Minor cleanup, not urgent.

### 4.2 - Backup before delete

Yes. Before Kevin runs the DELETE, dump the rows being deleted to a doc for restore-if-wrong safety:

```sql
-- Run in Studio, save the output as docs/audits/sc-14-deleted-rows-snapshot.csv
SELECT account_key, service_date, day_of_week, day_type, opponent, homestand_id
  FROM sc_homestand_schedule
 WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
   AND day_type IN ('PREP','OPEN','CLOSE','CLEAN')
 ORDER BY account_key, service_date;
```

Expected ~84 rows. Reversible via a follow-up INSERT if anything surfaces after the delete.

### 4.3 - Migration sequencing (final)

Based on Task 3's Option C recommendation and the safety findings above:

1. Kevin runs **Probe A + B + C** (Appendix) in Studio to enumerate any orphan-risk data.
2. Kevin decides disposition for any actuals-carrying PREP/OPEN/CLOSE dates.
3. Kevin dumps the pre-delete snapshot CSV.
4. Kevin closes / revises PR #389 to fold in sc-14 per Option C's shape.
5. New PR contains revised `sc-13-away-schedule-load.sql` (with DELETE), code trims, seeder update, deleted-rows snapshot.
6. Kevin runs the revised migration in Studio.
7. Verify via probes A-E from the original sc-13 doc PLUS a new probe: `SELECT day_type, COUNT(*) FROM sc_homestand_schedule GROUP BY day_type;` - expect only GAME + AWAY + EXHIBITION.

---

## Appendix - Probes Kevin must run before sc-14

### Probe A - what would be deleted (row count + dump)

```sql
-- Enumerate every candidate row for the deletion
SELECT account_key, day_type, COUNT(*)
  FROM sc_homestand_schedule
 WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
   AND day_type IN ('PREP','OPEN','CLOSE','CLEAN')
 GROUP BY account_key, day_type
 ORDER BY account_key, day_type;
```

Expected roughly:
- CIN-OH: PREP=20, OPEN=2, CLOSE=2
- STL-MO: PREP=16, OPEN=2, CLOSE=2
- TXR-TX-H: PREP=17, OPEN=1, CLOSE=2
- TXR-TX-V: PREP=17, OPEN=1, CLOSE=2

Total ~84 rows.

### Probe B - CRITICAL: dates with real actuals on PREP/OPEN/CLOSE

```sql
SELECT hs.account_key,
       hs.service_date,
       hs.day_type,
       COUNT(a.id)                AS actuals_rows,
       SUM(a.actual_count)        AS total_actual_meals,
       MAX(a.updated_at)          AS last_write
  FROM sc_homestand_schedule hs
  JOIN sc_daily_actuals a
    ON a.account_key = hs.account_key
   AND a.service_date = hs.service_date
 WHERE hs.day_type IN ('PREP','OPEN','CLOSE','CLEAN')
   AND hs.account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
 GROUP BY hs.account_key, hs.service_date, hs.day_type
HAVING SUM(a.actual_count) > 0
 ORDER BY hs.account_key, hs.service_date;
```

**Any row this returns is a delete-blocker.** Kevin's Jun 26 CIN case (10 meals recorded) should surface here. For each row, Kevin decides:
- (a) Reclassify to GAME (if the day genuinely was a service day and the schedule was mis-flagged).
- (b) Keep the actuals in the ledger, drop the schedule row (data becomes invisible in the calendar tile but still queryable).
- (c) Delete the actuals too (destroys the record - only if genuinely erroneous).

### Probe C - notes on PREP/OPEN/CLOSE

```sql
SELECT hs.account_key,
       hs.service_date,
       hs.day_type,
       COUNT(n.id)  AS note_rows,
       MAX(n.created_at) AS last_note
  FROM sc_homestand_schedule hs
  JOIN sc_day_note_entries n
    ON n.account_key  = hs.account_key
   AND n.service_date = hs.service_date
 WHERE hs.day_type IN ('PREP','OPEN','CLOSE','CLEAN')
   AND hs.account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
 GROUP BY hs.account_key, hs.service_date, hs.day_type
 ORDER BY hs.account_key, hs.service_date;
```

Notes persist in the ledger regardless. If any surface here, Kevin should confirm they're either (a) about PREP-workflow context that no longer matters, or (b) about actuals we should preserve visibility for.

### Probe D - projections that would be orphaned

```sql
SELECT hs.account_key,
       hs.service_date,
       hs.day_type,
       COUNT(p.id)                AS projection_rows,
       SUM(p.projected_count)     AS total_projected
  FROM sc_homestand_schedule hs
  JOIN sc_daily_projections p
    ON p.account_key = hs.account_key
   AND p.service_date = hs.service_date
 WHERE hs.day_type IN ('PREP','OPEN','CLOSE','CLEAN')
   AND hs.account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
 GROUP BY hs.account_key, hs.service_date, hs.day_type
 ORDER BY hs.account_key, hs.service_date;
```

From the sc-12 audit's proj_gap.csv, expect ~336 zero-count projection rows across ~84 dates. **All are template noise** (projected_count = 0). Optional: fold a `DELETE FROM sc_daily_projections WHERE (account_key, service_date) IN (...)` into sc-14 to prevent them ghost-inflating `sc_month_summary.total_service_days`.

### Probe E - post-delete verification

Run AFTER sc-14 lands:

```sql
SELECT account_key, day_type, COUNT(*)
  FROM sc_homestand_schedule
 WHERE account_key IN ('CIN - OH','STL - MO','TXR - TX - H','TXR - TX - V')
 GROUP BY account_key, day_type
 ORDER BY account_key, day_type;
```

Expected post-sc-14 (folded into sc-13):
- CIN-OH: GAME=81, AWAY=81 → 162 total
- STL-MO: GAME=81, AWAY=81 → 162 total
- TXR-TX-H: GAME=81, AWAY=81, EXHIBITION=2 → 164 total
- TXR-TX-V: GAME=81, AWAY=81, EXHIBITION=2 → 164 total

Total 652 rows across 4 accounts (vs 408 pre-sc-13). Every row is a real MLB schedule event.

# TBJ - FL MLB Dinner entered in September (out of season)

**Filed:** 2026-09-08. Discovered while dry-running an actuals restore
after Kevin's bulk-reset test on the toast-scope-fix PR.
**Status:** Deferred. Not blocking; noting so it is not rediscovered
as a mystery later.
**Trigger to unpark:** anyone investigating a TBJ MLB service billing
discrepancy or a per-account Dinner-service audit.

---

## What was found

TBJ - FL catalog has **two active services both named "Dinner"** in
different groups:

- `4ade53a5-02f9-4061-97d9-8b00184f6467` - "Dinner" in group
  **Minor League - PDC**.
- `677b3e6b-7ca2-474d-903f-89c4d1ec3b7b` - "Dinner" in group
  **Major League - PDC**.

Both have `active = true` and `active_until = null` (year-round in
the catalog).

`sc_daily_actuals_history` `change_type = 'delete'` rows for
2026-09-14, 15, 16, 17 (from Kevin's bulk-reset test) show BOTH
Dinner services carried a non-zero count of **6 meals** on each of
those four days.

## Why this reads as anomalous

Per the standing rule at [`docs/backlog/seasonal-window-gap.md`](seasonal-window-gap.md)
and Kevin's ruling recorded in the reconciliation audit
([`docs/audits/SC_BILLING_RECONCILIATION_2026-09-04.md`](../audits/SC_BILLING_RECONCILIATION_2026-09-04.md)):
**MLB is spring-training only at TBR and TBJ.** Services exist
year-round in the catalog with `active_until = null`, but the actual
service window is spring training (roughly late-February to
late-March at TBJ).

September is post-ST. An MLB Dinner recorded on Sep 14-17 is either:

- **Test noise** - someone poked values into the MLB Dinner rows
  during pre-training QA and never cleared them. Bulk reset then
  captured them as delete history.
- **An undocumented exception** - a real MLB service event (media
  day, off-season workout meal, executive visit) that ran through
  the MLB Dinner service by convention.
- **A silent input-classification error** - the operator meant to
  enter something under the MiLB Dinner but typed into the MLB
  Dinner row by accident. The two services having the same name
  makes this easy.

## Why it wasn't chased

Kevin restored the four days himself with 396 / 412 / 396 / 412 day
totals - matching the MiLB Dinner variant only, dropping the MLB
Dinner. So the state of record now matches the "MLB Dinner should
not exist for these September days" reading. The historical
question of how the MLB Dinner rows landed there in the first place
is left for a future forensic pass if someone hits an adjacent
mystery.

## What the durable fix would be

Independent of this specific incident, the "two services with the
same display name" shape is a problem the operator surface should
prevent. Options if this ever needs building:

- **Server-side unique constraint on `(account_key, service_name)`
  for active services.** Prevents new dupes going forward; doesn't
  address existing.
- **Client-side warning at write time** if the operator's typed
  value would create the two-active-Dinners state.
- **Archive one of the two.** Whichever is less-used gets
  `active_until` set. TBJ's MLB Dinner is a candidate given the
  MLB-is-ST-only fact - archive it and re-open in the future ST
  window if actually needed.

None of these are urgent. Flagging the shape so a future feature
that reads service names (Sous drill-down, invoice line-item
grouping, chase-ladder templating) knows two-Dinners is a live
data state on TBJ - FL, not a bug in the query.

## Related

- [`docs/backlog/seasonal-window-gap.md`](seasonal-window-gap.md) -
  the schema-level version of the same principle: MLB services on
  PDC accounts carry `active_until = null` year-round but only
  actually run in spring training.
- [`docs/audits/SC_BILLING_RECONCILIATION_2026-09-04.md`](../audits/SC_BILLING_RECONCILIATION_2026-09-04.md)
  §5 - "MLB is spring-training only" as a standing fact.
- [`serviceCalendar.js:326-333`](../../src/lib/dataStore/serviceCalendar.js)
  classifier note - Kind 1 vs Kind 2 "no-service" conflation. If
  MLB Dinner rows exist with actuals in the summer, the classifier
  reads them as `entered` regardless of season window - it doesn't
  know MLB is ST-only, that's schema-implicit knowledge.

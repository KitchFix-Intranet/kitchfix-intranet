# Seasonal-window gap - MLB services at PDC accounts are spring-training-only

**Filed:** 2026-09-04, from the reconciliation audit's §5 standing
facts.
**Status:** Deferred. Its own PR after training week.
**Trigger to unpark:** the first year-round chase or the first
finalize week that carries MLB units outside spring training. Either
signals the year-round premise is producing phantom nags or phantom
bills.

---

## What this closes

**MLB services at both TBR and TBJ run only in spring training,
but the catalog carries them with `active_until = null`** - the
sentinel for "active forever." Everything downstream reasons off a
year-round premise that is false:

- The chase ladder will nag on MLB days outside spring training.
- The finalize path will accept MLB units on any day and bill
  them.
- The reconciliation math treats out-of-season MLB rows as
  billable revenue that never posted.
- Sous will answer questions about "MLB revenue in July" with a
  number that includes zeros for days the service structurally
  cannot run.

The gap is not a bug you can point to; it is a schema shape that
lets the wrong thing happen everywhere at once.

## What must ship

**Option 1 - windowed active_until on the service itself.** A
service carries a per-season active window: `active_from DATE`
and `active_until DATE`, both nullable, both required for MLB
services at PDC accounts. Views and readers that today check
`active_until IS NULL OR active_until >= <date>` extend to also
check `active_from IS NULL OR active_from <= <date>`. The current
`active_until` semantics (NULL = forever) stay for services that
truly are year-round.

**Option 2 - phase overlay** using `sc_phase_calendar` (already
exists, `sc-11` migration). Services carry a `phase_scope` array;
a service scoped to `spring_training` is only active on dates
falling inside a spring-training phase for the account. This
reuses infrastructure already built for the export's BY PHASE
table.

Option 1 is simpler; Option 2 is truer to how PDC accounts
actually think about the year. Kevin picks before build.

Either way the surfaces that must respect the window are:

- `sc_daily_revenue` view - date must fall inside the service's
  window for the row to compute revenue.
- `sc_month_summary` view - same.
- Finalize's `buildInvoicePayload` - if a week carries units on a
  date outside the window, THROW (the same pattern the unmapped
  QBO items use), do not silently drop.
- Chase ladder - out-of-window days for a service are not
  "missing"; they should not fire N3.1 or N3.2 for that service.
- Export - out-of-window services do not appear in that period's
  daily detail; do appear in the year-scope BY PHASE table
  because that is where phase-scoped services belong.
- Sous - a question about "MLB revenue for July" should be
  answered as "MLB is spring-training only; July carried zero MLB
  service days at TBR and TBJ" not with a naked zero.

## What this DOES NOT do

- Does not touch services at per-meal MLB or MiLB affiliate
  accounts (STL - MO, CIN - OH, TXR - AZ) where the service is
  actually year-round or actually the whole season.
- Does not touch fee schedules. Fees at PDC accounts already carry
  effective-dated windows via `sc_fee_schedule`; this is only a
  service-catalog concern.
- Does not backfill existing off-window rows. Any prior data that
  landed against MLB services outside spring training stays as
  historical; the window is enforced going forward.

## The three affected weeks the reconciliation named

TBJ's Media Meals, Scout Meals, and MLB - Catering carry units in
weeks Jan 26, Feb 16, and Jun 1 (per `SC_BILLING_RECONCILIATION_2026-09-04.md`).
The Jun 1 week is out of MLB spring training window; the Jan +
Feb weeks are in-window. This bug lives alongside the
seasonal-window gap: even the in-window weeks fail finalize today
because the item map is empty for those three services (see
go-live checklist item 6 in `PROJECT_DASHBOARD.md`). Landing the
service map first tests whether the seasonal-window gap manifests
in production before this PR is prioritized.

## Pointers into the code

- Catalog: `sc_services` - columns `active`, `active_until`. Add
  `active_from` for Option 1, or `phase_scope text[]` for Option 2.
- Effective-dated view: `docs/migrations/sc-6b-*.sql` (baseline)
  + any later view recreates. Both views need the window join.
- Finalize: `src/lib/sc-billing/buildInvoicePayload.js` - the
  rule-2 branch that today enforces the item map. Add rule 2c:
  service out-of-window on this date → THROW.
- Chase ladder: `src/lib/sc-billing/chaseLadder.js` - the
  per-service "did this run today" predicate.
- Phase table (Option 2): `sc_phase_calendar`, 48 seeded rows for
  the 5 PDC accounts.
- Related standing fact: `SC_QBO_ITEM_MAP.md` MLB / spring
  training note.

## Related backlog

- `docs/backlog/sc-input-sweep-nine-files.md` - the entry surfaces
  need the same out-of-window validation on submit; the fix here
  ripples into that sweep.

## Discipline note

The gap is a canonical case of "the schema shape lets a class of
mistake through." Sous getting this wrong is the visible symptom;
the finalize path and chase ladder failing quietly is the
dangerous one. Do not defer this past the first live MLB week
where out-of-window units show up - the earliest such fire is
2027 spring training. If Kevin flips TBR + TBJ to `qbo_mode='live'`
before that, the gap is theoretical for the remainder of 2026.

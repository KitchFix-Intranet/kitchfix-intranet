# Amount-type services - operators enter a dollar figure, not a unit count

**Filed:** 2026-09-04. Previously named "PR-T" in the arc's
threading.
**Status:** Deferred until after training week.
**Trigger to unpark:** the Fun $$$$ Allocated line at any account
carries a non-zero value in a period. Today that line has no
sensible entry surface because the entry form only accepts unit
counts, and Fun $$$$ has no "unit."

---

## What this closes

Every SC service in the catalog today models entry as
**units × rate = revenue**. The rate is a dollar value per unit;
the operator enters units on the day; revenue is derived. This
shape breaks for services where there is no natural unit and the
operator has a specific dollar amount to record - Fun $$$$
Allocated is the canonical case (a discretionary spend budget
Kevin allocates per period; the operator enters what they spent).

Amount-type services flip the input contract: the operator enters
a dollar figure directly; there is no unit; there is no rate
math; revenue = the entered amount.

## What must ship

- Schema: `sc_services.input_kind` (text, NOT NULL, DEFAULT
  'units', CHECK constraint on `('units', 'amount')`). Migration
  is a one-column additive; existing rows all default to 'units'.
- Entry form (`DayEntryV2` / `DayDetail`): read `input_kind` per
  service; render an amount field ($ prefix, 2-decimal input) for
  `input_kind='amount'` instead of the unit stepper. Amount goes
  into a new `amount_cents` column on the actuals table, or
  reuses the unit column if the storage shape can carry both -
  Kevin picks before build.
- Effective-dated view: for `input_kind='amount'` services, revenue
  is the entered amount, not `units × rate`. The rate column
  stays for schema regularity but is ignored on the read side.
- Export: amount rows render as a dollar figure in the Daily
  detail tab; the unit column shows "-" for that row.
- Chase ladder: unchanged - a day with no entry is still overdue
  regardless of input_kind. Amount services are just a different
  entry shape, not a different lifecycle.
- Reconciliation: amount services do not go through the finalize
  invoice payload (they are not billed - Fun $$$$ Allocated is
  spend, not revenue-to-client). Confirm with Kevin whether any
  amount-type service is ever billable; if not, the finalize path
  can skip them wholesale.

## What this DOES NOT do

- Does not touch the projected-vs-actual revenue distinction; both
  layers still exist, they just carry an amount instead of a
  units × rate product for amount services.
- Does not add a general-purpose custom-formula input kind. If a
  future service needs `units × rate × modifier`, that is a
  different PR. Amount-type is the minimum expressive extension
  that fits the current use.
- Does not affect fees (`sc_fee_schedule`). Fees are already flat
  dollar amounts per period on the accounts that carry them.

## Fun $$$$ Allocated - the driving case

- **Where it lives:** `sc_services` row per PDC account named
  "Fun $$$$ Allocated" (or similar - name varies by account).
- **What it represents:** Kevin's per-period discretionary spend
  allocation for the site (jerseys, event costs, gifts).
- **Why it does not fit units × rate:** the amount is
  event-specific and one-off; there is no unit count that would
  produce it via multiplication.
- **Where it appears today:** in the catalog but with a fake $1
  rate so the operator enters cents-as-units when they need to
  record a value. That workaround is the reason this ticket
  exists.

## Pointers into the code

- Catalog: `sc_services`.
- Entry components: `src/app/service-calendar/day/DayEntryV2.js`,
  `DayDetail.js`, the unit stepper primitive.
- Actuals persistence: `src/lib/dataStore/serviceCalendar.js`
  `sc-submit-day` handler + `sc_daily_actuals` schema.
- Effective-dated view: whatever the current recreate of
  `sc_daily_revenue` is.
- Export: `src/app/api/service-calendar/export/route.js` +
  `src/lib/exportWorkbook.js` (or wherever the daily-detail
  builder lives; verify the current path).

## Related backlog

- `docs/backlog/sc-input-sweep-nine-files.md` - the amount input
  surface is one of the nine input pathways that need server-side
  validation; the two land close together in the same code area.

## Discipline note

The Fun $$$$ workaround (fake $1 rate, cents-as-units) is a
schema shape that lets the wrong number get entered by accident.
Same class as the seasonal-window gap: the surface is expressive
enough to accept the wrong thing. Amount-type input kind is the
surface-level fix so the operator cannot mis-enter by construction.

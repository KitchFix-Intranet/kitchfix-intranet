# SC -> KPI Dashboard Push Contract

**Status:** Spec / pre-build. Defines what the Service Calendar owes the KPI dashboard. The KPI dashboard itself is a separate future project; this doc is the contract it consumes. **Money-model authority: [`SC_MONEY_MODEL.md`](SC_MONEY_MODEL.md).** Strategy context in `SC_LENS_VISION.md`; revenue-model detail in `SC_BILLING_MODEL_AUDIT.md`.

Note (2026-07-09): the §"Critical: actuals use the contracted rate" text below is CORRECT and describes the intended math. It assumed the pre-sc-8b state where `sc_service_prices` `'projected'` held sticker prices and `'actual'` held the contracted rate. In practice, since 2026-06-16, `'projected'` holds the post-SF invoice rate directly (Kevin's out-of-band correction). Post-sc-8c (see `docs/migrations/sc-8c-remove-double-discounted-actuals.sql`), the `'actual'` rows are removed and the view's COALESCE fallback prices actuals at `'projected'` = the post-SF invoice rate = the correct P&L 2400.1 Meal Service line. The KPI push math below lands correctly once sc-8c is applied.

---

## Why this contract exists

KitchFix twice built a Weekly Forecast / KPI Tool (2025, 2026): a weekly forecast-vs-actual P&L per account, letting operators track week / month / YTD against the monthly P&L. The concept was sound. Both versions failed for one reason: **the data was hand-entered by finance, downstream, with lag** - accounting lagged, numbers got entered wrong, and when the assistant accountant left, the 2026 version stalled and leadership declined to keep funding a tool whose data was never trustworthy or timely.

The Service Calendar fixes this failure mode **for the revenue band specifically**: operators enter headcount as part of normal planning, revenue computes live in Postgres, and it flows to the dashboard automatically - no accountant, no lag. The cost bands (labor, food, etc.) remain a separate integration problem and are explicitly out of SC scope.

---

## What the SC pushes (the Revenue band)

**Fields - the three-line revenue breakdown** (matches the P&L exactly; the SC already computes all of it):
- `2400.1 Meal Service (Home)` - headcount x service price.
- `2300 Service Charges` - the contracted service-charge / tax component (e.g. CIN-AZ's 30% line). Included in topline per the P&L.
- `2200 Catering Revenue` - account-specific.
- Total revenue (sum of the three).

For each line, BOTH:
- **Forecast** (from projections / planned headcount).
- **Actual** (from entered actuals, at the correct contracted rate - see below).

**Companion volume fields:**
- Forecast meal counts and actual meal counts (the SC's meal-count totals).
- Per-meal revenue ratio (revenue / meals) - the SC can compute this from its own data; the cost-side per-meal ratios (labor/meal, food/meal) come from other pipelines.

**Grain:** weekly -> period. The dashboard's primary review cadence is period review built from weekly data. Push at weekly granularity, rolled to period.

**Scope of accounts:** all 11 accounts, each with its account-type-appropriate revenue shape (per-meal accounts use the three-line breakdown; flat-fee accounts like STL-FL use the phase-aware prorated allocation - see below).

---

## Critical: actuals use the contracted rate, not sticker

The SC's ACTUAL revenue must apply each account's contracted rate so it matches the P&L and the invoice - NOT the projected/sticker price. Per `SC_BILLING_MODEL_AUDIT.md`:
- **CIN-AZ:** actuals at 70% of projected price (contracted discount).
- **TBR-FL:** actuals at 75% of projected price (25% MiLB amortization discount, confirmed still applied in 2026).
- **STL-FL (flat-fee):** revenue is NOT per-meal (its per-meal prices are $0 by design). Push the phase-aware prorated period allocation from the P&L pattern (P1 $45,553 ... P3 $407,375 ... FCL plateau $98,915 ... offseason $0).
- **MLB flat-fee (CIN-OH etc.):** single Meal Service line = the flat fee; no service charges, no passthrough.

If the push used sticker prices for actuals, the dashboard would overstate revenue vs the P&L - the exact "data doesn't match what we hold them to" failure the old tool had.

---

## What the SC does NOT push (explicitly out of scope)

- **COGS** - Kitchen Labor (hourly + salary), Food Costs (general + resale), Packaging & Supplies, Delivery, Vehicle.
- **SG&A.**
- **Gross Margin / Contribution Margin** (derived downstream once costs are assembled).

These bands assemble in the dashboard from OTHER pipelines:
- Labor from payroll (Rippling).
- Food / packaging cost from invoices / vendor data.
- SG&A from accounting.

The SC's contribution is the trustworthy, real-time **Revenue band**. The dashboard combines it with the cost bands from their own sources to produce the full Budget-vs-Actual P&L view leadership uses.

---

## Trigger (to finalize when Stage 3 is scoped)

The push grain is weekly->period. The trigger mechanism (live-on-entry vs on a day/week-close action vs a scheduled job) is a Stage 3 decision. Leaning: revenue is available the moment actuals are entered, so a near-real-time push (on entry or on a lightweight close) is what removes the lag that doomed the old tool. Avoid a nightly-batch-only model if it reintroduces perceptible lag.

---

## Open items

- Finalize the push trigger (Stage 3).
- Confirm whether the dashboard wants the three-line breakdown per push (yes, per Kevin) or also a single rolled revenue number (cheap to include both).
- Define the exact handoff mechanism (PG view the dashboard reads vs an explicit push) when the dashboard project starts - the SC already exposes revenue via `sc_daily_revenue`; the dashboard may simply read period-rolled revenue from PG rather than needing a separate push pipeline.

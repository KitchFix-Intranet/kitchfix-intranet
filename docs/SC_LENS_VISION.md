# Service Calendar - Time-Lens System: Vision Brief

**Status:** Vision / pre-build. This is the north-star design and staged plan for the next major evolution of the Service Calendar (SC). It is the boss-facing artifact and the document CC builds toward across staged PRs. Reference docs (cited inline) hold the build-critical detail; this doc holds the strategy.

**Companion docs:**
- `SC_MONEY_MODEL.md` - the canonical money model. Wins conflicts on any pricing / invoicing / KPI question.
- `SC_PDC_PHASES.md` - the recorded PDC phase calendars + canonical vocabulary (source data for the Phase lens)
- `SC_KPI_PUSH_CONTRACT.md` - what the SC owes the KPI dashboard (the revenue-band push)
- `SC_BILLING_MODEL_AUDIT.md` - per-account billing mechanics (updated with resolutions from this work)
- `GOTCHAS.md` - hard-won traps (updated with phase-source and price-discount lessons)

The money-model text in §5.1 - §5.2 below (three-line revenue breakdown; per-account SF% + flat-SF + flat_fee mechanics) is CORRECT and agrees with `SC_MONEY_MODEL.md`; that doc is the go-forward reference where language differs.

---

## 1. The thesis

The Service Calendar is becoming the tool operators use to **run their business** - sit down, look at their schedule, headcounts, and revenue, and plan their labor and spend. Two truths drive the whole design:

**Truth 1 - It replaces a fragile spreadsheet.** Operators today plan in a large per-account Service Calendar spreadsheet. The legacy-spreadsheet audit documented why that tool fails: it breaks when anyone touches a formula (a live $0.50/meal error exists in TBR-FL's B&G tab today), it has zero data validation (type "OFF" into a count -> silent zero; type 70000 -> a $2M day), it has ~10 distinct silent-corruption modes, it is intimidating to non-spreadsheet-skilled operators (who are reduced to "type a number, read a total, then plan on paper"), and it is slow. The concept is right; the medium is broken.

**Truth 2 - It is the real-time revenue engine the KPI tool never had.** KitchFix twice built a Weekly Forecast / KPI Tool (2025, 2026) - a weekly forecast-vs-actual P&L per account that operators could use to track week / month / YTD against the monthly P&L. The concept was good. It failed for a data-pipeline reason: finance updated it by hand, downstream, with lag; accounting lagged; numbers got entered wrong; when the assistant accountant left, it died, and leadership correctly declined to pour resources into a tool whose data was never trustworthy or timely. The SC fixes the exact failure mode for the revenue half of that P&L: operators enter headcount as part of their normal planning, revenue computes live in Postgres, and it flows to the dashboard with no accountant and no lag.

**The pitch in one line:** the Service Calendar makes powerful, period-aware business planning accessible to every operator regardless of spreadsheet skill, and becomes the trustworthy real-time revenue engine that feeds KitchFix's KPI reporting - killing the manual-entry lag that doomed every prior attempt.

---

## 2. The locked frame

These are settled and should not be re-litigated without cause.

- **It is a planning tool, not a service-floor tool.** Operators use it sitting down to run their business, occasionally on a phone for a quick number check, but the design target is the planning session, not the 38F-walk-in quick glance. Power and multiple views are operator-first *here* because planning is inherently multi-dimensional.
- **Operator-scoped depth, universal breadth.** Each operator works their own account in full depth, with the lenses that match their account type. But everyone retains access to all accounts for coverage, cross-training, and takeover. This is a *default-focus* difference, not a permissions split.
- **Lenses are task-driven tools, not sticky preferences.** The same operator picks up different lenses for different decisions: an MLB chef uses the Homestand lens to plan labor (staff the game series) and the Period lens to plan spend (budget across the multiple homestands that fall in one period). The lens is a tool you pick up and put down as the task changes, not a set-once preference.
- **The financial frame is central.** Headcount + revenue per the planning unit is the product. It feeds business decisions and pushes one-directionally to the KPI dashboard.
- **The year heat-map is the landing zone.** Operators land on the overview of their year and drill into the lens they need. Overview first, then zoom (Shneiderman). Drill-down is by clicking the thing you want to see closer, not by toggling between disconnected screens; a breadcrumb ascends.
- **Scope boundary - the calendar ends at understanding.** It does not schedule labor (that is Rippling), place orders (vendor portals), or run the declining budget. It gives operators clean numbers to carry into those downstream tools. The calendar owns Revenue + headcount; it does not own COGS, labor, or any cost line.

---

## 3. The lens system

### 3.1 Two orthogonal axes

Navigation is two independent controls:
- **Scope = altitude** (full year <-> the current unit). The primary axis of motion, changed constantly.
- **Lens = grouping** (how time is carved). A quieter setting, changed as the task changes.

Scope is presented first (altitude is the verb); lens is the standing choice. They are not co-equal toggles - the prior mockups' weakness was treating them as equal.

### 3.2 Lenses are account-type polymorphic

The single most important architectural fact: **different account types live in different time-worlds, so the lens bar is dynamic per account.** A lens that does not map to an account's reality is not offered for that account (this is correct, not a gap).

| Lens | MLB / MiLB | PDC | Fee-only |
|---|---|---|---|
| **Period/Week** (payroll/billing backbone) | yes | yes | yes |
| **Work-unit** | Homestand | Phase | absent |
| **Season** (macro arc) | competitive arc | developmental calendar | absent/simple |
| **Month** (Gregorian fallback) | yes | yes | yes |

- **Period + Week** is the universal backbone - every account bills on the 13 fiscal periods. Week is NOT a separate top-level lens; it is demoted to sub-navigation inside the Period lens (a period shows its 4 weeks; click a week to focus it). This reinforces that week and period are one backbone.
- **The work-unit lens is polymorphic:** Homestand for MLB/MiLB (data in `sc_homestand_schedule`), developmental Phase for PDC (see `SC_PDC_PHASES.md`), absent for pure-fee accounts with no operational structure.
- **The Season lens is polymorphic:** the MLB competitive arc vs the PDC developmental calendar (which is the phase sequence at year scope).
- **Month** is the universal fallback and REUSES the already-shipped Year/Month views - it is not a new implementation. The shipped period ribbon lives here.

Note on STL-FL: it bills flat-fee but operates as a PDC (follows phases). Billing model and operational shape are independent axes. STL-FL gets the Phase lens (operational) with a contract-based financial frame (billing). This is the proof case that the two axes are independent.

### 3.3 The flow

- **Lens** = the persistent "how I think about time" choice (changed as the task changes - labor vs spend).
- **Scope/altitude** = the active motion, changed constantly by clicking to drill and breadcrumb to ascend.
- **Landing** = intent-aware. A floor operator lands on their account's current unit; leadership lands on the year overview. Role drives this (see 5.3).

### 3.4 The financial frame per lens

Each lens surfaces the financial framing that matches it - this is what makes the tool an operations-and-billing instrument rather than a generic calendar:
- **Period** -> billing-cycle revenue (where am I vs the period).
- **Work-unit** -> revenue per homestand (MLB) or per phase (PDC).
- **Season** -> revenue against contract / season target.

The financial frame is the north star; the build stages it (Period-lens financial frame first, since the data exists, then extend).

---

## 4. The phase architecture (PDC work-unit + season lens)

Full detail in `SC_PDC_PHASES.md`. The strategic shape:

- **Phases are RECORDED, not inferred, for 3 of 5 PDCs.** Operators type the phase into a "Camp Name" column in the spreadsheet. CIN-AZ, TXR-AZ, and TBR-FL have clean, dated, complete phase calendars sitting in that column. This replaces the meal-count inference approach for those accounts - read the column, do not infer.
- **TBJ-FL and STL-FL do not record phases** (TBJ uses the column for one-day event flags; STL's is blank). For these two, fall back to meal-signal inference (proven viable in the phase recons) plus Kevin's confirmation.
- **The build is a hybrid:** read recorded phases where present, infer + confirm where absent. The eventual `sc_phases` Postgres table can be seeded directly from the 3 recording accounts on day one.
- **The vocabulary is not standardized** across operators ("ACL" vs "FCL", "Instructs" vs "Camps", per-account names). The data model needs an alias -> canonical-phase mapping, not a clean shared enum.
- **Derive-then-record principle:** the same lesson as the fiscal periods - inference (or a recorded-but-messy column) seeds a draft, Kevin confirms, Postgres stores the clean truth. We do not bill or operate off an unconfirmed inference.

---

## 5. The financial + access model

### 5.1 The revenue model (confirmed against actuals through P6)

Revenue across all accounts uses three lines, consistent across the SC sheets, the budget P&Ls, the actuals-through-P6, and the legacy KPI tool:
- **2400.1 Meal Service (Home)** - headcount x service price.
- **2300 Service Charges** - the contracted service-charge / tax component (for CIN-AZ this is the 30% line; it is a SEPARATE revenue line, and it is INCLUDED in the P&L topline).
- **2200 Catering Revenue** - smaller, account-specific.

The SC already computes the meal-service revenue and the service-charge component, so it can push the same breakdown the P&L uses.

### 5.2 Per-account billing mechanics

Each account has its own contract mechanic (full detail + resolutions in `SC_BILLING_MODEL_AUDIT.md`). Key points for the financial frame:
- **CIN-AZ (per-meal PDC):** the SC spreadsheet pricing IS the agreed pricing. Actuals total = what is charged the client (the service fee is billed separately). Actuals prices are 70% of projected (a contracted discount baked into the actuals tab).
- **TBR-FL (per-meal PDC):** the 25% MiLB amortization discount IS still applied in 2026 (confirmed empirically - actuals are exactly 75% of projected). The tool must reproduce the discounted actuals to match the P&L. (Contract Term reconciliation is housekeeping for later; the math is settled.)
- **STL-FL (flat-fee PDC):** $1.4M annual, but spread PHASE-AWARE across the periods in the P&L (P1 $45,553 ... P3 peak $407,375 ... FCL plateau $98,915 ... offseason $0), all through Meal Service (Home). The financial frame drives STL-FL period revenue from this allocation, NOT from per-meal price x count (its per-meal prices are $0 by design).
- **MLB flat-fee accounts (CIN-OH etc.):** single Meal Service line, no service charges, no passthrough. The flat fee is the topline.

### 5.3 Roles + landing (data-driven, from Postgres)

Role data lives in the `contacts` table (`contacts.role`, free-text job titles), NOT in code. All 14 roles enumerate cleanly; the leadership tier matches the legacy hardcoded `SC_ADMIN_EMAILS` exactly. Intent-aware landing can be data-driven today:
- **Floor operator roles** (Executive Chef, Sous Chef, Chef De Cuisine, Hospitality Manager, General Manager) -> land on their `user_accounts.account`.
- **Leadership roles** (CEO, VP Operations, Director of Operations, Director of Culinary, Human Resources, Staff Accountant, Regional Director East/West) -> land on the year/overview.
- **Corporate Field Chef** -> context-dependent / either; give a sensible default with an easy pivot (Kevin: "both").
- Caveat: `contacts.role` is free-text, so the tool maps known strings to a controlled vocabulary (same pattern as phase aliases). A future `is_leadership` or tier column would make this safer but is not required to ship.

---

## 6. The KPI push contract

Full detail in `SC_KPI_PUSH_CONTRACT.md`. The strategic shape:
- **The SC owns and pushes the Revenue band** - the three-line breakdown (Meal Service, Service Charges, Catering), forecast and actual, at weekly -> period grain, for period review.
- **The SC does NOT push COGS, labor, SG&A, or margin** - those bands assemble from other pipelines (payroll, invoices, accounting) in the dashboard.
- **Why this matters:** the 2025/2026 KPI tools failed because the entire P&L, including the revenue band, was hand-entered with lag. The SC removes the lag from the revenue band specifically. The cost bands remain their own integration problem - explicitly out of SC scope.

---

## 7. Staged build plan

The full system is a multi-stage project that replaces the core of the SC. It is NOT one PR. Build the engine first, prove it on the universal spine, then extend.

**Stage 1 - The lens engine + Period lens + Month lens.**
The framework (scope/lens controls, click-to-drill, breadcrumb, intent-aware landing, uniform chrome). The Period lens (data exists - `sc_day_metadata.period` + `week_label` are populated). The Month lens (reuse the shipped Year/Month views + period ribbon). The Period-lens financial frame (revenue exists). Proves the model on the universal backbone. Week demoted to sub-nav inside Period.

**Stage 2 - The work-unit lens (polymorphic).**
Homestand for MLB/MiLB (data exists in `sc_homestand_schedule`). PDC Phase from the recorded Camp Name data (seed `sc_phases` from the 3 recording accounts; infer + confirm for TBJ/STL-FL). The work-unit financial frame (per-homestand, per-phase).

**Stage 3 - The Season lens + year-scope financial aggregations.**
Season (both shapes - MLB arc, PDC developmental). The year-scope revenue aggregations (revenue per period, per homestand, per phase) - this is where the deferred `sc_periods` table foundation lands. The KPI push contract (the revenue-band weekly->period push to the dashboard).

**Throughout:** the floor-first constraint holds - the common case (an operator entering/reviewing their numbers) must be faster-or-equal, never slower. The lens power lives one layer down from the daily default.

---

## 8. Open decisions (small, Kevin's call - do not block the doc)

1. **Corporate Field Chef landing bucket** - resolved as "both" (context-dependent default + easy pivot). Implementation detail for Stage 1 landing logic.
2. **TBR-FL contract Term reconciliation** - the tool's math is settled (75% actuals); confirming the contract Term is 2026-valid is housekeeping paperwork, deferred.
3. **KPI revenue push granularity of the breakdown** - resolved: push the three-line breakdown (matches the P&L, costs nothing since the SC computes both meal-service and service-charge).
4. **The `sc_phases` table shape + the alias->canonical phase vocabulary** - to be finalized when Stage 2 is scoped (the recorded data in `SC_PDC_PHASES.md` is the seed).
5. **Fun Money handling** - parked entirely for now (per Kevin); the TBJ "Fun $$$$" anomaly is not addressed in this scope.

---

## 9. What is NOT in scope

- Labor scheduling (Rippling), ordering (vendor portals), declining-budget tracking - downstream tools the SC feeds, not absorbs.
- The cost side of the P&L (COGS, labor, SG&A) in the KPI push - other pipelines.
- A permissions/access-control system - everyone sees everything; only the default landing differs.
- The KPI dashboard itself - a separate future project; the SC's job is to expose its revenue band cleanly per `SC_KPI_PUSH_CONTRACT.md`.
- Multi-year / year-over-year comparison - single fiscal year for v1 (the data model should not discard prior years, since next-year budgeting uses them, but the comparison UI is later).

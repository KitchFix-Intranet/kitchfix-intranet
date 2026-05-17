# KitchFix Ops Hub - Business Notes

A living reference for niche business knowledge embedded in this codebase. Each note documents a rule, quirk, preference, or historical decision that wouldn't be obvious from reading the code alone.

## Why this exists

This file captures the kind of knowledge that lives in Kevin's head: domain rules, account-specific quirks, stakeholder preferences, calculation methodology, historical context. It exists because:

1. **Migration preservation** - rules that must survive the Supabase migration without silent-failure bugs
2. **Future developer onboarding** - someone joining the project (or future-Kevin in 6 months) shouldn't have to re-derive business logic from code
3. **Single source of truth** - when business rules are documented inconsistently across docs, code comments, and Slack threads, they drift. One place to look prevents drift.

## How to use this file

- **Adding a note:** Append to the relevant section below. Use the template at the bottom.
- **Reading the code:** When you see business logic that surprises you, check here before assuming it's wrong.
- **Migration prep:** Anything marked [PRESERVE THROUGH MIGRATION] must survive Stage 1 schema design.
- **Discovered through audits:** Each Stage 0 audit PR should append rules surfaced by that audit.

---

## Account-level rules

### MLB/MiLB/AAA P3 Auto-Inclusion [PRESERVE THROUGH MIGRATION]
- **What:** MLB, MiLB, and AAA accounts include `P3` in their `activePeriods` array even when no `labor_budgets` row exists for that `account_key + P3` combination. Non-MLB/MiLB/AAA accounts (e.g. PDCs) do not get this special treatment.
- **Why:** P3 is the period when opening inventory submissions happen. Operators need P3 visible in the period dropdown during the opening-inventory window, even before their full labor budget for the season is loaded.
- **Where:** `src/app/api/ops/route.js:717-721` (bootstrap action). Line numbers will shift slightly post help-request deletion in PR #41.
- **Documented:** 2026-05-17 during `/api/ops` dispatcher audit (PR #41).
- **Implementation options post-migration:**
  - (a) Application code (current state) - rule lives in the bootstrap query handler
  - (b) Postgres VIEW joining `accounts × labor_budgets` with conditional P3 union for matching levels
  - (c) Denormalized `active_periods` table populated at account-creation time
- **Schema design decision:** pending (Stage 1)
- **Verification:** when migration ships, manually verify a fresh MLB account with no `labor_budgets` P3 row still has P3 visible in its period dropdown during the opening inventory window.

---

## Period rules

*(empty - to be populated as audits find them)*

---

## Calculation methodology

### Inventory submission validation rule
- **What:** A valid inventory submission requires at least one of `food`, `packaging`, or `supplies` to be greater than zero. `snacks` and `beverages` are optional. `total` equals the sum of all five components.
- **Why:** A submission with only `snacks` or `beverages` is not a real inventory event in the KitchFix data model; primary cost categories must be present.
- **Where:** Validation enforced server-side in `src/app/api/ops/route.js` submit-inventory handler post-Audit #2. Mirror client validation in `src/app/ops/components/inventory/InventoryTool.js` `validate()` function.
- **Documented:** 2026-05-17 during Audit #2.
- **Migration consideration:** Stage 1 schema should enforce this as a Postgres CHECK constraint on the `inventory_submissions` table: `CHECK (food > 0 OR packaging > 0 OR supplies > 0)`. The `total` column should be a generated column: `GENERATED ALWAYS AS (food + packaging + supplies + COALESCE(snacks, 0) + COALESCE(beverages, 0)) STORED`. This eliminates the client-trust bug structurally.
- **Verification:** After migration, attempt to insert a row with `food=0 AND packaging=0 AND supplies=0` and confirm Postgres rejects it. Attempt to insert a row with mismatched `total` and confirm Postgres overrides it.

### TXR-V revenue-flex labor budget [PRESERVE THROUGH MIGRATION]
- **What:** The account `TXR - TX - V` (Texas Rangers Visiting) is the only KitchFix MLB account whose labor budget is not a fixed dollar amount. Instead, the labor budget for each homestand is a percentage of that homestand's sold revenue.
- **Mechanism:**
  - The P&L provides a labor ratio (e.g. 19.23%) rather than a dollar budget.
  - In code, the ratio is derived: `laborRatio = budgetEnvelope / forecastedRevenue` (where `budgetEnvelope` and `forecastedRevenue` both come from `HUB.labor_budgets`).
  - After the homestand closes, the chef submits actual sold revenue. The adjusted budget is then computed: `adjustedEnvelope = soldRevenue * laborRatio`.
  - Example: forecast $5,000 revenue with $1,000 budget = 20% ratio. Actual revenue $4,500 → adjusted budget $900 (not the original $1,000).
  - In practice, the derived ratio is constant across all of TXR-V's periods (P4 through P10 all = 0.1923). The code derives it per-homestand to keep the logic uniform, but the ratio could equivalently be stored once as a season-level constant. The Postgres migration design (below) treats this as a single `labor_ratio` value on the `accounts` table - this aligns with operational reality.
- **Why:** Visiting-team food service revenue is variable and depends on event size, opponent draw, weather. The P&L is structured to give visiting kitchens a percentage envelope rather than a fixed budget so that costs scale with revenue.
- **Where:**
  - `src/app/api/ops/route.js` - `REVENUE_FLEX_ACCOUNTS` constant lists revenue-flex accounts. `buildLaborContext` computes the ratio and adjustedEnvelope.
  - `src/app/ops/components/labor/SeasonPlanner.js` - `handleSubmitFlex` is the chef's combo submission (revenue + labor) that bypasses the standard single-submission flow.
- **Documented:** 2026-05-17 during Audit #3 (Season Tracker).
- **Migration consideration:** Move `REVENUE_FLEX_ACCOUNTS` from code constant to a column on the `accounts` table (e.g. `is_revenue_flex` boolean OR a `budget_model` enum with values `fixed` and `revenue_ratio`). In Postgres, the adjusted budget should be a computed column or VIEW: for revenue-flex accounts, `budget = (SELECT sold_revenue FROM labor_sold_revenue WHERE ...) * (labor_ratio FROM labor_budgets)`. The two-stage submission flow (revenue first, then labor) should be a single transaction.
- **Verification:** After migration, for `TXR - TX - V`, submit revenue $4,500 against a homestand with labor_ratio 0.20 - confirm the adjusted budget shown in the chef UI = $900. Then submit $850 actual labor and confirm variance shows +$50.

### Season Tracker streak calculation
- **What:** A chef's "streak" is the count of consecutive homestands ending with the most recent submission where actual labor spent was at or under budget envelope (i.e. variance >= 0).
- **Rules:**
  - Homestands are iterated in **season sequence order** (HS1, HS2, HS3, ..., not submission order).
  - Each homestand contributes to the streak if its variance is >= 0 (on or under budget).
  - A variance < 0 (over budget) resets the streak to 0.
  - The streak displayed is the streak ending at the most recent homestand, NOT the season's longest run.
- **Why:** Streaks are a leaderboard mechanic that rewards consistent on-budget execution. They're meaningful only when computed in chronological homestand order - a chef who submits HS3 first and HS1 last shouldn't get a different streak than one who submits in order.
- **Where:** `src/app/api/ops/route.js` submit-labor-actuals handler computes streak server-side at write time and stores it in the `labor_plans.streak` column. The read path (`buildLaborContext`) trusts the stored value.
- **Documented:** 2026-05-17 during Audit #3 (corrects the prior implementation that iterated in submission order, see PR #44).
- **Migration consideration:** In Postgres, streak can be a window function over the labor_plans table: `SUM(CASE WHEN variance >= 0 THEN 1 ELSE 0 END) OVER (PARTITION BY account ORDER BY homestand_sequence ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`. Alternatively, a generated column maintained by trigger on insert. Decision pending Stage 1.
- **Verification:** After migration, for a chef with submissions in order HS1(+$100), HS2(-$50), HS3(+$200), HS4(+$300), confirm streak = 2 (HS3 and HS4 only). Then submit HS5(+$0) - confirm streak = 3.

---

## Vendor-specific patterns

*(empty - to be populated as audits find them)*

---

## Stakeholder preferences

### Inventory submission AP fanout [PRESERVE THROUGH MIGRATION]
- **What:** Every `submit-inventory` triggers a 3-channel fanout: bell notification to submitter, HTML email to `ap@kitchfix.com` (cc submitter), Slack post to `#opshub-inventory-submissions`.
- **Why:** AP does not read the COLLECTION sheet directly. The email to `ap@kitchfix.com` is the handoff channel - it is how AP receives inventory submissions for accounting entry. Loss of this email means AP does not know an inventory event happened.
- **Where:** `src/app/api/ops/route.js` submit-inventory handler (post-Audit #2 line numbers shift; search `action === "submit-inventory"`)
- **Documented:** 2026-05-17 during Audit #2 (inventory submission flow).
- **Migration consideration:** Post-Postgres, AP could read the table directly via a dashboard or scheduled report. The email path could become optional/configurable. Until that flip is explicitly designed and shipped, the email path must be preserved through migration.
- **Verification:** Submit a test inventory row post-migration. Confirm `ap@kitchfix.com` receives the formatted HTML email within 30 seconds.

---

## Historical context

### Append-only "latest row wins" for labor_plans
- **What:** The `COLLECTION.labor_plans` table is append-only. Every chef submission - including edits to a previously-submitted homestand - creates a new row rather than updating an existing one. Reads dedupe by taking the latest row per (account, homestand) combo (`.pop()` pattern in code).
- **Why:** Append-only writes are safer in a Sheets context (no risk of corrupting historical data via row-update bugs). Edit history is preserved as a side effect - if a chef revises P5 numbers three times, all three submissions are in the sheet, with the most recent one winning on read.
- **Where:** `src/app/api/ops/route.js` - submit-labor-actuals appends; buildLaborContext reads via `plans.filter((pl) => pl.homestandId === hsId).pop()`. Same pattern applies to `labor_sold_revenue` and `deep_clean_days`.
- **Documented:** 2026-05-17 during Audit #3.
- **Migration consideration:** In Postgres, two viable patterns:
  - (a) Keep append-only with a `latest_per_homestand` VIEW that uses `DISTINCT ON (account, homestand_id) ORDER BY created_at DESC`. Preserves full edit history.
  - (b) Switch to UPDATE semantics with a separate `labor_plans_audit` table for history. Cleaner reads, requires explicit audit trail design.
  - Decision pending Stage 1.
- **Verification:** After migration, submit an edit to a previously-submitted homestand. Confirm: the displayed values reflect the edit (latest wins), AND the prior version is recoverable from the audit trail or full table scan.

---

## Template for new entries

### [Rule name] [optional: PRESERVE THROUGH MIGRATION]
- **What:** [the rule in plain language]
- **Why:** [business reason]
- **Where:** [file:line range, if applicable]
- **Documented:** [date + source - audit PR, debug session, stakeholder request]
- **Implementation options post-migration:** [if applicable - a/b/c structure]
- **Schema design decision:** [pending | locked: option N]
- **Verification:** [how to test the rule is preserved after migration]
- **Notes:** [optional: edge cases, history, related rules]

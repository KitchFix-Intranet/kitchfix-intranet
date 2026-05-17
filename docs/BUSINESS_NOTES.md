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

*(empty - to be populated as audits find them)*

---

## Vendor-specific patterns

*(empty - to be populated as audits find them)*

---

## Stakeholder preferences

*(empty - to be populated as audits find them)*

---

## Historical context

*(empty - to be populated as audits find them)*

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

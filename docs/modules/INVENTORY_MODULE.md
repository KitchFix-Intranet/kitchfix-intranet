# Smart Inventory Module

> **Status:** PARKED 2026-06-12. Prototype #1 (Module 7 + Module 8 cron) shipped + ran in production; declared over-built; data accumulates. v2 vision below.

This module's history, current state, and the v2 vision that informs whatever build comes next. Read this when SI un-parks, or when designing anything that touches inventory data.

---

## Where we are

Smart Inventory was Module 7 of the Supabase migration project. The plan: a PG-backed inventory catalog (`inventory_items`), a Review Queue (`review_queue`) for OCR'd line items that didn't auto-match, a Railway cron (Module 8, separate repo) that ran nightly to batch-match new invoice line items against the catalog, and a `count_sessions`/`count_items` tally flow for monthly chef-driven inventory counts.

Schema is live. Backfill is done (3,759 inventory_items / 6,665 price_history rows). All 10 RQ PG mirrors verified live. The Review Queue tool merged via PR #136. Code was ready for the four-flag atomic cutover.

**Then it got parked instead.** Decision made 2026-06-12, alongside the no-wipe decision for the invoice tables and the overall migration project close-out.

**What "parked" means in practice:**
- Code stays running as-is. The cron continues writing PG nightly. Both stores (Sheets + PG) keep receiving cron writes.
- The legacy `/ops` monthly-count flow stays on Sheets and keeps serving real submissions until SI v2 absorbs the use case.
- The Review Queue tool stays admin-gated to k.fietek + joe (production-soft-launch state from PR #136).
- No active development; no migration in either direction.
- Data accumulates - it's input for the eventual v2 build.

---

## Why parked: prototype #1 was over-built

The cron's arithmetic gate was catching the wrong problem.

**The symptom:** 700 of 893 review_queue rows were tagged `arithmetic_fail` - the cron's invariant check (quantity × unit_price ≈ extended_price) didn't pass. The concentration was telling: Ben E Keith, Cheney Brothers, Kuna Foodservice. Big distributor invoices.

**The root cause we surfaced and fixed:** Claude was conflating PACK and Cases/SHIPPED columns. On distributor invoices the PACK column is the inner-pack count (e.g., 2/2 LB = "2 inner units of 2 lb each"), the CASES/SHIPPED column is how many cases actually got delivered. Claude was sometimes reporting PACK as quantity, sometimes Cases - inconsistently. The arithmetic gate caught it; the cron deferred those lines to the review queue; humans never resolved them at the rate they accumulated.

**The real lesson:** the gate was working correctly. The system was wrong in how it asked Claude. The Stage A prompt rewrite (pr-9-1) was the right fix - ask Claude for RAW labeled columns (Cases, Pack Size, UOM, Weight sub-line) and derive the quantity-for-pricing value in code, not in the prompt. A null is honest; a back-computed value is a lie; the gate must be able to fail. Stage A landed.

**But by then we were carrying significant prototype-1 baggage:**
- The catalog approach (one canonical inventory_items row per stocked item) requires CONSTANT cleanup work as the cron auto-matches new lines and humans review the rest
- 73 PG groups with duplicate population (88 excess rows) from cron-side mismatches - tracked, fixable, but cleanup-style work
- The Review Queue UX was a constant flow of "something went weird; resolve me" - a sign the upstream extraction was the wrong shape
- The cron itself became expensive cognitive load: matching, merging, alias-learning, undo, parity between Sheets and PG mirrors

The team's reaction settled into a different question: **why are we maintaining a catalog at all?**

---

## The v2 vision: queries-over-facts

Smart Inventory v2 is a rebuild premise, not a refactor. The core shift:

**Today (v1):**
- Source of truth: `inventory_items` catalog (3,759 rows) + `item_aliases` (4,341 rows) + `price_history` (6,665 rows)
- Cron's job: read new invoice line items, match to catalog, learn new aliases, queue mismatches for human review, write price history
- The catalog is a curated artifact maintained by the cron + humans
- Reads are catalog-shaped: "give me last price of this catalog item"

**Tomorrow (v2):**
- Source of truth: just the OCR'd line item facts (`ai_line_items` table - 8,535 rows already there and growing)
- No cron, no batch-matching pass, no review queue, no catalog to maintain
- Inventory views computed on demand by querying the line item facts
- Reads are query-shaped: "what's been bought at CIN - AZ that looks like 'tomato whole peeled pear' in the last 90 days?" -> SELECT from ai_line_items + fuzzy match + return prices, vendors, frequency

The shift is **eager curation -> lazy query**.

### Why the catalog gets deleted in v2

The catalog exists to answer "is this thing we just OCR'd a thing we already know about?" That question is the cron's reason for being. Remove the question, the cron has nothing to do.

In v2, every OCR'd line item is just a fact. It doesn't need to be "matched" to anything. When somebody wants to know "what did STL - FL spend on Cheney Brothers Salmon last quarter," the query runs against the facts directly - matching by description fuzziness + vendor + account, ranked by recency. No catalog state to be wrong about.

This is what "queries-over-facts" means. The facts (line items) are the lowest-cost-to-be-right substrate. Higher-level views are derived on-demand, not maintained as state.

### Why each item becomes "a creature with a profile"

When a chef asks "show me Sysco Salmon," v2 doesn't return one canonical row. It returns an **aggregated identity** built from the facts:

```
"Salmon"-ish items at this account from this vendor:
  - Sysco Atlantic Salmon Fillet 8oz Skin-Off (12 invoices, $14.50-15.80/lb range)
  - Sysco Salmon Fillets 8oz (3 invoices, all 2025 Q1, $16.20/lb avg)
  - Sysco Salmon Steaks 6oz (1 invoice, May, $13.95/lb)
  ↳ trend: prices trending up; freshest fact 2026-05-31; ordered ~weekly
```

Each "creature" is its own profile - a constellation of line item facts that share enough description / vendor / account / time-window proximity to be the same thing for practical purposes. The profile is the answer to "what is this item, really?" - a question better answered by aggregation over facts than by a curated catalog row.

This model has real implications:
- **No more "fix the catalog" UX.** Wrong-looking aggregations are fixed by tightening the query, not by editing a catalog row.
- **Aliases become implicit.** If two different OCR descriptions ("Salmon Fillet 8oz" and "Atlantic Salmon Fillet 8oz Skin-Off") share enough fact context, they aggregate into the same creature. No alias table needed.
- **Price history is direct.** No `price_history` table - the line item facts ARE the price history.
- **Count flows become "tally facts at a point in time" rather than "tally against a catalog row."** A monthly count is a snapshot of what's on the shelf at end-of-period, joined post-hoc to whatever creatures match.

### What of the existing prototype-1 data?

Kept. Per the 2026-06-12 no-wipe decision: 3,759 inventory_items rows, 6,665 price_history rows, 4,341 item_aliases rows, 167 review_queue rows, all stay. The data has latent value as input for the v2 design phase - what fact-shapes work, what fact-shapes fail, what fuzzy-match strategies cluster well. Don't wipe; revisit when v2 starts.

The `is_historical` mechanism (already in `ai_line_items`, `invoice_submissions`, etc.) means future v2 work can mark prototype-1 data as historical without losing it; partial unique indexes already gate on `is_historical=FALSE`. No v1-vs-v2 schema work needs to happen pre-emptively.

---

## What this means for downstream work

**Module 8 (Railway cron) is effectively deleted in v2.** Its role - batch-matching catalog rows - has no analog in queries-over-facts. When SI un-parks, expect to retire the cron, not migrate it.

**The legacy `/ops` monthly-count flow needs a clear successor in v2.** Today chefs submit per-category dollar totals (food/packaging/supplies/snacks/beverages). v2's count flow should produce the same outputs (those totals) as derived rollups from the creature-level counts, so the dashboard doesn't break. Designing the count UX is part of the v2 build, not a migration step.

**The invoice OCR + ai_line_items table is the v2 substrate.** Make sure invoice capture stays clean. The 2026-06-12 fix bundle (PR #138 visibility + pr-9-1 schema + PR #139 line_num re-sequence) was prerequisite to v2 viability; future invoice work should preserve the same Sheets-first dual-write + pg_failed visibility properties.

**The ai_line_items.raw_columns column is dead.** Stage A's prompt drops `rawColumns` (was causing JSON truncation on dense F5 invoices); the PG column stays as backstop, always null going forward. v2 doesn't need it.

**Be skeptical of any "we should add a catalog row" reflex when v2 work resumes.** That reflex is prototype-1 muscle memory. The v2 model resists it by design.

---

## Pointers

- [`../MIGRATION_PROJECT_CLOSEOUT.md`](../MIGRATION_PROJECT_CLOSEOUT.md) §C.3 - the parking decision in project context
- [`../MIGRATION_STATUS.md`](../MIGRATION_STATUS.md) - canonical current-state (Smart Inventory + Module 8 listed as PARKED)
- [`../MODULE_7_INV-2_PLAN_CORRECTION.md`](../MODULE_7_INV-2_PLAN_CORRECTION.md) - the cutover plan that's now superseded by parking; historical reference for what was almost flipped
- [`../migrations/pr-9-1-ai-line-items-raw-fields.sql`](../migrations/pr-9-1-ai-line-items-raw-fields.sql) - the Stage A schema; the 9 columns are how v2 reads invoice facts
- `kitchfix-inventory-cron` (separate repo) - the Module 8 cron, parked-running

# Smart Inventory Module

> ⚠️ **STATUS: this document is out of date.** It still claims "Pre-Module-7, work not started" — that is no longer accurate. Module 7 schema is live, INV-3 backfill is done (3,759 inventory_items / 6,665 price_history rows), the Review Queue tool shipped via PR #136, and as of 2026-06-12 Smart Inventory is **parked** pending a fate decision (the invoice-capture-to-PG work was prioritized). [`../MIGRATION_STATUS.md`](../MIGRATION_STATUS.md) is the canonical source of truth for current state. Do NOT rely on the status claim below or any "work not started" framing. Full reconciliation is a tracked do-later item.

> **Status (stale claim, kept for historical reference):** Pre-Module-7. Work not started.

## Overview
*Populate when PR 7.1 ships.*

## Schema reality
*PG tables + is_historical pattern. PR 7.1.*

## Key invariants
*Primary vendor coordination, count session lifecycle, cron worker integration. PR 7.1.*

## Common pitfalls
*Discovered during cutover. PR 7.3 / cutover event.*

## Handler reference
*Where each handler lives + what it does. PR 7.2.*

## Cross-module dependencies
*Reads from gl_codes; cron worker writes to multiple tables. PR 7.1+*

## Cutover history
*Populate with each PR + cutover event. Ongoing.*

## See also
- docs/FINANCE_STACK_PLAN.md Section 2.2 - PG schema specifications
- docs/architecture/IS_HISTORICAL_PATTERN.md - preservation-first design doctrine *(TBD)*

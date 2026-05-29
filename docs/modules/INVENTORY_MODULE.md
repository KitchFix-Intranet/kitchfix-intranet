# Smart Inventory Module

> **Status:** Pre-Module-7. Work not started.

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

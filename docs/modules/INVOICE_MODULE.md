# Invoice Module

> **Status:** Pre-cutover. Schema design in progress per Module 6 PRs.

## Overview
*Populate when PR 6.1 ships.*

## Schema reality
*Populate with PG tables + is_historical pattern + Sheets fallback. PR 6.1.*

## Key invariants
*F19a / F19b / F24 / F25 idempotency patterns; is_historical doctrine application; module arg propagation. PR 6.1.*

## Common pitfalls
*Discovered during cutover. PR 6.3 / cutover event.*

## Handler reference
*Where each handler lives + what it does. PR 6.2.*

## Cross-module dependencies
*Reads from vendor module via getVendorsForBootstrap; reads from gl_codes; writes to ai_line_items. PR 6.1+*

## Cutover history
*Populate with each PR + cutover event. Ongoing.*

## See also
- docs/MODULE_6_DATA_AUDIT.md - audit findings + locked architecture decisions
- docs/FINANCE_STACK_PLAN.md Section 2.2 - PG schema specifications
- docs/architecture/IS_HISTORICAL_PATTERN.md - preservation-first design doctrine *(TBD)*

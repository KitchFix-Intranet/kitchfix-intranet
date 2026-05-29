# Vendor Module

> **Status:** Cut over 2026-05-29 (Module 5 LIVE on Postgres). README to be backfilled in a follow-up Tier 2 PR.

## Overview
*Backfill in follow-up PR after Module 6 schema work completes.*

## Schema reality
*3 PG tables: vendors / vendor_accounts / vendor_aliases. 31 / 54 / 49 rows. Dual-write active. Reads from PG via READ_FROM_POSTGRES_OPS.*

## Key invariants
*F19a deterministic vendor ID coordination across stores; merge_vendors PL/pgSQL stored function for atomic 3-side-effect merges; canonical account_key format with spaces.*

## Common pitfalls (Module 5 cutover lessons)
*- Handler call sites MUST pass module: "ops" to orchestrators or per-module READ flag is a no-op.*
*- Vercel env var changes require no-cache redeploys for fresh Lambda cold-starts.*
*- Vendor merge handler updates col B vendor_id but NOT col A rowId - orphan rowIds are normal post-merge.*

## Handler reference
*10 orchestrators in src/lib/dataStore/vendor.js; 13 handler call sites in src/lib/invoiceActions.js. Detail TBD in follow-up PR.*

## Cross-module dependencies
*Invoice module reads vendor data via getVendorsForBootstrap, searchVendors, getVendorsForMatching. OCR uses fuzzyMatchVendor from src/lib/vendorMatching.js.*

## Cutover history
*PR #86 (PR 4.1 dataStore split), #87 (PR 5.1 schema + adapters), #88 (PR 5.2 handler rewire), #89 (PR 5.3 backfill + merge atomicity), #92 (module arg fix), #93 (debug instrumentation revert).*
*Cut over 2026-05-29 with 31 vendors / 54 vendor_accounts / 49 vendor_aliases.*

## See also
- docs/FINANCE_STACK_PLAN.md Section 2.2 - PG schema specifications
- docs/PROJECT_DASHBOARD.md item 11 - Module 5 cutover narrative + 3 lessons

# backlog · pnl_actuals loader writes invented zeros on budget-only cells

**Opened:** 2026-09-17 · during FIN-2027 W1 close-out
**Severity:** P0-class · violates `pnl-1-actuals-and-status.sql` absence contract
**Owner (implementation):** KPI session · this is a KPI-lane change per lane discipline 2026-09-17
**Log-only in W1** per Kevin ruling 2026-09-17. Not implemented in W1.

## The finding

Both `scripts/derive_pnl_actuals.mjs` (FY2026 loader, LIVE KPI board) and `scripts/load_pnl_history.mjs` (FY2024/FY2025 historical loader) currently handle absence like this:

```
if (actual == null && budget == null) -> skip row (no pnl_actuals row written)
else                                  -> write row with:
                                         actual = (actual == null ? 0 : round2(actual))
                                         budget = (budget == null ? null : round2(budget))
```

A workbook cell with `actual = null` (EMPTY) and `budget = non-null` lands as a `pnl_actuals` row with `actual = 0` + `budget = <workbook budget>`. Because `pnl_actuals.actual` is `NOT NULL` (`pnl-1-actuals-and-status.sql:126`), such a row is indistinguishable from a row where the workbook explicitly reported zero spend. The loader is inventing a zero that nobody reported.

## The contract this violates

From `docs/migrations/pnl-1-actuals-and-status.sql` header, BINDING:

> "An ABSENT `(account_key, fiscal_year, period_no, line_code)` row means NOT REPORTED, never $0. The `actual` column is NOT NULL, so absence is the only channel the workbook has for 'no figure this period'. A row explicitly loaded with actual=0 DOES mean zero."

Absence has ONE channel (no row at all). Writing a present row with `actual = 0` for a cell the workbook did not populate collapses that channel.

## Blast radius (counts, 2026-09-17 census)

Per `scripts/_probe_fin2027_present_with_zero_census.mjs`:

| year | present-with-zero rows in `pnl_actuals` today | notes |
|---|---|---|
| FY2024 P1..P13 | 1,110 | ~30% of the 3,708 FY2024 rows in `pnl_actuals` |
| FY2025 P1..P13 | 88 | concentrated on CIN - KY P13 (24 lines, one whole period) + CIN - OH scattered late-year |
| FY2026 P1..P9 | **839** | **~26% of the 3,167 currently on the LIVE KPI board** |
| **total** | **2,037 rows** | across three years of `pnl_actuals` |

Consumer surfaces (readers that would misinterpret a false zero as reported zero spend):

- `/api/kpi/overview` → Overview statement rows read via `src/lib/kpi/overview/resolver.js` (`sumPnlForLine`) which uses `row && row.actual != null` as the "reported" test. **A row with `actual = 0` passes this test as REPORTED**, contradicting the contract.
- Any resolver that does per-period sums of `pnl_actuals.actual` → the sum silently absorbs the invented zeros. Not visible as a defect until the caller specifically inspects presence.
- `pnl_reconciliation_exceptions` audit trail is UNAFFECTED - exceptions are computed from workbook year-total anchors, not from the loaded per-period cells.

## Fix options

### Option A · Skip the row entirely when actual is null (discard the budget value on that cell)

Loader change: `if (actual == null) -> skip row (regardless of budget)`. The (account, line, period) cell becomes absent in `pnl_actuals`. Callers that want the budget value fetch it from `kpi_budgets` instead (which is per-period-per-line and complete).

**Blast radius:**
- Loader code: ~5-line change in `scripts/lib/pnl_load_core.mjs` header comment + both loaders' absence check.
- `pnl_actuals` row count drops by ~2,037 rows (across three years). Cross-year total: 10,327 → ~8,290.
- Overview resolvers: the affected (account, line, period) surface renders as "NOT REPORTED" instead of `$0`. R-21 chip may need a copy pass.
- **Budget-side impact**: the loader currently writes the workbook's budget value onto the same row as actual=0. If we skip the row, the workbook's per-period budget for that cell is not carried into `pnl_actuals`. `kpi_budgets` is the canonical budget source anyway (kpi-2 migration seeded it independently), so this is safe if callers do not lean on `pnl_actuals.budget`. Verify: grep `pnl_actuals.budget` reads across `src/lib/kpi/**` before adopting.
- **No schema migration required.** Idempotent re-load will simply not write those rows.

**Estimated hours: 4-8h** (loader change + reader audit for `pnl_actuals.budget` dependencies + retest of FY2026 Overview sentinels + backfill DELETE of the 2,037 existing rows).

### Option B · Make `pnl_actuals.actual` nullable + teach readers to distinguish

Schema migration: `ALTER TABLE pnl_actuals ALTER COLUMN actual DROP NOT NULL`. Loader change: `actual = actual == null ? null : round2(actual)`. Callers must be updated to treat `actual IS NULL` as NOT REPORTED and `actual = 0` as explicit zero - restoring the pnl-1 contract via the two-value distinction the current schema forbids.

**Blast radius:**
- Migration: `pnl-5-actual-nullable.sql`. Low-risk `ALTER` on a live table; PostgreSQL handles it as a metadata-only change (no full-table rewrite for `DROP NOT NULL`).
- Loader code: ~2-line change per loader.
- **Reader audit is the bulk of the work**: every `SELECT ... FROM pnl_actuals` that does arithmetic on `.actual` must be updated to handle NULL (`COALESCE(actual, 0)` if summing; presence check if reporting reported/not). Sites to review (from `scripts/_probe_fin2027_year_safety.mjs` inventory + resolver reads):
  - `src/lib/kpi/overview/pnl-loader.js` (`loadPnlActuals`) - the primary read path.
  - `src/lib/kpi/overview/resolver.js` (`sumPnlForLine`) - the `reported: row.actual != null` test would flip to `reported: row.actual !== null` after this change (NULL means "reported.false"; 0 means "reported.true, value 0"). Confirm the client renders both correctly.
  - Any purchasing / labor route touching `pnl_actuals` (limited; scan under `src/app/api/kpi/**`).
  - `scripts/probes/_probe_pnl_actuals_sentinels.mjs` - sentinel probe must be re-verified against the new semantics.
- Backfill: the 2,037 existing present-with-zero rows must be identified (join against workbook re-parse OR delete-and-reload FY2024 + FY2025 + FY2026 P9 under the new loader) and either `UPDATE actual = NULL` or `DELETE + reload`. Cleaner: delete-and-reload each year end-to-end under the new loader.

**Estimated hours: 12-20h** (migration + loader change + reader audit + reader updates + sentinel re-verify + backfill + Overview visual acceptance across CY + LP + P range).

## Recommendation shape (informational, not a decision)

Option A is smaller and does not touch schema. It matches the pnl-1 contract by construction ("absence is the only channel") without any reader retraining. The cost is losing the workbook's per-period budget on those cells - mitigated by `kpi_budgets` being the canonical budget source.

Option B preserves the workbook's budget-per-period on those cells AND restores the two-value semantic, but the reader audit is the load-bearing risk (miss one and the Overview shows NULL where it should show 0). This is the same shape as the R-98 salary-gate change and would deserve similar careful sentinel work.

Both fixes are KPI-lane changes and cannot be made unilaterally by the FIN-2027 session per R-18 / lane discipline 2026-09-17. Ticket exists so the KPI session can pick this up when prioritized.

## Related

- `docs/audits/FIN2027_W1_LOAD_2026-09-17.md` finding section for the count breakdown per year.
- `scripts/_probe_fin2027_present_with_zero_census.mjs` standing probe.
- `pnl_reconciliation_exceptions` (pnl-4) is a related-but-separate mechanism for RECONCILIATION drift on year totals; it does not overlap with the invented-zeros class.
- Lane discipline note: `docs/GOTCHAS.md` 2026-09-17 entry.

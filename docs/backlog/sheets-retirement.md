# Sheets retirement - five-wave plan + cutover.js keystone

**Filed:** 2026-09-04, at the close of the billing arc.
**Status:** Deferred. A dedicated build slot after training week.
**Trigger to unpark:** the arc's four-state cutover survey exposed
that a large fraction of the Sheets writes still firing are
dead-weight (State 1 in the classification below). Retiring them
does not need a live audience but it does need a real slot - it is
too large to ride under an unrelated PR.

---

## What this closes

The still-live Sheets write paths across every module that has
already cut over to Postgres. The read side is already off Sheets
in the six cut-over modules; the write side is not. `cutover.js`
today has no flag to turn Sheets writes OFF for a cut-over module
(the "sheets-decommission structural gap" standing finding in
CLAUDE.md). Removing a table from `DUAL_WRITE_TABLES` stops PG
writes, not Sheets writes - the opposite of what a decommission
needs to do.

The keystone change is a new flag in `cutover.js` -
`SHEETS_WRITE_DISABLED` per table or a `writeMode: 'pg-only'`
setter - so the retirement can proceed table by table without
touching every writer call-site.

## The four-state cutover classification

The billing-arc survey found every Sheets writer falls into one of
four states. The retirement handles them in different orders.

**State 1 - dead-weight Sheets write.** PG has been authoritative
for weeks or months; nothing reads the Sheet; the write fires
anyway. Deletion is safe. This is the bulk of the surface.

**State 2 - parity-and-flip.** Both stores are read somewhere;
the flip needs a short parity window to confirm the PG read matches
the Sheets read, then the Sheets read + write can go together.

**State 3 - PG-only already.** No Sheets writer. Nothing to do
except confirm the classification.

**State 4 - real migration.** A module or column that never made
it into the six cut-over modules and still has Sheets as the
authoritative store. Not part of retirement; belongs in a proper
migration PR of its own.

## Five-wave plan

Each wave is one PR. Kevin picks the pace between waves. Waves are
sized so a rollback (revert the PR) is a one-command undo per wave.

**Wave 1 - keystone.** Ship the `cutover.js` flag + a `readOnlySheet`
helper for any code path that needs to check the Sheet during the
transition. No writer removals yet. This lands the mechanism.

**Wave 2 - State 1 batch A.** The obvious dead-weight writes:
directory pushes, news pushes, playbook pushes. Remove the writer
lines, flip the flag to disabled per table. One PR.

**Wave 3 - State 1 batch B.** People-submissions, vendor, invoice.
Same pattern as Wave 2, held to a separate PR because these carry
more historical accretion and the diff is worth reading on its own.

**Wave 4 - State 2 flip.** Any table where a Sheets read still
exists. Wave 4 either kills the reader or documents it as an
intentional read-only fallback (with a comment naming why). Then
the Sheets writer goes.

**Wave 5 - cleanup.** Remove `DUAL_WRITE_TABLES` entries that no
longer make sense, delete now-unused helpers in `sheets.js`,
delete the `getServiceAccountSheetsClient` code paths for tables
that no longer route through it. Sanity: `grep -rn "sheets.append\|sheets.update" src/lib/dataStore/` should return zero for the retired tables.

## What this DOES NOT do

- Does not touch the Service Calendar Sheets integration - SC is
  its own migration project, tracked separately.
- Does not remove the `googleapis` dependency. Labor / Financial /
  Legacy Inv Count / Incidents / Leadership Dugout all still sit
  on Sheets per `docs/MIGRATION_STATUS.md` and continue to import
  it.
- Does not delete `src/lib/sheets.js` wholesale. The file stays as
  the driver; only the specific writer call sites for retired
  tables are removed.

## Pointers into the code

- Control plane: `src/lib/cutover.js` - `DUAL_WRITE_TABLES` array,
  the `isDualWrite` predicate. Wave 1 adds the disabled-writes
  side.
- Per-module writer entry: `src/lib/dataStore/*.js` - each
  orchestrator's `save` / `update` / `create` function has the
  Sheets writer inline. Read the pattern before editing; do not
  break the rollback net until the flag is proven in Wave 1.
- Sheets driver: `src/lib/sheets.js` - the append / update helpers
  the orchestrators call. Wave 5 prunes.
- Related standing finding: CLAUDE.md § Standing findings item 3.

## Related backlog

- `docs/backlog/notify-wrapper.md` - the notify() abstraction is a
  natural pair with Wave 1's flag work; both are cross-module
  abstractions that make future changes safer. Landing them
  together is an option but not a requirement.

## Discipline note

The retirement is the follow-through on a partial migration. The
six cut-over modules were shipped with dual-write as the rollback
net; the rollback net is still there because the flip to
PG-only-writes never got a dedicated PR. Retirement closes that
loop. Do not fold it into a feature PR - the diff is large enough
to hide a regression, and the wave-by-wave shape is what makes
each undo tractable.

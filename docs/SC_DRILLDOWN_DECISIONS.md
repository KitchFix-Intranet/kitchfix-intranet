# SC Drilldown - Visual-Parity Decisions Log

Running log for the section-by-section drilldown alignment (method: docs/HANDOFF_CHAT.md 7.4-7.6).
Rule: GLOBAL levers are decided by the FIRST section that touches them, logged here, and inherited
by every later section. Never re-open a logged decision inside a later section; if one must change,
that is its own explicit conversation with Kevin.

## Global levers - PENDING (decide on first encounter, then move to Decided)
- Workspace page surface (--surface-sunken vs --surface-page)
- Panel radius (--radius-container-lg 14 vs --radius-container 10)
- Money green (one of: --text-success / --accent-sc / --accent-sc-dark)
- Primary-action color rule (commit vs view-toggle)
- Progress-bar grammar (--accent-sc identity vs --status-entered status)

## Decided
- **Focus ring color = `var(--accent-sc)` (green) on every SC surface.** Decided 2026-07-02.
  The overview already shipped green rings; #317 landed the drill-in's rings as navy
  `--focus-ring-color`; this follow-up swapped all 16 SC occurrences (dayDetail.css x7,
  periodWorkspace.css x6, ops-sc.css x2, admin/ops-sc-admin.css x1) to `--accent-sc`.
  The app-wide `--focus-ring-color` token itself is unchanged (navy, non-SC surfaces).
- **Day tile = meals-first.** Decided 2026-07-06.
  Value block is stacked: meal count prominent, `est./~ $Xk` quiet beneath; softer `--lg`
  surface (13px radius, inner-highlight, translucent glyph chip). Colors unchanged. Off-day
  reads "No service." Fixes the `$3K/ 305` fraction-read. (#327 tiles, #331 today.)
- **Totals card = half-height strip (Option 2).** Decided 2026-07-06.
  Entered `$` leads; the projection-gap "to go"/"ahead" delta REMOVED (a projection target
  invents a false goal/failure); metrics on one band; the today action as a slim second row.
  Per-meal/MiLB only. (#328.)
- **Exceptions = clickable chips in the strip + a next-needing-entry iterator.** Decided 2026-07-06.
  `N overdue`/`N need entry` chips (drill-in-scoped jump); DayDetail's post-save button walks
  the exception queue to an all-caught-up close. Today row's projected values carry a
  `PROJECTED` pill. (#329.)
- **Today cell = navy frame + filled navy date chip (Option A), `--lg` only.** Decided 2026-07-06.
  No bottom pill; `--sm` year view keeps its ring. (#331.)
- **Week subtotals dropped on the month view, kept on the period view.** Decided 2026-07-06.
  `d.meta.week` is the fiscal week, meaningless across a calendar month spanning two periods.
  (#327.)
- **Month drill-in is its own scope.** Decided 2026-07-06.
  Clicking a month opens `?month=YYYY-MM` (un-deprecates the month view); the month header
  omits the phase (a month spans phases). Keyboard roving-tabindex on the drill-in grid only;
  year-view keyboard deferred. (#325/#326.)

## Per-section log
(sections appended as they complete: date · section · decisions · PR #)

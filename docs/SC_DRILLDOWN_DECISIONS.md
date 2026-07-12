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
- **Sm-tile marks philosophy: exactly TWO sanctioned marks, corner-anchored.** Decided 2026-07-12.
  The sm overview tile carries color + border + date + up to two corner marks. Top-right = event
  (transient, per-day). Bottom-left = season (multi-day, phase-driven). If a third signal is ever
  needed, it goes on a new axis (never re-opens the icon channel). Enshrined verbatim in comments
  in `DaySquare.js`, `DaySquare.css`, and `LegendInfoPopup.js`. Any relaxation is a design conversation.
- **Game-day mark = indigo top-right wedge (`#4338CA`).** Decided 2026-07-12.
  Rendered via `::before` + `clip-path: polygon(0 0, 100% 0, 100% 100%)` on the sm tile.
  Gate: `has_schedule_overlay=true` AND the date has a GAME row. Overlay accounts only
  (STL - FL, TBJ - FL today). Not on homestand-fee or MiLB accounts (they color their game days by state).
  Legend row (Calendar context) shows a half-scale swatch. (#412.)
- **Spring-Training mark = dark-copper bottom-left wedge (`#8A4A1B`) + ST pill on lg + chrome rider.** Decided 2026-07-12.
  Rendered via `::after` + `clip-path: polygon(0 0, 0 100%, 100% 100%)` on the sm tile. All three sites
  (sm wedge / lg ST pill in the top-right cluster / chrome bar copper rider) coordinated to the same
  `phaseCalendar.js` spring block for the account. PDC accounts only (5: CIN - AZ, TXR - AZ, TBR - FL,
  TBJ - FL, STL - FL - phase-driven, zero per-account UI code). STL - FL Spring runs Feb 9 - Mar 22
  (report-date, not game-window - Kevin Flag 1 ruling on PR #413). Annual January sanity check against
  `/api/v1/seasons?sportId=1|16` per [`SC_PDC_PHASES.md`](SC_PDC_PHASES.md). Legend row shows a half-scale swatch. (#413.)

## Per-section log
(sections appended as they complete: date · section · decisions · PR #)

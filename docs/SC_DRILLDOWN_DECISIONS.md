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

## Per-section log
(sections appended as they complete: date · section · decisions · PR #)

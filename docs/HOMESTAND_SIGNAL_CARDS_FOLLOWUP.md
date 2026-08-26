# FOLLOW-UP - homestand signal cards need their own Covers, hero flip, OT rename and hourly-only treatment

**Scoped out deliberately from the 2026-08-26 signal card revisions PR** (`sc/signal-card-revisions-2026-08-26`), not forgotten. This file exists so the next homestand pass has a named target to close.

## What the 2026-08-26 PR did NOT do on the homestand

Only the header shape (pill immediately left of `?`, eyebrow pushed left with `margin-right: auto`) was applied to the homestand's cards. The four other card revisions were scoped to the period board only:

1. **`Covers` dashed line on each card.** Period cards get one line derived from `board.weeks[]` naming which weeks are in the figures (e.g., "Covers 2 closed weeks + week 3 in progress · 49.1 hrs not yet approved"). Homestand cards do not carry this.
2. **Payroll data hero flip.** Period Payroll data card now leads with pending-approval hours; coverage drops to a fact. Homestand Payroll data card unchanged.
3. **`OT workers` -> `Week workers OT` rename.** Applied to the period Overtime card only. Homestand Overtime card still reads whatever it read before.
4. **Hourly-only pinning on Hours available + Payroll data regardless of the salary toggle.** Period cards read `hours_available_hourly` / `payroll_coverage_hourly` always. Homestand cards do not - they follow whatever the toggle says.

## Why scoped out

**A homestand is not a period.** Its window is a stand (a set of games), not a set of fiscal weeks. The Covers copy the period card carries ("2 closed weeks + week 3 in progress") cannot be reused - it has to be rewritten to describe stand shape (which games are in, which are still to play, which are already-final). The payroll hero flip, OT rename and hourly-only treatment are individually cheap; batching them with the Covers rewrite keeps the homestand pass coherent.

Owner ruling, 2026-08-26: "a homestand is not a period. Its coverage question is different - the window is a stand, not a set of fiscal weeks - and the copy would have to be rewritten rather than reused. Do not invent it. Log it as a follow-up so it does not silently drop."

## Scope for the follow-up PR

Files to touch (from the 2026-08-26 scoping pass):
- `src/app/kpi/labor/components/HomestandBoard.js` - the five homestand cards (spend / prep / game / OT / payroll)
- `src/app/kpi/labor/lib/signalCardModels.js` - homestand-specific model builders, or a homestand-scoped equivalent
- `src/lib/labor/salaryBoard.js` + `src/app/api/kpi/labor/route.js` - if hourly-only pinning needs stand-scoped server-provided inputs (probably: yes, mirror the period-board `hours_available_hourly` / `payroll_coverage_hourly` pattern for stand windows)

Design questions to resolve before starting:
1. What is a homestand's equivalent of "2 closed weeks + week 3 in progress"? Games played / games remaining? Days closed / days open?
2. Does the homestand's Payroll data card even have a pending-approval flow, or does the stand always resolve before payroll cycles?
3. The homestand OT card uses game-day windows; does the "Week workers OT" naming still fit, or is it "Stand workers OT"?

## Acceptance for the follow-up

- All five homestand cards carry a `Covers` line with copy appropriate to a stand window (not a fiscal period)
- Homestand Payroll data card leads with the operator-actionable number
- OT card label matches owner's homestand wording
- Homestand Hours available / Payroll data cards read hourly-only regardless of the salary toggle (same rule as the period board, applied here)
- Header heights stay equal across all five homestand cards (as they now do across the four period cards)

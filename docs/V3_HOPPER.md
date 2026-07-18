# V3 hopper (SC v2 - captured pre-audit items)

**Purpose.** This file captures items surfaced during the SC v2 program build (W7 onward) that
warrant a fresh look during the V3 audit arc after `sc-v2-complete` ships. It is deliberately
kept slim - each entry is a *seed*, not a resolution. The audit arc turns seeds into findings.

**SEALED.** The V3 audit arc runs as two independent audits against sealed hoppers - each
auditor keeps their pre-audit findings in a hopper the other cannot read until both audits
complete, then the two hoppers are exchanged and reconciled. **Do not read this hopper during
the independent audit passes.** It exists to prevent items from being lost between W7 and the
V3 arc, not to seed either audit with prior conclusions.

---

## Design-ish items (parked from W7 build)

- **Entry ghost-placeholder ink step-up.** The dashed ghost `placeholder` on the count input
  reads slightly too pale against the row background at default density. Look at nudging up the
  ink or dropping the dash weight; the target is "visibly the projection, but never confusable
  with a solid entry." (Surfaced during W7 PR 3/3 polish; parked because the ghost-ink token is
  used by the bill rail's ghost lines too - any change ripples and deserves a fresh audit.)

- **Modal edge treatment alignment.** DayEntryV2's overlay card has a `--sc2-radius-container`
  corner treatment; the coaching band, the two-pane divider, and the sticky group headers use
  different radius/border-line combos that don't quite compose. Not visibly wrong; the audit
  should decide whether one edge system covers all seams or whether the layered treatment is
  intentional.

- **Activity-band collapse when empty.** The standalone Activity composer + ledger sits at the
  bottom of the entry list even when a day has zero authored notes and zero history. On short
  days (an all-ghost tomorrow with one group) it's the tallest thing on the left pane. Consider
  collapsing to a single line "+ Add note" when no entries exist; expand on click.

- **Rail note-field label style.** "Note riding this save" is uppercase-caption per the current
  rail language; the surface it's on is dense with other micro-labels (ENTERED / PROJECTED,
  section names). The audit should decide if the note label needs a distinct treatment or if the
  section is right to homogenize.

## PR #467 body nits (post-merge cleanup, W7.5)

- **Gutter arithmetic.** PR #467 body describes "~15px per gutter" - the actual value at 1535px
  viewport is ~7.5px per gutter (15px total dead gutter across both sides after the 1520 shell
  binds). Cosmetic-only in a merged PR body; note for accuracy if the arithmetic ever gets
  cited.

- **Sweep date.** PR #467 body carries the date "2026-07-17" for the #466 sweep note; the fix
  commit `3b6e7c1` landed 2026-07-18 per the actual git log. Off by one day; cosmetic-only in a
  merged PR body.

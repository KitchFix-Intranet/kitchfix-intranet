# V3 hopper (SC v2 - captured pre-audit items)

**Purpose.** This file captures items surfaced during the SC v2 program build (W7 onward) that
warrant a fresh look during the V3 audit arc after `sc-v2-complete` ships. It is deliberately
kept slim - each entry is a *seed*, not a resolution. The audit arc turns seeds into findings.

**SEALED (findings) + SHARED (lenses).** The V3 audit arc runs as two independent audits
against sealed hoppers - each auditor keeps their pre-audit findings in a hopper the other
cannot read until both audits complete, then the two hoppers are exchanged and reconciled.
**Do not read the design-ish / hopper findings sections during the independent audit passes.**
The "V3 lenses (owner-stated, pre-audit)" section BELOW, by contrast, is intentionally shared
with both auditors - it captures owner-stated intent that shapes the brief without seeding
either audit's findings. Audit independence applies to findings; not to owner intent.

---

## next-season

- **MiLB homestand bar (CIN - KY / TBJ - NY): deferred.** sc-16 seeds their game rows
  with `homestand_id = NULL` - no HS grouping exists. Options when revisited:
  (A) DB seed HSn via extractor, or (B) client-derive from consecutive-game runs.
  OV-3 ships MiLB on PhaseStrip. Owner ruling 2026-07-19.

- **Drill Phase 2 - DayDetail / DayEntryV2 modal visual pass.** Deliberately deferred
  out of Drill Phase 1 scope (2026-07-20). DayDetail is the highest-traffic operator
  surface (every actuals entry passes through it) and has its own render pipeline
  (`v2/entry/DayEntryV2.js` + `entry/dayEntryV2.css`, plus the F1 History Activity
  ledger, submission toast, and dirty-close guard). Phase 1 shipped drill chrome +
  tile + rail + legend + tokens but left the modal untouched so P1 could ship without
  entangling actuals-entry regression risk. Phase 2 owns: navy scoreboard header
  alignment with V3 ribbon vocabulary, tightened clubhouse-card rows on the new
  card/tile radii, review + success overlay recheck against the state spine
  (Entered / Needs entry / Overdue / Upcoming), dirty-close guard behavior, and any
  DP1-24-style padding audit inside the modal itself.

- **DP1-20 FIGURES key drill-only scoping.** #481 hotfix reversed F8's popup-hide so
  FIGURES returns to `LegendInfoPopup` under scv2 for BOTH scopes (overview + drill),
  which was an overshoot vs the DP1-20 spec of drill-only. Proper scoping requires
  plumbing scope through `StateLegend -> LegendInfoPopup -> data-attr`; deferred as
  its own tiny surgical change rather than folded into a hotfix. Strip-level FIGURES
  row also not added.

- **Demolition-PR cleanup: F3-redux + drill-P1 instrumentation.** The `data-f3-target`
  attribute added during the STL - FL scrollTop gate cell is still present on
  `.sc-rail-scroll` at `SeasonRail.js` + `OpsRail.js` (harmless; no runtime cost).
  Drill P1's HF-5 dedup left the rail `exportControl` prop contract intact
  (`DrillRail.js:359` / `OpsRail.js:263` conditional retained for any future overview
  rail-footer export mount). Both slated for removal in the W9 demolition PR alongside
  the `sc-v2-complete` tag.

---

## V3 lenses (owner-stated, pre-audit)

Shared with both auditors. These are brief-level directions from the owner that shape the audit
without pre-deciding its findings.

- **Mobile is a companion, not a mirror** (Kevin, 2026-07-18). The mobile experience should be
  purpose-built around the floor jobs - glance the books, see the queue, enter a day, check a
  day - rather than reproducing desktop's full capability. Gen-1 (W8) deliberately shipped
  reachability-parity as a floor so the subset decision can be made from evidence; V3 audits
  mobile with a SUBTRACTION BIAS - every desktop-inherited affordance must justify its place on
  the phone or be cut/relocated. Candidates surfaced during W8, to be audited rather than
  pre-decided: density toggle, full Jan-Dec phase timeline, bulk mode, export, admin lock at
  mobile widths. Scope note: this lens is brief-level and intentionally shared with both
  auditors; audit independence applies to findings, not to owner intent.

---

## Design-ish items (parked from W7 build)

- **Entry ghost-placeholder ink step-up.** (Resolved in #468 F2.) The initial P1.1 write set
  `.sc-day-input--ghost::placeholder` to `--sc2-ghost` (#a49c8a) on `--sc2-surface-page`
  (#e8e3d8), measuring 2.13:1 - below the 3.27 placeholder floor. F2 relanded on
  `--sc2-ink-muted` (#6d737c) at 3.74:1, above the floor and matching v1's `--text-muted`
  placeholder pattern. The wider `--sc2-ghost` token still governs the bill rail's ghost lines
  (rail palette) - that surface is a separate audit target from the entry input.

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

- **Mobile footer height as a magic number.** (Resolved in W9 PR 1/2.) `tokens.css` now
  declares a token PAIR: `--sc2-mobile-bar-h` (60px, read-surface footer = bar only) and
  `--sc2-mobile-footer-h` (116px, entry-surface footer = bar + Confirm CTA stacked). Every
  coupled site reads the token: read-surface pane `padding-bottom` and `MobileBooksBar` fixed
  offsets consume `--sc2-mobile-bar-h`; entry pane `padding-bottom` + sheet inset consume
  `--sc2-mobile-footer-h`; MobileBooksBar's `.sc-mobile-books-bar--with-action` variant offsets
  itself by the difference to preserve the stack. The two heights intentionally differ; V3 may
  collapse them if the design unifies further.

## PR #467 body nits (post-merge cleanup, W7.5)

- **Gutter arithmetic.** PR #467 body describes "~15px per gutter" - the actual value at 1535px
  viewport is ~7.5px per gutter (15px total dead gutter across both sides after the 1520 shell
  binds). Cosmetic-only in a merged PR body; note for accuracy if the arithmetic ever gets
  cited.

- **Sweep date.** PR #467 body carries the date "2026-07-17" for the #466 sweep note; the fix
  commit `3b6e7c1` landed 2026-07-18 per the actual git log. Off by one day; cosmetic-only in a
  merged PR body.

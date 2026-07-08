# DESIGN_AUDIT_LEDGER.md — Service Calendar

> Fix-phase contract. Findings referenced by ID only. Statuses: OPEN → IN PROGRESS → RESOLVED →
> VERIFIED, plus WONTFIX (reason required). New issues during fixes go to Candidates, never the table.

**Status: Section 1 fixes complete pending runtime checks · 0 sev-4 open · remaining open: SC-014/015/020 (runtime), SC-011 (parked), SC-035 (cleanup phase)**

## Section 1 — Calendar + Period Overview (PDC / MLB / MiLB) · audited 2026-07-08

Evidence: Img 1 (skeleton), Img 2/3 (PDC cal/period), Img 4/5 (MLB), Img 6/7 (MiLB), Img 8 (legend
popup) + CC read-only investigation (contrast/CVD measured, behaviors verified at file:line).

| ID | Sev | Lens | Finding | Evidence | Fix | Tier | Status | Verified by |
|----|-----|------|---------|----------|-----|------|--------|-------------|
| SC-001 | 3 | CogLoad | MLB game days decode only via legend (shares generic upcoming ○) | Img 4/5; dayResolvers.js:53-55 folds all to "upcoming" | Strengthened ring shipped in #353, REVERTED per owner review 2026-07-08 - the original faint ○ preferred; ring read as noise across upcoming months. | CONFIRMED | WONTFIX | CC B6 + #353 + owner review |
| SC-002 | — | CogLoad | Passive fill separation | CVD sim: entered vs upcoming 111-117 = distinguishable | None needed | CONFIRMED | VERIFIED (non-issue) | CC A6 |
| SC-003 | 1 | CogLoad | Period band colors unkeyed | Phase-encoded (phaseCalendar.js:33) AND PhaseStrip shares the tints - the key exists on-screen | None; perception-of-link only | CONFIRMED | VERIFIED (non-issue) | CC A4 |
| SC-004 | — | CogLoad | Day grids at overview altitude | Img 2-7 | Year-heatmap is the overview's job | CONFIRMED | WONTFIX (documented intent) | Kevin ruling |
| SC-005 | — | CogLoad | 12-13 top-level chunks | Img 2-7 | Calendar-grid familiarity accepted | CONFIRMED | WONTFIX | Kevin ruling |
| SC-006 | 1 | CogLoad | Homestand blocks unlabeled except current | Img 4/5 | Label/tooltip blocks (tap-visible - all-devices ruling) | CONFIRMED | RESOLVED | #355 |
| SC-007 | — | CogLoad | Period model + intra-card month flip | Img 3/5/7 | Operator domain knowledge | CONFIRMED | WONTFIX | Kevin ruling |
| SC-008 | 3 | Hierarchy | Urgent chip lowest-weight in cluster (behavior already correct: drills + opens day) | Img 2/3/6/7; ChromeBar.js:172-195; jumpToDay SC.js:1058 | Promote the chip to the primary visual action. Labels shortened to "Overdue"/"Needs entry" post-review (wrap break at real counts). | CONFIRMED | RESOLVED | CC B1 + #354 |
| SC-009 | — | Hierarchy | No primary path to actionable day | Path exists (chip drill+focus) | Folded into SC-008 | CONFIRMED | RESOLVED (merged SC-008) | CC B1 |
| SC-010 | — | Hierarchy | Hero pushes grid below fold | Img 2-7 | Hero stays as-is (ruling 2026-07-08) | CONFIRMED | WONTFIX | Kevin ruling |
| SC-011 | 2 | Hierarchy | 200% zoom / text-scaling unverified; DS doc silent | CC B8: no zoom clause | PARKED - separate discussion post-fixes (ruling) | HYP-RUNTIME | OPEN (parked) | Kevin ruling |
| SC-012 | 3 | Feedback | Projected $ reads as earned on overview cards | Img 2; MonthCard.js:377-393 value-switch exists, presentation identical | Make projected unmistakable: ~ prefix + muted, expanded + collapsed (semantics confirmed) | CONFIRMED | RESOLVED | CC B4 + Kevin ruling + #355 |
| SC-013 | — | Feedback | Interactive-state inventory | Full matrix at CC A1 | Residue split to SC-034 | HYP-CODE | VERIFIED | CC A1 |
| SC-014 | 2 | Feedback | Stale-data authority | Timestamp exists; behavior unverified | Runtime check (Step 4) | HYP-RUNTIME | OPEN | — |
| SC-015 | 2 | Feedback | Failed-cell legibility live | Blocked by SC-033 (unreachable) | Verify after SC-033 hook ships - test via ?debug=failed | HYP-RUNTIME | OPEN | — |
| SC-016 | 2 | Feedback | Skeleton shape mismatch + strip re-label | Img 1 vs 2; motion + reduced-motion PASS (CC A7) | Card-shaped skeleton + neutral strip label | CONFIRMED | RESOLVED | CC A7 + #355 |
| SC-017 | 3 | A11y | Day-number contrast fails on OFF (4.11) + MLB ○ badge (4.01); upcoming PASSES 12.91. RULING SPLIT: badge half resolved via SC-001; off-number half WONTFIX - documented AA exception at 4.11:1 (off tiles deliberately de-emphasized, ruling 2026-07-08). Post-review: badge half ALSO reverted with SC-001 - the ○ at 4.01:1 is now a second documented AA exception (ruling 2026-07-08). | CC A5 measured; unused --status-off/upcoming-fg tokens exist at n-700 | Badge half: via SC-001 ring. Off-number half: none (exception recorded) | CONFIRMED | RESOLVED (badge half via SC-001; off-number half WONTFIX per ruling) | CC A5 + Kevin ruling + #353 |
| SC-018 | — | A11y | Entered vs off hue-only | CVD sim distinguishable (115-123) | None | CONFIRMED | VERIFIED (non-issue) | CC A6 |
| SC-019 | — | A11y | Entered vs overdue under CVD | Marginal (25-27) but the ! glyph is load-bearing per documented intent | None; glyph rule stays hard | CONFIRMED | VERIFIED (note) | CC A6 + B7 |
| SC-020 | 2 | A11y | As-of pill contrast over hero photo (lock: resolved - admin-gated + labeled) | CC B3; pill composite unverifiable from source | Runtime check over bright photos | HYP-RUNTIME | OPEN | CC B3/A5 |
| SC-021 | 3 | A11y | Chrome micro labels 2.56:1 - worst on surface | CC A5: #94A3B8 on white | Darken the cluster label token | CONFIRMED | RESOLVED | CC A5 + #354 |
| SC-022 | — | A11y | Tile hit region | 44px height confirmed; tiles inert at overview; width note deferred to Section 2 | None here | CONFIRMED | VERIFIED | CC A2 |
| SC-023 | — | A11y | Phase-band label contrast | All 8 bands AA (4.64-6.22) | None | CONFIRMED | VERIFIED | CC A5 |
| SC-024 | — | Content | Fee-schedule microcopy jargon | FullSeasonCard.js:134, all users | Leave as is | CONFIRMED | WONTFIX (ruling 6) | Kevin ruling |
| SC-025 | 4 | Content | "ON TRACK" is a hardcoded literal - fabricated status at 0/81 | ChromeBar.js:205-227 FeeStat | REMOVE the token until a business rule exists (ruling 1) | CONFIRMED | RESOLVED | CC B5 + #354 |
| SC-026 | 2 | Content | Click affordance: cards hover-only, tiles look tappable but inert (absorbs SC-030) | CC B2; all-devices ruling makes hover-only insufficient | Tap-visible card affordance; tile styling reads display-only | CONFIRMED | RESOLVED | CC B2 + #355 |
| SC-027 | — | Content | Status vocabulary varies per account | Img 2/4/6 | Intended domain variance | CONFIRMED | WONTFIX | Kevin ruling |
| SC-028 | — | Content | Fiscal-period deviation | Img 3/5/7 | Domain-justified | CONFIRMED | WONTFIX | Kevin ruling |
| SC-029 | 1 | Consistency | PHASE TIMELINE (PDC) vs SEASON bar (MiLB) | Img 2 vs 6 | Data-driven variance - PDC accounts carry phase timeline data (PhaseStrip); MiLB has none, so the plain SEASON bar renders. Documented, not a fork. | CONFIRMED | RESOLVED | Kevin ruling |
| SC-030 | — | Contrast | Interactive vs static affordance | Merged into SC-026 | — | CONFIRMED | RESOLVED (merged) | — |
| SC-031 | — | Consistency | Legend variance per account | Img 2/4/6/8 | Intended | CONFIRMED | WONTFIX | Kevin ruling |
| SC-032 | — | Consistency | MonthCard/PeriodCard near-dupes (~60%), legend dupes | CC A3 | Feeds the codebase-cleanup phase (SC-035) | HYP-CODE | VERIFIED | CC A3 |
| SC-033 | 3 | Feedback | Failed state UNREACHABLE - no consumer passes loadState; no test hook | dayResolvers.js:46-48; MonthCard.js:299, PeriodCard.js:124 single-arg | Wire loadState on overview consumers + add a dev failure hook (?debug=failed) | CONFIRMED (code) | RESOLVED | CC B10 + Chat spot-check + #353 |
| SC-034 | 2 | Feedback | No :active (pressed) state on any interactive element; :disabled gaps | CC A1 matrix | Add pressed feedback to chrome + cards (all-devices) | CONFIRMED (code) | RESOLVED | CC A1 + #354 (chrome) + #355 (cards) |
| SC-035 | 1 | Consistency | Duplicated ProgressBar components + sun/moon SVGs across 3 sites | CC A3 + Flags | Consolidate in the codebase-cleanup phase | CONFIRMED (code) | OPEN (cleanup phase) | CC A3 |

## Fix before ship (open sev 3-4, ranked)
1. **SC-025 (4)** - remove the fabricated ON TRACK token. *Non-issue condition: none - a hardcoded health assertion cannot be fine.*
2. **SC-017 (3, badge half)** - ○-badge contrast, resolved via the SC-001 ring. *Off-number half is a recorded AA exception by ruling.*
3. **SC-021 (3)** - cluster micro labels at 2.56:1. *Fine only if the labels are decorative - they label the values.*
4. **SC-012 (3)** - projected $ indistinct from earned. *Fine only if operators always read the entered-count first - Img 2 shows the $ dominates.*
5. **SC-033 (3)** - failed state unreachable. *Fine only if overview fetch failures surface some other honest way - unverified, and untestable without the hook.*
6. **SC-008 (3)** - urgent action lowest-ranked. *Fine only if operators triage from tiles - chip usage says otherwise (it exists because tiles don't scale).*
7. **SC-001 (3)** - MLB scheduled marker legend-dependent. *Fine only if operators use the homestand strip instead - strip is itself unlabeled (SC-006).*

## Bundle map
- **Bundle 1 - tiles/tokens:** SC-001, SC-033 (+ SC-017 badge half)
- **Bundle 2 - chrome:** SC-025, SC-008, SC-021, SC-034 (chrome)
- **Bundle 3 - cards/skeleton/wayfinding:** SC-012, SC-016, SC-026, SC-006, SC-034 (cards), SC-029
- **Runtime (Step 4, post-merge):** SC-014, SC-015, SC-020
- **Parked:** SC-011 (zoom - separate discussion) · **Cleanup phase:** SC-035 (+ SC-032 residue)

## Do not touch
Three-way loading/failed/zero atom structure (wire it, don't redesign it) · roving-tabindex keyboard
grid · icons-only-on-actionable rule (CVD proved the ! glyph load-bearing) · phase-encoding system ·
account-type polymorphism · skeleton motion + reduced-motion guards.

## Inverse audit (not asked, flagging anyway)
- The client-clock TODAY (SC.js:1024) vs server yearToday.date could disagree across midnight/timezones - worth a runtime look someday.
- PeriodCard's <article role="button"> is valid but non-native; fine now, note for a strict a11y pass.
- fmtK dead branch in PeriodCard (CC A3) - cleanup-phase fodder.

## Candidates (new issues found during fixes land here)
- SC-036 (candidate, from #354 review): the promoted urgent chips live in the chrome stats cluster,
  which hides below 640px (chromeBar.css ~:235). The CSS comment claims mobile urgency is carried by
  the StickyContext bar + InfoCard ActionBand, but the ActionBand was replaced BY these chips - the
  fallback claim may be stale. Under the all-devices ruling, verify what urgency affordance exists
  on <640px phones (Kevin phone-check in the runtime pass, or a CC read of StickyContext). If none,
  this promotes to a real finding.

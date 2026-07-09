# DESIGN_AUDIT_LEDGER.md - Service Calendar

> Fix-phase contract. Findings referenced by ID only. Statuses: OPEN → IN PROGRESS → RESOLVED →
> VERIFIED, plus WONTFIX (reason required). New issues during fixes go to Candidates, never the table.

**Status: Sections 1-3 + Owner Rounds 2-3 complete pending runtime checks · 0 sev-4 open · remaining open: SC-014/015/020 (runtime), SC-011 (parked), candidates (cleanup phase) · cleanup C1a merged, C1b next**

## Section 1 - Calendar + Period Overview (PDC / MLB / MiLB) · audited 2026-07-08

Evidence: Img 1 (skeleton), Img 2/3 (PDC cal/period), Img 4/5 (MLB), Img 6/7 (MiLB), Img 8 (legend
popup) + CC read-only investigation (contrast/CVD measured, behaviors verified at file:line).

| ID | Sev | Lens | Finding | Evidence | Fix | Tier | Status | Verified by |
|----|-----|------|---------|----------|-----|------|--------|-------------|
| SC-001 | 3 | CogLoad | MLB game days decode only via legend (shares generic upcoming ○) | Img 4/5; dayResolvers.js:53-55 folds all to "upcoming" | Strengthened ring shipped in #353, REVERTED per owner review 2026-07-08 - the original faint ○ preferred; ring read as noise across upcoming months. | CONFIRMED | WONTFIX | CC B6 + #353 + owner review |
| SC-002 | - | CogLoad | Passive fill separation | CVD sim: entered vs upcoming 111-117 = distinguishable | None needed | CONFIRMED | VERIFIED (non-issue) | CC A6 |
| SC-003 | 1 | CogLoad | Period band colors unkeyed | Phase-encoded (phaseCalendar.js:33) AND PhaseStrip shares the tints - the key exists on-screen | None; perception-of-link only | CONFIRMED | VERIFIED (non-issue) | CC A4 |
| SC-004 | - | CogLoad | Day grids at overview altitude | Img 2-7 | Year-heatmap is the overview's job | CONFIRMED | WONTFIX (documented intent) | Kevin ruling |
| SC-005 | - | CogLoad | 12-13 top-level chunks | Img 2-7 | Calendar-grid familiarity accepted | CONFIRMED | WONTFIX | Kevin ruling |
| SC-006 | 1 | CogLoad | Homestand blocks unlabeled except current | Img 4/5 | Label/tooltip blocks (tap-visible - all-devices ruling) | CONFIRMED | RESOLVED | #355 |
| SC-007 | - | CogLoad | Period model + intra-card month flip | Img 3/5/7 | Operator domain knowledge | CONFIRMED | WONTFIX | Kevin ruling |
| SC-008 | 3 | Hierarchy | Urgent chip lowest-weight in cluster (behavior already correct: drills + opens day) | Img 2/3/6/7; ChromeBar.js:172-195; jumpToDay SC.js:1058 | Promote the chip to the primary visual action. Labels shortened to "Overdue"/"Needs entry" post-review (wrap break at real counts). | CONFIRMED | RESOLVED | CC B1 + #354 |
| SC-009 | - | Hierarchy | No primary path to actionable day | Path exists (chip drill+focus) | Folded into SC-008 | CONFIRMED | RESOLVED (merged SC-008) | CC B1 |
| SC-010 | - | Hierarchy | Hero pushes grid below fold | Img 2-7 | Hero stays as-is (ruling 2026-07-08) | CONFIRMED | WONTFIX | Kevin ruling |
| SC-011 | 2 | Hierarchy | 200% zoom / text-scaling unverified; DS doc silent | CC B8: no zoom clause | PARKED - separate discussion post-fixes (ruling) | HYP-RUNTIME | OPEN (parked) | Kevin ruling |
| SC-012 | 3 | Feedback | Projected $ reads as earned on overview cards | Img 2; MonthCard.js:377-393 value-switch exists, presentation identical | Make projected unmistakable: ~ prefix + muted, expanded + collapsed (semantics confirmed) | CONFIRMED | RESOLVED | CC B4 + Kevin ruling + #355 |
| SC-013 | - | Feedback | Interactive-state inventory | Full matrix at CC A1 | Residue split to SC-034 | HYP-CODE | VERIFIED | CC A1 |
| SC-014 | 2 | Feedback | Stale-data authority | Timestamp exists; behavior unverified | Runtime check (Step 4) | HYP-RUNTIME | OPEN | - |
| SC-015 | 2 | Feedback | Failed-cell legibility live | Blocked by SC-033 (unreachable) | Verify after SC-033 hook ships - test via ?debug=failed | HYP-RUNTIME | OPEN | - |
| SC-016 | 2 | Feedback | Skeleton shape mismatch + strip re-label | Img 1 vs 2; motion + reduced-motion PASS (CC A7) | Card-shaped skeleton + neutral strip label | CONFIRMED | RESOLVED | CC A7 + #355 |
| SC-017 | 3 | A11y | Day-number contrast fails on OFF (4.11) + MLB ○ badge (4.01); upcoming PASSES 12.91. RULING SPLIT: badge half resolved via SC-001; off-number half WONTFIX - documented AA exception at 4.11:1 (off tiles deliberately de-emphasized, ruling 2026-07-08). Post-review: badge half ALSO reverted with SC-001 - the ○ at 4.01:1 is now a second documented AA exception (ruling 2026-07-08). | CC A5 measured; unused --status-off/upcoming-fg tokens exist at n-700 | Badge half: via SC-001 ring. Off-number half: none (exception recorded) | CONFIRMED | RESOLVED (badge half via SC-001; off-number half WONTFIX per ruling) | CC A5 + Kevin ruling + #353 |
| SC-018 | - | A11y | Entered vs off hue-only | CVD sim distinguishable (115-123) | None | CONFIRMED | VERIFIED (non-issue) | CC A6 |
| SC-019 | - | A11y | Entered vs overdue under CVD | Marginal (25-27) but the ! glyph is load-bearing per documented intent | None; glyph rule stays hard | CONFIRMED | VERIFIED (note) | CC A6 + B7 |
| SC-020 | 2 | A11y | As-of pill contrast over hero photo (lock: resolved - admin-gated + labeled) | CC B3; pill composite unverifiable from source | Runtime check over bright photos | HYP-RUNTIME | OPEN | CC B3/A5 |
| SC-021 | 3 | A11y | Chrome micro labels 2.56:1 - worst on surface | CC A5: #94A3B8 on white | Darken the cluster label token | CONFIRMED | RESOLVED | CC A5 + #354 |
| SC-022 | - | A11y | Tile hit region | 44px height confirmed; tiles inert at overview; width note deferred to Section 2 | None here | CONFIRMED | VERIFIED | CC A2 |
| SC-023 | - | A11y | Phase-band label contrast | All 8 bands AA (4.64-6.22) | None | CONFIRMED | VERIFIED | CC A5 |
| SC-024 | - | Content | Fee-schedule microcopy jargon | FullSeasonCard.js:134, all users | Leave as is | CONFIRMED | WONTFIX (ruling 6) | Kevin ruling |
| SC-025 | 4 | Content | "ON TRACK" is a hardcoded literal - fabricated status at 0/81 | ChromeBar.js:205-227 FeeStat | REMOVE the token until a business rule exists (ruling 1) | CONFIRMED | RESOLVED | CC B5 + #354 |
| SC-026 | 2 | Content | Click affordance: cards hover-only, tiles look tappable but inert (absorbs SC-030) | CC B2; all-devices ruling makes hover-only insufficient | Tap-visible card affordance; tile styling reads display-only | CONFIRMED | RESOLVED | CC B2 + #355 |
| SC-027 | - | Content | Status vocabulary varies per account | Img 2/4/6 | Intended domain variance | CONFIRMED | WONTFIX | Kevin ruling |
| SC-028 | - | Content | Fiscal-period deviation | Img 3/5/7 | Domain-justified | CONFIRMED | WONTFIX | Kevin ruling |
| SC-029 | 1 | Consistency | PHASE TIMELINE (PDC) vs SEASON bar (MiLB) | Img 2 vs 6 | Data-driven variance - PDC accounts carry phase timeline data (PhaseStrip); MiLB has none, so the plain SEASON bar renders. Documented, not a fork. | CONFIRMED | RESOLVED | Kevin ruling |
| SC-030 | - | Contrast | Interactive vs static affordance | Merged into SC-026 | - | CONFIRMED | RESOLVED (merged) | - |
| SC-031 | - | Consistency | Legend variance per account | Img 2/4/6/8 | Intended | CONFIRMED | WONTFIX | Kevin ruling |
| SC-032 | - | Consistency | MonthCard/PeriodCard near-dupes (~60%), legend dupes | CC A3 | WONTFIX per owner ruling 2026-07-09: measured code overlap 8.6-10.7% (not the ~60% estimated); parallel implementations ruled legible; visual family already shared via tokens. Survey: docs/audits/SC_CLEANUP_SURVEY_2026-07-09.md §A1. | HYP-CODE | WONTFIX | CC A3 + Kevin ruling |
| SC-033 | 3 | Feedback | Failed state UNREACHABLE - no consumer passes loadState; no test hook | dayResolvers.js:46-48; MonthCard.js:299, PeriodCard.js:124 single-arg | Wire loadState on overview consumers + add a dev failure hook (?debug=failed) | CONFIRMED (code) | RESOLVED | CC B10 + Chat spot-check + #353 |
| SC-034 | 2 | Feedback | No :active (pressed) state on any interactive element; :disabled gaps | CC A1 matrix | Add pressed feedback to chrome + cards (all-devices) | CONFIRMED (code) | RESOLVED | CC A1 + #354 (chrome) + #355 (cards) |
| SC-035 | 1 | Consistency | Duplicated ProgressBar components + sun/moon SVGs across 3 sites | CC A3 + Flags | Consolidated in cleanup C1a (glyphs -> Icons.js, ProgressBar -> season/ProgressBar.js). Note: the 2026-07-09 WONTFIX mis-scoped - the 8.6% overlap rationale applied to SC-032's card merge only. | CONFIRMED (code) | RESOLVED | CC A3 + C1a |

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
- **Parked:** SC-011 (zoom - separate discussion) · **Cleanup phase:** SC-035 resolved in C1a; SC-032 WONTFIX per owner ruling

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

## Section 2 - Drill-in Month + Period (PDC / MLB / MiLB) · audited 2026-07-08

Evidence: Img 1 PDC month (CIN-AZ Jul), Img 2 PDC month past (TXR-AZ Jun), Img 3 MLB month past
(STL-MO), Img 4 MLB month (TXR-TX-H Jul), Img 5 MiLB month (CIN-KY), Img 6 MiLB period (P7), Img 7 MLB
period (P7), Img 8 PDC period worst-case (TXR-AZ P7), Img 9 PDC period best-case (CIN-AZ P7) + fresh
SC-038 capture (12:07 PM) + CC read-only investigation @ 2e07670.

| ID | Sev | Lens | Finding | Evidence | Fix | Tier | Status | Verified by |
|----|-----|------|---------|----------|-----|------|--------|-------------|
| SC-037 | 3 | Consistency | Fee chips contradict tiles/legend; fee chip click is DEAD (handler filters a status fee days never emit) | Img 3/4/7; dataStore:193-202 fold vs SC.js aggregate; jump filter SC.js:629 | RULING SPLIT 2026-07-08: (a) PDC fee = real urgency states end-to-end; (b) MLB homestand = pure schedule view, chips + amber trigger removed | CONFIRMED | RESOLVED | CC A1 + Chat verify + #358 |
| SC-038 | 3 | Feedback | Chip counts include past no-service days (phantom counts vs grid) | Img 9 + fresh 12:07 capture: 1+1 chips, 0 urgent tiles | Aggregate urgency counters switch to classified status (pipeline unification) | CONFIRMED (capture; data verify in PR) | RESOLVED | Kevin capture + CC + #358 |
| SC-039 | 3 | States | MiLB renders $0/est. $0 on no-service days (zero-vs-no-service confusable) | Img 5 vs 1; renderMilb lacks per-meal's !meals guard (DaySquare:235 vs :278) | Add the No-service short-circuit to renderMilb | CONFIRMED | RESOLVED | CC A3 + #359 |
| SC-040 | 3 | Wayfinding | Bulk unreachable on past scopes (self-flagged in code) | PW:499-503 comment; :154 gate | Past-scope slim bulk rail (render approved) | CONFIRMED | RESOLVED | CC A4 + #358 |
| SC-041 | 2 | Consistency | est./~/bare is a real encoding, unkeyed | DaySquare:245; PW:745 | Keep + key in legend popup (ruling) | CONFIRMED | RESOLVED | CC A5 + #359 |
| SC-042 | 2 | Consistency | Fee meal projections unmarked; true zero silently dropped | DaySquare:259-276; PW:721-727 | ~ prefix on unentered fee meals; render true 0 on entered days | CONFIRMED | RESOLVED | CC A6 + #359 |
| SC-043 | 2 | Content | Week denominators count calendar days; no-service weeks read 7/7 or 0/7 | SC.js:70-76; Img 6/7 | Service/game-day denominators + No-service week card (render approved; explicit-zero stays complete per ruling). Fee-week half superseded by owner ruling 2026-07-09 (SC-073) - week cards removed on homestand accounts. | CONFIRMED | RESOLVED | CC A7 + ruling + #358 |
| SC-044 | 1 | Content | Phase token unlabeled + abbreviated ("Complex") | PeriodHeaderNav:99-108, 170-173 | title + aria carry the full phase label | CONFIRMED | RESOLVED | CC A12 + #359 |
| SC-045 | 1 | Content | "1 meals" (no pluralization) | DaySquare:48 + hardcoded units | Pluralize meal/meals at all unit sites | CONFIRMED | RESOLVED | CC A10 + #359 |
| SC-046 | - | Feedback | Progress-bar color | Threshold-derived (PW:215): amber=pending, green=done | Accepted as-is (ruling); fee amber resolves via SC-037(b) | CONFIRMED | VERIFIED (ruling) | CC A11 + Kevin |
| SC-047 | 3 | States | Drill failure = infinite skeleton; failed atom unreachable; ?debug=failed overview-only | SC.js:310-320; PW:667 single-arg | Wire loadState through drill scopes + extend the dev hook (SC-033 pattern) | CONFIRMED | RESOLVED | CC A8 + Chat verify + #358 |
| SC-048 | - | Feedback | Band chip interactivity | PW:277-370: buttons; per-meal jump works; fee click dead | RESOLVED (split: works / SC-037 / SC-049) | CONFIRMED | RESOLVED | CC A9 |
| SC-049 | 2 | Feedback | Drill band chips missed #354's :active fix | pw.css:186-220 | Pressed state + reduced-motion pair | CONFIRMED | RESOLVED | CC A9 + #359 |
| SC-050 | 1 | Content | MiLB tiles render meals count with no unit | DaySquare:296 | Add the meals unit (with SC-045) | CONFIRMED | RESOLVED | CC Flags + #359 |

Section-1 carry-forwards resolved here: SC-022 fully CLOSED (lg tiles exceed 44px both axes, Img 1-9);
SC-036 unchanged (drill band chips do NOT hide on mobile per CC B3 - the gap is chrome-cluster-only).

### Candidates (Section 2)
- Stale day.isPast across midnight (baked at fetch) feeds chips + bar - runtime someday.
- Workspace skeleton is a raw grid, not card-anatomy (SC-016 parity) - polish someday.
- Skeleton hardcodes 28 tiles regardless of period length (28-31) - RESOLVED in cleanup C1a (derives from periodRange, falls back to 28 when unknown).
- Partial-vs-total period-failure paths are subtle (PW:118-129) - watch during SC-047 work.

## Section 3 - Submissions + Confirmations (entry / review / success / toast / bulk) · audited 2026-07-08

Evidence: Img 1 entry empty, Img 2 entry+deltas, Img 3 off-group+notes, Img 4 review, Img 5 toast,
Img 6 multi-group entry, Img 7 bulk-select, Img 8 bulk review, Img 9 bulk toast + CC read-only
investigation @ 406e55c (money trace, guards, a11y inventory, measured ratios).

| ID | Sev | Lens | Finding | Evidence | Fix | Tier | Status | Verified by |
|----|-----|------|---------|----------|-----|------|--------|-------------|
| SC-051 | 3 | Feedback | Four totals, three sources for one save: row-vs-header rounding artifact + toast recomputes from CURRENT catalog vs effective-dated elsewhere; server returns no total to echo | Img 8 ($21,490 vs 6x$3,582 vs $21,483.00 toast); CC A1 trace | RULING: server computes + returns saved revenue (effective-dated); review/toast echo; header = sum of displayed rows | CONFIRMED | RESOLVED | CC A1 + Chat verify + #361 |
| SC-052 | 2 | Consistency | Modal header projection unmarked + silently flips to actuals; $2,708/$2,709 rail drift = same price-source fork | Img 1 vs rail; CC A6 | ~ prefix until first entry + effective-dated source | CONFIRMED | RESOLVED | CC A6 + #361 |
| SC-053 | 4 | Feedback | Day notes BLACK-HOLED: textarea wired to nothing - typed notes silently discarded while toast confirms success; day_notes column read but never written | DayDetail:40,560-563 (onChange only); CC A4 + Chat verify | RULING: wire end-to-end (payload + upsert + reopen prefill + review row) | CONFIRMED | RESOLVED | CC A4 + Chat verify + #361 |
| SC-054 | 2 | Hierarchy | Review strips the delta chips entry showed - anomaly signal dropped at the confirm step | Img 2 vs 4; projections in scope per CC A5 | Carry delta chips into review rows (render approved) | CONFIRMED | RESOLVED | CC A5 + #362 |
| SC-055 | 2 | Feedback | Double-click guard PRESENT (disabled=saving, all 4 buttons); abort/unmount guard ABSENT - mid-flight close still toasts | CC A2 | Mounted-ref/abort guard on save handlers | CONFIRMED (split) | RESOLVED | CC A2 + #361 |
| SC-056 | - | States | Empty-save gate | Triple gate verified: disabled button + executeSave guard + server 400 | None | CONFIRMED | VERIFIED (non-issue) | CC A3 |
| SC-057 | 1 | Consistency | Toasts show cents on a whole-dollar surface | Img 5/9 | Whole dollars (server echo formatted) | CONFIRMED | RESOLVED | #362 |
| SC-058 | 1 | Content | "Minor League - PDC · PDC · $11.55/meal" - segment prefix collides with group names carrying the segment | Img 6; CC A9 (both sources) | Render-side dedupe: suppress prefix when group name ends with the segment | CONFIRMED | RESOLVED | CC A9 + #362 |
| SC-059 | 2 | A11y | Ghost-input placeholder 2.43:1; projection vanishes on type | Img 1/6; CC A7 measured | RULING: minimal - darken placeholder token to pass (delta chip covers post-entry recall) | CONFIRMED | RESOLVED | CC A7 + ruling + #362 |
| SC-060 | 2 | A11y/Feedback | Toast not dismissable + container lacks pointer-events:none (~420x100 dead zone over the grid for 4.5s); trap/aria otherwise solid | CC A8 + Chat verify | pointer-events:none on container + click-to-dismiss on card | CONFIRMED | RESOLVED | CC A8 + #362 |
| SC-061 | 2 | A11y | Delta amber #D97706 at 12px = 3.19:1 + --text-subtle fails at 3 sites | CC A7 table | Darken delta + placeholder/cancel tokens to pass | CONFIRMED | RESOLVED | CC A7 + #362 |
| SC-062 | 3 | Consistency | "Enter custom values" writes N days directly with NO review while Match-projections has one - asymmetric ceremony on a bulk money write | CC A10 | RULING: add the review step (reuses bulk-review anatomy, render approved) | CONFIRMED | RESOLVED | CC A10 + #362 |
| SC-063 | 3 | Feedback | Esc/backdrop-click silently discard mid-entry - no unsaved-changes guard; keyboard flow makes stray Esc easy | CC A8 + Chat verify (onClose unguarded) | Dirty guard: confirm dialog on Esc/backdrop/Cancel when entries or note typed (render approved) | CONFIRMED | RESOLVED | CC A8 + Chat verify + #362 |

### Candidates (Section 3)
- Three independent fmt$ implementations - consolidate (Bundle 2 takes it).
- Em-dash in UI literal at ServiceCalendar.js:~1585 ("Bulk entry — {N} days") - hyphen per repo rule (Bundle 2).
- Remaining CC Flags (15 actual; harvested 2026-07-09 - 12 retired by #361/#362/#366/#368, 3 survive: F4 AbortController, F10 focus placement, F11 success-screen role=status - queued to cleanup C1b alongside the stale-isPast-midnight item. Source: docs/audits/SC_SECTION3_INVESTIGATION_2026-07-08.md).
- Dirty guard over-triggers when retyping identical values (touched = typed-this-session, not
  differs-from-initial) - conservative in the safe direction, accepted (post-merge review note).
  Round 2 partial-retire: type-then-delete on a previously-empty row now correctly removes touched
  (SC-071), so the phantom-dirty case narrows to actual retype-to-same-value.

## Owner Review Round 2 - interactive audit (Kevin, 2026-07-08 PDF) · specced 2026-07-09

Source: DesignReviewInteractiveAuditSC (11 items) + Chat evaluation + code verification + render pack
(SC_owner_round2_renders.html) approvals: A-amber, B2, C2-modified, D, E-a, F3.

| ID | Sev | Item | Finding | Fix (approved) | Status | Verified by |
|----|-----|------|---------|----------------|--------|-------------|
| SC-064 | 2 | 1 | Delta chips: direction should carry meaning; red rejected (blame connotation) | under=amber / over=green / match=green ✓; magnitude→weight only; signs always (CVD-safe) | RESOLVED | render A + ruling + #365 |
| SC-065 | 1 | 2 | Cancel reads as ghost text | Outline-button styling across the modal family | RESOLVED | ruling + #366 |
| SC-066 | 3 | 3 | No first-class way to complete a client-cancelled day; zeros read ambiguous + progress showed 29/30 | "Mark no service" row (B2) + confirm + zero-write via normal save + auto-note + counts complete; 29/30 root-caused in step 0 | RESOLVED | render B2 + ruling + #365 |
| SC-067 | 2 | 4 | ENTERED·PROJECTED lockup reads clunky | C2-modified: stacked pair, "of" separator, labels indent to first digit (past $/~) | RESOLVED | render C2 + ruling + #366 |
| SC-068 | 1 | 5 | Toast lingers too long; can't be forced away | 3.5s recorded duration + outside-click dismiss (click passes through) | RESOLVED | ruling + #366 |
| SC-069 | 3 | 6 | Bulk unreachable when caught up; future-confirmed numbers can't be revised in bulk | Bulk Update unconditional on TodayRail; "Edit today" label when entered; gate widened to entered FUTURE days only | RESOLVED | ruling + interpretation + #365 |
| SC-070 | 2 | 7 | MiLB tiles inconsistent with PDC anatomy | Meals hero + muted revenue + sun/moon top-left of date (render D) | RESOLVED | render D + #366 |
| SC-071 | 2 | 8 | Cleared input computes Number("")=0 → phantom −proj delta | Empty-guard before coercion + touched removal on clear (no prior actual) | RESOLVED | Chat verify (code) + #365 |
| SC-072 | 3 | 9 | Header blends entered + projections mid-entry, reads as recorded actuals | E-a: entered-only hero from first entry + subordinate "~$X day projection"; 0-state unchanged | RESOLVED | render E-a + ruling + #365 |
| SC-073 | 1 | 10 | MLB week cards don't serve operators | WeekSubtotals removed for homestand accounts (supersedes SC-043's fee-week half, owner ruling) | RESOLVED | ruling + #366 |
| SC-074 | 2 | 11 | Collapsed groups + expanders read as ghost elements | F3 elevation family: card shadow, hover lift, pressed state, both surfaces | RESOLVED | render F3 + #366 |

## Owner Review Round 3 (2026-07-09) · renders G1 / H2 / I3 approved

| ID | Sev | Item | Finding | Fix (approved) | Status | Verified by |
|----|-----|------|---------|----------------|--------|-------------|
| SC-075 | 1 | 1 | Extras expander floats groupless | G1 sub-header band inside the group card | RESOLVED | render G1 + #367 |
| SC-076 | 2 | 2 | Match projections not CTA-obvious | H2 outline pill button per group | RESOLVED | render H2 + #367 |
| SC-077 | 2 | 3 | MLB lacks Mark-no-service (rainouts) | SC-066 flow extended to homestand accounts | RESOLVED | ruling + #367 |
| SC-078 | 3 | 4 | Homestand classifier types by schedule, blind to entry - entered non-game days stuck beige (Jun 26 repro) | Entry beats schedule: entered wins on game days (zero incl.) + nonzero non-game days; tiles openable; legend "Entered" | RESOLVED | Kevin repro + ruling + #367 |
| SC-079 | 3 | 5 | Notes lack authorship/history - no accountability trail | Append-only ledger (I3): sc_day_note_entries table + migration + sc-add-note (server-derived author) + independent Add-note flow + Latest-note in review | RESOLVED | render I3 + ruling + #367 |

### Candidates (Round 3)
- Per-meal zero = no-service vs homestand zero-on-game = entered: deliberate asymmetry (owner ruling
  2026-07-09) documented in-code (`dataStore ~:204`) - GOTCHAS.md entry landed in cleanup C3.
- sc_day_metadata.day_notes dormant post-migration - retire the column in a future schema tidy (dead read at dataStore:722 removed in C2; column retirement still future).

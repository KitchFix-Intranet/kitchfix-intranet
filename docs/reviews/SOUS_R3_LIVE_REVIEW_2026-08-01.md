# Sous R3 - live review (hands-on, Claude for Chrome, two passes)

**2026-08-01 · Reviewer: Chat-Claude driving production directly via Claude for Chrome on Claude Desktop.** First live review in the program, run in **two passes** (pre- and post-context-compaction); every P1 was independently reproduced in both, which upgrades this from findings to *reproducible* findings. Channel note, stated plainly: the screenshot channel renders as placeholders on my side, so this is a full-strength functional and behavioral review (real asks, real clicks, DOM, accessibility tree, JS-measured layout) with pixel-pure items explicitly marked needs-eyes.

**Session footprint:** ~11 asks across both passes (EC lookup x2, kevin fietek, FORM-004, holiday pay, vendor count, allergen, FORM-002 panel, closeout panel, form004 retries), two Not-helpful submissions (one detail-only, one "Out of date" + detail - both honest signal: a grading-bug note and a stale-directory-title report), one Helpful. No other writes. Session-clears-on-reload observed live: the rail footer's promise is literally true.

## Verdict
**The trust machinery held under live fire.** Reason chips, human tool trails, local clocks in the UI, real source titles, composer clear, panel-by-construction parity, transparent feedback logging, 38-parity - all verified working in production. Live testing exposed one dead control (panel chips), two honesty leaks in the model's voice, the quantified large-viewport void, and - the biggest find - **two concrete, reproduced mechanisms behind the partial-rate inflation.** Nothing regresses the merge; round 3 is small and sharply targeted.

## Protect - verified live, do not regress
Reason chips end to end (exact mapped strings) · composer clears (read back empty) · human tool labels with `1.2s`/`292ms` formatting · generic `Working...` companion, zero name-echo · the decline composition (honest scope + Mariela referral + real source cards) · **38 parity: chip == answer** · `sources:` string join fixed · panel starter SET + corrected limits line per I5/Fix-8 · panel answer card carries pill + header zone + well (QA-2 parity by construction, confirmed mid-stream) · source cards with real titles + working links · CSV gating correct · markdown fully rendering (no literal `##`/`---`) · U6/U7 verbatim · feedback transparency line + page confirmations ("Thanks - logged." / "Feedback sent.") · **downward fit excellent: zero-scroll at 687 viewport, 4px at 617** - beats the 720 floor with slack.

## P1

**R3-01 · Large-viewport dead zone - quantified** *(Kevin's finding, now numeric)*. At 1495x757: `.sa-shell` bottom = 620 of 757 → **137px void even at design size**. At 2300x1071: **439px void**, layout in the top 59%, composer stranded at y=595, content capped 1520 wide. Zero-scroll holds everywhere (nav fix verified: 1px) - the defect is purely fill. **Fix:** shell flex-fills the page; briefing centers in pane slack; composer pins to pane bottom; optional width step-up past 1720.

**R3-02 · Panel starter chips are dead.** Clicking a panel starter fires nothing - composer stays empty, no ask (reproduced pass 1 on `Show me FORM-002`: click reports success, state unchanged; pass 2's ref-level failure consistent). Typing the identical question into the panel composer works perfectly; page chips work. A parity break on the control Kevin specifically ruled into existence (I5).

**R3-03 · The model narrates content it did not render.** Vendor answer: "The top 25 are listed above" - **no table rendered**. The tool returned rows; the model chose prose, then referenced the phantom table. **Fix (sanctioned prompt rule):** never reference tables/lists not actually included in the answer - render or omit.

**R3-04 · Server clock leaks into prose.** "PG live as of 4:01 PM UTC" - the tools humanize the *server* clock and the model echoes it; one-clock breaks server-side while the chip is correctly local. **Fix pair:** tool `loaded` drops the time entirely; prompt line hardens to "no times in prose - the interface owns the clock."

**R3-05 · TOP CALIBRATION FIND - two reproduced mis-grading mechanisms.**
(a) *Data path:* a correct, successful data-tool answer (vendor count) graded `PARTIAL · Sources could not be confirmed` - the data-grounding signal is not clearing the grader.
(b) *Doc path:* FORM-002 and FORM-004 both graded `PARTIAL · A citation could not be verified` while quoting the doc correctly; both end with the prose habit `Source: FORM-XXX, all sections` - "all sections" is not a verifiable section id, so phantom_citation fires on a stylistic tic.
Together these plausibly explain a large slice of the 23-33% partial/declined distribution. Exact reproductions above become **eval fixtures**. Recommend a dedicated calibration mini-round (grader precedence for data answers + cite-format rule), bundled with the parked re-query eval at Kevin's option - not a rider on the UI PR.

## P2
**R3-06 · Vote-state is silent after the first vote.** Page confirmations render (verified twice), but the cast vote gets no selected style, the opposite button stays live and clicking it does nothing - no message. Double-submit risk on the same control. **Fix:** selected state + disable opposite + "already logged" affordance. *(Panel feedback confirmation: verify - one pass suggested it may not render there.)*
**R3-07 · ⌘K scope gap.** Works from the landing; dead when focus sits inside an answer card (verified: post-feedback-click typing never reached the composer - read back empty). **Fix:** window-level listener.

## P3 / observations / rulings needed
**R3-08 ·** Panel keeps starter chips visible above answers (page clears first-run; panel stacks below persistent chips). Intended quick-re-ask affordance or clutter? **Kevin ruling.**
**R3-09 ·** Panel question possibly renders doubled (`Show me FORM-002Show me FORM-002` in pass-1 extraction; pass-2's closeout ask showed it once). Eyes-on verify before ticketing.
**R3-10 ·** Feedback taxonomy gap: six tags, none fits "the status label is wrong." Detail-only path covers it; consider a seventh tag once calibration lands. **Kevin ruling.**
**R3-11 ·** A11y batch: "New question" accessible name inconsistent across extractions (screen-reader verify) · seven unnamed shelf-toggle buttons on `/playbook` · vote-state semantics (with R3-06).
**R3-12 ·** Spec edge for v1.1: the panel's closeout answer ended "Which one do you need?" - a *genuine disambiguation* that reads well but brushes the no-follow-up-invites rule. Reconcile in the character spec (legitimate clarifiers allowed, engagement bait banned). Joins the A-list.
**R3-13 ·** Data quality, not product: the leadership directory titles Kevin "Director of Operations" (he is Senior Director). Reported through the product's own feedback flow during this review.

## Needs Kevin's eyes (channel-limited)
Wake + idle flourishes on the lockup (timing, kinds) · mark rendering everywhere (nav active, companion turn, tiles) · depth aesthetics (wells reading as *within*) · docked-header pixel composition · the ERROR card (cannot cut network from here) · reduced-motion · R3-09 confirm.

## Recommended round-3 split
**PR `fix/sous-r3` (mechanical, no migration):** R3-02 panel chip wiring · R3-01 CSS fill/center/pin · R3-04 tool-side clock drop · R3-06 vote states · R3-07 window-level ⌘K · R3-11 aria-labels · R3-09 dedupe if confirmed.
**Sanctioned prompt lines (Kevin approves text):** R3-03 no-phantom-references · R3-04 no-times-in-prose. Ride the same PR.
**Calibration mini-round (own session):** R3-05 grader precedence + cite-format rule + the two fixtures, optionally bundled with the parked eval.
**Rulings:** R3-08, R3-10. **Spec v1.1:** R3-12 joins A1-A9.

# Sous V1 - Design Review (Chat pass)

**Date:** 2026-08-01 · **Reviewer:** Chat-Claude · **Basis:** 10 production screenshots, `DESIGN_REVIEW_PERSONA.md` severity framework, `DESIGN_SYSTEM_REFERENCE.md`, `DESIGN_PRINCIPLES.md`
**Scope:** /sous page variant, first-run, four answer states, session rail, composer. Panel variant not screenshotted - carried as open question.
**Read-only artifact. Every Fix is a ticket. IDs `DR-xx` are shared vocabulary for the CC code pass and Kevin's list.**

---

## Verdict

**Refine (P1-P2), with two P0s.** The bones are genuinely good - the answer contract reads on screen the way the spec reads on paper, the status system is legible at a glance, and the declined state is the best-behaved decline I have seen in an internal tool. But the surface currently tells the user two different times, disagrees with itself about how many vendors exist, leaks raw markdown into its most impressive answer type, and keeps the fired question loaded in the composer. Those are trust wounds on a product whose entire identity is trust.

---

## What's working - keep and protect

- **The grounded answer (img 10) is the product thesis in one card.** Green rail, pill, answer, source with a date, tool count, timing. Nothing extra. Protect this composition from future additions.
- **The declined state (img 8)** explains itself, names the source, and stays dignified. Navy rail reads correctly against partial's amber. This is D14 and the KEVIN_UI_TEST discipline paying off.
- **Question-line treatment** - verbatim lowercase question, teal rule, muted weight. Research notebook, not chat. Correct.
- **The honesty block** ("What it won't do yet") - an interface that names its own gaps. Rare and on-brand.
- **Provenance meta row** (`1 tool · 5.8s · sources:`) - quiet, mono, exactly right.
- **Session rail concept** - in-context markers, local timestamps, session-only footnote. Right idea, minor issues below.

---

## P0 - fix before the surface earns more traffic

**DR-01 · Composer does not clear on submit.** Imgs 7 and 8: the answered question is still sitting in the composer under its own answer. One accidental Enter re-fires the query; the screen also shows the same string in three places (rail, question line, composer). *Nielsen: error prevention; user control.* **Fix:** clear on successful submit; preserve on transport error with focus returned. Effort: small, but it is state logic - CC verifies the submit path.

**DR-02 · The surface shows two clocks.** Freshness chip says `PG live · 11:38 AM` while the rail stamps the same moment `6:42 AM` (imgs 1, 5-8). The chip is rendering the UTC server timestamp as if it were wall time - `GOTCHAS.md` has a whole section on this class. A freshness indicator that is five hours wrong is worse than no indicator. *Nielsen: match between system and real world.* **Fix:** render viewer-local time everywhere; if the zone matters, label it. Same bug family: raw `2026-08-01T11:43:35Z` leaking into answer prose (img 7). Effort: small.

---

## P1 - this sprint, rides the PR A update pass

**DR-03 · Markdown renderer gap mangles document answers.** Img 5/6: `## FORM-004 - Written Warning (v1.0)`, `###` section heads, and `---` rules render as literal characters while tables and bold render properly. The single most impressive answer type - a full form - looks broken. *Aesthetic-usability; consistency.* **Fix:** extend the answer renderer to style h2/h3 to the sa- type scale and `---` to a styled rule - or strip both in the answer pipeline. CC confirms which layer owns it.

**DR-04 · Sous disagrees with itself on vendor count.** First-run chip: `41 vendors` (img 1). Answer twenty minutes later: `across 42 vendors` (img 7). Either the counts come from different queries or one is stale. On this product, self-contradiction is a P1 even when both numbers are defensible. *Consistency; trust.* **Fix:** CC traces both counts to their queries; align definition (distinct vendors with YTD spend) and source.

**DR-05 · Partial never says what is missing.** Two of the three substantive answers screenshotted are PARTIAL (imgs 5, 7) and neither states the gap. An amber badge with no reason reads as vague self-doubt and trains users to ignore it. *Visibility of system status.* **Fix:** a one-line reason adjacent to the pill (`Held: <reason>`), populated from the grading path. CC reports whether the API already returns a reason field the UI drops. If PARTIAL fires this often on clean answers, that is a grading-calibration finding for the bundle, not a UI fix.

**DR-06 · Send button has lost its accent.** Composer send and the scroll-top FAB are both pale wash-blue with a white glyph (imgs 1, 4, 7, 8) - the spec table says white on `--accent-sous` at 4.6:1. As rendered it is a low-contrast UI control and it does not change when the composer has text, so it is not a disabled treatment. *WCAG 1.4.11 non-text contrast; affordance.* **Fix:** send = Flame with white glyph, plus a real disabled state when empty; differentiate the FAB. CC verifies token usage - this smells like a hardcode.

**DR-07 · Example prompts have zero click affordance.** The eight domain-card questions are the primary first-run action and they render as inert body text (imgs 1, 4). *Affordance; discoverability.* **Fix:** chip or quiet-button treatment, hover tint, cursor, focus ring. If they are not currently wired to submit, that is a P0 reclass - CC confirms the handler exists.

**DR-08 · Em-dash in product copy.** Rail footer: `Session only — clears when you reload.` (img 3). Hyphens-only is a repo-wide hard rule and this is user-facing. **Fix:** hyphen. CC greps all UI strings for `—` and `–`.

---

## P2 - polish batch

**DR-09 · First-run grid is 3+1.** The Spend card orphans onto row two (imgs 1, 4). Four domains want 2x2 at this width, 4-across ultrawide, 1-col mobile. *Prägnanz; balance.*
**DR-10 · Four identical stars.** Every domain card leads with the same Sous star - the mark as wallpaper says nothing. **Recommendation:** each card carries its module's own icon (book, people, calendar, receipt) in the module accent; headings drop to ink/navy; the accent lives in icon + count chip only. Calms the four-color heading shout and makes the colors purposeful. (Pairs with the approved-mark rollout, which retires these stars anyway.)
**DR-11 · Answer prose measure runs wide.** Explanatory paragraphs span the full pane, well past ~80ch (img 7). Cap `sa-answer-body` prose at ~72ch; tables may exceed.
**DR-12 · Numeric table columns left-aligned.** SPEND YTD and SHARE should right-align with `tabular-nums`, headers included (img 7). Money columns scan by magnitude.
**DR-13 · Provenance grammar is three dialects.** `loaded 2026-05-27` vs `(live, 2026-08-01)` vs `PG live as of <raw ISO>. Includes historical batch_rebuild rows.` Define one grammar: human date in prose, machine detail in the meta row only. Partly prompt-side - flagged for the voice pass.
**DR-14 · Answer-body follow-up invite.** "If you want to dig into a specific vendor... just say the word" (img 7) is engagement-bait against the terse-expert voice. Prompt-side amendment; log for the PR B system-prompt round.
**DR-15 · Count chips wrap.** `12 accounts` breaks to two lines (imgs 1, 4). `white-space: nowrap` and let the card flex.
**DR-16 · Thinking card dead air.** Large empty region between THINKING pill and the `Thinking...` line (img 9); pill and line also say the same word. Compact the waiting layout; the line becomes the staged tool trajectory as tools fire; the approved mark's working state lands here.
**DR-17 · Rail label stack.** `THIS SESSION` over an underlined `IN CONTEXT` reads as two competing headers, and the underline fakes a link (imgs 6-8). One label; the in-context state belongs to items, shown by the existing bracket.
**DR-18 · Hero clip on scroll.** The hero's title shears under the sticky nav mid-scroll (imgs 5, 7, 8) - a transient but scrappy frame. Either let the hero scroll away clean (reduce sticky overlap) or fade it; do not make it sticky.
**DR-19 · CSV button on form answers.** A written-warning form exports to CSV (img 5) because a table exists. Gate CSV to data-table answers.

## P3 - log and move on

**DR-20 ·** `STL - FL` spaced-hyphen account codes in model prose; canonical is `STL-FL`. Prompt nit.
**DR-21 ·** Scroll-top FAB and send share a silhouette; once DR-06 lands, restyle the FAB neutral.
**DR-22 ·** Greeting names four domains in prose; if domains grow this sentence ages badly - consider "ask me about anything the intranet knows."

---

## Layout challenges - beyond adjustments

1. **First-run as a briefing, not a menu.** Current: four category cards + warning block. Challenge: one composed briefing - a single card with a 2x2 domain matrix (icon, count, two prompts each) and the limits block as its footer. One object to read instead of five. Medium effort; sketch on request.
2. **Answer meta consolidation.** Source line in prose + provenance row + status pill spreads trust signals across three homes. Challenge: pill + reason (DR-05) top; ALL machine facts (tools, timing, sources, data-as-of) in one bottom meta row; prose never carries a `Source:` line. Needs the prompt and renderer to agree - bundle candidate.
3. **Rail earns its width or narrows.** 264px carrying five short strings and 90% air (img 3). Options: (a) narrow to ~220 and let answers breathe, (b) give it a job - per-item status dot (grounded/partial/declined) so the session reads as a record at a glance. I lean (b); it deepens the research-notebook identity.

## Cross-module callouts

- **People vs Directory.** Hero says "the directory," the card says People, the nav carries both People AND Directory as separate modules, and the data source cites "Leadership directory" (imgs 1, 10). Sous inherits an intranet-level naming collision - needs a Kevin ruling, then consistent copy.
- **UTC rendering (DR-02)** is a known repo-wide gotcha class - the fix should touch the shared formatter, not a Sous-local patch.
- **TopNav mark swap** is already specced (SOUS_MARK_SPEC.md §8) and rides the same PR as this review's fixes.

## Open questions for Kevin

1. Black pill bottom-right of img 5 reading `Calcu...` - product toast or OS/extension artifact?
2. Are example prompts currently wired to submit on click (DR-07 severity hinges on this)?
3. PARTIAL on `Show me FORM-004` - do you know what the grader held back? Frequency of PARTIAL in the question log would size DR-05's calibration half.
4. Panel variant ("Ask Sous about this doc") - no screenshot; review it in this pass or after merge?
5. People vs Directory - which word wins?

---

*Companion: `CC_PROMPT_sous_design_code_review.md` - the code-side pass keyed to these DR IDs. Bundle order: this artifact + CC's report + Kevin's list → one PR A update prompt.*

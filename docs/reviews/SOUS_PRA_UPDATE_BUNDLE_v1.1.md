# Sous PR A Update Bundle - v1.1 (panel workstream added; CC report pending)

**2026-08-01.** Supersedes v1.0 - adds Workstream I (panel parity and polish) from Kevin's five panel screenshots. Every design decision for the PR A update pass is now ratified. The only open input is CC's read-only code review; its findings merge into workstreams E, G, H and the prompt issues immediately after.

---

## Ratified decisions - 2026-08-01, Kevin

| # | Decision | Ruling |
|---|---|---|
| U1 | Landing direction | **V2 simplified briefing** - one composed card: four domain rows (module icon, ink title, accent count chip, right-aligned example chip), limits line as the card's footer. Domain cards retired. |
| U2 | Q and A treatment | **A - question above the elevated card.** D9 notebook rhythm stands; answer card gains elev-2 + hairline + status rail. Flat-on-flat retired. |
| U3 | Composer | As mocked: 52px, vertically centered text, elev-2 at rest, Flame focus ring, Flame send with real disabled state. Scroll FAB restyles neutral. |
| U4 | Height floor | Design target stays 1280x800. **Fit floor 720:** landing renders fully, zero vertical scroll, at any viewport 720 and taller; graceful scroll below, nothing breaks. Hero compresses 84 to 72 under 800. Sweep battery gains height axis 800 / 768 / 720. `DESIGN_SYSTEM_REFERENCE.md` browser matrix gains the height-floor paragraph (cross-module doc touch, flagged). |
| U5 | Viewport gates | SC matrix adopted verbatim for Sous: 1280x800 target, nothing breaks to 1024 wide, 375 mobile floor, Chrome only, laptop matrix 1024/1152/1280/1366/1536. Landing fits, answers scroll. |
| U6 | Limits copy | Candidate 2: "No wages, no reimbursements, no P&L yet - all coming. Current season only: ask about 2024 and the number will look right and be wrong." |
| U7 | Naming | Sous copy says "people" throughout; greeting future-proofed to "ask me about anything the intranet knows." Intranet People-vs-Directory IA untouched. |
| U8 | First-run icons | Module icons in module accents; headings ink; four stars retired. |
| U9 | Partial reason | Human-readable line beside the pill; fallback "Some sections could not be verified." Calibration ruling waits on CC's distribution. |
| U10 | Elevation | Three tokens as mocked (elev-1 rest, elev-2 composer/answer cards, elev-3 overlays), calibrated under the existing hero shadow. |
| U11 | Mark + nav | Per `SOUS_MARK_SPEC.md` in full: 1C display / 1A small, wake on load, transition handoff, nav swap with Flame active rule, favicon. |
| U12 | Calcu pill | Desktop artifact - closed, no action. |

## Workstream scope - final

- **A. Fit and scale** - U4 + U5, hero compression, landing height budget per the V2 ledger (490 at the floor, 111 slack at 601, clears the 683 Surface case), battery in acceptance.
- **B. Identity and motion** - U11; thinking card gets the mark's turn + staged tool line; wake inside the load sequence.
- **C. Elevation** - U2, U3, U10; applies to answer cards, briefing card, rail, composer, FAB.
- **D. Landing** - U1, U6, U7, U8; second example chip per row may return at 1440 and up if it fits without wrap.
- **E. Renderer and data honesty** - markdown h2/h3/hr, one clock (viewer-local, shared formatter), vendor count single definition, partial reason line, CSV gating. *Awaits CC Parts 2-5 for layer ownership and SQL diff.*
- **F. Copy and voice** - dash purge (CC Part 8 inventory), provenance grammar, follow-up invite cut, U6/U7 strings. Prompt-side items logged separately for the system-prompt round.
- **G. Interaction** - composer clear-on-submit + double-submit guard, example chip wiring + affordance. *Awaits CC Parts 1 and 7.*
- **H. Sweep and accessibility** - *entirely CC Part 11.*

### I - Panel parity and polish (new, from panel screenshots)

**Cross-variant confirmations - the panel shots prove three shared findings live in both surfaces, which hardens their priority:** DR-01 (composer retains the fired question - visible in four of five shots), DR-03 (literal `---` in both FORM answers), DR-12 (SPEND and SHARE columns left-aligned in the panel table). DR-06, DR-13, U3, U10, and the mark band swap all apply to the panel by inheritance - the prompt states parity explicitly so nothing ships page-only.

**Panel-specific items - locked by lean:**

- **I1 - The empty void.** Panel first-run is a blank white sheet from band to composer. Fix: compact top-aligned first-run in two modes. With docContext: the ASKING ABOUT card plus three starter chips ("Summarize this doc", "What changed in the latest version?", "Who does this apply to?"). Without: one capability line ("Sous reads the Playbook, people, the service calendar, and spend - every answer names its source.") plus the four domain starter chips from V2, plus the U6 limits line in its compact form. Total content well under 300px, composer parity per U3.
- **I2 - Source-card title duplication.** `POL-008  POL-008` - the id chip and the title render the same string, the documented PR A divergence now visibly ugly. Fix: wire real document titles into source cards (both variants); when a title is unavailable or equals the id, render the chip alone.
- **I3 - Trajectory polish.** The during-flight staged tool lines (`search_documents ... 2093ms`) are excellent and stay; formatting fix: durations at 1000ms and above render as seconds (`2.1s`), sharing the meta-row formatter. The mark's working state joins the trajectory per `SOUS_MARK_SPEC.md`; lines collapse into the meta row on settle exactly as today.
- **I4 - Panel elevation.** The overlay takes elev-3; the answer card inside takes the page's A treatment (elev-1, hairline, status rail) so the two surfaces read as one product.

**Protect:** the declined-with-sources composition (holiday pay shot) - decline, referral to the owning human, and the documents it checked. That is the data-access policy rendered perfectly; the prompt marks it do-not-touch.

## Doc touches the prompt will order

1. `SOUS_REDESIGN_MASTER.md`: U1-U12 as design-decision entries; V2 supersedes the domain-card first-run section; mark spec section lands per `SOUS_MARK_SPEC.md`; delivery log entry.
2. `DESIGN_SYSTEM_REFERENCE.md`: height-floor paragraph (the one cross-module doc touch besides TopNav).
3. Plan version: unchanged this PR; bumps at PR B.

## Prompt plan (writes on CC arrival)

Parts = workstreams A-G plus I; H folds into acceptance. Parity clause: every shared fix names both variants. Acceptance battery: laptop matrix x height axis, reduced-motion, animationiteration handoff proof, nav screenshot, dash grep zero, both clocks local, vendor counts equal, keyboard loop, plus every CC CODE-xx flipped to a fix or explicitly deferred with reason. Reference artifacts shipped alongside: `sous-pra-update-mocks.html` (composition) + `sous-mark-final.html` (motion) - prompt wins on disagreement.

## Status

Done: review triad two-thirds complete, all rulings ratified, mocks approved. In flight: CC read-only report. Next: report lands, CODE-xx merges, prompt issues same session with Parts A-G + I. Parked: rail status-dots (PR B evaluation), hero scroll clip (include only if trivial), prompt-side voice items.

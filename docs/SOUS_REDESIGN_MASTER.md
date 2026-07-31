# Sous - Redesign Scope & Implementation Master

**Version:** 1.3
**Date:** 2026-07-31
**Owner:** Kevin Fietek
**Audience for the release:** SLT and Regional Directors
**Status:** open questions ruled 2026-07-31. PR 1 issued.
**Location:** `docs/SOUS_REDESIGN_MASTER.md` - **this document is the running tracker for the redesign and is updated by every PR in the programme.**

---

## 0. Programme status

**Rebundled 2026-07-31 from five PRs to two.** Phase 0 found that **`SousSurface` already serves both surfaces** - `variant="page"` from `/sous/page.js:93`, `variant="overlay"` from `PlaybookClient.js:650`. **There is no clean page-only change.** Gating every edit behind a variant check and unwinding it later is more work and leaves a half-styled panel in production in between.

Feedback also folded in: `feedback`, `feedback_comment`, and `feedback_at` **already exist** in `sousai_questions`. The mechanism is built and thumbs already persist. Only `feedback_tags text[]` is new - one additive ALTER riding an already-large PR rather than a PR of its own.

| PR | Scope | State | Merged |
|---|---|---|---|
| **A** | The surface, both variants: accent, hero, shell, rail, load sequence, first-run, answer components, panel refit, feedback tags | **Issued** | - |
| **B** | Conversational memory, alone | Queued | - |

**PR B stays solo whatever its size.** Architectural, needs the full spike re-cert, and carries the money risk. If something breaks there should be one suspect.

### Phase 0 findings (2026-07-31)

| Q | Answer | Effect |
|---|---|---|
| Bootstrap API for the hero | **Not needed.** `getHeroImages()` at `directory.js:552` already reads the shared `team_key NULL` pool; `page.js` is already a server component doing async work. | PR A does not grow |
| `sousai_questions` feedback columns | `feedback`, `feedback_comment`, `feedback_at` **exist**. Only `feedback_tags text[]` is new. | One additive ALTER, folded into PR A |
| Component structure | `SousSurface.js`, 406 lines, plain `useState`, `parseSse` streaming, **`variant` prop already serving both surfaces** | **Caused the rebundle** |
| `sa-` class usage | Confined to `/sous` and the panel | Amber underline safe to remove |
| Lucide | `lucide-react@1.14.0` installed and in use; all 8 icons stock exports | No icon work needed |

### Delivery log

Every PR appends an entry here before merge: what shipped, what changed against this spec and why, what was found that the spec did not anticipate, and any decision that moved. **A PR that changes the spec updates section 2 in the same commit** - the decision table is the record, not the conversation that produced it.

**PR A · 2026-07-31 · draft, pending Kevin's Studio-apply of `sousai-2-feedback-tags.sql`**

Shipped:
- `--accent-sous` family (`#0891B2` / `-deep #0E7490` / `-subtle #ECFEFF` / `-line #A5F3FC`) minted in `src/app/tokens.css`. Amber underline removed from `sa-header` (the class is replaced entirely by the photographic hero).
- Photographic hero on `/sous` matching `oh-hero` values: 96px desktop / 84px mobile, `linear-gradient(90deg, rgba(15,48,87,.95), .78 38%, .32 72%, .18)`, `getHeroImages({ module: "sous" })` server-fetch in `page.js`, star mark 34px translucent white, `Sous` 24px/800/-0.025em headline, greeting *"Hello {firstName} - ask me for anything..."* with graceful "Hello" degrade.
- Freshness chip in the hero right slot mirroring `sc-chrome-bar-asof`: pulsing green dot, mono tabular, `PG live · HH:MM`.
- Two-column shell (264px rail + fluid pane) that collapses cleanly under 1024px. Session rail with new-question button in Flame, `⌘K` affordance, this-session list newest-first with timestamp + truncated question, empty state, and the permanent *"Session only - clears when you reload."* footer.
- **In-context marker** on top-3 rail entries with a hairline rule under the third and dimming below - **presentation only in PR A; the marker becomes truthful in PR B when memory is real.** The hover tooltip states so explicitly.
- Load sequence (`sa-animate` class + keyframes in `sous.css`): star settle → hero light sweep → title rise → greeting rise → freshness chip rise → domain cards staggered 80ms → limits → composer. Every animation suppressed (not reduced) under `@media (prefers-reduced-motion: reduce)`.
- First-run state: *"What can I look up for you?"*, one-line tag, four domain cards (Playbook / People / Service Calendar / Spend) each tinted with that module's own accent token and carrying two hardcoded example questions (D15). Counts fetched server-side from `documents` (Live count), `contacts` (from `getContacts`), `accounts`, `vendors`. Limits block verbatim.
- Turn treatment (D9): question becomes a compact 15px muted line with a Flame left rule; answer becomes a card with the status rail across the top. Not chat bubbles.
- Status pills matching `pb-status-pill`: 10px / 800 / 6px radius / transparent / 1.5px border in status colour.
- Provenance stamp: mono, tabular, `N tools · Xs · sources: ...` after done; live streaming line during flight.
- Source cards: id chip + title + `<ExternalLink>` icon, linked to `/playbook/d/{docId}`. Subtitles hidden in overlay.
- Tables: real borders, tabular figures, `th` uppercase/700, zebra rows.
- Action row (BOTH variants): Copy, CSV (only when a pipe table is present in the answer), Helpful, Not helpful. Lucide icons throughout - no text glyphs.
- Staged thinking: named tool steps with tool name + summary + ms, replacing the single 19-second line.
- **Panel refit (overlay variant):** `.pb-sous-panel` widened from 480px to **580px** matching `.pb-slide`. Scrim dimmed to `rgba(9,43,85,.22)` - context, not modal. Flame gradient band header carrying identity + document context as one object: star + "Ask Sous" + `Open in Sous ↗` + close, then `ASKING ABOUT` and a document card with id chip / title / `v{version} · {status}` / dismiss.
- **Non-Live honest state (D14):** when the doc card's `status !== "Live"`, the panel opens with a manila `pb-sous-notlive` block reading *"{DOC-ID} is {status}. It isn't in the corpus yet, so I can't answer from it."* SlideOverReader's `onOpenSous` now passes the full doc metadata object (id / title / version / status / docClass) so the panel can render this honestly.
- Feedback tag flow: `▼ Not helpful` opens an inline panel with six multi-select tags (`Wrong number`, `Missing information`, `Wrong document`, `Out of date`, `Hard to follow`, `Should have declined`), optional free-text into the existing `feedback_comment`, `Send feedback` / `Skip`, visible note *"Logged with the question + tools + sources."*
- Gate + store extended: `/api/sousai/gate.js` accepts optional `tags` array (only stored on value=-1, max 12 tags, 48-char cap each). `updateSousaiFeedback` writes to the new `feedback_tags` column when present.
- `docs/migrations/sousai-2-feedback-tags.sql` - single additive `ALTER TABLE sousai_questions ADD COLUMN IF NOT EXISTS feedback_tags text[]`. `scripts/_verify-sousai-2-feedback-tags.mjs` round-trips insert+select+delete against production once Kevin runs the Studio apply. **PR opens as DRAFT pending the migration-gate ceremony.**

Diverged from spec:
- `.sa-source-title` currently uses the doc id as the label (no separate title fetch). Spec expects "id chip + title + section." Full title + section resolution would require a `documents` batch fetch per answer render, which pushes past this PR's presentation-only scope. **Deferred to a follow-up polish PR** - the id-chip is still clickable to the doc, which is the primary contract.
- Panel first-open state (section-coverage chips + section-tagged starters + "More in this document" suggestions after each answer) deferred. This requires a per-doc section-header enumeration surface that doesn't exist yet. **The non-Live honest state (D14) DID land.** Section-tagged suggestions can ride the next Playbook-side PR once section-header enumeration is scoped.
- Rail's "Selected" state implemented by matching the rail item's question to `askedQuestion` rather than tracking a separate `selectedTurnId`. Same visual outcome; simpler state model. Noted for PR B when memory turns the rail into a real thread controller.

**Addendum 2026-07-31 - visual reference `sous-prA-reference.html` applied to composition:**

- **Rail is a card.** Previously rendered as a bare column with a right border; now `background: white; border: 1px solid #E5E7EB; border-radius: 12px; overflow: hidden` with internal `.sa-rail-head` (new-question button) + `.sa-rail-scroll` (list) + `.sa-rail-footer` (session-only note). Matches reference `.rail`.
- **Pane is a card.** `.sa-main` now `background: white; border: 1px solid #E5E7EB; border-radius: 12px` and its scroll region moved into `.sa-pane-scroll`. Composer stays flush at the card bottom via `border-top` rather than a page-sticky positioning. Matches reference `.pane`.
- **New shell wrapper `.sa-workspace`** grid-columns (264px + fluid) sits inside `.sa-shell` (which now provides the max-width bound + hero spacing). Hero is a sibling of `.sa-workspace` rather than a child of `.sa-main` - matches the reference layout where the hero band sits above the rail+pane grid.
- **Table borders lightened.** Was full grid (`border: 1px solid`); now only column bottoms, `th` uppercase mono-labeled, tfoot on a stronger top-border rule. Matches reference `.tbl`.
- **Source cards restructured to full-row layout** - id chip + title + go-arrow across the full width instead of horizontal inline pills. Matches reference `.src` shape (`hover: translateY(-1px) + shadow-sm + Flame border`).
- **Composer wrapped in a focus-within bordered box.** Was a horizontal input+button; now `.sa-ask-form` is a `1.5px` bordered card that turns Flame on `:focus-within`, and the send button is a 36x36 icon-only square (matches reference `.comp` + `.send`). Textarea/input placeholder updated to "Ask about a policy, a person, an account, a number..." matching the reference tone.
- **Rail heading, footer, and empty state** use the mono-caps convention (`JetBrains Mono` 9.5px, 0.13em letter-spacing) matching reference `.rail-lbl` + `.rail-ft`. Empty state gets the two-line "**Nothing yet** / Questions you ask..." shape.

Judgment call - where reference and prompt differ, prompt wins:

- The reference shows `.q` as a 20px/800 headline styled like an h1. The prompt explicitly says "compact marked line, 15px, muted, left rule, NOT an h1." **Prompt wins.** The question stays at 15px/500 with a Flame left rule. The reference's visual weight is closer to the D9 "not chat bubbles" direction; the 15px/muted stays truer to the "research notebook" framing.
- Reference has a Slack button in the action row. **Prompt wins (D12: Slack deferred).** No Slack.
- Reference has section-tagged suggestions ("More in this document") in the panel. **Deferred with PR A per the earlier deferral above** - needs the section-header enumeration surface. Not added by the addendum.
- Reference includes a scope-chip strip above the pane (`5 PDC accounts · Window 2026-05 · + Add`). **Prompt is silent on this.** Per Chat's directive to use judgment and note it: not added here. Scope chips were cut under D5, and reintroducing them under an unspecified surface would re-open that decision. Recorded rather than sneakily reversed.
- Reference uses `#EDEFF2` as the page surface (warmer than my default canvas). **Adopted** - it visibly separates the card frames from the page.

Reference's own known divergences (text glyphs, hardcoded counts, `?v=` switcher) were not ported per Chat's directive - the build already uses Lucide, live counts, and no view switcher.

**Pre-merge corrections 2026-07-31 (three defects caught before merge):**

- **52 em-dashes purged from this file.** Hyphens-only is a hard rule and this doc carried the largest violation count in the branch. Read each occurrence: 48 became spaced hyphens, 3 became placeholders / colon / period where a spaced hyphen crashed into a table cell delimiter or bold clause. Scoped to this one file per fence; the repo has pre-existing em-dashes elsewhere that stay.
- **`↗` text glyph in the panel band header** at `PlaybookClient.js:665` (the "Open in Sous" link) replaced with Lucide `ExternalLink` at 13px, `strokeWidth={2.2}`, `aria-hidden`. Import added. The PR body's original completeness map claimed `ExternalLink` was in use; the diff did not include the import - claim now matches the diff.
- **`?doc=` query param dropped** from `openInSousHref` at `PlaybookClient.js:649`. `[code-read]` confirmed no consumer in `page.js` or `SousSurface.js` (neither reads `searchParams`, `useSearchParams`, or a `doc` param). The link previously encoded a parameter that would silently land the user on a blank first-run Sous page with no indication the document context was dropped. Link now goes to `/sous` unconditionally. Wiring the deep link properly needs a page-variant band header that does not exist and D9 did not scope; recorded as deferred follow-up in section 8.

**Carried as debt (not fixed here):**
- The inline `<svg>` star mark and the `×` close glyph in the panel band header at `PlaybookClient.js:658-660` and `:672` are pre-existing text/glyph patterns this PR moved but did not author. Left in place; converting them to Lucide is a follow-up polish PR.

Phase 0 + build surfaced that the spec did not anticipate:
- `getContacts()` returns a length-checkable array (not a count), so the People domain-card count is `contacts.length`. Slower than `count: exact`, but the data-store abstraction doesn't expose an exact-count variant. Fine at 30 rows; worth noting if the directory ever grows large.
- Load-sequence animations depend on the `sa-animate` class being on `.sa-page` (server component) rather than an internal client element. Nothing broke, but the delegation is worth calling out.
- The client-held session rail currently doesn't persist selection across page reload (per D8 - session-only is the point). Rail's clicked-item semantics are "prefill the composer with this question" rather than "reload the answer" - PR B may promote this into a real thread controller once memory is held.

### How this document is maintained

- **Rides every PR in the programme**, same as `SOUSAI_AGENT_PLAN.md`.
- **Decisions only move on evidence or a Kevin ruling.** Never because a build turned out harder than expected - that gets logged as a finding, and the ruling is separate.
- **Findings that contradict the spec are recorded even when the PR ships anyway.** A spec quietly diverging from the build is how the audits this project spent a week correcting came to exist.

---

## 1. Why this exists

Sous answers well and looks unfinished. **The gap between how careful it is and how careless it looks costs it trust it has already earned.**

Held against the live intranet, the current surface breaks the system in four ways: no photographic hero where six other modules have one, no accent identity of its own, none of the card or status patterns people already recognise, and a conversational contract it cannot honour - it asks a clarifying question it is unable to hear the answer to.

**This release fixes the surface, gives Sous an identity, and closes the conversational gap.** It does not add capability.

### The audience shapes the scope

**SLT and Regionals are desk users.** Operators are not in this release. That is why the phone layout is deferred rather than descoped, and why density beats reach.

---

## 2. Decisions locked

| # | Decision | Ruling |
|---|---|---|
| D1 | **Accent colour** | **Flame `#0891B2`.** Mint `--accent-sous`. |
| D2 | Amber underline on the Sous header | **Remove.** Amber is Ops Hub's colour; Sous is currently wearing it. |
| D3 | Hero | **Add**, matching `oh-hero` exactly. |
| D4 | Panel width | **580px**, matching `.pb-slide`, the document reader people already know. |
| D5 | Scope chips on the page | **Cut.** A picker competing with a text field, paying nothing back without inheritance. |
| D6 | Document context in the panel | **Keep.** Automatic context is free precision; manual context is a worse text field. |
| D7 | Conversational memory | **In scope.** Last 3 turns, client-held. |
| D8 | Threading, nesting, persisted history | **Deferred.** Ship the shell; let behaviour say whether they are wanted. |
| D9 | Turn treatment | **Compact question line + answer card.** Not chat bubbles. |
| D10 | Not-helpful feedback | **Capture tags and text**, logged with the trajectory. |
| D11 | Phone layout | **Deferred.** No operators in this release. |
| D12 | Slack action | **Deferred.** Only item needing new integration work. |
| D13 | CSV | **On every table, no threshold.** |
| D14 | Panel on non-Live documents | **Entry always shown.** Panel states the document is not in the corpus and offers related Live documents. |
| D15 | First-run examples | **Hard-coded for V1.** The log can drive them later. |
| D16 | Session rail | **Keep, and make it show the memory window.** |

### D1 - the colour, and why

Every module owns an accent: People purple, Ops amber, Service and Playbook green, Directory crimson. **Sous owned none and borrowed navy plus Ops Hub's amber.**

**Flame `#0891B2` is the blue of a gas burner** - kitchen-native, so it carries meaning rather than being a pleasant teal. It is the only cool accent in a warm-heavy palette, which makes Sous legible at a glance in the nav, and it is clearly separate from both greens.

```css
--accent-sous:        #0891B2;   /* fills, active states, links */
--accent-sous-deep:   #0E7490;   /* hover, gradient end */
--accent-sous-subtle: #ECFEFF;   /* tints, selected rail rows */
--accent-sous-line:   #A5F3FC;   /* borders on tinted surfaces */
```

**Contrast:** `#0891B2` on white is 3.6:1 - **acceptable for large text, UI components, and borders; not for body copy.** Body text on tinted surfaces uses `--text-default`. White on `#0891B2` is 4.6:1 and passes AA for the button and band cases where it is used.

### D9 - why not chat bubbles

Answers carry tables, KPI strips, and source cards. **A bubble makes a report look like a message and burns horizontal space a five-column table needs.** But once memory lands there will be several turns on screen, and the question cannot remain an `h1` - multiple page titles in one scroll is wrong.

**Question:** compact, marked, 15px, muted, left-aligned with a rule.
**Answer:** a card with the status rail on top, full width, dense.

That reads as a thread of results. A research notebook, not a chat.

### D13 - CSV everywhere

A row threshold is a rule someone has to maintain and explain, and *"why does this table have CSV and that one doesn't"* becomes a support question. **A three-row table someone wants in a deck is as valid as a fifty-row one.** One button beats a rule.

### D14 - the panel tells the truth rather than hiding

`get_document` returns `not_live` for anything outside the corpus, so on an In Build document **Sous genuinely has nothing.**

Hiding the entry creates a second mystery - *why does this document have Ask Sous and that one doesn't*. A disabled button invites a click and then explains itself. **So the entry is always present, and the panel opens with an honest state:**

> **SOP-014 is In Build.** It isn't in the corpus yet, so I can't answer from it. I can answer about the Live documents it relates to.

Followed by those related Live documents as starters. **Same principle as the rest of the design - name the limit rather than let it be discovered**, and stay useful while doing it.

### D16 - the rail earns its width once memory lands

This was argued twice and both arguments were weak. Cutting it rested on an untested assumption about revisiting; keeping it rested on atmosphere.

**Memory makes it load-bearing.** With three turns held, consecutive questions are genuinely related, so the rail stops being *history you might revisit* and becomes **where the current thread lives**.

That gives it a job nothing else can do: **show what Sous currently remembers.**

- The **top three entries** carry a Flame edge marker and a label - `In context`
- Entries below it are dimmed slightly
- A hairline rule sits under the third entry
- Hovering the marker explains: *"Sous can refer back to these three."*

**An invisible mechanic becomes visible.** Someone who scrolls past the third entry can see why Sous no longer has that context, instead of being surprised by it.

---

## 3. Surfaces

### 3.1 `/sous` - the page

**Shell:** two columns. Rail 264px, answer pane fluid. **Rail collapses below 1024px** - a graceful narrow-desktop case, not a phone layout.

**Hero** - matches `oh-hero` verbatim:
- `min-height: 96px` desktop, 84px below 768px
- Overlay `linear-gradient(90deg, rgba(15,48,87,.95) 0%, rgba(15,48,87,.78) 38%, rgba(15,48,87,.32) 72%, rgba(15,48,87,.18) 100%)`
- Photograph from the shared `hero_images` pool, `team_key NULL`
- Star mark, 34px, translucent white on the photograph
- Headline "Sous" - 24px / 800 / `-0.025em`
- Greeting - 13px / white 88%: **"Hello {firstName} - ask me for anything in the Playbook, the directory, the service calendar, or spend."**
- Right slot: freshness chip mirroring `sc-chrome-bar-asof` - pulsing green dot, mono tabular, `PG live · HH:MM`
- **No eyebrow.** No module has one.

**Session rail:**
- Header: `＋ New question` in Flame with `⌘K`
- One group, **This session**, newest first, timestamp plus truncated question
- Selected: `--accent-sous-subtle` fill, 2px Flame inset edge
- Empty: *"Nothing yet - questions you ask will collect here."*
- Footer, permanent: *"Session only - clears when you reload."*

**Answer pane:** turns in sequence, newest last, scrolls independently. Composer in its own bar at the bottom of the pane. **The composer never floats over empty space.**

**First-run state** - the screen that decides whether a Regional trusts this:
- `What can I look up for you?`
- One line on what Sous is and that it declines rather than guessing
- **Four domain cards** - Playbook, People, Service Calendar, Spend - each with a count and two working examples, each card marked with the source module's own accent
- **Limits block, verbatim:**

> **What it won't do yet**
> No wages or reimbursement information. No P&L - that's coming soon. No prior seasons, that information is coming soon; the tools are current-season only and a 2024 question would return a valid-looking wrong number.

### 3.2 Playbook panel - the slide-out

**580px**, right side, over a `rgba(9,43,85,.22)` scrim. Playbook stays visible and scrolled where it was.

**Navy-to-Flame band header** carrying identity *and* context as one object, not two strips:
- Star, "Ask Sous", `Open in Sous ↗`, close
- `ASKING ABOUT` label
- **Document card** - id chip, title, `v2.1 · Live · 11 sections`, dismiss

**Deliberately not a narrow page:** no rail, no KPI strip, source subtitles hidden, action labels shortened.

**First open** - currently a placeholder, and it is the screen people actually meet:
- *"What do you need from this document?"*
- *"I've read all 11 sections. Ask in your own words - or start with one of these."*
- Section chips showing coverage
- Four starters, each tagged with the section that answers it

**After an answer: "More in this document"** - three further questions, section-tagged. **Pre-written questions are how the panel gets continuity cheaply**, and they are navigation rather than padding.

**Suggested questions derive from the document's own section headings.** Every document has them, they are already in the corpus, and it scales to 129 documents with nobody maintaining a list.

---

## 4. Conversational memory

**The problem, in one exchange:**

> **You:** what's tomorrow's service count
> **Sous:** which account?
> **You:** TBR
> **Sous:** your message came through blank

**Sous asks a question it cannot hear the answer to.** That is the single worst thing in the current build and it is cheaper to fix than it looks.

### How

The agent loop **already builds a `messages` array** - it must, for the tool loop. Today it starts fresh with one user message. This adds prior turns to an array that already exists.

- **Client holds the last 3 question-and-answer pairs** in React state and sends them with the request. No table, no migration, no backend.
- **Compact pairs only** - the question, a one-line answer summary, tools called, scope resolved. **Never raw tool results.**

### The rule that must ride with it

> **History tells you what the question *means*. Tools tell you what the answer *is*.**

Prior turns resolve "TBR" and "what about June." **They must never supply a figure.** Ask about May, get numbers; ask "what about June" and Sous now has May in context and could infer rather than query - producing a confident number nobody computed.

**Second rule:** citations come from *this* turn's tools. A document retrieved in turn one does not ground turn three.

Both are prompt rules **and** eval cases. The eval case is what makes them real.

### Cost
Roughly **half a day to a day**. Prompt round and a full 7/7 spike re-cert are mandatory.

---

## 5. Not-helpful capture

A thumbs-down with no context says something is wrong. **A thumbs-down with the trajectory says what.**

Clicking `▼ Not helpful` opens an inline block:
- **Six tags**, multi-select: Wrong number · Missing information · Wrong document · Out of date · Hard to follow · Should have declined
- Optional free text
- `Send feedback` / `Skip`
- Visible note: *"logged with the question + tools + sources"*

**Persisted against the existing `sousai_questions` row** - tags, text, timestamp. No new table if the row can carry them.

**The six tags are roughly the failure taxonomy an eval set needs**, so this feeds Phase E directly rather than being a nicety.

---

## 6. Load sequence

Sous should read as **arriving**, not as a page painting.

| Element | Delay | Motion |
|---|---|---|
| Star mark | 50ms | scale + rotate settle, 600ms |
| Light sweep across hero | 350ms | translate, 1500ms, once |
| "Sous" | 100ms | rise 10px, 500ms |
| Greeting | 220ms | rise |
| Freshness chip | 340ms | rise |
| Domain cards | 420–660ms | staggered rise, 80ms apart |
| Limits block | 760ms | rise |
| Composer | 840ms | rise |

All `cubic-bezier(.2,0,0,1)`. **Everything inside `prefers-reduced-motion: reduce` is suppressed.** One orchestrated moment on load; no ambient animation afterwards.

---

## 7. Implementation - five PRs

*Superseded by section 0 - the programme rebundled to two PRs (A and B) on 2026-07-31 after Phase 0 found `SousSurface` already served both surfaces via its `variant` prop. This decomposition is retained as the original scoping for reference.*

Each is independently mergeable and independently testable.

### PR 1 - Foundation
Accent token minted. Amber underline removed. Hero built against `oh-hero`. Two-column shell. Session rail with empty state and the session-only footer. Load sequence. First-run state with the four domain cards and the limits block.

**No behaviour change.** Answers render as they do today inside the new shell.

**Acceptance:** build clean · hero matches `oh-hero` values with a side-by-side · reduced-motion suppresses every animation · rail collapses cleanly at 1024px · `#0891B2` contrast verified for each use · **rail renders the `In context` marker on the top three entries, with the boundary rule below the third**.

**Note:** the marker ships in PR 1 as presentation. It becomes truthful in PR 3 when memory is real. Until then it reflects the intended window, and PR 3's acceptance re-verifies it against the actual retained turns.

### PR 2 - Answer components
Turn treatment per D9. Status pills matching `pb-status-pill` - 10px, 800, 6px radius, transparent with 1.5px border. Source cards with id, title, section. Table with tabular figures and real borders. KPI strip. Action row: Copy · CSV · feedback. **No Slack - deferred per D12.**

**Shared components** - the panel consumes these in PR 4.

**Acceptance:** every status shape rendered · a table with a long account name at 1024px · a decline · sources clickable through to the document · **no run-together text and no collapsed table** in any live answer.

### PR 3 - Conversational memory
The architectural one. Client holds three turns; route accepts them; agent prepends to `messages`. Prompt round for both rules.

**Acceptance:** **spike 7/7 both runs** · the TBR exchange resolves correctly · **an eval case proving a follow-up numeric question re-queries rather than reusing a prior figure** · citations from the current turn only · a fourth turn correctly drops the first.

**Hold the PR on the numeric-reuse case.** It is the money risk.

### PR 4 - Panel refit
580px. Band header carrying document context. First-open state with section coverage and starters. Section-tagged suggestions after each answer. Reuses PR 2 components.

**Acceptance:** width matches `.pb-slide` · `Ask Sous about this doc` opens with context already set · first-open renders before any question · suggestions derive from real section headings · `Open in Sous ↗` carries the question across · **a non-Live document opens the honest state naming its status and offering related Live documents**.

### PR 5 - Feedback capture
The `▼` flow, tags, text, persistence against `sousai_questions`.

**Acceptance:** tags and text persist and are queryable · skip closes without writing · the note about what gets logged is visible before sending.

---

## 8. Out of scope, and why

| | |
|---|---|
| Threading, nesting, rail-as-thread | Needs demand evidence. Memory covers the painful case. |
| Persisted history | Session history is nearly free; persistence needs a backend and an untested assumption. |
| Phone layout | No operators in this release. |
| Pinned queries | Needs persistence. |
| Scope chips on the page | D5. Revisit if inheritance lands. |
| New Sous capability | This release is surface and continuity only. |
| Slack send | D12. Needs new integration work; nothing else in the release does. |
| Shared `<HeroBanner>` extraction | Six modules already copy it; Sous makes a seventh. Real debt, not this release. |
| Shared `<SlideOverPanel>` extraction | Two exist with duplicated CSS; Sous makes a third. Same. |
| Panel `Open in Sous` deep link carrying document context | The panel knows the doc, the /sous page has no band to carry it, and building one is a scoped design change rather than a link fix. Panel `Open in Sous` opens the plain /sous page for now; a deep link would silently lose context into a first-run screen. |

---

## 9. Copy rules

- **"From this week's digest" must not appear anywhere.** Not a heading, not a label, not a placeholder.
- Sentence case throughout. No title case on labels.
- **Hyphens only. No em-dashes.**
- Limits are stated permanently, never dismissible. **Discovering a limitation feels like a bug; being told feels like a boundary.**
- Actions name what happens: `Send feedback` produces "Feedback sent."
- **The composer no longer warns about memory** - that warning ships out with PR 3.

---

## 10. Risks

**Contrast on Flame.** `#0891B2` is 3.6:1 on white - fine for components, not for body copy. Every use gets checked in PR 1.

**Memory leaking into answers.** The money risk. Mitigated by the prompt rule and held by an eval case.

**A seventh hero and a third panel.** Real debt, knowingly taken. Worth naming when extraction is scheduled.

**Suggested questions from headings could read oddly** on documents with terse sections. Worth eyeballing across doc classes before PR 4 merges.

**SLT and Regionals acting on Sous answers raises the stakes on correctness.** Not a blocker for this release, but **the eval set should be running before the invite list grows past this group.** A wrong spend number read by a Regional is a different event from one read by the person who built it.

---

## 11. Open questions - ruled 2026-07-31

All five closed. Recorded as D12 through D16 above.

| Q | Ruling |
|---|---|
| Slack action | **Deferred.** |
| CSV threshold | **None. Every table.** |
| Panel on non-Live documents | **Entry always shown; the panel states the limit and offers related Live documents.** |
| First-run examples | **Hard-coded for V1.** |
| Session rail | **Kept, and repurposed to show the memory window.** |

### Remaining unknowns, carried rather than blocking

- **Whether suggested questions read well across every doc class.** Terse section headings may produce awkward starters. Eyeball across classes before PR 4 merges.
- **Whether hard-coded first-run examples stay accurate** as tools change. They name capabilities; if a capability moves, the example lies. Worth a check whenever the tool surface changes.
- **Whether three retained turns is the right number.** Chosen because it covers the clarification loop without bloating context. The log will say if it is short.

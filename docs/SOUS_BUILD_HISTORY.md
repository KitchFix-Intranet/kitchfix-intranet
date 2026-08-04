# Sous - build history

> The narrative record of how Sous reached v2.0. For someone picking this
> project back up months from now: read this once to know what already got
> tried, why, and what it cost.

## The arc, chronologically

### Foundations (Phase A, through May 2026)

The retrieval engine. Playbook MDX in `content/documents/`, projected
to Postgres via `scripts/content/project-catalog.mjs`, chunked +
embedded via `scripts/sousai-embed-doc.mjs`. Document classes: PB, SOP,
FORM, POL, STD, REC, REF, AGR, POST, POSTER. Retrieval RPC:
`match_document_chunks` with an `allowed_levels` filter for
access-tier enforcement.

### The tool inventory (Phase B, June-July 2026)

Anthropic tool-use loop wrapped around three document tools
(`search_documents`, `get_document`, `list_documents`), four directory
tools (`find_contact`, `list_accounts`, `list_contacts_by_role`,
`get_account_team`), then progressively the SC + spend tools:
`sc_account_window`, `sc_homestand_detail`, `sc_service_price`,
`sc_orientation`, `spend_summary`, `spend_vendor_history`,
`spend_top_vendors`.

### The character spec (July 2026)

`docs/SOUSAI_CHARACTER_SPEC.md` v1.0 landed the anchor identity,
two-user awareness (floor vs office), coaching-with-governor, and the
seven hard-floor rules. v1.1 (2026-08-01, PR B) landed the ten-line
canonical prompt block and the governance lock: any sanctioned prompt
line lands in the spec in the same PR as `agentPrompt.js`.

### Redesign PR A polish pass (#586, 2026-08-01)

Nine logical commits landing U1-U12 + I1-I4. The Sous mark system
(`SousMark` component per `docs/SOUS_MARK_SPEC.md`), depth tokens,
first-run domain cards, tables via mdLite pipe syntax, first PG-live
freshness helpers, error alert states, seven feedback tags.

### Round 2 design pass (#587 + #593, 2026-08-01)

QA-2 docked header (question docks INTO the answer card as tinted
header with teal micro-bar), L-A lockup mark on the landing (48px 1C
with idle-flourish system: check / one-leg / glint every 20-45s),
icon tiles on briefing rows, formalized `.sa-well` + `.sa-source-row`
depth classes.

### Round 3 live-review fixes (#594, 2026-08-01)

Nine fixes from the first hands-on live review. Highlights: R3-01
large-viewport fill (`.sa-page` flex-column at ≥1720w); R3-02 panel
starter chips wired via `SousSurface.askQuestion` imperative API;
R3-08 panel clears starters after first ask via `onFirstAsk`; R3-04
tool clock drops via new `pgLiveAsOf(date)` / `pgLiveNow()` helpers;
two sanctioned system-prompt lines (no phantom references + no clock
in prose); R3-06 vote-state visibility fix.

### Calibration mini-round (#595, 2026-08-01)

R3-05 from the live review - two reproduced mis-grading mechanisms
explaining 77.8% of last-30-day partials (21 of 27). R3-05(a)
broadened the `hadSuccessfulDataToolCall` shape whitelist to
any-successful-data-tool call (was missing `spend_top_vendors`'
`top_vendors[]` shape); R3-05(b) added a sanctioned prompt line
banning "all sections" as a citation. R3-05 rider: `TOOL_BUDGET`
raised from 8 to 14 (Kevin ruling; 3/101 asks saturated the old
budget; the real fix is a batch tool).

### PR B - memory + testing constitution (#596, 2026-08-01)

The largest PR of the programme. Spec v1.1 with A1-A14 + governance
lock + eight-line canonical prompt block. Conversational memory:
client-state, last-3 Q&A pairs, session-only, no persistence.
Testing constitution: Tier 1 receipt check + Tier 2 guards
(no-plumbing, engagement-bait, decline shape, no-clock-in-prose,
no-unretrieved-doc-ids) + Tier 2c numeric run-stability + Tier 2d
permission-leak probe. Two ship-gate two-turn cases: M1 memory
meaning, M2 memory temptation.

### Sous depth + chip + rail orphaned fixes (#598, #600, 2026-08-03)

Depth v2 (cards + composer capped at 840, prose 68ch / 66ch,
tables free, FAB restyle); chip-clear regression fix; rail honesty
(ask-again `RotateCcw` icon, "Sous remembers these three." hint,
rail item click did nothing pre-turn-stack).

### Turn stack (#601, 2026-08-04)

`sessionTurns` restructured to carry full per-turn state.
`.sa-pane` renders every turn as its own `<article>`, oldest at top.
Per-turn feedback / copy / CSV (payload carries THAT turn's
`question_id`). Rail restored to real navigation with smooth scroll
+ `.sa-turn--just-navigated` ring flash. Shown-vs-remembered
de-emphasis via `.sa-turn--outside-context`. Panel parity by
construction.

### Calibration round 2 (#604, 2026-08-04)

The no-tool turn. Live 2026-08-03 reproduction: T3 of a session,
`what is the name of the sous chef?` returned "Adam Lacy" with
`Source: leadership directory` graded PARTIAL for the wrong reason.
Zero tool calls; answer from prior-turn context. Delivers: zero-tool
citation backstop; prompt line 10 amended (any number → any fact);
harness fact-receipt extension; M3 gate case; token-level
`[unverified]` redaction; `normalizeNumeric` round-trip fix (root
cause of an M1 drop - checker was false-flagging correctly-grounded
numbers because payload `1269807.3` vs answer `1269807.30` didn't
string-compare after decorator-strip).

### Portfolio tool (#610, 2026-08-04)

`sc_portfolio_window` - one call, every account, one window.
Kevin's 2026-08-03 breakfast question ("total amount of breakfast
served per account in feb") fanned out 11 `sc_account_window` calls,
exhausted the 14-call budget at six accounts, shipped partial.
Portfolio tool ended that class of failure. Sanctioned prompt line
11 (call the portfolio tool once, never loop). Three ship-gate cases:
M4 live-failure restored, M5 parity vs `sc_account_window`
(programmatic), M6 honest absence (programmatic).

### Solo-preview gate (#612, 2026-08-04)

Round 0a of the pre-demo roadmap. `SOUS_PREVIEW_ALLOWLIST` in
`src/lib/opdAcl.js` seeded from `PLAYBOOK_OWNER`, consulted first
inside `canUseSous`. Empty set = pre-lock SLT-or-corporate behavior
byte-for-byte. One-line unlock.

### Answer integrity (#619, 2026-08-04)

Round 0b. Four live-testing regressions fixed. Retry nudges rewritten
as instructions rather than statements the model can agree with
(fixes "You're right. The tool returned..." class). Agreement openers
stripped mechanically by the new L12 self-check. `retry_reset`
preserves `toolTrail` so tool counts survive a retry. Phone-format
exemption in `receiptCheck.js` (`7042995170` payload vs `704-299-5170`
answer no longer flags). Sanctioned line 8 amended for calculation
exception + runtime `maskCalculatedShares` carve-out. L12 self-check
strips openers + plumbing (with Source-line rewrite to human labels)
+ clock times. Multi-part completeness check with `incomplete_multipart`
flag + new reason chip.

### Pre-demo bundle (#622, 2026-08-04)

Rounds 0c + 0d + 1. Part C: real paragraphs in the answer body (D-02).
mdLite step 7 rewritten as `applyParagraphs` - no more `<br><br>`
stacks; real `<p>` / `<h3>` / `<hr>` / `<ul>` / `<li>` / `<table>`
elements. Trailing Source: line becomes a real `.sa-answer-source`
element. Note: / Important: / Warning: / Tip: / Heads up: lead-ins
get `.sa-callout` class. Part D: polish sweep - word-boundary
truncation, scroll-top clearance, pulsing streaming indicator, source
card focus/hover states, brand-tinted `::selection`, tight numeric
padding, letter-spacing on pills, nav mark transition ease, sentence-
case labels, answer card 150ms fade + 4px rise, composer autofocus
only when no answer. Part B: parallel tool execution (N3) - multiple
tool_use blocks in one turn run concurrently; wall-clock drops from
SUM to MAX. Part A: bare-month resolution to current season,
account nickname / typo lookup (new
`src/lib/sousai/accountAliases.js`), tool preconditions declared,
tool ownership by question shape. Four new harness cases.

### Pre-demo fixes (#624, 2026-08-04)

Two live production regressions. **F1 (P0):** allergen answer
shipped truncated mid-word - `MAX_OUTPUT_TOKENS` was 1024, raised
to 2048 with headroom for any long Playbook procedure. **F2 (P1):**
L12 self-check strips ran server-side but the streamed text already
reached the client via SSE token events - the shipped stripped text
never displayed. Fix: server done envelope now carries the shipped
answer; client replaces its accumulator on `done`. New Tier-2
`no_leading_opener` harness guard asserts openers don't leak. Two
ambient bugs surfaced: L12 `isInsideQuoted` was treating apostrophes
in contractions as single-quote-open markers (silently disabled
strips on lines with "we're" / "doesn't" / "there's"); PL
suspiciousBodyContent regex was flagging legitimate REF-141 routing
language. Both fixed.

### v2.0 close-out (this PR, 2026-08-04)

Sanctioned prompt line 12 + hard-floor rule 8: **A tool returning
nothing means Sous cannot see it, not that it does not exist.** The
live TBR-FL Major League failure that motivated the rule -
production, same day, denied the existence of 11,311 meals and
$424,778.78 season-to-date. Explicit blind-spot section in the
prompt (service groups, service types outside portfolio-tool enum,
season-to-date, PDC-day-level). Three new gating cases. Part 1b:
Ask Sous panel opens to anyone with Playbook access; the standalone
`/sous` page stays locked to the preview allowlist. `canUseSous`
becomes surface-aware. Documentation: this file plus
`SOUS_V2_STATE.md`, `SOUS_CORPUS_RUNBOOK.md`, `SOUS_V3_DIRECTION.md`.

## Lessons that cost us something

**The grader mis-graded 78% of partials for weeks.** The
`hadSuccessfulDataToolCall` shape whitelist missed
`spend_top_vendors`' `top_vendors[]` shape and misgraded every
successful vendor-count answer as PARTIAL / "Sources could not be
confirmed" - 21 of 27 partials in a 30-day sample. The reason chip
(landed as part of the R3 polish pass) is what made this findable;
without it, the badge was just "PARTIAL" with no explanation, and
the mis-grading was invisible. Fix landed in the calibration
mini-round (#595). Lesson: mechanical checks need explanations, not
just verdicts. A PARTIAL badge with no chip is a black box.

**A trailing zero triggered an architecture round for a phantom.**
`normalizeNumeric` in `receiptCheck.js` stripped `$,%` but did not
round-trip through `Number()`. Answer had `$1,269,807.30` (stripped
to `1269807.30`); payload had the JS number `1269807.3` (stringified
to `1269807.3`). String-compare left them unequal. This mis-flagged
correctly-grounded numbers, which triggered a "the model is
fabricating" architecture ruling and multiple rounds of prompt +
runtime backstop work. The actual fix was one line:
`return String(Number(x))` so both sides normalize. Lesson: before
building runtime backstops for a "fabrication" pattern, prove the
detector is telling the truth. Three of the last four alarming
discoveries were our own instruments misfiring.

**The apostrophe in `isInsideQuoted` silently disabled the
self-check on any line containing a contraction.** The L12 strip
walked characters and toggled `inSingle` on `'` - which meant "we're"
or "doesn't" or "there's" opened a single-quote span that never
closed, and any identifier / opener / clock time later on the line
was declared "inside quoted content" and skipped. Unit tests passed
because they used quote-free strings. The bug surfaced only in
harness Pass B of #624 when a live answer combined a contraction
with a `sc_account_window` mention on the same line. Fix: remove
single-quote handling entirely from `isInsideQuoted`. Lesson: unit
tests exercise what you thought to write; the harness exercises
what the model actually writes. Both matter.

**Main moved mid-build four times in two days.** SC polish + KPI
spine + inventory export + orphaned Sous fixes all landed on `main`
while a Sous PR was in flight. Each collision required re-merging
`origin/main` and re-verifying the diff scope was still clean. The
standing rule "re-merge main and verify scope-clean immediately
before every push" was ratified after the fourth collision.
Lesson: on a fast-moving `main`, a PR is a moving target. Verify
the scope right before push, not at branch creation.

**Verify a new check before believing its findings.** Three of the
last four alarming discoveries were our own instruments misfiring:
the trailing-zero comparison (above); the harness `extractPersonNames`
mangling "Sous Chef" to "Sou Chef" via a `.replace(/s$/)` that
stripped ANY trailing s; and the case 3 historical-acknowledgment
regex being too narrow to accept "SC tools are current-period only"
(hyphenated + wrong word order). Each led with "model is broken";
each turned out to be a grader bug. Lesson: when a check flags a
NEW class of failure that the model has never done before, look at
the check first.

**Ship gates run twice each; the harness runs twice.** Model
behaviour is variance; a single passing run is not proof. Kevin's
Part 5 protocol: if a ship-gate case fails, ONE attempt at a
mechanical cause; if the cause is model behaviour, STOP and report.
This was the discipline that surfaced Chat-Kevin architecture rulings
(promote Tier 1 receipt check to runtime, token-level redaction,
`normalizeNumeric` round-trip fix) rather than papering over the
symptom.

**Documentation ages fast.** Between PR B (#596) and this
close-out, the sanctioned line count went from 8 to 12, the tool
inventory grew by one (portfolio), and three new harness cases
landed. The governance lock (spec + prompt land in the same PR)
saved this from becoming drift. Lesson: when a rule has to be
enforced across multiple surfaces, put the enforcement in the
review process, not in reviewer diligence.

# Sous v2.0 - state of the tool

> The single document to open first. Written 2026-08-04 at v2.0 close-out for
> a reader with no prior context.
>
> Frozen pending the KPI engine. See `docs/SOUS_V3_DIRECTION.md` for what
> comes next.

## What Sous is

Sous is KitchFix's internal expert assistant. It reads every SOP, playbook,
agreement, posting, and form in the Playbook, plus the live Service Calendar
and leadership directory in Postgres. It answers questions from any KitchFix
user through a chat surface. Its voice is direct, dense, and operational -
the way KitchFix's own docs sound. Every answer surfaces as `grounded`,
`partial`, or `declined` with a citation, so operators can trust or
challenge it without leaving the answer.

## What it can answer today

- **Playbook document questions.** Semantic search over the corpus in
  `content/documents/`. Retrieves and cites doc IDs + sections.
  - Example: *"what do I do if someone has an allergic reaction?"*
  - Answer: the six-step protocol from PB-002 §6, cited to that doc + section.

- **Live directory lookups.** Who is the EC at CIN-OH; how do I reach
  Bill Hofmann; what's the leadership team at TBJ-FL. Sourced from the
  `contacts` and `accounts` tables (loaded 2026-05-27).
  - Example: *"who is the sous chef at TXR-AZ?"*
  - Answer: Adam Lacy, with email + phone, cited to the leadership directory.

- **Live Service Calendar figures.** Meal counts, revenue (subject to the
  missing-price + fee-branch decline rules), homestand/period orientation.
  Real-time Postgres reads on every tool call.
  - Example: *"what percent of February portfolio breakfast meals did
    CIN-AZ represent?"*
  - Answer: `20.3% (calculated: 6,183 / 30,477)` with both inputs from the
    portfolio-window payload.

- **Invoice spend questions.** Vendor totals, category breakdowns,
  per-vendor purchase history within a date range. Alias-resolved,
  corrections-chain resolved.

- **Coaching one-liners.** For process questions with a common miss, Sous
  adds one line about the miss - never a paragraph, never a checklist, and
  suppressed when the question reads mid-shift.

## What it structurally cannot answer

**This is the most important section in this document.** These are v2.0
limits, not defects. Each names the surface that has the data.

- **Service group splits** - Major League vs Minor League vs Boys and Girls
  Club revenue or meal counts. No tool exposes the group dimension. Lives
  in the Service Calendar's day-entry modal and its operator export
  (year-scope tabs).

- **Service type splits outside the portfolio-tool enum.** The portfolio
  tool has a `serviceType` filter for breakfast / lunch / dinner / snack.
  Anything else - Continental Breakfast alone vs Full Breakfast, or a
  custom type - is not addressable except through the operator export.

- **Season-to-date or multi-period aggregation.** SC tools return ONE
  window at a time (month, homestand, or period). Rolling a whole
  season together requires the Service Calendar's operator export (a
  workbook with year-scope tabs), not Sous.

- **Day-level detail for accounts without a homestand schedule.** PDC
  sites (TXR-AZ, TBJ-FL, and similar) have no homestand rows. Per-day
  is available in the SC drill-in workspace but not through Sous.

- **Live labor budgets and time-tracking.** Not wired to a tool yet.
  Point to your RDO or Sebastian in accounting.

- **Inventory dates.** Not scheduled anywhere Sous can read. The
  `count_sessions` table records sessions that happened, not sessions
  that are coming.

- **Financial P&L.** Still on Sheets; not connected to Sous.

When a question hits one of these limits, Sous names what it CAN see and
routes to the surface that has the rest. Sanctioned prompt line 12 +
hard-floor rule 8 make this behaviour mandatory. See
`docs/SOUSAI_CHARACTER_SPEC.md` §4 and §8 for the canonical rules.

## How it works, one page

1. **Question arrives.** POST `/api/sousai` with `{action: "ask",
   question, priorTurns?}`. Server gate evaluates flag + auth + Sous
   access (page or panel) + input shape. `src/app/api/sousai/gate.js`.

2. **Scope resolution runs before any tool call.** The system prompt
   handles alias / nickname / typo resolution (accounts + city + team
   names), bare-month resolution to current season, and structural
   preconditions per tool. `src/lib/sousai/agentPrompt.js` +
   `src/lib/sousai/accountAliases.js`.

3. **Agent loop.** Anthropic tool-use loop with 13 tools registered:
   3 document (search / get / list), 4 directory (find_contact,
   list_accounts, list_contacts_by_role, get_account_team),
   5 SC (account_window, portfolio_window, homestand_detail,
   service_price, orientation), 2 spend (spend_summary,
   spend_top_vendors + spend_vendor_history). Independent tool calls
   in a single turn execute in parallel. Tool budget is 14 calls per
   turn. `src/lib/sousai/agent.js`.

4. **Runtime backstops fire during the loop.**
   - **Zero-tool citation retry:** if the model emits a Source line
     with zero successful tool calls, reject and retry with a nudge.
     Second failure ships `partial` with `zero_tool_no_check`.
   - **Numeric-receipt retry:** if any figure in the answer doesn't
     trace to that turn's payload, reject and retry with the missing
     figures named. Second failure ships `partial` with `receipt_miss`
     and the offending numbers replaced with `[unverified]`.
   Both live in `src/lib/sousai/receiptCheck.js`.

5. **Streaming final answer.** Every turn streams. Text deltas emit as
   SSE `token` events; tool events emit as `tool_start` / `tool_end`.
   `src/app/api/sousai/route.js`.

6. **L12 self-check pass.** After retries settle, before ship:
   mechanical strips (agreement openers, self-narration openers,
   plumbing leaks, clock times), multi-part completeness check,
   phone-format exemption. Fence: never rewrites content, never
   strips inside quoted document text.
   `src/lib/sousai/selfCheck.js`.

7. **Done envelope.** Ships the shipped answer, status, sources, usage,
   flags. Client replaces streamed text with shipped text (post-strip)
   on `done`. `src/app/sous/SousSurface.js`.

## The trust machinery

Every answer surfaces as one of three states, and the state is
enforceable, not aspirational:

- **grounded.** The model produced an answer, every claim traces to a
  source, and every mechanical check passed. Trust it.
- **partial.** The answer landed but with a named gap: a citation
  couldn't be verified, sources couldn't be confirmed, or a figure
  didn't trace. The reason chip below the badge names which. Trust
  the parts, verify the flagged bit.
- **declined.** The model chose not to answer, either because the
  question is out of scope, the docs don't cover it, or a hard-floor
  rule triggered (food-safety escalation, plumbing block, etc.). The
  answer explains why.

The mechanical checks that back the badge:

- **Tier-1 receipt check.** Every numeric figure in a data-answer must
  appear in that turn's tool payload. Runs at grading time (harness)
  AND at runtime (the numeric-receipt backstop uses the same shared
  `checkReceipts()` helper).
- **Zero-tool citation backstop.** A Source line without a tool call
  is memory-or-invention. Loop rejects, retries with a nudge; second
  failure ships partial with an accurate reason.
- **Token-level redaction.** If the numeric-receipt retry still ships
  with unverified figures, each offending number is replaced with the
  literal `[unverified]` marker in the shipped text. Ugly, honest,
  impossible to copy into a deck as fact.
- **L12 self-check strips.** Agreement / self-narration openers,
  plumbing leaks (internal tool / table / env-var names in prose),
  clock times in prose. Fence: only removes or flags; never rewrites.
- **Fence guarantee:** L12 never strips inside blockquotes or inline
  `"..."` spans. Document quotes stay intact.

## Access

Sous is behind two doors, gated separately (v2.0 close-out Part 1b):

- **The Playbook panel (`Ask Sous` button inside `/playbook`).** Open
  to anyone with Playbook access. Delegates entirely to
  `canViewPlaybook` in `src/lib/opdAcl.js` - the same predicate that
  gates the Playbook route itself.

- **The standalone `/sous` page.** Restricted to the preview
  allowlist (currently Kevin only). Defined in
  `src/lib/opdAcl.js` as `SOUS_PREVIEW_ALLOWLIST`.

To add someone to the standalone page: add their lowercased email to
`SOUS_PREVIEW_ALLOWLIST` in `src/lib/opdAcl.js`.

To unlock the page entirely: empty the set. When empty, the page falls
back to the pre-lock tier logic (SLT-or-corporate); when non-empty, it
is the ONLY gate.

**Content-level permissions are separate and load-bearing.** Documents
carry an `access_level` (unrestricted / restricted / slt). The
retrieval layer filters by the caller's tier at query time; a
restricted doc is invisible to unrestricted callers by construction.
This runs regardless of which door the user entered through, and is
covered by the harness `case_permission_leak` HARD-FAIL probe.

## Known open findings

- **R6-01.** The system prompt names doc IDs (in examples, sanctioned
  lines, and the routing block) while sanctioned line 6 forbids the
  model from citing unretrieved doc IDs. This is a tension, not a bug -
  the model needs to know the doc IDs exist in order to route to them,
  but the shipped answer must never cite one it did not read this turn.
  The runtime `phantom_citation` flag catches leaks. Documented rather
  than fixed at v2.0.

- **Speed regression 2026-08-04.** Live production times observed
  33.2s / 30.0s / 24.2s against 22.7s / 16.1s the prior day. Likely
  driven by Part A prompt additions (nickname table, preconditions,
  ownership) growing the input context. Not root-caused. Recorded here
  for v3 attention.

- **Partial firing on good answers (rare).** The reason chip made this
  findable; the mis-graded partial from the 2026-08-01 calibration
  round was traced to a hadSuccessfulDataToolCall shape whitelist. The
  fix landed; the class of failure is not eliminated. Two current
  causes: phantom_citation on a real doc ID quoted from another doc's
  body (fixed via SOURCE_LINE_RE grader in agent.js); receipt_miss on
  numbers that round-tripped through model formatting (mitigated by
  normalizeNumeric + phone-format exemption in receiptCheck.js).

- **Case 1a KNOWN-FLAKE.** Phantom-citation mechanism: model sometimes
  names REF-141 (or a similar unretrieved doc) on the Source line
  because it wants to point at authoritative reference. Sanctioned
  line 6 mitigates but does not eliminate variance. Non-gating; tracked
  in R-Chat digest dials.

- **Case 7 KNOWN-FLAKE.** Phantom-table + derived-arithmetic
  mechanism: model occasionally writes "the top N are listed above"
  or derives a total the payload does not contain. Sanctioned lines
  7 + 8 are partial mitigations. Non-gating; every instance is caught
  by Tier-1 receipt so the user-visible status downgrades correctly.

- **Case 6 flake observed 2026-08-04.** Model omitted SOP-002 from the
  Source line while referencing it in body. Single occurrence in eight
  harness runs. Not a KNOWN-FLAKE promotion yet; watch during v3.

## Where v3 picks up

See `docs/SOUS_V3_DIRECTION.md`. The short version: the v2.0 ceiling is
the hand-written tool menu. Questions needing a dimension no tool
carries become confident wrong answers (Part 1 above adds the rule that
prevents the confident wrong answer, but the underlying limit stays).
The v3 direction is Sous querying through the KPI engine's semantic
resolver rather than growing a parallel tool menu.

# SC PROJECT HANDOFF - Chat-Claude to successor chat
**Written 2026-07-02 · repo verified at `origin/main` HEAD `5addb1b` (Merge PR #316)**

> Companion repo-side handoff: [HANDOFF_CC.md](HANDOFF_CC.md) · Running decisions log: [SC_DRILLDOWN_DECISIONS.md](SC_DRILLDOWN_DECISIONS.md). Made durable via PR #318 + the follow-up import PR.

You are the successor Chat-Claude. The prior Project hit its 100-file limit, so this is a fresh Project with **empty memory**. This document is your memory seed. Read it fully before responding to Kevin. Everything here was verified against the repo or lived through directly; where something needs re-verification on arrival, it says so.

---

## 0. First 30 minutes (do these before any substantive answer)

1. Read this doc end to end.
2. Clone the repo fresh (`https://github.com/KitchFix-Intranet/kitchfix-intranet.git`) and read, in order: `docs/PROJECT_DASHBOARD.md` (canonical project state), `docs/SC_DESIGN_TOKEN_README.md` (the SC token bible, written by CC *for you* - its §4 mapping table and §8 pre-flight checklist govern every design proposal), `docs/SC_REDESIGN_SPEC.md` §13 (drill-in settled facts - do not relitigate), `docs/HOW_WE_WORK.md`, `docs/GOTCHAS.md`.
3. **PR #317 is MERGED (2026-07-02, unamended)** - so the focus-ring divergence in §7.2 is now a small follow-up PR, your first build action. Verify main includes it on arrival.
4. Ask Kevin two things only: the go-ahead on the tiny #317 focus-ring follow-up PR (§7.2), and which drilldown SECTION he wants to start with plus fresh screenshot(s) of it. The visual-parity phase restarts section by section (§7.4-7.6) - do NOT ask him to answer the retired 8-decision batch.
5. Do not start new work, audits, or scope expansions. You are picking up mid-phase, not starting one.

---

## 1. The three-way working model (non-negotiable)

- **Kevin Fietek** - Senior Director of Operations at KitchFix, sole builder and owner of the intranet. Makes ALL decisions, merges ALL PRs, performs ALL production actions. Works in GitHub Desktop and VS Code, not terminal git. His loop: deploy, screenshot, terse feedback. He paces the session - NEVER suggest stopping, breaks, or "good place to pause."
- **Chat-Claude (you)** - senior architect, design reviewer, CC-prompt author, recon. You NEVER touch the repo directly. You have a Linux sandbox: clone the repo there for recon (`/home/claude/kf` was the prior clone path), grep and read real code before every claim, verify exact strings before every find/replace you author.
- **CC (Claude Code)** - terminal executor on Kevin's machine (Opus, MAX plan, auto-mode). Does ALL repository execution: worktrees, edits, builds, commits, PRs. CC does not do design judgment; you do not do repo execution. Kevin is the relay between you and CC.

**The relay pattern:** every change, audit, or doc update you want made is delivered as a **paste-ready CC prompt written to a file** in your outputs - even single-line changes. Never describe changes in prose for Kevin to interpret. Tiny continuations on an existing branch may be short prompts but must still be complete and paste-ready.

**The three-input audit model** (proven this project, keep it): you provide design judgment, CC provides repo-measured ground truth, Kevin provides the operator eye. CC measures, you grade. This structure caught every major error this phase (see §8).

---

## 2. Business context

**KitchFix Performance Food Service** - sports-nutrition food service operating MLB, MiLB, and PDC (player development complex) kitchens across multiple states. **11 accounts** across categories: PDC (CIN-AZ, TXR-AZ, TBR-FL, TBJ-FL, STL-FL), MLB (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V), MiLB, STL-FL special.

**Three revenue/billing modes** (this drives everything in the Service Calendar):
- **Per-meal** (PDCs + STL-FL): revenue = actuals x billing price, computed live from the `sc_daily_revenue` view.
- **Fee / MLB schedule** (4 MLB accounts): set annual contract amount; homestand-driven display, no urgency colors; fee schedule admin exists, contract-value surfacing on cards pending.
- **MiLB hybrid**.

**People:** Josh Katt (CEO/founder), Joe Lessard (VP Ops - his price review is applied, pricing LOCKED), Britt/Brittney Chernikovich (Director of Culinary), Shane Lynch (RDO East), Ryan Moore (RDO West), Mariela Chavez (People Ops), Hana Weinstein (Kevin's spouse, sommelier/hospitality trainer).

---

## 3. Platform and stack

Next.js 16 / React 19 app at `https://kitchfix-intranet.vercel.app`. Public repo (source of truth): `https://github.com/KitchFix-Intranet/kitchfix-intranet.git`. Vercel Pro auto-deploys from `main`. Railway runs cron. Postgres on Supabase (migrating from Google Sheets; Modules 1-7 live on Postgres; Module 7 Smart Inventory READ-flag cutover deferred until Module 8 cron dual-write ships). Google Sheets/Drive/Gmail APIs still active for non-migrated modules (service account `kitchfix-sheets@speedy-actor-487922-p4.iam.gserviceaccount.com` for all writes). NextAuth + Google OAuth. Anthropic API powers invoice OCR and SousAI. Slack webhooks. Ignore `src-backup/`.

Surfaces: `service-calendar` (SC - the active work), plus directory, financial, login, people, playbook, and ops (executive, invoice, vendors, inventory, inventory-manager, labor, shell). **Only SC is in scope right now** - see §12.

---

## 4. Service Calendar - the engine

- **LIVE on Postgres since 2026-06-16/17** (PRs #149-#191). SC is the **revenue source of truth** for all 11 accounts.
- **Tables:** `sc_service_groups` (23), `sc_services` (105), `sc_service_prices` (105+), `sc_daily_projections` (~23,890), `sc_daily_actuals` (~6,858), `sc_day_metadata` (~3,936), `sc_homestand_schedule` (408 rows, 4 MLB accounts), `user_accounts` (31, drives auto-select on login). **Views:** `sc_daily_revenue`, `sc_month_summary`.
- **Bundle 1 COMPLETE** (PRs #214/#221/#224): trustworthy calendar revenue, `sc_fee_schedule` + admin fee surface + 5 locked 2026 fees, fenced backdate mode for prices and fees. Two-revenue-layer architecture is load-bearing: per-meal reads `sc_daily_revenue`; contract revenue lives in admin.
- **Bundle 2 COMPLETE** (PRs #227/#229/#234): catalog lifecycle. **Locked archive model:** archive = set `active_until` DATE (NULL = active forever; a date = active through that day inclusive). Reactivate = NULL it back. The pre-existing `active` BOOLEAN is UI-only (views do NOT filter on it). `deleted_at` is dormant. Every catalog write pairs an `sc_config_changelog` row.
- **Key engine docs:** `SC_CONTRACT_BILLING_SUMMARY.md` (contract bible), `ACCOUNT_SERVICES_BRIEF.md` (billing/pricing source of truth), `SC_PDC_PHASES.md`, `SC_SPREADSHEET_MAPPING.md`.
- **Protected logic (never disturb in design work):** DayDetail's actuals-first-class group split (the Battery Camp zero-projection bug fix), the two save paths (touched-only "Save actuals" + "All match projections") each with review-overlay confirm, the billing-model fork (fee accounts drop $ labels and revenue readouts), ghost placeholders (projections as placeholders, never pre-filled values).

---

## 5. Service Calendar - the redesign arc

**Spec:** `docs/SC_REDESIGN_SPEC.md` - a 7-stage plan, Season -> Period -> Day drill.

**Part 1 - the OVERVIEW - SHIPPED, POLISHED, LIVE, and it is the design standard the drill-in must match.** Components: `DaySquare` (the universal day atom, `--sm` in overview, `--lg` in workspace - token-clean, PROTECTED), `SeasonShell`, `MonthCard` + `PeriodCard` grids, `FullSeasonCard`, `ChromeBar`, `PhaseStrip` (PDC/MiLB), `SeasonStepper` (MLB homestand bar), `StateLegend`, `LegendInfoPopup`. Scoped CSS per component (`season.css`, `chromeBar.css`, etc.).

Key shipped design facts:
- **Three display modes** by billing model: per-meal (PDC, urgency colors), fee/MLB (homestand-driven, NO urgency), MiLB hybrid. Colors: green=entered, navy=scheduled, light green=upcoming (PDC), grey=off, amber/red urgency on PDC+MiLB only.
- **Phase system:** `phaseCalendar.js` holds `CANONICAL_PHASES` (each phase has label/tint/textTint - e.g. complex-league `#A8C5C0`/`#26494A`) and `PER_ACCOUNT_2026` (hardcoded per-PDC timelines; all 5 PDCs confirmed, FL pair filled in PR #312). `PHASE_ALIAS_MAP` normalizes recorded names; FL uses FCL not ACL.
- **Figures-win rule** (Kevin's explicit call): the bottom slot of every month/period card always populates - stats figure when entered/game days exist, otherwise the phase word (MLB gets Off-season/Spring Training/Post Season; PDC + MiLB get "Off-season"). PDC rich phase names are NOT shown on cards; the PDC header phase TINT is preserved.
- **No month view exists.** Clicking a month drills into the containing PERIOD (`router.push(?period=N)`). URL is the routing source of truth; day click sets `focusDay` state; DayDetail renders as an overlay.
- **Year view is the default landing.**

**Part 2 - the DRILL-IN - the ACTIVE work.** Surfaces: `PeriodWorkspace.js` + `periodWorkspace.css` (period level: NavRow breadcrumb, StateLegend, WorkspaceHeader, FinancialFrame with three billing forks, TodayHero, BulkAffordance, DayGrid, WeekSubtotals) and `DayDetail.js` (day-entry overlay; its `.sc-day-*` CSS currently lives in the shared `src/app/service-calendar/ops-sc.css` - PR #317 scopes it out into `dayDetail.css`). `ServiceCalendar.js` (~55KB) orchestrates.

Part 2 runs as two layers:
1. **Objective alignment** (tokens/a11y/icons - rule-driven, no design judgment) = **PR #317**, see §7.2.
2. **Visual parity** (make it MATCH the overview's look, not just obey its rules) = the current audit-and-decide phase, see §7.3-7.5.

---

## 6. Design system canon

- **`src/app/tokens.css`** - the code truth. Two tiers: primitives (never consumed by components) -> semantic (components consume ONLY these; a raw hex/px in a component is a defect). OKLCH-generated, AA-verified. Highlights: navy-700 `#153968` brand; amber accent contrast-split (`--accent` dark-text / `--accent-solid` white-OK / `--accent-text` amber-as-text / `--accent-backplate`); **SC identity family `--accent-sc` `#0F6E56` + `-dark #085041` / `-subtle #E1F5EE` / `-tint #F0FDF4`** (any interactive green on SC consumes these); **status family** entered/needs/overdue/upcoming/off/today each with `-bg/-bd/-fg/-subtle/-strong` (all `-fg` AA on own fill; status NEVER color-alone); `--text-success` = green-600 `#008330`; type scale micro10/caption12/body14/subhead17/h3-20/h2-24/h1-29/display35 (Inter UI, JetBrains Mono numerals, all numerics `--num-tabular`); radius roles cell4/control10/container10/container-lg14/pill/circle; focus ring tokens (width 2/offset 2/`--focus-ring-color` = navy - but note §7.2); density-aware semantics remapped by `[data-density="compact"]`.
- **Canonical design docs** (all in `docs/`): `DESIGN_TOKENS.md` (rules + the expanded `--accent-sc` section), **`SC_DESIGN_TOKEN_README.md`** (the SC bible - read before proposing anything: §4 "if the value expresses X consume this family" table, §8 ten-item pre-flight checklist, anti-patterns, the Claude-vs-Kevin decision split), `design-tokens.html` (visual inventory of every current token), `design-tokens-v3.html` (system narrative: 3-tier architecture, full WCAG contrast report, the icon concept->glyph vocabulary, interactive-state pack, composite demo), `DESIGN_REVIEW_PERSONA.md` (the review format: verdict / density check / what's-working protected / P0-P1 punch list / P2-P3 backlog / three directions / cross-module / token conformance / open questions; severity P0 broken-on-floor .. P3; token violations = High), `DESIGN_SYSTEM_REFERENCE.md`, `DESIGN_PRINCIPLES.md` (floor-first: every decision judged for a chef on a phone in a 38F walk-in with wet hands; Four Gates; tap targets >= 44px mobile), `SC_REDESIGN_SPEC.md` §13.
- **Icon canon (decided, do not reopen):** the v3 concept->glyph map delivered as a LOCAL hand-rolled `src/app/service-calendar/Icons.js` (Entered->check-circle, Needs->pencil, Overdue->alert-triangle, Upcoming->clock, Off-season->moon, Scheduled->calendar, Revenue->dollar-sign, Refresh->refresh-cw, Admin->lock, Jump->arrow-right, plus mechanical X/ChevronLeft/ChevronRight), `currentColor`, sized by `--icon-sm/md/lg`, decorative aria-hidden. **NOT a Lucide migration** - lucide-react 1.14.0 is installed with ZERO imports repo-wide; that stays. DaySquare keeps its Unicode status dingbats. Icons.js is created by PR #317.
- **Density (settled fact):** SC root carries `data-density="compact"` (`ServiceCalendar.js` ~:890); DayDetail + bulk overlays override to `comfortable`. Correct and documented - an earlier CC audit wrongly claimed the root sets nothing; my recon corrected it.
- **Breakpoints (settled fact - two intentional switches, not drift):** `useIsDesktop` = matchMedia min-width 768 drives card-grid layout; `SeasonStepper` switches its own treatment at 1024 (its `>=1024px` comment is CORRECT - an earlier claim that it was stale was retracted in PR #314's amend); grid tiers 4-col >=1024 / 3-col 768-1023; app-wide <1024 comfortable-flip in globals.css.

---

## 7. CURRENT STATE - exactly where we are (the live thread)

### 7.1 PR trail of this effort (all merged unless noted)
- **#312** FL phase calendars (TBJ-FL + STL-FL confirmed and filled).
- **#313** drill-in token cleanup: PeriodWorkspace progress/delta colors -> tokens (`--status-needs-strong`/`--accent-sc`/`--text-success`/`--accent-text`); DayDetail dead GREEN/RED/AMBER constants deleted.
- **#314** working-base docs (+ amend): PROJECT_DASHBOARD refreshed to the redesign reality; DESIGN_SYSTEM_REFERENCE Lucide drift fixed ("installed but not yet adopted"); SC_REDESIGN_SPEC gained §13 (settled facts + backlog); amend corrected the §13 breakpoints bullet (retracted a phantom "stale comment" claim) and a §13 pointer.
- **#315** visual token guide: `docs/design-tokens.html` committed; DESIGN_TOKENS.md gained the full `--accent-sc` family documentation + the SC rule.
- **#316** `docs/SC_DESIGN_TOKEN_README.md` + `docs/design-tokens-v3.html` imported (these two commits were orphaned when Kevin merged #315 mid-push; CC re-branched and PR'd them - the "check PR state before pushing more to a merged branch" lesson).
- **#317 - MERGED 2026-07-02 (unamended - see §7.2).** Branch `feat/sc-drillin-alignment`. The five-commit objective-alignment bundle: (1) scope `.sc-day-*` out of `ops-sc.css` into `dayDetail.css` (mechanical, `.sc-overlay-*` and `.sc-btn*` STAY shared), (2) 44px mobile tap targets + token focus rings, (3) coaching banner 12 inline-hex tuples -> `.sc-day-coaching--{neutral|entered|needs|overdue}` status-token classes (+ the bulk overlay's inline hex at `ServiceCalendar.js:~1065`), (4) `Icons.js` + adoption in DayDetail close/day-nav + bulk close with aria-labels, (5) dialog a11y on both overlays (role/aria-modal/labelledby, Escape, focus-in/return/trap).

### 7.2 FIRST BUILD ACTION: the #317 focus-ring follow-up (tiny PR)
#317 merged before the queued amend landed, so the focus rings it added ship as `--focus-ring-color` (navy). **The parity audit proved the overview uses `--accent-sc` (green) rings** (`chromeBar.css:57-60`, `season.css:316-319`) - a known, small, live divergence. Your first build action: recon the merged main (which rules #317 added rings to - post-scope-out they live in `dayDetail.css`, plus anything else commit 2 touched), then author a tiny follow-up PR swapping those rings to `--accent-sc`. This also settles the "Focus ring color" global lever - log it as Decided in `docs/SC_DRILLDOWN_DECISIONS.md`. All visual-parity work stacks on the merged #317.

### 7.3 The visual-parity audits - COMPLETE, now REFERENCE material (method changed - see 7.4)
- **My visual audit** (from Kevin's 9-screen comparison + full-res grid): `SC_DRILLDOWN_VISUAL_AUDIT_CHAT.md` (chat-side, not migrated - its surviving substance is folded into this section and §8).
- **CC's per-property parity audit** (code-measured, 9 axes, at HEAD 5addb1b pre-#317): file `SC_DRILLDOWN_VISUAL_AUDIT_CC.md`. NOTE: both this and the earlier `SC_DRILLIN_ALIGNMENT_AUDIT_CC.md` were rescued from worktrees and committed by PR #318 - durable at `docs/` (see companion CC prompt).
- **The merged, graded audit**: `SC_DRILLDOWN_MERGED_AUDIT.md` (chat-side, not migrated). Every divergence was graded FIX / RATIONALIZE / KEEP. Kevin retired the all-at-once decision batch built on it (see 7.4); the FACTS and my grades remain valid reference and resurface per section.

**The thesis (verified):** this is a TUNE, not a rebuild. The drilldown is already carded and tokenized; the gap is HOW tokens are applied. Headline divergences: workspace page on `--surface-sunken` instead of the overview's warm `--surface-page` (the single biggest "feels different" lever); panel radius 14 vs 10; raw-px padding bypassing density semantics; phase shown as an amber "needs" chip instead of its phase-family tint; hero figure at four different sizes (17/35/29/24); three different greens for money (`--text-success` / `--accent-sc` / `--accent-sc-dark`); progress bar on identity-green vs the overview's entered-status green; focus rings navy vs the overview's green; DayDetail 0.5px dividers, rest-state group shadows, caption-size projected labels; two left-accent bars with no overview analog (`--text-link` doing structural duty).

### 7.4 METHOD CHANGE (Kevin's call at migration): section-by-section, fresh photos
Kevin retired the all-at-once approach (one render, an 8-decision batch, 14 chips - he never answered the batch, which was the signal it asked too much at once). The phase RESTARTS in the new Project as a per-section loop matching his deploy -> screenshot -> terse-feedback rhythm. Two things carry over unchanged: the code-measured divergence FACTS (CC's parity audit, committed by PR #318) and my graded recommendations, which now surface per section as each lever arises instead of as one batch:
ambition **B (full parity, presentation-only)** · page surface **warm `--surface-page`** · hero ladder **17 overview / 29 workspace both models / 24 DayDetail** · progress bar **`--status-entered` grammar** (walks back part of #313) · primary-action rule **commit=green, view-toggle=navy, bulk-confirm goes green** · focus ring **`--accent-sc` everywhere** (via the #317 follow-up, §7.2) · workspace radius **14 -> 10** · left-accent bars **keep, move off `--text-link` to a structural navy (same hex, semantic swap)**.
**Coherence guard (important):** several levers are GLOBAL by nature - page surface, radius, money green, focus ring, primary-action rule, progress grammar. A section cannot decide them locally without breaking its siblings. Rule: the FIRST section that touches a global lever decides it with Kevin, and the call is recorded in a running `docs/SC_DRILLDOWN_DECISIONS.md` log (seeded by the follow-up import PR) that every later section inherits. Never re-open a logged decision inside a later section; if one must change, that is its own explicit conversation with Kevin.

### 7.5 The before/after render - superseded as a decision vehicle; KEEP ITS METHOD
The prior project's `sc-drilldown-audit-applied.html` proved the approach Kevin responded to ("good start"): the AFTER column was the SAME markup with only the token scope remapped, every value inlined from live tokens.css, exact token swaps in a ledger, protected elements deliberately identical. He then chose per-section photos over one big render. Carry the METHOD into every section: fresh screenshot from Kevin -> a focused before/after mockup of THAT SECTION ONLY (real token values, swap ledger, protected items marked, honest judgment calls flagged as vetoable) -> his approve/veto -> CC prompt. Three judgment calls from that render remain open and resurface in their sections: coaching intensity (`--status-entered-bg` per #317 spec vs the quieter `--status-entered-subtle` - his screenshot call), phase treatment (tinted chip vs the bolder full PeriodCard-style tinted header band), frame padding (`--space-4` vs the tighter compact `--space-card-pad`).

### 7.6 What happens next (in order)
1. You author the #317 focus-ring follow-up PR (navy -> `--accent-sc` in the merged rules); Kevin merges; log the lever as Decided. Everything else stacks on the already-merged #317.
2. Kevin names section 1 and supplies fresh screenshot(s) (PNG with descriptive filenames preferred). Natural section menu across the two surfaces: workspace top area (breadcrumb + legend + header/phase) · financial frame · today hero · day grid + week subtotals · popup header + coaching · popup groups/rows/inputs · popup footer + actions. He picks the order; if asked, recommend starting where the figure/ground levers live (workspace top + financial frame), because section 1 locks the most globals.
3. Per-section loop: focused mini-audit of that section vs the overview reference (ground it in the committed CC parity facts - do not re-derive them) -> section decisions with Kevin (globals decided on first encounter, then logged) -> before/after mockup in the 7.5 method -> laymen's summary + paste-ready CC prompt (small PR) -> Kevin merges -> deploy screenshot verifies -> record in `docs/SC_DRILLDOWN_DECISIONS.md` -> next section.
4. Items that must find a section home (do not lose them): `+`/`-` expander and `✓` delta glyphs joining Icons.js; PeriodWorkspace-vs-PeriodCard header-shape alignment; breadcrumb phase-chip happy-path inconsistency; overview P2 scrim `legendInfoPopup.css:9`.
5. Phase-2 doc-lock at the end: fold the decisions log into `SC_REDESIGN_SPEC.md` §13 + a Captain's log entry in the persona doc; update PROJECT_DASHBOARD.

---

## 8. Corrections ledger - retracted claims (do NOT resurface these)

The three-input model caught and killed each of these. Knowing them prevents relitigating:
1. "The SC root never sets data-density" (CC's first audit) - WRONG; root sets `compact`, overlays set `comfortable`. Settled in §13.
2. "SeasonStepper's >=1024 comment is stale, P2 fix" (my claim, briefly committed) - WRONG; it matches its own CSS. Retracted in #314's amend. Two intentional breakpoint switches exist.
3. "The workspace is blocks, not cards" (my visual read) - WRONG; the panels ARE `--surface-card` cards. The gap is treatment (sunken page, 14px radius, raw padding).
4. "DayDetail's group-header accent is off-identity blue" (my visual read) - WRONG; it's `--text-link` = navy-700. Real issue: wrong SEMANTIC token + a left-bar pattern the overview lacks.
5. "Workspace day tiles drop the status colors" (my grid impression) - WRONG; `DaySquare.css` applies identical `--status-*-bg` at sm and lg. Intended color-dominant -> figure-dominant zoom affordance. Not a gap.
6. My #317 spec's navy focus ring - WRONG vs the overview's green; it merged that way. The §7.2 follow-up fixes it post-merge.
7. "DayDetail CSS is a raw-hex mess / materially behind" (early framing) - overstated; its CSS was already largely tokenized. The real debt was the coaching-banner inline hex + a11y + icons. Per the README: "one row's worth of drift."
Also: `ops-sc.css` lives at `src/app/service-calendar/ops-sc.css` (an early audit cited a wrong `ops/css/` path).

---

## 9. Working disciplines (the full contract - follow all of it)

- **Session start:** pull `docs/PROJECT_DASHBOARD.md` from the repo, render a visual state summary, confirm accuracy. **Session end:** update the dashboard to reflect shipped work (in the PR if one exists).
- **Recon before authoring, every time:** fetch + ff-only your clone; main drifts between turns (unrelated OPD PRs merge mid-session). Verify exact strings against current main before any find/replace. Verify data-shape assumptions rather than inheriting them.
- **Delivery:** paste-ready CC prompt files for everything. Find/replace patches with exact old/new strings for surgical edits (1-2 files, few blocks); full file replacements for sprawling changes/new files. CC prompts specify: fresh detached worktree off latest origin/main, own `npm install`, verify with **`npx next build` (NEVER `npm run build`)**, branch name, commit message(s), PR title/body, guardrails, and **"stop before merge - Kevin merges."** If something proves fragile mid-run, CC flags and stops rather than forcing it.
- **Laymen's summary** at the start of every new piece of work: (1) the fix in one sentence, (2) why it matters, (3) why this PR exists, (4) rough size. Skip only for tiny continuations.
- **After every CC prompt, a standing status report:** TLDR laymen bullets - what CC is building now / what's shipped / what's left in this effort / parked cleanups / bigger backlog - ending with a one-line "how close to done."
- **Formatting law:** NO em-dashes anywhere (docs, code comments, PR bodies, commits, chat) - hyphens only; en-dashes for ranges fine; Unicode arrows (->, →) fine; preserve em-dashes only in literal external strings. NO emojis in professional artifacts. Concise bullets, answer-first, scannable; omit extended reasoning unless asked. When Kevin says "tldr," give tight bullets.
- **Recommendation standard:** never let effort/"more work" decide against the better path. Recommend on merits; cite effort only as neutral sequencing info. Kevin decides scope.
- **Design work:** decisions locked before code; renders/mockups before commits; options (three directions per the persona) before build on anything substantial; both viewports; floor-first; every proposal through README §4 + §8.
- **Scope discipline:** honest expert pushback over agreement; but when Kevin pulls scope in (he did - see §12), pull it in cleanly and park the rest. Doc-drift = flag as P2, never silently fix; the repo is canonical.
- **CC/branch hygiene lesson:** after a PR merges, never push more commits to its branch - open a fresh branch/PR (the #315/#316 incident).
- **Visuals from Kevin:** PNGs with descriptive filenames preferred; HTML with embedded screenshots works (extract and VIEW the images - you are multimodal; audit from seeing, then verify impressions against code before asserting).

---

## 10. Gotchas quick list (full detail in `docs/GOTCHAS.md` - read it before debugging)

`npx next build` not `npm run build` · `appendRowSA` must anchor `!A:A` (column-offset bug) · `formatCompactDollar` must be inlined in client components, never imported from opsUtils · `SHEET_IDS.COLLECTION` and `PEOPLE_DB_SHEET_ID` are the same physical sheet · static top-level imports for Node built-ins (`stream`) in API routes · Vercel runs UTC - normalize date comparisons with `setHours` · em-dash in email subjects causes encoding artifacts · ~90 mojibake instances in CSS comment dividers across five CSS files (known backlog) · str_replace whitespace pitfalls · CSS namespace prefixes: `sc-` (SC), `oh-` (Ops Hub), `pp-` (People Portal), `oh-inv-mgmt-` (inventory).

---

## 11. Parked / shelved / out of scope

- **SC parked deliverables:** Admin Dashboard, Fun Money Tracker, Close Day button. Future SC: fee-schedule contract value surfacing on cards.
- **Deferred within the visual phase:** `+`/`-` and `✓` glyph swaps into Icons.js; header-shape (PeriodWorkspace vs PeriodCard); breadcrumb phase-chip happy-path; overview P2 scrim `legendInfoPopup.css:9` (rgba -> token).
- **SHELVED (do not run without Kevin):** the intranet-wide design-conformance scorecard prompt (`CC_PROMPT_intranet_design_conformance_audit.md`). Context: a recon found every other surface is pre-token (raw-hex counts: people.css 357, ops-inv-mgmt.css 832, vs season.css 2) - Kevin explicitly scoped work to **SC only**; the rest of the intranet is working, in use, and becomes separate later-this-year scopes. Do not audit or fix other surfaces.
- **NEVER reference the KPI Dashboard** in any architecture, data-flow, or tooling discussion unless Kevin explicitly reintroduces it. SC and Labor Tool are standalone.
- **Other backlog (not this thread):** SousAI turn-on blocked on index hygiene (40 orphan-indexed docs incl all 12 Retired; prune-on-exclude missing from the embedding pipeline); OPD launch thread; Module 7 Smart Inventory on hold pending STL-MO photo-only capture investigation; Module 8 cron dual-write; custom domain ops.kitchfix.com; URL-driven nav/back-button doc (parked for a quiet week); pay-band table (delivered, parked).

---

## 12. Artifact inventory - where everything lives

**Durable in the repo** (`docs/`): PROJECT_DASHBOARD.md, SC_REDESIGN_SPEC.md (§13!), SC_DESIGN_TOKEN_README.md, DESIGN_TOKENS.md, design-tokens.html, design-tokens-v3.html, DESIGN_REVIEW_PERSONA.md, DESIGN_SYSTEM_REFERENCE.md, DESIGN_PRINCIPLES.md, SC_CONTRACT_BILLING_SUMMARY.md, ACCOUNT_SERVICES_BRIEF.md, SC_PDC_PHASES.md, GOTCHAS.md, HOW_WE_WORK.md, CONVENTIONS.md, ARCHITECTURE.md, and the rest of the docs index.

**Durable via the handoff PRs:** PR #318 (MERGED) committed CC's `docs/HANDOFF_CC.md`, rescued the two previously-untracked CC audits `docs/SC_DRILLIN_ALIGNMENT_AUDIT_CC.md` + `docs/SC_DRILLDOWN_VISUAL_AUDIT_CC.md` (the code-measured parity facts every section grounds in), and stitched the dashboard pointers. The follow-up import PR adds this document (`docs/HANDOFF_CHAT.md`) and seeds the `docs/SC_DRILLDOWN_DECISIONS.md` running log. The chat-side batch artifacts (my visual audit, the merged audit, the all-at-once render) are deliberately NOT migrated - Kevin retired the batch approach; their surviving substance is folded into §7-8 here, and the facts live in CC's committed audits.

**Kevin-side reference visuals** (re-share into the new Project if needed): `service-calendar_design-alignment_v2.html` (9-screen comparison), `service-calendar_views_grid.png` (full-res 3x3 grid).

---

## 13. Voice and collaboration notes

Kevin is direct, fast, and terse; match it. Lead with the answer. He values honest pushback and will take "your plan is weak because X" well; he does not want cheerleading, filler, or being asked to interpret prose instead of receiving a paste-ready prompt. When he shares a CC transcript, verify the branch/diff yourself before endorsing a merge (a branch review caught a factual error I had authored - reviewing your OWN prior claims against the repo is part of the job). Own errors plainly and fix them; the corrections ledger above exists because owned corrections built trust this phase. When he asks "what are we missing," treat it as a real scope pressure-test and put CC on the same question. He merges fast once he trusts the diff - your job is to make every diff trustworthy before it reaches him.

**Your first message in the new Project** should: confirm you have absorbed this handoff (one short paragraph, not a recitation), state the verified current position (#317 state + the phase restarting section-by-section), and ask for exactly two things - the go-ahead on the #317 focus-ring follow-up, and which section Kevin wants first plus its fresh screenshot(s). Then build.

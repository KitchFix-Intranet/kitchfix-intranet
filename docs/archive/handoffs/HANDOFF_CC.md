> **ARCHIVED 2026-07-17** - point-in-time handoff from the 2026-07-02 pre-audit drill-in polish arc. Kept for history; do not use as a live reference. Current SC state lives in `docs/SC_STATUS.md` + the SC design-audit ledger.

# Project Handoff - CC (Claude Code) side

**Audience:** the successor Chat-Claude project + future-me. This is the repo-side ground truth that chat cannot verify from a transcript. Companion: [HANDOFF_CHAT.md](HANDOFF_CHAT.md) (Chat-Claude's narrative handoff; pending import - see §8).

**Written:** 2026-07-02 against `origin/main` HEAD `5addb1b` (Merge PR #316).

---

## 1. Verified state right now

**HEAD I read at:** `5addb1b` - Merge PR #316 (docs/sc-token-readme). The full docs/SC_DESIGN_TOKEN_README.md + docs/design-tokens.html + docs/design-tokens-v3.html + expanded docs/DESIGN_TOKENS.md + docs/SC_REDESIGN_SPEC.md §13 are all on main.

**PR #317 - the SC drill-in objective-alignment bundle:**
- State: **OPEN, not merged.** `gh pr view 317`: `{"state":"OPEN","mergedAt":null,"headRefName":"feat/sc-drillin-alignment","title":"feat(sc): DayDetail drill-in objective alignment (CSS scope-out, tap/focus a11y, coaching tokens, Icons.js, dialog a11y)"}`.
- Five ordered commits, verified from the actual branch (not memory):
  1. `946366f` - `refactor(sc): scope DayDetail CSS out of ops-sc.css into dayDetail.css (no value changes)`. Byte-identical move of 89 `.sc-day-*` rules + `@keyframes scSlide` / `scPop` from `ops-sc.css:159-479` into new `src/app/service-calendar/dayDetail.css`. Imported from `page.js` alongside `ops-sc.css`.
  2. `f42d223` - `fix(sc): 44px mobile tap targets + token focus rings in DayDetail (a11y)`. Mobile 40→44px on `.sc-day-nav-btn` / `.sc-day-close`; base `.sc-btn` mobile min-height 44px. Eight `:focus-visible` rules using `--focus-ring-width / -color / -offset`.
  3. `8035815` - `fix(sc): coaching banners consume status tokens via modifier classes`. 12 raw hex tuples deleted; new `.sc-day-coaching--{neutral/entered/needs/overdue}` modifiers backed by `--status-*` family. Bulk overlay's inline hex in `ServiceCalendar.js:1065` swapped to `--neutral`.
  4. `b276b36` - `feat(sc): local Icons.js (concept map + mechanical glyphs)`. NEW `src/app/service-calendar/Icons.js` - not Lucide, hand-rolled inline SVGs, stroke 1.75, sized via `--icon-sm/-md/-lg`. Exports `X` `ChevronLeft` `ChevronRight` + the 10 §13.1 concept glyphs. Adopted in DayDetail nav + close + bulk close.
  5. `364d749` - `feat(sc): dialog a11y on SC overlays`. `role="dialog"` + `aria-modal` + `aria-labelledby` on both `.sc-overlay-card` wrappers. New `src/app/service-calendar/useDialogA11y.js` handles Escape + focus-in + return-focus + Tab-trap. Mirrors the `LegendInfoPopup` pattern.

**Other open PRs** (`gh pr list --state open`):
- `#317` - our current work (above).
- `#267` - `sc redesign stage 1: season shell + calendar grid` (2026-06-25, **stale** - superseded by merged stages 0-6).
- `#250` - `sc admin css: sweep dead hero/title/scaffold rules` (2026-06-23, **stale** - untouched, likely to be closed).

**Worktree inventory:** `git worktree list` returns **~130 worktrees**. Most are stale. Actively-relevant ones as of this session:
- `kitchfix-intranet` (main clone, on `main` at `2c7e89b` - **behind origin/main by many commits**; not fetched inside the clone itself).
- `kf-drillin-align` (branch `feat/sc-drillin-alignment` at `364d749` = PR #317 tip).
- `kf-handoff` (this doc-only branch).
- `kf-drillin-audit` + `kf-parity-audit` (detached HEADs, held only for the untracked audit files - now rescued in this PR).

**Prune recommendations (Kevin only - do NOT prune from CC):**
- After #317 merges and its worktree is clean: prune `kf-drillin-align`.
- After this handoff PR merges: prune `kf-handoff`, `kf-drillin-audit`, `kf-parity-audit`.
- The `kitchfix-*` worktrees from earlier SC stages (`kitchfix-sc-*`, `kitchfix-opd-*`) are safe to prune - all have been merged or superseded. Keep any Kevin still wants as reference.
- Rough rule: any worktree whose branch matches a merged PR from §2 can be pruned.

---

## 2. PR ledger #251 -> #316 (current merged trail)

The compact effort log. Read the message body via `gh pr view N` if the summary isn't enough.

| PR | Title | What changed (one line) |
|---|---|---|
| #316 | SC token README + v3 narrative import (follow-up to #315) | New `SC_DESIGN_TOKEN_README.md` + `design-tokens-v3.html` |
| #315 | visual token guide + SC design source-of-truth aligned | New `design-tokens.html` + expanded `DESIGN_TOKENS.md` |
| #314 | working base - dashboard + drill-in alignment spec + Lucide drift fix | `PROJECT_DASHBOARD.md` refresh + `DESIGN_SYSTEM_REFERENCE.md` Lucide fix + `SC_REDESIGN_SPEC.md` §13 |
| #313 | tokenize PeriodWorkspace colors + remove DayDetail dead constants | Progress/delta hex → tokens; dead `GREEN/RED/AMBER` deleted |
| #312 | record confirmed FL phase calendars (TBJ-FL + STL-FL) | `PER_ACCOUNT_2026` null entries filled; `SC_PDC_PHASES.md` flipped to CONFIRMED |
| #311 | OPD Leadership OS (PB-001) Phase 1 | OPD content refactor - out of SC scope but co-merged |
| #310 | fix off-season month cards not showing phase label | Reorder off-state branch above `!monthSummary` guard |
| #309 | unified bottom phase labels (figures win) | Every month + period card gets one always-populated bottom line |
| #308 | OPD Culinary OS (PB-006) - culinary handbook | OPD content |
| #307 | sc season-view polish closeout (bundle) | Legend copy + band + MiLB header rename + bare-strip gradient |
| #306 | season summary card: harmonize typography + chrome | FullSeasonCard type + chrome onto period-card system |
| #305 | mlb phase labels: month + period cards | New `mlbSeasonPhase.js` helper + card labels |
| #304 | stepper render 2: segmented season bar | SeasonStepper redesign (dot rail → bar) |
| #303 | OPD Culture OS (PB-014) | OPD content |
| #302 | hotfix: period param numeric | Drilling was a no-op; period URL param typing fix |
| #301 | off-season flat-grey + legend trim + period-tile consistency | Season landing polish |
| #300 | URL-driven navigation | Browser back / forward works across SC views |
| #299 | elevated card for the season landing | Chrome top band + legend bottom band |
| #298 | match calendar day squares to period + align P# label size | Cell parity between calendar & period grids |
| #297 | fold action band into chrome bar (CTA redesign) | Urgency counts moved from InfoCard into `ChromeBar` |
| #296 | housekeeping: tokenize info-blue, prune dead CSS, guard today helper | Cleanup |
| #295 | four polish items | Landing polish |
| #294 | whole-card drill + scope equal-heights to desktop | MonthCard interaction |
| #293 | three month-card cleanups | Upcoming text + off-season tiles + equal heights |
| #292 | chrome bar one row | AsOf pill relocated |
| #291 | redesign bundle 2: phase timeline | `PhaseStrip.js` + `phaseDerivation.js` + `phaseCalendar.js` |
| #290 | bundle 1 follow-up: off-season expanded body placeholder | |
| #289 | redesign bundle 1: season landing | 9 changes A-E |
| #288 | redesign 1a: admin entry → hero corner lock | |
| #287 | today: client sends its local date to the read path | Timezone fix |
| #286-282 | token conformance PR2a-2e | SC surface migrated onto semantic tokens + `--accent-sc` family added to `tokens.css` |
| #281 | design tokens pr1: foundation | Additive `tokens.css` scaffold, zero visual change |
| #280 | monthcard header semantics + mobile legend key | |
| #279 | mobile overhaul + compact hero (site-wide) + 3 live bugs | |
| #278 | design batch 3 | stepper + phase strip rebuild + season summary + period card cleanup |
| #277 | design batch 2 | top-section restructure - chrome + hero + info card + legend popup |
| #276 | design batch 1 | atom state encoding + legend |
| #275 | fix homestand opponent blank on period-spans-month boundary | |
| #274 | redesign stage 6: dead-code removal | HELD for review |
| #273 | stage 5: polymorphism hardening | MiLB day-tile $ drop fix |
| #272 | activate role-based landing | The scoped engine touch |
| #271 | stage 4: drill wiring + intent landing + mobile + motion | |
| #270 | stages 1-3: recovery merge (season shell + period view + workspace) | |
| #269 | stage 3: period workspace | The drill target (`PeriodWorkspace.js` born) |
| #268 | stage 2: real strip + period grid + full season card | |
| #266 | stage 0: day-square atom + state gallery | `DaySquare.js` + `DaySquare.css` born |
| #265 | commit redesign spec + pre-build scope audit | `SC_REDESIGN_SPEC.md` + `SC_REDESIGN_AUDIT.md` born |
| #264 | period: fix react #310 on period view (b2b hotfix) | |
| #263 | period: directional slide, keyboard nav, idle prefetch, save-anim | |
| #262 | period lens surface (b2a, view c core) | `PeriodLensView` (later replaced by `PeriodWorkspace`) |
| #261-259 | lens-bar polish + rename + de-hack | Cleanup |
| #258 | state-machine: rename viewMode to (scope, lens, isAdminView) | |
| #257 | revenue-engine pricing fix: `price_kind` split + contracted-rate backfill | |
| #256-251 | entry polish, css sweeps, docs, PAF equipment (people module) | |

Everything above is on `main`. Everything from #317 onward is not.

---

## 3. SC file map (line counts + role; * = will be touched by the visual-parity phase)

```
src/app/service-calendar/
├── page.js                              121 - route entry; imports ops-sc.css + (post-#317) dayDetail.css
├── ServiceCalendar.js                  1107 * - orchestrator; overlay wiring, PR-#317 dialog-a11y hooks live here
├── DayDetail.js                         483 * - the single-day entry panel; drill-in target
├── DaySquare.js                         339 - the day atom; SHARED cross-scope, don't touch
├── DaySquare.css                        290 - atom styles; tokenized
├── ops-sc.css                           733 * - SC shared CSS; post-#317 shrinks by 321 lines (DayDetail move); residual .sc-btn + admin bits stay
├── dayResolvers.js                      114 - day-status + day-kind helpers
├── computeInitialView.js                144 - initial view logic
├── useAnimatedNumber.js                  68 - animation hook
├── admin/
│   ├── AdminPanel.js                     55
│   ├── AccountsOverview.js              174
│   ├── AccountEditor.js                 528
│   ├── FeeAccountEditor.js              196
│   ├── PriceEditPanel.js                285
│   ├── FeeEditPanel.js                  256
│   ├── ArchiveServicePanel.js           196
│   ├── ArchiveGroupPanel.js             203
│   ├── ReactivatePanel.js                95
│   ├── AddServicePanel.js               152
│   ├── AddGroupPanel.js                 105
│   ├── ops-sc-admin.css                 843
│   └── page.js                           27
└── season/
    ├── SeasonShell.js                   270 - top-level shell for the season landing
    ├── ChromeBar.js                     270 - unified chrome bar
    ├── PhaseStrip.js                    225 - the phase strip / MiLB bare-rail
    ├── SeasonStepper.js                 182 - homestand tracker (segmented bar, render 2)
    ├── MonthCard.js                     488 - calendar-view month card
    ├── PeriodCard.js                    358 - period-view period card
    ├── FullSeasonCard.js                181 - year summary card
    ├── PeriodWorkspace.js               849 * - drill-in period workspace; visual-parity target
    ├── StateLegend.js                   121 - always-visible day-cell key
    ├── LegendInfoPopup.js               231 - popup: verbose account-aware legend
    ├── StickyContext.js                 114 - narrow-viewport sticky context
    ├── phaseCalendar.js                 188 - canonical phases + PER_ACCOUNT_2026 recorded data
    ├── phaseDerivation.js               218 - shared spine: derivePhaseTimeline etc.
    ├── homestandDerivation.js           144 - homestand segments / focus picker
    ├── mlbSeasonPhase.js                 57 - MLB month/period phase-label helpers
    ├── season.css                       951 - season-landing styles
    ├── chromeBar.css                    230
    ├── seasonStepper.css                194
    ├── periodWorkspace.css              802 * - drill-in workspace styles; visual-parity target
    ├── stateLegend.css                  226
    ├── legendInfoPopup.css              141
    └── stickyContext.css                 83
```

Post-#317 additions to this map (currently on the open branch):
- `src/app/service-calendar/dayDetail.css` (330 lines).
- `src/app/service-calendar/Icons.js` (133 lines).
- `src/app/service-calendar/useDialogA11y.js` (109 lines).

**Files the visual-parity phase (chat-Claude's next round) will touch, marked with `*` above:** `PeriodWorkspace.js`, `periodWorkspace.css`, `DayDetail.js`, `dayDetail.css` (post-#317), `ops-sc.css` residue, `Icons.js` (post-#317), `ServiceCalendar.js` overlay block.

---

## 4. docs/ index (what's canonical, what's known-drift)

Key SC + design docs. Reliability tag: ★ canonical / ~ living / ! drift flagged.

- ★ [`tokens.css`](../src/app/tokens.css) - code truth. If any doc disagrees, this wins.
- ★ [`DESIGN_TOKENS.md`](DESIGN_TOKENS.md) - the rules doc (two-tier, semantic-only). Expanded #315 with `--accent-sc*` family + visual-guide pointers.
- ★ [`design-tokens.html`](design-tokens.html) - current visual INVENTORY (self-contained). Regenerate `:root` block from `tokens.css` when tokens change.
- ★ [`design-tokens-v3.html`](design-tokens-v3.html) - design-system NARRATIVE (architecture, WCAG contrast report, icon vocabulary, states). Predates `--accent-sc*` family. Use both together (per README).
- ★ [`SC_DESIGN_TOKEN_README.md`](SC_DESIGN_TOKEN_README.md) - the SC-specific token bible for chat-Claude. Alignment rules table + per-surface consumption + pre-flight checklist + Claude/Kevin decision split.
- ★ [`SC_REDESIGN_SPEC.md`](SC_REDESIGN_SPEC.md) - the redesign north star. §13 covers drill-in alignment.
- ★ [`SC_DRILLIN_ALIGNMENT_AUDIT_CC.md`](SC_DRILLIN_ALIGNMENT_AUDIT_CC.md) - **RESCUED into repo this PR** (was untracked in `kf-drillin-audit/`). CC's audit of the drill-in vs overview from HEAD `ecb2d42` era. Density claim was superseded (SC root actually DOES set `data-density="compact"`; §13.1 of the spec captures the correction).
- ★ [`SC_DRILLDOWN_VISUAL_AUDIT_CC.md`](SC_DRILLDOWN_VISUAL_AUDIT_CC.md) - **RESCUED into repo this PR** (was untracked in `kf-parity-audit/`). CC's 9-axis per-property parity audit of drilldown vs overview at HEAD `5addb1b`. This is the code-measured input to the visual-parity phase.
- ★ [`SC_PDC_PHASES.md`](SC_PDC_PHASES.md) - canonical PDC phase catalog. Post-#312 all 5 PDCs have confirmed calendars in `PER_ACCOUNT_2026`.
- ★ [`SC_REDESIGN_AUDIT.md`](SC_REDESIGN_AUDIT.md) - pre-build scope audit (from #265). Still useful for the "why" behind stages 0-6.
- ~ [`DESIGN_SYSTEM_REFERENCE.md`](DESIGN_SYSTEM_REFERENCE.md) - system reference. Lucide-install claim corrected #314. Density-mode assignments load-bearing.
- ~ [`DESIGN_PRINCIPLES.md`](DESIGN_PRINCIPLES.md) - the philosophy (floor-first, Four Gates, tokens-are-law).
- ~ [`DESIGN_REVIEW_PERSONA.md`](DESIGN_REVIEW_PERSONA.md) - review lens + severity framework + artifact format.
- ~ [`PROJECT_DASHBOARD.md`](PROJECT_DASHBOARD.md) - current-state orientation. Refreshed #314. Stitched this PR to point at both handoffs.
- ~ [`SC_LENS_VISION.md`](SC_LENS_VISION.md) - the lens strategy; predates the redesign but still ground for the drill-in.
- ~ [`SC_CONTRACT_BILLING_SUMMARY.md`](SC_CONTRACT_BILLING_SUMMARY.md) - the contract bible.
- ~ [`SC_BILLING_MODEL_AUDIT.md`](SC_BILLING_MODEL_AUDIT.md) - billing-model audit.
- ~ [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md) - post-migration-project state.
- ~ [`GOTCHAS.md`](GOTCHAS.md) - read before debugging anything that smells familiar.
- ~ [`ENV_VARS.md`](ENV_VARS.md) - env var names (never values).

Not drifted, just noting for chat-Claude's map: `SC_ADMIN_RECON_REPORT.md`, `SC_ADMIN_STAGE2_RECON.md`, `SC_BUNDLE1_RECON.md`, `SC_CC_HANDOFF.md`, `SC_KPI_PUSH_CONTRACT.md`, `SC_PRICE_COMPARISON.md`, `SC_SPREADSHEET_MAPPING.md` all still relevant to their respective threads.

---

## 5. How I (CC) work with Kevin

Distilled from ~66 PRs of collaboration this thread:

- **Worktree pattern.** Every task starts with a fresh worktree: `git -C ~/dev/kitchfix-intranet fetch origin && git -C ~/dev/kitchfix-intranet worktree add -b <branch> ~/dev/kf-<slug> origin/main`. Detached (`--detach ... origin/main`) for read-only audits. This gives clean isolation and reproducible builds.
- **`npm install` per worktree.** Vercel needs deps at build time; local dev needs them too. Deps are per-worktree, not shared.
- **`npx next build`, not `npm run build`.** House rule Kevin drilled in - `next build` is the direct path; `npm run build` sometimes drifts through package.json scripts and can mask errors.
- **I stop before every merge.** Every PR ends with "Do not merge - Kevin merges." No exceptions. Kevin deploys → screenshots → decides.
- **The #315/#316 lesson: never push to a merged PR's branch.** When a PR merges, its branch ref still exists on the remote; my subsequent pushes go there but are orphaned from main. If more work follows a merge, open a NEW PR from a NEW branch. #316 fixed this after I initially pushed the v3 import + README onto `docs/sc-token-alignment` post-#315.
- **Verify strings before find/replace.** Any find/replace edit gets its target grepped in the current worktree first (`grep -n "exact substring" <file>`). Match-count = 0 or 2+ means I stop and report, not force.
- **Flag and stop on fragile bits.** When Kevin's prompt calls out a fragile item ("if the focus-trap gets fiddly, land the rest and flag it as a fast-follow"), I honor the escape hatch. Doesn't ship shaky code.
- **No em-dashes.** Saved-preference across every commit message, doc, PR body, and comment. Hyphens (`-`) only.
- **Danger zones honored.** `sheets.js`, `cutover.js`, `dataStore/*.js`, `auth.js`, `middleware.js`, `vercel.json`, `next.config.mjs`, `package.json`, `docs/migrations/*.sql`, anything matching `.env*` - I don't touch without explicit approval.
- **Permissions.** No `--dangerously-skip-permissions` was ever active in this thread. Each tool use goes through the harness permission model.
- **Multi-step tasks get an ordered PR.** When a task has natural sequencing (e.g. "scope-out first, then tokenize"), I commit in that order so each step reads clean in the diff. Not a monolithic commit.

---

## 6. How to write prompts that land first-try

The prompts Kevin sends me are engineered by Chat-Claude. The ones that land in one pass share these traits:

- **Exact find/replace substrings verified against current `origin/main`.** Not "roughly the block starting at line ~340" - the actual verbatim text. When it drifts, I grep and adapt minimally + note the drift.
- **Explicit branch name + PR title.** Removes one decision point.
- **Ordered commits when relocation must be isolated.** The #317 spec is the model: five ordered commits, each with a stop-if-fragile escape hatch on the last one.
- **Explicit guardrails.** "Only these edits. No CSS. No other files. No merge." I honor the perimeter.
- **Verify commands built in.** Greps + build steps I run at each phase to prove the state before continuing.
- **"Flag and stop" for fragile items.** The prompt should name the specific fragility (focus-trap edge cases, deep-CSS assumptions) and permit a partial land + fast-follow.
- **Line numbers or grep anchors where CSS/JS is fluid.** Line numbers drift across PRs. Grep anchors (`grep -n "^\.sc-day-close"`) don't.
- **Reference the current state precisely.** If a bundle is unmerged, the prompt should measure the pre-bundle world, not the future one. This is why my HANDOFF checked #317 state at the top of §1.

Prompt anti-patterns that cost passes:
- "Move roughly the section ~500-600" without verified boundaries.
- "The token X should be added" when X already exists.
- Requesting a bulk edit without confirming find-strings against main first.
- Missing "stop before merge" on a code PR.

---

## 7. Environment facts

- **Deploy pipeline.** Vercel Pro. Every merge to `main` auto-deploys production. There is no staging.
- **Runtime:** Next.js 16 / React 19. Turbopack default via `next dev`. Vercel runs UTC.
- **Backend:** Sheets + PG dual layer. Six modules cut over to PG with dual-write; SC still reads/writes Sheets for now. Migration project CLOSED 2026-06-12 (see `MIGRATION_PROJECT_CLOSEOUT.md`).
- **Crons:** Vercel cron for daily backup + incident reminders; Railway inventory cron parked (Module 8 rewrite pending).
- **Env vars:** names live in [`docs/ENV_VARS.md`](ENV_VARS.md); values in Vercel + Railway dashboards. **Never read, write, or echo `.env*` files.**
- **CLAUDE.md house rules** (loaded per run):
  - Production is main; every merge deploys.
  - Branch-and-PR for everything; no direct commits to main.
  - Floor-first: 375px viewport is the gate.
  - Danger zones (see §5).
  - Tests-first is aspirational; manual Vercel-preview verification while the Playwright suite is being built.
  - "Migrations don't auto-apply" - `docs/migrations/*.sql` are applied manually in Supabase Studio.
  - Side project isolation: never reference `~/Holtburg/holtburg-hollow/`.
  - Communication: direct, concise, terse lowercase commit messages, honest pushback.
- **Tests:** Playwright suite is the required check on PRs (main branch protected). CI runs against the prod URL, so a green check ≠ PR code works - it means prod is up (documented separately). Local `npx next build` is the pre-PR gate for me.

---

## 8. Open threads from my side

- **PR #317 pending: focus-ring color amend.** Per §4 of `SC_DESIGN_TOKEN_README.md` and per the parity audit (`SC_DRILLDOWN_VISUAL_AUDIT_CC.md` Axis 8), the overview uses `outline: ... var(--accent-sc)` for focus rings on interactive cards + toggles. #317 currently ships navy focus rings via `--focus-ring-color`. **Before merge**, expect a small amend swapping the eight new `:focus-visible` rules from `var(--focus-ring-color)` to `var(--accent-sc)` to match the overview vocabulary. Kevin has this queued; I'll execute when the prompt lands.
- **Kevin-supplied handoff artifacts not present at expected location.** This PR was to import `SC_PROJECT_HANDOFF_CHAT.md`, `SC_DRILLDOWN_VISUAL_AUDIT_CHAT.md`, `SC_DRILLDOWN_MERGED_AUDIT.md`, and `sc-drilldown-audit-applied.html` from `~/Downloads/`. None were present at PR time (checked via `find ~/Downloads ~/Documents -maxdepth 3` + `~/Downloads/files (1).zip` contents). Kevin: drop them in `~/Downloads/` and prompt me for a follow-up PR to import them and finalize the pointer-stitching in `PROJECT_DASHBOARD.md` + `HANDOFF_CHAT.md`.
- **Two audit docs rescued in this PR** (see §4).
- **Stale open PRs #267 + #250** - neither has moved in a week+. Kevin's call to close them.
- **Massive worktree list** - ~130 worktrees in `~/dev/`. Most map to merged PRs and can be pruned. See prune recommendations in §1.
- **Chat-Claude side is migrating** to a new claude.ai project (100-file limit on the old). This handoff pair ([HANDOFF_CHAT.md](HANDOFF_CHAT.md) - pending import, [HANDOFF_CC.md](HANDOFF_CC.md) - this file) is the durable bridge.

---

## 9. Blind-spot note

Things worth knowing that the prompt didn't ask about:

- **The "chat side vs code side" split is somewhat artificial.** Chat-Claude designs; I execute. But we've drifted into hybrid work - I write audits (which are design measurement), and chat writes prompts (which are code specification). If a successor chat is more or less capable at either half, we can swap roles. The split reflects tool access, not fundamental role - I have `Bash` + `Edit` + `Read` + `Write` + `gh`; chat has more model iteration cycles + memory.
- **`tokens.css` is the code truth.** The two HTML guides + `SC_DESIGN_TOKEN_README.md` are lookups. If they drift from `tokens.css`, `tokens.css` wins. Regenerate the guides by copying the `:root` block. I never rely on the guides as source of truth.
- **`ops-sc.css` is a shared danger zone.** It carries the SC-shared button system, overlay chrome, account-context chrome, admin bits. Post-#317 it shrinks by 321 lines (DayDetail move) but still holds `.sc-btn*` + `.sc-overlay-*` + admin styles. Touching it ripples across the admin + drilldown + landing. The visual-parity phase will be tempted to keep moving stuff out; each move is a chance to break the admin's mental model.
- **`data-density` inheritance is subtle.** SC root sets `data-density="compact"`; DayDetail + bulk overlays override to `"comfortable"`. The workspace inherits Compact from the root. If a component uses raw `--space-N` primitives instead of the density-aware semantic aliases (`--space-stack / -card-pad / -inline / --control-height / --row-height / --cell-size`), the density remap doesn't reach it. The parity audit flagged the workspace Financial Frame + Day Grid Wrap raw-px padding as this drift.
- **The v3 icon concept map exists but isn't fully adopted.** #317 introduces `Icons.js` with 13 glyphs (3 mechanical + 10 concept). Only 3 are used in DayDetail today (X, ChevronLeft, ChevronRight). The remaining 10 are ready for adoption elsewhere in the SC surface (chrome refresh, admin lock, revenue $ sign, homestand-focus arrow, etc.).
- **The audit corpus is heavy.** Between the CC audits, chat audits, and the design-review artifacts, chat-Claude will need to prune what's still load-bearing from what's historical. `SC_DRILLIN_ALIGNMENT_AUDIT_CC.md` is the older audit (from HEAD `ecb2d42`); its density claim was superseded (see §4). `SC_DRILLDOWN_VISUAL_AUDIT_CC.md` is the current parity map. When a claim in the older audit disagrees with the code, the code wins.
- **The prompt-execution loop has a tell.** When Kevin sends a well-engineered prompt in the shape of §6, I land it in one pass with a merge-ready PR. When the prompt is fuzzy, I bounce back with clarifying reads before committing. The rate at which we're merging PRs (~10-15 SC-side PRs a day at peak) reflects prompt quality, not just token throughput. Chat-Claude: this is your quality signal.

---

**End.** See [HANDOFF_CHAT.md](HANDOFF_CHAT.md) for the complementary chat-side handoff (pending import - drop in `~/Downloads/SC_PROJECT_HANDOFF_CHAT.md` and prompt me for the follow-up PR).

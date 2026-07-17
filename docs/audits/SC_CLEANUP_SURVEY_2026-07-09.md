# SC cleanup-phase survey (2026-07-09)

Read-only. `src-backup/` ignored throughout. Line refs are `origin/main @ 1ed1bee` (post-#369).

---

## A - Duplication census

### A1. `MonthCard.js` vs `PeriodCard.js` (SC-032/035 anchor)

- **Files:** `season/MonthCard.js` (502 lines) + `season/PeriodCard.js` (362 lines).
- **Identical unique lines:** 43 (~8.6% of the larger file). The pair is NOT the "60% duplicate" the ledger row estimates - the visible-structure overlap is genuine (both render the same `sc-daysq-*` atom into a grid, both compute a footer figure, both use a phase-tint header) but at code level, they diverge sharply: different props shape (`monthIndex` vs `periodRange`), different day-cell derivation, different phase mapping (`mlbMonthPhaseLabel` vs `mlbPeriodPhaseLabel` + `derivePeriodPhase` + `humanAnchor` + `CANONICAL_PHASES`), MonthCard carries the desktop-force-expanded logic PeriodCard does not.
- **What differs:** MonthCard iterates 6 weeks x 7 days over a Gregorian calendar month; PeriodCard iterates 4 weeks x 7 days over a fiscal-period range. MonthCard has the mobile accordion; PeriodCard forces expanded. MonthCard reads `monthSummary` (year-summary rollup); PeriodCard reads `periodRange` + a synthesized week grid.
- **Estimated consolidation size:** **L** (extract shared `<CardShell>` + `<DayGrid>` primitives, thread rendering through per-scope adapters).
- **Risk:** medium. Both cards are on the year-overview surface; a regression is visible on landing. Owner ruling needed on whether to unify or leave as canonical parallel implementations (each is legible standalone).

### A2. ProgressBar / bar-fill implementations

Five distinct progress-bar renders on the SC surface:

| # | Site | Class | Note |
|---|---|---|---|
| 1 | `PeriodWorkspace.js:433-439` | `ProgressLine` component + `.sc-workspace-progress-bar` + `.sc-workspace-progress-bar-fill` | Used twice inside PeriodWorkspace at `:308` + `:395` |
| 2 | `MonthCard.js:414` | `.sc-season-month-card-bar-fill` + `--complete` variant | Inline JSX, per-card |
| 3 | `PeriodCard.js:238` | `.sc-season-period-card-bar-fill` + `--complete` variant | Inline JSX, per-card |
| 4 | `FullSeasonCard.js:163` | `.sc-season-fullseason-bar-fill` + `--complete` variant | Inline JSX, capstone |
| 5 | `SubmissionToast.js:66-67` | `.sc-toast-recorded__bar` + `.sc-toast-recorded__bar-fill` | Toast animation - visually distinct (fill animates from 0), keep separate |

- **Estimated consolidation size:** **M** (extract `<ProgressBar variant="line|card|fullseason">` accepting `pct`, `--complete` state, plus a `color` prop for the fill). Toast bar stays out.
- **Risk:** low. Three of four inline sites share the same shape; the fourth (`ProgressLine`) is already a component.
- **CSS note:** each of the four `--bar-fill` classes has its own declaration block in a different CSS file (season.css / periodWorkspace.css / submissionToast.css). Consolidating the JSX shape without consolidating the CSS declarations halves the win.

### A3. Sun/moon SVGs (SC-035 sibling)

Three declaration sites, all sharing `viewBox="0 0 24 24"` and the same circle-plus-rays shape but at different pixel sizes:

| # | Site | Sizes | Purpose |
|---|---|---|---|
| 1 | `DaySquare.js:354-395` (`MilbPill`) | 12x12 | On-tile day/night glyph |
| 2 | `StateLegend.js:113 + 132` | 10x10 | Legend chip sun/moon |
| 3 | `LegendInfoPopup.js:255 + 269` | 12x12 | Popup detail sun/moon |

- **Estimated consolidation size:** **S** (extract `<SunGlyph size={n} />` + `<MoonGlyph size={n} />` into `season/glyphs.js` or `Icons.js`; three call sites re-import).
- **Risk:** low. Pure visual constant.

### A4. `StateLegend` vs `LegendInfoPopup` overlap

- **Files:** `season/StateLegend.js` (143 lines) + `season/LegendInfoPopup.js` (282 lines).
- **What they share:** the state-modality vocabulary (entered / needs-entry / overdue / upcoming / off / milb-day / milb-night) and the same `mod` -> visual mapping (swatch class + optional icon). StateLegend lists 18 mod references across the account-shape branches; LegendInfoPopup enumerates the same set at 12 popup rows plus richer copy.
- **What differs:** LegendInfoPopup is verbose (a11y-labeled `<Row>` primitive + descriptions per row) while StateLegend is the one-line always-visible strip. Different visual weight is intentional.
- **Estimated consolidation size:** **M** (extract a shared `LEGEND_ITEMS[accountShape]` table with `mod / icon / label / description`; StateLegend renders labels only, LegendInfoPopup renders descriptions too, sun/moon glyphs come from the A3 extraction).
- **Risk:** low. Same account-shape branches on both sides; a shared table is defensively symmetric.

### A5. Utility duplicates (post-#362 stragglers)

`#362` intended to consolidate `fmt$` in `season/format.js`. Remaining local defs:

| Site | Def | Same as shared? | Reason kept |
|---|---|---|---|
| `season/format.js:9` | `fmt$(n, { decimals })` | canonical | shared util (three legitimate consumers now: DayDetail, ServiceCalendar bulk review, SubmissionToast) |
| `DaySquare.js:42` | `fmt$` with K/M compaction | **NO** - functionally different (compacts for sm tiles) | legitimate divergence - tile size can't fit `$1,234` |
| `DaySquare.js:48` | `fmtMeals(n)` | n/a | one-liner; probably absorb into an atom-scoped util file |
| `PeriodWorkspace.js:37` | plain `fmt$` (no K/M, no decimals option) | **YES** - subset of shared | straggler; should import shared |
| `MonthCard.js:497` | `fmtK(n)` | **identical to `DaySquare.js:42`** | dupe; DaySquare's or a shared `fmt$K` should win |
| `DayDetail.js:9` | `fmtPrice(n)` (`$X.XX` with `.00` trim) | different shape (2dp + trim) | one call site inside DayDetail; local is defensible |
| `ServiceCalendar.js:1767 + 1880` | `fmtDateShort(iso)` (twice, IIFE-local, identical) | n/a | **same-file dupe** - one file, two IIFEs, same helper written twice |

- **Findings that survived #362:** `PeriodWorkspace fmt$` should import the shared. `MonthCard fmtK` is line-for-line identical to `DaySquare fmt$` (K/M-compacting variant) - one of them should win.
- **Estimated consolidation size:** **S** (extend `season/format.js` with `fmt$K` for compact + `fmtMeals` + `fmtDateShort`; three-to-four call-site swaps).
- **Risk:** low.

### A6. CSS repeated declaration blocks

Grep-driven inventory (not exhaustive):

- **Hover-lift + press pattern:** `transform: translateY(-1px)` appears in **8** rules; `transform: translateY(1px)` (pressed) appears in **21** rules. The pattern (F3 elevation family per #366) is spread across `dayDetail.css`, `periodWorkspace.css`, `season.css`. Prime consolidation target - `.sc-card--tactile` mixin or a series of `--elevation-lift-*` custom-property blocks.
- **`prefers-reduced-motion` blocks:** **35** occurrences. Every card / expander / pill implementation carries its own reduced-motion pair. Consolidation would centralize the reduced-motion cascade (`.sc-motion-safe` scope) but is high-touch.
- **`--complete` variant on bar-fill classes:** 4 sites (see A2), each with its own `--complete` selector and its own hardcoded green.
- **Category chips (`.sc-cat--pdc/mlb/milb`)** at `ops-sc.css:137-139` are raw hex (`#eff6ff / #1e40af / #cffafe / #155e75`) - only untokenized palette in ops-sc.css that isn't inside a `FLAG:` comment.
- **SubmissionToast raw hex** at `submissionToast.css:29, 45, 49, 78, 119, 124` (`#fff`, gradient stops `#B45309/#7C2D12`, `#7FD3B4`, `#FBBF24`) - flagged in-file: `"FLAG: mint (bar fill) + amber (milestone) accents are literals here pending a tokenization pass"`.
- **Estimated consolidation size:** hover/press = **M**; reduced-motion consolidation = **L**; raw-hex tokenization = **S** (per accent, requires new tokens if none map).
- **Risk:** low for tokenization; medium for hover-lift consolidation (a mixin regression could visibly disable lift on some element).

### A7. Unused CSS selectors

Not doing a full pass here (a real dead-CSS sweep needs a PurgeCSS-style walk). Two obvious candidates surfaced during the audit arc:

- `.sc-day-row-delta--minor` + `.sc-day-row-delta--big` in `dayDetail.css:302, 305` - retained as "legacy classes preserved so any external stylesheet override does not silently break; unused by the current renderer" per the #365 commit. Genuinely unused; keeping them cost <10 CSS lines.
- Any `.sc-day-notes-input::placeholder` styling that now applies to the DRAFT textarea (SC-079's rename) versus the pre-#367 persistent-note textarea - need a diff walk. Likely OK; flagging as a sanity spot-check for the cleanup phase.
- **Estimated consolidation size:** unknown without a real sweep. **M** for a proper dead-CSS pass with PurgeCSS on the SC bundle.
- **Risk:** low. Deleting CSS never breaks JSX; visual regressions surface immediately on preview.

---

## B - Dead code census

### B1. `MonthCard.js:497` `fmtK` "dead branch"

The Section-1 candidate flagged `fmtK` as a "dead branch." Verifying:

- `fmtK` is **called** at `MonthCard.js:251 + 401` (twice). The FUNCTION is not dead.
- The `$M` branch inside `fmtK` (`v >= 1_000_000`) is functionally unreachable on month-card revenue displays: the largest single-account monthly meal revenue on file is CIN-AZ ST (~$100K-class), full-year is ~$400K. STL-FL's $1.4M is contract-fee revenue and doesn't flow through the month-card display path.
- **So the "dead branch" is the `$M` return inside `fmtK`.** Two lines of code. Safe to remove OR leave defensively (the `>= 1_000_000` guard costs nothing at runtime and covers a hypothetical multi-account rollup future).
- **Size:** **S**. **Risk:** low. Recommend: leave, note in the same GOTCHAS/ARCHITECTURE explanation of the money architecture.

### B2. `dayNotes` dead read at `dataStore/serviceCalendar.js:722`

After #367 (SC-079 notes ledger), `route.js:transformDays` returns `noteEntries` per day, **not** `dayNotes`. But the orchestrator's day-bucket at `dataStore/serviceCalendar.js:722` still reads `dayNotes: r.day_notes || null` from the view. That field is populated on the internal day object, then dropped by `transformDays` (nothing consumes it downstream).

- **Confirmation:** grep shows exactly zero readers of `d.dayNotes` in `route.js` post-#367 (the only match on `dayNotes` in route.js are comments referencing the pre-#367 field). Client also does not consume it.
- **Size:** **S** (one-line delete + comment update; net -1 line).
- **Risk:** low. Also aligns with the "sc_day_metadata.day_notes dormant" candidate in the Round 3 register.

### B3. `deleted_at` reads

The candidate register calls `deleted_at` "documented dormant." Verifying that against actual reads:

- `deleted_at` is FILTERED (`.is("deleted_at", null)`) at 9 sites in `dataStore/serviceCalendar.js` and 1 in `route.js:126`. Every SC catalog read excludes rows where `deleted_at IS NOT NULL`.
- **`deleted_at` is not read.** Filter-only. There is no code path that WRITES `deleted_at` today (archive uses `active_until` per sc-6c).
- **Interpretation:** `deleted_at` is defensively filtered against a column that nothing populates. This is not dead code - it's a safety filter for a future hard-delete escape hatch. **Keep**. Worth noting in ARCHITECTURE.md: "sc_services.deleted_at is a reserved hard-delete field; live archive is `active_until` per sc-6c."

### B4. Debug hooks inventory (`?debug=failed` and friends)

Two sites in `ServiceCalendar.js`:

- `:1509` - overview scope, `isDev && searchParams?.get("debug") === "failed"`.
- `:1555` - period + month scopes, same gate. This is SC-047 wiring.

Both isDev-gated. No other `?debug=*` hooks in the SC surface. These stay - they're the failed-atom test rig the audit arc leaned on.

**For ARCHITECTURE.md:** worth documenting the pattern (`isDev + search-param + resolveDayStatus override`) as the canonical way to force UI states for QA.

### B5. Unused exports / unreachable branches (targeted)

Not doing a whole-repo lint. Two flagged from prior audit reading:

- `DayDetail.js` retains `attemptClose` (SC-063 discard-guard entry point) alongside `requestClose` (parent-side gate). Both reachable, both used. Not dead.
- `ServiceCalendar.js` retains `handleConfirmAsProjected` alongside `handleBulkConfirm`. `handleConfirmAsProjected` is a legacy single-day path - I could not find a JSX consumer for it post-#358. **Candidate for verification** in the cleanup pass. Size **S**, risk low.

---

## C - Candidate triage

Walking every `### Candidates` block in `docs/DESIGN_AUDIT_LEDGER.md` (Sections 1-3 + Rounds 2-3) + the S3 Flags register.

### C1. Section 1 - "Candidates (new issues found during fixes land here)" (line 77)

| # | Item | Status | Grade | Notes |
|---|---|---|---|---|
| 1 | SC-036: `<640px` urgency-chip visibility | still valid | S | Runtime-checklist item. Kevin phone-check pending. |

### C2. Section 2 Candidates (line 112)

| # | Item | Status | Grade | Notes |
|---|---|---|---|---|
| 2 | Stale `day.isPast` across midnight | still valid | M | Fetches bake `isPast` at load. Fix: derive on read, not on fetch. |
| 3 | Workspace skeleton is a raw grid (SC-016 parity) | still valid | M | Aesthetics-only. Defer. |
| 4 | Skeleton hardcodes 28 tiles | still valid | S | Cosmetic. Trivial - read period length. |
| 5 | Partial-vs-total period-failure paths (PW:118-129) | still valid | M | SC-047 covered the total-failure case. Partial-fail path still branchy. |

### C3. Section 3 Candidates (line 140)

| # | Item | Status | Grade | Notes |
|---|---|---|---|---|
| 6 | Three independent `fmt$` implementations | **partially retired** (#362 landed shared util) - stragglers per §A5 above | S | Finish sweep: PeriodWorkspace + MonthCard + DaySquare + duplicate ServiceCalendar `fmtDateShort`. |
| 7 | Em-dash in `ServiceCalendar.js:~1585` "Bulk entry - {N} days" | **RETIRED** by #366 (verify: line 1603 now reads "-", not "—") | - | Confirmed at line 1603. Done. |
| 8 | Remaining CC Flags (13) | **recoverable** - `/tmp/sc-audit-section3-findings.md` still exists on this box, harvest 15 (not 13) below | - | Ledger pointer to "13" was an approximate count; actual count is 15. |
| 9 | Dirty-guard over-triggers on retype-same-value | **partially retired** by SC-071 (touched delete on clear when no prior actual) | S | Residue: user types `100` in an already-`100` cell -> touched.add fires despite no differ-from-initial. Fix requires storing `initialValues` snapshot alongside `editValues`. |

### C4. Round 3 Candidates (line 178)

| # | Item | Status | Grade | Notes |
|---|---|---|---|---|
| 10 | Per-meal-zero vs homestand-zero classify asymmetry (`dataStore ~:204`) | still valid | S | GOTCHAS promotion (drafted in §D). |
| 11 | `sc_day_metadata.day_notes` dormant post-#367 | still valid + widens to §B2 | S | Retire the column in a future schema tidy AND drop `dataStore:722`'s dead read now. |
| 12 | Same as #10, duplicate entry | duplicate | - | Two entries in the Round-3 candidates block say the same thing. Trim one. |

### C5. Section 3 Flags harvest (from `/tmp/sc-audit-section3-findings.md`, 15 items - not 13)

The file survives at `/tmp` post-session. Full list:

| # | Flag | Status now | Grade | Notes |
|---|---|---|---|---|
| F1 | Header dollar vs toast dollar read from different price snapshots | **RETIRED** by #361 (server-authoritative saved totals) + #368 (sc-8c) | - | Ledger closed via bundle 1 + money alignment. |
| F2 | Bulk-review per-row rounds per-day, header rounds aggregate | **RETIRED** by #361 (bulk review header = sum of rounded rows) | - | |
| F3 | Day-notes textarea orphaned | **RETIRED** by #361 (SC-053) + #367 (SC-079) | - | |
| F4 | No `AbortController` on any save fetch | **partially retired** by #361 (mount-ref abort) - AbortController proper still absent | M | Mount-ref catches the toast-on-unmounted case; a mid-flight abort of the fetch itself isn't wired. |
| F5 | Esc + backdrop-click silently discard mid-entry | **RETIRED** by #362 (SC-063 discard guard) | - | |
| F6 | Review overlay doesn't surface delta chips | **RETIRED** by #362 (SC-054) | - | |
| F7 | `--text-subtle` fails WCAG AA on light surfaces at 3 sites | **RETIRED** by #362 (SC-059/061) | - | |
| F8 | Delta-big amber `#D97706` on white 3.19:1 at 12px | **RETIRED** by #362 (SC-061) | - | |
| F9 | Toast container no `pointer-events: none` | **RETIRED** by #362 (SC-060) | - | |
| F10 | DayDetail state transitions don't move focus to new primary | still valid | S | Post-review-open should focus "Confirm & save"; post-review-back should focus "Review & save". |
| F11 | Success screen has no `role="status"` / `aria-live` | still valid | S | Add role + polite announcement (SC-060 sibling, missed in scope). |
| F12 | PDC-PDC in group-price line | **RETIRED** by #362 (SC-058) | - | |
| F13 | Toast not manually dismissable | **RETIRED** by #362 (SC-060) | - | |
| F14 | Em-dash in "Bulk entry - {N} days" | **RETIRED** by #366 | - | Same as C3 #7. |
| F15 | "Enter custom values" asymmetry with match-projections review | **RETIRED** by #362 (SC-062) | - | |

**Net after harvest:** 3 Flags survive (F4, F10, F11). Add to the ledger's Candidates block for cleanup phase. The file should be committed to `docs/opd-audit/` or `docs/audits/` as institutional memory (it's the source-of-record for the S3 investigation).

### C6. Dirty-guard residue (final status)

**SC-071 partially retired the over-trigger candidate.** Concretely:

- **Fixed by SC-071:** type-then-delete on a previously-empty row now correctly removes the `touched` entry -> no phantom-dirty on Esc after clearing.
- **Residue:** retype-to-same-value case. If a service has a saved actual of 100 and the operator types `100` again (same value), `handleChange` calls `setTouched(prev => prev.add(colIndex))` unconditionally, treating it as dirty. `isDirty` returns true even though the value is unchanged. Discard guard fires on a benign Esc.
- **Fix cost:** add an `initialValues` snapshot at mount; `isDirty` checks `editValues[ci] !== initialValues[ci]` instead of `touched.size > 0`. **S** (~20 LOC + tests).
- **Risk:** low. Behavioral improvement, no visual change.

---

## D - Docs debt census

### D1. `ACCOUNT_SERVICES_BRIEF.md` per-section true-up (the #368 banner promise)

The #368 banner said "older sections may still reflect the pre-2026-06-16 money framing and will be trued up per-section in a follow-up." Actual sections still carrying stale money framing:

| Section | Line(s) | Stale claim | One-line correction |
|---|---|---|---|
| CIN-AZ per-account §"Per-meal projection prices" | 45-62 | Table header "Projection price" / "Actuals (cost basis)" is right numerically but the "cost basis" naming needs the Q5 rename. | Rename column header "Actuals (cost basis)" -> "Post-SF invoice rate". |
| CIN-AZ §"Pricing model in one line" | 63 | "The 2023 contract base rates... The operative 2026 projection rates above are significantly above either the floor or cap CPI escalation off 2023 base, indicating either a separately negotiated 2026 SOW or a renegotiation outside the 2023 contract document. The operative 2026 pricing document is not in the contracts folder on file (open question)." | Now covered by the alignment report's Q4 paperwork gap - point at `SC_MONEY_MODEL.md` §Open paperwork gaps. |
| CIN-AZ §Special provisions bullet 3 | line ~76 | "The 2023 Exhibit B volume threshold (72,890-meal trigger dropping MiLB rates)" - fine, but "cost basis" language reappears in Notes column. | Q5 rename passes. |
| TBR-FL §per-account table | 267+ | Uses "Cost basis" as a column header analogous to CIN-AZ. | Column header rename. |
| TXR-AZ §per-account table | (not read this session, but same pattern per `archive/SC_PRICE_COMPARISON.md`, archived 2026-07-17) | Same "Actuals (cost basis)" column. | Column header rename. |

**Scope only. No edits proposed.** Estimated effort: **S** (find-replace on "cost basis" + column headers, ~4 tables affected).

### D2. Em-dash sweep

**In `docs/*.md`:**

| Count | File | Notes |
|---|---|---|
| 81 | MODULE_7_DATA_AUDIT.md | Legacy audit doc - defer |
| 57 | SMART_INVENTORY_DATA_MODEL.md | Legacy - defer |
| 48 | OPD_PLAN.md | OPD scope, not SC - defer |
| 45 | MIGRATION_STATUS.md | Migration project doc - defer |
| 39 | MODULE_7_INV-2_PLAN_CORRECTION.md | Legacy - defer |
| 28 | DESIGN_AUDIT_LEDGER.md | Active SC doc - **sweep** |
| 10 | BUSINESS_NOTES.md | Active - **sweep** |
| 6 | GOTCHAS.md | Active - **sweep** |
| 3 | MIGRATION_PROJECT_CLOSEOUT.md | Historical - defer |
| 2 | SUPABASE_MIGRATION.md | Historical - defer |
| 2 | PROJECT_DASHBOARD.md | Active - **sweep** (the two that rode #369) |
| 1 | SC_CC_HANDOFF.md | Historical - skip |
| 1 | RUNBOOK.md | Active but 1 - **sweep** |

**Two em-dashes that rode #369 confirmed** at `PROJECT_DASHBOARD.md`: the "unblocked by SC_MONEY_MODEL - Summary leads with KPI lens" phrase appears twice (in the right-now paragraph and the SC-thread Next-step cell). One-line s/—/-/ each.

**In UI code (`src/app/service-calendar/**.js`):**

| Site | Line | Status |
|---|---|---|
| `page.js:120` | Coming-soon: "Check back soon - we're building..." | Convert to hyphen. |
| `ServiceCalendar.js:172, 183` | Account dropdown: `${selected.key} — ${selected.name}` (2 sites, same phrase in trigger + option) | Convert to hyphen (per repo em-dash rule). |
| `DayDetail.js:679, 680, 968` | `<strong>{latest.author \|\| "—"}</strong>` and identical at :968 | **Keep** - `—` here is a typographic placeholder for "unknown / null author," not prose. Consistent with accounting-style "no data" convention. |

- **Scope:** 5 removable em-dashes in code (page.js: 1; ServiceCalendar.js: 2; PROJECT_DASHBOARD: 2 in doc). + full sweeps of the 4 active docs (28+10+6+1+2 = 47 total).
- **Size:** **S** (mechanical find/replace with the placeholder-preserved allowlist).
- **Risk:** low.

### D3. `ARCHITECTURE.md` accuracy pass

Grep confirms `ARCHITECTURE.md` mentions Service Calendar only at 3 non-SC-specific points (routes + admin gate + legacy Sheets reference). **Zero substantive coverage of the SC's actual money model, view, classifier, or notes ledger.**

Stale/missing entries (each an ARCHITECTURE.md gap the audit arc created):

| # | Section | Missing content | One-line correction |
|---|---|---|---|
| A1 | §"The stack" / new §"Service Calendar architecture" | The two-layer money model (per-meal / operational via `sc_daily_revenue` + contract revenue via `sc_fee_schedule`, admin one control surface, KPI dashboard reads both). | Add §referencing `SC_MONEY_MODEL.md`. |
| A2 | Same | Server-authoritative saved totals - `sc-submit-day` echoes `savedRevenue`/`savedMeals` from `readSavedDayTotals` reading `sc_daily_revenue` AFTER the write, so every surface reads one truth. | Add pointer + one-line explanation. |
| A3 | Same | The append-only notes ledger (`sc_day_note_entries`, sc-9) - author derived server-side, backfill from dormant `sc_day_metadata.notes`. | Add pointer to sc-9 file. |
| A4 | Same | Effective-dated price model (view LATERAL on `sc_service_prices` by `service_date`), `price_kind` machinery, `COALESCE(pr_act.price, pr_proj.price)` fallback. | Add pointer + one paragraph. |
| A5 | Same | The homestand classifier (`classifyDayStatus`) - entry beats schedule; per-meal zero = no-service; homestand game-day zero = entered (recorded cancellation). Deliberate asymmetry. | Add pointer + the asymmetry rule. |
| A6 | §"Danger zones" | Migrations don't auto-apply (already documented) - reinforce with the sc-9 late-application incident (#367 code hit prod before Kevin ran the SQL). | One-line reinforcement + point at GOTCHAS #3 below. |

- **Size:** **M** (~1 new §"Service Calendar architecture" containing 4-5 subsections + pointers).
- **Risk:** low. Read-only docs work.

### D4. GOTCHAS.md promotions queue (drafted, not committed)

Three new entries drafted for the cleanup PR. Full text below - copy-paste ready.

#### Draft entry 1: The classify asymmetry

```md
### SC classifier: per-meal zero and homestand zero mean opposite things
Per docs/SC_MONEY_MODEL.md §(a-b), the `classifyDayStatus` function in
`src/lib/dataStore/serviceCalendar.js:~183-216` treats a zero actual count differently
depending on account shape - a **deliberate asymmetry** per owner ruling 2026-07-09.
- **Per-meal accounts** (CIN-AZ / CIN-KY / TBJ-FL / TBJ-NY / TBR-FL PDC / TXR-AZ):
  all-zero actuals -> status "no-service" (planned off day - the classifier
  can't distinguish this from a Sunday that was never touched, and by ruling both
  read as beige/complete). Line 205: `if (s.hasAct && !s.anyNonZeroAct) return "no-service";`
- **MLB homestand accounts** (CIN-OH / STL-MO / TXR-TX-H/V): all-zero actuals on
  a GAME day -> status "entered" (a zeroed game is a **recorded cancellation** -
  chef marked the game rained out, and that's operational data worth surfacing
  as green). Line 199-200: `if (hs.dayType === "GAME") { if (s.hasAct) return "entered"; ... }`
Both branches were touched by SC-066/077/078 (mark-no-service + entry-aware classifier).
The `s.hasAct` check discriminates in both branches; the semantic difference is
what a saved zero MEANS on that account shape. Do not "harmonize" this - it's the
correct model.
```

#### Draft entry 2: Silent `.catch(() => {})` in SC

```md
### SC uses silent `.catch(() => {})` in specific tolerable-failure spots - do not extend
The Service Calendar has six sites intentionally swallowing errors with `.catch(() => {})`
or `.catch(() => null)`:
- `src/app/service-calendar/page.js:60` - hero-image fetch (cosmetic; failure is OK).
- `src/app/service-calendar/ServiceCalendar.js:792, 806` - month prefetch on hover
  (best-effort; the real load fires on click regardless).
- `src/app/service-calendar/ServiceCalendar.js:1029, 1087` - bulk-write per-day
  `catch { /* continue */ }` inside a loop (one day failing shouldn't stop the
  N-1 others; failure surfaces via the successCount toast copy).
- `src/app/service-calendar/admin/AccountEditor.js:124` - admin config fetch on
  mount (cosmetic in an already-open modal).
These are **exceptions**, not the pattern. When you add a new fetch to SC, do NOT
copy this pattern - the default is "surface the error via `showToast(err, 'error')`."
The silent sites are the specific carve-outs above; anything new that catches
silently needs a comment explaining why.
```

#### Draft entry 3: Migrations run at merge time (the #367 sc-9 incident)

```md
### SC migrations in `docs/migrations/*.sql` run at MERGE time (not deploy time), and Vercel does not run them for you
When a PR carrying a `docs/migrations/*.sql` file merges to main, Vercel builds
+ deploys the code that references the new table/view. **The SQL does NOT run
automatically.** Kevin runs it manually in Supabase Studio.

**The #367 sc-9 incident (2026-07-09):** #367 landed `sc-9-day-note-entries.sql`
(create the notes-ledger table) alongside the code that queries it. The code
deployed immediately on merge; the SQL was run hours later. Between merge and
`sc-9` apply, every SC month-load hit a 500 querying a missing table.

**Rule:** if your PR touches `docs/migrations/*.sql`, EITHER
- run the SQL in Supabase Studio BEFORE merging (safest); OR
- add a defensive feature flag / try-catch in the code that reads the new
  table, so the code degrades gracefully until the SQL runs; OR
- coordinate with Kevin so he runs the SQL immediately on merge.

The sc-1 silent-gap incident (2026-06-12) is the classic form of this class of
failure - see `docs/MIGRATION_PROJECT_CLOSEOUT.md` §E. The sc-9 case is the
same pattern in a smaller blast radius.
```

- **Size:** **S** (each ~15 lines; total ~50 lines to GOTCHAS).
- **Risk:** low. Docs.

---

## E - The graded plan

### Bundle labels

- **C1** = component + util consolidation (JSX shape + shared utils only)
- **C2** = CSS + dead-code (styles + dead reads + unused branches)
- **C3** = docs + GOTCHAS (all doc work + ARCHITECTURE additions)

### Full item table

| # | Item | Category | Size | Risk | Bundle | Kevin-ruling? |
|---|---|---|---|---|---|---|
| 1 | MonthCard vs PeriodCard consolidation (SC-032/035) | dupe | L | med | C1 | **YES** (unify vs keep parallel) |
| 2 | ProgressBar unify (4 inline -> 1 shared component) | dupe | M | low | C1 | no |
| 3 | Sun/moon glyph extraction (3 sites -> 1) | dupe | S | low | C1 | no |
| 4 | StateLegend/LegendInfoPopup shared items table | dupe | M | low | C1 | no |
| 5 | Format util stragglers (PeriodWorkspace, MonthCard fmtK, DaySquare, ServiceCalendar fmtDateShort) | dupe | S | low | C1 | no |
| 6 | Hover-lift/press CSS consolidation | dupe | M | med | C2 | no |
| 7 | Reduced-motion consolidation (35 blocks) | dupe | L | med | C2 | maybe (defer?) |
| 8 | Raw-hex tokenization (submissionToast + cat chips) | dupe | S | low | C2 | no |
| 9 | Dead CSS sweep (PurgeCSS on SC bundle) | dead | M | low | C2 | no |
| 10 | Delete `dataStore:722` `dayNotes` dead read | dead | S | low | C2 | no |
| 11 | Delete `.sc-day-row-delta--minor/--big` legacy CSS | dead | S | low | C2 | no |
| 12 | `fmtK` $M unreachable branch (keep or delete) | dead | S | low | C2 | maybe (defensive?) |
| 13 | `handleConfirmAsProjected` unused? verify + delete | dead | S | low | C2 | no |
| 14 | Debug-hook documentation (ARCHITECTURE.md) | docs | S | low | C3 | no |
| 15 | Section-1 candidate SC-036 <640px runtime check | candidate | S | low | runtime-checklist | no (Kevin phone-check) |
| 16 | Section-2 candidate: stale isPast across midnight | candidate | M | med | C1 (data logic) | maybe |
| 17 | Section-2 candidate: raw-grid skeleton (SC-016 parity) | candidate | M | low | defer | no |
| 18 | Section-2 candidate: 28-tile skeleton hardcode | candidate | S | low | C1 | no |
| 19 | Section-2 candidate: partial-fail path (PW:118-129) | candidate | M | med | defer | maybe |
| 20 | Section-3 candidate: dirty-guard retype-same-value residue | candidate | S | low | C1 (behavioral) | no |
| 21 | Round-3 candidate #12: duplicate candidates entry | candidate | S | low | C3 (trim) | no |
| 22 | S3 Flag F4: real AbortController on save fetch | candidate | M | low | C1 (behavioral) | no |
| 23 | S3 Flag F10: focus placement on state transitions | candidate | S | low | C1 (a11y) | no |
| 24 | S3 Flag F11: success screen `role="status"` + aria-live | candidate | S | low | C1 (a11y) | no |
| 25 | ACCOUNT_SERVICES_BRIEF per-section "cost basis" rename | docs | S | low | C3 | no |
| 26 | Em-dash sweep (5 UI + 47 doc lines across 4 active docs) | docs | S | low | C3 | no |
| 27 | ARCHITECTURE.md new §Service Calendar architecture | docs | M | low | C3 | no |
| 28 | GOTCHAS.md 3 new entries (drafted §D4) | docs | S | low | C3 | no |
| 29 | Commit `/tmp/sc-audit-section3-findings.md` into `docs/audits/` | docs | S | low | C3 | no |

### Bundle sequence (proposed)

**C3 first** (docs + GOTCHAS, low-risk, high-signal). Everything else can proceed while C3 is being reviewed.

1. **C3 - docs + GOTCHAS** (~1 sitting): ARCHITECTURE.md §SC architecture · GOTCHAS.md 3 new entries · em-dash sweep · ACCOUNT_SERVICES_BRIEF rename pass · commit S3 findings file · trim duplicate Round-3 candidate. **Size: M**, **risk: low**. Ships first as institutional-memory foundation the code work references.
2. **C2 - CSS + dead-code** (~1-2 sittings): Delete dataStore:722 dead `dayNotes` read · delete `.sc-day-row-delta--minor/--big` legacy CSS · verify + delete `handleConfirmAsProjected` if unused · raw-hex tokenization · hover-lift consolidation. Dead-CSS PurgeCSS pass optional (adds to L if included). **Size: M**, **risk: low-med**. Ships second because it's the most mechanical.
3. **C1a - Extractions** (~1 sitting): Sun/moon glyphs to `season/glyphs.js` · format util stragglers folded into `season/format.js` · StateLegend/LegendInfoPopup shared items table · ProgressBar shared component (skip toast bar). **Size: M**, **risk: low**. Ships third.
4. **C1b - Behavioral + a11y** (~1 sitting): dirty-guard `initialValues` snapshot · save-fetch AbortController · state-transition focus placement · success-screen `role="status"`. **Size: M**, **risk: low**. Ships fourth.
5. **C1c - The big one, MonthCard/PeriodCard consolidation** (~2 sittings + Kevin ruling): only after (1) Kevin rules on unify-vs-keep-parallel and (2) all the above land. **Size: L**, **risk: med**. Ships last or gets deferred entirely per Kevin's ruling.

**Runtime checklist** (unchanged, ~10 min): SC-036 <640px urgency-chip visibility · SC-014 offline stale-data · SC-020 as-of pill · `?debug=failed` on both scopes. Runs alongside or before C3.

### What I'd argue AGAINST cleaning

Two items where risk > value:

1. **Reduced-motion consolidation across 35 CSS blocks (item 7).** The 35 blocks are each scoped to one selector family (`.sc-day-extras-btn` reduced-motion, `.sc-workspace-frame-chip` reduced-motion, etc.). Consolidating into one `@media (prefers-reduced-motion: reduce)` scope means every rule inside has to disable `transform:` + `transition:` for every scoped selector. If one is missed, a lift-on-hover fires under reduced-motion - a real a11y regression, hard to catch in review. The current per-family blocks are noisy but locally correct. **Recommend: leave.** If tokenization ever gets a "motion primitive" pass, revisit then.

2. **`fmtK` $M unreachable branch delete (item 12).** Two lines of code, zero runtime cost, defensive against a hypothetical multi-account rollup future. Deleting it is more work than keeping it. **Recommend: leave** with a comment (`// $M unreachable today; kept for defense against future multi-account rollup`).

3. **MonthCard/PeriodCard consolidation (item 1) - conditional AGAINST.** Only 8.6% of lines identical. Extracting shared primitives will inevitably grow adapter code (per-scope prop translation, per-scope test coverage) equal to or larger than the duplication saved. The two files are each readable standalone; a chef-in-the-code reads MonthCard.js and sees a month card, reads PeriodCard.js and sees a period card. A `<CardShell>` + adapter pattern trades readability for compactness. **Recommend: raise with Kevin, but lean AGAINST unifying.** If SC-035 stays open for years, that's fine - the parallel implementations aren't a code smell, they're two designs with a shared visual family.

The other 26 items all pass a "risk < value" check. C3 + C2 + C1a + C1b are all clear go-aheads.

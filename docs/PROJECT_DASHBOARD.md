# KitchFix Migration Project Dashboard

**Last updated:** 2026-05-18 (post-PR-#50 work, pre-merge)
**Stage:** 0 (Audit + Abstraction Layer, ~70% complete)
**Next milestone:** Stage 1 (Supabase Setup + Schema Design)

---

## How to use this doc

This is the canonical project state for the Sheets → Supabase migration. Update at every session boundary:
- **Session start:** Read this doc, confirm accuracy, proceed.
- **Session end:** Update this doc to reflect work shipped/changed/learned, commit (in the PR if one exists, standalone otherwise).

Visual rendering of this doc is generated via show_widget at session start and end.

This doc supplements `docs/SUPABASE_MIGRATION.md` (the long-form migration plan) - this is the at-a-glance state, that is the detailed reasoning.

---

## Summary metrics

- **PRs shipped:** 15 (since 2026-05-14)
- **Stage 0 progress:** ~77%
- **Items remaining:** 14 (in 5 bundles + 7 unbundled)
- **Calendar estimate to Stage 1:** 2-3 months at sustainable pace

---

## Done - 16 PRs shipped to main

| PR | Title | Date | Notes |
|---|---|---|---|
| #23 | Dashboard route dead-read cleanup | 2026-05-14 | -200 LOC, 3x faster load |
| #26 | Broken People reports deleted | 2026-05-14 | -621 LOC |
| #27 | People Portal POST audit | 2026-05-14 | 9/10 clean, 1 deleted, 1 bug fixed |
| #28 | Cron daily audit | 2026-05-14 | Dead home_news block removed |
| #35 | Cron backup-sheets | 2026-05-15 | Documented post-hoc (shipped earlier as PR #14) |
| #40 | People Portal GET audit | 2026-05-15 | 7/8 actions audited, all clean |
| #41 | Audit #1 - Ops Hub dispatcher | 2026-05-17 | BUSINESS_NOTES.md pattern established |
| #42 | Audit #2 - Inventory | 2026-05-17 | 2 bug fixes |
| #43 | opsNotify consolidation | 2026-05-17 | Shadow duplicate eliminated |
| #44 | Audit #3 - Season Tracker | 2026-05-17 | 3 bug fixes, 3 BUSINESS_NOTES entries |
| #45 | EOD handoff doc | 2026-05-17 | 3 PRs + Audits #2+#3 summary |
| #46 | Knowledge file scaffolding | 2026-05-18 | TEAM_KNOWLEDGE.md + SPEC_INTRANET_AI_SEARCH.md |
| #47 | Audit #4+#5 - Invoice + Vendor | 2026-05-18 | 3 bug fixes, 17 knowledge entries, 5 new SA helpers |
| #48 | Bundle 1: Audit #4+#5 follow-up cleanup + project dashboard | 2026-05-18 | triggerAIScan SA, ensureLineItemTab swap (createTabSA), 2 frontend static-components fixes, PROJECT_DASHBOARD.md established |
| #49 | Frontend lint cleanup pass + InvoiceTool bug fix | 2026-05-18 | 12 lint issues closed, 2 set-state-in-effect refactors (Option B derived state), 1 use-before-declare bug fixed, PR #50 scope discovered (InvoiceTool.js still has 13 problems) |
| #50 | **Latent stale-closure bug fix in invoice submit handler (+ 2 dead-dep cleanups)** | **2026-05-18** | **L742 handleConfirmedSubmit was missing ocrResult?.vendorName + resetForm in deps - real bug masked by UX flow, would have caused Supabase data integrity issue. Plus L539 + L600 dead-dep removals. InvoiceTool.js now warning-free; 10 errors remain in PR #51 backlog.** |

---

## Bundle 1 - Invoice + Vendor follow-up cleanup

**Status:** SHIPPED 2026-05-18 as PR #48
**PR slot:** #48 candidate
**Effort:** ~2-3 hours

Items:
- [x] Create docs/PROJECT_DASHBOARD.md (sub-phase 1) - 165 lines, canonical project state established
- [x] triggerAIScan + updateScanStatus user-OAuth swap (sub-phase 2) - 2 appendRowsSA swaps; updateScanStatus surfaced as no-op
- [x] ensureLineItemTab raw Sheets v4 fetch swap (sub-phase 3) - createTabSA helper added; 3 raw fetches → 3 helper calls; codebase now 100% free of raw sheets.googleapis.com fetches in invoiceActions.js
- [x] Frontend React static-components fixes - 2 of 3 files (sub-phase 4 carve-out) - SkeletonLoader (InvoiceTool.js) + StepBar (VendorSetup.js) lifted to module level

Rationale: Same mental model as PR #47. F17 pattern continuation. Context fresh from sub-phase 5 of PR #47.

---

## Bundle 2 - Audit close-out

**Status:** QUEUED
**PR slots:** #49, #50, #51
**Effort:** 1-2 days

Items:
- [ ] Audit #6 - Smart Inventory (`/api/ops/inventory` subroute, 117 lines) - T1, ~1-2 hr
- [ ] Service Calendar route audit - T1, half-full day
- [ ] Cron routes audit - Railway side + verify Vercel.json coverage - T1, 1 session

Rationale: Same audit-style methodology, different routes. Keep as separate PRs for clean review surfaces. Schedule close together while audit muscle is sharp.

---

## Bundle 3 - Data layer foundation

**Status:** QUEUED
**PR slot:** #54 candidate
**Effort:** 3-4 sessions

Items:
- [ ] Refactor src/lib/sheets.js into clean data-access layer (T2)
- [ ] Document the abstraction interface (T2)

Rationale: Code + docs ship together. 5 helpers from PR #47 form 70% of this. Stable interface so Stage 2 can swap Sheets implementation without callers caring.

---

## Bundle 4 - Knowledge synthesis

**Status:** QUEUED (after Bundles 2+3)
**PR slots:** #55-#57 (docs-only)
**Effort:** 5-8 sessions

Items:
- [ ] Cross-reference all reads with actual sheet contents (T1)
- [ ] Create docs/DATA_MODEL.md - source of truth for Stage 1 schema (T1)
- [ ] Audit findings rollup document (T2)
- [ ] Image hosting catalog for Stage 2a.5 prep (T2)

Rationale: Synthesize accumulated audit knowledge into Stage 1-ready form. Requires audits done first so target stops moving.

---

## Bundle 5 - Operational confidence baseline

**Status:** QUEUED (can parallel Bundle 3)
**PR slots:** #58-#59
**Effort:** 3-4 sessions

Items:
- [ ] Backup strategy testing - verify Railway cron + Drive backup-sheets end-to-end (T3)
- [ ] Performance baseline measurement - top 10 pages/endpoints (T3)
- [ ] Disaster recovery runbook - first draft (T3)
- [ ] Existing access patterns documented (T4)

Rationale: Measure before changing. Becomes regression test bar for Stage 2 cutover.

---

## Unbundled items - scheduled standalone

| Item | Tier | Effort | Notes |
|---|---|---|---|
| Auth strategy decision (NextAuth vs Supabase Auth) | T1 | 2-3 sessions | Danger zone. FINAL pre-Stage-1 gate. |
| F12 full fix - chef-request vendor deactivation workflow | T3 | 1-2 days | Feature work, can ship anytime |
| Slack notification consolidation audit | T3 | 1 session | Different code surface from route audits |
| Postgres familiarity warmup | T4 | 1-3 sessions | Hands-on practice, not a PR |
| Read 2-3 Supabase migration writeups | T4 | few hours | Reading time |
| Slack with Joe + Britt about migration wishlist | T4 | 1 conversation | Async |
| Test coverage decision | T4 | 30 min | Pure thinking session |

---

## Recommended sequence

1. ~~Bundle 1~~ - ✅ SHIPPED 2026-05-18 as PR #48
2. ~~PR #49~~ - ✅ SHIPPED 2026-05-18 - closed deferred items + 1 bug fix; verified live working
3. ~~PR #50~~ - ✅ READY FOR MERGE 2026-05-18 - latent stale-closure bug fix in invoice submit handler + 2 dead-dep cleanups
4. **Bundle 2** - Audit close-out (next 1-2 weeks) - 3 audits
5. **Bundle 3** - Data layer foundation (weeks 2-4)
6. **Bundle 5** in parallel with Bundle 3
7. **Bundle 4** - Knowledge synthesis (after audits + abstraction settle)
8. **Unbundled items** spread throughout - auth strategy decision is the LAST gate
9. **Stage 1 begins** - Supabase project, schema design, deploy

---

## Investigation TODOs (resolved)

| Item | Status | Resolution |
|---|---|---|
| Cut+Dry invoice number scientific-notation spot-check | RESOLVED 2026-05-18 | COLLECTION sheet stores as string. xlsx export artifact only. F32 [PRESERVE] unchanged. |

---

## Discovered during work - deferred follow-ups

These items surfaced during Bundle 1 execution but were deferred to keep PR scope clean. Each is queued for a future small PR.

**PR #49 - SHIPPED 2026-05-18: Frontend lint cleanup pass + InvoiceTool use-before-declare fix:**
- [x] VendorAddModal.js L37 set-state-in-effect (resolved via derived-state pattern)
- [x] VendorSetup.js L127 set-state-in-effect (resolved via `confirmedForName` name-aware derived state)
- [x] VendorSetup.js L374/L384/L397 no-unescaped-entities (5 mechanical escapes)
- [x] VendorSetup.js L799 react-hooks/purity (resolved as bonus from sub-phase 3 refactor)
- [x] InvoiceTool.js L1289 (now L1294) no-img-element + L84 no-img-element (eslint-disable with runtime-dimensions justification)
- [x] BONUS: InvoiceTool.js `resetForm` use-before-declare bug (real compilation-blocking error, fixed by moving declaration up)

**Actual effort:** ~3 hours (scope grew when InvoiceTool.js was discovered to have 18 problems, not 1)
**Actual lint result:** 25 → 13 problems remaining (all in InvoiceTool.js, deferred to PR #50)

**PR #50 - SHIPPED 2026-05-18: Latent stale-closure bug fix + dead-dep cleanups (narrowed scope):**
- [x] L539 `processPDFFile` - removed dead `invoiceNumber` dep
- [x] L600 `tryOCRScan` - removed dead `invoiceNumber` + `vendor` deps + added protective comment documenting the anti-stale-closure ref pattern
- [x] L742 `handleConfirmedSubmit` - added missing `ocrResult?.vendorName` + `resetForm` deps. **REAL LATENT BUG:** stale-closure that would have caused Supabase data integrity issue if UX changed. The lint rule did exactly what it exists for.

**Outcome:** InvoiceTool.js dropped from 13 lint problems to 10 (all 3 warnings closed, 10 errors remain in PR #51 backlog). PR #50's narrowed scope was the right call - the highest-leverage 3 items shipped while the 10 lower-leverage items remain backlogged.

**PR #51 candidate (deferred from PR #50 narrowing) - InvoiceTool.js React pattern cleanup:**
- 6 `set-state-in-effect` errors (L263, L316, L412, L753, L789, L811) - will likely be absorbed into Bundle 3 data-layer refactor
- 4 `react-hooks/immutability` errors at L804-816 (`calc` function impure-during-render)
- Estimated 2-3 hours if pursued as standalone; could be 0 hours if naturally absorbed into Bundle 3
- Status: BACKLOG. Reassess after Bundle 3.

**Other discovered items:**
- `updateScanStatus` and `ensureLineItemTab` helpers still accept unused `token` parameter (kept for signature consistency in Bundle 1; can drop in a future "drop dead token params" cleanup pass). Low priority, ~15 min.

These don't block Stage 1 but are good citizens.

---

## Notes for future sessions

- Memory rule #9 enforces dashboard protocol (render at start, update at end)
- Dashboard supplements SUPABASE_MIGRATION.md (long-form) with at-a-glance state
- Update timestamp at top of this file every session

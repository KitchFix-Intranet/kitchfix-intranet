# KitchFix Migration Project Dashboard

**Last updated:** 2026-05-18 (post-Bundle-1 work, pre-PR-#48 merge)
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

- **PRs shipped:** 13 (since 2026-05-14)
- **Stage 0 progress:** ~72%
- **Items remaining:** 20 (in 5 bundles + 7 unbundled)
- **Calendar estimate to Stage 1:** 2-3 months at sustainable pace

---

## Done - 12 PRs shipped to main

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
| #47 | **Audit #4+#5 - Invoice + Vendor** | **2026-05-18** | **3 bug fixes, 17 knowledge entries, 5 new SA helpers** |

---

## Bundle 1 - Invoice + Vendor follow-up cleanup

**Status:** READY FOR MERGE - PR #48
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

1. ~~Bundle 1~~ - ✅ READY FOR MERGE as PR #48
2. **PR #49** - Frontend lint cleanup pass (1-1.5 hr) - closes deferred items from Bundle 1
3. **Bundle 2** - Audit close-out (next 1-2 weeks) - 3 audits
4. **Bundle 3** - Data layer foundation (weeks 2-4)
5. **Bundle 5** in parallel with Bundle 3
6. **Bundle 4** - Knowledge synthesis (after audits + abstraction settle)
7. **Unbundled items** spread throughout - auth strategy decision is the LAST gate
8. **Stage 1 begins** - Supabase project, schema design, deploy

---

## Investigation TODOs (resolved)

| Item | Status | Resolution |
|---|---|---|
| Cut+Dry invoice number scientific-notation spot-check | RESOLVED 2026-05-18 | COLLECTION sheet stores as string. xlsx export artifact only. F32 [PRESERVE] unchanged. |

---

## Discovered during work - deferred follow-ups

These items surfaced during Bundle 1 execution but were deferred to keep PR scope clean. Each is queued for a future small PR.

**PR #49 candidate - Frontend lint cleanup pass:**
- VendorAddModal.js L37 `react-hooks/set-state-in-effect` (anti-pattern, requires useDeferredValue or derived-state refactor) - ~30 min
- VendorSetup.js L127 same `react-hooks/set-state-in-effect` pattern - ~30 min
- VendorSetup.js L374/L384/L397 `react/no-unescaped-entities` (5 errors, mechanical) - ~10 min
- VendorSetup.js L799 `react-hooks/purity` warning - ~5 min
- InvoiceTool.js L1289 `@next/next/no-img-element` warning - ~5 min

**Estimated total effort:** 1-1.5 hours
**Estimated remaining lint count after PR #49:** 0 problems (25 → 0 for these 3 files)

**Other discovered items:**
- `updateScanStatus` and `ensureLineItemTab` helpers still accept unused `token` parameter (kept for signature consistency in Bundle 1; can drop in a future "drop dead token params" cleanup pass). Low priority, ~15 min.

These don't block Stage 1 but are good citizens.

---

## Notes for future sessions

- Memory rule #9 enforces dashboard protocol (render at start, update at end)
- Dashboard supplements SUPABASE_MIGRATION.md (long-form) with at-a-glance state
- Update timestamp at top of this file every session

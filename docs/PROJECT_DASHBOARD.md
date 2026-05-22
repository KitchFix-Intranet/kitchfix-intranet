# KitchFix Migration Project Dashboard

**Last updated:** 2026-05-22 (PR A2b complete in working tree, pre-merge; CLAUDE.md item 1 CLOSED)
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

- **PRs shipped:** 21 (since 2026-05-14)
- **Stage 0 progress:** ~91%
- **Items remaining:** 11 (in 5 bundles + 7 unbundled)
- **Calendar estimate to Stage 1:** 2-3 months at sustainable pace

---

## Done - 21 PRs shipped to main

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
| #50 | Latent stale-closure bug fix in invoice submit handler (+ 2 dead-dep cleanups) | 2026-05-18 | L742 handleConfirmedSubmit was missing ocrResult?.vendorName + resetForm in deps - real bug masked by UX flow, would have caused Supabase data integrity issue. Plus L539 + L600 dead-dep removals. InvoiceTool.js now warning-free; 10 errors remain in PR #51 backlog. |
| #51 | Audit #6 - Smart Inventory (migration-readiness focus) | 2026-05-18 | 30 handlers audited, 2 F-codes fixed (F33 fire-and-forget async forEach in handleMergeItems, F36 dropped reason+email in handleReviewDelete), 12 BUSINESS_NOTES entries + 1 updated, env var inconsistency cleaned (94 sites), new SMART_INVENTORY_DATA_MODEL.md (393 lines) captured for Stage 1 schema design. Stub triage deferred to product session post-migration. |
| #52 | Bundle 2 close-out + knowledge map v1 | 2026-05-19 | Service Calendar deferred (50% built), Railway cron documented (audit-as-documentation, F43-F49 captured not fixed), CLAUDE_KNOWLEDGE_MAP.md v1 added, 2 BUSINESS_NOTES entries (Railway cron invariants + F43-F49 log), dashboard sync carry-forward. Stage 0 progress 82% → 87%. |
| #53 | Bundle 3 sub-phase 0 recon (Sheets access inventory) | 2026-05-19 | 17 Sheets-touching files classified across 6 categories (10 CONSOLIDATED / 1 DOWNSTREAM / 1 DIRECT-ONLY / 1 AUTH-BOUNDARY / 4 AD-HOC-HELPER). New docs/SHEETS_ACCESS_INVENTORY.md (178 lines) becomes Bundle 3 consolidation reference. Recommended 3-PR scope (~10-13 hr total): cron consolidation, directory migration, dashboard auth-boundary decision. Recon-only, no code changes. |
| #54 | Bundle 3 PR A1 - cron consolidation (3 files) | 2026-05-20 | 3 of 4 hand-rolled JWT paths consolidated to canonical getServiceAccountSheetsClient / getServiceAccountDriveClient helpers. New getServiceAccountDriveClient(scopes) helper added to sheets.js (+22 LOC). cron/backup-sheets, cron/daily, cron/incident-reminders all migrated; drift-bomb duplicate SHEET_IDS consts removed. Gmail SA pattern in cron/incident-reminders intentionally preserved (domain-wide delegation, different from Sheets SA). Net -108 LOC. people/route.js (2056 lines) remains for PR A2 to fully close CLAUDE.md item 1. 2 BUSINESS_NOTES entries added (Hand-rolled JWT consolidation [CLOSED ISSUE], Gmail SA auth pattern [PRESERVE]). |
| #55 | Bundle 3 PR A2a - people/route.js Sheets consolidation + Drive client consolidation | 2026-05-22 | Sheets-path portion of CLAUDE.md item 1 closed. 66 call sites in people/route.js migrated to canonical SA helpers (29 readSheet, 4 appendRow, 27 updateCell, 3 updateRow, 1 clearRow, 2 appendRowAnchored). 7 local Sheets helpers removed; ensureIncidentsTab refactored in place to use canonical primitives (D2: keep local). Local SHEET_IDS const dropped, drift-bomb (PEOPLE_DB_SHEET_ID fallback to MASTER_HUB) removed (P0). 2 new canonical helpers added to sheets.js (clearRangeSA, updateCellByRowColSA). Drive client consolidation: 2 duplicate getServiceAccountDriveClient definitions in drive.js + incidentActions.js consolidated to canonical (PR #54 incomplete sweep finished). ops/route.js dead-import cleanup (5 unused imports dropped). Net -143 LOC across 5 code files. 4 BUSINESS_NOTES entries + 6 CLAUDE_KNOWLEDGE_MAP anti-knowledge entries added. Gmail JWT block stays alive for PR A2b (getAccessToken now orphan, removed in A2b). |
| **A2b** | **Bundle 3 PR A2b - Gmail SA canonicalization (READY FOR MERGE) [CLOSES CLAUDE.md ITEM 1]** | **2026-05-22** | **CLAUDE.md item 1 fully closed - zero active hand-rolled crypto.subtle JWT remains in the codebase. New canonical sendEmailSA({ sender, displayName, to, subject, html, replyTo }) in src/lib/gmail.js consolidates the two SA-impersonated Gmail implementations: people/route.js (hand-rolled crypto.subtle JWT + raw fetch) + cron/incident-reminders (google.auth.JWT + local MIME builder). 3 encodings byte-equivalence-proven before swap (subject via encodeSubjectSA byte-exact port, HTML body standard padded base64, raw message base64url unpadded - empirically verified across 4 forced-character test inputs). people/route.js: removed full ~72 LOC JWT block (5 functions) + 66-LOC local sendEmail; replaced with 1-line adapter closing over GMAIL_SENDER + GMAIL_SENDER_NAME consts; incidentActions.js by-reference contract preserved (0 lines touched there). cron/incident-reminders: removed local getGmailClient + buildEmailMime + dead googleapis import. Two intentional behavior changes to cron emails REQUIRE post-merge verification (RFC 2047 subject encoding + base64 body now applied; previously plain). Two subject encoders coexist in gmail.js as follow-up cleanup (encodeSubject vs encodeSubjectSA differ on control chars; unify later). Net -68 LOC across 3 code files (gmail.js +95, cron -30, people/route.js -133). 1 new + 2 updated BUSINESS_NOTES entries + 4 new CLAUDE_KNOWLEDGE_MAP anti-knowledge entries + Gmail layer added to client landscape.** |

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
3. ~~PR #50~~ - ✅ SHIPPED 2026-05-18 - latent stale-closure bug fix in invoice submit handler + 2 dead-dep cleanups
4. ~~Bundle 2 - Audit #6: Smart Inventory~~ - ✅ SHIPPED 2026-05-18 as PR #51 - 2 F-codes fixed, 12 BUSINESS_NOTES + SMART_INVENTORY_DATA_MODEL.md captured for Stage 1
5. ~~Bundle 2 - Service Calendar audit~~ - DEFERRED 2026-05-19 - tour revealed ~50% complete development state, not production, not ready for migration-readiness audit. Revisit when Kevin signals Service Calendar is closer to stable.
6. ~~Bundle 2 - Railway cron audit~~ - DOCUMENTED 2026-05-19 - production cron at kitchfix-inventory-cron repo is stable (408 invoices processed, zero observable data loss). F43-F49 captured but not fixed; no production impact evidence. Stage 1 invariants documented in BUSINESS_NOTES.
7. ~~Bundle 3 sub-phase 0 (recon)~~ - ✅ SHIPPED 2026-05-19 as PR #53. ~~Bundle 3 PR A1 (cron consolidation, 3 files)~~ - ✅ SHIPPED 2026-05-20 as PR #54. ~~Bundle 3 PR A2a (people/route.js Sheets consolidation + Drive consolidation + ops dead-imports)~~ - ✅ SHIPPED 2026-05-22 as PR #55. ~~Bundle 3 PR A2b (Gmail SA canonicalization + crypto.subtle JWT block removal)~~ - READY FOR MERGE 2026-05-22 (working tree, awaiting commit + PR). **The Bundle 3 hand-rolled-JWT-consolidation sub-bundle (PR A1 + A2a + A2b) is now COMPLETE - CLAUDE.md item 1 CLOSED.** Next: PR B (directory/route.js, 13 direct API calls), then PR C (dashboard/route.js, Scenario B user-OAuth → SA migration). Calendar SA helper consolidation deferred to post-Bundle-3.
8. **Bundle 5** in parallel with Bundle 3
9. **Bundle 4** - Knowledge synthesis (after audits + abstraction settle)
10. **Unbundled items** spread throughout - auth strategy decision is the LAST gate
11. **Stage 1 begins** - Supabase project, schema design, deploy

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

**Smart Inventory stub triage deferred (PR #51 sub-phase 4):**
- Sub-phase 4 stub triage (7 dead handlers) deferred from PR #51. Decision is product-scope (which features get built post-migration) not audit-scope. Revisit when Smart Inventory enters active development phase post-Supabase migration. Stubs and shells preserved as-is in PR #51.

**E2E CI infrastructure fix (originally flagged 2026-05-15, re-confirmed during PR #50):**
- `.github/workflows/e2e.yml` line 44 hardcodes `PLAYWRIGHT_BASE_URL` against production, not PR preview URLs
- Impact: PR-side regressions can't be caught by CI (PR's code never runs in test). Any prod flake blocks unrelated PRs.
- Confirmed during PR #50: vendor e2e tests failed despite PR #50 not touching vendor code. Re-run on identical commit passed in 75s. Investigation surfaced the same issue documented in SUPABASE_MIGRATION.md Captain's Log 2026-05-15.
- Current workaround: re-run failed jobs on flake
- Proper fix: 3 parts including cookie-domain change in auth danger zone. Batches with SA auth consolidation work.
- Status: deferred until SA auth consolidation. Estimated 1-2 sessions when batched.

**Other discovered items:**
- `updateScanStatus` and `ensureLineItemTab` helpers still accept unused `token` parameter (kept for signature consistency in Bundle 1; can drop in a future "drop dead token params" cleanup pass). Low priority, ~15 min.

These don't block Stage 1 but are good citizens.

---

## Notes for future sessions

- Memory rule #9 enforces dashboard protocol (render at start, update at end)
- Dashboard supplements SUPABASE_MIGRATION.md (long-form) with at-a-glance state
- Update timestamp at top of this file every session

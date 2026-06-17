# Project Dashboard

> **This is a current-state orientation doc. It points to detail, it does not contain it.**
> If a thread needs depth, follow its deep-doc link. If this file grows past ~2 screens, something belongs in a linked doc instead. History lives in the PR trail; do not re-fill it here.

**Last updated:** 2026-06-17

## Right now

KitchFix intranet is live on Vercel; the multi-project Sheets→Postgres migration is well advanced (modules 1-3 cut over, finance stack scoped). The **Service Calendar engine is live on Postgres** with all 11 accounts testing-verified across three display modes (per-meal, MLB fee schedule, MiLB hybrid); polish + color-consistency arc closed today. The **OPD/Playbook re-point** has cleared Phase A engine work (A1-A7) and just landed the full **Document Format Standard arc**: STD-001 v1.2 + enterprise-grade in-app + print/PDF rendering (cover, TOC with target-counter page numbers, running footers, Oswald/Inter type, vertical navy logo, per-class polish). Next up is the **OPD Command rebuild** (`/playbook/admin`) - scoped today across a three-way audit; 4-PR sequence queued. Then **SousAI live wiring** as its own arc.

## Active threads

| Thread | Status | Next step | Deep doc |
|---|---|---|---|
| OPD Command rebuild (was Build Dashboard) | Scoped across a three-way audit (Kevin + Chat-Claude + CC) 2026-06-17. Governing principle: dashboard owns operational lifecycle (status, access_level, pin, archive); MDX owns the document (identity + content + structure). Five of eight current editable fields are silent-data-loss traps; three lead KPIs measure retired Drive linkage. Migration path locked: conditional-include via `mdxToDocRow(fm, existing)`, no schema change. | 4-PR sequence A->B->C->D. PR A (safe cleanups: cross-module alive-test fix in `PlaybookClient.js` + New Document deletion). PR B (SOLO: overlay migration with mandatory pre-apply baseline snapshot). PR C (Drive teardown + the cockpit IA - Attention tab + rebuilt Worklist). PR D (governance surfaces: access-tier editor + issues triage). | [BUILD_DASHBOARD_AUDIT_CC.md](opd/BUILD_DASHBOARD_AUDIT_CC.md) · [BUILD_DASHBOARD_ENGINE_MAP_CC.md](opd/BUILD_DASHBOARD_ENGINE_MAP_CC.md) |
| OPD/Playbook Phase A (engine) | DONE. A1/A3/A4/A5/A7 MERGED (#148/#152/#155/#157/#160); access tiers wired (#154); reader rendering document_content with Drive fallback; projection --apply executor live; SousAI ingestion from MDX (1290 chunks across 101 docs, 3-tier gate verified); Drive ingestion code retired. The **Document Format Standard arc** layered on top: STD-001 v1.2 + enterprise-grade screen + print rendering (PRs #178/#180/#182/#183/#184/#187). | Phase A engine is complete. Next module of work is OPD Command (above row). Then Phase B: SousAI live retrieval caller + hero search, reader reading-experience UX, shelf taxonomy. | [PHASE_A_PR1_HANDOFF.md](opd/foundation/PHASE_A_PR1_HANDOFF.md) · [PROJECTION_DRYRUN.md](opd/foundation/PROJECTION_DRYRUN.md) · [PLAYBOOK_ENGINE_AUDIT.md](opd/PLAYBOOK_ENGINE_AUDIT.md) |
| OPD content review | Reviewer packets out: Britt (culinary), Counsel (policy), Finance (pay bands + permits). 5 new docs created for ingestion today. | Await markups; record approvals to MDX frontmatter; flip In Build → Live on sign-off | tracked by Kevin (no repo deep-doc) |
| Service Calendar | LIVE on Postgres (dev-gated to k.fietek + joe@kitchfix.com). Engine + display polish complete; all 11 accounts testing-verified. Three display modes wired: **per-meal** (PDC + STL-FL), **MLB fee schedule** (4 accounts: CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V - homestand-driven, no urgency colors, navy dots, periwinkle prep), **MiLB hybrid** (2 accounts - DAY/NIGHT borders, off-day recession, navy scheduled-game dots). Year view is default landing + auto-selects user's account on login (user_accounts seeded with 31 rows from contacts). `sc_homestand_schedule` seeded with 408 rows for 4 MLB accounts. Joe's price review fully applied (Fun $$$$ zeroed, TBJ-NY Snack/Shake deactivated, all pricing locked). Color system unified across modes (PR #191). PRs MERGED 2026-06-17: #165, #167, #168, #170, #172, #174, #186, #191 plus STL-FL gate + zero-projection fixes + MiLB hybrid display. | Build the **Close Day** button (one-tap zeros writer for cancelled service days). Run **full design review of per-meal month/day views** per `DESIGN_REVIEW_PERSONA.md`. **Dev gate expansion** to operators, account by account, CIN-AZ first. **Re-import right before cutover** to catch Sheets entries made during testing. Then Admin Dashboard + Fun Money Tracker + Fee schedule table for KPI Dashboard (stores flat annual amounts for fee accounts). | [ACCOUNT_SERVICES_BRIEF.md](ACCOUNT_SERVICES_BRIEF.md) · [SC_SPREADSHEET_MAPPING.md](SC_SPREADSHEET_MAPPING.md) · [SC_CONTRACT_BILLING_SUMMARY.md](SC_CONTRACT_BILLING_SUMMARY.md) · [SC_PRICE_COMPARISON.md](SC_PRICE_COMPARISON.md) |
| Sheets → Postgres migration | Stage 1 in flight; modules 1-3 cut over; Service Calendar now a 4th cut-over module (dev-only); finance stack (Project 3) scoped (12 PRs) | Per `MIGRATION_STATUS.md` - confirm next module with Kevin | [MIGRATION_STATUS.md](MIGRATION_STATUS.md) · [FINANCE_STACK_PLAN.md](FINANCE_STACK_PLAN.md) · [FINANCE_STACK_AUDIT.md](FINANCE_STACK_AUDIT.md) · [MIGRATION_APPROACH.md](MIGRATION_APPROACH.md) |
| Open PRs awaiting decision | PR #140 (m6 post-fix audit reminder for June 19); `fix/sc-seed-preserve-manual-prices` branch (pushed a25ce56, never merged) - hardens the seed against re-runs clobbering manual price corrections, complements #159 | Kevin reviews + merges or closes | the PRs themselves |
| Stale branches to clean up | `fix/sc-fee-account-display-tuning`, `docs/account-services-brief`, `docs/post-ocr-closeout-notes`, `fix/invoice-ocr-retry-and-visibility` - all merged or superseded; branches lingering on remote | Delete after confirming each was merged or rolled into a later PR | n/a |

## Recently done

- PR #191 MERGED (2026-06-17) - SC year-view color consistency pass: MiLB upcoming-game unified to MLB navy (#1e3a8a), empty-state caption standardized to "Off-season" across PDC/MLB/MiLB, TODAY ring shifted from amber to KitchFix navy (#153968), MLB year-card stats stripped of pill styling to match PDC/MiLB row typography
- PR #186 MERGED (2026-06-17) - SC TODAY ring on year heatmap + PDC upcoming-service light-green dots + `user_accounts` auto-select on login (seeded from contacts, 31 rows)
- STL-FL gate fix MERGED (2026-06-17) - frontend `isFeeAccount` and backend `classify()` aligned so STL-FL (flat_fee billing but per-meal display) gets the per-meal zero-projection treatment
- Zero-projection future days fix MERGED (2026-06-17) - past zero-projection days now classify as no-service for per-meal accounts (was reading as future-service everywhere)
- MiLB hybrid display MERGED (2026-06-17) - DAY/NIGHT game type borders, off-day recession, sky-blue upcoming (since unified to navy in #191)
- PR #174 MERGED (2026-06-17) - SC fee-account schedule view tuning: no urgency colors, navy dots, MLB polish
- PR #172 MERGED (2026-06-17) - SC fee-account display fork: homestand-driven UI for CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V
- PR #170 MERGED (2026-06-17) - SC GRANT fix on `sc_homestand_schedule`
- PR #168 MERGED (2026-06-17) - SC `sc_homestand_schedule` Postgres table + seed (408 rows, 4 MLB accounts)
- PR #167 MERGED (2026-06-17) - SC past zero-projection days classify as no-service (per-meal only)
- PR #165 MERGED (2026-06-17) - SC config editor price UPSERT fix
- OPD Command rebuild scoped (2026-06-17) - three-way audit closed (Kevin + Chat-Claude + CC), 4-PR sequence A->B->C->D queued, `docs/opd/BUILD_DASHBOARD_AUDIT_CC.md` + `BUILD_DASHBOARD_ENGINE_MAP_CC.md` committed
- PR #187 MERGED (2026-06-17) - Hide HelpFAB in print/PDF (global `@media print` rule on `.kf-help-wrapper`)
- PR #184 MERGED (2026-06-17) - Doc-format Phase 3 + per-class polish (final visual pass on the doc reader + print pipeline)
- PR #183 MERGED (2026-06-17) - Doc-format TOC fix + print chrome suppression + vertical-navy logo swap
- PR #182 MERGED (2026-06-17) - Doc-format auto-TOC + corpus heading cleanup
- PR #180 MERGED (2026-06-17) - Doc-format print/PDF visual core (cover, TOC scaffold, page numbers via `target-counter`, Oswald/Inter, callout color preservation)
- PR #178 MERGED (2026-06-17) - STD-001 v1.2 standard rewrite governing the doc format
- Main-page redesign arc + A6 content/experiential polish landed across the same session (multiple smaller PRs)
- PR #160 MERGED (2026-06-16) - Phase A A7: SousAI Drive ingestion retired
- PR #159 MERGED (2026-06-16) - SC actuals-first-class: per-service active/inactive includes actuals, year-view pagination fix, month noService check, payload cleanup
- PR #158 MERGED (2026-06-16) - SC day status derived from actuals not projections (3 UI surfaces)
- PR #157 MERGED (2026-06-16) - Phase A A5: SousAI ingestion swapped to MDX
- PR #156 MERGED (2026-06-16) - SC P0-1 touched-only save + P0-2 await save before success screen
- PR #155 MERGED (2026-06-16) - Phase A A4: OPD projection --apply executor
- PR #154 MERGED (2026-06-16) - Phase A: 3-tier OPD access gate (access_level + opdAcl resolver + enforcement)
- PR #153 MERGED (2026-06-16) - Account Services Brief: source of truth for billing, pricing, contracts (716 lines, 11 inline contradictions flagged for review)
- PR #152 MERGED (2026-06-16) - Phase A A3: reader renders document_content HTML with Drive fallback
- PR #151 MERGED (2026-06-16) - BUSINESS_NOTES: account types + per-meal vs fee billing models
- PR #150 MERGED (2026-06-16) - Lean PROJECT_DASHBOARD re-establishment
- PR #149 MERGED (2026-06-16) - Service Calendar PG cutover (route rewire + admin gate + dedupe + import; 5,276 lines)
- PR #148 MERGED (2026-06-16) - Phase A PR1: OPD schema foundation + projection engine (dry-run only)
- Migrations pr-7-8 / pr-7-9 / pr-7-10 applied to production via Studio (status set tightened to 6, document_pins overlay, document_content table)
- PR #147 MERGED (2026-06-15) - OPD content foundation: 101-doc MDX corpus + build pipeline + foundation tooling
- OPD reviewer packets generated and circulated (Britt / Counsel / Finance)

## Pointers

- [ARCHITECTURE.md](ARCHITECTURE.md) - Sheets + PG dual data layer + auth boundary + module map. Now includes the OPD source-of-truth boundary (MDX-authored vs Postgres overlay).
- [CONVENTIONS.md](CONVENTIONS.md) - action-dispatch APIs, CSS prefixes, sheet column conventions
- [GOTCHAS.md](GOTCHAS.md) - hard-won lessons; read before debugging anything that smells familiar
- [HOW_WE_WORK.md](HOW_WE_WORK.md) - orientation primer for new sessions
- [MIGRATION_STATUS.md](MIGRATION_STATUS.md) - canonical current-state of the Sheets→PG migration
- [BUSINESS_NOTES.md](BUSINESS_NOTES.md) - living reference for domain rules + account-specific quirks

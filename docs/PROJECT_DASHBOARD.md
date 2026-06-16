# Project Dashboard

> **This is a current-state orientation doc. It points to detail, it does not contain it.**
> If a thread needs depth, follow its deep-doc link. If this file grows past ~2 screens, something belongs in a linked doc instead. History lives in the PR trail; do not re-fill it here.

**Last updated:** 2026-06-16

## Right now

KitchFix intranet is live on Vercel; the multi-project Sheets→Postgres migration is well advanced (modules 1-3 cut over, finance stack scoped). The **Service Calendar engine went live on Postgres today** (dev-gated to Kevin + Joe) with five fast-follow PRs closing P0 UI bugs and a year-view pagination cap. In parallel the **OPD/Playbook re-point** is mid-flight - MDX+Postgres becoming the single source of truth so Drive can retire as a source. Today shipped: A1 schema, A3 reader render, A4 projection executor, A5 SousAI MDX swap, A7 Drive retirement, plus access-tier gating.

## Active threads

| Thread | Status | Next step | Deep doc |
|---|---|---|---|
| OPD/Playbook re-point (Phase A) | A1/A3/A4/A5/A7 MERGED today (#148/#152/#155/#157/#160); access tiers wired (#154); reader rendering document_content with Drive fallback; projection --apply executor live; SousAI ingestion swapped to MDX; Drive ingestion retired | Settle the access-tier rollout + watch the post-cutover SousAI ingest cycle | [PHASE_A_PR1_HANDOFF.md](opd/foundation/PHASE_A_PR1_HANDOFF.md) · [PROJECTION_DRYRUN.md](opd/foundation/PROJECTION_DRYRUN.md) · [PLAYBOOK_ENGINE_AUDIT.md](opd/PLAYBOOK_ENGINE_AUDIT.md) |
| OPD content review | Reviewer packets out: Britt (culinary), Counsel (policy), Finance (pay bands + permits). 5 new docs created for ingestion today. | Await markups; record approvals to MDX frontmatter; flip In Build → Live on sign-off | tracked by Kevin (no repo deep-doc) |
| Service Calendar | LIVE on Postgres (dev-gated to k.fietek + joe@kitchfix.com). PRs MERGED today: #149 cutover, #153 Account Services Brief, #156 P0-1/P0-2 save flow, #158 status-from-actuals, #159 actuals-first-class + pagination fix. 34,457 rows seeded across 7 tables; billing prices corrected to cost basis with effective_date ledger; fee accounts zeroed. | Kevin's testing week in progress (CIN-AZ + TBJ-FL verified, 9 accounts remaining). Awaiting Joe's price-review Excel response. Re-import before cutover to catch Sheets entries during testing. Then dev-gate expansion to operators. Admin Dashboard + Fun Money Tracker confirmed as next deliverables. | [ACCOUNT_SERVICES_BRIEF.md](ACCOUNT_SERVICES_BRIEF.md) · [SC_SPREADSHEET_MAPPING.md](SC_SPREADSHEET_MAPPING.md) · [SC_CONTRACT_BILLING_SUMMARY.md](SC_CONTRACT_BILLING_SUMMARY.md) · [SC_PRICE_COMPARISON.md](SC_PRICE_COMPARISON.md) |
| Sheets → Postgres migration | Stage 1 in flight; modules 1-3 cut over; Service Calendar now a 4th cut-over module (dev-only); finance stack (Project 3) scoped (12 PRs) | Per `MIGRATION_STATUS.md` - confirm next module with Kevin | [MIGRATION_STATUS.md](MIGRATION_STATUS.md) · [FINANCE_STACK_PLAN.md](FINANCE_STACK_PLAN.md) · [FINANCE_STACK_AUDIT.md](FINANCE_STACK_AUDIT.md) · [MIGRATION_APPROACH.md](MIGRATION_APPROACH.md) |
| Open PRs awaiting decision | PR #140 (m6 post-fix audit reminder for June 19); `fix/sc-seed-preserve-manual-prices` branch (pushed a25ce56, never merged) - hardens the seed against re-runs clobbering manual price corrections, complements #159 | Kevin reviews + merges or closes | the PRs themselves |

## Recently done

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

- [ARCHITECTURE.md](ARCHITECTURE.md) - five-pillar Sheets model + auth boundary + module map. *Flagged stale on the OPD/Postgres module - P2 doc-drift; fix pending in a later Phase A doc-sync.*
- [CONVENTIONS.md](CONVENTIONS.md) - action-dispatch APIs, CSS prefixes, sheet column conventions
- [GOTCHAS.md](GOTCHAS.md) - hard-won lessons; read before debugging anything that smells familiar
- [HOW_WE_WORK.md](HOW_WE_WORK.md) - orientation primer for new sessions
- [MIGRATION_STATUS.md](MIGRATION_STATUS.md) - canonical current-state of the Sheets→PG migration
- [BUSINESS_NOTES.md](BUSINESS_NOTES.md) - living reference for domain rules + account-specific quirks

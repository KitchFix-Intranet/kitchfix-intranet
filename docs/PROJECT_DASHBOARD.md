# Project Dashboard

> **This is a current-state orientation doc. It points to detail, it does not contain it.**
> If a thread needs depth, follow its deep-doc link. If this file grows past ~2 screens, something belongs in a linked doc instead. History lives in the PR trail; do not re-fill it here.

**Last updated:** 2026-06-16

## Right now

KitchFix intranet is live on Vercel; the multi-project Sheets→Postgres migration is well advanced (modules 1-3 cut over, finance stack scoped). Current focus: the **OPD/Playbook re-point** - making MDX+Postgres the single source of truth so Drive can retire as a source. Phase A PR1 (schema + projection engine, dry-run) merged today; live projection + reader render swap are the next moves.

## Active threads

| Thread | Status | Next step | Deep doc |
|---|---|---|---|
| OPD/Playbook re-point (Phase A) | PR1 MERGED (#148); migrations pr-7-8/9/10 applied to prod; dry-run green (63 insert / 38 update / 3 archive, 369 rels) | A3 live projection apply (`scripts/content/project-catalog.mjs --apply`) + reader render swap (later A-phase) | [PHASE_A_PR1_HANDOFF.md](opd/foundation/PHASE_A_PR1_HANDOFF.md) · [PROJECTION_DRYRUN.md](opd/foundation/PROJECTION_DRYRUN.md) · [PLAYBOOK_ENGINE_AUDIT.md](opd/PLAYBOOK_ENGINE_AUDIT.md) |
| OPD content review | Reviewer packets out: Britt (culinary), Counsel (policy), Finance (pay bands + permits) | Await markups; record approvals to MDX frontmatter; flip In Build → Live on sign-off | tracked by Kevin (no repo deep-doc) |
| Service Calendar | PR #149 MERGED (PG cutover - route rewire + admin gate + dedupe + import) | Status unverified post-merge - confirm with Kevin whether follow-up work is in flight on the SC worktree | [SC_SPREADSHEET_MAPPING.md](SC_SPREADSHEET_MAPPING.md) · [SC_CONTRACT_BILLING_SUMMARY.md](SC_CONTRACT_BILLING_SUMMARY.md) · [SC_PRICE_COMPARISON.md](SC_PRICE_COMPARISON.md) |
| Sheets → Postgres migration | Stage 1 in flight; modules 1-3 cut over; finance stack (Project 3) scoped (12 PRs) | Per `MIGRATION_STATUS.md` - confirm next module with Kevin | [MIGRATION_STATUS.md](MIGRATION_STATUS.md) · [FINANCE_STACK_PLAN.md](FINANCE_STACK_PLAN.md) · [FINANCE_STACK_AUDIT.md](FINANCE_STACK_AUDIT.md) · [MIGRATION_APPROACH.md](MIGRATION_APPROACH.md) |
| Open PRs awaiting decision | PR #140 (m6 post-fix audit reminder for June 19) | Kevin reviews + merges or closes | the PR itself |

## Recently done

- PR #148 MERGED (2026-06-16) - Phase A PR1: OPD schema foundation + projection engine (dry-run only)
- PR #149 MERGED (2026-06-16) - Service Calendar PG cutover
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

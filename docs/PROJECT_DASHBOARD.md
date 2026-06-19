# Project Dashboard

> **This is a current-state orientation doc. It points to detail, it does not contain it.**
> If a thread needs depth, follow its deep-doc link. If this file grows past ~2 screens, something belongs in a linked doc instead. History lives in the PR trail; do not re-fill it here.

**Last updated:** 2026-06-19

## Right now

KitchFix intranet is live on Vercel; the multi-project Sheets→Postgres migration is well advanced. The **Service Calendar admin scaffold is live** (gated to corporate) with Stage 1 (gate + allowlist) and Stage 2 (effective-dated price editor + tamper-evident change-log + gear retired) shipped. The **Bundle 1 architecture is locked** and Stage 1 is merged (PR #214): the calendar now reads view-sourced effective-dated revenue, STL-FL is structurally operational-only, and the calendar/contract-revenue layers are cleanly separated. The **contract bible** (RESOLVED BILLING DECISIONS in `SC_CONTRACT_BILLING_SUMMARY.md`) is canonical on main (PR #217). The **OPD Command rebuild** PRs A/B/C have landed with multiple cockpit polish passes; the new **OPD authoring editor** thread (read + commit) is in flight (#211, #213). **News admin + NewsFeed 2.0** landed (#210). Next up: Bundle 1 Stage 2 (fee schedule migration + admin section), then Stage 3 (backdate mode), then Bundle 2 (catalog lifecycle, walled off behind a view-recreate migration).

## Active threads

| Thread | Status | Next step | Deep doc |
|---|---|---|---|
| Service Calendar - Bundle 1 (locked architecture) | Two-revenue-layer model now in code: per-meal/operational lives in the Service Calendar (reads `sc_daily_revenue` and `sc_month_summary`); contract revenue lives in admin and will feed a future KPI dashboard. Stage 1 (calendar accuracy + STL-FL operational-only + OperationalView module + `isFeeAccount` structural split) MERGED via PR #214. The earlier "Close Day / design review / Admin Dashboard / Fun Money / Fee schedule" punch list is RETIRED - those items are absorbed into the bundle architecture below or parked. | **Stage 2 (fee schedule, the first contract-revenue piece)**: new `sc_fee_schedule` table (additive, no view recreate), admin section, effective-dated, audited via `sc_config_changelog` (entity_type='fee'). Seeds the 5 locked fee values from the contract bible. The Service Calendar does NOT consume this table. Then **Stage 3 (backdate mode)**: lift the today/future-only block in the price editor; add a fenced backdate radio + warning that names the recompute range. | [SC_CONTRACT_BILLING_SUMMARY.md](SC_CONTRACT_BILLING_SUMMARY.md) (the contract bible) · [ACCOUNT_SERVICES_BRIEF.md](ACCOUNT_SERVICES_BRIEF.md) |
| Service Calendar - Bundle 2 (catalog lifecycle, walled off) | Future work. Owns the risky `sc_daily_revenue` / `sc_month_summary` view-recreate migration that adds `active_until` (or equivalent dated-status) to `sc_services` and `sc_service_groups`. Includes archive / reactivate / add-service flows in the admin (which were briefly offline for SC_ADMINS when the gear came down via Stage 2; see Accepted Stage 2 Tradeoffs row). | Scope after Bundle 1 Stage 3 ships. Migration plan goes through a dedicated recon + apply-in-Studio-first sequencing. | (not scoped yet) |
| KPI dashboard | Parked. The fee schedule (Bundle 1 Stage 2) is being built as its first data source. Will be reintroduced as its own explicit thread when Kevin commits to it. | n/a | (parked) |
| OPD Command rebuild (was Build Dashboard) | PR sequence A/B/C MERGED (#194/#195/#197). Multiple cockpit polish passes landed (#198/#200/#201/#206/#207/#208). PR D (governance surfaces: access-tier editor + issues triage) status TBD - Kevin to confirm shipped / descoped / pending. | Confirm PR D scope or close out the rebuild thread. | [BUILD_DASHBOARD_AUDIT_CC.md](opd/BUILD_DASHBOARD_AUDIT_CC.md) · [BUILD_DASHBOARD_ENGINE_MAP_CC.md](opd/BUILD_DASHBOARD_ENGINE_MAP_CC.md) |
| OPD authoring editor | New thread. Editor surface + GitHub MDX read landed (#211); commit path landed (#213). The first move toward making OPD content editable in-app. | Confirm save UX direction (commit flow vs MR-based) and whether to scope a follow-up for collaborative editing. | (no repo deep-doc yet) |
| OPD/Playbook Phase A (engine) | DONE. A1-A7 merged. Document Format Standard arc layered on top (PRs #178/#180/#182/#183/#184/#187). | Phase B (SousAI live retrieval caller + hero search, reader reading-experience UX, shelf taxonomy) follows after the OPD Command + authoring editor threads settle. | [PHASE_A_PR1_HANDOFF.md](opd/foundation/PHASE_A_PR1_HANDOFF.md) · [PROJECTION_DRYRUN.md](opd/foundation/PROJECTION_DRYRUN.md) · [PLAYBOOK_ENGINE_AUDIT.md](opd/PLAYBOOK_ENGINE_AUDIT.md) |
| OPD content review | Reviewer packets out: Britt (culinary), Counsel (policy), Finance (pay bands + permits). Markups status since 2026-06-17 - Kevin to update. | Await markups; record approvals to MDX frontmatter; flip In Build → Live on sign-off | tracked by Kevin |
| News admin + NewsFeed 2.0 | LIVE (#210). Image upload + reading overlay. | Monitor in production; future iteration on editorial workflow as needed. | (no repo deep-doc yet) |
| Sheets → Postgres migration | Stage 1 in flight; modules 1-3 cut over; Service Calendar = 4th cut-over (dev-only). Finance stack (Project 3) scoped (12 PRs). | Per `MIGRATION_STATUS.md` - confirm next module with Kevin | [MIGRATION_STATUS.md](MIGRATION_STATUS.md) · [FINANCE_STACK_PLAN.md](FINANCE_STACK_PLAN.md) · [FINANCE_STACK_AUDIT.md](FINANCE_STACK_AUDIT.md) · [MIGRATION_APPROACH.md](MIGRATION_APPROACH.md) |
| Open PRs awaiting decision | PR #140 (m6 post-fix audit reminder for June 19 - today); `fix/sc-seed-preserve-manual-prices` branch (pushed `a25ce56`, never merged) - hardens the seed against re-runs clobbering manual price corrections. | Kevin reviews + merges or closes | the PRs themselves |
| Accepted Stage 2 tradeoffs (in-effect, not blocking) | Gear retirement (PR #209) took add-service + deactivate/reactivate offline for SC_ADMINS until Bundle 2 lands; site-lead change-request flow already had 0 production rows so its loss was net positive. | Documented; revisit when Bundle 2 ships those flows. | (recorded in PR #209 description) |
| Stale branches to clean up | `fix/sc-p0-cleanup` - local-only on Kevin's working tree; upstream already gone (caused today's contract-bible-not-landing detour). `fix/sc-seed-preserve-manual-prices` - pushed `a25ce56` to remote, never merged; hardens the seed against re-runs clobbering manual price corrections. | Delete local `fix/sc-p0-cleanup` via `git branch -D`; review + merge or close `fix/sc-seed-preserve-manual-prices` on remote. | n/a |

## Recently done

- **PR #217 MERGED (2026-06-19)** - Contract bible: `RESOLVED BILLING DECISIONS` section added to `SC_CONTRACT_BILLING_SUMMARY.md` with the five locked fee values (CIN-OH $362,500 / STL-MO $473,000 / TXR-TX-H $604,032 / TXR-TX-V $0 covered-by-H / STL-FL $1,400,000). Authoritative billing reference for Bundle 1 Stage 2/3.
- **PR #214 MERGED (2026-06-19)** - SC Bundle 1 Stage 1: route forwards view-sourced revenue + ServiceCalendar.js reads it (kills the mid-period price drift); `isFeeAccount` split into structural predicates; `OperationalView.js` module owns the operational-only display (no fmt$ import = no $ can leak); STL-FL promoted to fee-display structurally.
- PR #216 MERGED (2026-06-19) - Vendors heading Playwright selector: add `exact: true` to fix strict-mode "resolved to 2 elements"
- PR #215 MERGED (2026-06-19) - Season tracker landing fix
- PR #213 MERGED (2026-06-19) - OPD authoring editor: commit path
- PR #212 MERGED (2026-06-19) - Vendor portal polish
- PR #211 MERGED (2026-06-19) - OPD authoring editor: editor surface + GitHub MDX read (no save)
- PR #210 MERGED (2026-06-18) - News admin + NewsFeed 2.0 (image upload + reading overlay)
- **PR #209 MERGED (2026-06-18)** - SC admin Stage 2: effective-dated price editor + tamper-evident change-log (`sc_config_changelog` migration applied); gear button + `ServiceConfig.js` retired; route gate swapped to `isScAdmin`; per-change validation (date format/floor/reason required); new GET actions for the admin overview + per-account editor.
- PR #208 MERGED (2026-06-17) - OPD command header vitals
- PR #207 MERGED (2026-06-17) - OPD command cockpit width trim
- PR #206 MERGED (2026-06-17) - OPD command cockpit width fix
- **PR #205 MERGED (2026-06-17)** - SC admin Stage 1: gated `/service-calendar/admin` page (server-side `isScAdmin` redirect), `SC_ADMIN_EMAILS` corporate allowlist (8 members) + `isScAdmin()` helper in `src/lib/admin.js`, corporate-only Admin link in the SC header.
- PR #204 MERGED (2026-06-17) - Form-007 drop paper approvals (docs)
- PR #203 MERGED (2026-06-17) - Pay-increase form digital (docs)
- PR #202 MERGED (2026-06-17) - Pay-increase recommendation
- PR #201 MERGED (2026-06-17) - OPD command attention zones
- PR #200 MERGED (2026-06-17) - OPD command polish
- PR #199 MERGED (2026-06-17) - SC month-view redesign
- PR #198 MERGED (2026-06-17) - OPD command cockpit fix
- PR #197 MERGED (2026-06-17) - OPD command PR C (Drive teardown + cockpit IA)
- PR #196 MERGED (2026-06-17) - Quick edits: nav + inventory + season
- PR #195 MERGED (2026-06-17) - OPD command PR B (overlay migration)
- PR #194 MERGED (2026-06-17) - OPD command PR A (safe cleanups)
- PR #193 MERGED (2026-06-17) - SC P0 cleanup
- (earlier entries through PR #191 captured in the prior dashboard revision)

## Pointers

- [SC_CONTRACT_BILLING_SUMMARY.md](SC_CONTRACT_BILLING_SUMMARY.md) - **contract bible** - authoritative billing reference (RESOLVED BILLING DECISIONS at top)
- [ARCHITECTURE.md](ARCHITECTURE.md) - Sheets + PG dual data layer + auth boundary + module map; includes the OPD source-of-truth boundary (MDX-authored vs Postgres overlay)
- [CONVENTIONS.md](CONVENTIONS.md) - action-dispatch APIs, CSS prefixes, sheet column conventions
- [GOTCHAS.md](GOTCHAS.md) - hard-won lessons; read before debugging anything that smells familiar
- [HOW_WE_WORK.md](HOW_WE_WORK.md) - orientation primer for new sessions
- [MIGRATION_STATUS.md](MIGRATION_STATUS.md) - canonical current-state of the Sheets→PG migration
- [BUSINESS_NOTES.md](BUSINESS_NOTES.md) - living reference for domain rules + account-specific quirks

  x
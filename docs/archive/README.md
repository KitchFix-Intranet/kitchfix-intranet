# Archive

Frozen artifacts that captured a moment in the project but are no longer the active reference. Kept for history, not for daily use.

Each subfolder groups by archive reason:

- **`handoffs/`** - End-of-session handoff docs. The May 2026 chain is preserved so a future read can reconstruct any given day; the July 2026 additions (`HANDOFF_CC.md`, `HANDOFF_CHAT.md`) close out the pre-audit drill-in polish arc.
- **`migration/`** - Pre-Stage-1 snapshots and the closed Sheets-to-Postgres migration project's reference set. Includes the original Phase 1-5 `MIGRATION.md`, the 2026-05-14 sheet inventory, the pre-Bundle-3 access inventory, and the three-part `SHEETS_AUDIT*.md` trio (2026-05-26) archived 2026-07-17 after the migration project closed 2026-06-12.
- **`specs/`** - Seed-corpus and self-knowledge docs that were created with growth intent but never materialized into active references. Kept here in case the intent reactivates.
- **Root-level dated snapshots** - Point-in-time documents that stood alone rather than belonging to a subfolder theme: `PROJECT_DASHBOARD_2026-05-28.md`, `DOC_AUDIT_2026-05-29.md` (docs-corpus audit, pre-summit + materially incomplete), `SC_PRICE_COMPARISON.md` (projection-vs-actuals price delta, superseded by `docs/pricing-summit/PRICE_AUDIT.md` + `EVIDENCE_*.md`).

Archived items are still tracked under `git log --follow <path>`; the moves preserve history.

If you find yourself opening an archived doc as part of an active workflow, surface it - that means the active doc set is missing something the archive still answers.

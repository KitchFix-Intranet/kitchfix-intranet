# Archive

Frozen artifacts that captured a moment in the project but are no longer the active reference. Kept for history, not for daily use.

Each subfolder groups by archive reason:

- **`handoffs/`** - End-of-session handoff docs (`HANDOFF_YYYY-MM-DD*.md`). The handoff chain is preserved here so a future read can reconstruct what was happening on any given day in May 2026. The active narrative moved to `PROJECT_DASHBOARD.md` Item 11 + the captain's-log entries inside `SUPABASE_MIGRATION.md` and per-module READMEs.
- **`migration/`** - Pre-Stage-1 snapshots superseded by the three-part `SHEETS_AUDIT*.md` trio (2026-05-26). Includes the original Phase 1-5 `MIGRATION.md` (now superseded by `SUPABASE_MIGRATION.md`), the 2026-05-14 sheet inventory, and the pre-Bundle-3 access inventory.
- **`specs/`** - Seed-corpus and self-knowledge docs that were created with growth intent but never materialized into active references. Kept here in case the intent reactivates.

Archived items are still tracked under `git log --follow <path>`; the moves preserve history.

If you find yourself opening an archived doc as part of an active workflow, surface it - that means the active doc set is missing something the archive still answers.

-- news_interactions: add 4 reaction columns (PG-only; not mirrored to Sheets)
--
-- Four fixed-set reactions per (post, user). All default false so existing rows
-- backfill automatically. The dashboard route's news-bootstrap aggregates these
-- into per-post counts + reactor-name lists, and POST news-react upserts a
-- single boolean per call (independent toggle per reaction).
--
-- Apply in Supabase Studio BEFORE deploying the dependent code (per the
-- 2026-06-12 silent-gap incident rule in CLAUDE.md).

ALTER TABLE news_interactions
  ADD COLUMN IF NOT EXISTS liked      bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fired      bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thumbs_up  bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hearted    bool NOT NULL DEFAULT false;

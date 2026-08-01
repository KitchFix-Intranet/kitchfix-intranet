-- ═══════════════════════════════════════════════════════════════════════════
-- sousai-2-feedback-tags.sql
--
-- Adds `feedback_tags text[]` to sousai_questions to support the six-tag
-- multi-select on the "Not helpful" flow.
--
-- Additive. Nullable. No default. No index needed at this scale
-- (feedback rows are counted in hundreds, not thousands).
--
-- Existing feedback surface:
--   feedback          smallint    -- (-1 | +1) already persists
--   feedback_comment  text        -- free-text field, already persists
--   feedback_at       timestamptz -- already persists
--   feedback_tags     text[]      -- THIS COLUMN - taxonomy tags for -1
--
-- Six tag values (client-enforced; column stays open-vocabulary):
--   'wrong_number', 'missing_information', 'wrong_document',
--   'out_of_date', 'hard_to_follow', 'should_have_declined'
--
-- Only populated on -1 feedback. Null on +1 or unrated rows.
--
-- Kevin runs this in Supabase Studio. Verify with:
--   scripts/_verify-sousai-2-feedback-tags.mjs
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE sousai_questions
  ADD COLUMN IF NOT EXISTS feedback_tags text[];

COMMENT ON COLUMN sousai_questions.feedback_tags IS
  'Multi-select failure-taxonomy tags on -1 feedback. Six client-enforced values: wrong_number, missing_information, wrong_document, out_of_date, hard_to_follow, should_have_declined. Null on +1 or unrated rows. See docs/SOUS_REDESIGN_MASTER.md §5.';

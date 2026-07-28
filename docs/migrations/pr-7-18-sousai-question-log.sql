-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-18-sousai-question-log.sql
-- Project SousAI · PR 7.18 · question log table for Phase C
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT this adds:
--   Table `sousai_questions` - one row per agent-reaching request. Captures
--   the caller (email + resolved tier + access levels), the question, the
--   agent's full trajectory + usage + answer, and (later) the user's feedback.
--
-- WHY:
--   B2 shipped the streaming route. C is Sous's memory. Every ask that
--   reaches the agent is logged with the full trajectory; every feedback
--   updates the same row. This is the data plane for Phase E eval-set
--   authorship (real questions become the eval fixture), Phase D leadership
--   analytics ("what are people asking"), and near-term prompt tuning.
--
-- SCOPE:
--   - Requests that fail at the gate (401 / 403 / 404 / 400) are NOT logged
--     here. They never reach the agent, cost nothing, and are already in the
--     Vercel access log.
--   - Trajectory is stored as jsonb - schemaless by design; the agent's shape
--     will evolve and forcing a normalized child table would freeze it.
--   - No RLS. Access is service-role-only per plan §6 (no user-facing surface
--     reads this table in v1). Phase D leadership analytics reads via
--     a service-role API route, not the client.
--   - Feedback columns are nullable; a row is complete at insert time even if
--     feedback never arrives (most rows).
--
-- APPLICATION MECHANISM:
--   Same as prior pr-7-x migrations. This DB has no exec_sql RPC; DDL is
--   applied by pasting this file into Supabase Studio's SQL editor, then
--   verified by scripts/apply-pr-7-18-sousai-question-log.mjs. Idempotent -
--   re-running after clean apply is a no-op that just re-confirms via IF NOT
--   EXISTS on the table and index.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sousai_questions (
  id                uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz     NOT NULL     DEFAULT now(),

  -- Caller identity + effective ACL at ask time.
  user_email        text            NOT NULL,
  resolved_tier     text            NOT NULL,
  access_levels     text[]          NOT NULL,

  -- The ask.
  question          text            NOT NULL,

  -- The outcome. status is one of grounded | partial | declined | error.
  status            text,
  declined          boolean,
  decline_reason    text,
  answer            text,
  sources           text[],
  trajectory        jsonb,
  model             text,
  latency_ms        integer,
  token_burst_ms    integer,
  usage             jsonb,

  -- Error rows carry error_kind + error_message; success rows leave both null.
  error_kind        text,
  error_message     text,

  -- Feedback (may arrive later via POST /api/sousai { action: "feedback" }).
  -- Null until given.
  feedback          smallint,
  feedback_comment  text,
  feedback_at       timestamptz
);

CREATE INDEX IF NOT EXISTS sousai_questions_created_at_idx
  ON sousai_questions (created_at DESC);

-- GRANT. Mandatory: PostgREST returns "permission denied" without it even
-- with RLS off (per pr-7-1 header comment). service_role gets full data
-- access. anon and authenticated get ZERO grants on this table by design -
-- it is a service-role-only surface (plan §6), and TRUNCATE / REFERENCES /
-- TRIGGER are destructive or structural privileges, not neutral defaults.
-- No user-facing route reads this table in v1; Phase D leadership analytics
-- reads via a service-role API route, not the client. Kevin ruling
-- 2026-07-28.
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE ON sousai_questions TO service_role;

-- No RLS enable. Service-role-only access is the plan §6 constraint;
-- application layer enforces the asker-only-can-feedback rule (WHERE
-- id = :question_id AND user_email = :session_email).

-- ═══════════════════════════════════════════════════════════════════
-- academy-11-culture-os-questions.sql
--
-- Migration 6 in the academy_* series. DML only. Seeds the eight
-- comprehension checks for the Culture OS Handbook (PB-014), module
-- `culture-os-standard`, version 1.0.
--
-- Rows land as status='draft'. Kevin approves them in a separate
-- pass (application UI is out of scope for this PR); until each
-- row moves to status='approved' with approved_by + approved_at
-- populated, no sign flow may present them.
--
-- Coverage
-- ────────
-- One question per section-anchor, five sections:
--   1. Hospitality: What We Mean                     - 2 checks (Q1, Q2)
--   2. Mission: Why We Exist                         - 1 check  (Q3)
--   3. Vision: Where We Are Going                    - 1 check  (Q4)
--   4. Values: What We Believe                       - 2 checks (Q5, Q6)
--   5. The Hospitality Promise                       - 1 check  (Q7)
--   6. The Vital Partner Standard                    - 1 check  (Q8)
--
-- The section-anchor mapping in each INSERT below matches the
-- `Anchors` frontmatter block of PB-014.mdx. If the document is
-- edited such that an anchor renames, the corresponding question
-- row's `section_anchor` needs to move with it - question_key
-- (added by academy-10) is what makes that repairable rather than
-- a re-insert.
--
-- Ordering
-- ────────
-- sort_order runs 10, 20, 30 ... (leaves gaps for future insertions
-- without renumbering). Draft order follows the section order the
-- learner encounters them.
--
-- Q6 note - correct answer is option 'a'
-- ──────────────────────────────────────
-- Every other question puts the correct answer at option 'b'. Q6
-- deliberately inverts to option 'a'. Answer order shuffles at
-- render time per spec 18.6, so the stored position doesn't reach
-- the learner - but a uniform stored dataset would still show up
-- in any dry-run that skipped the shuffle, and a shuffle bug would
-- hide behind a uniform correct-position pattern. The inversion is
-- an authoring discipline that limits both drift shapes.
--
-- Not seeded here: `culture-os-standard-annual`
-- ─────────────────────────────────────────────
-- The Culture OS annual re-cert (`culture-os-standard-annual`)
-- covers the same five sections for salaried staff annually. This
-- migration deliberately does NOT duplicate the eight rows onto
-- it - the "correct a question in two places" defect shape is what
-- academy-10's question_key was invented to close, and duplicating
-- the rows would re-create the same drift. See the PR body for the
-- option tradeoff (duplicate vs make obligation_key nullable and
-- match on (doc_id, doc_version, section_anchor)) - Kevin decides,
-- this migration does not.
--
-- HOW TO APPLY
-- ────────────
-- Two sections meant to be run as separate submissions in Studio.
-- Same rationale as academy-9/academy-10.
--
--   Section A - eight INSERTs wrapped in one BEGIN/COMMIT so all
--               rows land together or none do.
--   Section B - verify block (row count + status distribution +
--               correct_option_id-in-options invariant).
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- SECTION A - EIGHT INSERTS
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Pre-flight ─────────────────────────────────────────────────────
DO $$
DECLARE
  v_has_key BOOLEAN;
  v_pb014 BOOLEAN;
BEGIN
  -- academy-10 must have landed (question_key exists).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'academy_questions'
      AND column_name = 'question_key'
  ) INTO v_has_key;
  IF NOT v_has_key THEN
    RAISE EXCEPTION 'academy-11 pre-flight: question_key column missing - academy-10 must land first';
  END IF;

  -- PB-014 must exist in documents (FK-less but sanity check the
  -- referenced doc is real - inserting questions on a phantom doc
  -- would be a silent-content defect).
  SELECT EXISTS (
    SELECT 1 FROM documents WHERE id = 'PB-014'
  ) INTO v_pb014;
  IF NOT v_pb014 THEN
    RAISE EXCEPTION 'academy-11 pre-flight: PB-014 not present in documents - author it before seeding its questions';
  END IF;
END $$;


-- ─── Q1: hospitality-player ─────────────────────────────────────────
INSERT INTO academy_questions (
  doc_id, obligation_key, doc_version, question_key,
  section_anchor, prompt, options, correct_option_id, sort_order, status
) VALUES (
  'PB-014', 'culture-os-standard', '1.0', 'hospitality-player',
  'Hospitality: What We Mean',
  'A player has had three bad at-bats and comes through the line without making eye contact. Which response is hospitality as this section defines it?',
  $json$[
    {
      "id": "a",
      "text": "Give him the same warm greeting you give everyone, delivered exactly the same way every time.",
      "explanation": "Close, but that is the version the section calls performed. A greeting delivered identically to everyone is a script, and the section is explicit that scripted hospitality is a checklist dressed up as caring. The anchor line is the test: genuine cannot be performed, it has to be inherent."
    },
    {
      "id": "b",
      "text": "Notice where he is, and adjust - a quieter greeting, or none, and make sure the thing he needs is already there.",
      "explanation": "That is it. The section defines hospitality as anticipating what the people around you need and acting on it - which means reading the person in front of you rather than running the same play regardless."
    }
  ]$json$::jsonb,
  'b', 10, 'draft'
);

-- ─── Q2: hospitality-service-vs ─────────────────────────────────────
INSERT INTO academy_questions (
  doc_id, obligation_key, doc_version, question_key,
  section_anchor, prompt, options, correct_option_id, sort_order, status
) VALUES (
  'PB-014', 'culture-os-standard', '1.0', 'hospitality-service-vs',
  'Hospitality: What We Mean',
  'The section separates service from hospitality. Which is true?',
  $json$[
    {
      "id": "a",
      "text": "Service and hospitality are two names for the same standard, measured differently.",
      "explanation": "Not quite, and the distinction is the point of the section. Service is the table. Hospitality is why they come back. Service is anticipation - food ready, line clear, labels accurate. It is the floor. Hospitality is what becomes possible once service is right and the guest can actually be present."
    },
    {
      "id": "b",
      "text": "Service is the foundation. Once the guest needs for nothing, hospitality becomes possible.",
      "explanation": "Right - and the order matters. Without service there is no hospitality to offer, which is why we do not trade the first for the second on a hard day."
    }
  ]$json$::jsonb,
  'b', 20, 'draft'
);

-- ─── Q3: mission-genuine ────────────────────────────────────────────
INSERT INTO academy_questions (
  doc_id, obligation_key, doc_version, question_key,
  section_anchor, prompt, options, correct_option_id, sort_order, status
) VALUES (
  'PB-014', 'culture-os-standard', '1.0', 'mission-genuine',
  'Mission: Why We Exist',
  'The Mission section names one word as the operative one. Which of these fails the Mission as written?',
  $json$[
    {
      "id": "a",
      "text": "A line that runs perfectly, on time, correct every day, delivered with practiced professional warmth.",
      "explanation": "That is a well-run service operation, and it is not the bar. The Mission names genuine as the operative word, and lists what does not count: performed, scripted, transactional. The section says players, coaches, dietitians, training staff and our own teams should all be able to feel the difference between a service operation and a hospitality operation. Practiced warmth is the thing they can feel the absence in."
    },
    {
      "id": "b",
      "text": "A line that runs perfectly and where the team genuinely knows the people coming through it.",
      "explanation": "Yes. Genuine is the operative word, and the test is whether the people we serve can feel the difference between a service operation and a hospitality operation."
    }
  ]$json$::jsonb,
  'b', 30, 'draft'
);

-- ─── Q4: vision-who-sets-the-bar ────────────────────────────────────
INSERT INTO academy_questions (
  doc_id, obligation_key, doc_version, question_key,
  section_anchor, prompt, options, correct_option_id, sort_order, status
) VALUES (
  'PB-014', 'culture-os-standard', '1.0', 'vision-who-sets-the-bar',
  'Vision: Where We Are Going',
  '"Vital partner" is the Vision. Who sets that bar?',
  $json$[
    {
      "id": "a",
      "text": "The client sets it through the Contract, and we meet what we have agreed to.",
      "explanation": "The Contract is what we are obligated to deliver, but it is not where the bar sits. The section is explicit: vital partner is the standard you hold yourself to before anyone holds it for you. An operator the client has to hold to the standard is not a vital partner - they are a vendor being managed."
    },
    {
      "id": "b",
      "text": "We hold ourselves to it before anyone holds us to it.",
      "explanation": "Exactly. It is the standard you hold before anyone holds it for you, which is what makes the difference between being managed and being irreplaceable."
    }
  ]$json$::jsonb,
  'b', 40, 'draft'
);

-- ─── Q5: values-humility-order ──────────────────────────────────────
INSERT INTO academy_questions (
  doc_id, obligation_key, doc_version, question_key,
  section_anchor, prompt, options, correct_option_id, sort_order, status
) VALUES (
  'PB-014', 'culture-os-standard', '1.0', 'values-humility-order',
  'Values: What We Believe',
  'Something breaks at your site. The Humility value names an order for what happens next. What is it?',
  $json$[
    {
      "id": "a",
      "text": "Understand it, explain what happened, then fix it.",
      "explanation": "Close, and the order is the whole point. The section says the humble move is to fix it, own it, and understand it - in that order. Understanding matters - it is the third step, not the missing one. What the value warns against is reaching for it first, because an explanation offered before the problem is fixed and owned lands as an excuse, whatever it was meant to be."
    },
    {
      "id": "b",
      "text": "Fix it, own it, then understand it.",
      "explanation": "That is the order, and the section is deliberate about it. Fix it, own it, understand it. The explanation still comes - it just comes last, once it is an explanation and not an excuse."
    }
  ]$json$::jsonb,
  'b', 50, 'draft'
);

-- ─── Q6: values-equity (CORRECT = 'a' by design) ───────────────────
-- Q6's correct answer is deliberately option 'a' rather than 'b'.
-- See file header for the authoring rationale.
INSERT INTO academy_questions (
  doc_id, obligation_key, doc_version, question_key,
  section_anchor, prompt, options, correct_option_id, sort_order, status
) VALUES (
  'PB-014', 'culture-os-standard', '1.0', 'values-equity',
  'Values: What We Believe',
  'The Equity value says our hourly teams are treated with the same respect as our executive team. Which is closer to what that asks of you?',
  $json$[
    {
      "id": "a",
      "text": "The same respect and the same hearing for everyone, whatever their role.",
      "explanation": "Yes. Hourly teams treated with the same respect as the executive team, and every voice heard - the value is about respect and access, not identical rules."
    },
    {
      "id": "b",
      "text": "The same rules applied identically to everyone, so nobody can claim different treatment.",
      "explanation": "That is consistency, and it is not the same thing. The value is about respect and being heard, not identical rules. The section examples are the tell: paid sick time before the law required it, 1.5x when we ask hourly teams to work holidays. Those are not one rule applied evenly - they are choices about looking after people."
    }
  ]$json$::jsonb,
  'a', 60, 'draft'
);

-- ─── Q7: promise-third-thing ────────────────────────────────────────
INSERT INTO academy_questions (
  doc_id, obligation_key, doc_version, question_key,
  section_anchor, prompt, options, correct_option_id, sort_order, status
) VALUES (
  'PB-014', 'culture-os-standard', '1.0', 'promise-third-thing',
  'The Hospitality Promise: Best Food, Best Service, Best Hospitality',
  '"Best Food, Best Service, Best Hospitality" is three things. What is the third one asking for?',
  $json$[
    {
      "id": "a",
      "text": "A consistently high standard of guest interaction, delivered the same way at every site.",
      "explanation": "Consistency is Best Service. The third promise is the one that cannot be standardised: genuine hospitality, not performed, not scripted, not transactional. The section examples are all specific to a person - learning a player name and saying it, noticing a hard day and asking a real question, making a birthday or a welcome-back after a road trip into a moment."
    },
    {
      "id": "b",
      "text": "Genuine attention to the actual person - names, noticing, the small thing made into a moment.",
      "explanation": "That is it. The third promise is the one that cannot be scripted, which is why the examples are all about a specific person rather than a standard interaction."
    }
  ]$json$::jsonb,
  'b', 70, 'draft'
);

-- ─── Q8: vital-partner-tell-first ───────────────────────────────────
INSERT INTO academy_questions (
  doc_id, obligation_key, doc_version, question_key,
  section_anchor, prompt, options, correct_option_id, sort_order, status
) VALUES (
  'PB-014', 'culture-os-standard', '1.0', 'vital-partner-tell-first',
  'The Vital Partner Standard',
  'Something goes wrong at your site and it will affect the client. When does the client hear about it?',
  $json$[
    {
      "id": "a",
      "text": "As soon as you have a fix, so you can bring the problem and the solution together.",
      "explanation": "Reasonable instinct, but there is a better answer here. The standard says we run toward problems, not away from them, and specifically that the client hears it from us first, not the other way around. Waiting for a fix risks them finding it first, and at that point the conversation is about trust rather than the problem."
    },
    {
      "id": "b",
      "text": "From us first, before they find it themselves - even if the fix is not ready yet.",
      "explanation": "Exactly. Telling them first is what earns the partnership - being the kind of operator they never have to chase."
    }
  ]$json$::jsonb,
  'b', 80, 'draft'
);

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION B - VERIFY BLOCK
-- ═══════════════════════════════════════════════════════════════════

-- P1. Eight rows landed under (PB-014, culture-os-standard, 1.0).
-- Expected: count = 8, all status='draft', all sort_order distinct.
SELECT count(*) AS total,
       count(*) FILTER (WHERE status = 'draft')     AS drafts,
       count(*) FILTER (WHERE status = 'approved')  AS approved,
       count(*) FILTER (WHERE status = 'retired')   AS retired,
       count(DISTINCT sort_order)                    AS distinct_sort_orders,
       count(DISTINCT question_key)                  AS distinct_keys
FROM academy_questions
WHERE doc_id = 'PB-014'
  AND obligation_key = 'culture-os-standard'
  AND doc_version = '1.0';
-- Expected: total=8, drafts=8, approved=0, retired=0,
--           distinct_sort_orders=8, distinct_keys=8.


-- P2. Every row's correct_option_id references one of the options
-- in that row's options array. This is the invariant academy-9's
-- CHECK cannot enforce (Postgres CHECKs cannot use subqueries).
-- Expected: 0 rows returned.
SELECT question_key, correct_option_id, options
FROM academy_questions
WHERE doc_id = 'PB-014'
  AND obligation_key = 'culture-os-standard'
  AND doc_version = '1.0'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(options) opt
    WHERE opt->>'id' = correct_option_id
  );


-- P3. Distribution of correct-option letters across the eight rows.
-- Expected: {'a': 1, 'b': 7} - Q6 is the deliberately-inverted row.
SELECT correct_option_id, count(*) AS n
FROM academy_questions
WHERE doc_id = 'PB-014'
  AND obligation_key = 'culture-os-standard'
  AND doc_version = '1.0'
GROUP BY correct_option_id
ORDER BY correct_option_id;


-- P4. Every row has explanation text on both its right and wrong
-- options (per spec 18.7: wrong-answer text lives in the wrong
-- option's explanation; right-answer text lives in the correct
-- option's explanation). Assert no explanation is null or empty.
-- Expected: 0 rows returned.
SELECT question_key, opt->>'id' AS option_id, opt->>'explanation' AS explanation
FROM academy_questions,
     jsonb_array_elements(options) opt
WHERE doc_id = 'PB-014'
  AND obligation_key = 'culture-os-standard'
  AND doc_version = '1.0'
  AND (opt->>'explanation' IS NULL OR btrim(opt->>'explanation') = '');


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- Kevin fills in below AFTER applying Section A (BEGIN/COMMIT
-- succeeded, 8 rows inserted) and running Section B verify block.
-- All expected shapes documented against each P1..P4 above.
--
-- Rows land as status='draft'. Approving them for issuance is a
-- separate Studio operation (UPDATE ... SET status='approved',
-- approved_by='k.fietek@kitchfix.com', approved_at=NOW()) after
-- Kevin reads each in context.
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- section_a_commit:   <expected: 8 INSERTs succeeded, COMMIT clean>
-- p1_counts:          <expected total=8 drafts=8 approved=0 retired=0
--                     distinct_sort_orders=8 distinct_keys=8>
-- p2_correct_in_opts: <expected 0 rows>
-- p3_correct_dist:    <expected a=1 b=7>
-- p4_explanations:    <expected 0 rows>
-- notes:              <optional>

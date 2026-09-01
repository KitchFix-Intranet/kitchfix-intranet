-- ═══════════════════════════════════════════════════════════════════
-- academy-12-strip-explanation-verdicts.sql
--
-- DML only. Migration 7 in the academy_* series. Strips the leading
-- verdict clauses from the eight seeded question explanations so the
-- UI's verdict header is the single source of the verdict.
--
-- Why
-- ───
-- D2 from the module-stepper prompt: the feedback panel renders its
-- own verdict header ("That is it." / "Not quite - let us look
-- again.") and then the stored explanation opens with the same words.
-- Fixed in the data (not the UI) so the seed reads correctly on
-- every future surface, and the UI stays the single source of the
-- verdict.
--
-- Approach
-- ────────
-- Rebuild the `options` JSONB per row via a straight UPDATE. Each
-- question is addressed by (doc_id, obligation_key, doc_version,
-- question_key) - the unique key added in academy-10. The
-- correct_option_id is UNCHANGED; only the text of the explanations
-- moves.
--
-- No schema change, no index change, no grant change.
--
-- Apply discipline
-- ────────────────
-- Author-only per convention. Kevin applies in Studio, comments
-- `applied in Studio: YES` to release the migration gate.
--
-- HOW TO APPLY
-- ────────────
-- Two sections, run as separate submissions:
--   Section A - eight UPDATE statements in one BEGIN/COMMIT.
--   Section B - verify block asserting every explanation starts
--               with a non-verdict character.
-- ═══════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════
-- SECTION A - eight UPDATEs
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- Q5 hospitality-player
UPDATE academy_questions
SET options = $json$[
  {
    "id": "a",
    "text": "Give him the same warm greeting you give everyone, delivered exactly the same way every time.",
    "explanation": "That is the version the section calls performed. A greeting delivered identically to everyone is a script, and the section is explicit that scripted hospitality is a checklist dressed up as caring. The anchor line is the test: genuine cannot be performed, it has to be inherent."
  },
  {
    "id": "b",
    "text": "Notice where he is, and adjust - a quieter greeting, or none, and make sure the thing he needs is already there.",
    "explanation": "The section defines hospitality as anticipating what the people around you need and acting on it - which means reading the person in front of you rather than running the same play regardless."
  }
]$json$::jsonb
WHERE doc_id = 'PB-014' AND obligation_key = 'culture-os-standard' AND doc_version = '1.0' AND question_key = 'hospitality-player';

-- Q6 hospitality-service-vs
UPDATE academy_questions
SET options = $json$[
  {
    "id": "a",
    "text": "Service and hospitality are two names for the same standard, measured differently.",
    "explanation": "The distinction is the point of the section. Service is the table. Hospitality is why they come back. Service is anticipation - food ready, line clear, labels accurate. It is the floor. Hospitality is what becomes possible once service is right and the guest can actually be present."
  },
  {
    "id": "b",
    "text": "Service is the foundation. Once the guest needs for nothing, hospitality becomes possible.",
    "explanation": "The order matters. Without service there is no hospitality to offer, which is why we do not trade the first for the second on a hard day."
  }
]$json$::jsonb
WHERE doc_id = 'PB-014' AND obligation_key = 'culture-os-standard' AND doc_version = '1.0' AND question_key = 'hospitality-service-vs';

-- Q7 mission-genuine
UPDATE academy_questions
SET options = $json$[
  {
    "id": "a",
    "text": "A line that runs perfectly, on time, correct every day, delivered with practiced professional warmth.",
    "explanation": "That is a well-run service operation, and it is not the bar. The Mission names genuine as the operative word, and lists what does not count: performed, scripted, transactional. The section says players, coaches, dietitians, training staff and our own teams should all be able to feel the difference between a service operation and a hospitality operation. Practiced warmth is the thing they can feel the absence in."
  },
  {
    "id": "b",
    "text": "A line that runs perfectly and where the team genuinely knows the people coming through it.",
    "explanation": "Genuine is the operative word, and the test is whether the people we serve can feel the difference between a service operation and a hospitality operation."
  }
]$json$::jsonb
WHERE doc_id = 'PB-014' AND obligation_key = 'culture-os-standard' AND doc_version = '1.0' AND question_key = 'mission-genuine';

-- Q8 vision-who-sets-the-bar
UPDATE academy_questions
SET options = $json$[
  {
    "id": "a",
    "text": "The client sets it through the Contract, and we meet what we have agreed to.",
    "explanation": "The Contract is what we are obligated to deliver, but it is not where the bar sits. The section is explicit: vital partner is the standard you hold yourself to before anyone holds it for you. An operator the client has to hold to the standard is not a vital partner - they are a vendor being managed."
  },
  {
    "id": "b",
    "text": "We hold ourselves to it before anyone holds us to it.",
    "explanation": "It is the standard you hold before anyone holds it for you, which is what makes the difference between being managed and being irreplaceable."
  }
]$json$::jsonb
WHERE doc_id = 'PB-014' AND obligation_key = 'culture-os-standard' AND doc_version = '1.0' AND question_key = 'vision-who-sets-the-bar';

-- Q9 values-humility-order
UPDATE academy_questions
SET options = $json$[
  {
    "id": "a",
    "text": "Understand it, explain what happened, then fix it.",
    "explanation": "The order is the whole point. The section says the humble move is to fix it, own it, and understand it - in that order. Understanding matters - it is the third step, not the missing one. What the value warns against is reaching for it first, because an explanation offered before the problem is fixed and owned lands as an excuse, whatever it was meant to be."
  },
  {
    "id": "b",
    "text": "Fix it, own it, then understand it.",
    "explanation": "The order is deliberate. Fix it, own it, understand it. The explanation still comes - it just comes last, once it is an explanation and not an excuse."
  }
]$json$::jsonb
WHERE doc_id = 'PB-014' AND obligation_key = 'culture-os-standard' AND doc_version = '1.0' AND question_key = 'values-humility-order';

-- Q10 values-equity (correct = a)
UPDATE academy_questions
SET options = $json$[
  {
    "id": "a",
    "text": "The same respect and the same hearing for everyone, whatever their role.",
    "explanation": "Hourly teams treated with the same respect as the executive team, and every voice heard - the value is about respect and access, not identical rules."
  },
  {
    "id": "b",
    "text": "The same rules applied identically to everyone, so nobody can claim different treatment.",
    "explanation": "That is consistency, and it is not the same thing. The value is about respect and being heard, not identical rules. The section examples are the tell: paid sick time before the law required it, 1.5x when we ask hourly teams to work holidays. Those are not one rule applied evenly - they are choices about looking after people."
  }
]$json$::jsonb
WHERE doc_id = 'PB-014' AND obligation_key = 'culture-os-standard' AND doc_version = '1.0' AND question_key = 'values-equity';

-- Q11 promise-third-thing
UPDATE academy_questions
SET options = $json$[
  {
    "id": "a",
    "text": "A consistently high standard of guest interaction, delivered the same way at every site.",
    "explanation": "Consistency is Best Service. The third promise is the one that cannot be standardised: genuine hospitality, not performed, not scripted, not transactional. The section examples are all specific to a person - learning a player name and saying it, noticing a hard day and asking a real question, making a birthday or a welcome-back after a road trip into a moment."
  },
  {
    "id": "b",
    "text": "Genuine attention to the actual person - names, noticing, the small thing made into a moment.",
    "explanation": "The third promise is the one that cannot be scripted, which is why the examples are all about a specific person rather than a standard interaction."
  }
]$json$::jsonb
WHERE doc_id = 'PB-014' AND obligation_key = 'culture-os-standard' AND doc_version = '1.0' AND question_key = 'promise-third-thing';

-- Q12 vital-partner-tell-first
UPDATE academy_questions
SET options = $json$[
  {
    "id": "a",
    "text": "As soon as you have a fix, so you can bring the problem and the solution together.",
    "explanation": "There is a better answer here. The standard says we run toward problems, not away from them, and specifically that the client hears it from us first, not the other way around. Waiting for a fix risks them finding it first, and at that point the conversation is about trust rather than the problem."
  },
  {
    "id": "b",
    "text": "From us first, before they find it themselves - even if the fix is not ready yet.",
    "explanation": "Telling them first is what earns the partnership - being the kind of operator they never have to chase."
  }
]$json$::jsonb
WHERE doc_id = 'PB-014' AND obligation_key = 'culture-os-standard' AND doc_version = '1.0' AND question_key = 'vital-partner-tell-first';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════
-- SECTION B - VERIFY
-- ═══════════════════════════════════════════════════════════════════

-- P1. Assert no explanation on any of the eight rows starts with the
-- verdict tokens the UI header owns. Any row here is a defect.
-- Expected: 0 rows.
SELECT question_key, opt->>'id' AS option_id,
       substr(opt->>'explanation', 1, 60) AS explanation_head
FROM academy_questions,
     jsonb_array_elements(options) opt
WHERE doc_id = 'PB-014'
  AND obligation_key = 'culture-os-standard'
  AND doc_version = '1.0'
  AND (
    opt->>'explanation' ILIKE 'That is it.%'
    OR opt->>'explanation' ILIKE 'Not quite%'
    OR opt->>'explanation' ILIKE 'Close, %'
    OR opt->>'explanation' ILIKE 'Yes. %'
    OR opt->>'explanation' ILIKE 'Exactly. %'
    OR opt->>'explanation' ILIKE 'Right - %'
    OR opt->>'explanation' ILIKE 'Reasonable instinct%'
  );

-- P2. All eight rows still have exactly 2 options each; options
-- array not corrupted by the rewrite.
-- Expected: 8 rows, each with n_options = 2.
SELECT question_key, jsonb_array_length(options) AS n_options
FROM academy_questions
WHERE doc_id = 'PB-014'
  AND obligation_key = 'culture-os-standard'
  AND doc_version = '1.0'
ORDER BY sort_order;

-- P3. correct_option_id UNCHANGED for every row (defensive; the
-- UPDATE only touched options.explanation). Q10 stays correct='a';
-- all others 'b'.
-- Expected: 8 rows; distribution a=1, b=7.
SELECT correct_option_id, count(*) AS n
FROM academy_questions
WHERE doc_id = 'PB-014'
  AND obligation_key = 'culture-os-standard'
  AND doc_version = '1.0'
GROUP BY correct_option_id
ORDER BY correct_option_id;


-- ═══════════════════════════════════════════════════════════════════
--
--   A P P L I E D   I N   S T U D I O   A T T E S T A T I O N
--
-- ═══════════════════════════════════════════════════════════════════
--
-- applied in Studio: PENDING
-- sha:                <fill in commit SHA>
-- applied by:         k.fietek@kitchfix.com
-- applied at:         <fill in ISO timestamp>
-- section_a_commit:   <expected: 8 UPDATEs succeeded, COMMIT clean>
-- p1_verdict_leaks:   <expected 0 rows>
-- p2_options_shape:   <expected 8 rows, all n_options = 2>
-- p3_correct_dist:    <expected a=1 b=7 (Q10 stays at 'a')>
-- notes:              <optional>

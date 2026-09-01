// /api/academy/module/[requirementId]
//
// Returns everything the Focus view needs to render the read-check-
// sign flow for one requirement. Single round-trip: doc meta,
// pre-rendered HTML from document_content, requirement + obligation
// + cycle context, approved questions (with server-side shuffled
// options, correct_option_id EXCLUDED), current progress state, and
// any existing attestation.
//
// SECURITY - correct_option_id NEVER leaves this route.
// ─────────────────────────────────────────────────────
// The questions query below uses an EXPLICIT column list that OMITS
// correct_option_id by CONSTRUCTION. This is not a filter applied
// after the query returns; the column does not enter the query. A
// future refactor that swaps to select("*") would silently leak
// every answer in the system, which is why the column list is
// verbose here and the comment names the trap.
//
// See academy-9 migration + spec Section 8: correct_option_id is
// server-side-only, grading happens in /api/academy/check.
//
// SHUFFLE - server-side, per request (spec 18.6).
// ───────────────────────────────────────────────
// options[] is a JSONB array on each question row. We shuffle it in
// JS after fetch, before returning. Shuffle happens per REQUEST so
// the answer positions are not stable across attempts. The id field
// inside each option is preserved verbatim - grading uses the id,
// not the position.
//
// PROGRESS - upserts on fetch.
// ────────────────────────────
// academy_module_progress is mutable scratch state (spec 13).
// On every fetch we upsert (worker_id, requirement_id): first fetch
// inserts started_at + last_seen_at; subsequent fetches bump
// last_seen_at. The time_spent_seconds accumulator moves on check
// attempts and on sign (in the /check and /sign routes).
//
// ZERO-QUESTIONS MODULE - a real state today.
// ───────────────────────────────────────────
// Kevin's 8 requirements: only culture-os-standard has approved
// questions (8 rows). The other seven have zero. This route MUST
// return questions=[] for those and let the client fall through to
// a 2-step (read + sign) rail. Not an error.
//
// FENCE - ACADEMY_PREVIEW_ONLY + TEST_MODE bypass, same shape as
// the room + document routes.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import {
  resolveAcademyIdentity,
  ACADEMY_PREVIEW_ONLY,
  ACADEMY_PREVIEW_ALLOWLIST,
} from "@/lib/academy/resolveIdentity";

export const dynamic = "force-dynamic";

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Fisher-Yates in place. Same shuffle every call site so behavior
// stays uniform; if a future test needs deterministic output, seed
// via a parameter here.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Step boundary computation ─────────────────────────────────────
// Spec 18.5 (amended 2026-09-01 by the module-stepper PR): a step is
// a heading whose content reads in roughly three minutes or less.
// Where a section exceeds that, the step boundary descends a heading
// level.
//
// Reading rate: 200 wpm. 3 min * 200 wpm = 600 words. Configurable
// via WORDS_PER_STEP below.
const WORDS_PER_STEP = 600;
const HEADING_RE = /<h([1-3])[^>]*>([^<]+)<\/h\1>/gi;

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function slugAnchor(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function countWords(html) {
  // Strip tags, collapse whitespace, count non-empty tokens.
  const text = String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return 0;
  return text.split(" ").filter(Boolean).length;
}

// Parse the doc HTML into a flat list of headings + a nested tree.
// Each node: { level, text, start, end, chunkHtml, wordCount, children }.
function parseHeadingTree(html) {
  if (!html) return [];
  const flat = [];
  let m;
  const re = new RegExp(HEADING_RE.source, "gi");
  while ((m = re.exec(html)) !== null) {
    flat.push({ level: Number(m[1]), text: decodeEntities(m[2]).trim(), start: m.index });
  }
  if (flat.length === 0) return [];
  // Compute end + chunk per heading (end = next heading of same OR
  // higher level, or EOF).
  for (let i = 0; i < flat.length; i += 1) {
    const cur = flat[i];
    let end = html.length;
    for (let j = i + 1; j < flat.length; j += 1) {
      if (flat[j].level <= cur.level) { end = flat[j].start; break; }
    }
    cur.end = end;
    cur.chunkHtml = html.slice(cur.start, cur.end);
    cur.wordCount = countWords(cur.chunkHtml);
  }
  // Build the tree: attach each heading to the last heading of a
  // shallower level.
  const roots = [];
  const stack = [];
  for (const node of flat) {
    node.children = [];
    while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return roots;
}

// Given a heading tree + an optional source_section filter, emit the
// step list. Descends a level whenever a node's total word count
// exceeds WORDS_PER_STEP.
//
// Each emitted step carries:
//   - descended: true iff produced by the isBig-descend branch (a
//     sub-step of a parent that was too big). Named roots have
//     descended=false. Only descended sub-steps are candidates for
//     the merge pass below.
//   - parentKey: identity of the immediate parent in the tree
//     (empty string for root emissions). Two descended steps are
//     merge candidates ONLY if their parentKey matches.
function computeSteps(tree, sourceSectionList) {
  const inScope = (node) => {
    if (!sourceSectionList || sourceSectionList.length === 0) return true;
    return sourceSectionList.some(
      (s) => s.trim().toLowerCase() === node.text.trim().toLowerCase()
    );
  };
  const out = [];
  const emit = (node, descended, parentKey) => {
    const isBig = node.wordCount > WORDS_PER_STEP && node.children.length > 0;
    if (isBig) {
      const nextParent = slugAnchor(node.text);
      for (const child of node.children) emit(child, true, nextParent);
      return;
    }
    out.push({
      key: slugAnchor(node.text),
      anchor: node.text,
      level: node.level,
      html: node.chunkHtml,
      wordCount: node.wordCount,
      descended,
      parentKey,
    });
  };
  // Two modes:
  //   (1) source_section filter present: walk the tree, emit any
  //       ROOT node whose text is in the list. If it is big, descend.
  //   (2) No filter: emit every top-level (root) node, descending as
  //       needed.
  for (const root of tree) {
    if (!inScope(root)) continue;
    emit(root, false, "");
  }
  return out;
}

// After computeSteps + question-attachment, walk the emitted steps
// and merge undersized siblings. Two-sided rule: computeSteps SPLITS
// when a parent runs long (>600w); mergeSteps combines when descended
// siblings run short. Prevents the "22-word step wearing a card"
// failure that fragmenting Culinary Defined into 15 steps produced.
//
// Merge is permitted only when ALL of these hold for two consecutive
// steps A and B:
//   1. Both were produced by the descend branch (A.descended && B.descended).
//      Named roots the author called out individually in source_section
//      stay solo - the section list is a deliberate outline.
//   2. Same immediate parent (A.parentKey === B.parentKey). Never
//      merge across a parent boundary.
//   3. Neither carries an attached check (A.questionIds.length === 0
//      && B.questionIds.length === 0). A check is anchored to its
//      section; merging would confuse "which section is being tested".
//   4. Combined wordCount <= WORDS_PER_STEP.
//
// After the greedy pass, one trailing rule: if the LAST merged step
// in a parent group has wordCount < TRAILING_STUB_WORDS, fold it into
// the previous merged step of the same parent (only if that previous
// step also has no checks - never overwrite a check anchor). This
// rule may push slightly past the cap; a 620-word step is better than
// an orphaned 22-word one.
const TRAILING_STUB_WORDS = 150;
function mergeSteps(rawSteps, stepQuestions) {
  if (rawSteps.length === 0) return { steps: [], questionIdsByStep: [] };

  const canMerge = (aIdx, bIdx) => {
    const a = rawSteps[aIdx];
    const b = rawSteps[bIdx];
    if (!a.descended || !b.descended) return false;
    if (a.parentKey !== b.parentKey) return false;
    if ((stepQuestions[aIdx]?.length || 0) > 0) return false;
    if ((stepQuestions[bIdx]?.length || 0) > 0) return false;
    return true;
  };

  // Greedy pass: build merged groups (each group = array of raw
  // indices in order).
  const groups = [];
  let cur = [0];
  for (let i = 1; i < rawSteps.length; i += 1) {
    const last = cur[cur.length - 1];
    const curWords = cur.reduce((acc, idx) => acc + rawSteps[idx].wordCount, 0);
    if (canMerge(last, i) && curWords + rawSteps[i].wordCount <= WORDS_PER_STEP) {
      cur.push(i);
    } else {
      groups.push(cur);
      cur = [i];
    }
  }
  groups.push(cur);

  // Trailing-stub pass: for each group with wordCount < TRAILING_STUB_WORDS,
  // if the previous group is a valid merge target (mergeable last-of-prev
  // with first-of-current), append this group's members to the previous
  // group even if it pushes past cap.
  const merged = [];
  for (const g of groups) {
    const words = g.reduce((acc, idx) => acc + rawSteps[idx].wordCount, 0);
    if (
      words < TRAILING_STUB_WORDS &&
      merged.length > 0 &&
      canMerge(merged[merged.length - 1][merged[merged.length - 1].length - 1], g[0])
    ) {
      merged[merged.length - 1].push(...g);
    } else {
      merged.push(g);
    }
  }

  // Assemble output. First-section leading heading is stripped from
  // the merged HTML (it renders as the step title in .opd-focus-step-h2);
  // subsequent sections keep their headings so they render as inline
  // sub-headings within the step card body.
  const stripLeadingHeading = (html) =>
    String(html || "").replace(/^\s*<h[1-3][^>]*>[^<]*<\/h[1-3]>\s*/i, "");

  const steps = [];
  const questionIdsByStep = [];
  for (const g of merged) {
    const first = rawSteps[g[0]];
    const anchors = g.map((idx) => rawSteps[idx].anchor);
    const wordCount = g.reduce((acc, idx) => acc + rawSteps[idx].wordCount, 0);
    // First chunk: strip the leading heading (rendered as step title).
    // Subsequent chunks: keep verbatim (their headings are subheadings).
    const chunks = g.map((idx, j) =>
      j === 0 ? stripLeadingHeading(rawSteps[idx].html) : rawSteps[idx].html
    );
    const html = chunks.join("");
    const questionIds = g.flatMap((idx) => stepQuestions[idx] || []);
    steps.push({
      key: first.key,
      anchor: first.anchor,
      anchors,
      level: first.level,
      html,
      wordCount,
    });
    questionIdsByStep.push(questionIds);
  }
  return { steps, questionIdsByStep };
}

export async function GET(request, ctx) {
  const testModeBypass =
    process.env.TEST_MODE === "true" && process.env.VERCEL !== "1";

  const session = await auth();
  const email = testModeBypass
    ? (ACADEMY_PREVIEW_ALLOWLIST[0] || "test@example.invalid")
    : normEmail(session?.user?.email);

  if (!email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!testModeBypass && ACADEMY_PREVIEW_ONLY && !ACADEMY_PREVIEW_ALLOWLIST.includes(email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const params = await ctx.params;
  const requirementId = params?.requirementId;
  if (!requirementId || !UUID_RE.test(requirementId)) {
    return NextResponse.json(
      { error: "bad_request", detail: "requirementId must be a UUID" },
      { status: 400 }
    );
  }

  const supa = getServiceClient();

  let identity;
  try {
    identity = await resolveAcademyIdentity(email, { supa });
  } catch (err) {
    console.error("[api/academy/module] resolve threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "identity" }, { status: 500 });
  }
  if (!identity) {
    return NextResponse.json({ error: "no_roster_row" }, { status: 404 });
  }

  // Load the requirement. worker_id filter is load-bearing - the
  // viewer must own the requirement they are opening, and we do not
  // trust the requirementId alone. Same defense as /api/academy/
  // document.
  const reqQ = await supa
    .from("academy_requirements")
    .select("requirement_id, worker_id, person_id, doc_id, obligation_key, doc_version, est_minutes, source, cycle_id, due_date, issued_at, waived_at, waive_reason")
    .eq("requirement_id", requirementId)
    .eq("worker_id", identity.workerId)
    .maybeSingle();
  if (reqQ.error) {
    console.error("[api/academy/module] requirement:", reqQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "requirement" }, { status: 500 });
  }
  if (!reqQ.data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const req = reqQ.data;

  // Doc, obligation, cycle, content, questions, attempts, existing
  // attestation, progress in parallel. Single round-trip.
  const [docQ, obQ, cycleQ, contentQ, questionsQ, attemptsQ, attestationQ, progressQ] = await Promise.all([
    supa
      .from("documents")
      .select("id, title, doc_class, status, version, shelf, owner, approver, effective_date, last_reviewed, next_review, updated_at, card_line, summary")
      .eq("id", req.doc_id)
      .maybeSingle(),
    supa
      .from("academy_obligations")
      .select("doc_id, obligation_key, doc_version, source_section, description, type, cadence, est_minutes, applies_to, owner")
      .eq("doc_id", req.doc_id)
      .eq("obligation_key", req.obligation_key)
      .maybeSingle(),
    req.cycle_id != null
      ? supa
          .from("academy_cycles")
          .select("cycle_id, label, period_start, period_end, status, fiscal_year, fiscal_period_no")
          .eq("cycle_id", req.cycle_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supa
      .from("document_content")
      .select("html, content_hash, rendered_at")
      .eq("doc_id", req.doc_id)
      .eq("lang", "en")
      .maybeSingle(),
    // CRITICAL - explicit column list, correct_option_id OMITTED by
    // construction. Do NOT swap this to select("*") - it would leak
    // every answer in the system to every client. See file header.
    supa
      .from("academy_questions")
      .select("question_id, question_key, doc_id, obligation_key, doc_version, section_anchor, prompt, options, sort_order")
      .eq("doc_id", req.doc_id)
      .eq("obligation_key", req.obligation_key)
      .eq("doc_version", req.doc_version)
      .eq("status", "approved")
      .order("sort_order", { ascending: true }),
    supa
      .from("academy_check_attempts")
      .select("attempt_id, question_id, selected_option_id, correct, attempted_at")
      .eq("worker_id", identity.workerId)
      .eq("requirement_id", requirementId)
      .order("attempted_at", { ascending: true }),
    supa
      .from("academy_attestations")
      .select("attestation_id, worker_id, doc_id, obligation_key, doc_version, typed_name, signed_at, attempts_count, time_spent_seconds, certificate_serial, source")
      .eq("worker_id", identity.workerId)
      .eq("requirement_id", requirementId)
      .maybeSingle(),
    supa
      .from("academy_module_progress")
      .select("worker_id, requirement_id, sections_seen, started_at, last_seen_at, time_spent_seconds")
      .eq("worker_id", identity.workerId)
      .eq("requirement_id", requirementId)
      .maybeSingle(),
  ]);

  for (const [scope, q] of [
    ["doc", docQ], ["obligation", obQ], ["cycle", cycleQ], ["content", contentQ],
    ["questions", questionsQ], ["attempts", attemptsQ], ["attestation", attestationQ], ["progress", progressQ],
  ]) {
    if (q.error) {
      console.error(`[api/academy/module] ${scope}:`, q.error.message);
      return NextResponse.json({ error: "server_error", scope }, { status: 500 });
    }
  }
  if (!docQ.data) {
    return NextResponse.json({ error: "not_found", scope: "doc" }, { status: 404 });
  }

  const doc = docQ.data;
  const ob = obQ.data || null;
  const cyc = cycleQ.data || null;
  const content = contentQ.data || null;
  const questions = questionsQ.data || [];
  const attempts = attemptsQ.data || [];
  const attestation = attestationQ.data || null;
  const progressRow = progressQ.data || null;

  // Progress upsert. First fetch inserts started_at + last_seen_at;
  // subsequent fetches bump last_seen_at. Errors are logged but not
  // fatal - a stale last_seen_at does not affect the sign gates,
  // it only affects a future time_spent computation.
  if (progressRow == null) {
    const insQ = await supa
      .from("academy_module_progress")
      .insert({
        worker_id: identity.workerId,
        requirement_id: requirementId,
        sections_seen: [],
        started_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        time_spent_seconds: 0,
      });
    if (insQ.error) {
      console.error("[api/academy/module] progress insert:", insQ.error.message);
    }
  } else {
    const updQ = await supa
      .from("academy_module_progress")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("worker_id", identity.workerId)
      .eq("requirement_id", requirementId);
    if (updQ.error) {
      console.error("[api/academy/module] progress update:", updQ.error.message);
    }
  }

  // Build progress summary. `attempts_by_question` counts total +
  // correct per question_id. `all_correct_ids` names which questions
  // have >=1 correct attempt (the sign-gate criterion). `ready_to_
  // sign` is the boolean the client uses to enable the sign step.
  const attemptsByQuestion = {};
  const correctByQuestion = new Set();
  for (const a of attempts) {
    const bucket = attemptsByQuestion[a.question_id] || { total: 0, correct: 0, last_correct_at: null };
    bucket.total += 1;
    if (a.correct) {
      bucket.correct += 1;
      bucket.last_correct_at = a.attempted_at;
      correctByQuestion.add(a.question_id);
    }
    attemptsByQuestion[a.question_id] = bucket;
  }
  const readyToSign =
    questions.length === 0 ||
    questions.every((q) => correctByQuestion.has(q.question_id));

  // Compute step boundaries. `steps` is what the client renders one
  // at a time (spec 18.5, amended by the module-stepper PR). Each
  // step carries its HTML chunk, wordCount, and the ordered list of
  // approved-question ids scoped to its anchor.
  const sourceSectionList = ob?.source_section
    ? String(ob.source_section).split(/;\s*/).map((s) => s.trim()).filter(Boolean)
    : null;
  const headingTree = parseHeadingTree(content?.html || "");
  const rawSteps = computeSteps(headingTree, sourceSectionList);
  // Attach questions to steps by anchor match. A question whose
  // section_anchor does not match any step is a data drift
  // (rare; surfaces here as an orphaned question). Return the
  // unmatched ids in a `steps_orphan_questions` field so the client
  // can render them at the end as a safety net rather than dropping
  // them silently.
  const anchorIndex = new Map();
  rawSteps.forEach((s, i) => anchorIndex.set(s.anchor.toLowerCase(), i));
  const rawStepQuestions = rawSteps.map(() => []);
  const orphanQuestionIds = [];
  for (const q of questions) {
    const key = String(q.section_anchor || "").trim().toLowerCase();
    const idx = anchorIndex.get(key);
    if (idx == null) {
      orphanQuestionIds.push(q.question_id);
    } else {
      rawStepQuestions[idx].push(q.question_id);
    }
  }
  // Merge pass: fold undersized descended siblings so a doc that
  // splits into 15 stubs collapses to a natural 5. Named roots and
  // checked steps are protected (see mergeSteps header).
  const { steps: mergedSteps, questionIdsByStep } = mergeSteps(rawSteps, rawStepQuestions);
  const steps = mergedSteps.map((s, i) => ({
    key: s.key,
    anchor: s.anchor,
    anchors: s.anchors,
    level: s.level,
    html: s.html,
    wordCount: s.wordCount,
    questionIds: questionIdsByStep[i],
    // Estimated minutes: word count at 200 wpm, rounded up to at
    // least 1. UI uses this to display "About N min" on the step
    // rail alongside the check count.
    estMinutes: Math.max(1, Math.ceil(s.wordCount / 200)),
  }));

  // Resume-at-furthest step. `sections_seen` on progress is the
  // authoritative record of which step keys the operator has moved
  // past. Client uses this to mount at the correct step.
  const seenKeys = new Set(
    Array.isArray(progressRow?.sections_seen) ? progressRow.sections_seen : []
  );
  // "furthest" = index of the first step whose key is NOT in
  // seenKeys, OR the sign step (steps.length) if all seen.
  let furthestStepIndex = 0;
  for (let i = 0; i < steps.length; i += 1) {
    if (seenKeys.has(steps[i].key)) furthestStepIndex = i + 1;
    else break;
  }

  // Sanitize + shuffle questions for the wire. options is shuffled
  // per REQUEST; id preserved. correct_option_id was never selected.
  const wireQuestions = questions.map((q) => ({
    question_id: q.question_id,
    question_key: q.question_key,
    section_anchor: q.section_anchor,
    prompt: q.prompt,
    options: shuffle(Array.isArray(q.options) ? q.options : []),
    sort_order: q.sort_order,
  }));

  return NextResponse.json({
    ok: true,
    viewer: {
      workerId: identity.workerId,
      personId: identity.personId,
      displayName: identity.displayName,
    },
    doc: {
      id: doc.id,
      title: doc.title || doc.id,
      doc_class: doc.doc_class,
      status: doc.status,
      version: doc.version,
      shelf: doc.shelf,
      owner: doc.owner,
      approver: doc.approver,
      effective_date: doc.effective_date,
      last_reviewed: doc.last_reviewed,
      next_review: doc.next_review,
      updated_at: doc.updated_at,
      card_line: doc.card_line,
      summary: doc.summary,
    },
    content_html: content?.html || null,
    content_rendered_at: content?.rendered_at || null,
    requirement: {
      requirement_id: req.requirement_id,
      doc_id: req.doc_id,
      obligation_key: req.obligation_key,
      doc_version: req.doc_version,
      est_minutes: req.est_minutes,
      source: req.source,
      cycle_id: req.cycle_id,
      due_date: req.due_date,
      issued_at: req.issued_at,
      waived: req.waived_at != null,
    },
    obligation: ob
      ? {
          obligation_key: ob.obligation_key,
          doc_version: ob.doc_version,
          source_section: ob.source_section,
          description: ob.description,
          type: ob.type,
          cadence: ob.cadence,
          est_minutes: ob.est_minutes,
          applies_to: ob.applies_to,
          owner: ob.owner,
        }
      : null,
    cycle: cyc
      ? {
          cycle_id: cyc.cycle_id,
          label: cyc.label,
          period_start: cyc.period_start,
          period_end: cyc.period_end,
          status: cyc.status,
        }
      : null,
    questions: wireQuestions,
    steps,
    steps_orphan_questions: orphanQuestionIds,
    progress: {
      attempts_by_question: attemptsByQuestion,
      all_correct_ids: [...correctByQuestion],
      ready_to_sign: readyToSign,
      started_at: progressRow?.started_at || new Date().toISOString(),
      last_seen_at: progressRow?.last_seen_at || null,
      time_spent_seconds: progressRow?.time_spent_seconds ?? 0,
      sections_seen: Array.isArray(progressRow?.sections_seen) ? progressRow.sections_seen : [],
      furthest_step_index: furthestStepIndex,
    },
    attestation: attestation
      ? {
          attestation_id: attestation.attestation_id,
          doc_id: attestation.doc_id,
          obligation_key: attestation.obligation_key,
          doc_version: attestation.doc_version,
          typed_name: attestation.typed_name,
          signed_at: attestation.signed_at,
          attempts_count: attestation.attempts_count,
          time_spent_seconds: attestation.time_spent_seconds,
          certificate_serial: attestation.certificate_serial,
          source: attestation.source,
        }
      : null,
  });
}

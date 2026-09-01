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
    progress: {
      attempts_by_question: attemptsByQuestion,
      all_correct_ids: [...correctByQuestion],
      ready_to_sign: readyToSign,
      started_at: progressRow?.started_at || new Date().toISOString(),
      last_seen_at: progressRow?.last_seen_at || null,
      time_spent_seconds: progressRow?.time_spent_seconds ?? 0,
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

// /api/academy/check
//
// Body: { requirementId, questionId, selectedOptionId }
//
// Grading happens HERE and only here. The route reads the question's
// correct_option_id in a query the client cannot inspect, compares
// server-side, records the attempt in academy_check_attempts (right
// or wrong, every time - spec 8), and returns { correct, explanation }
// where the explanation is for the SELECTED option, not all of them.
//
// Returning every explanation would leak the answer by process of
// elimination: the correct option's explanation is warm-and-affirms,
// the wrong ones are corrective. This route returns only the one
// the client picked.
//
// Unlimited attempts. No lockout, no cooldown, no attempt cap (spec 8).
// Every attempt is recorded. Wrong attempts are evidence, not failure.
//
// FENCE - ACADEMY_PREVIEW_ONLY + TEST_MODE bypass.
// APPEND-ONLY - the check_attempts table's grant surface refuses
// UPDATE/DELETE/TRUNCATE (academy-9). This route only INSERTs.

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

export async function POST(request) {
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

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request", detail: "invalid JSON body" }, { status: 400 });
  }
  const requirementId = body?.requirementId;
  const questionId = body?.questionId;
  const selectedOptionId = body?.selectedOptionId;
  if (!requirementId || !UUID_RE.test(String(requirementId))) {
    return NextResponse.json({ error: "bad_request", detail: "requirementId must be a UUID" }, { status: 400 });
  }
  if (questionId == null || !Number.isFinite(Number(questionId))) {
    return NextResponse.json({ error: "bad_request", detail: "questionId must be a number" }, { status: 400 });
  }
  if (!selectedOptionId || typeof selectedOptionId !== "string") {
    return NextResponse.json({ error: "bad_request", detail: "selectedOptionId must be a string" }, { status: 400 });
  }

  const supa = getServiceClient();

  let identity;
  try {
    identity = await resolveAcademyIdentity(email, { supa });
  } catch (err) {
    console.error("[api/academy/check] resolve threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "identity" }, { status: 500 });
  }
  if (!identity) {
    return NextResponse.json({ error: "no_roster_row" }, { status: 404 });
  }

  // Verify the requirement belongs to this viewer.
  const reqQ = await supa
    .from("academy_requirements")
    .select("requirement_id, worker_id, person_id, doc_id, obligation_key, doc_version, waived_at")
    .eq("requirement_id", requirementId)
    .eq("worker_id", identity.workerId)
    .maybeSingle();
  if (reqQ.error) {
    console.error("[api/academy/check] requirement lookup:", reqQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "requirement" }, { status: 500 });
  }
  if (!reqQ.data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const req = reqQ.data;

  // Load the question. Verify it belongs to the requirement's
  // (doc_id, obligation_key, doc_version) tuple - a client should
  // not be able to submit a question_id from a different module and
  // record an attempt against this requirement.
  //
  // SELECT correct_option_id + options here because THIS is the
  // grading site. correct_option_id is compared in memory and never
  // returned to the caller.
  const qQ = await supa
    .from("academy_questions")
    .select("question_id, doc_id, obligation_key, doc_version, status, correct_option_id, options")
    .eq("question_id", Number(questionId))
    .maybeSingle();
  if (qQ.error) {
    console.error("[api/academy/check] question lookup:", qQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "question" }, { status: 500 });
  }
  if (!qQ.data) {
    return NextResponse.json({ error: "not_found", scope: "question" }, { status: 404 });
  }
  const q = qQ.data;
  if (
    q.doc_id !== req.doc_id ||
    q.obligation_key !== req.obligation_key ||
    q.doc_version !== req.doc_version
  ) {
    return NextResponse.json(
      { error: "bad_request", detail: "question does not belong to this requirement's module" },
      { status: 400 }
    );
  }
  if (q.status !== "approved") {
    return NextResponse.json(
      { error: "bad_request", detail: "question is not approved" },
      { status: 400 }
    );
  }

  // Grade server-side. Compare selectedOptionId against
  // correct_option_id (equality on the id string). Look up the
  // explanation for the SELECTED option only.
  const isCorrect = q.correct_option_id === selectedOptionId;
  const opts = Array.isArray(q.options) ? q.options : [];
  const selectedOpt = opts.find((o) => o && o.id === selectedOptionId);
  if (!selectedOpt) {
    return NextResponse.json(
      { error: "bad_request", detail: "selectedOptionId does not match any option on this question" },
      { status: 400 }
    );
  }
  const explanation = String(selectedOpt.explanation || "");

  // Record the attempt. Every attempt, right or wrong. Insert-only;
  // the append-only fence on academy_check_attempts guarantees no
  // caller (including a future refactor of this route) can UPDATE
  // or DELETE.
  const insQ = await supa
    .from("academy_check_attempts")
    .insert({
      worker_id: identity.workerId,
      person_id: identity.personId,
      requirement_id: requirementId,
      question_id: Number(questionId),
      doc_version: req.doc_version,
      selected_option_id: selectedOptionId,
      correct: isCorrect,
    })
    .select("attempt_id, attempted_at")
    .single();
  if (insQ.error) {
    console.error("[api/academy/check] attempt insert:", insQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "insert" }, { status: 500 });
  }

  // Bump last_seen_at on module_progress so the elapsed-time
  // accumulator reflects reality when /sign reads it. Non-fatal.
  await supa
    .from("academy_module_progress")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("worker_id", identity.workerId)
    .eq("requirement_id", requirementId);

  return NextResponse.json({
    ok: true,
    correct: isCorrect,
    explanation,
    attempt_id: insQ.data?.attempt_id,
    attempted_at: insQ.data?.attempted_at,
  });
}

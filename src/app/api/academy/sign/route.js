// /api/academy/sign
//
// Body: { requirementId, attestationId, typedName, attestationText,
//         timeSpentSeconds? }
//
// The one route that lands a signature. Five server-side gates, all
// of which must pass, then an INSERT into academy_attestations that
// is idempotent by the client-supplied attestationId.
//
// GATES
// ─────
// 1. Requirement belongs to the authenticated worker (no trusting
//    a requirement_id from the client).
// 2. Not already satisfied - no existing attestation row for this
//    (worker_id, requirement_id).
// 3. Every approved question for the (doc_id, obligation_key,
//    doc_version) tuple has at least one CORRECT attempt by this
//    worker for this requirement. Zero approved questions is a
//    legitimate state and passes trivially (spec: modules without
//    questions render read + sign, no check step).
// 4. typedName matches the authenticated person's display_name.
//    Case-insensitive, whitespace-trimmed, otherwise exact.
// 5. The requirement is not waived (waived_at IS NULL).
//
// IDEMPOTENCY
// ───────────
// attestationId is client-generated (spec 7.2). The client generates
// a UUID before submitting so a retry after a dropped connection
// cannot double-sign. If the INSERT conflicts on the primary key
// (attestation_id), we detect that and return the EXISTING attestation
// row - the person did sign, they just did not see the response land.
//
// NO OPTIMISTIC UI (spec 7.2 rule 3).
// ───────────────────────────────────
// This route only reports success after the row is persisted. The
// client waits for the response before rendering the completion
// screen; there is no "assume it worked" affordance anywhere in the
// flow.
//
// APPEND-ONLY
// ───────────
// academy_attestations refuses UPDATE / DELETE / TRUNCATE on the
// service_role grant surface (academy-9). This route only INSERTs.
//
// FENCE - ACADEMY_PREVIEW_ONLY + TEST_MODE bypass.

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

function normName(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

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
  const attestationId = body?.attestationId;
  const typedName = body?.typedName;
  const attestationText = body?.attestationText;
  const timeSpentSecondsRaw = body?.timeSpentSeconds;

  if (!requirementId || !UUID_RE.test(String(requirementId))) {
    return NextResponse.json({ error: "bad_request", detail: "requirementId must be a UUID" }, { status: 400 });
  }
  if (!attestationId || !UUID_RE.test(String(attestationId))) {
    return NextResponse.json({ error: "bad_request", detail: "attestationId must be a client-generated UUID" }, { status: 400 });
  }
  if (typeof typedName !== "string" || typedName.trim().length === 0) {
    return NextResponse.json({ error: "bad_request", detail: "typedName is required" }, { status: 400 });
  }
  if (typeof attestationText !== "string" || attestationText.trim().length === 0) {
    return NextResponse.json({ error: "bad_request", detail: "attestationText is required - store the exact sentence shown" }, { status: 400 });
  }
  const timeSpentSeconds = Number.isFinite(Number(timeSpentSecondsRaw))
    ? Math.max(0, Math.floor(Number(timeSpentSecondsRaw)))
    : null;

  const supa = getServiceClient();

  let identity;
  try {
    identity = await resolveAcademyIdentity(email, { supa });
  } catch (err) {
    console.error("[api/academy/sign] resolve threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "identity" }, { status: 500 });
  }
  if (!identity) {
    return NextResponse.json({ error: "no_roster_row" }, { status: 404 });
  }
  if (!identity.displayName) {
    // Cannot enforce gate 4 without a name to compare against. Do
    // not fall back to email; a signature must match a real name.
    return NextResponse.json(
      { error: "server_error", scope: "identity_no_name", detail: "authenticated identity has no display_name; cannot verify typed name" },
      { status: 500 }
    );
  }

  // ─── Gate 1: requirement belongs to the authenticated worker ───
  const reqQ = await supa
    .from("academy_requirements")
    .select("requirement_id, worker_id, person_id, doc_id, obligation_key, doc_version, waived_at")
    .eq("requirement_id", requirementId)
    .eq("worker_id", identity.workerId)
    .maybeSingle();
  if (reqQ.error) {
    console.error("[api/academy/sign] requirement lookup:", reqQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "gate1" }, { status: 500 });
  }
  if (!reqQ.data) {
    return NextResponse.json({ error: "gate_failed", gate: 1, detail: "requirement not found for this worker" }, { status: 404 });
  }
  const req = reqQ.data;

  // ─── Gate 5: requirement not waived (order-independent; refuse
  //     before doing any more work if it is) ───
  if (req.waived_at != null) {
    return NextResponse.json(
      { error: "gate_failed", gate: 5, detail: "requirement is waived; signature is not required" },
      { status: 409 }
    );
  }

  // ─── Gate 2: not already satisfied ───
  // If an attestation already exists AND its attestation_id matches
  // the client's, this is a retry - return the existing row. If the
  // ids differ, the module was already signed by another submission
  // (perhaps a different session); do not create a second signature.
  const existingQ = await supa
    .from("academy_attestations")
    .select("attestation_id, worker_id, doc_id, obligation_key, doc_version, typed_name, signed_at, attempts_count, time_spent_seconds, certificate_serial, source, attestation_text")
    .eq("worker_id", identity.workerId)
    .eq("requirement_id", requirementId)
    .maybeSingle();
  if (existingQ.error) {
    console.error("[api/academy/sign] existing lookup:", existingQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "gate2" }, { status: 500 });
  }
  if (existingQ.data) {
    if (existingQ.data.attestation_id === attestationId) {
      // Idempotent retry - return the existing row as success.
      return NextResponse.json({
        ok: true,
        idempotent: true,
        attestation: existingQ.data,
      });
    }
    return NextResponse.json(
      {
        error: "gate_failed",
        gate: 2,
        detail: "already signed - existing attestation does not match the client's UUID",
        existing_attestation_id: existingQ.data.attestation_id,
        existing_certificate_serial: existingQ.data.certificate_serial,
      },
      { status: 409 }
    );
  }

  // ─── Gate 3: every approved question has at least one correct
  //     attempt for THIS worker + THIS requirement ───
  const [approvedQ, correctAttemptsQ] = await Promise.all([
    supa
      .from("academy_questions")
      .select("question_id")
      .eq("doc_id", req.doc_id)
      .eq("obligation_key", req.obligation_key)
      .eq("doc_version", req.doc_version)
      .eq("status", "approved"),
    supa
      .from("academy_check_attempts")
      .select("question_id")
      .eq("worker_id", identity.workerId)
      .eq("requirement_id", requirementId)
      .eq("correct", true),
  ]);
  if (approvedQ.error) {
    console.error("[api/academy/sign] approved questions:", approvedQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "gate3_questions" }, { status: 500 });
  }
  if (correctAttemptsQ.error) {
    console.error("[api/academy/sign] correct attempts:", correctAttemptsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "gate3_attempts" }, { status: 500 });
  }
  const approvedIds = (approvedQ.data || []).map((r) => r.question_id);
  const correctIds = new Set((correctAttemptsQ.data || []).map((r) => r.question_id));
  const missing = approvedIds.filter((id) => !correctIds.has(id));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "gate_failed",
        gate: 3,
        detail: "not every approved question has a correct attempt yet",
        missing_question_ids: missing,
        approved_count: approvedIds.length,
        correct_count: correctIds.size,
      },
      { status: 409 }
    );
  }

  // ─── Gate 4: typed name matches the authenticated display_name ───
  // Case-insensitive, whitespace-normalised, otherwise exact.
  if (normName(typedName) !== normName(identity.displayName)) {
    return NextResponse.json(
      {
        error: "gate_failed",
        gate: 4,
        detail: "typed name does not match your account name",
      },
      { status: 409 }
    );
  }

  // ─── All gates passed. Read the total attempt count + time_spent
  //     for the record, then INSERT. ───
  const [totalAttemptsQ, progressQ] = await Promise.all([
    supa
      .from("academy_check_attempts")
      .select("*", { count: "exact", head: true })
      .eq("worker_id", identity.workerId)
      .eq("requirement_id", requirementId),
    supa
      .from("academy_module_progress")
      .select("time_spent_seconds")
      .eq("worker_id", identity.workerId)
      .eq("requirement_id", requirementId)
      .maybeSingle(),
  ]);
  if (totalAttemptsQ.error) {
    console.error("[api/academy/sign] total attempts:", totalAttemptsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "attempts_count" }, { status: 500 });
  }
  const attemptsCount = totalAttemptsQ.count ?? 0;
  // Use whichever is greater: the server-tracked accumulator on
  // progress, or the client's session-clock. Progress only bumps on
  // check attempts (not on scroll or idle read time), so a person
  // who reads for ten minutes and never gets a check wrong would
  // otherwise land a 0 here. Neither source is authoritative alone;
  // max is the honest estimate.
  const progressTime = progressQ?.data?.time_spent_seconds ?? 0;
  const clientTime = timeSpentSeconds ?? 0;
  const timeToStore = Math.max(progressTime, clientTime);

  // ─── INSERT the attestation. attestation_id is client-supplied
  //     for idempotency; certificate_serial + signed_at take their
  //     defaults from the sequence and NOW(). ───
  const insertRow = {
    attestation_id: attestationId,
    worker_id: identity.workerId,
    person_id: identity.personId,
    requirement_id: requirementId,
    doc_id: req.doc_id,
    obligation_key: req.obligation_key,
    doc_version: req.doc_version,
    typed_name: typedName,
    attestation_text: attestationText,
    attempts_count: attemptsCount,
    time_spent_seconds: timeToStore,
    source: "intranet",
  };

  const insQ = await supa
    .from("academy_attestations")
    .insert(insertRow)
    .select("attestation_id, worker_id, doc_id, obligation_key, doc_version, typed_name, signed_at, attempts_count, time_spent_seconds, certificate_serial, source, attestation_text")
    .single();

  if (insQ.error) {
    // 23505 = unique_violation on the primary key means the client
    // retried a request that already persisted. Re-fetch and return
    // the existing row as success - the person did sign.
    if (insQ.error.code === "23505") {
      const refetch = await supa
        .from("academy_attestations")
        .select("attestation_id, worker_id, doc_id, obligation_key, doc_version, typed_name, signed_at, attempts_count, time_spent_seconds, certificate_serial, source, attestation_text")
        .eq("attestation_id", attestationId)
        .maybeSingle();
      if (refetch.data) {
        return NextResponse.json({ ok: true, idempotent: true, attestation: refetch.data });
      }
    }
    console.error("[api/academy/sign] insert:", insQ.error.message);
    return NextResponse.json(
      { error: "server_error", scope: "insert", detail: insQ.error.message },
      { status: 500 }
    );
  }

  // ─── Update progress with final time_spent (best-effort). ───
  await supa
    .from("academy_module_progress")
    .update({
      last_seen_at: new Date().toISOString(),
      time_spent_seconds: timeToStore ?? 0,
    })
    .eq("worker_id", identity.workerId)
    .eq("requirement_id", requirementId);

  return NextResponse.json({ ok: true, idempotent: false, attestation: insQ.data });
}

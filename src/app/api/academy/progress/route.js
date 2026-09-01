// /api/academy/progress
//
// Body: { requirementId, sectionsSeen: string[], timeSpentSeconds }
//
// Save + resume support (module-stepper PR A1). UPSERTs the mutable
// scratch row on academy_module_progress so the next fetch of
// /api/academy/module knows which step to mount at.
//
// The client POSTs this on every step advance (fire-and-forget with
// a brief "Saved" chip) and on Save & Exit (awaited so the room
// re-fetch sees the new state).
//
// Merge semantics:
//   - sections_seen grows monotonically. The server takes the UNION
//     of the existing row's array + the incoming array. Once a step
//     has been passed, it stays passed even if the client sends a
//     shorter list from a stale tab.
//   - time_spent_seconds takes the MAX of existing + incoming. Neither
//     the server nor the client is authoritative on time; whichever
//     is larger is the honest floor.
//   - last_seen_at set to NOW on every request.
//
// FENCE - ACADEMY_PREVIEW_ONLY + TEST_MODE bypass.
// MUTABLE table - academy_module_progress carries UPDATE grant on
// service_role, unlike the append-only attestations / attempts.

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
  const sectionsSeen = Array.isArray(body?.sectionsSeen) ? body.sectionsSeen.filter((s) => typeof s === "string") : [];
  const timeSpentRaw = body?.timeSpentSeconds;
  const timeSpentSeconds = Number.isFinite(Number(timeSpentRaw))
    ? Math.max(0, Math.floor(Number(timeSpentRaw)))
    : 0;
  if (!requirementId || !UUID_RE.test(String(requirementId))) {
    return NextResponse.json({ error: "bad_request", detail: "requirementId must be a UUID" }, { status: 400 });
  }

  const supa = getServiceClient();

  let identity;
  try {
    identity = await resolveAcademyIdentity(email, { supa });
  } catch (err) {
    console.error("[api/academy/progress] resolve threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "identity" }, { status: 500 });
  }
  if (!identity) {
    return NextResponse.json({ error: "no_roster_row" }, { status: 404 });
  }

  // Requirement-belongs-to-viewer gate (same defense as /module + /sign).
  const reqQ = await supa
    .from("academy_requirements")
    .select("requirement_id, worker_id, waived_at")
    .eq("requirement_id", requirementId)
    .eq("worker_id", identity.workerId)
    .maybeSingle();
  if (reqQ.error) {
    console.error("[api/academy/progress] requirement lookup:", reqQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "requirement" }, { status: 500 });
  }
  if (!reqQ.data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (reqQ.data.waived_at != null) {
    // No point tracking progress on a waived requirement. Refuse
    // rather than silently write.
    return NextResponse.json({ error: "waived", detail: "requirement is waived" }, { status: 409 });
  }

  // Read existing so we can merge monotonically.
  const existQ = await supa
    .from("academy_module_progress")
    .select("worker_id, requirement_id, sections_seen, started_at, last_seen_at, time_spent_seconds")
    .eq("worker_id", identity.workerId)
    .eq("requirement_id", requirementId)
    .maybeSingle();
  if (existQ.error) {
    console.error("[api/academy/progress] existing lookup:", existQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "existing" }, { status: 500 });
  }
  const existing = existQ.data;

  // Merge: union of sections_seen (order-preserving), max of time.
  const mergedSeen = existing?.sections_seen
    ? [...new Set([...(existing.sections_seen || []), ...sectionsSeen])]
    : [...new Set(sectionsSeen)];
  const mergedTime = Math.max(existing?.time_spent_seconds ?? 0, timeSpentSeconds);
  const nowIso = new Date().toISOString();

  let writeQ;
  if (existing) {
    writeQ = await supa
      .from("academy_module_progress")
      .update({
        sections_seen: mergedSeen,
        last_seen_at: nowIso,
        time_spent_seconds: mergedTime,
      })
      .eq("worker_id", identity.workerId)
      .eq("requirement_id", requirementId)
      .select("worker_id, requirement_id, sections_seen, started_at, last_seen_at, time_spent_seconds")
      .single();
  } else {
    writeQ = await supa
      .from("academy_module_progress")
      .insert({
        worker_id: identity.workerId,
        requirement_id: requirementId,
        sections_seen: mergedSeen,
        started_at: nowIso,
        last_seen_at: nowIso,
        time_spent_seconds: mergedTime,
      })
      .select("worker_id, requirement_id, sections_seen, started_at, last_seen_at, time_spent_seconds")
      .single();
  }
  if (writeQ.error) {
    console.error("[api/academy/progress] write:", writeQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "write" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    progress: {
      sections_seen: writeQ.data.sections_seen,
      started_at: writeQ.data.started_at,
      last_seen_at: writeQ.data.last_seen_at,
      time_spent_seconds: writeQ.data.time_spent_seconds,
    },
  });
}

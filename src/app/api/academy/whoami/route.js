// /api/academy/whoami
//
// Debug/gate route. Returns the Academy identity resolved for the
// signed-in caller, plus the standing-card boolean and the eligible-
// person count that produced it. This is the surface Kevin opens in
// a browser to gate the resolver before any UI ships.
//
// Standing rule (CLAUDE.md): "no merge without a live browser gate
// measurement." This route IS the measurement for PR 4.
//
// PII posture
// ───────────
// The response NEVER includes personal_email, natural_key, or any
// address (spec Section 2.5). By construction: the resolver does
// not read personal_email or natural_key, and it does not return
// work_email. This handler passes the resolver's return through
// with no rewrapping that could leak.
//
// Access
// ──────
// Gated by ACADEMY_PREVIEW_ONLY (spec Section 15 - Kevin-only pilot).
// The fence sits in FRONT of the resolver call so a fenced caller
// cannot even trigger the DB reads. Widening is a one-line edit to
// the ACADEMY_PREVIEW_ALLOWLIST constant in resolveIdentity.js.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  resolveAcademyIdentity,
  canSeeStandingCard,
  eligibleCountInScope,
  ACADEMY_PREVIEW_ONLY,
  ACADEMY_PREVIEW_ALLOWLIST,
} from "@/lib/academy/resolveIdentity";

// Session-gated + per-request DB reads; never cacheable. Matches the
// convention in src/app/api/playbook/route.js:61.
export const dynamic = "force-dynamic";

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const email = normEmail(session.user?.email);
  if (!email) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // ACADEMY PREVIEW FENCE - refuse before any DB read.
  if (ACADEMY_PREVIEW_ONLY && !ACADEMY_PREVIEW_ALLOWLIST.includes(email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let identity;
  try {
    identity = await resolveAcademyIdentity(email);
  } catch (err) {
    console.error("[api/academy/whoami] resolveIdentity threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "resolve" }, { status: 500 });
  }

  if (!identity) {
    // Legitimate outcome for hourly staff (no work_email) and anyone
    // not on the roster. The response says so explicitly rather than
    // returning empty fields that could be mistaken for a broken
    // resolver.
    return NextResponse.json({
      ok: true,
      identity: null,
      canSeeStandingCard: false,
      eligibleCountInScope: 0,
      resolvedFor: email,
      reason: "no active roster row for this email",
    });
  }

  let canSee = false;
  let eligibleCount = 0;
  try {
    [canSee, eligibleCount] = await Promise.all([
      canSeeStandingCard(identity),
      eligibleCountInScope(identity),
    ]);
  } catch (err) {
    console.error("[api/academy/whoami] scope math threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "scope" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    resolvedFor: email,
    identity,
    canSeeStandingCard: canSee,
    eligibleCountInScope: eligibleCount,
  });
}

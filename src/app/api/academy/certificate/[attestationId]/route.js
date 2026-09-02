// /api/academy/certificate/[attestationId]
//
// Serves the Academy certificate PDF for one attestation. The route
// is a browser-download endpoint (Content-Disposition: attachment);
// the client wires a plain <a href download> to it. See
// src/lib/academy/certificatePdf.js for the generator itself.
//
// SECURITY MODEL
// ──────────────
// A viewer may fetch an attestation IF one of these holds:
//   1. They are the worker who signed it (attestation.worker_id ===
//      identity.workerId).
//   2. They hold the `academy_admin` grant (identity.grants includes
//      "academy_admin"). Grant lookup follows the pattern in
//      src/lib/academy/resolveIdentity.js:255.
//
// If neither holds, we return 404, NOT 403. The endpoint MUST NOT
// leak which attestation ids exist. A 403 would tell an attacker "yes,
// this id is real, you just cannot see it" - a 404 tells them "no
// such thing here, move on." Same class of choice as the row-not-
// found return in /api/academy/module (see that route header).
//
// FENCE - ACADEMY_PREVIEW_ONLY + TEST_MODE bypass, same shape as
// /api/academy/sign and the room route.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import {
  resolveAcademyIdentity,
  ACADEMY_PREVIEW_ONLY,
  ACADEMY_PREVIEW_ALLOWLIST,
} from "@/lib/academy/resolveIdentity";
import { createCertificatePdf } from "@/lib/academy/certificatePdf";

export const dynamic = "force-dynamic";

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Make a filename that is safe on every filesystem we care about.
// Strip control chars, replace path separators + reserved Windows
// characters, collapse whitespace, trim, cap length.
function safeFilenameSegment(s, max = 80) {
  const cleaned = String(s || "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trim();
}

export async function GET(request, { params }) {
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
    // Preview fence: same 404-not-403 discipline. If the surface is
    // fenced off entirely, the endpoint should look as if it does not
    // exist, not merely as if it were forbidden.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { attestationId } = await params;
  if (!attestationId || !UUID_RE.test(String(attestationId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supa = getServiceClient();

  let identity;
  try {
    identity = await resolveAcademyIdentity(email, { supa });
  } catch (err) {
    console.error("[api/academy/certificate] resolve threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "identity" }, { status: 500 });
  }
  if (!identity) {
    return NextResponse.json({ error: "no_roster_row" }, { status: 404 });
  }

  const attQ = await supa
    .from("academy_attestations")
    .select("attestation_id, worker_id, doc_id, obligation_key, doc_version, typed_name, signed_at, attempts_count, time_spent_seconds, certificate_serial, attestation_text")
    .eq("attestation_id", attestationId)
    .maybeSingle();
  if (attQ.error) {
    console.error("[api/academy/certificate] attestation lookup:", attQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "attestation" }, { status: 500 });
  }
  if (!attQ.data) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const attestation = attQ.data;

  // Ownership gate. See header: 404 (not 403) so the endpoint cannot
  // be used to probe which attestation ids exist.
  const isOwner = attestation.worker_id === identity.workerId;
  const isAdmin = Array.isArray(identity.grants) && identity.grants.includes("academy_admin");
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Load doc title for the module line. Absence is not fatal - the
  // generator falls back to doc_id.
  let doc = null;
  if (attestation.doc_id) {
    const docQ = await supa
      .from("documents")
      .select("id, title, doc_class")
      .eq("id", attestation.doc_id)
      .maybeSingle();
    if (docQ.error) {
      console.warn("[api/academy/certificate] doc lookup:", docQ.error.message);
    } else if (docQ.data) {
      doc = docQ.data;
    }
  }

  let pdfBytes;
  try {
    pdfBytes = await createCertificatePdf({ attestation, doc });
  } catch (err) {
    console.error("[api/academy/certificate] pdf gen threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "pdf_gen" }, { status: 500 });
  }

  // Build the filename: real serial + safe document title. The serial
  // format is whatever certificate_serial actually holds (today,
  // KFA-YYYY-NNNNNN from the sequence).
  const serialPart = safeFilenameSegment(attestation.certificate_serial || "certificate", 40);
  const titlePart = safeFilenameSegment(doc?.title || attestation.doc_id || "module", 80);
  const filename = `${serialPart} ${titlePart}.pdf`.replace(/\s+/g, " ").trim();

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdfBytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}

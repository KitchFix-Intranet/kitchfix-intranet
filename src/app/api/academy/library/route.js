// /api/academy/library
//
// Data feed for the /opd Library room. Returns the active document
// catalogue grouped by shelf, plus the set of doc_ids whose
// obligations apply to THIS viewer (the "trains you" marker).
//
// Fenced by ACADEMY_PREVIEW_ONLY. Outside the fence, returns 403.
// Unauthenticated returns 401.
//
// This is a READ-ONLY route. No writes, no mutations. It joins
// documents + academy_obligations, computes the trains-you set in
// JS, and never returns any PII (no personal_email, no natural_key,
// no work_email).

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

// Which shelves the Library rail lists. Kept in sync with the six live
// values in documents.shelf. Docs with NULL shelf are excluded (they
// have no rail home). Frozen so the Library rail order does not drift
// between calls.
const SHELF_ORDER = Object.freeze([
  "People & Conduct",
  "Service Delivery & Client Accounts",
  "Safety, Health & Incident",
  "Operations & Leadership",
  "Brand & Documentation Standards",
  "Culinary & Kitchen Operations",
]);

// Given an obligation's raw applies_to (JSONB) and the viewer's
// worker_class ("salaried" | "hourly"), return whether the obligation
// applies to this viewer. Encodes the v1 rule: applies_to.worker_class
// with values "all" | "salaried" | "hourly" is the ONLY reliable
// audience dimension (spec 4.4 + PR 2 authoring). Anything else is
// treated as "does not gate on class" and falls through as applies.
//
// applies_to has two valid shapes per the frontmatter schema oneOf:
//   - the string "company-wide"
//   - an object with any subset of {states, account, role, worker_class}
// The string form matches everyone.
function obligationTrainsViewer(applies_to, viewerIsSalaried) {
  if (applies_to == null) return true; // absent = company-wide
  if (typeof applies_to === "string") {
    return applies_to === "company-wide";
  }
  if (typeof applies_to !== "object") return true;
  const wc = applies_to.worker_class;
  if (wc == null) return true; // no class filter = applies
  if (wc === "all") return true;
  if (wc === "salaried") return !!viewerIsSalaried;
  if (wc === "hourly") return !viewerIsSalaried;
  return true; // unknown value: fail open, do not silently hide
}

export async function GET() {
  // TEST_MODE bypass mirrors src/middleware.js so Playwright + local
  // batteries can hit the endpoint without an OAuth login.
  // Double-gated: TEST_MODE=true AND VERCEL !== "1".
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

  const supa = getServiceClient();

  // Resolve the viewer identity. Legitimately null for anyone off the
  // roster (hourly today, since work_email is NULL for them); the
  // Library still renders in that case, just with no trains-you
  // markers. That is the correct behaviour - the fence covers who
  // gets to LOAD the surface; identity resolution is orthogonal.
  let identity = null;
  try {
    identity = await resolveAcademyIdentity(email, { supa });
  } catch (err) {
    console.error("[api/academy/library] identity resolve threw:", err?.message || err);
    // Do NOT fail the whole request; the Library data is independent.
    identity = null;
  }

  // Two DB reads, parallel. Docs are the visible catalog; obligations
  // are the sparse per-doc training layer computed today.
  const [docsQ, obQ] = await Promise.all([
    supa
      .from("documents")
      .select("id, title, card_line, version, shelf, doc_class, updated_at, effective_date")
      .eq("archived", false)
      .neq("status", "Retired")
      .not("shelf", "is", null)
      .order("shelf", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supa
      .from("academy_obligations")
      .select("doc_id, applies_to"),
  ]);

  if (docsQ.error) {
    console.error("[api/academy/library] documents:", docsQ.error.message);
    return NextResponse.json(
      { error: "server_error", scope: "documents" },
      { status: 500 }
    );
  }
  if (obQ.error) {
    console.error("[api/academy/library] obligations:", obQ.error.message);
    return NextResponse.json(
      { error: "server_error", scope: "obligations" },
      { status: 500 }
    );
  }

  const docs = docsQ.data || [];
  const obligations = obQ.data || [];

  // Compute the trains-you set. Empty when viewer is off-roster.
  const viewerIsSalaried = !!(identity && identity.isSalaried);
  const trainsYou = new Set();
  if (identity) {
    for (const ob of obligations) {
      if (obligationTrainsViewer(ob.applies_to, viewerIsSalaried)) {
        trainsYou.add(ob.doc_id);
      }
    }
  }

  // Group into shelves in the frozen SHELF_ORDER. Docs whose shelf
  // is not in the known set (should be zero given the CHECK on the
  // documents schema, but defend anyway) fall into an "Other"
  // bucket surfaced at the end.
  const byShelf = new Map();
  for (const s of SHELF_ORDER) byShelf.set(s, []);
  const unknownShelves = new Map();

  for (const d of docs) {
    const row = {
      id: d.id,
      title: d.title || d.id,
      card_line: d.card_line || null,
      version: d.version || null,
      updated_at: d.updated_at || null,
      effective_date: d.effective_date || null,
      doc_class: d.doc_class || null,
      trains_you: trainsYou.has(d.id),
    };
    if (byShelf.has(d.shelf)) {
      byShelf.get(d.shelf).push(row);
    } else {
      if (!unknownShelves.has(d.shelf)) unknownShelves.set(d.shelf, []);
      unknownShelves.get(d.shelf).push(row);
    }
  }

  const shelves = [];
  for (const name of SHELF_ORDER) {
    const rows = byShelf.get(name) || [];
    shelves.push({
      name,
      count: rows.length,
      trains_you_count: rows.filter((r) => r.trains_you).length,
      docs: rows,
    });
  }
  for (const [name, rows] of unknownShelves) {
    shelves.push({
      name: String(name),
      count: rows.length,
      trains_you_count: rows.filter((r) => r.trains_you).length,
      docs: rows,
    });
  }

  return NextResponse.json({
    ok: true,
    totalDocs: docs.length,
    totalTrainsYou: trainsYou.size,
    shelves,
    viewer: identity
      ? {
          // Small viewer summary the client uses only to render the
          // "for you" affordance. Deliberately narrow - no email, no
          // personId, no work_email.
          displayName: identity.displayName,
          isSalaried: identity.isSalaried,
          onRoster: true,
        }
      : { displayName: null, isSalaried: false, onRoster: false },
  });
}

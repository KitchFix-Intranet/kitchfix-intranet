// /api/academy/room
//
// Single bundled fetch for the Academy room at /opd. Returns:
//   - viewer      narrow identity summary (no PII)
//   - queue       viewer's academy_requirements enriched with doc.title,
//                 doc.shelf, obligation.source_section, cycle.label
//   - queueSummary { count, totalMinutes }
//   - yearTrack   12 month cells for the current fiscal year, marking
//                 the ONE cell that has a published cycle. Months with
//                 no cycle render neutral, NEVER "current" (green is a
//                 lie until something is signed).
//   - companyStanding  present only when scope.kind is 'company' or
//                      'region'; per-account rollup with eligible +
//                      enrolled counts + legend copy. The not-enrolled
//                      state renders visually distinct from current per
//                      spec ("missing is never zero" applied to people).
//
// Fenced by ACADEMY_PREVIEW_ONLY. TEST_MODE bypass mirrors the shell so
// Playwright + local batteries can hit the endpoint without OAuth login.
//
// This is a READ-ONLY route. No writes, no mutations, no PII on the
// wire. In particular: no work_email, no personal_email, no natural_key.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import {
  resolveAcademyIdentity,
  eligibleCountInScope,
  ACADEMY_PREVIEW_ONLY,
  ACADEMY_PREVIEW_ALLOWLIST,
} from "@/lib/academy/resolveIdentity";

export const dynamic = "force-dynamic";

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

// Twelve calendar-month cells for the fiscal year that contains `today`.
// Kevin's spec Section 6 makes calendar months the operator model; the
// year track always shows Jan..Dec of the calendar year for consistency
// with "September opens" language. Marks the cell that has a published
// cycle live; every other cell is empty (never green).
//
// For each cell:
//   month        'YYYY-MM' (period_start for a hypothetical cycle)
//   label        single letter J/F/M/... for the render's row of labels
//   monthName    'January' for tooltip / a11y
//   isCurrentMonth  true if today's month matches this cell
//   hasCycle     true if academy_cycles has a row starting this month
//   cycleId      the cycle id (or null)
//   cycleStatus  'draft' | 'published' | 'closed' | null
//   cycleLabel   the cycle's human label (or null)
function buildYearTrack(cycles, today) {
  const year = today.getUTCFullYear();
  const todayMonth = today.getUTCMonth(); // 0-11
  const labels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const byMonth = new Map();
  for (const c of cycles) {
    if (!c.period_start) continue;
    // period_start is 'YYYY-MM-DD' - parse as UTC to match calendar-month invariants
    const [y, m] = c.period_start.split("-").map(Number);
    if (y === year) {
      const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
      byMonth.set(key, c);
    }
  }

  const cells = [];
  for (let i = 0; i < 12; i += 1) {
    const key = `${String(year).padStart(4, "0")}-${String(i + 1).padStart(2, "0")}`;
    const c = byMonth.get(key) || null;
    cells.push({
      month: key,
      label: labels[i],
      monthName: monthNames[i],
      isCurrentMonth: i === todayMonth,
      hasCycle: !!c,
      cycleId: c?.cycle_id || null,
      cycleStatus: c?.status || null,
      cycleLabel: c?.label || null,
    });
  }
  return cells;
}

export async function GET() {
  // TEST_MODE bypass mirrors src/middleware.js (double-gated: TEST_MODE
  // AND VERCEL !== "1"). Same pattern as /api/academy/library.
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

  // 1. Identity - the resolver is per-request per its own header note.
  let identity;
  try {
    identity = await resolveAcademyIdentity(email, { supa });
  } catch (err) {
    console.error("[api/academy/room] resolve threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "identity" }, { status: 500 });
  }
  // A signed-in Kevin allowlist member with no roster row is a defect
  // for the pilot, not a routine state; the whoami route returns null
  // identity as informational, but for the ROOM we cannot render
  // anything person-scoped without one. Fail closed with a message
  // the client can render.
  if (!identity) {
    return NextResponse.json(
      { error: "no_roster_row", detail: "signed-in email resolved to no active people row" },
      { status: 404 }
    );
  }

  // 2. Kevin's requirements + the docs / obligations / cycles they
  //    reference, in parallel. The reqs table has an index on
  //    (worker_id, due_date) so this is a small point read.
  const reqsQ = await supa
    .from("academy_requirements")
    .select("requirement_id, worker_id, person_id, doc_id, obligation_key, doc_version, est_minutes, source, cycle_id, due_date, issued_at, waived_at, waive_reason")
    .eq("worker_id", identity.workerId)
    .order("due_date", { ascending: true })
    .order("doc_id", { ascending: true })
    .order("obligation_key", { ascending: true });
  if (reqsQ.error) {
    console.error("[api/academy/room] requirements:", reqsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "requirements" }, { status: 500 });
  }
  const reqs = reqsQ.data || [];

  // Distinct sets to hydrate. We enrich each requirement with its doc
  // title + shelf and its obligation's source_section + description +
  // cadence + type, so the queue can name WHY it applies rather than
  // showing a bare doc id.
  const distinctDocIds = [...new Set(reqs.map((r) => r.doc_id).filter(Boolean))];
  const distinctObligationPairs = [...new Set(
    reqs.filter((r) => r.doc_id && r.obligation_key).map((r) => `${r.doc_id}|${r.obligation_key}`)
  )];
  const distinctCycleIds = [...new Set(reqs.map((r) => r.cycle_id).filter((x) => x != null))];

  // Cycles: we always load the full known set (calendar-year, no
  // pagination needed - one cycle per month, tiny). Powers both the
  // year track and the queue's cycle-label lookup.
  //
  // Attestations: viewer's signed record. Used to mark done queue
  // rows + light credentials + fill year segments + gate the
  // percentage (spec 18.1 principle 5: no percentage without history).
  const [docsQ, obligationsQ, cyclesQ, attestationsQ] = await Promise.all([
    distinctDocIds.length > 0
      ? supa.from("documents").select("id, title, shelf, doc_class, version").in("id", distinctDocIds)
      : Promise.resolve({ data: [], error: null }),
    distinctObligationPairs.length > 0
      ? supa
          .from("academy_obligations")
          .select("doc_id, obligation_key, source_section, description, type, cadence, est_minutes, applies_to")
          .in("doc_id", distinctDocIds)
      : Promise.resolve({ data: [], error: null }),
    supa
      .from("academy_cycles")
      .select("cycle_id, label, period_start, period_end, status, fiscal_year, fiscal_period_no, audience_scope, published_at")
      .order("period_start", { ascending: true }),
    supa
      .from("academy_attestations")
      .select("attestation_id, requirement_id, doc_id, obligation_key, doc_version, signed_at, certificate_serial, supersedes")
      .eq("worker_id", identity.workerId)
      .order("signed_at", { ascending: false }),
  ]);
  if (docsQ.error) {
    console.error("[api/academy/room] documents:", docsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "documents" }, { status: 500 });
  }
  if (obligationsQ.error) {
    console.error("[api/academy/room] obligations:", obligationsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "obligations" }, { status: 500 });
  }
  if (cyclesQ.error) {
    console.error("[api/academy/room] cycles:", cyclesQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "cycles" }, { status: 500 });
  }
  if (attestationsQ.error) {
    console.error("[api/academy/room] attestations:", attestationsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "attestations" }, { status: 500 });
  }

  const docsById = new Map();
  for (const d of docsQ.data || []) docsById.set(d.id, d);
  const obligationsByKey = new Map();
  for (const ob of obligationsQ.data || []) {
    obligationsByKey.set(`${ob.doc_id}|${ob.obligation_key}`, ob);
  }
  const cyclesById = new Map();
  const cycles = cyclesQ.data || [];
  for (const c of cycles) cyclesById.set(c.cycle_id, c);

  // Index the viewer's attestations by requirement_id. A NOT EXISTS
  // check for "is this attestation the current one?" would use the
  // supersedes column; in v1 there are no super-seding rows so a
  // simple by-requirement lookup answers "signed?" honestly.
  const attestationsByReq = new Map();
  for (const att of attestationsQ.data || []) {
    if (att.requirement_id) attestationsByReq.set(att.requirement_id, att);
  }

  // 3. Enrich the queue.
  const queue = reqs.map((r) => {
    const doc = docsById.get(r.doc_id) || null;
    const ob = obligationsByKey.get(`${r.doc_id}|${r.obligation_key}`) || null;
    const cyc = r.cycle_id != null ? cyclesById.get(r.cycle_id) || null : null;
    const att = attestationsByReq.get(r.requirement_id) || null;
    return {
      requirement_id: r.requirement_id,
      doc_id: r.doc_id,
      doc_title: doc?.title || r.doc_id,
      doc_shelf: doc?.shelf || null,
      doc_class: doc?.doc_class || null,
      obligation_key: r.obligation_key,
      source_section: ob?.source_section || null,
      cadence: ob?.cadence || null,
      obligation_type: ob?.type || null,
      description: ob?.description || null,
      doc_version: r.doc_version,
      est_minutes: r.est_minutes || 0,
      due_date: r.due_date,
      source: r.source,
      cycle_id: r.cycle_id,
      cycle_label: cyc?.label || null,
      waived: r.waived_at != null,
      signed: att != null,
      signed_at: att?.signed_at || null,
      certificate_serial: att?.certificate_serial || null,
    };
  });
  const signedCount = queue.filter((q) => q.signed).length;
  // Cycle-open minutes = sum of unsigned est_minutes (spec 18.2:
  // total minutes reflects the work ahead, not the work done).
  const totalMinutesRemaining = queue
    .filter((q) => !q.signed)
    .reduce((acc, q) => acc + (q.est_minutes || 0), 0);
  const totalMinutes = queue.reduce((acc, q) => acc + (q.est_minutes || 0), 0);
  const queueSummary = {
    count: queue.length,
    signedCount,
    remainingCount: queue.length - signedCount,
    totalMinutes,
    totalMinutesRemaining,
    // Percentage appears only once history exists (spec 18.1 principle 5).
    percentCurrent: signedCount > 0 && queue.length > 0
      ? Math.round((signedCount / queue.length) * 100)
      : null,
  };

  // 4. Year track - always the current calendar year on the server.
  const today = new Date();
  const yearTrack = buildYearTrack(cycles, today);

  // 5. Company standing - only for company + region scope. Uses the
  //    resolver's scope.accounts list. For every account in scope we
  //    count:
  //      eligible          people rows in scope AND end_date IS NULL
  //                        AND not in the eligibility exceptions AND
  //                        excluding the viewer.
  //      enrolledIn Cycle  distinct worker_ids on that account whose
  //                        academy_requirements point at the currently
  //                        open published cycle. (There is exactly one
  //                        such cycle in the pilot.)
  //
  //    The KEY insight for PR 8: with a Kevin-only cycle, every
  //    non-Kevin account has enrolled=0. The room must render those
  //    as "not-enrolled" - visually distinct from "current" (which
  //    would falsely claim they signed). "Missing is never zero"
  //    applied to people rather than cells.
  let companyStanding = null;
  const scopeKind = identity.scope?.kind;
  if (scopeKind === "company" || scopeKind === "region") {
    // Pick the current live cycle: the earliest published cycle whose
    // period_end >= today. For September 2026 with today=Aug 31 the
    // cycle opens tomorrow but is already published; render it. The
    // check is inclusive of the opening month so the audience roll-up
    // does not blank out for the day before the cycle opens.
    const todayISO = today.toISOString().slice(0, 10);
    const activeCycles = cycles.filter(
      (c) => c.status === "published" && c.period_end >= todayISO
    );
    // Prefer the earliest by period_start so a rollover to next month
    // does not accidentally pick a future cycle over the still-open one.
    activeCycles.sort((a, b) => a.period_start.localeCompare(b.period_start));
    const currentCycle = activeCycles[0] || null;

    // People + exclusions + accounts for scope.
    const [peopleQ, excQ, acctsQ, cycleReqsQ] = await Promise.all([
      supa
        .from("people")
        .select("worker_id, is_salaried, account_key")
        .is("end_date", null)
        .in("account_key", identity.scope.accounts || []),
      supa
        .from("academy_eligibility_exceptions")
        .select("worker_id")
        .eq("eligible", false),
      supa
        .from("accounts")
        .select("team_key, region")
        .in("team_key", identity.scope.accounts || []),
      currentCycle
        ? supa
            .from("academy_requirements")
            .select("worker_id, cycle_id")
            .eq("cycle_id", currentCycle.cycle_id)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (peopleQ.error) {
      console.error("[api/academy/room] scope people:", peopleQ.error.message);
      return NextResponse.json({ error: "server_error", scope: "scope_people" }, { status: 500 });
    }
    if (excQ.error) {
      console.error("[api/academy/room] scope exceptions:", excQ.error.message);
      return NextResponse.json({ error: "server_error", scope: "scope_exc" }, { status: 500 });
    }
    if (acctsQ.error) {
      console.error("[api/academy/room] scope accounts:", acctsQ.error.message);
      return NextResponse.json({ error: "server_error", scope: "scope_accounts" }, { status: 500 });
    }
    if (cycleReqsQ.error) {
      console.error("[api/academy/room] cycle reqs:", cycleReqsQ.error.message);
      return NextResponse.json({ error: "server_error", scope: "scope_cyclereqs" }, { status: 500 });
    }

    const excludedIds = new Set((excQ.data || []).map((r) => r.worker_id));
    const enrolledWorkerIds = new Set((cycleReqsQ.data || []).map((r) => r.worker_id));

    // Per-account rollup: for each account in scope, count eligibility
    // and enrollment. Every account renders - even ones with zero
    // enrolled - because a not-enrolled state is a real fact, not an
    // absent one.
    const perAccount = new Map();
    for (const a of acctsQ.data || []) {
      perAccount.set(a.team_key, {
        team_key: a.team_key,
        region: a.region || null,
        eligible: 0,
        enrolled: 0,
      });
    }
    for (const p of peopleQ.data || []) {
      const row = perAccount.get(p.account_key);
      if (!row) continue; // person on an account not in scope (defensive)
      if (excludedIds.has(p.worker_id)) continue;
      row.eligible += 1;
      if (enrolledWorkerIds.has(p.worker_id)) row.enrolled += 1;
    }

    const accountsOut = [...perAccount.values()]
      .sort((a, b) => (a.region || "").localeCompare(b.region || "") || a.team_key.localeCompare(b.team_key))
      .map((r) => ({
        team_key: r.team_key,
        region: r.region,
        eligible: r.eligible,
        enrolled: r.enrolled,
        notEnrolled: r.eligible - r.enrolled,
        // Standing tier for this account. In the pilot with zero
        // attestations, an account is either enrolled=0 (not-enrolled)
        // or enrolled>0 (in-progress; nothing is signed yet). "Current"
        // is only possible once signatures exist - so it is
        // deliberately absent from the produced values in PR 8.
        standing:
          r.eligible === 0
            ? "unstaffed"
            : r.enrolled === 0
              ? "not_enrolled"
              : "in_progress",
      }));

    const totals = accountsOut.reduce(
      (acc, r) => ({
        eligible: acc.eligible + r.eligible,
        enrolled: acc.enrolled + r.enrolled,
      }),
      { eligible: 0, enrolled: 0 }
    );

    companyStanding = {
      accounts: accountsOut,
      totals: {
        accounts: accountsOut.length,
        eligible: totals.eligible,
        enrolled: totals.enrolled,
        notEnrolled: totals.eligible - totals.enrolled,
      },
      currentCycle: currentCycle
        ? {
            cycle_id: currentCycle.cycle_id,
            label: currentCycle.label,
            period_start: currentCycle.period_start,
            period_end: currentCycle.period_end,
            status: currentCycle.status,
            audience_scope: currentCycle.audience_scope || {},
          }
        : null,
      // Legend copy mounted on the surface per spec ("every status
      // surface mounts its legend"). Only the states the pilot can
      // actually produce are described. Once signatures exist, a
      // "current" state will land here; deliberately absent today.
      legend: {
        in_progress: "In progress (started, no signatures exist yet)",
        not_enrolled: "Not in this cycle's audience",
        unstaffed: "No eligible people on this account",
      },
    };
  }

  // Also compute the scope-wide eligible split for the queue's context
  // copy (spec 3.4: split salaried/hourly counts drive the standing
  // card visibility; even when we don't render companyStanding we still
  // want the summary counts on the wire).
  let eligibleCounts = { salaried: 0, hourly: 0, total: 0 };
  try {
    eligibleCounts = await eligibleCountInScope(identity, { supa });
  } catch (err) {
    console.error("[api/academy/room] eligibleCounts threw:", err?.message || err);
    // Non-fatal: the room still renders.
  }

  return NextResponse.json({
    ok: true,
    viewer: {
      workerId: identity.workerId,
      personId: identity.personId,
      displayName: identity.displayName,
      accountKey: identity.accountKey,
      region: identity.region,
      isSalaried: identity.isSalaried,
      isSiteLeader: identity.isSiteLeader,
      isCorp: identity.isCorp,
      scope: identity.scope,
      grants: identity.grants,
      eligibleInScope: eligibleCounts,
    },
    queue,
    queueSummary,
    yearTrack,
    companyStanding,
  });
}

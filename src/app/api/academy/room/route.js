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
  //
  // Waived requirements are FILTERED OUT server-side (spec 5.3). A
  // waived requirement is not work: it is not in the queue, not in
  // the count, and its minutes are not summed. Records is where the
  // audit trail lives, and Records is the surface that renders
  // waived requirements with the waive reason + waiver. Filtering
  // at the query means a waive reason (which may contain an
  // operational explanation) never reaches a surface that will not
  // render it.
  const reqsQ = await supa
    .from("academy_requirements")
    .select("requirement_id, worker_id, person_id, doc_id, obligation_key, doc_version, est_minutes, source, cycle_id, due_date, issued_at")
    .eq("worker_id", identity.workerId)
    .is("waived_at", null)
    .order("due_date", { ascending: true })
    .order("doc_id", { ascending: true })
    .order("obligation_key", { ascending: true });
  if (reqsQ.error) {
    console.error("[api/academy/room] requirements:", reqsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "requirements" }, { status: 500 });
  }
  let reqs = reqsQ.data || [];

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
  // viewerAttemptsQ + viewerProgressQ power the "Your record" tiles.
  // Added 2026-09-01 (owner walk): the tiles were rendering four
  // zeros, which is technically true but reads as broken since the
  // data exists in academy_check_attempts + academy_module_progress.
  const [docsQ, obligationsQ, cyclesQ, cycleModulesQ, attestationsQ, viewerAttemptsQ, viewerProgressQ] = await Promise.all([
    distinctDocIds.length > 0
      ? supa.from("documents").select("id, title, shelf, doc_class, version, card_line").in("id", distinctDocIds)
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
    // Cycle module ordering. Curriculum authors sort_order in the
    // Cycle Builder; we key by (cycle_id, doc_id, obligation_key) so
    // requirements that came from a cycle honor that order. Rows with
    // no matching module (onboarding + rehire sources have no cycle)
    // fall through to the existing due_date, doc_id, obligation_key
    // tie-breaker. Closes open ruling 17.12.
    distinctCycleIds.length > 0
      ? supa
          .from("academy_cycle_modules")
          .select("cycle_id, doc_id, obligation_key, sort_order")
          .in("cycle_id", distinctCycleIds)
      : Promise.resolve({ data: [], error: null }),
    supa
      .from("academy_attestations")
      .select("attestation_id, requirement_id, doc_id, obligation_key, doc_version, signed_at, certificate_serial, supersedes")
      .eq("worker_id", identity.workerId)
      .order("signed_at", { ascending: false }),
    supa
      .from("academy_check_attempts")
      .select("attempt_id, correct")
      .eq("worker_id", identity.workerId),
    supa
      .from("academy_module_progress")
      .select("requirement_id, time_spent_seconds")
      .eq("worker_id", identity.workerId),
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
  if (cycleModulesQ.error) {
    console.error("[api/academy/room] cycle modules:", cycleModulesQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "cycle_modules" }, { status: 500 });
  }
  if (attestationsQ.error) {
    console.error("[api/academy/room] attestations:", attestationsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "attestations" }, { status: 500 });
  }
  if (viewerAttemptsQ.error) {
    console.error("[api/academy/room] viewer attempts:", viewerAttemptsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "viewer_attempts" }, { status: 500 });
  }
  if (viewerProgressQ.error) {
    console.error("[api/academy/room] viewer progress:", viewerProgressQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "viewer_progress" }, { status: 500 });
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

  // Curriculum-authored sort_order per (cycle_id, doc_id, obligation_key).
  // Requirements from a cycle module honor this ordering; requirements
  // without a matching module (onboarding, rehire) sort to the end and
  // fall back to the SQL tie-breaker (due_date, doc_id, obligation_key).
  const cycleModules = cycleModulesQ.data || [];
  const sortOrderByCycleReq = new Map();
  for (const m of cycleModules) {
    sortOrderByCycleReq.set(`${m.cycle_id}|${m.doc_id}|${m.obligation_key}`, m.sort_order);
  }
  const sortOrderForReq = (r) => {
    if (r.cycle_id == null) return Infinity;
    const v = sortOrderByCycleReq.get(`${r.cycle_id}|${r.doc_id}|${r.obligation_key}`);
    return v == null ? Infinity : v;
  };
  // Re-sort reqs by (cycle sort_order, then existing SQL tie-breakers).
  // The SQL .order() chain returns rows in due_date -> doc_id ->
  // obligation_key order; a stable sort keyed on sort_order preserves
  // those tie-breakers for equal-order rows (and for reqs with no
  // matching cycle module). Fix for open ruling 17.12.
  reqs = [...reqs].sort((a, b) => {
    const so = sortOrderForReq(a) - sortOrderForReq(b);
    if (so !== 0) return so;
    // Preserve the SQL tie-breaker order explicitly so the sort is
    // deterministic even if the JS engine's sort is not stable.
    const ad = a.due_date || "";
    const bd = b.due_date || "";
    if (ad !== bd) return ad < bd ? -1 : 1;
    if (a.doc_id !== b.doc_id) return a.doc_id.localeCompare(b.doc_id);
    return String(a.obligation_key || "").localeCompare(String(b.obligation_key || ""));
  });

  // Index the viewer's attestations by requirement_id. A NOT EXISTS
  // check for "is this attestation the current one?" would use the
  // supersedes column; in v1 there are no super-seding rows so a
  // simple by-requirement lookup answers "signed?" honestly.
  const attestationsByReq = new Map();
  for (const att of attestationsQ.data || []) {
    if (att.requirement_id) attestationsByReq.set(att.requirement_id, att);
  }

  // Group requirements by doc_id so a doc with multiple visible
  // obligations (e.g. PB-014 has origin + standard) can render each
  // row with a "part N of M" suffix. Ordering within a doc follows
  // the same cycle sort_order as the top-level list; obligation_key
  // is the tie-breaker for parts that share a sort_order or whose
  // requirement has no matching cycle module. Previously this sorted
  // by obligation_key alone, which would have rendered
  // big-rules-annual as Part 1 (open ruling 17.12).
  const byDoc = new Map();
  for (const r of reqs) {
    if (!byDoc.has(r.doc_id)) byDoc.set(r.doc_id, []);
    byDoc.get(r.doc_id).push(r);
  }
  for (const [, list] of byDoc) {
    list.sort((a, b) => {
      const so = sortOrderForReq(a) - sortOrderForReq(b);
      if (so !== 0) return so;
      return String(a.obligation_key || "").localeCompare(String(b.obligation_key || ""));
    });
  }
  const partIndex = new Map(); // requirement_id -> { partNumber, totalParts }
  for (const [, list] of byDoc) {
    list.forEach((r, i) => {
      partIndex.set(r.requirement_id, { partNumber: i + 1, totalParts: list.length });
    });
  }

  // 3. Enrich the queue.
  const queue = reqs.map((r) => {
    const doc = docsById.get(r.doc_id) || null;
    const ob = obligationsByKey.get(`${r.doc_id}|${r.obligation_key}`) || null;
    const cyc = r.cycle_id != null ? cyclesById.get(r.cycle_id) || null : null;
    const att = attestationsByReq.get(r.requirement_id) || null;
    const part = partIndex.get(r.requirement_id) || { partNumber: 1, totalParts: 1 };
    return {
      requirement_id: r.requirement_id,
      doc_id: r.doc_id,
      doc_title: doc?.title || r.doc_id,
      doc_shelf: doc?.shelf || null,
      doc_class: doc?.doc_class || null,
      obligation_key: r.obligation_key,
      // Part numbering for docs with multiple visible obligations.
      // The client renders "· part N of M" when totalParts > 1.
      part_number: part.partNumber,
      total_parts: part.totalParts,
      source_section: ob?.source_section || null,
      // cadence carried on the wire for Admin surfaces + a future
      // Records room; the operator-facing queue does NOT render it
      // (spec 18.3: no cadence enums in operator copy). Kept off the
      // Focus rail's About card for the same reason - the client
      // filters, not the API.
      cadence: ob?.cadence || null,
      obligation_type: ob?.type || null,
      description: ob?.description || null,
      // Authored description candidates for the part-row line under
      // the title. Preference (client-side): card_line > description >
      // nothing. source_section is a semicolon-joined heading list
      // and is deliberately NOT a description candidate - it was
      // producing unreadable one-liners in the density review.
      card_line: doc?.card_line || null,
      doc_version: r.doc_version,
      est_minutes: r.est_minutes || 0,
      due_date: r.due_date,
      source: r.source,
      cycle_id: r.cycle_id,
      cycle_label: cyc?.label || null,
      // No `waived` field here - waived requirements are filtered
      // out at the query above and do not reach the wire. A field
      // that is always false is a trap for the next reader. When
      // Records ships, waived rows land there directly.
      signed: att != null,
      signed_at: att?.signed_at || null,
      certificate_serial: att?.certificate_serial || null,
      // attestation_id powers the completed-row "View" link into
      // /api/academy/certificate/[attestationId]. Not sensitive on its
      // own - the endpoint enforces ownership and returns 404 on
      // mismatch so this id cannot be used to probe existence.
      attestation_id: att?.attestation_id || null,
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

  // 4a. Next cycle - first published cycle whose period_start is
  // in the future. Feeds the rail's "Coming up" section (owner walk
  // 2026-09-01: it was rendering "Opens when this cycle closes"
  // which is vague where it should be concrete). When there IS no
  // future cycle, the client says so plainly.
  const _todayISO = today.toISOString().slice(0, 10);
  const nextCycle = (() => {
    const future = cycles
      .filter((c) => c.status === "published" && c.period_start > _todayISO)
      .sort((a, b) => a.period_start.localeCompare(b.period_start));
    return future[0]
      ? {
          cycle_id: future[0].cycle_id,
          label: future[0].label,
          period_start: future[0].period_start,
          period_end: future[0].period_end,
        }
      : null;
  })();

  // 4b. Viewer record - real numbers for the "Your record" tiles
  // (owner walk 2026-09-01: three of four tiles were 0). All-time
  // signed count uses the full attestations list from step 3; the
  // check + minute totals come from the two new viewer queries.
  const viewerAttempts = viewerAttemptsQ.data || [];
  const viewerProgress = viewerProgressQ.data || [];
  const checksPassed = viewerAttempts.filter((a) => a.correct).length;
  const retries = Math.max(0, viewerAttempts.length - checksPassed);
  const secondsRead = viewerProgress.reduce(
    (acc, r) => acc + (r.time_spent_seconds || 0),
    0
  );
  const minutesRead = secondsRead > 0 ? Math.max(1, Math.round(secondsRead / 60)) : 0;
  // "Cycles closed" is any cycle whose period_end is in the past AND
  // was published. Zero on a first-run pilot; when zero the client
  // renders a first-run state for the on-time-cycles tile rather
  // than a bare "0".
  const cyclesClosedCount = cycles.filter(
    (c) => c.status === "published" && c.period_end < _todayISO
  ).length;
  const viewerRecord = {
    signedAllTime: (attestationsQ.data || []).length,
    minutesReadThisCycle: minutesRead,
    checksPassed,
    retries,
    cyclesClosedCount,
    firstRun: cyclesClosedCount === 0,
  };

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
    // display_name added for the Company Standing expand rows (spec
    // 18.2 amended by the room-composition PR). Peer visibility rule
    // is enforced client-side: salaried people render named; hourly
    // people not in the cycle's audience aggregate to a single row.
    const [peopleQ, excQ, acctsQ, cycleReqsQ, cycleAttQ] = await Promise.all([
      supa
        .from("people")
        .select("worker_id, display_name, is_salaried, account_key")
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
      currentCycle
        ? supa
            .from("academy_attestations")
            .select("worker_id, requirement_id")
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
    if (cycleAttQ.error) {
      console.error("[api/academy/room] cycle attestations:", cycleAttQ.error.message);
      return NextResponse.json({ error: "server_error", scope: "scope_cycleatt" }, { status: 500 });
    }

    const excludedIds = new Set((excQ.data || []).map((r) => r.worker_id));
    const enrolledWorkerIds = new Set((cycleReqsQ.data || []).map((r) => r.worker_id));
    const signedWorkerIds = new Set((cycleAttQ.data || []).map((r) => r.worker_id));

    // Per-account rollup: for each account in scope, count eligibility
    // and enrollment. Every account renders - even ones with zero
    // enrolled - because a not-enrolled state is a real fact, not an
    // absent one. Also builds a per-account people[] for the Company
    // Standing expand rows (spec 3.4 peer visibility: salaried named,
    // hourly-not-in-audience aggregated).
    const perAccount = new Map();
    for (const a of acctsQ.data || []) {
      perAccount.set(a.team_key, {
        team_key: a.team_key,
        region: a.region || null,
        eligible: 0,
        enrolled: 0,
        people: [],
        aggregateHourly: 0,
      });
    }
    for (const p of peopleQ.data || []) {
      const row = perAccount.get(p.account_key);
      if (!row) continue; // person on an account not in scope (defensive)
      if (excludedIds.has(p.worker_id)) continue;
      row.eligible += 1;
      const isEnrolled = enrolledWorkerIds.has(p.worker_id);
      const isSigned = signedWorkerIds.has(p.worker_id);
      if (isEnrolled) row.enrolled += 1;
      // Spec 3.4 peer visibility. Salaried people render named. Hourly
      // people IN this cycle's audience (enrolled) render named too.
      // Hourly people NOT in the audience aggregate to a single row -
      // never named lists of people who have not done something.
      if (p.is_salaried || isEnrolled) {
        row.people.push({
          worker_id: p.worker_id,
          display_name: p.display_name || null,
          is_salaried: !!p.is_salaried,
          status: isSigned ? "signed" : (isEnrolled ? "in_progress" : "not_enrolled"),
        });
      } else {
        row.aggregateHourly += 1;
      }
    }
    for (const row of perAccount.values()) {
      row.people.sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
    }

    const accountsOut = [...perAccount.values()]
      .sort((a, b) => (a.region || "").localeCompare(b.region || "") || a.team_key.localeCompare(b.team_key))
      .map((r) => ({
        team_key: r.team_key,
        region: r.region,
        eligible: r.eligible,
        enrolled: r.enrolled,
        notEnrolled: r.eligible - r.enrolled,
        people: r.people,
        aggregateHourly: r.aggregateHourly,
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
      // roleTitle = people.title (e.g. "Director of Operations"),
      // added 2026-09-01 for the room rail. Owner walk found the rail
      // was rendering accountKey ("Corporate") as a job title.
      roleTitle: identity.roleTitle,
      accountKey: identity.accountKey,
      region: identity.region,
      isSalaried: identity.isSalaried,
      isSiteLeader: identity.isSiteLeader,
      isCorp: identity.isCorp,
      scope: identity.scope,
      grants: identity.grants,
      eligibleInScope: eligibleCounts,
      record: viewerRecord,
    },
    queue,
    queueSummary,
    yearTrack,
    nextCycle,
    companyStanding,
  });
}

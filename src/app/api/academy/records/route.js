// /api/academy/records
//
// Data for the Records room at /opd (tab: Records). Records is the
// ledger surface: every row is a FACT with a source. Nothing on this
// wire is a computed status. If a number here disagrees with the
// Academy room, Records is right (it reads the record).
//
// Response shape (Mine, always present):
//   mine: {
//     signatures: [ {attestation + doc + module + attempts + minutes} ]
//     waived:     [ {requirement + doc + module + waive_reason + waived_by + waived_at + cycle_label} ]
//     outstanding:[ {requirement + doc + module + cycle_label + due_date} ]
//   }
//
// Response shape (Company, only when viewer holds academy_admin):
//   company: {
//     accounts: [ {team_key, region} ]              // for the filter
//     cycles:   [ {cycle_id, label, period_start} ] // for the filter
//     signatures: [ {attestation + person + doc + module + cycle_label} ]
//     truncated: bool                               // future safety
//   }
//   Only accounts with at least one attestation OR any account the
//   viewer scopes to for the filter list. Signatures are unfiltered
//   here - the client applies the account + cycle filter locally.
//   Peer visibility per spec 3.4: this view names people who
//   COMPLETED something. It never becomes a "has not" list -
//   outstanding work sits in the Academy room's Company Standing
//   card, not here.
//
// This is a READ-ONLY route. No writes, no mutations. Same TEST_MODE
// bypass as /api/academy/room + /api/academy/library.

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

export async function GET() {
  // TEST_MODE bypass mirrors src/middleware.js (double-gated:
  // TEST_MODE AND VERCEL !== "1"). Same pattern as sibling routes.
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

  // Identity resolution (per-request; same pattern as room route).
  let identity;
  try {
    identity = await resolveAcademyIdentity(email, { supa });
  } catch (err) {
    console.error("[api/academy/records] resolve threw:", err?.message || err);
    return NextResponse.json({ error: "server_error", scope: "identity" }, { status: 500 });
  }
  if (!identity) {
    return NextResponse.json(
      { error: "no_roster_row", detail: "signed-in email resolved to no active people row" },
      { status: 404 }
    );
  }

  // ── Mine ────────────────────────────────────────────────────
  // Pull ALL of the viewer's requirements (INCLUDING waived - unlike
  // /api/academy/room which filters them out). Waived rows are the
  // point of the Records/Waived section per spec 5.3.
  const [reqsQ, attestationsQ, attemptsQ, progressQ, cyclesQ] = await Promise.all([
    supa
      .from("academy_requirements")
      .select(
        "requirement_id, worker_id, doc_id, obligation_key, doc_version, est_minutes, cycle_id, due_date, issued_at, waived_at, waived_by, waive_reason, source"
      )
      .eq("worker_id", identity.workerId)
      .order("due_date", { ascending: true }),
    supa
      .from("academy_attestations")
      .select(
        "attestation_id, requirement_id, doc_id, obligation_key, doc_version, signed_at, certificate_serial, attempts_count, time_spent_seconds"
      )
      .eq("worker_id", identity.workerId)
      .order("signed_at", { ascending: false }),
    supa
      .from("academy_check_attempts")
      .select("attempt_id, requirement_id, correct")
      .eq("worker_id", identity.workerId),
    supa
      .from("academy_module_progress")
      .select("requirement_id, time_spent_seconds")
      .eq("worker_id", identity.workerId),
    supa
      .from("academy_cycles")
      .select("cycle_id, label, period_start, period_end, status")
      .order("period_start", { ascending: true }),
  ]);
  if (reqsQ.error) {
    console.error("[api/academy/records] requirements:", reqsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "requirements" }, { status: 500 });
  }
  if (attestationsQ.error) {
    console.error("[api/academy/records] attestations:", attestationsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "attestations" }, { status: 500 });
  }
  if (attemptsQ.error) {
    console.error("[api/academy/records] attempts:", attemptsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "attempts" }, { status: 500 });
  }
  if (progressQ.error) {
    console.error("[api/academy/records] progress:", progressQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "progress" }, { status: 500 });
  }
  if (cyclesQ.error) {
    console.error("[api/academy/records] cycles:", cyclesQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "cycles" }, { status: 500 });
  }

  const reqs = reqsQ.data || [];
  const attestations = attestationsQ.data || [];
  const attempts = attemptsQ.data || [];
  const progress = progressQ.data || [];
  const cycles = cyclesQ.data || [];

  // Enrichment lookups.
  const distinctDocIds = [
    ...new Set([
      ...reqs.map((r) => r.doc_id),
      ...attestations.map((a) => a.doc_id),
    ].filter(Boolean)),
  ];
  const [docsQ, obligationsQ] = await Promise.all([
    distinctDocIds.length > 0
      ? supa.from("documents").select("id, title, doc_class, version").in("id", distinctDocIds)
      : Promise.resolve({ data: [], error: null }),
    distinctDocIds.length > 0
      ? supa
          .from("academy_obligations")
          .select("doc_id, obligation_key, source_section, description")
          .in("doc_id", distinctDocIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (docsQ.error) {
    console.error("[api/academy/records] documents:", docsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "documents" }, { status: 500 });
  }
  if (obligationsQ.error) {
    console.error("[api/academy/records] obligations:", obligationsQ.error.message);
    return NextResponse.json({ error: "server_error", scope: "obligations" }, { status: 500 });
  }

  const docsById = new Map();
  for (const d of docsQ.data || []) docsById.set(d.id, d);
  const obligationsByKey = new Map();
  for (const ob of obligationsQ.data || []) {
    obligationsByKey.set(`${ob.doc_id}|${ob.obligation_key}`, ob);
  }
  const cyclesById = new Map();
  for (const c of cycles) cyclesById.set(c.cycle_id, c);
  const attestationsByReq = new Map();
  for (const a of attestations) {
    if (a.requirement_id) attestationsByReq.set(a.requirement_id, a);
  }

  // Attempts summary per requirement. attempts_count on the
  // attestation is authoritative for signed rows; the raw attempts
  // let us count passed vs total honestly ("3 attempts to pass" is a
  // truer signal than a hidden 1).
  const attemptStatsByReq = new Map();
  for (const at of attempts) {
    if (!at.requirement_id) continue;
    const s = attemptStatsByReq.get(at.requirement_id) || { total: 0, correct: 0 };
    s.total += 1;
    if (at.correct) s.correct += 1;
    attemptStatsByReq.set(at.requirement_id, s);
  }
  const progressByReq = new Map();
  for (const p of progress) {
    if (!p.requirement_id) continue;
    progressByReq.set(p.requirement_id, p.time_spent_seconds || 0);
  }

  function docLabel(docId) {
    const d = docsById.get(docId);
    return {
      id: docId,
      title: d?.title || docId,
      doc_class: d?.doc_class || null,
    };
  }
  function moduleLabel(docId, obligationKey) {
    const ob = obligationsByKey.get(`${docId}|${obligationKey}`);
    return {
      key: obligationKey,
      source_section: ob?.source_section || null,
      description: ob?.description || null,
    };
  }

  // Signatures: one row per attestation, newest first (already
  // ordered by signed_at DESC on the wire).
  const signatures = attestations.map((a) => {
    const stats = attemptStatsByReq.get(a.requirement_id) || null;
    const progressSeconds = progressByReq.get(a.requirement_id) || 0;
    // Prefer the attestation's own time_spent_seconds (the frozen
    // record) over the progress table (mutable scratch surface).
    const seconds = a.time_spent_seconds != null && a.time_spent_seconds >= 0
      ? a.time_spent_seconds
      : progressSeconds;
    const minutes = seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0;
    return {
      attestation_id: a.attestation_id,
      doc: docLabel(a.doc_id),
      module: moduleLabel(a.doc_id, a.obligation_key),
      doc_version: a.doc_version,
      signed_at: a.signed_at,
      certificate_serial: a.certificate_serial,
      // attempts_count is the frozen count on the attestation.
      // attemptsPassed / attemptsTotal come from the raw attempt log
      // so "3 tries" shows honestly even if the attestation lost the
      // history (which it does not today, but the raw log is the
      // audit trail).
      attempts_count: a.attempts_count,
      attempts_passed: stats?.correct ?? null,
      attempts_total: stats?.total ?? null,
      minutes,
      // The certificate href the client renders. Stable across the
      // #965 merge state per the PR spec.
      certificate_href: `/api/academy/certificate/${a.attestation_id}`,
    };
  });

  // Waived: every waived requirement, with the reason IN FULL.
  const waivedRows = reqs
    .filter((r) => r.waived_at != null)
    .map((r) => ({
      requirement_id: r.requirement_id,
      doc: docLabel(r.doc_id),
      module: moduleLabel(r.doc_id, r.obligation_key),
      doc_version: r.doc_version,
      cycle_id: r.cycle_id,
      cycle_label: r.cycle_id != null ? cyclesById.get(r.cycle_id)?.label || null : null,
      waived_at: r.waived_at,
      waived_by: r.waived_by,
      waive_reason: r.waive_reason,
    }))
    .sort((a, b) => (b.waived_at || "").localeCompare(a.waived_at || ""));

  // Outstanding: unsigned AND not waived. Same set the Academy room
  // shows in the queue, presented as facts (row per outstanding
  // requirement) rather than as work.
  const outstandingRows = reqs
    .filter((r) => r.waived_at == null && !attestationsByReq.has(r.requirement_id))
    .map((r) => ({
      requirement_id: r.requirement_id,
      doc: docLabel(r.doc_id),
      module: moduleLabel(r.doc_id, r.obligation_key),
      doc_version: r.doc_version,
      cycle_id: r.cycle_id,
      cycle_label: r.cycle_id != null ? cyclesById.get(r.cycle_id)?.label || null : null,
      due_date: r.due_date,
      issued_at: r.issued_at,
      source: r.source,
      est_minutes: r.est_minutes || 0,
    }))
    .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

  const mine = {
    signatures,
    waived: waivedRows,
    outstanding: outstandingRows,
  };

  // ── Company ─────────────────────────────────────────────────
  // Only for academy_admin. Every attestation across the org.
  // This view names people who COMPLETED something (spec 3.4).
  let company = null;
  if ((identity.grants || []).includes("academy_admin")) {
    // Everything joined together at the API. Filters happen client
    // side (list is small enough - one cycle in the pilot).
    const [allAttQ, peopleQ, accountsQ] = await Promise.all([
      supa
        .from("academy_attestations")
        .select(
          "attestation_id, worker_id, requirement_id, doc_id, obligation_key, doc_version, signed_at, certificate_serial"
        )
        .order("signed_at", { ascending: false })
        .limit(2000),
      supa
        .from("people")
        .select("worker_id, display_name, account_key, is_salaried"),
      supa
        .from("accounts")
        .select("team_key, region, active"),
    ]);
    if (allAttQ.error) {
      console.error("[api/academy/records] company attestations:", allAttQ.error.message);
      return NextResponse.json({ error: "server_error", scope: "company_attestations" }, { status: 500 });
    }
    if (peopleQ.error) {
      console.error("[api/academy/records] company people:", peopleQ.error.message);
      return NextResponse.json({ error: "server_error", scope: "company_people" }, { status: 500 });
    }
    if (accountsQ.error) {
      console.error("[api/academy/records] company accounts:", accountsQ.error.message);
      return NextResponse.json({ error: "server_error", scope: "company_accounts" }, { status: 500 });
    }

    const allAtts = allAttQ.data || [];
    const peopleByWorker = new Map();
    for (const p of peopleQ.data || []) peopleByWorker.set(p.worker_id, p);
    const accountsByKey = new Map();
    for (const a of accountsQ.data || []) accountsByKey.set(a.team_key, a);

    // Company needs docs + obligations for every doc that has an
    // attestation, not just the viewer's. Second pull, small set.
    const companyDocIds = [...new Set(allAtts.map((a) => a.doc_id).filter(Boolean))];
    const missingDocIds = companyDocIds.filter((id) => !docsById.has(id));
    if (missingDocIds.length > 0) {
      const extraDocsQ = await supa
        .from("documents")
        .select("id, title, doc_class, version")
        .in("id", missingDocIds);
      if (extraDocsQ.error) {
        console.error("[api/academy/records] company documents:", extraDocsQ.error.message);
        return NextResponse.json({ error: "server_error", scope: "company_documents" }, { status: 500 });
      }
      for (const d of extraDocsQ.data || []) docsById.set(d.id, d);
    }
    const companyMissingObPairs = [
      ...new Set(
        allAtts
          .map((a) => `${a.doc_id}|${a.obligation_key}`)
          .filter((k) => !obligationsByKey.has(k))
      ),
    ];
    if (companyMissingObPairs.length > 0) {
      const extraObDocIds = [...new Set(companyMissingObPairs.map((p) => p.split("|")[0]))];
      const extraObQ = await supa
        .from("academy_obligations")
        .select("doc_id, obligation_key, source_section, description")
        .in("doc_id", extraObDocIds);
      if (extraObQ.error) {
        console.error("[api/academy/records] company obligations:", extraObQ.error.message);
        return NextResponse.json({ error: "server_error", scope: "company_obligations" }, { status: 500 });
      }
      for (const ob of extraObQ.data || []) {
        obligationsByKey.set(`${ob.doc_id}|${ob.obligation_key}`, ob);
      }
    }

    // Requirements lookup for cycle mapping on company attestations.
    // Only attestations that carry a requirement_id can be mapped to
    // a cycle here; the rest render with cycle blank.
    const companyReqIds = [...new Set(allAtts.map((a) => a.requirement_id).filter(Boolean))];
    let reqCycleByReqId = new Map();
    if (companyReqIds.length > 0) {
      // Bounded IN () - safe up to a few thousand ids.
      const reqCycleQ = await supa
        .from("academy_requirements")
        .select("requirement_id, cycle_id")
        .in("requirement_id", companyReqIds);
      if (reqCycleQ.error) {
        console.error("[api/academy/records] company req cycles:", reqCycleQ.error.message);
        return NextResponse.json({ error: "server_error", scope: "company_req_cycles" }, { status: 500 });
      }
      for (const r of reqCycleQ.data || []) {
        reqCycleByReqId.set(r.requirement_id, r.cycle_id);
      }
    }

    const companySignatures = allAtts.map((a) => {
      const person = peopleByWorker.get(a.worker_id) || null;
      const cycleId = a.requirement_id ? reqCycleByReqId.get(a.requirement_id) : null;
      const cyc = cycleId != null ? cyclesById.get(cycleId) : null;
      const acct = person?.account_key ? accountsByKey.get(person.account_key) : null;
      return {
        attestation_id: a.attestation_id,
        worker_id: a.worker_id,
        person: {
          display_name: person?.display_name || null,
          account_key: person?.account_key || null,
          account_region: acct?.region || null,
          is_salaried: !!person?.is_salaried,
        },
        doc: docLabel(a.doc_id),
        module: moduleLabel(a.doc_id, a.obligation_key),
        doc_version: a.doc_version,
        signed_at: a.signed_at,
        certificate_serial: a.certificate_serial,
        cycle_id: cycleId || null,
        cycle_label: cyc?.label || null,
        certificate_href: `/api/academy/certificate/${a.attestation_id}`,
      };
    });

    // Filter facets: only accounts that actually appear in the ledger
    // OR sit in the viewer's scope. Every published cycle appears
    // regardless of whether it has attestations, because "no
    // signatures yet in this cycle" is a real filter result and the
    // absence deserves surfacing.
    const accountFacetKeys = new Set(
      companySignatures.map((s) => s.person.account_key).filter(Boolean)
    );
    for (const k of identity.scope?.accounts || []) accountFacetKeys.add(k);
    const accountFacets = [...accountFacetKeys]
      .map((key) => {
        const a = accountsByKey.get(key);
        return {
          team_key: key,
          region: a?.region || null,
        };
      })
      .sort((a, b) =>
        (a.region || "").localeCompare(b.region || "") || a.team_key.localeCompare(b.team_key)
      );
    const cycleFacets = cycles
      .filter((c) => c.status === "published")
      .map((c) => ({
        cycle_id: c.cycle_id,
        label: c.label,
        period_start: c.period_start,
      }))
      .sort((a, b) => (b.period_start || "").localeCompare(a.period_start || ""));

    // Enrolled-in-current-cycle count for the empty-state copy.
    // Uses the resolver's "cycle open today" definition (earliest
    // published cycle with period_end >= today).
    const todayISO = new Date().toISOString().slice(0, 10);
    const activeCycles = cycles
      .filter((c) => c.status === "published" && c.period_end >= todayISO)
      .sort((a, b) => a.period_start.localeCompare(b.period_start));
    const currentCycle = activeCycles[0] || null;
    let enrolledInCurrent = 0;
    if (currentCycle) {
      const enrollQ = await supa
        .from("academy_requirements")
        .select("worker_id", { count: "exact", head: true })
        .eq("cycle_id", currentCycle.cycle_id);
      if (!enrollQ.error) {
        // Distinct worker_id would be more precise but Supabase does
        // not expose count-distinct via head:true; the row count is
        // an upper bound and used only in first-run empty copy.
        enrolledInCurrent = enrollQ.count || 0;
      }
    }

    company = {
      signatures: companySignatures,
      accounts: accountFacets,
      cycles: cycleFacets,
      currentCycle: currentCycle
        ? { cycle_id: currentCycle.cycle_id, label: currentCycle.label }
        : null,
      enrolledInCurrent,
      truncated: companySignatures.length >= 2000,
    };
  }

  return NextResponse.json({
    ok: true,
    viewer: {
      workerId: identity.workerId,
      displayName: identity.displayName,
      grants: identity.grants || [],
      isAcademyAdmin: (identity.grants || []).includes("academy_admin"),
    },
    mine,
    company,
  });
}

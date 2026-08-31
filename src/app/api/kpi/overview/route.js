// src/app/api/kpi/overview/route.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// GET /api/kpi/overview - the Overview payload. Composes labor's
// buildBoard + purchasing's buildPurchasingBoard as library calls;
// binds pnl_actuals + kpi_period_status + kpi_account_flags on top
// per KPI_MASTER_SCOPE.md v4 §5.4-§5.8.
//
// Auth (mirrors labor + purchasing routes):
//   - TEST_MODE double-gate (kills on Vercel) for probes / smokes
//   - NextAuth session for real users
//   - KPI_PREVIEW_ALLOWLIST fence (only Kevin until KPI_PREVIEW_ONLY
//     flips to false in Phase 4)
//   - OPS_LEADERSHIP_EMAILS gate (session must be on the list)
//   - Role gate resolves the caller shape (corporate / rdo /
//     site_leader / site_manager)
//   - Preview mode via resolvePreviewAccess (narrows, never grants)
//
// Query params:
//   account       - team_key, ALL, EAST, WEST (default empty -> landing)
//   preview       - preview target (narrows via role gate)
//   range         - 'fytd' | 'period:N' (shorthand) OR use start/end
//   start, end    - ISO YYYY-MM-DD (when range is explicit)
//   rev_source    - 'planned' (default) | 'sc' (corporate + per-meal only)
//   include_salary - '1' to include salary (gated by canSeeSalary)
//   debug         - 'timing' -> include _debug.timings block
//
// Response:
//   Overview payload per resolveOverview()'s output. See
//   src/lib/kpi/overview/resolver.js for the full shape.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { KPI_PREVIEW_ONLY, KPI_PREVIEW_ALLOWLIST, loadRoleGate } from "@/lib/kpi/roleGate.js";
import { resolvePreviewAccess } from "@/lib/kpi/previewAccess.js";
import { isKnownAccount } from "@/lib/accountModels.js";
import { resolveOverview } from "@/lib/kpi/overview/resolver.js";

const V6_PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);

function safeError(scope, err) {
  console.error(`[kpi/overview] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

function parseRange(searchParams) {
  const rangeParam = (searchParams.get("range") || "").trim();
  const startParam = (searchParams.get("start") || "").trim();
  const endParam   = (searchParams.get("end")   || "").trim();

  if (rangeParam === "fytd") return { kind: "fytd" };
  if (rangeParam.startsWith("period:")) {
    const n = Number(rangeParam.slice("period:".length));
    if (Number.isInteger(n) && n >= 1 && n <= 13) return { kind: "period", period_no: n };
  }
  if (startParam && endParam) return { kind: "explicit", start: startParam, end: endParam };
  // Default to FYTD when nothing is specified.
  return { kind: "fytd" };
}

export async function GET(request) {
  // TEST_MODE double-gate mirrors labor + purchasing routes.
  const testModeBypass = process.env.TEST_MODE === "true" && process.env.VERCEL !== "1";
  let email = null;
  if (!testModeBypass) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    email = session.user?.email?.toLowerCase().trim();
    // KPI preview fence (mirrors labor/purchasing routes). Sits IN FRONT
    // of the OPS_LEADERSHIP gate so a fenced caller is refused even if
    // on the ops list.
    if (KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST.includes(email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  let account = (searchParams.get("account") || "").trim();
  const previewParam = (searchParams.get("preview") || "").trim();
  const revSourceReq = (searchParams.get("rev_source") || "").trim().toLowerCase();
  const includeSalaryReq = searchParams.get("include_salary") === "1";
  const debug = (searchParams.get("debug") || "").trim().toLowerCase();
  const debugTiming = debug === "timing";

  const supa = getServiceClient();

  // Role gate + preview narrowing.
  const gate = await loadRoleGate(supa);
  if (gate.error) return NextResponse.json(safeError("role_gate", gate.error), { status: 500 });
  let caller;
  if (testModeBypass) {
    // Default to corporate for TEST_MODE (matches labor + purchasing).
    // Overview Phase 3 additional: honor `?_test_role=<role>` +
    // `?_test_scope=<key>` when set, so a local Playwright / probe run
    // can exercise the site posture directly instead of narrowing an
    // account via ?preview= (which keeps the caller corporate). Kevin
    // PR #916 review: "exercise the site posture directly, in
    // TEST_MODE, by supplying a site-leader role to the resolver
    // rather than by narrowing account access."
    //
    // BINDING: this branch is unreachable on Vercel (`VERCEL=1` kills
    // testModeBypass upstream). Never trust these params off a local
    // TEST_MODE run. The values are echoed into the audit-log line
    // via caller.role so the render is self-labelling.
    const testRoleReq = (new URL(request.url).searchParams.get("_test_role") || "").trim();
    const testScopeReq = (new URL(request.url).searchParams.get("_test_scope") || "").trim();
    const ALLOWED_TEST_ROLES = new Set(["corporate", "rdo", "site_leader", "site_manager"]);
    if (testRoleReq && ALLOWED_TEST_ROLES.has(testRoleReq)) {
      caller = {
        role: testRoleReq,
        scope: testScopeReq || null,
        // site_manager cannot see salary; every other role defaults
        // true (matches the roleGate default).
        can_see_salary: testRoleReq !== "site_manager",
      };
    } else {
      caller = { role: "corporate", scope: null, can_see_salary: true };
    }
  } else {
    try { caller = await gate.resolveKpiRole(email); }
    catch (e) { return NextResponse.json(safeError("role_gate_resolve", e), { status: 500 }); }
    if (!caller) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const landing_account = gate.landingAccount(caller);

  // Preview target validation (mirrors purchasing route). Silent-ignore
  // an unknown preview matches resolvePreviewAccess's safety spirit.
  const previewIsValidTarget = previewParam && (
    isKnownAccount(previewParam) || V6_PSEUDO_KEYS.has(previewParam)
  );
  const preview = resolvePreviewAccess({
    caller,
    canViewAccount: gate.canViewAccount,
    urlAccount: account,
    previewParam: previewIsValidTarget ? previewParam : "",
  });
  account = preview.account;
  const preview_account = preview.preview_account;

  // No account -> landing response (matches labor's shape).
  if (!account) {
    return NextResponse.json({
      landing_account,
      preview_account,
    });
  }
  if (account === "CORP") {
    return NextResponse.json({ error: "account_out_of_scope", account }, { status: 400 });
  }

  // Locked-state response for accounts the caller cannot view.
  if (!gate.canViewAccount(caller, account)) {
    return NextResponse.json({
      locked: true,
      account,
      reason: "not_authorised",
      landing_account,
      preview_account,
    });
  }

  // Role gate for salary + rev_source.
  const salaryAvailable = gate.canSeeSalary(caller, account);
  const includeSalary = includeSalaryReq && salaryAvailable;

  // rev_source: 'planned' default. 'sc' requires corporate posture
  // (rdo counts). Site leader / manager silently drop to 'planned'.
  const isCorporatePosture = caller.role === "corporate" || caller.role === "rdo";
  const revSource = (revSourceReq === "sc" && isCorporatePosture) ? "sc" : "planned";

  // Range resolution.
  let range;
  try { range = parseRange(searchParams); }
  catch (e) { return NextResponse.json(safeError("range", e), { status: 400 }); }

  // Resolve the Overview payload.
  let payload;
  try {
    payload = await resolveOverview({
      supa,
      accountKey: account,
      range,
      revSource,
      includeSalary,
      caller: { ...caller, can_see_salary: caller.can_see_salary !== false },
      today,
      debugTiming,
    });
  } catch (e) {
    return NextResponse.json(safeError("resolve_overview", e), { status: 500 });
  }
  if (payload?.error) {
    return NextResponse.json(safeError(payload.scope || "resolve_overview", payload.error), { status: 500 });
  }
  payload.preview_account = preview_account;
  payload.landing_account = landing_account;
  return NextResponse.json(payload);
}

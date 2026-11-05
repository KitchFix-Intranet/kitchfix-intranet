// /api/kpi/overview/export
//
// KPI P&L Overview workbook export, role-adaptive.
//
//   - corporate   -> All / East / West rollups + 11 account tabs,
//                    with the delta (variance) column. NO CORP tab.
//   - site_leader -> single tab for caller.scope. NO delta column.
//   - rdo, site_manager, fenced email -> 403. The P&L carries 3100.2
//     Salary Kitchen Wages; the role gate is the salary gate.
//
// Period set: fiscal periods where kpi_period_status.closed_at IS NOT
// NULL AND verified_at IS NOT NULL for the current fiscal year. Today
// that is P1-P9 (P10 verified but not closed -> excluded). The range
// is computed per-request, not hardcoded.
//
// Server figures only: reads pnl_actuals verbatim (the same source the
// Overview dashboard already uses for verified periods). No derivation,
// no reshaping - per gen_pnl.py, the Excel layout is formulas; the
// cells carry raw server values.
//
// Query params: none. Role + scope resolve from the caller.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getServiceClient } from "@/lib/supabase";
import { KPI_PREVIEW_ONLY, KPI_PREVIEW_ALLOWLIST, loadRoleGate } from "@/lib/kpi/roleGate.js";
import { fiscalYearOf } from "@/app/kpi/labor/lib/periods";
import { buildPnlWorkbook } from "@/lib/kpi/overview/pnlExport.js";
import { fetchAllOffset } from "@/lib/rippling/paginate";

// gen_pnl.py ACCOUNTS ordering + pnl_tab_name mapping. The DB `accounts`
// table carries pnl_tab_name on every billable team_key; keeping an
// explicit allowlist here means a new account row cannot silently alter
// the rollup tab order. Membership is enforced against the DB; this
// list is the display catalog.
//
// The ROLLUP display order is NOT alphabetical and NOT the per-account
// tab order (that is TAB_ORDER inside pnlExport.js). It is the authored
// order gen_pnl.py uses for the All / East / West rollup row sequence.
// Driving the Supabase .in() with this order does not guarantee sort;
// we hand the accounts to buildPnlWorkbook in this order explicitly.
const ROLLUP_ACCOUNT_KEYS = [
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY",
  "TBR - FL",
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

function safeError(scope, err) {
  console.error(`[kpi/overview/export] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

export async function GET(request) {
  // TEST_MODE double-gate - same shape as the read route + the labor /
  // purchasing export routes. Killed on Vercel (VERCEL=1 unsets).
  const testModeBypass = process.env.TEST_MODE === "true" && process.env.VERCEL !== "1";

  let email = null;
  let caller = null;

  const supa = getServiceClient();
  const gate = await loadRoleGate(supa);
  if (gate.error) return NextResponse.json(safeError("role_gate", gate.error), { status: 500 });

  if (!testModeBypass) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    email = session.user?.email?.toLowerCase().trim();
    // KPI PREVIEW FENCE - mirrors read + labor/purchasing export routes.
    if (KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST.includes(email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    try { caller = await gate.resolveKpiRole(email); }
    catch (e) { return NextResponse.json(safeError("role_gate_resolve", e), { status: 500 }); }
    if (!caller) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  } else {
    // TEST_MODE - allow a role override so a local probe can exercise
    // the site_leader branch. Mirrors the overview READ route's
    // backdoor at src/app/api/kpi/overview/route.js:146-159 (Kevin
    // PR #916: "exercise the site posture directly, in TEST_MODE").
    // Unreachable on Vercel (VERCEL=1 kills testModeBypass upstream).
    const testRoleReq = (new URL(request.url).searchParams.get("_test_role") || "").trim();
    const testScopeReq = (new URL(request.url).searchParams.get("_test_scope") || "").trim();
    const ALLOWED = new Set(["corporate", "rdo", "site_leader", "site_manager"]);
    if (testRoleReq && ALLOWED.has(testRoleReq)) {
      caller = { role: testRoleReq, scope: testScopeReq || null, can_see_salary: testRoleReq !== "site_manager" };
    } else {
      caller = { role: "corporate", scope: null, can_see_salary: true };
    }
    email = "test-mode@local";
  }

  // Role routing - corporate and site_leader are the only exporting
  // roles. See the KPI_ROLE_GATES_SPEC (via roleGate.js) for the full
  // posture model.
  if (!(caller.role === "corporate" || caller.role === "site_leader")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (caller.role === "site_leader" && !caller.scope) {
    return NextResponse.json({ error: "no_scope" }, { status: 403 });
  }

  // Resolve the current fiscal year + the closed+verified period set.
  const today = new Date().toISOString().slice(0, 10);
  const fiscalYear = fiscalYearOf(today);
  if (!fiscalYear) return NextResponse.json(safeError("fiscal_year", new Error("could not resolve FY from today")), { status: 500 });

  const periodQ = await supa
    .from("kpi_period_status")
    .select("period_no")
    .eq("fiscal_year", fiscalYear)
    .not("closed_at", "is", null)
    .not("verified_at", "is", null)
    .order("period_no", { ascending: true });
  if (periodQ.error) return NextResponse.json(safeError("kpi_period_status", periodQ.error), { status: 500 });
  const periods = (periodQ.data || []).map((r) => r.period_no).filter((p) => p >= 1 && p <= 13);
  if (periods.length === 0) {
    return NextResponse.json({ error: "no_closed_verified_periods", fiscalYear }, { status: 404 });
  }
  // Periods are expected contiguous P1..PN today; label from first..last
  // so the subtitle + YTD header match what the data covers.
  const pFirst = periods[0];
  const pLast = periods[periods.length - 1];
  const periodLabel = `P${pFirst}-P${pLast}`;

  // Data pulls.
  //
  // Site-leader path pulls only the caller's account; corporate pulls
  // every rollup-list account. kpi_lines is the chart; accounts is the
  // display catalog.
  const wantAccounts = caller.role === "site_leader"
    ? [caller.scope]
    : ROLLUP_ACCOUNT_KEYS;

  // pnl_actuals is paginated: 11 accounts x ~32 lines x 9 periods
  // puts the corporate pull well past Supabase's silent 1000-row cap.
  // Prior to this, the truncated response rendered zero-filled STL-FL
  // onward; CIN tabs rendered fine because they sorted first and fit
  // under the cap. fetchAllOffset chunks until exhausted, so the
  // export is sum-complete per owner's 2026-08-28 pagination sweep.
  let actRows;
  try {
    actRows = await fetchAllOffset(
      supa,
      "pnl_actuals",
      "account_key, period_no, line_code, budget, actual",
      [
        (q) => q.eq("fiscal_year", fiscalYear),
        (q) => q.in("account_key", wantAccounts),
        (q) => q.in("period_no", periods),
      ],
    );
  } catch (e) {
    return NextResponse.json(safeError("pnl_actuals", { message: e.message }), { status: 500 });
  }
  const [chartQ, acctQ] = await Promise.all([
    supa
      .from("kpi_lines")
      .select("line_code, line_name, section, group_code, sort_order"),
    supa
      .from("accounts")
      .select("team_key, pnl_tab_name, name, city, state, region, active")
      .in("team_key", wantAccounts),
  ]);
  if (chartQ.error) return NextResponse.json(safeError("kpi_lines", chartQ.error), { status: 500 });
  if (acctQ.error) return NextResponse.json(safeError("accounts", acctQ.error), { status: 500 });

  // Site-leader must have an accounts row to render a title.
  if (caller.role === "site_leader" && (acctQ.data || []).length === 0) {
    return NextResponse.json({ error: "scope_not_found", scope: caller.scope }, { status: 404 });
  }

  // Preserve the rollup display order defined by ROLLUP_ACCOUNT_KEYS.
  // Supabase .in() does not guarantee result order, so ordering happens
  // here (on the stable list) rather than SQL-side.
  const acctByKey = new Map((acctQ.data || []).map((r) => [r.team_key, r]));
  const accountsOrdered = ROLLUP_ACCOUNT_KEYS
    .map((k) => acctByKey.get(k))
    .filter(Boolean);

  // Index pnl_actuals into the Map<"<acct>|<code>", { b: {p: n}, a: {p: n} }> shape
  // the ExcelJS port consumes - gen_pnl.py uses the same keyed shape.
  const data = new Map();
  for (const r of actRows) {
    const key = `${r.account_key}|${r.line_code}`;
    let row = data.get(key);
    if (!row) { row = { b: {}, a: {} }; data.set(key, row); }
    row.b[r.period_no] = Number(r.budget || 0);
    row.a[r.period_no] = Number(r.actual || 0);
  }

  // Build.
  let buffer;
  try {
    buffer = await buildPnlWorkbook({
      data,
      accounts: accountsOrdered,
      chart: chartQ.data || [],
      periodCount: periods.length,
      periodLabel,
      fiscalYear,
      variant: caller.role === "corporate" ? "corporate" : "site_leader",
      siteLeaderTab: caller.role === "site_leader"
        ? (acctQ.data[0]?.pnl_tab_name || caller.scope.replace(/\s+/g, ""))
        : null,
    });
  } catch (e) {
    return NextResponse.json(safeError("build_workbook", e), { status: 500 });
  }

  const scopeLabel = caller.role === "corporate"
    ? "All Accounts"
    : (accountsOrdered[0]?.pnl_tab_name || caller.scope);
  const safeScope = scopeLabel.replace(/[^A-Za-z0-9._-]+/g, "_");
  const filename = `KitchFix P&L - ${scopeLabel} - ${fiscalYear} ${periodLabel}.xlsx`;
  // Content-Disposition's filename needs a sanitized fallback; the
  // filename* RFC 5987 form preserves the ampersand.
  const fallback = `KitchFix_PnL_${safeScope}_${fiscalYear}_${periodLabel}.xlsx`;

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

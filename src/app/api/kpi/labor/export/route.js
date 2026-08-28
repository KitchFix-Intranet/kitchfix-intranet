// /api/kpi/labor/export
//
// Read-only. Admin-gated via OPS_LEADERSHIP_EMAILS (same server-side
// gate as the labor read route - 401 for unauthenticated, 403 for
// non-allowlisted). Without the gate this route leaks payroll data
// for eleven accounts.
//
// Two shapes, one route:
//   - Single account (CIN - OH, STL - MO, etc.) - Detail is
//     (worker, week) rows. Existing shape, unchanged.
//   - Portfolio pseudo-key (ALL / EAST / WEST) - Detail is
//     (account, week) rows. Summary rolls to one row per account
//     across the range with a region column. Membership resolves
//     via the same helper the read route uses so the export cannot
//     disagree with the board about which accounts are in scope
//     (owner ruling 2026-08-24). See handlePortfolioExport below.
//
// Structure mirrors scripts/_xls_cin_oh_labor.mjs so the shape is
// familiar; provenance is complete on the Report info sheet AND
// coverage-state flags appear on the face of the Detail sheet.
//
// PR C4 additions:
//   - view_name and view_date_mode carried into the filename and the
//     Report info sheet. A spreadsheet outlives its context; the
//     recipient in March must be able to tell whether "Joe's monthly"
//     came from a fixed window or a rolling one.
//   - All numeric cells rounded to 2 decimals BEFORE write (fixes
//     81.28999999999999 float artifacts that appeared on aggregate
//     rows even under numFmt "0.00").
//   - Title strings trimmed (fixes trailing whitespace like `Cook `).
//
// Query params:
//   account         (required)
//   start           YYYY-MM-DD (defaults FY start 2025-12-29)
//   end             YYYY-MM-DD (defaults today)
//   workers         comma-separated worker_ids (optional; default all)
//   redact          "1" to render `#N` instead of names
//   view_name       optional; carried into filename + Report info
//   view_date_mode  optional; "preset" or "absolute"; carried into Report info

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
// KPI PREVIEW FENCE - single source of truth in roleGate.js. Sits in
// FRONT of the OPS_LEADERSHIP_EMAILS check so a fenced caller cannot
// pull labor data through the export route while the labor board is
// closed to non-Kevin sessions.
import { KPI_PREVIEW_ONLY, KPI_PREVIEW_ALLOWLIST } from "@/lib/kpi/roleGate";
import { getServiceClient } from "@/lib/supabase";
import { resolveWorkerName } from "@/lib/kpi/resolveName";
import { PORTFOLIO_KEYS, resolvePortfolioMembers } from "@/lib/kpi/portfolioMembers";
import { fetchAllOffset, fetchAllIn } from "@/lib/rippling/paginate";

const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);

// PR-D - portfolio pseudo-keys (ALL / EAST / WEST). Membership resolves
// via the same helper the read route uses so the export can never
// disagree with the board about which accounts are in scope. The
// portfolio path emits (account, week) rows in place of the worker
// Detail sheet; single-account exports keep the worker-level shape.
const PORTFOLIO_SEV_RANK = { unknown: 3, partial: 2, hours_only: 2, no_labor: 1, complete: 0 };
function worstCoverage(states) {
  let best = "complete";
  for (const s of states) {
    if ((PORTFOLIO_SEV_RANK[s] || 0) > (PORTFOLIO_SEV_RANK[best] || 0)) best = s;
  }
  return best;
}

// C4.5: round to 2 decimals, storing the rounded value (not just
// formatting). Prevents 81.28999999999999 in cells whose format is
// "0.00" - numFmt hides drift in display but copy-paste still shows it.
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

function safeError(scope, err) {
  console.error(`[kpi/labor/export] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const email = session.user?.email?.toLowerCase().trim();
  // KPI PREVIEW FENCE - refuse non-allowlisted callers before the
  // legacy OPS_LEADERSHIP check. Flipping KPI_PREVIEW_ONLY to false
  // in src/lib/kpi/roleGate.js opens this route back up to the six
  // OPS_LEADERSHIP emails.
  if (KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST.includes(email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const account = (searchParams.get("account") || "").trim();
  const start = searchParams.get("start") || "2025-12-29";
  const end = searchParams.get("end") || today;
  const workersFilterRaw = (searchParams.get("workers") || "").trim();
  const redact = searchParams.get("redact") === "1";
  const viewName = (searchParams.get("view_name") || "").trim().slice(0, 80);
  const viewDateMode = searchParams.get("view_date_mode") === "preset"
    ? "preset"
    : searchParams.get("view_date_mode") === "absolute"
      ? "absolute"
      : null;

  if (!account) {
    return NextResponse.json({ error: "account_required" }, { status: 400 });
  }
  if (D17_OUT_OF_SCOPE.has(account)) {
    return NextResponse.json({ error: "account_out_of_scope", account }, { status: 400 });
  }
  if (D26_SALARIED_ONLY.has(account)) {
    return NextResponse.json({
      error: "no_export_for_salaried_only",
      detail: `${account} has no hourly pipeline (D26).`,
    }, { status: 400 });
  }

  const workersFilter = workersFilterRaw
    ? new Set(workersFilterRaw.split(",").map(s => s.trim()).filter(Boolean))
    : null;

  const supa = getServiceClient();

  // ── Portfolio path (ALL / EAST / WEST) ───────────────────────────
  // Owner ruling 2026-08-24: match the on-screen grain. Detail rows
  // are (account, week) not (worker, week); Summary rolls to one row
  // per account across the range. Membership resolves via the same
  // helper the read route uses, so an EAST export cannot disagree
  // with the EAST board about which accounts are in scope.
  if (PORTFOLIO_KEYS.has(account)) {
    return await handlePortfolioExport({
      supa, session, account, start, end,
      viewName, viewDateMode,
      workersFilter,
    });
  }

  // 2026-08-28 pagination sweep: paginated via fetchAllOffset so the
  // CSV cannot silently truncate at 1000 rows. Single-account FYTD
  // (e.g., CIN - AZ mid-season) exceeds 1000 (worker, week, line)
  // rows; the prior bare select capped the export at 1000 and the
  // download opened in Excel with no indicator the tail was missing.
  let rows;
  try {
    rows = await fetchAllOffset(supa, "labor_actuals_latest",
      "account_key, worker_id, week_label, line_code, week_start, week_end, fiscal_year, period_no, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, segment_count, entry_count, coverage_state, derived_at",
      [
        (q) => q.eq("account_key", account),
        (q) => q.lte("week_start", end),
        (q) => q.gte("week_end", start),
        (q) => q.order("worker_id", { ascending: true }).order("week_start", { ascending: true }),
      ]);
  } catch (e) {
    return NextResponse.json(safeError("labor_actuals", { message: e.message }), { status: 500 });
  }
  if (workersFilter) rows = rows.filter(r => workersFilter.has(r.worker_id));

  // 2026-08-28 pagination sweep: .in() on rippling_raw_workers_latest
  // used to fail with 400 Bad Request from URL overflow when the
  // worker set exceeded ~700 (portfolio queries). The catch left the
  // workerMeta map empty and every cell rendered as raw #rippling_id.
  // fetchAllIn chunks the .in() key list; same for the users hop.
  const workerIds = [...new Set(rows.map(r => r.worker_id))];
  const workerMeta = new Map();
  if (workerIds.length > 0) {
    let workerRows = [];
    try {
      workerRows = await fetchAllIn(supa, "rippling_raw_workers_latest", "payload", {
        keyCol: "rippling_id", keyValues: workerIds,
      });
    } catch { /* leave workerMeta empty on error - existing shape */ }
    // Join user_id -> users. Same shape as the read route.
    const userIds = [...new Set(workerRows.map(r => r.payload?.user_id).filter(Boolean))];
    const userByRipplingId = new Map();
    if (userIds.length > 0) {
      let userRows = [];
      try {
        userRows = await fetchAllIn(supa, "rippling_raw_users_latest", "rippling_id, payload", {
          keyCol: "rippling_id", keyValues: userIds,
        });
      } catch { /* leave userByRipplingId empty on error */ }
      for (const r of userRows) userByRipplingId.set(r.rippling_id, r.payload || {});
    }
    for (const r of workerRows) {
      const p = r.payload || {};
      const userPayload = p.user_id ? userByRipplingId.get(p.user_id) : null;
      // B3 hard guard: when redact=1 we drop the resolved name at
      // ingest time so no downstream code path (existing or added
      // later) can inadvertently write it into a cell. Number + title
      // are the only worker fields the redacted export ever sees.
      const name = redact ? null : resolveWorkerName(p, userPayload);
      workerMeta.set(p.id, {
        number: p.number ?? null,
        name,
        // C4.5: trim title strings. Rippling returns some with trailing spaces.
        title: p.title ? String(p.title).trim() : null,
      });
    }
  }

  const psWalkGlobal = await supa
    .from("rippling_walks")
    .select("completed_at")
    .eq("kind", "pay_segments")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const cov = { complete: 0, partial: 0, hours_only: 0, unknown: 0, no_labor: 0 };
  for (const r of rows) cov[r.coverage_state] = (cov[r.coverage_state] || 0) + 1;
  const hasHoursOnly = cov.hours_only > 0;
  const hasUnknown = cov.unknown > 0;

  function displayForWorker(id) {
    const m = workerMeta.get(id);
    if (!m) return { primary: `#(unknown)`, secondary: "" };
    const num = m.number != null ? `#${m.number}` : `${String(id).slice(0, 6)}`;
    if (redact || !m.name) return { primary: num, secondary: m.title || "" };
    return { primary: `${m.name} (${num})`, secondary: m.title || "" };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "kitchfix intranet - kpi/labor export";
  wb.created = new Date();

  // ── Detail sheet ─────────────────────────────────────
  const detail = wb.addWorksheet("Detail");
  detail.columns = [
    { header: "Worker",         key: "worker",   width: 34 },
    { header: "Title",          key: "title",    width: 24 },
    { header: "Week",           key: "week",     width: 22 },
    { header: "FY",             key: "fy",       width: 6 },
    { header: "Period",         key: "period",   width: 8 },
    { header: "Coverage",       key: "coverage", width: 12 },
    { header: "Regular",        key: "reg",      width: 10, style: { numFmt: "0.00" } },
    { header: "OT 1.5x",        key: "ot",       width: 10, style: { numFmt: "0.00" } },
    { header: "Holiday 2x",     key: "hol",      width: 12, style: { numFmt: "0.00" } },
    { header: "Other prem.",    key: "othH",     width: 12, style: { numFmt: "0.00" } },
    { header: "Hrs toward OT",  key: "otTh",     width: 14, style: { numFmt: "0.00" } },
    { header: "No-$ hours",     key: "wo",       width: 12, style: { numFmt: "0.00" } },
    { header: "Reg $",          key: "regD",     width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "OT $",           key: "otD",      width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Holiday $",      key: "holD",     width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Other prem $",   key: "othD",     width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Total $",        key: "amount",   width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Notes",          key: "notes",    width: 30 },
  ];

  const rowsSorted = [...rows].sort((a, b) => {
    const A = displayForWorker(a.worker_id).primary;
    const B = displayForWorker(b.worker_id).primary;
    return A.localeCompare(B) || a.week_start.localeCompare(b.week_start);
  });
  for (const r of rowsSorted) {
    const d = displayForWorker(r.worker_id);
    const reg = r2(r.hours_regular);
    const ot  = r2(r.hours_overtime);
    const hol = r2(r.hours_double_time);
    const oth = r2(r.hours_premium_other);
    const notes = r.coverage_state === "hours_only"
      ? "hours-only: pre-2026-04-20; dollars unavailable; P&L authoritative"
      : r.coverage_state === "unknown"
      ? "unknown: no presence walk covers this week"
      : r.coverage_state === "partial"
      ? "partial: some entries lack pay-segment coverage"
      : "";
    const row = detail.addRow({
      worker: d.primary,
      title: d.secondary,
      week: `${r.week_start} to ${r.week_end}`,
      fy: r.fiscal_year ?? "",
      period: r.period_no ?? "",
      coverage: r.coverage_state,
      reg, ot, hol, othH: oth,
      otTh: r2(reg + hol),
      wo:   r2(r.hours_without_dollars),
      regD: r2(r.dollars_regular),
      otD:  r2(r.dollars_overtime),
      holD: r2(r.dollars_double_time),
      othD: r2(r.dollars_premium_other),
      amount: r2(r.amount),
      notes,
    });
    if (r.coverage_state === "hours_only") {
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2E2" } }; });
    } else if (r.coverage_state === "unknown") {
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEDE7" } }; });
    } else if (r.coverage_state === "partial") {
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8EC" } }; });
    }
  }

  // Aggregate totals row - round the SUM, not just the parts, since
  // JS float addition drifts on repeated adds. r2() on the outside
  // is what fixes 81.28999999999999.
  const T = { reg: 0, ot: 0, hol: 0, oth: 0, wo: 0, regD: 0, otD: 0, holD: 0, othD: 0, amount: 0 };
  for (const r of rows) {
    T.reg  += Number(r.hours_regular || 0);
    T.ot   += Number(r.hours_overtime || 0);
    T.hol  += Number(r.hours_double_time || 0);
    T.oth  += Number(r.hours_premium_other || 0);
    T.wo   += Number(r.hours_without_dollars || 0);
    T.regD += Number(r.dollars_regular || 0);
    T.otD  += Number(r.dollars_overtime || 0);
    T.holD += Number(r.dollars_double_time || 0);
    T.othD += Number(r.dollars_premium_other || 0);
    T.amount += Number(r.amount || 0);
  }
  const totalsRow = detail.addRow({
    worker: "TOTAL", title: "", week: "", fy: "", period: "", coverage: "",
    reg: r2(T.reg), ot: r2(T.ot), hol: r2(T.hol), othH: r2(T.oth),
    otTh: r2(T.reg + T.hol), wo: r2(T.wo),
    regD: r2(T.regD), otD: r2(T.otD), holD: r2(T.holD), othD: r2(T.othD),
    amount: r2(T.amount),
    notes: "",
  });
  totalsRow.font = { bold: true };
  totalsRow.border = { top: { style: "double" } };
  detail.getRow(1).font = { bold: true };
  detail.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
  detail.views = [{ state: "frozen", ySplit: 1 }];

  // ── Summary sheet ────────────────────────────────────
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Worker",         key: "worker", width: 34 },
    { header: "Title",          key: "title",  width: 24 },
    { header: "Weeks",          key: "weeks",  width: 8 },
    { header: "Regular",        key: "reg",    width: 10, style: { numFmt: "0.00" } },
    { header: "OT 1.5x",        key: "ot",     width: 10, style: { numFmt: "0.00" } },
    { header: "Holiday 2x",     key: "hol",    width: 12, style: { numFmt: "0.00" } },
    { header: "Other prem.",    key: "othH",   width: 12, style: { numFmt: "0.00" } },
    { header: "Hrs toward OT",  key: "otTh",   width: 14, style: { numFmt: "0.00" } },
    { header: "No-$ hours",     key: "wo",     width: 12, style: { numFmt: "0.00" } },
    { header: "Reg $",          key: "regD",   width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "OT $",           key: "otD",    width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Holiday $",      key: "holD",   width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Other prem $",   key: "othD",   width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Total $",        key: "amount", width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Coverage flags", key: "cov",    width: 18 },
  ];
  const perWorker = new Map();
  for (const r of rows) {
    const wid = r.worker_id;
    const cur = perWorker.get(wid) || { weeks: 0, reg: 0, ot: 0, hol: 0, oth: 0, wo: 0, regD: 0, otD: 0, holD: 0, othD: 0, amount: 0, states: new Set() };
    cur.weeks++;
    cur.reg  += Number(r.hours_regular || 0);
    cur.ot   += Number(r.hours_overtime || 0);
    cur.hol  += Number(r.hours_double_time || 0);
    cur.oth  += Number(r.hours_premium_other || 0);
    cur.wo   += Number(r.hours_without_dollars || 0);
    cur.regD += Number(r.dollars_regular || 0);
    cur.otD  += Number(r.dollars_overtime || 0);
    cur.holD += Number(r.dollars_double_time || 0);
    cur.othD += Number(r.dollars_premium_other || 0);
    cur.amount += Number(r.amount || 0);
    cur.states.add(r.coverage_state);
    perWorker.set(wid, cur);
  }
  const perWorkerSorted = [...perWorker.entries()]
    .map(([wid, s]) => ({ wid, d: displayForWorker(wid), s }))
    .sort((a, b) => a.d.primary.localeCompare(b.d.primary));
  for (const p of perWorkerSorted) {
    summary.addRow({
      worker: p.d.primary,
      title: p.d.secondary,
      weeks: p.s.weeks,
      reg: r2(p.s.reg), ot: r2(p.s.ot), hol: r2(p.s.hol), othH: r2(p.s.oth),
      otTh: r2(p.s.reg + p.s.hol), wo: r2(p.s.wo),
      regD: r2(p.s.regD), otD: r2(p.s.otD), holD: r2(p.s.holD), othD: r2(p.s.othD),
      amount: r2(p.s.amount),
      cov: [...p.s.states].join(", "),
    });
  }
  const sTot = summary.addRow({
    worker: "TOTAL", title: "", weeks: rows.length,
    reg: r2(T.reg), ot: r2(T.ot), hol: r2(T.hol), othH: r2(T.oth),
    otTh: r2(T.reg + T.hol), wo: r2(T.wo),
    regD: r2(T.regD), otD: r2(T.otD), holD: r2(T.holD), othD: r2(T.othD),
    amount: r2(T.amount),
    cov: "",
  });
  sTot.font = { bold: true };
  sTot.border = { top: { style: "double" } };
  summary.getRow(1).font = { bold: true };
  summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
  summary.views = [{ state: "frozen", ySplit: 1 }];

  // ── Report info sheet ────────────────────────────────
  const meta = wb.addWorksheet("Report info");
  meta.columns = [{ header: "Field", key: "f", width: 30 }, { header: "Value", key: "v", width: 70 }];
  meta.addRow({ f: "Account",           v: account });
  meta.addRow({ f: "Date range",        v: `${start} through ${end} (inclusive)` });
  if (viewName) {
    meta.addRow({ f: "Saved view",        v: viewName });
    meta.addRow({ f: "View date mode",    v: viewDateMode === "preset" ? "preset (rolling; resolves at query time)" : viewDateMode === "absolute" ? "absolute (fixed window)" : "(unspecified)" });
  }
  meta.addRow({ f: "Worker filter",     v: workersFilter ? `${workersFilter.size} of ${workerIds.length} workers explicitly selected` : "all workers with rows in range" });
  meta.addRow({ f: "Workers included",  v: workerIds.length });
  meta.addRow({ f: "Rows (worker-weeks)", v: rows.length });
  meta.addRow({ f: "Coverage - complete",   v: cov.complete });
  meta.addRow({ f: "Coverage - partial",    v: cov.partial });
  meta.addRow({ f: "Coverage - hours_only", v: cov.hours_only });
  meta.addRow({ f: "Coverage - unknown",    v: cov.unknown });
  meta.addRow({ f: "Contains hours_only",   v: hasHoursOnly ? "YES - dollars unavailable for those weeks; see Detail sheet notes" : "no" });
  meta.addRow({ f: "Contains unknown",      v: hasUnknown  ? "YES - no successful presence walk covers those weeks" : "no" });
  meta.addRow({ f: "Dollar-coverage floor", v: "2026-04-20 pay run (D35). Before this date, pay-segment dollars are not available; the P&L upload is authoritative for those periods." });
  meta.addRow({ f: "Name resolution",       v: workerMeta.size > 0 ? (redact ? "REDACTED at export time - names dropped server-side; every worker appears as #<number> plus title only" : "canonical Rippling name field; falls back to #N when unavailable") : "no workers in scope" });
  meta.addRow({ f: "Last pay-seg walk",     v: psWalkGlobal.data?.completed_at || "no successful walk on record" });
  meta.addRow({ f: "Last derive_at",        v: rows[0]?.derived_at || "no rows" });
  meta.addRow({ f: "Source",                v: "labor_actuals_latest joined to rippling_raw_workers_latest joined to rippling_raw_users_latest" });
  meta.addRow({ f: "Generated (UTC)",       v: new Date().toISOString() });
  meta.addRow({ f: "Generated for",         v: session.user?.email || "" });
  meta.getRow(1).font = { bold: true };
  meta.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };

  const buf = await wb.xlsx.writeBuffer();
  const safeAccount = account.replace(/[^A-Za-z0-9-]/g, "_");
  const safeView = viewName ? "-" + viewName.replace(/[^A-Za-z0-9-]/g, "_") : "";
  const filename = `kpi-labor-${safeAccount}${safeView}-${start}-to-${end}.xlsx`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// ── Portfolio export (ALL / EAST / WEST) ─────────────────────────────
// Detail sheet: one row per (account, week). Summary sheet: one row per
// account across the range with a region column. Coverage per (account,
// week) is the WORST worker-week state - a single incomplete worker
// makes the account-week incomplete. Total $ is the sum of all worker
// dollars for that account-week, matching what the board displays.
async function handlePortfolioExport({ supa, session, account, start, end, viewName, viewDateMode, workersFilter }) {
  // 1. Resolve members - same helper as the read route.
  const memberQ = await resolvePortfolioMembers(supa, account);
  if (memberQ.error) return NextResponse.json(safeError("portfolio_members", memberQ.error), { status: 500 });
  const memberRows = memberQ.data;
  if (memberRows.length === 0) {
    return NextResponse.json({ error: "no_members_in_region", account }, { status: 400 });
  }
  const memberKeys = memberRows.map(r => r.team_key);
  const regionByAccount = new Map(memberRows.map(r => [r.team_key, r.region || ""]));

  // 2. Actuals across all members. Same select set the read route
  // uses (plus dollar splits for coverage-flag transparency).
  //
  // 2026-08-28 pagination sweep - CRITICAL: this is the portfolio CSV
  // export path. FYTD across all 11 accounts returns ~2,419 rows today;
  // the prior bare select capped at 1,000 and the CSV downloaded to
  // Excel with no indication the tail was missing. Joe/Josh workbooks
  // built from a truncated CSV silently short every downstream figure.
  // fetchAllOffset with .in() as a filter chunk paginates the response.
  let rows;
  try {
    rows = await fetchAllOffset(supa, "labor_actuals_latest",
      "account_key, worker_id, week_start, week_end, fiscal_year, period_no, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, coverage_state, derived_at",
      [
        (q) => q.in("account_key", memberKeys),
        (q) => q.lte("week_start", end),
        (q) => q.gte("week_end", start),
        (q) => q.order("account_key", { ascending: true }).order("week_start", { ascending: true }),
      ]);
  } catch (e) {
    return NextResponse.json(safeError("labor_actuals_portfolio", { message: e.message }), { status: 500 });
  }
  if (workersFilter) rows = rows.filter(r => workersFilter.has(r.worker_id));

  // 3. Group by (account_key, week_start).
  const perAcctWeek = new Map();
  for (const r of rows) {
    const k = `${r.account_key}|${r.week_start}`;
    let cur = perAcctWeek.get(k);
    if (!cur) {
      cur = {
        account_key: r.account_key,
        region: regionByAccount.get(r.account_key) || "",
        week_start: r.week_start,
        week_end: r.week_end,
        fiscal_year: r.fiscal_year,
        period_no: r.period_no,
        reg: 0, ot: 0, hol: 0, oth: 0, wo: 0,
        regD: 0, otD: 0, holD: 0, othD: 0, amount: 0,
        states: [],
      };
      perAcctWeek.set(k, cur);
    }
    cur.reg  += Number(r.hours_regular || 0);
    cur.ot   += Number(r.hours_overtime || 0);
    cur.hol  += Number(r.hours_double_time || 0);
    cur.oth  += Number(r.hours_premium_other || 0);
    cur.wo   += Number(r.hours_without_dollars || 0);
    cur.regD += Number(r.dollars_regular || 0);
    cur.otD  += Number(r.dollars_overtime || 0);
    cur.holD += Number(r.dollars_double_time || 0);
    cur.othD += Number(r.dollars_premium_other || 0);
    cur.amount += Number(r.amount || 0);
    cur.states.push(r.coverage_state);
  }
  const detailRows = [...perAcctWeek.values()]
    .map(v => ({ ...v, coverage: worstCoverage(v.states) }))
    .sort((a, b) => a.account_key.localeCompare(b.account_key) || a.week_start.localeCompare(b.week_start));

  const cov = { complete: 0, partial: 0, hours_only: 0, unknown: 0, no_labor: 0 };
  for (const d of detailRows) cov[d.coverage] = (cov[d.coverage] || 0) + 1;
  const hasHoursOnly = cov.hours_only > 0;
  const hasUnknown = cov.unknown > 0;

  // 4. Sum-preserving invariant: sum(Detail.amount) must equal
  // sum(raw actuals.amount) to the cent. This is what makes the
  // export match the board display.
  const rawTotal = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const rolledTotal = detailRows.reduce((s, d) => s + d.amount, 0);
  const totalsMatch = Math.abs(rawTotal - rolledTotal) < 0.005;

  // 5. Provenance - last successful pay-seg walk.
  const psWalkGlobal = await supa
    .from("rippling_walks")
    .select("completed_at")
    .eq("kind", "pay_segments")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Workbook ────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "kitchfix intranet - kpi/labor export (portfolio)";
  wb.created = new Date();

  // Detail sheet - one row per (account, week).
  const detail = wb.addWorksheet("Detail");
  detail.columns = [
    { header: "Account",       key: "account",  width: 14 },
    { header: "Region",        key: "region",   width: 8  },
    { header: "Week",          key: "week",     width: 22 },
    { header: "FY",            key: "fy",       width: 6  },
    { header: "Period",        key: "period",   width: 8  },
    { header: "Coverage",      key: "coverage", width: 12 },
    { header: "Regular",       key: "reg",      width: 10, style: { numFmt: "0.00" } },
    { header: "OT 1.5x",       key: "ot",       width: 10, style: { numFmt: "0.00" } },
    { header: "Holiday 2x",    key: "hol",      width: 12, style: { numFmt: "0.00" } },
    { header: "Other prem.",   key: "othH",     width: 12, style: { numFmt: "0.00" } },
    { header: "Hrs toward OT", key: "otTh",     width: 14, style: { numFmt: "0.00" } },
    { header: "No-$ hours",    key: "wo",       width: 12, style: { numFmt: "0.00" } },
    { header: "Reg $",         key: "regD",     width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "OT $",          key: "otD",      width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Holiday $",     key: "holD",     width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Other prem $",  key: "othD",     width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Total $",       key: "amount",   width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Notes",         key: "notes",    width: 32 },
  ];
  for (const d of detailRows) {
    const notes = d.coverage === "hours_only"
      ? "hours-only: pre-2026-04-20; dollars unavailable; P&L authoritative"
      : d.coverage === "unknown"
      ? "unknown: no presence walk covers at least one worker-week"
      : d.coverage === "partial"
      ? "partial: some worker-weeks lack pay-segment coverage"
      : "";
    const row = detail.addRow({
      account: d.account_key,
      region: d.region,
      week: `${d.week_start} to ${d.week_end}`,
      fy: d.fiscal_year ?? "",
      period: d.period_no ?? "",
      coverage: d.coverage,
      reg: r2(d.reg), ot: r2(d.ot), hol: r2(d.hol), othH: r2(d.oth),
      otTh: r2(d.reg + d.hol), wo: r2(d.wo),
      regD: r2(d.regD), otD: r2(d.otD), holD: r2(d.holD), othD: r2(d.othD),
      amount: r2(d.amount),
      notes,
    });
    if (d.coverage === "hours_only") {
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2E2" } }; });
    } else if (d.coverage === "unknown") {
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEDE7" } }; });
    } else if (d.coverage === "partial") {
      row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8EC" } }; });
    }
  }
  const T = { reg: 0, ot: 0, hol: 0, oth: 0, wo: 0, regD: 0, otD: 0, holD: 0, othD: 0, amount: 0 };
  for (const d of detailRows) {
    T.reg += d.reg; T.ot += d.ot; T.hol += d.hol; T.oth += d.oth; T.wo += d.wo;
    T.regD += d.regD; T.otD += d.otD; T.holD += d.holD; T.othD += d.othD; T.amount += d.amount;
  }
  const totalsRow = detail.addRow({
    account: "TOTAL", region: "", week: "", fy: "", period: "", coverage: "",
    reg: r2(T.reg), ot: r2(T.ot), hol: r2(T.hol), othH: r2(T.oth),
    otTh: r2(T.reg + T.hol), wo: r2(T.wo),
    regD: r2(T.regD), otD: r2(T.otD), holD: r2(T.holD), othD: r2(T.othD),
    amount: r2(T.amount),
    notes: "",
  });
  totalsRow.font = { bold: true };
  totalsRow.border = { top: { style: "double" } };
  detail.getRow(1).font = { bold: true };
  detail.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
  detail.views = [{ state: "frozen", ySplit: 1 }];

  // Summary sheet - one row per account across the range.
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Account",        key: "account",  width: 14 },
    { header: "Region",         key: "region",   width: 8  },
    { header: "Weeks",          key: "weeks",    width: 8  },
    { header: "Regular",        key: "reg",      width: 10, style: { numFmt: "0.00" } },
    { header: "OT 1.5x",        key: "ot",       width: 10, style: { numFmt: "0.00" } },
    { header: "Holiday 2x",     key: "hol",      width: 12, style: { numFmt: "0.00" } },
    { header: "Other prem.",    key: "othH",     width: 12, style: { numFmt: "0.00" } },
    { header: "Hrs toward OT",  key: "otTh",     width: 14, style: { numFmt: "0.00" } },
    { header: "No-$ hours",     key: "wo",       width: 12, style: { numFmt: "0.00" } },
    { header: "Reg $",          key: "regD",     width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "OT $",           key: "otD",      width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Holiday $",      key: "holD",     width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Other prem $",   key: "othD",     width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Total $",        key: "amount",   width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "Coverage flags", key: "cov",      width: 22 },
  ];
  const perAcct = new Map();
  for (const d of detailRows) {
    const cur = perAcct.get(d.account_key) || { region: d.region, weeks: 0, reg: 0, ot: 0, hol: 0, oth: 0, wo: 0, regD: 0, otD: 0, holD: 0, othD: 0, amount: 0, states: new Set() };
    cur.weeks++;
    cur.reg += d.reg; cur.ot += d.ot; cur.hol += d.hol; cur.oth += d.oth; cur.wo += d.wo;
    cur.regD += d.regD; cur.otD += d.otD; cur.holD += d.holD; cur.othD += d.othD; cur.amount += d.amount;
    cur.states.add(d.coverage);
    perAcct.set(d.account_key, cur);
  }
  const acctsSorted = [...perAcct.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [acct, s] of acctsSorted) {
    summary.addRow({
      account: acct, region: s.region, weeks: s.weeks,
      reg: r2(s.reg), ot: r2(s.ot), hol: r2(s.hol), othH: r2(s.oth),
      otTh: r2(s.reg + s.hol), wo: r2(s.wo),
      regD: r2(s.regD), otD: r2(s.otD), holD: r2(s.holD), othD: r2(s.othD),
      amount: r2(s.amount),
      cov: [...s.states].join(", "),
    });
  }
  const sTot = summary.addRow({
    account: "TOTAL", region: "", weeks: detailRows.length,
    reg: r2(T.reg), ot: r2(T.ot), hol: r2(T.hol), othH: r2(T.oth),
    otTh: r2(T.reg + T.hol), wo: r2(T.wo),
    regD: r2(T.regD), otD: r2(T.otD), holD: r2(T.holD), othD: r2(T.othD),
    amount: r2(T.amount),
    cov: "",
  });
  sTot.font = { bold: true };
  sTot.border = { top: { style: "double" } };
  summary.getRow(1).font = { bold: true };
  summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
  summary.views = [{ state: "frozen", ySplit: 1 }];

  // Report info sheet.
  const meta = wb.addWorksheet("Report info");
  meta.columns = [{ header: "Field", key: "f", width: 30 }, { header: "Value", key: "v", width: 70 }];
  meta.addRow({ f: "Portfolio view",     v: account });
  meta.addRow({ f: "Member accounts",    v: memberKeys.join(", ") });
  meta.addRow({ f: "Date range",         v: `${start} through ${end} (inclusive)` });
  if (viewName) {
    meta.addRow({ f: "Saved view",         v: viewName });
    meta.addRow({ f: "View date mode",     v: viewDateMode === "preset" ? "preset (rolling; resolves at query time)" : viewDateMode === "absolute" ? "absolute (fixed window)" : "(unspecified)" });
  }
  meta.addRow({ f: "Grain",               v: "one row per (account, week) - matches on-screen portfolio table" });
  meta.addRow({ f: "Worker filter",       v: workersFilter ? `${workersFilter.size} worker id(s) explicitly selected` : "all workers in scope" });
  meta.addRow({ f: "Accounts in scope",   v: memberKeys.length });
  meta.addRow({ f: "Rows (account-weeks)", v: detailRows.length });
  meta.addRow({ f: "Underlying worker-weeks", v: rows.length });
  meta.addRow({ f: "Coverage - complete",   v: cov.complete });
  meta.addRow({ f: "Coverage - partial",    v: cov.partial });
  meta.addRow({ f: "Coverage - hours_only", v: cov.hours_only });
  meta.addRow({ f: "Coverage - unknown",    v: cov.unknown });
  meta.addRow({ f: "Contains hours_only",   v: hasHoursOnly ? "YES - dollars unavailable for at least one worker-week rolled up; see Detail notes" : "no" });
  meta.addRow({ f: "Contains unknown",      v: hasUnknown  ? "YES - no successful presence walk covers at least one worker-week" : "no" });
  meta.addRow({ f: "Coverage rollup rule",  v: "worst per (account, week): a single incomplete worker-week makes the account-week incomplete" });
  meta.addRow({ f: "Sum invariant",         v: totalsMatch ? "PASS - sum of Detail Total $ equals sum of underlying worker-week $ to the cent" : `FAIL - Detail sum $${r2(rolledTotal)} vs raw sum $${r2(rawTotal)}` });
  meta.addRow({ f: "Dollar-coverage floor", v: "2026-04-20 pay run (D35). Before this date, pay-segment dollars are not available; the P&L upload is authoritative for those periods." });
  meta.addRow({ f: "Membership source",     v: "accounts.region via resolvePortfolioMembers - same helper the read route uses" });
  meta.addRow({ f: "Last pay-seg walk",     v: psWalkGlobal.data?.completed_at || "no successful walk on record" });
  meta.addRow({ f: "Last derive_at",        v: rows[0]?.derived_at || "no rows" });
  meta.addRow({ f: "Source",                v: "labor_actuals_latest filtered .in('account_key', <portfolio members>)" });
  meta.addRow({ f: "Generated (UTC)",       v: new Date().toISOString() });
  meta.addRow({ f: "Generated for",         v: session.user?.email || "" });
  meta.getRow(1).font = { bold: true };
  meta.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };

  const buf = await wb.xlsx.writeBuffer();
  const safeAccount = account.replace(/[^A-Za-z0-9-]/g, "_");
  const safeView = viewName ? "-" + viewName.replace(/[^A-Za-z0-9-]/g, "_") : "";
  const filename = `kpi-labor-${safeAccount}${safeView}-${start}-to-${end}.xlsx`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

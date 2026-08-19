// /api/kpi/labor/export
//
// Read-only. Admin-gated via OPS_LEADERSHIP_EMAILS (same server-side
// gate as the labor read route - 401 for unauthenticated, 403 for
// non-allowlisted). Without the gate this route leaks payroll data
// for eleven accounts.
//
// Generates an .xlsx labor report scoped to (account, start, end,
// workers?). Structure mirrors scripts/_xls_cin_oh_labor.mjs so the
// shape is familiar; provenance is complete on the Report info sheet
// AND coverage-state flags appear on the face of the Detail sheet.
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

const D26_SALARIED_ONLY = new Set(["CIN - KY", "TBJ - NY"]);
const D17_OUT_OF_SCOPE = new Set(["CORP"]);
// V6 PR-2 fixup - the labor route accepts these pseudo-keys as
// aggregate views (ALL / EAST / WEST) but the export route still
// filters .eq("account_key", account) which matches zero rows and
// would silently produce an EMPTY spreadsheet. Reject them here
// with 400 as a belt-and-suspenders alongside the client-side
// disabled Export button. Full per-account aggregate export ships
// in PR-3 alongside the resolver unification.
const V6_PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);

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
  if (V6_PSEUDO_KEYS.has(account)) {
    return NextResponse.json({ error: "aggregate_export_pending", account }, { status: 400 });
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

  const actuals = await supa
    .from("labor_actuals_latest")
    .select("account_key, worker_id, week_label, line_code, week_start, week_end, fiscal_year, period_no, hours_regular, hours_overtime, hours_double_time, hours_premium_other, dollars_regular, dollars_overtime, dollars_double_time, dollars_premium_other, amount, hours_without_dollars, segment_count, entry_count, coverage_state, derived_at")
    .eq("account_key", account)
    .lte("week_start", end)
    .gte("week_end", start)
    .order("worker_id", { ascending: true })
    .order("week_start", { ascending: true });
  if (actuals.error) return NextResponse.json(safeError("labor_actuals", actuals.error), { status: 500 });

  let rows = actuals.data || [];
  if (workersFilter) rows = rows.filter(r => workersFilter.has(r.worker_id));

  const workerIds = [...new Set(rows.map(r => r.worker_id))];
  const workerMeta = new Map();
  if (workerIds.length > 0) {
    const w = await supa
      .from("rippling_raw_workers_latest")
      .select("payload")
      .in("rippling_id", workerIds);
    if (!w.error) {
      // Join user_id -> users. Same shape as the read route.
      const userIds = [...new Set((w.data || []).map(r => r.payload?.user_id).filter(Boolean))];
      const userByRipplingId = new Map();
      if (userIds.length > 0) {
        const u = await supa
          .from("rippling_raw_users_latest")
          .select("rippling_id, payload")
          .in("rippling_id", userIds);
        if (!u.error) {
          for (const r of u.data || []) userByRipplingId.set(r.rippling_id, r.payload || {});
        }
      }
      for (const r of w.data || []) {
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

// /api/kpi/purchasing/export
//
// PR 2 R8 Gap 2 - Export what is on screen, at the grain shown.
//
// Mirrors labor/export/route.js shape (Report info + one sheet per
// visible board card). Auth + membership + fence use the same helpers
// the read route uses so this cannot see anything the board cannot.
//
// The controlling rule: **server figures only, never re-derived**.
// This route fetches the SAME read route the board fetches, using the
// caller's session cookie, and writes the payload verbatim into
// worksheet cells. There is no client-only computation and no
// alternative derivation - the read route is the single source, the
// export is a projection.
//
// Query params:
//   account      (required)
//   start        YYYY-MM-DD (defaults FY start 2025-12-29)
//   end          YYYY-MM-DD (defaults today)
//   view_name    optional; carried into filename + Report info
//   view_date_mode  optional; "preset" or "absolute"; carried into Report info

import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { KPI_PREVIEW_ONLY, KPI_PREVIEW_ALLOWLIST } from "@/lib/kpi/roleGate";

// Round-to-2 helper. Stores the rounded value, not just the display -
// prevents 81.28999999999999 in cells whose format is "0.00" (fix
// carried from labor/export/route.js).
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

function safeError(scope, err) {
  console.error(`[kpi/purchasing/export] ${scope}:`, err?.message || err);
  return { error: "server_error", scope };
}

export async function GET(request) {
  // TEST_MODE bypass: mirrors the read route so Playwright + local
  // smoke can exercise the export path without an OAuth login. Never
  // fires on Vercel (VERCEL=1 unsets the bypass regardless of env vars).
  const testModeBypass = process.env.TEST_MODE === "true" && process.env.VERCEL !== "1";
  let email = "";
  if (!testModeBypass) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    email = session.user?.email?.toLowerCase().trim();
    // KPI PREVIEW FENCE - matches the read route's gating so a fenced
    // caller cannot pull purchasing data through the export route while
    // the read route is fenced (mirrors labor/export/route.js:85-90).
    if (KPI_PREVIEW_ONLY && !KPI_PREVIEW_ALLOWLIST.includes(email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!OPS_LEADERSHIP_EMAILS.includes(email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else {
    email = "test-mode@local";
  }

  const { searchParams } = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const account = (searchParams.get("account") || "").trim();
  const start = searchParams.get("start") || "2025-12-29";
  const end = searchParams.get("end") || today;
  const viewName = (searchParams.get("view_name") || "").trim().slice(0, 80);
  const viewDateMode = searchParams.get("view_date_mode") === "preset"
    ? "preset"
    : searchParams.get("view_date_mode") === "absolute"
      ? "absolute"
      : null;

  if (!account) {
    return NextResponse.json({ error: "account_required" }, { status: 400 });
  }

  // ── Fetch the read route with the caller's session cookie ─────────
  // Server-figures-only rule: NO alternative query, NO reshaping. We
  // ask the same route the board asks; we copy the answer into cells.
  const origin = new URL(request.url).origin;
  const readUrl = `${origin}/api/kpi/purchasing?account=${encodeURIComponent(account)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const cookie = request.headers.get("cookie") || "";
  let payload;
  try {
    const resp = await fetch(readUrl, {
      headers: { cookie },
      // Next.js requires cache disabled for server-to-server calls
      // that carry a session cookie; the read route already caches
      // per-request internally.
      cache: "no-store",
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return NextResponse.json(safeError("read_route", new Error(`upstream ${resp.status}: ${detail.slice(0, 200)}`)), { status: 502 });
    }
    payload = await resp.json();
  } catch (err) {
    return NextResponse.json(safeError("read_route", err), { status: 502 });
  }

  if (!payload?.ok) {
    return NextResponse.json({ error: "read_route_error", detail: payload }, { status: 502 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "kitchfix intranet - kpi/purchasing export";
  wb.created = new Date();

  // ── Report info sheet ────────────────────────────────
  // First sheet mirrors labor's convention: identifiers, range, view
  // context, freshness, and provenance so the spreadsheet outlives
  // its context.
  const meta = wb.addWorksheet("Report info");
  meta.columns = [
    { header: "Field", key: "f", width: 30 },
    { header: "Value", key: "v", width: 78 },
  ];
  meta.addRow({ f: "Account",             v: account });
  meta.addRow({ f: "Date range",          v: `${start} through ${end} (inclusive)` });
  if (viewName) {
    meta.addRow({ f: "Saved view",        v: viewName });
    meta.addRow({ f: "View date mode",    v: viewDateMode === "preset" ? "preset (rolling; resolves at query time)" : viewDateMode === "absolute" ? "absolute (fixed window)" : "(unspecified)" });
  }
  meta.addRow({ f: "Fiscal year",         v: payload.fiscal?.fiscal_year ?? "" });
  meta.addRow({ f: "Period no",           v: payload.fiscal?.period_no ?? "" });
  meta.addRow({ f: "Weeks in range",      v: payload.fiscal?.weeks_in_range ?? "" });
  meta.addRow({ f: "Elapsed frac",        v: payload.fiscal?.elapsed_frac ?? "" });
  meta.addRow({ f: "Provisional",         v: payload.provisional ? "yes (range end + 16 days > today)" : "no (bill.com entry lag closed)" });
  meta.addRow({ f: "Future range",        v: payload.is_future_range ? "yes (start > today; no verdict rendered on screen)" : "no" });
  meta.addRow({ f: "Cost model",          v: payload.cost_model ?? "aggregate" });
  meta.addRow({ f: "Last derive",         v: payload.freshness?.last_derive_at ?? "" });
  meta.addRow({ f: "Cards through",       v: payload.freshness?.cards_through ?? "" });
  meta.addRow({ f: "Exported at",         v: new Date().toISOString() });
  meta.addRow({ f: "Exported by",         v: email });
  meta.getRow(1).font = { bold: true };
  meta.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };

  // ── Period + buckets sheet ───────────────────────────
  // On-screen row 1 (period card) + rows 2-4 (bucket cards). Server
  // ships buckets[] verbatim; we copy every field. `variance` is the
  // route's computation, not re-derived here (rule 5).
  const buckets = wb.addWorksheet("Buckets");
  buckets.columns = [
    { header: "Card",       key: "card",     width: 22 },
    { header: "GL bucket",  key: "bucket",   width: 12 },
    { header: "Budget",     key: "budget",   width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: "Spent",      key: "spent",    width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: "Bills",      key: "bills",    width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: "Cards coded",key: "cards",    width: 14, style: { numFmt: '"$"#,##0.00' } },
    { header: "Variance",   key: "variance", width: 14, style: { numFmt: '"$"#,##0.00' } },
  ];
  const totals = payload.totals || {};
  // Row 1 - period card. Server ships `totals.pl_cogs` as budget/spent/
  // variance for the KPI line (3200 + 3400 + 3500). Bills = pl_cogs
  // spent - cards. Cards from route's `card.spent`. Pending is on the
  // period card too.
  buckets.addRow({
    card: "Period (KPI line)",
    bucket: "pl_cogs",
    budget: r2(totals?.pl_cogs?.budget),
    spent: r2(totals?.pl_cogs?.spent),
    bills: r2(Number(totals?.pl_cogs?.spent || 0) - Number(totals?.card?.spent || 0)),
    cards: r2(totals?.card?.spent),
    variance: r2(totals?.pl_cogs?.variance),
  });
  // Rows 2-4 - bucket cards. `buckets[]` on the payload is a keyed
  // dict; iterate through the fixed order the board renders.
  const BUCKET_ORDER = [
    { key: "food",      label: "Food"                 },
    { key: "packaging", label: "Packaging & supplies" },
    { key: "vehicle",   label: "Vehicle"              },
  ];
  const bmap = payload.buckets || {};
  for (const b of BUCKET_ORDER) {
    const row = bmap[b.key] || {};
    buckets.addRow({
      card: b.label,
      bucket: b.key,
      budget: r2(row.budget),
      spent: r2(row.spent),
      bills: r2(row.bills),
      cards: r2(row.cards_coded ?? row.cards),
      variance: r2(row.variance),
    });
  }
  buckets.getRow(1).font = { bold: true };
  buckets.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
  buckets.views = [{ state: "frozen", ySplit: 1 }];

  // ── Ledger sheets - Equipment / Repair / Reimbursable ────────────
  // Each is a capped list keyed to the on-screen card. Server ships
  // ledgers.equipment / .repair / .reimbursable each with rows[],
  // total_count, total_amount, cap. Every row is a real bill.com
  // line; nothing computed here.
  function addLedgerSheet(sheetName, key) {
    const src = payload.ledgers?.[key] || { rows: [], total_count: 0, total_amount: 0, cap: 0 };
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [
      { header: "Vendor",       key: "vendor",   width: 32 },
      { header: "Description",  key: "desc",     width: 40 },
      { header: "GL line",      key: "gl",       width: 10 },
      { header: "Txn date",     key: "date",     width: 12 },
      { header: "Account",      key: "acct",     width: 14 },
      { header: "Amount",       key: "amount",   width: 14, style: { numFmt: '"$"#,##0.00' } },
    ];
    for (const r of src.rows || []) {
      ws.addRow({
        vendor: r.vendor || "",
        desc:   r.description || "",
        gl:     r.gl_line_code || "",
        date:   r.txn_date || "",
        acct:   r.account_key || "",
        amount: r2(r.amount),
      });
    }
    const totalRow = ws.addRow({
      vendor: `TOTAL${(src.total_count || 0) > (src.cap || 0) ? ` (showing ${src.cap} of ${src.total_count})` : ""}`,
      desc: "", gl: "", date: "", acct: "",
      amount: r2(src.total_amount),
    });
    totalRow.font = { bold: true };
    totalRow.border = { top: { style: "double" } };
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  addLedgerSheet("Equipment",    "equipment");
  addLedgerSheet("Gen. Repair & Maintenance", "repair");
  addLedgerSheet("Reimbursable", "reimbursable");

  // ── Card purchases sheet ─────────────────────────────
  // Capped list from server. Uncoded rippling_spend, ordered by
  // amount desc. Same rule: rows verbatim, totals from server.
  {
    const cc = payload.card_charges || { rows: [], total_count: 0, total_amount: 0, cap: 0 };
    const ws = wb.addWorksheet("Card purchases");
    ws.columns = [
      { header: "Merchant",  key: "merchant", width: 32 },
      { header: "Txn date",  key: "date",     width: 12 },
      { header: "Category",  key: "category", width: 22 },
      { header: "Account",   key: "acct",     width: 14 },
      { header: "Amount",    key: "amount",   width: 14, style: { numFmt: '"$"#,##0.00' } },
    ];
    for (const r of cc.rows || []) {
      ws.addRow({
        merchant: r.merchant || "",
        date:     r.txn_date || "",
        category: r.category || "",
        acct:     r.account_key || "",
        amount:   r2(r.amount),
      });
    }
    const totalRow = ws.addRow({
      merchant: `TOTAL${(cc.total_count || 0) > (cc.cap || 0) ? ` (showing ${cc.cap} of ${cc.total_count})` : ""}`,
      date: "", category: "", acct: "",
      amount: r2(cc.total_amount),
    });
    totalRow.font = { bold: true };
    totalRow.border = { top: { style: "double" } };
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  // ── Vendor breakdown sheet ───────────────────────────
  {
    const vendors = payload.vendors || { rows: [], total_count: 0, total_amount: 0, cap: 0 };
    const ws = wb.addWorksheet("Vendors");
    ws.columns = [
      { header: "Vendor",     key: "name",     width: 32 },
      { header: "Vendor id",  key: "vid",      width: 20 },
      { header: "Resolved",   key: "resolved", width: 10 },
      { header: "Spend",      key: "spend",    width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Lines",      key: "lines",    width: 8 },
      { header: "Prior spend",key: "prior",    width: 14, style: { numFmt: '"$"#,##0.00' } },
      { header: "Food",       key: "food",     width: 12, style: { numFmt: '"$"#,##0.00' } },
      { header: "Packaging",  key: "pkg",      width: 12, style: { numFmt: '"$"#,##0.00' } },
      { header: "Vehicle",    key: "veh",      width: 12, style: { numFmt: '"$"#,##0.00' } },
      { header: "Other",      key: "other",    width: 12, style: { numFmt: '"$"#,##0.00' } },
    ];
    for (const r of vendors.rows || []) {
      const s = r.gl_split || {};
      ws.addRow({
        name: r.resolved ? (r.name || "") : (r.vendor_id ? "(unresolved)" : "(unresolved)"),
        vid: r.vendor_id || "",
        resolved: r.resolved ? "yes" : "no",
        spend: r2(r.spend),
        lines: Number(r.line_count || 0),
        prior: r2(r.prior_spend),
        food: r2(s.food),
        pkg: r2(s.packaging),
        veh: r2(s.vehicle),
        other: r2(s.other),
      });
    }
    const totalRow = ws.addRow({
      name: `TOTAL${(vendors.total_count || 0) > (vendors.cap || 0) ? ` (showing ${vendors.cap} of ${vendors.total_count})` : ""}`,
      vid: "", resolved: "",
      spend: r2(vendors.total_amount),
      lines: "", prior: "", food: "", pkg: "", veh: "", other: "",
    });
    totalRow.font = { bold: true };
    totalRow.border = { top: { style: "double" } };
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  // ── Response ────────────────────────────────────────
  const buf = await wb.xlsx.writeBuffer();
  const safeAccount = account.replace(/[^A-Za-z0-9._-]+/g, "_");
  const filenameParts = [
    "kpi-purchasing",
    safeAccount,
    start,
    "to",
    end,
  ];
  if (viewName) filenameParts.push(viewName.replace(/[^A-Za-z0-9._-]+/g, "_"));
  const filename = filenameParts.join("_") + ".xlsx";
  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

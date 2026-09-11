// ═══════════════════════════════════════════════════════════════════
// scExport - Service Calendar operator export (Overview + Projections
// + Actuals, three tabs, snapshot).
// 2026-09-10.
// ═══════════════════════════════════════════════════════════════════
//
// Design authority: docs/design/KF_SC_Export_SAMPLE.xlsx.
// Brief: CC_PROMPT_SC_EXPORT.md (Kevin, 2026-09-10).
//
// Replaces the prior 4-sheet Summary / Daily / Notes / Changes
// export entirely - Kevin's ruling: "one export option, not several."
// Old builder src/lib/export/scWorkbook.js is deleted in the same PR.
//
// ─── The single most valuable thing this export does ────────────
//
// Projections and Actuals carry IDENTICAL column sets in IDENTICAL
// order. That is the defect that made the previous workbook unusable
// for comparison - Projections was missing Scout Meals and Florida
// Ops, Media Meals sat in a different position, and the two tabs
// could not be read side-by-side. This must not regress.
//
// Column set = union of services with non-zero data in EITHER
// Projections or Actuals for the export window. Zero-service columns
// dropped per-window (Kevin ruling F4 2026-09-10): a period export
// drops services with no activity in that period, not just ones
// dead all season.
//
// ─── Amount-type services ────────────────────────────────────────
//
// Services with is_non_revenue=true (currently only "Fun $$$$
// Allocated") are dollar allocations, not billable revenue. They
// appear in the workbook - counts survive on Projections/Actuals
// and units on Overview - but their revenue is EXCLUDED from every
// revenue total. Overview marks them with "(amount)" after the
// service name and a footnote explains the exclusion. This is what
// makes the workbook tie to the source system's revenue totals to
// the penny (verified $1,069,460.21 on TBJ season-to-date in the
// sample).
//
// ─── Formula shape (Kevin ruling F2 2026-09-10) ─────────────────
//
// The sample workbook uses inline literal rates in Projections/
// Actuals row-level Revenue formulas: `=G7*23.12+H7*23.12+...`.
// Kevin overrode this in his 2026-09-10 ruling: use cell-referenced
// rates so a rate correction propagates. Rate row emits at row 6;
// every row-level Revenue formula reads `=G7*$G$6+H7*$H$6+...`
// (skipping columns whose service is amount-type).
//
// ─── Styling tokens (matched to CIN-AZ workbook Kevin likes) ────
//
// Arial throughout. Navy #153968 headers, green #0F6E56 subtitles,
// grey #6B7280 muted metadata. Colour-coded group bands (dark
// merged header, light tint on service names). Service names
// rotated 90° so the grid fits one screen. Zeros hidden by number
// format `#,##0;;;` (semicolons hide zero + negative + text).
// Gridlines off; drawn borders do the structural work. Zebra
// striping. Weekend day names greyed.

import ExcelJS from "exceljs";
import { getServiceClient } from "@/lib/supabase";

// ─── Paginated select with count-exact safety belt ──────────────
//
// Supabase / PostgREST silently caps unpaginated .select() at 1000
// rows. Loop with .range() until the page returns fewer than
// pageSize rows; verify against the exact count PostgREST reports.
// A mismatch throws with both numbers so a pagination bug (missing
// .order() -> page overlap, or concurrent writes) surfaces loudly
// instead of shipping a workbook that silently missed rows.
//
// Same pattern as src/lib/academy/requirements.js:selectAllPaginated.
//
// queryFn signature: (from, to) => await supa.from(...)
//   .select("...", { count: "exact" }).order(...).range(from, to)
async function paginatedSelect(supa, tableName, queryFn, { pageSize = 1000 } = {}) {
  const all = [];
  let expectedTotal = null;
  let from = 0;
  for (let i = 0; i < 200; i += 1) {
    const to = from + pageSize - 1;
    const q = await queryFn(from, to);
    if (q.error) throw new Error(`paginatedSelect[${tableName}]: ${q.error.message}`);
    if (expectedTotal === null && typeof q.count === "number") expectedTotal = q.count;
    const rows = q.data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from = to + 1;
  }
  if (expectedTotal === null) {
    throw new Error(`paginatedSelect[${tableName}]: no exact count returned; caller must pass { count: "exact" }`);
  }
  if (all.length !== expectedTotal) {
    throw new Error(`paginatedSelect[${tableName}]: paged total ${all.length} != exact count ${expectedTotal}. Pagination is wrong; verify .order() precedes .range() and no concurrent writes.`);
  }
  return all;
}

// ─── Style tokens (from sample) ─────────────────────────────────

const NAVY        = "FF153968";
const NAVY_ALT    = "FF1E3A5F"; // Projections tab colour + group headers row 4
const GREEN       = "FF0F6E56"; // Actuals tab, "BY SERVICE" divider, subtitle
const AMBER       = "FF8A5A16"; // Overview tab colour
const GREY        = "FF6B7280"; // Muted metadata + rate row
const INK         = "FF1A1A1A"; // Body text
const ZERO_GREY   = "FFC8CDD4"; // (unused today - zeros hidden via numFmt)
const WHITE       = "FFFFFFFF";
const AMOUNT_BG   = "FFFAFBFC"; // Row fill for amount-type marker line

// Group tints: cycle through five pairs matching the sample. Any
// account with more groups extends the palette by repeating.
const GROUP_PALETTE = [
  { dark: "FF1E3A5F", tint: "FFE8EEF4" },  // navy / pale navy
  { dark: "FF0F6E56", tint: "FFE6F1EC" },  // green / pale green
  { dark: "FF8A5A16", tint: "FFF5EDE0" },  // amber / pale amber
  { dark: "FF5B4B8A", tint: "FFEDEAF3" },  // purple / pale purple
  { dark: "FF8A1E3A", tint: "FFF3E5EB" },  // magenta / pale magenta
];

// Number formats
const MONEY_FMT     = '"$"#,##0.00';
const MONEY_FMT_DASH = '"$"#,##0.00;;"–"';       // Overview - dash on zero
const COUNT_FMT     = '#,##0';
const COUNT_FMT_DASH = '#,##0;;"–"';              // Overview - dash on zero
const HIDE_ZERO_FMT = '#,##0;;;';                 // Body meal cells - hide zero+neg+text

// ─── Date helpers ───────────────────────────────────────────────

function utcNoon(iso) { return new Date(`${iso}T12:00:00Z`); }

function addDaysIso(iso, n) {
  const d = utcNoon(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtRangeLong(startISO, endISO) {
  const s = utcNoon(startISO).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const e = utcNoon(endISO).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${s} – ${e}`;                                                    // en-dash matches sample
}

function fmtDay(iso) {
  return utcNoon(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function fmtDate(iso) {
  return utcNoon(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function isWeekend(iso) {
  const dow = utcNoon(iso).getUTCDay();
  return dow === 0 || dow === 6;
}

// ─── Excel column letter for a 1-indexed column ─────────────────
// Only needs A-Z for the sample's 23 columns; if any account ever
// grows past 26 service cols this needs AA-support. Fixed to A-ZZ
// for a bit of headroom.
function colLetter(n) {
  if (n < 1) throw new Error(`colLetter: bad n ${n}`);
  if (n <= 26) return String.fromCharCode(64 + n);
  const hi = Math.floor((n - 1) / 26);
  const lo = ((n - 1) % 26) + 1;
  return String.fromCharCode(64 + hi) + String.fromCharCode(64 + lo);
}

// ─── Filename normalization (matches recordCopyPdf pattern) ─────

const EM_DASH = "—";

export function buildExportFilename({ accountKey, scope, year, period, month }) {
  if (accountKey && String(accountKey).includes(EM_DASH)) {
    throw new Error(`buildExportFilename: account key contains em-dash: ${JSON.stringify(accountKey)}`);
  }
  const clean = String(accountKey || "").replace(/\s+/g, "");
  const today = new Date().toISOString().slice(0, 10);
  if (scope === "year")   return `KitchFix_SC_${clean}_FY${year}_${today}.xlsx`;
  if (scope === "period") {
    const num = String(period || "").replace(/^P/i, "");
    return `KitchFix_SC_${clean}_Period${num}_${today}.xlsx`;
  }
  if (scope === "month")  return `KitchFix_SC_${clean}_${month}_${today}.xlsx`;
  throw new Error(`buildExportFilename: unknown scope ${scope}`);
}

// ─── Scope -> date window resolver ──────────────────────────────
//
// year:   Jan 1 - today (season-to-date)
// period: first + last date in sc_day_metadata matching account + period
// month:  YYYY-MM-01 - end of month
//
// Returns { firstDay, lastDay, scopeLabel } where scopeLabel is the
// text that goes in row 2 (e.g. "2026 · SEASON TO DATE", "2026 ·
// PERIOD 8", "2026 · SEPTEMBER").

async function resolveWindow({ supa, accountKey, scope, year, period, month }) {
  if (scope === "year") {
    const firstDay = `${year}-01-01`;
    const lastDay  = new Date().toISOString().slice(0, 10);
    return { firstDay, lastDay, scopeLabel: `${year} · SEASON TO DATE` };
  }
  if (scope === "month") {
    if (!/^\d{4}-\d{2}$/.test(String(month || ""))) {
      throw new Error(`resolveWindow: month required (YYYY-MM), got ${JSON.stringify(month)}`);
    }
    const [y, m] = month.split("-").map(Number);
    const firstDay = `${month}-01`;
    const lastDay  = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const label = new Date(Date.UTC(y, m - 1, 1))
      .toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
    return { firstDay, lastDay, scopeLabel: `${year} · ${label}` };
  }
  if (scope === "period") {
    if (!period) throw new Error("resolveWindow: period required for scope=period");
    const num = String(period).replace(/^P/i, "");
    const { data, error } = await supa
      .from("sc_day_metadata")
      .select("service_date")
      .eq("account_key", accountKey)
      .eq("period", num)
      .gte("service_date", `${year}-01-01`)
      .lte("service_date", `${year}-12-31`)
      .order("service_date", { ascending: true });
    if (error) throw new Error(`resolveWindow: sc_day_metadata read for period ${num}: ${error.message}`);
    if (!data || data.length === 0) throw new Error(`resolveWindow: no sc_day_metadata rows for account=${accountKey} period=${num} year=${year}`);
    return {
      firstDay: data[0].service_date,
      lastDay:  data[data.length - 1].service_date,
      scopeLabel: `${year} · PERIOD ${num}`,
    };
  }
  throw new Error(`resolveWindow: unknown scope ${JSON.stringify(scope)}`);
}

// ─── Price as-of ────────────────────────────────────────────────

function priceAsOfMap(prices, iso) {
  // prices is Map<service_id, [{effective_date, price}]> sorted DESC by date
  const out = new Map();
  for (const [sid, arr] of prices.entries()) {
    let best = 0;
    for (const p of arr) {
      if (String(p.effective_date) <= iso) { best = Number(p.price) || 0; break; }
    }
    out.set(sid, best);
  }
  return out;
}

// Latest-price-at-lastDay: used for the fixed rate that lives in
// row 6 of Projections/Actuals + Overview col C. Kevin's ruling F2:
// rate row is a single value per service (as-of the export's lastDay).
// A mid-window rate change is not visible in this workbook, but a
// user editing the rate cell recomputes every row via cell-referenced
// formula.
function ratesAsOfLastDay(prices, lastDay) {
  return priceAsOfMap(prices, lastDay);
}

// ─── Public entrypoint ──────────────────────────────────────────

/**
 * Build the operator export workbook.
 *
 * @param {Object} args
 * @param {string} args.accountKey        e.g. "TBJ - FL"
 * @param {"year"|"period"|"month"} args.scope
 * @param {number} args.year              YYYY
 * @param {string} [args.period]          e.g. "P8" or "8" (scope=period)
 * @param {string} [args.month]           e.g. "2026-09" (scope=month)
 * @param {string} [args.generatedBy]     User email for the "generated by" footer
 * @param {Object} [args.deps]            { supa } - injectable for tests
 * @returns {Promise<{ workbook, filename, tieToSourceCents, meta }>}
 *   tieToSourceCents is the actual-revenue total in cents, computed
 *   from raw sc_daily_revenue. Caller asserts this matches the
 *   workbook's Actuals SUM(revenue) after LibreOffice recalc.
 */
export async function buildScExport({ accountKey, scope, year, period, month, generatedBy, deps }) {
  if (!accountKey) throw new Error("buildScExport: accountKey required");
  if (!year || !/^\d{4}$/.test(String(year))) throw new Error("buildScExport: year required (YYYY)");
  if (!["year", "period", "month"].includes(scope)) throw new Error(`buildScExport: unknown scope ${scope}`);

  const supa = deps?.supa || getServiceClient();

  // ─── Fee-account refusal fence ────────────────────────────────
  // Kevin ruling 2026-09-10 (Item 3): refuse fee accounts. The
  // three-tab shape requires a service column set that Projections
  // and Actuals share; fee accounts bill flat contractual amounts
  // with no such structure. Menu hides the button for fee accounts;
  // this fence catches any URL-typed request that bypasses the menu.
  const { data: acctRow, error: acctErr } = await supa
    .from("accounts")
    .select("team_key, name, billing_model")
    .eq("team_key", accountKey)
    .maybeSingle();
  if (acctErr) throw new Error(`buildScExport: accounts read: ${acctErr.message}`);
  if (!acctRow) throw new Error(`buildScExport: account not found: ${accountKey}`);
  if (acctRow.billing_model === "flat_fee") {
    const err = new Error(`buildScExport: fee accounts have no per-service projected/actual shape; this export is per-meal only. See PR body for the rationale + fallback options.`);
    err.code = "FEE_ACCOUNT_UNSUPPORTED";
    throw err;
  }

  const win = await resolveWindow({ supa, accountKey, scope, year, period, month });

  // ─── Bulk data pulls ──────────────────────────────────────────
  // Supabase / PostgREST silently caps unpaginated .select() at 1000
  // rows. A full-year TBJ - FL actuals set is ~4,900 rows; a truncated
  // read would silently drop services from the column set AND break
  // tie-to-source. Every heavy table walks paginated with count-exact
  // safety belt. Same pattern the Academy loader uses (see
  // src/lib/academy/requirements.js:214). Small-fixed tables (groups,
  // services, prices, day_metadata) fit under the cap; heavy ones
  // (projections, actuals, revenue) paginate.
  const [
    groupsRes, servicesRes, pricesRes, metaRes,
  ] = await Promise.all([
    supa.from("sc_service_groups")
      .select("id, group_name, sort_order")
      .eq("account_key", accountKey)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supa.from("sc_services")
      .select("id, service_name, group_id, sort_order, is_non_revenue, is_flat_fee, active")
      .eq("account_key", accountKey)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supa.from("sc_service_prices")
      .select("service_id, effective_date, price")
      .lte("effective_date", win.lastDay)
      .order("effective_date", { ascending: false }),
    supa.from("sc_day_metadata")
      .select("service_date, period, week_label")
      .eq("account_key", accountKey)
      .gte("service_date", win.firstDay)
      .lte("service_date", win.lastDay)
      .order("service_date", { ascending: true }),
  ]);
  const [projData, actData, revData] = await Promise.all([
    paginatedSelect(supa, "sc_daily_projections",
      (from, to) => supa.from("sc_daily_projections")
        .select("service_id, service_date, projected_count", { count: "exact" })
        .eq("account_key", accountKey)
        .gte("service_date", win.firstDay)
        .lte("service_date", win.lastDay)
        .order("service_date", { ascending: true })
        .order("service_id", { ascending: true })
        .range(from, to)),
    paginatedSelect(supa, "sc_daily_actuals",
      (from, to) => supa.from("sc_daily_actuals")
        .select("service_id, service_date, actual_count", { count: "exact" })
        .eq("account_key", accountKey)
        .gte("service_date", win.firstDay)
        .lte("service_date", win.lastDay)
        .order("service_date", { ascending: true })
        .order("service_id", { ascending: true })
        .range(from, to)),
    paginatedSelect(supa, "sc_daily_revenue",
      (from, to) => supa.from("sc_daily_revenue")
        .select("actual_revenue, is_non_revenue, service_id, service_date", { count: "exact" })
        .eq("account_key", accountKey)
        .gte("service_date", win.firstDay)
        .lte("service_date", win.lastDay)
        .order("service_date", { ascending: true })
        .order("service_id", { ascending: true })
        .range(from, to)),
  ]);
  const projRes = { data: projData, error: null };
  const actRes  = { data: actData,  error: null };
  const revRes  = { data: revData,  error: null };

  for (const [name, r] of [
    ["sc_service_groups", groupsRes], ["sc_services", servicesRes],
    ["sc_service_prices", pricesRes], ["sc_daily_projections", projRes],
    ["sc_daily_actuals", actRes],     ["sc_day_metadata", metaRes],
    ["sc_daily_revenue", revRes],
  ]) if (r.error) throw new Error(`buildScExport: ${name} read: ${r.error.message}`);

  // ─── Index everything by ID + date ────────────────────────────
  const groupById = new Map();
  for (const g of groupsRes.data || []) groupById.set(g.id, g);

  // Filter services to those belonging to a group we have (defensive
  // against orphans) + attach group.
  const services = (servicesRes.data || [])
    .filter((s) => s.group_id && groupById.has(s.group_id))
    .map((s) => ({ ...s, group: groupById.get(s.group_id) }));

  const pricesBySvc = new Map();
  for (const p of pricesRes.data || []) {
    if (!pricesBySvc.has(p.service_id)) pricesBySvc.set(p.service_id, []);
    pricesBySvc.get(p.service_id).push(p);
  }

  const projByKey = new Map();       // Map<`${svcId}|${date}`, count>
  const actByKey  = new Map();
  let projTotalBySvc = new Map();    // Map<svcId, total qty>
  let actTotalBySvc  = new Map();
  for (const r of projRes.data || []) {
    projByKey.set(`${r.service_id}|${r.service_date}`, Number(r.projected_count) || 0);
    projTotalBySvc.set(r.service_id, (projTotalBySvc.get(r.service_id) || 0) + (Number(r.projected_count) || 0));
  }
  for (const r of actRes.data || []) {
    actByKey.set(`${r.service_id}|${r.service_date}`, Number(r.actual_count) || 0);
    actTotalBySvc.set(r.service_id, (actTotalBySvc.get(r.service_id) || 0) + (Number(r.actual_count) || 0));
  }

  const metaByDate = new Map();
  for (const r of metaRes.data || []) metaByDate.set(r.service_date, r);

  // Tie-to-source: sum of sc_daily_revenue.actual_revenue over the
  // window, EXCLUDING amount-type rows (Fun $$$$ Allocated) since
  // those are dollar allocations, not billable revenue. This is the
  // number the workbook's Actuals SUM(revenue) MUST match. Kevin
  // fence: "total actual revenue in the workbook equals the sum of
  // sc_daily_revenue for the window."
  let tieToSourceCents = 0;
  for (const r of revRes.data || []) {
    if (r.is_non_revenue) continue;
    tieToSourceCents += Math.round((Number(r.actual_revenue) || 0) * 100);
  }

  // ─── Column set: drop services with zero across BOTH tabs ─────
  //
  // Kevin ruling F4 2026-09-10: per-window. If a service is zero in
  // BOTH projections and actuals across the export window, drop it.
  // Amount-type services follow the same rule (they can be dropped
  // if unused in-window).
  const includedServices = services.filter((s) => {
    return (projTotalBySvc.get(s.id) || 0) > 0
        || (actTotalBySvc.get(s.id)  || 0) > 0;
  });

  // Sort included services by (group.sort_order, service.sort_order,
  // service_name) so the grouping is stable.
  includedServices.sort((a, b) => {
    if ((a.group.sort_order ?? 999) !== (b.group.sort_order ?? 999)) {
      return (a.group.sort_order ?? 999) - (b.group.sort_order ?? 999);
    }
    if ((a.sort_order ?? 999) !== (b.sort_order ?? 999)) {
      return (a.sort_order ?? 999) - (b.sort_order ?? 999);
    }
    return String(a.service_name).localeCompare(String(b.service_name));
  });

  // Group tint palette assignment by group.sort_order (stable).
  const orderedGroupIds = [...new Set(includedServices.map((s) => s.group.id))];
  const paletteByGroupId = new Map();
  for (let i = 0; i < orderedGroupIds.length; i++) {
    paletteByGroupId.set(orderedGroupIds[i], GROUP_PALETTE[i % GROUP_PALETTE.length]);
  }

  // ─── Row-level dates (every day in the window) ────────────────
  const dates = [];
  for (let d = win.firstDay; d <= win.lastDay; d = addDaysIso(d, 1)) dates.push(d);

  // ─── Rates row (as-of lastDay) ────────────────────────────────
  const ratesByServiceId = ratesAsOfLastDay(pricesBySvc, win.lastDay);

  // ─── Compose the workbook ─────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = "KitchFix Ops Hub";
  wb.created = new Date();

  const accountName = acctRow.name || accountKey;

  // Build Projections + Actuals first so Overview formulas can
  // reference the exact ranges. Subtitle mirrors the sample's shape
  // ("2026 · PROJECTIONS" / "2026 · ACTUALS") - scope-adornment
  // (period / month) surfaces in the Overview subtitle only, so the
  // data sheets carry the simpler noun.
  const projSheet = buildDataSheet(wb, {
    title: "Projections", tabColor: NAVY_ALT,
    subtitle: `${year} · PROJECTIONS`,
    dates, includedServices, paletteByGroupId,
    ratesByServiceId, dataMap: projByKey, metaByDate,
    accountName, win,
  });
  const actSheet = buildDataSheet(wb, {
    title: "Actuals", tabColor: GREEN,
    subtitle: `${year} · ACTUALS`,
    dates, includedServices, paletteByGroupId,
    ratesByServiceId, dataMap: actByKey, metaByDate,
    accountName, win,
  });

  // Overview references Projections + Actuals cell ranges. Do this
  // last so we know the data-row spans.
  buildOverviewSheet(wb, {
    accountName, scopeLabel: win.scopeLabel,
    win, includedServices, paletteByGroupId,
    ratesByServiceId,
    dataRowStart: 7, dataRowEnd: 7 + dates.length - 1,
    generatedBy,
  });

  // Ensure the three tabs are in the intended visual order (Overview
  // first) - ExcelJS orders sheets by insertion.
  wb.eachSheet((sheet, id) => { /* order enforced by insertion below */ });
  // Reorder: move Overview to the front. Rebuild via clone would be
  // heavy; instead, use ExcelJS's built-in orderNo where supported.
  const sheetsInOrder = ["Overview", "Projections", "Actuals"];
  wb.orderNo = null;
  for (let i = 0; i < sheetsInOrder.length; i++) {
    const s = wb.getWorksheet(sheetsInOrder[i]);
    if (s) s.orderNo = i;
  }

  const filename = buildExportFilename({ accountKey, scope, year, period, month });

  return {
    workbook: wb,
    filename,
    tieToSourceCents,
    meta: {
      accountKey, scope, year, period, month,
      firstDay: win.firstDay, lastDay: win.lastDay,
      serviceCount: includedServices.length,
      dayCount: dates.length,
      generatedBy: generatedBy || null,
    },
  };
}

// ─── buildDataSheet: Projections OR Actuals (identical shape) ───
//
// dataMap keys: `${service_id}|${service_date}` -> count.
//
// Sheet layout:
//   row 1: title (account name), navy 16pt bold
//   row 2: "{year} · PROJECTIONS" | "{year} · ACTUALS"
//   row 3: date range (grey metadata)
//   row 4: fixed col headers (merged A4:A6 etc) + group headers over service cols
//   row 5: service names (rotated 90°, height 96)
//   row 6: rate row (per service) - grey 8pt
//   row 7 - N: data rows (Day / Date / Period / Week / Revenue / Meals / [service qty])
//   row N+1: TOTAL row (navy bold)

function buildDataSheet(wb, {
  title, tabColor, subtitle, dates, includedServices, paletteByGroupId,
  ratesByServiceId, dataMap, metaByDate, accountName, win,
}) {
  const s = wb.addWorksheet(title, {
    properties: { tabColor: { argb: tabColor } },
    views: [{ state: "frozen", xSplit: 6, ySplit: 6, showGridLines: false }],
  });

  // ── Column widths (matches sample) ──
  const FIXED_COL_WIDTHS = [5.51, 8.5, 7.0, 8.0, 12.5, 8.5];   // A-F
  for (let i = 0; i < FIXED_COL_WIDTHS.length; i++) {
    s.getColumn(i + 1).width = FIXED_COL_WIDTHS[i];
  }
  for (let i = 0; i < includedServices.length; i++) {
    s.getColumn(7 + i).width = 6.6;
  }

  // ── Row 1-3: title / subtitle / date range ──
  s.getRow(1).height = 19.7;
  s.getCell(1, 1).value = accountName;
  s.getCell(1, 1).font = { name: "Arial", size: 16, bold: true, color: { argb: NAVY } };

  s.getCell(2, 1).value = subtitle;
  s.getCell(2, 1).font = { name: "Arial", size: 11, bold: true, color: { argb: GREEN } };

  s.getCell(3, 1).value = fmtRangeLong(win.firstDay, win.lastDay);
  s.getCell(3, 1).font = { name: "Arial", size: 9, color: { argb: GREY } };

  // ── Row 4-6: header block ──
  const FIXED_HEADERS = ["Day", "Date", "Period", "Week", "Revenue", "Meals"];
  s.getRow(4).height = 18;
  s.getRow(5).height = 96;
  for (let i = 0; i < FIXED_HEADERS.length; i++) {
    const col = i + 1;
    s.mergeCells(4, col, 6, col);
    const cell = s.getCell(4, col);
    cell.value = FIXED_HEADERS[i];
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  // Row 4 group headers over service cols (merged per group span)
  const groupColSpans = new Map();
  for (let i = 0; i < includedServices.length; i++) {
    const col = 7 + i;
    const gid = includedServices[i].group.id;
    if (!groupColSpans.has(gid)) groupColSpans.set(gid, [col, col]);
    else groupColSpans.get(gid)[1] = col;
  }
  for (const [gid, [first, last]] of groupColSpans.entries()) {
    if (last > first) s.mergeCells(4, first, 4, last);
    const cell = s.getCell(4, first);
    cell.value = includedServices.find((sv) => sv.group.id === gid).group.group_name;
    const palette = paletteByGroupId.get(gid);
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.dark } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  // Row 5: service names (rotated 90°)
  for (let i = 0; i < includedServices.length; i++) {
    const col = 7 + i;
    const svc = includedServices[i];
    const cell = s.getCell(5, col);
    cell.value = svc.service_name;
    const palette = paletteByGroupId.get(svc.group.id);
    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: INK } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.tint } };
    cell.alignment = { horizontal: "center", vertical: "middle", textRotation: 90 };
  }

  // Row 6: rate row (per service)
  for (let i = 0; i < includedServices.length; i++) {
    const col = 7 + i;
    const svc = includedServices[i];
    const cell = s.getCell(6, col);
    if (svc.is_non_revenue) {
      cell.value = null;
    } else {
      cell.value = ratesByServiceId.get(svc.id) || 0;
      cell.numFmt = MONEY_FMT;
    }
    const palette = paletteByGroupId.get(svc.group.id);
    cell.font = { name: "Arial", size: 8, color: { argb: GREY } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.tint } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }

  // ── Precompute per-svc column letter + revenue-vs-amount flag ──
  const svcCols = includedServices.map((svc, i) => ({
    svc, col: 7 + i, letter: colLetter(7 + i),
    isRevenue: !svc.is_non_revenue,
  }));
  const revenueTerms = svcCols
    .filter((x) => x.isRevenue)
    .map((x) => `${x.letter}<ROW>*${x.letter}$6`);
  const mealsTerms = svcCols
    .filter((x) => x.isRevenue)
    .map((x) => `${x.letter}<ROW>`);

  // ── Rows 7 .. 7+dates.length-1: one per date ──
  for (let r = 0; r < dates.length; r++) {
    const iso = dates[r];
    const rowNum = 7 + r;
    s.getRow(rowNum).height = 15;
    const meta = metaByDate.get(iso);
    const isWknd = isWeekend(iso);
    const zebra = (r % 2 === 1) ? "FFFAFAFB" : null;

    // A: Day
    const cA = s.getCell(rowNum, 1);
    cA.value = fmtDay(iso);
    cA.font = { name: "Arial", size: 10, color: { argb: isWknd ? GREY : INK } };
    cA.alignment = { horizontal: "left", vertical: "middle" };
    if (zebra) cA.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };

    // B: Date
    const cB = s.getCell(rowNum, 2);
    cB.value = fmtDate(iso);
    cB.font = { name: "Arial", size: 10, color: { argb: INK } };
    cB.alignment = { horizontal: "left", vertical: "middle" };
    if (zebra) cB.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };

    // C: Period
    const cC = s.getCell(rowNum, 3);
    cC.value = meta?.period ? Number(meta.period) : null;
    cC.font = { name: "Arial", size: 10, color: { argb: GREY } };
    cC.alignment = { horizontal: "center", vertical: "middle" };
    if (zebra) cC.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };

    // D: Week
    const cD = s.getCell(rowNum, 4);
    cD.value = meta?.week_label || null;
    cD.font = { name: "Arial", size: 10, color: { argb: GREY } };
    cD.alignment = { horizontal: "center", vertical: "middle" };
    if (zebra) cD.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };

    // E: Revenue formula (cell-referenced rates per Kevin F2)
    const cE = s.getCell(rowNum, 5);
    if (revenueTerms.length > 0) {
      cE.value = { formula: revenueTerms.map((t) => t.replaceAll("<ROW>", String(rowNum))).join("+") };
      cE.numFmt = MONEY_FMT;
    }
    cE.font = { name: "Arial", size: 10, color: { argb: INK } };
    cE.alignment = { horizontal: "right", vertical: "middle" };
    if (zebra) cE.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };

    // F: Meals formula (SUM of revenue-service qty cells)
    const cF = s.getCell(rowNum, 6);
    if (mealsTerms.length > 0) {
      cF.value = { formula: mealsTerms.map((t) => t.replaceAll("<ROW>", String(rowNum))).join("+") };
      cF.numFmt = COUNT_FMT;
    }
    cF.font = { name: "Arial", size: 10, color: { argb: INK } };
    cF.alignment = { horizontal: "right", vertical: "middle" };
    if (zebra) cF.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };

    // G+: one per service - qty (either projected or actual per the
    // dataMap the caller injected).
    for (const x of svcCols) {
      const count = dataMap.get(`${x.svc.id}|${iso}`) || 0;
      const cell = s.getCell(rowNum, x.col);
      cell.value = count;
      // Zeros are hidden via numFmt; only positives render.
      cell.numFmt = HIDE_ZERO_FMT;
      cell.font = { name: "Arial", size: 10, color: { argb: count === 0 ? ZERO_GREY : INK } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: zebra } };
    }
  }

  // ── TOTAL row ──
  const totalRow = 7 + dates.length;
  s.getRow(totalRow).height = 18;
  const cellTotalLabel = s.getCell(totalRow, 1);
  cellTotalLabel.value = "TOTAL";
  cellTotalLabel.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
  cellTotalLabel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  cellTotalLabel.alignment = { horizontal: "left", vertical: "middle" };
  // Fill NAVY across the whole total row for visual weight
  for (let c = 2; c <= 6 + includedServices.length; c++) {
    const cell = s.getCell(totalRow, c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.alignment = { horizontal: "right", vertical: "middle" };
  }
  // Column totals
  const firstDataRow = 7;
  const lastDataRow  = 7 + dates.length - 1;
  s.getCell(totalRow, 5).value = { formula: `SUM(E${firstDataRow}:E${lastDataRow})` };
  s.getCell(totalRow, 5).numFmt = MONEY_FMT;
  s.getCell(totalRow, 6).value = { formula: `SUM(F${firstDataRow}:F${lastDataRow})` };
  s.getCell(totalRow, 6).numFmt = COUNT_FMT;
  for (const x of svcCols) {
    const cell = s.getCell(totalRow, x.col);
    cell.value = { formula: `SUM(${x.letter}${firstDataRow}:${x.letter}${lastDataRow})` };
    cell.numFmt = COUNT_FMT;
  }

  return s;
}

// ─── buildOverviewSheet ─────────────────────────────────────────
//
// Layout:
//   row 1: title
//   row 2: "{year} · SEASON TO DATE" (or PERIOD / MONTH variant)
//   row 3: date range · generated by
//   row 5: header row (Projected / Actual / Variance)
//   row 6-8: KPI rows (Days with service / Meals / Revenue)
//   row 10: "BY SERVICE" (green subtitle)
//   row 11: sub-header (Group / Service / Rate / Proj units / Act
//           units / Var / Proj revenue / Act revenue / Var)
//   row 12+: per-service rows
//   row (12+N): TOTAL row
//   row (12+N+2): footnote

function buildOverviewSheet(wb, {
  accountName, scopeLabel, win, includedServices, paletteByGroupId,
  ratesByServiceId, dataRowStart, dataRowEnd, generatedBy,
}) {
  const s = wb.addWorksheet("Overview", {
    properties: { tabColor: { argb: AMBER } },
    views: [{ state: "frozen", ySplit: 11, showGridLines: false }],
  });

  // Column widths
  const OVER_WIDTHS = [20, 28, 11, 12, 12, 10, 15, 15, 12];  // A-I
  for (let i = 0; i < OVER_WIDTHS.length; i++) s.getColumn(i + 1).width = OVER_WIDTHS[i];

  // Row 1: title
  s.getRow(1).height = 19.7;
  s.getCell(1, 1).value = accountName;
  s.getCell(1, 1).font = { name: "Arial", size: 16, bold: true, color: { argb: NAVY } };

  // Row 2: subtitle
  s.getCell(2, 1).value = scopeLabel;
  s.getCell(2, 1).font = { name: "Arial", size: 11, bold: true, color: { argb: GREEN } };

  // Row 3: date range + generated
  const gen = generatedBy
    ? `${fmtRangeLong(win.firstDay, win.lastDay)} · generated ${fmtDate(new Date().toISOString().slice(0, 10))}`
    : fmtRangeLong(win.firstDay, win.lastDay);
  s.getCell(3, 1).value = gen;
  s.getCell(3, 1).font = { name: "Arial", size: 9, color: { argb: GREY } };

  // Row 5: header row
  const H = ["", "Projected", "Actual", "Variance"];
  for (let i = 0; i < H.length; i++) {
    const c = s.getCell(5, i + 1);
    c.value = H[i];
    c.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { horizontal: (i === 0 ? "left" : "right"), vertical: "middle" };
  }

  // Rows 6-8: KPI rows. Formulas reference Projections/Actuals.
  const PROJ = "Projections";
  const ACT  = "Actuals";
  // Days-with-service uses col F (Meals). Kevin's fixture uses
  // COUNTIF(...,">0"). Same shape.
  s.getCell(6, 1).value = "Days with service";
  s.getCell(6, 2).value = { formula: `COUNTIF(${PROJ}!$F$${dataRowStart}:$F$${dataRowEnd},">0")` };
  s.getCell(6, 3).value = { formula: `COUNTIF(${ACT}!$F$${dataRowStart}:$F$${dataRowEnd},">0")` };
  s.getCell(6, 4).value = { formula: `C6-B6` };
  s.getCell(7, 1).value = "Meals";
  s.getCell(7, 2).value = { formula: `SUM(${PROJ}!$F$${dataRowStart}:$F$${dataRowEnd})` };
  s.getCell(7, 3).value = { formula: `SUM(${ACT}!$F$${dataRowStart}:$F$${dataRowEnd})` };
  s.getCell(7, 4).value = { formula: `C7-B7` };
  s.getCell(8, 1).value = "Revenue";
  s.getCell(8, 2).value = { formula: `SUM(${PROJ}!$E$${dataRowStart}:$E$${dataRowEnd})` };
  s.getCell(8, 3).value = { formula: `SUM(${ACT}!$E$${dataRowStart}:$E$${dataRowEnd})` };
  s.getCell(8, 4).value = { formula: `C8-B8` };
  for (const r of [6, 7]) {
    for (const c of [2, 3, 4]) s.getCell(r, c).numFmt = COUNT_FMT_DASH;
  }
  for (const c of [2, 3, 4]) s.getCell(8, c).numFmt = MONEY_FMT_DASH;
  for (const r of [6, 7, 8]) {
    for (const c of [1, 2, 3, 4]) {
      s.getCell(r, c).font = { name: "Arial", size: 10, color: { argb: INK } };
    }
  }

  // Row 10: "BY SERVICE" divider
  s.getCell(10, 1).value = "BY SERVICE";
  s.getCell(10, 1).font = { name: "Arial", size: 10, bold: true, color: { argb: GREEN } };

  // Row 11: sub-header
  const SH = ["Group", "Service", "Rate", "Proj units", "Act units", "Var", "Proj revenue", "Act revenue", "Var"];
  for (let i = 0; i < SH.length; i++) {
    const c = s.getCell(11, i + 1);
    c.value = SH[i];
    c.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { horizontal: (i <= 1 ? "left" : "right"), vertical: "middle" };
  }

  // Rows 12+: per-service rows. Group cell only appears on the
  // FIRST service of that group; subsequent services in the same
  // group leave col A blank (matches the sample).
  let prevGroupId = null;
  let lastServiceRow = 11;
  for (let i = 0; i < includedServices.length; i++) {
    const svc = includedServices[i];
    const rowNum = 12 + i;
    lastServiceRow = rowNum;
    const svcCol = colLetter(7 + i);      // Projections/Actuals column for this service

    // Group (col A): only on first-of-group.
    const groupLabel = svc.group.id === prevGroupId ? "" : svc.group.group_name;
    s.getCell(rowNum, 1).value = groupLabel;
    prevGroupId = svc.group.id;

    // Service name; amount-type services carry " (amount)" suffix.
    const serviceLabel = svc.is_non_revenue
      ? `${svc.service_name}  (amount)`
      : svc.service_name;
    s.getCell(rowNum, 2).value = serviceLabel;
    if (svc.is_non_revenue) {
      s.getCell(rowNum, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMOUNT_BG } };
    }

    // Rate (col C): blank for amount-type
    if (!svc.is_non_revenue) {
      s.getCell(rowNum, 3).value = ratesByServiceId.get(svc.id) || 0;
      s.getCell(rowNum, 3).numFmt = MONEY_FMT;
    }

    // Unit formulas (col D + E): SUM over Projections/Actuals col
    s.getCell(rowNum, 4).value = { formula: `SUM(${PROJ}!${svcCol}${dataRowStart}:${svcCol}${dataRowEnd})` };
    s.getCell(rowNum, 5).value = { formula: `SUM(${ACT}!${svcCol}${dataRowStart}:${svcCol}${dataRowEnd})` };
    s.getCell(rowNum, 6).value = { formula: `E${rowNum}-D${rowNum}` };
    s.getCell(rowNum, 4).numFmt = COUNT_FMT_DASH;
    s.getCell(rowNum, 5).numFmt = COUNT_FMT_DASH;
    s.getCell(rowNum, 6).numFmt = COUNT_FMT_DASH;

    // Revenue formulas (col G + H + I): cell-referenced to rate cell
    // C{rowNum}. Amount-type services: no revenue formula.
    if (!svc.is_non_revenue) {
      s.getCell(rowNum, 7).value = { formula: `D${rowNum}*$C${rowNum}` };
      s.getCell(rowNum, 8).value = { formula: `E${rowNum}*$C${rowNum}` };
      s.getCell(rowNum, 9).value = { formula: `H${rowNum}-G${rowNum}` };
      s.getCell(rowNum, 7).numFmt = MONEY_FMT_DASH;
      s.getCell(rowNum, 8).numFmt = MONEY_FMT_DASH;
      s.getCell(rowNum, 9).numFmt = MONEY_FMT_DASH;
    }

    for (const c of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const cell = s.getCell(rowNum, c);
      if (!cell.font) cell.font = { name: "Arial", size: 10, color: { argb: INK } };
    }
    s.getCell(rowNum, 2).alignment = { horizontal: "left", vertical: "middle" };
    for (const c of [3, 4, 5, 6, 7, 8, 9]) {
      s.getCell(rowNum, c).alignment = { horizontal: "right", vertical: "middle" };
    }
  }

  // TOTAL row
  const totalRow = lastServiceRow + 1;
  s.getCell(totalRow, 2).value = "TOTAL";
  s.getCell(totalRow, 2).font = { name: "Arial", size: 10, bold: true, color: { argb: INK } };
  s.getCell(totalRow, 7).value = { formula: `SUM(G12:G${lastServiceRow})` };
  s.getCell(totalRow, 8).value = { formula: `SUM(H12:H${lastServiceRow})` };
  s.getCell(totalRow, 9).value = { formula: `SUM(I12:I${lastServiceRow})` };
  for (const c of [7, 8, 9]) {
    s.getCell(totalRow, c).numFmt = MONEY_FMT_DASH;
    s.getCell(totalRow, c).font = { name: "Arial", size: 10, bold: true, color: { argb: INK } };
  }

  // Footnote
  const footRow = totalRow + 2;
  s.getCell(footRow, 1).value = `Units are meal counts. Lines marked (amount) are dollar allocations, not billable revenue - excluded from every revenue total in this workbook.`;
  s.getCell(footRow, 1).font = { name: "Arial", size: 9, italic: true, color: { argb: GREY } };
  s.mergeCells(footRow, 1, footRow, 9);
  s.getCell(footRow, 1).alignment = { wrapText: true };
  s.getRow(footRow).height = 30;
}

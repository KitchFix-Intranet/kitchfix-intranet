// Service Calendar operator Excel export.
//
// Public entry: buildScWorkbook({ accountKey, scope, year, period, month, generatedBy })
//   returns { workbook, filename } where workbook is an ExcelJS Workbook
//   ready to write to a stream and filename is the suggested attachment name.
//
// Design source: SC_export_design_renders.html
//   K1 = per-meal / MiLB Summary shape
//   K2 = year scope (adds all-in KPI + BY PERIOD + BY MONTH rollups)
//   K3 = fee (homestand-fee + STL-FL flat_fee) Summary shape
//   K4 = Daily detail + Notes sheets
//   L1 = BY WEEK block (period + month scopes only)
//   L2 = WEEKDAY AVERAGES block
//   L3 = SERVICE PERFORMANCE block
//
// Money rules (SC_MONEY_MODEL.md):
//   - Per-day dollar figures come from sc_daily_revenue (effective-dated
//     LATERAL price join). NEVER read the catalog price and multiply.
//   - Contract Service Fee (sc_fee_schedule.amount) is a REFERENCE row on
//     period/month exports (never summed into scope totals). At year
//     scope the all-in KPI row shows `meal revenue + SF` as an additive
//     P&L reading.
//   - covered_by_account_key set (e.g. TXR-TX-V covered by TXR-TX-H) =
//     Revenue tracked externally. Fee line omitted; Season Tracker note
//     surfaces instead.

import ExcelJS from "exceljs";
import { getServiceClient } from "@/lib/supabase";

// ── Style tokens (kept local so a caller can shape a stand-alone
// workbook without pulling the app's CSS var pipeline) ──────────────
const NAVY_FILL     = "FF153968"; // --navy-700 hex-quad with alpha prefix
const NAVY_FILL_ALT = "FF092B55"; // --navy-800 (row band on rollup tables)
const WHITE_FONT    = "FFFFFFFF";
const MONEY_GREEN   = "FF008330"; // --green-600
const MUTED_INK     = "FF64748B"; // --n-600
const DRAFT_RED     = "FFDC2626"; // --red-500
const DELTA_UNDER   = "FF8C3A00"; // --amber-700 (matches SC-064 amber-under)
const DELTA_OVER    = "FF008330"; // --green-600 (SC-064 green-over)

const MONEY_FMT     = '"$"#,##0';
const COUNT_FMT     = '#,##0';
const PCT_FMT       = '0.0%';
const DATE_FMT      = 'mmm d, yyyy';
const TIMESTAMP_FMT = 'yyyy-mm-dd hh:mm';

const DOW_ORDER = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Public entry ─────────────────────────────────────────────────────

export async function buildScWorkbook({ accountKey, scope, year, period, month, generatedBy }) {
  if (!accountKey) throw new Error("[scWorkbook] accountKey required");
  if (!year || !/^\d{4}$/.test(String(year))) throw new Error("[scWorkbook] year required (YYYY)");
  if (!["period", "month", "year"].includes(scope)) throw new Error("[scWorkbook] scope must be period|month|year");

  const supa = getServiceClient();
  const generatedAt = new Date();

  // Account + config first so the range resolver knows what shape to
  // fetch (period scope needs periodRanges from sc_day_metadata).
  const accountInfo = await loadAccountInfo(supa, accountKey);
  if (!accountInfo) throw new Error(`[scWorkbook] account not found: ${accountKey}`);

  const range = await resolveRange(supa, {
    scope, year: Number(year), period, month, accountKey,
  });

  // Bulk data pulls (all in parallel).
  const [
    viewRows,
    catalog,
    notes,
    homestandMap,
    feeRow,
    yearSummary,
  ] = await Promise.all([
    loadViewRows(supa, accountKey, range.first, range.last),
    loadCatalog(supa, accountKey),
    loadNotes(supa, accountKey, range.first, range.last),
    accountInfo.billingModel === "flat_fee"
      ? loadHomestand(supa, accountKey, range.first, range.last)
      : Promise.resolve({}),
    accountInfo.billingModel === "flat_fee"
      ? loadCurrentFee(supa, accountKey)
      : Promise.resolve(null),
    scope === "year"
      ? loadYearRollups(supa, accountKey, Number(year))
      : Promise.resolve(null),
  ]);

  const hasHomestandData = Object.keys(homestandMap).length > 0;
  const shape = deriveShape({ billingModel: accountInfo.billingModel, hasHomestandData });
  // TXR-TX-V and any other covered_by fee = revenue-external note in place
  // of the fee reference line.
  const revenueExternal = !!feeRow?.coveredByAccountKey;

  // Fold the flat row set into per-day + per-service + per-group buckets
  // the sheet builders can iterate without re-scanning.
  const perDay = buildPerDayIndex(viewRows, catalog, homestandMap);
  const completion = computeCompletion(perDay, shape);

  const ctx = {
    accountInfo,
    accountKey,
    scope,
    year: Number(year),
    range,
    generatedBy: generatedBy || "unknown",
    generatedAt,
    shape,
    revenueExternal,
    catalog,
    perDay,
    homestandMap,
    feeRow,
    yearSummary,
    completion,
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = generatedBy || "KitchFix Ops Hub";
  workbook.created = generatedAt;
  workbook.title = `Service Calendar - ${accountKey} - ${range.label}`;

  buildSummarySheet(workbook, ctx, notes);
  buildDailyDetailSheet(workbook, ctx);
  buildNotesSheet(workbook, ctx, notes);

  const filename = buildFilename(accountKey, range.shortLabel, generatedAt);
  return { workbook, filename };
}

// ── Shape + range resolution ─────────────────────────────────────────

function deriveShape({ billingModel, hasHomestandData }) {
  if (billingModel === "flat_fee" && hasHomestandData) return "homestand-fee";
  if (billingModel === "flat_fee") return "flat-fee";              // STL-FL
  return "per-meal";                                                // MLB / MiLB / PDC per-meal
}

// scope=period: resolve period=N -> {first,end} from sc_day_metadata.
// scope=month: month=YYYY-MM -> calendar month bounds.
// scope=year : full calendar year.
async function resolveRange(supa, { scope, year, period, month, accountKey }) {
  if (scope === "year") {
    return {
      first: `${year}-01-01`,
      last:  `${year}-12-31`,
      label: `Full year ${year}`,
      shortLabel: `FY${year}`,
      weekLabels: [], // year skips L1 by rule
    };
  }
  if (scope === "month") {
    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) throw new Error("[scWorkbook] month param required (YYYY-MM)");
    const [yy, mm] = month.split("-").map(Number);
    if (yy !== year) throw new Error("[scWorkbook] month year must equal year param");
    const lastDay = new Date(yy, mm, 0).getDate();
    const first = `${yy}-${String(mm).padStart(2, "0")}-01`;
    const last  = `${yy}-${String(mm).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const label = new Date(yy, mm - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    // Week labels for the month scope are computed from the view rows
    // themselves (weekLabels emerge from actual data).
    return { first, last, label, shortLabel: month, weekLabels: [] };
  }
  // period scope
  if (period == null) throw new Error("[scWorkbook] period param required for scope=period");
  const p = String(period).startsWith("P") ? String(period) : `P${period}`;
  const { data, error } = await supa
    .from("sc_day_metadata")
    .select("service_date, period")
    .eq("account_key", accountKey)
    .eq("period", p)
    .gte("service_date", `${year}-01-01`)
    .lte("service_date", `${year}-12-31`)
    .order("service_date", { ascending: true });
  if (error) throw new Error(`[scWorkbook] resolveRange.period: ${error.message}`);
  if (!data?.length) throw new Error(`[scWorkbook] period ${p} not found for ${accountKey} in ${year}`);
  const first = data[0].service_date;
  const last  = data[data.length - 1].service_date;
  return { first, last, label: `Period ${p.slice(1)}`, shortLabel: `Period${p.slice(1)}`, weekLabels: [] };
}

// ── Data loaders ─────────────────────────────────────────────────────

async function loadAccountInfo(supa, accountKey) {
  const { data, error } = await supa
    .from("accounts")
    .select("team_key, name, level, billing_model")
    .eq("team_key", accountKey)
    .maybeSingle();
  if (error) throw new Error(`[scWorkbook] loadAccountInfo: ${error.message}`);
  if (!data) return null;
  return {
    key: data.team_key,
    name: data.name || data.team_key,
    level: data.level || "",
    billingModel: data.billing_model || null,
  };
}

async function loadViewRows(supa, accountKey, first, last) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supa
      .from("sc_daily_revenue")
      .select("*")
      .eq("account_key", accountKey)
      .gte("service_date", first)
      .lte("service_date", last)
      .order("service_date", { ascending: true })
      .order("service_id",   { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`[scWorkbook] loadViewRows: ${error.message}`);
    if (!data?.length) break;
    for (const r of data) rows.push(r);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function loadCatalog(supa, accountKey) {
  const [groupsRes, servicesRes] = await Promise.all([
    supa
      .from("sc_service_groups")
      .select("id, group_name, sort_order")
      .eq("account_key", accountKey)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
    supa
      .from("sc_services")
      .select("id, group_id, service_name, is_flat_fee, is_tax_free, is_non_revenue, sort_order")
      .eq("account_key", accountKey)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true }),
  ]);
  if (groupsRes.error) throw new Error(`[scWorkbook] loadCatalog.groups: ${groupsRes.error.message}`);
  if (servicesRes.error) throw new Error(`[scWorkbook] loadCatalog.services: ${servicesRes.error.message}`);
  const groupsById = new Map();
  for (const g of groupsRes.data || []) {
    groupsById.set(g.id, { id: g.id, name: g.group_name, sortOrder: g.sort_order, services: [] });
  }
  const svcById = new Map();
  for (const s of servicesRes.data || []) {
    const svc = {
      id: s.id,
      groupId: s.group_id,
      name: s.service_name,
      isFlatFee: !!s.is_flat_fee,
      isTaxFree: !!s.is_tax_free,
      isNonRevenue: !!s.is_non_revenue,
      sortOrder: s.sort_order,
    };
    svcById.set(s.id, svc);
    const g = groupsById.get(s.group_id);
    if (g) g.services.push(svc);
  }
  const groups = [...groupsById.values()].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  return { groups, groupsById, svcById };
}

async function loadNotes(supa, accountKey, first, last) {
  const { data, error } = await supa
    .from("sc_day_note_entries")
    .select("service_date, note, author, created_at")
    .eq("account_key", accountKey)
    .gte("service_date", first)
    .lte("service_date", last)
    .order("service_date", { ascending: false })
    .order("created_at",   { ascending: false });
  if (error) throw new Error(`[scWorkbook] loadNotes: ${error.message}`);
  return (data || []).map((r) => ({
    date: r.service_date,
    note: r.note,
    author: r.author, // null on backfilled entries; display as "-"
    createdAt: r.created_at,
  }));
}

async function loadHomestand(supa, accountKey, first, last) {
  const { data, error } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, homestand_id, day_type, opponent")
    .eq("account_key", accountKey)
    .gte("service_date", first)
    .lte("service_date", last)
    .order("service_date", { ascending: true });
  if (error) throw new Error(`[scWorkbook] loadHomestand: ${error.message}`);
  const map = {};
  for (const r of data || []) {
    map[r.service_date] = { homestandId: r.homestand_id, dayType: r.day_type, opponent: r.opponent || "" };
  }
  return map;
}

async function loadCurrentFee(supa, accountKey) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supa
    .from("sc_fee_schedule")
    .select("amount, effective_date, period_type, payment_cadence, covered_by_account_key")
    .eq("account_key", accountKey)
    .lte("effective_date", today)
    .order("effective_date", { ascending: false })
    .order("created_at",     { ascending: false })
    .limit(1);
  if (error) throw new Error(`[scWorkbook] loadCurrentFee: ${error.message}`);
  const row = data?.[0];
  if (!row) return null;
  return {
    amount: Number(row.amount) || 0,
    effectiveDate: row.effective_date,
    periodType: row.period_type,
    paymentCadence: row.payment_cadence,
    coveredByAccountKey: row.covered_by_account_key || null,
  };
}

// Year rollups: per-period + per-month totals from sc_month_summary +
// aggregated view rows keyed by period.
async function loadYearRollups(supa, accountKey, year) {
  const [monthRes, dayMetaRes] = await Promise.all([
    supa
      .from("sc_month_summary")
      .select("*")
      .eq("account_key", accountKey)
      .gte("month", `${year}-01-01`)
      .lte("month", `${year}-12-31`)
      .order("month", { ascending: true }),
    supa
      .from("sc_day_metadata")
      .select("service_date, period")
      .eq("account_key", accountKey)
      .gte("service_date", `${year}-01-01`)
      .lte("service_date", `${year}-12-31`)
      .not("period", "is", null)
      .order("service_date", { ascending: true }),
  ]);
  if (monthRes.error) throw new Error(`[scWorkbook] loadYearRollups.month: ${monthRes.error.message}`);
  if (dayMetaRes.error) throw new Error(`[scWorkbook] loadYearRollups.dayMeta: ${dayMetaRes.error.message}`);
  const months = (monthRes.data || []).map((r) => ({
    month:             String(r.month).slice(0, 7),
    totalServiceDays:  Number(r.total_service_days)       || 0,
    daysWithActuals:   Number(r.days_with_actuals)        || 0,
    projectedRevenue:  Number(r.total_projected_revenue)  || 0,
    actualRevenue:     Number(r.total_actual_revenue)     || 0,
    projectedMeals:    Number(r.total_projected_meals)    || 0,
    actualMeals:       Number(r.total_actual_meals)       || 0,
  }));
  // Build a date -> period lookup so the view-row totals can be
  // aggregated per period cheaply.
  const periodByDate = new Map();
  for (const r of dayMetaRes.data || []) periodByDate.set(r.service_date, r.period);
  return { months, periodByDate };
}

// ── Index the view rows ─────────────────────────────────────────────
// perDay: Map<date, {
//   date, period, weekLabel, gameType, gameTime,
//   projectedRevenue, actualRevenue, projectedMeals, actualMeals,
//   hasActuals, allZeroActuals, allZeroProj, services: [ ... ]
// }>
// Each service row keeps its per-service view fields for the daily
// detail sheet + service performance calc.

function buildPerDayIndex(viewRows, catalog, homestandMap) {
  const byDate = new Map();
  for (const r of viewRows) {
    let bucket = byDate.get(r.service_date);
    if (!bucket) {
      bucket = {
        date: r.service_date,
        period: r.period || "",
        weekLabel: r.week_label || "",
        gameType: r.game_type || "",
        gameTime: r.game_time || "",
        projectedMeals: 0,
        actualMeals: 0,
        projectedRevenue: 0,
        actualRevenue: 0,
        hasActuals: false,
        anyNonZeroAct: false,
        anyNonZeroProj: false,
        services: [],
      };
      byDate.set(r.service_date, bucket);
    }
    const svc = catalog.svcById.get(r.service_id);
    const svcRow = {
      serviceId: r.service_id,
      serviceName: r.service_name || svc?.name || "",
      groupName: r.group_name || catalog.groupsById.get(svc?.groupId)?.name || "",
      isFlatFee: !!r.is_flat_fee,
      isNonRevenue: !!r.is_non_revenue,
      projectedCount: r.projected_count == null ? null : Number(r.projected_count),
      actualCount:    r.actual_count    == null ? null : Number(r.actual_count),
      priceAtDate:    Number(r.price_at_date)     || 0,
      projectedRevenue: Number(r.projected_revenue) || 0,
      actualRevenue:    Number(r.actual_revenue)    || 0,
      hasProjection: !!r.has_projection,
      hasActuals: !!r.has_actuals,
    };
    bucket.services.push(svcRow);
    bucket.projectedMeals += svcRow.projectedCount || 0;
    bucket.actualMeals    += svcRow.actualCount    || 0;
    bucket.projectedRevenue += svcRow.projectedRevenue;
    bucket.actualRevenue    += svcRow.actualRevenue;
    if (svcRow.hasActuals) bucket.hasActuals = true;
    if (svcRow.actualCount != null && svcRow.actualCount > 0) bucket.anyNonZeroAct = true;
    if (svcRow.projectedCount != null && svcRow.projectedCount > 0) bucket.anyNonZeroProj = true;
  }
  // Derive per-day status flags used by completion + weekday averages.
  for (const bucket of byDate.values()) {
    const hs = homestandMap[bucket.date] || null;
    bucket.homestand = hs;
    bucket.dayType = hs?.dayType || "";
    bucket.opponent = hs?.opponent || "";
    // no-service = actuals present but all zero, OR (per-meal only) a day
    // whose projection block was all-zero (planned off day). Mirror the
    // classifier's per-meal branch. Homestand accounts use dayType.
    bucket.isNoService = bucket.hasActuals
      ? !bucket.anyNonZeroAct
      : (!bucket.hasActuals && bucket.services.length > 0 && !bucket.anyNonZeroProj);
    bucket.isInService = !bucket.isNoService;
  }
  return byDate;
}

function computeCompletion(perDay, shape) {
  let expected = 0, entered = 0;
  for (const bucket of perDay.values()) {
    if (shape === "homestand-fee") {
      if (bucket.dayType === "GAME") {
        expected++;
        if (bucket.hasActuals) entered++;
      }
    } else {
      // per-meal + flat-fee (STL-FL): projection days are the denominator
      // (matches aggregateWorkspaceMetrics widened predicate: entered
      // includes explicit no-service).
      if (bucket.services.length > 0 && bucket.anyNonZeroProj) {
        expected++;
        if (bucket.hasActuals || bucket.isNoService) entered++;
      }
    }
  }
  return { expected, entered, isDraft: entered < expected };
}

// ── Sheet 1: Summary ─────────────────────────────────────────────────

function buildSummarySheet(workbook, ctx, notes) {
  const sheet = workbook.addWorksheet("Summary", {
    properties: { defaultColWidth: 18 },
  });
  sheet.columns = [
    { width: 26 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 22 },
    { width: 22 },
  ];

  // Title block (rows 1-6). Row 1 title; row 2 scope + range;
  // row 3 Generated by; row 4 timestamp; row 5 billing-model; row 6
  // source line. DRAFT stamp in the top-right when incomplete.
  const { accountInfo, range, generatedBy, generatedAt, shape, completion } = ctx;
  sheet.getCell("A1").value = `${accountInfo.key} - ${accountInfo.name}`;
  sheet.getCell("A1").font = { name: "Calibri", size: 16, bold: true };
  sheet.getCell("A2").value = `${range.label}`;
  sheet.getCell("A2").font = { name: "Calibri", size: 12, color: { argb: MUTED_INK } };
  sheet.getCell("A3").value = `Generated by`;
  sheet.getCell("B3").value = generatedBy;
  sheet.getCell("A4").value = `Generated at`;
  sheet.getCell("B4").value = generatedAt;
  sheet.getCell("B4").numFmt = TIMESTAMP_FMT;
  sheet.getCell("A5").value = `Billing model`;
  sheet.getCell("B5").value = billingModelLabel(shape, accountInfo.billingModel);
  sheet.getCell("A6").value = `Source`;
  sheet.getCell("B6").value = `sc_daily_revenue (effective-dated view) + sc_fee_schedule + sc_day_note_entries`;
  sheet.getCell("B6").font = { size: 10, color: { argb: MUTED_INK } };
  for (const r of [3, 4, 5, 6]) sheet.getCell(`A${r}`).font = { size: 10, bold: true, color: { argb: MUTED_INK } };

  if (completion.isDraft) {
    const draft = sheet.getCell("F1");
    draft.value = "DRAFT";
    draft.font = { size: 18, bold: true, color: { argb: DRAFT_RED } };
    draft.alignment = { horizontal: "right" };
    sheet.getCell("F2").value = `${completion.entered} of ${completion.expected} entered`;
    sheet.getCell("F2").font = { size: 10, color: { argb: DRAFT_RED }, bold: true };
    sheet.getCell("F2").alignment = { horizontal: "right" };
  }

  let row = 8;
  if (shape === "per-meal") {
    row = buildRevenueBlock(sheet, row, ctx);
    row = buildMealsBlock(sheet, row, ctx);
    row = buildByGroupBlock(sheet, row, ctx);
    if (ctx.scope !== "year") row = buildByWeekBlock(sheet, row, ctx);
    row = buildWeekdayAveragesBlock(sheet, row, ctx);
    row = buildServicePerformanceBlock(sheet, row, ctx);
    if (ctx.scope === "year") {
      row = buildByPeriodBlock(sheet, row, ctx);
      row = buildByMonthBlock(sheet, row, ctx);
    }
  } else {
    // fee shapes (homestand-fee + flat-fee STL-FL): dollar columns
    // suppressed throughout; game/service days + meals + fee reference.
    row = buildFeeServiceBlock(sheet, row, ctx);
    if (ctx.scope !== "year") row = buildByWeekBlock(sheet, row, ctx);
    row = buildWeekdayAveragesBlock(sheet, row, ctx);
    row = buildServicePerformanceBlock(sheet, row, ctx);
    if (ctx.scope === "year") {
      row = buildByPeriodBlock(sheet, row, ctx);
      row = buildByMonthBlock(sheet, row, ctx);
    }
  }

  // Silence lint on unused var so future edits notice if notes were meant to
  // land on the Summary too - they don't, they live on Sheet 3.
  void notes;
}

function billingModelLabel(shape, billingModel) {
  if (shape === "homestand-fee") return "Homestand fee (contract) + operational meal tracking";
  if (shape === "flat-fee")      return "Flat annual fee (STL-FL model)";
  return `Per-meal invoicing (${billingModel || "actuals_drive_invoice"})`;
}

// Per-meal REVENUE table + SF reference line.
function buildRevenueBlock(sheet, startRow, ctx) {
  const { perDay, completion, feeRow, scope, year, revenueExternal, shape, yearSummary } = ctx;
  let row = startRow;
  sectionHeader(sheet, row, "REVENUE"); row++;
  tableHeader(sheet, row, ["Line", "Projected", "Actual (entered)", "Variance"]); row++;

  let proj = 0, actual = 0;
  if (scope === "year" && yearSummary) {
    for (const m of yearSummary.months) { proj += m.projectedRevenue; actual += m.actualRevenue; }
  } else {
    for (const bucket of perDay.values()) { proj += bucket.projectedRevenue; actual += bucket.actualRevenue; }
  }
  const variance = actual - proj;

  moneyRow(sheet, row, "Meal service revenue", proj, actual, variance, {
    varianceSuffix: completion.expected > completion.entered
      ? ` · ${completion.expected - completion.entered} days open`
      : "",
  });
  row++;

  // Service fee row
  const sfLabel = "Service fee";
  if (revenueExternal) {
    sheet.getCell(`A${row}`).value = sfLabel;
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.mergeCells(`B${row}:D${row}`);
    const cell = sheet.getCell(`B${row}`);
    cell.value = `Revenue tracked externally (Season Tracker)`;
    cell.font = { color: { argb: MUTED_INK }, italic: true };
    row++;
  } else if (feeRow) {
    sheet.getCell(`A${row}`).value = sfLabel;
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.mergeCells(`B${row}:D${row}`);
    const cell = sheet.getCell(`B${row}`);
    cell.value = `${moneyStr(feeRow.amount)} / yr (CPI-adj) · annual reference - not included in period totals`;
    cell.font = { color: { argb: MUTED_INK }, italic: true };
    row++;
  } else if (shape !== "per-meal") {
    // fee shapes without a fee row (unusual - skip silently).
  }

  // All-in KPI row
  sheet.getCell(`A${row}`).value = "All-in KPI revenue";
  sheet.getCell(`A${row}`).font = { bold: true };
  if (scope === "year" && !revenueExternal && feeRow) {
    const allIn = actual + feeRow.amount;
    sheet.getCell(`B${row}`).value = proj + feeRow.amount;
    sheet.getCell(`B${row}`).numFmt = MONEY_FMT;
    sheet.getCell(`C${row}`).value = allIn;
    sheet.getCell(`C${row}`).numFmt = MONEY_FMT;
    sheet.getCell(`C${row}`).font = { bold: true, color: { argb: MONEY_GREEN } };
    sheet.getCell(`D${row}`).value = allIn - (proj + feeRow.amount);
    sheet.getCell(`D${row}`).numFmt = MONEY_FMT;
  } else {
    sheet.mergeCells(`B${row}:D${row}`);
    const cell = sheet.getCell(`B${row}`);
    cell.value = `meal revenue + service fee (additive) - computed on full-year exports`;
    cell.font = { color: { argb: MUTED_INK }, italic: true };
  }
  row++;
  return row + 1; // trailing blank row
}

function buildMealsBlock(sheet, startRow, ctx) {
  const { perDay, scope, yearSummary } = ctx;
  let row = startRow;
  sectionHeader(sheet, row, "MEALS"); row++;
  tableHeader(sheet, row, ["Line", "Projected", "Actual (entered)", "Variance"]); row++;
  let proj = 0, actual = 0;
  if (scope === "year" && yearSummary) {
    for (const m of yearSummary.months) { proj += m.projectedMeals; actual += m.actualMeals; }
  } else {
    for (const bucket of perDay.values()) { proj += bucket.projectedMeals; actual += bucket.actualMeals; }
  }
  countRow(sheet, row, "Total meals", proj, actual, actual - proj);
  row++;
  return row + 1;
}

// BY GROUP: one row per service group with entered $ + meals.
function buildByGroupBlock(sheet, startRow, ctx) {
  const { perDay, catalog } = ctx;
  let row = startRow;
  sectionHeader(sheet, row, "BY GROUP"); row++;
  tableHeader(sheet, row, ["Group", "Rate summary", "Entered $", "Entered meals"]); row++;

  const byGroup = new Map();
  for (const g of catalog.groups) byGroup.set(g.name, { rates: new Set(), enteredRev: 0, enteredMeals: 0 });
  for (const bucket of perDay.values()) {
    if (!bucket.hasActuals) continue;
    for (const s of bucket.services) {
      const g = byGroup.get(s.groupName);
      if (!g) continue;
      if (s.priceAtDate) g.rates.add(Math.round(s.priceAtDate * 100) / 100);
      g.enteredRev   += s.actualRevenue || 0;
      g.enteredMeals += s.actualCount   || 0;
    }
  }
  for (const [groupName, g] of byGroup.entries()) {
    if (g.enteredRev === 0 && g.enteredMeals === 0) continue;
    const rates = [...g.rates].sort((a, b) => a - b);
    const rateStr = rates.length === 0 ? "-"
      : rates.length === 1 ? moneyStr(rates[0])
      : `${moneyStr(rates[0])} - ${moneyStr(rates[rates.length - 1])}`;
    sheet.getCell(`A${row}`).value = groupName;
    sheet.getCell(`B${row}`).value = rateStr;
    sheet.getCell(`C${row}`).value = g.enteredRev;
    sheet.getCell(`C${row}`).numFmt = MONEY_FMT;
    sheet.getCell(`C${row}`).font = { color: { argb: MONEY_GREEN }, bold: true };
    sheet.getCell(`D${row}`).value = g.enteredMeals;
    sheet.getCell(`D${row}`).numFmt = COUNT_FMT;
    row++;
  }
  return row + 1;
}

// Fee service block (games/service days + meals entered + fee reference).
function buildFeeServiceBlock(sheet, startRow, ctx) {
  const { perDay, shape, feeRow, revenueExternal, completion } = ctx;
  let row = startRow;
  sectionHeader(sheet, row, "SERVICE"); row++;
  tableHeader(sheet, row, ["Line", "Schedule", "Entered", "Notes"]); row++;
  if (shape === "homestand-fee") {
    sheet.getCell(`A${row}`).value = "Game days";
    sheet.getCell(`B${row}`).value = completion.expected;
    sheet.getCell(`B${row}`).numFmt = COUNT_FMT;
    sheet.getCell(`C${row}`).value = completion.entered;
    sheet.getCell(`C${row}`).numFmt = COUNT_FMT;
    sheet.getCell(`D${row}`).value = completion.entered === completion.expected
      ? "Complete"
      : `${completion.expected - completion.entered} open`;
    sheet.getCell(`D${row}`).font = { color: { argb: MUTED_INK } };
    row++;
  } else {
    // flat-fee (STL-FL) - operational day tracking, no schedule anchor.
    let inServiceDays = 0, enteredDays = 0;
    for (const bucket of perDay.values()) {
      if (bucket.isInService) inServiceDays++;
      if (bucket.hasActuals || bucket.isNoService) enteredDays++;
    }
    sheet.getCell(`A${row}`).value = "Operational days";
    sheet.getCell(`B${row}`).value = inServiceDays;
    sheet.getCell(`B${row}`).numFmt = COUNT_FMT;
    sheet.getCell(`C${row}`).value = enteredDays;
    sheet.getCell(`C${row}`).numFmt = COUNT_FMT;
    row++;
  }
  let mealsEntered = 0;
  for (const bucket of perDay.values()) mealsEntered += bucket.actualMeals || 0;
  sheet.getCell(`A${row}`).value = "Meals entered";
  sheet.mergeCells(`B${row}:C${row}`);
  sheet.getCell(`B${row}`).value = mealsEntered;
  sheet.getCell(`B${row}`).numFmt = COUNT_FMT;
  sheet.getCell(`D${row}`).value = "no per-day dollars - fee account";
  sheet.getCell(`D${row}`).font = { color: { argb: MUTED_INK }, italic: true };
  row++;

  // Fee reference / revenue-external
  if (revenueExternal) {
    sheet.getCell(`A${row}`).value = "Contract fee";
    sheet.mergeCells(`B${row}:D${row}`);
    const cell = sheet.getCell(`B${row}`);
    cell.value = "Revenue tracked externally (Season Tracker)";
    cell.font = { color: { argb: MUTED_INK }, italic: true };
    row++;
  } else if (feeRow) {
    sheet.getCell(`A${row}`).value = "Contract fee";
    sheet.mergeCells(`B${row}:D${row}`);
    const cell = sheet.getCell(`B${row}`);
    cell.value = `${moneyStr(feeRow.amount)} / yr (${feeRow.periodType || "annual"}) - reference only, not per-period`;
    cell.font = { color: { argb: MUTED_INK }, italic: true };
    row++;
  }
  return row + 1;
}

// L1 BY WEEK - period + month scopes only.
function buildByWeekBlock(sheet, startRow, ctx) {
  const { perDay, shape, scope } = ctx;
  if (scope === "year") return startRow;
  let row = startRow;
  sectionHeader(sheet, row, "BY WEEK"); row++;
  const withDollars = shape === "per-meal";
  const cols = withDollars
    ? ["Week", "Projected $", "Actual $", "Meals"]
    : ["Week", "Game days", "Entered", "Meals"];
  tableHeader(sheet, row, cols); row++;

  // Discover weekLabels in scope order.
  const seen = new Set();
  const weekLabels = [];
  const daysSorted = [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of daysSorted) { if (d.weekLabel && !seen.has(d.weekLabel)) { seen.add(d.weekLabel); weekLabels.push(d.weekLabel); } }

  for (const w of weekLabels) {
    const wdays = daysSorted.filter(d => d.weekLabel === w);
    let projRev = 0, actRev = 0, projMeals = 0, actMeals = 0;
    let gameDays = 0, entered = 0;
    for (const d of wdays) {
      projRev   += d.projectedRevenue;
      actRev    += d.actualRevenue;
      projMeals += d.projectedMeals;
      actMeals  += d.actualMeals;
      if (d.dayType === "GAME") { gameDays++; if (d.hasActuals) entered++; }
    }
    sheet.getCell(`A${row}`).value = w;
    if (withDollars) {
      sheet.getCell(`B${row}`).value = projRev; sheet.getCell(`B${row}`).numFmt = MONEY_FMT;
      sheet.getCell(`C${row}`).value = actRev;  sheet.getCell(`C${row}`).numFmt = MONEY_FMT;
      sheet.getCell(`C${row}`).font = { color: { argb: MONEY_GREEN } };
      sheet.getCell(`D${row}`).value = actMeals || projMeals; sheet.getCell(`D${row}`).numFmt = COUNT_FMT;
    } else {
      sheet.getCell(`B${row}`).value = gameDays; sheet.getCell(`B${row}`).numFmt = COUNT_FMT;
      sheet.getCell(`C${row}`).value = entered;  sheet.getCell(`C${row}`).numFmt = COUNT_FMT;
      sheet.getCell(`D${row}`).value = actMeals || projMeals; sheet.getCell(`D${row}`).numFmt = COUNT_FMT;
    }
    row++;
  }
  return row + 1;
}

// L2 WEEKDAY AVERAGES - avg meals over entered days only.
function buildWeekdayAveragesBlock(sheet, startRow, ctx) {
  const { perDay } = ctx;
  let row = startRow;
  sectionHeader(sheet, row, "WEEKDAY AVERAGES"); row++;
  // Header note cell above the table
  sheet.getCell(`A${row}`).value = "Averages exclude unentered + no-service days";
  sheet.getCell(`A${row}`).font = { size: 10, color: { argb: MUTED_INK }, italic: true };
  row++;
  tableHeader(sheet, row, ["Weekday", "Avg meals (entered)", "Days counted"]); row++;
  const buckets = new Map();
  for (const dow of DOW_ORDER) buckets.set(dow, { count: 0, meals: 0 });
  for (const d of perDay.values()) {
    // Entered days only: hasActuals && !isNoService. No-service days
    // and unentered days excluded from the denominator.
    if (!d.hasActuals || d.isNoService) continue;
    const dow = DOW_ORDER[new Date(d.date + "T12:00:00").getDay()];
    const b = buckets.get(dow);
    if (!b) continue;
    b.count++;
    b.meals += d.actualMeals || 0;
  }
  for (const dow of DOW_ORDER) {
    const b = buckets.get(dow);
    sheet.getCell(`A${row}`).value = dow;
    sheet.getCell(`B${row}`).value = b.count > 0 ? Math.round((b.meals / b.count) * 10) / 10 : 0;
    sheet.getCell(`B${row}`).numFmt = COUNT_FMT;
    sheet.getCell(`C${row}`).value = b.count;
    sheet.getCell(`C${row}`).numFmt = COUNT_FMT;
    row++;
  }
  return row + 1;
}

// L3 SERVICE PERFORMANCE - every in-service service in scope, entered
// days only. Delta colored: green over, amber under.
function buildServicePerformanceBlock(sheet, startRow, ctx) {
  const { perDay, catalog, shape } = ctx;
  let row = startRow;
  sectionHeader(sheet, row, "SERVICE PERFORMANCE"); row++;
  const withDollars = shape === "per-meal";
  const cols = withDollars
    ? ["Service", "Group", "Avg proj", "Avg actual", "Avg Δ", "Days entered"]
    : ["Service", "Group", "Avg proj (count)", "Avg actual (count)", "Avg Δ", "Days entered"];
  tableHeader(sheet, row, cols); row++;

  // Aggregate per-service
  const perSvc = new Map();
  for (const bucket of perDay.values()) {
    if (!bucket.hasActuals || bucket.isNoService) continue;
    for (const s of bucket.services) {
      if (!s.hasActuals) continue;
      let agg = perSvc.get(s.serviceId);
      if (!agg) { agg = { name: s.serviceName, group: s.groupName, days: 0, sumProj: 0, sumAct: 0 }; perSvc.set(s.serviceId, agg); }
      agg.days++;
      agg.sumProj += s.projectedCount || 0;
      agg.sumAct  += s.actualCount    || 0;
    }
  }
  // Order by catalog for stable output.
  const orderedIds = [];
  for (const g of catalog.groups) for (const s of g.services) if (perSvc.has(s.id)) orderedIds.push(s.id);
  for (const id of orderedIds) {
    const agg = perSvc.get(id);
    if (!agg || agg.days === 0) continue;
    const avgProj = agg.sumProj / agg.days;
    const avgAct  = agg.sumAct  / agg.days;
    const delta = avgAct - avgProj;
    sheet.getCell(`A${row}`).value = agg.name;
    sheet.getCell(`B${row}`).value = agg.group;
    sheet.getCell(`C${row}`).value = Math.round(avgProj * 10) / 10;
    sheet.getCell(`C${row}`).numFmt = COUNT_FMT;
    sheet.getCell(`D${row}`).value = Math.round(avgAct * 10) / 10;
    sheet.getCell(`D${row}`).numFmt = COUNT_FMT;
    sheet.getCell(`E${row}`).value = Math.round(delta * 10) / 10;
    sheet.getCell(`E${row}`).numFmt = COUNT_FMT;
    sheet.getCell(`E${row}`).font = { color: { argb: delta >= 0 ? DELTA_OVER : DELTA_UNDER }, bold: true };
    sheet.getCell(`F${row}`).value = agg.days;
    sheet.getCell(`F${row}`).numFmt = COUNT_FMT;
    row++;
  }
  return row + 1;
}

// Year scope: BY PERIOD rollup (per-period totals from view rows).
function buildByPeriodBlock(sheet, startRow, ctx) {
  const { perDay, shape } = ctx;
  let row = startRow;
  sectionHeader(sheet, row, "BY PERIOD"); row++;
  const withDollars = shape === "per-meal";
  const cols = withDollars
    ? ["Period", "Projected $", "Actual $", "Projected meals", "Actual meals"]
    : ["Period", "Game days", "Entered", "Meals"];
  tableHeader(sheet, row, cols); row++;
  // Aggregate per period from perDay.
  const perPeriod = new Map();
  for (const d of perDay.values()) {
    const p = d.period || "-";
    let agg = perPeriod.get(p);
    if (!agg) { agg = { proj: 0, act: 0, projMeals: 0, actMeals: 0, gameDays: 0, entered: 0 }; perPeriod.set(p, agg); }
    agg.proj      += d.projectedRevenue;
    agg.act       += d.actualRevenue;
    agg.projMeals += d.projectedMeals;
    agg.actMeals  += d.actualMeals;
    if (d.dayType === "GAME") { agg.gameDays++; if (d.hasActuals) agg.entered++; }
  }
  // Sort periods numerically (P1..P13).
  const periods = [...perPeriod.keys()].filter(k => k !== "-").sort((a, b) => {
    const na = parseInt(String(a).replace(/[^0-9]/g, ""), 10) || 0;
    const nb = parseInt(String(b).replace(/[^0-9]/g, ""), 10) || 0;
    return na - nb;
  });
  for (const p of periods) {
    const agg = perPeriod.get(p);
    sheet.getCell(`A${row}`).value = p;
    if (withDollars) {
      sheet.getCell(`B${row}`).value = agg.proj; sheet.getCell(`B${row}`).numFmt = MONEY_FMT;
      sheet.getCell(`C${row}`).value = agg.act;  sheet.getCell(`C${row}`).numFmt = MONEY_FMT;
      sheet.getCell(`C${row}`).font = { color: { argb: MONEY_GREEN } };
      sheet.getCell(`D${row}`).value = agg.projMeals; sheet.getCell(`D${row}`).numFmt = COUNT_FMT;
      sheet.getCell(`E${row}`).value = agg.actMeals;  sheet.getCell(`E${row}`).numFmt = COUNT_FMT;
    } else {
      sheet.getCell(`B${row}`).value = agg.gameDays; sheet.getCell(`B${row}`).numFmt = COUNT_FMT;
      sheet.getCell(`C${row}`).value = agg.entered;  sheet.getCell(`C${row}`).numFmt = COUNT_FMT;
      sheet.getCell(`D${row}`).value = agg.actMeals || agg.projMeals; sheet.getCell(`D${row}`).numFmt = COUNT_FMT;
    }
    row++;
  }
  return row + 1;
}

// Year scope: BY MONTH rollup from sc_month_summary.
function buildByMonthBlock(sheet, startRow, ctx) {
  const { yearSummary, shape, homestandMap } = ctx;
  let row = startRow;
  sectionHeader(sheet, row, "BY MONTH"); row++;
  const withDollars = shape === "per-meal";
  const cols = withDollars
    ? ["Month", "Projected $", "Actual $", "Projected meals", "Actual meals", "Days entered"]
    : ["Month", "Meals", "Days entered", "Game days"];
  tableHeader(sheet, row, cols); row++;
  if (!yearSummary) return row + 1;
  for (const m of yearSummary.months) {
    const label = new Date(m.month + "-01T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    sheet.getCell(`A${row}`).value = label;
    if (withDollars) {
      sheet.getCell(`B${row}`).value = m.projectedRevenue; sheet.getCell(`B${row}`).numFmt = MONEY_FMT;
      sheet.getCell(`C${row}`).value = m.actualRevenue;    sheet.getCell(`C${row}`).numFmt = MONEY_FMT;
      sheet.getCell(`C${row}`).font = { color: { argb: MONEY_GREEN } };
      sheet.getCell(`D${row}`).value = m.projectedMeals; sheet.getCell(`D${row}`).numFmt = COUNT_FMT;
      sheet.getCell(`E${row}`).value = m.actualMeals;    sheet.getCell(`E${row}`).numFmt = COUNT_FMT;
      sheet.getCell(`F${row}`).value = m.daysWithActuals; sheet.getCell(`F${row}`).numFmt = COUNT_FMT;
    } else {
      // Fee shape: count game days in the month from homestandMap.
      let gameDays = 0;
      for (const date of Object.keys(homestandMap)) {
        if (date.slice(0, 7) === m.month && homestandMap[date].dayType === "GAME") gameDays++;
      }
      sheet.getCell(`B${row}`).value = m.actualMeals; sheet.getCell(`B${row}`).numFmt = COUNT_FMT;
      sheet.getCell(`C${row}`).value = m.daysWithActuals; sheet.getCell(`C${row}`).numFmt = COUNT_FMT;
      sheet.getCell(`D${row}`).value = gameDays; sheet.getCell(`D${row}`).numFmt = COUNT_FMT;
    }
    row++;
  }
  return row + 1;
}

// ── Sheet 2: Daily detail ────────────────────────────────────────────
// One row per (in-service day) × service. Future days = projections
// with blank actuals. No-service days excluded. Fee shapes drop
// Rate/$ and add Opponent where homestand data exists.

function buildDailyDetailSheet(workbook, ctx) {
  const { perDay, shape } = ctx;
  const sheet = workbook.addWorksheet("Daily detail", { views: [{ state: "frozen", ySplit: 1 }] });
  const withDollars = shape === "per-meal";
  const withOpponent = shape !== "per-meal";
  const cols = withDollars
    ? ["Date", "Period", "Week", "Status", "Group", "Service", "Proj", "Actual", "Δ", "Rate", "Proj $", "Actual $"]
    : withOpponent
      ? ["Date", "Period", "Week", "Status", "Opponent", "Group", "Service", "Proj", "Actual", "Δ"]
      : ["Date", "Period", "Week", "Status", "Group", "Service", "Proj", "Actual", "Δ"];
  sheet.columns = cols.map((h) => ({ header: h, width: h === "Service" ? 24 : h === "Group" ? 18 : 12 }));
  styleHeaderRow(sheet.getRow(1));

  const daysSorted = [...perDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const bucket of daysSorted) {
    if (bucket.isNoService) continue; // exclude no-service days
    for (const s of bucket.services) {
      const status = statusForRow(bucket, s);
      const proj = s.projectedCount != null ? s.projectedCount : null;
      const act  = s.actualCount    != null ? s.actualCount    : null;
      const delta = (act != null && proj != null) ? (act - proj) : null;
      const values = [
        toDate(bucket.date),
        bucket.period,
        bucket.weekLabel,
        status,
      ];
      if (withOpponent) values.push(bucket.opponent);
      values.push(s.groupName, s.serviceName, proj, act, delta);
      if (withDollars) values.push(s.priceAtDate, s.projectedRevenue || null, s.actualRevenue || null);
      const rowIx = sheet.addRow(values);
      // formats + coloring
      rowIx.getCell(1).numFmt = DATE_FMT;
      const projCol = withDollars ? 7 : (withOpponent ? 8 : 7);
      const actCol  = projCol + 1;
      const dCol    = actCol + 1;
      rowIx.getCell(projCol).numFmt = COUNT_FMT;
      rowIx.getCell(actCol).numFmt = COUNT_FMT;
      rowIx.getCell(dCol).numFmt = COUNT_FMT;
      if (delta != null) {
        rowIx.getCell(dCol).font = { color: { argb: delta >= 0 ? DELTA_OVER : DELTA_UNDER }, bold: true };
      }
      if (withDollars) {
        rowIx.getCell(10).numFmt = MONEY_FMT; // Rate
        rowIx.getCell(11).numFmt = MONEY_FMT; // Proj $
        rowIx.getCell(12).numFmt = MONEY_FMT; // Actual $
        rowIx.getCell(12).font = { color: { argb: MONEY_GREEN } };
      }
    }
  }
}

function statusForRow(bucket, svc) {
  if (bucket.dayType === "GAME") return bucket.hasActuals ? "entered (game)" : "scheduled (game)";
  if (bucket.hasActuals && bucket.isNoService) return "no-service";
  if (bucket.hasActuals) return "entered";
  if (svc?.hasProjection === false && (bucket.projectedMeals || 0) === 0) return "off";
  return "upcoming";
}

// ── Sheet 3: Notes ───────────────────────────────────────────────────

function buildNotesSheet(workbook, ctx, notes) {
  const sheet = workbook.addWorksheet("Notes", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "Date", width: 14 },
    { header: "Note", width: 60 },
    { header: "Author", width: 22 },
    { header: "Logged", width: 22 },
  ];
  styleHeaderRow(sheet.getRow(1));
  // Newest first already (loadNotes orders DESC).
  for (const n of notes) {
    const rowIx = sheet.addRow([
      toDate(n.date),
      n.note || "",
      n.author == null ? "—" : n.author,
      n.author == null ? "(pre-ledger note, migrated)" : (n.createdAt ? new Date(n.createdAt) : null),
    ]);
    rowIx.getCell(1).numFmt = DATE_FMT;
    if (n.author != null && n.createdAt) rowIx.getCell(4).numFmt = TIMESTAMP_FMT;
    if (n.author == null) rowIx.getCell(4).font = { italic: true, color: { argb: MUTED_INK } };
    rowIx.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
}

// ── Styling helpers ──────────────────────────────────────────────────

function sectionHeader(sheet, row, label) {
  sheet.mergeCells(`A${row}:F${row}`);
  const cell = sheet.getCell(`A${row}`);
  cell.value = label;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_FILL } };
  cell.font = { color: { argb: WHITE_FONT }, bold: true, size: 11 };
  cell.alignment = { vertical: "middle", horizontal: "left" };
  cell.border = { bottom: { style: "thin", color: { argb: NAVY_FILL_ALT } } };
  sheet.getRow(row).height = 20;
}

function tableHeader(sheet, row, columns) {
  columns.forEach((label, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: WHITE_FONT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_FILL_ALT } };
    cell.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "right" };
  });
}

function styleHeaderRow(row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, color: { argb: WHITE_FONT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_FILL } };
    cell.alignment = { vertical: "middle" };
  });
  row.height = 20;
}

function moneyRow(sheet, row, label, proj, actual, variance, { varianceSuffix = "" } = {}) {
  sheet.getCell(`A${row}`).value = label;
  sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`B${row}`).value = proj;     sheet.getCell(`B${row}`).numFmt = MONEY_FMT;
  sheet.getCell(`C${row}`).value = actual;   sheet.getCell(`C${row}`).numFmt = MONEY_FMT;
  sheet.getCell(`C${row}`).font = { bold: true, color: { argb: MONEY_GREEN } };
  if (varianceSuffix) {
    // Variance + "· N days open" phrase in a single cell so the row
    // stays one line. Use a formula-safe string.
    sheet.getCell(`D${row}`).value = `${moneyStr(variance)}${varianceSuffix}`;
  } else {
    sheet.getCell(`D${row}`).value = variance;
    sheet.getCell(`D${row}`).numFmt = MONEY_FMT;
  }
  sheet.getCell(`D${row}`).font = { color: { argb: variance >= 0 ? DELTA_OVER : DELTA_UNDER }, bold: true };
}

function countRow(sheet, row, label, proj, actual, variance) {
  sheet.getCell(`A${row}`).value = label;
  sheet.getCell(`A${row}`).font = { bold: true };
  sheet.getCell(`B${row}`).value = proj;     sheet.getCell(`B${row}`).numFmt = COUNT_FMT;
  sheet.getCell(`C${row}`).value = actual;   sheet.getCell(`C${row}`).numFmt = COUNT_FMT;
  sheet.getCell(`C${row}`).font = { bold: true };
  sheet.getCell(`D${row}`).value = variance; sheet.getCell(`D${row}`).numFmt = COUNT_FMT;
  sheet.getCell(`D${row}`).font = { color: { argb: variance >= 0 ? DELTA_OVER : DELTA_UNDER }, bold: true };
}

function moneyStr(n) {
  const v = Math.round(Number(n) || 0);
  return "$" + v.toLocaleString("en-US");
}

function toDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function buildFilename(accountKey, shortLabel, generatedAt) {
  const safeAccount = String(accountKey).replace(/\s+/g, "").replace(/-/g, "-"); // "CIN - AZ" -> "CIN-AZ"
  const dateStr = `${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, "0")}-${String(generatedAt.getDate()).padStart(2, "0")}`;
  return `KitchFix_SC_${safeAccount}_${shortLabel}_${dateStr}.xlsx`;
}

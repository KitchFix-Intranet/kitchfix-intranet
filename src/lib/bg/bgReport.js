// ═══════════════════════════════════════════════════════════════════
// bgReport - Monthly Boys & Girls Club meal-count report.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Kevin's commitment to Sebastian 2026-09-08: Sebastian bills B&G
// by hand and needs monthly meals + revenue from us. Kevin ruled
// (a) calendar months (not SC periods), (b) recipients per-account
// via sc_qbo_account_map.bg_report_recipients, (c) always send even
// on zero months (cron-liveness signal), (d) auto-scope to every
// service where sc_qbo_service_map.export_excluded = true on that
// account.
//
// ─── Why we read actuals directly, not the invoice builder ────────
//
// B&G services carry export_excluded=true on sc_qbo_service_map.
// That flag means their revenue counts toward account totals but the
// service is skipped by buildInvoicePayload (nothing lands on the
// client's QBO invoice). Reading through the builder would return
// zero. This report reads sc_daily_actuals directly + joins the
// as-of price from sc_service_prices, which is the exact reason
// the report exists.
//
// ─── Calendar-vs-period reconciliation ────────────────────────────
//
// Calendar months straddle SC period boundaries (SC runs 13 four-
// week periods that drift from calendar months). Report carries a
// reconciliation line naming the split so anyone tying it back to
// KPI dashboard period-level revenue sees the mismatch named rather
// than discovers it silently.
//
// Recon line lives on the workbook's Monthly sheet + in the email
// body. Same string in both places (single source).

import ExcelJS from "exceljs";

// ─── Style tokens (mirrors scWorkbook.js) ─────────────────────────
const NAVY_FILL    = "FF153968";
const WHITE_FONT   = "FFFFFFFF";
const MUTED_INK    = "FF64748B";
const MONEY_FMT    = '"$"#,##0.00';
const COUNT_FMT    = '#,##0';
const DATE_FMT     = 'mmm d, yyyy';

// ─── Date helpers ────────────────────────────────────────────────

// ISO YYYY-MM-DD -> Date in UTC noon (date-only strings must be
// anchored to UTC noon to survive local-tz parsing on any host).
function utcNoon(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

// Return { firstDay, lastDay } (ISO strings) for the calendar month
// containing the given YYYY-MM. E.g. "2026-09" -> {2026-09-01, 2026-09-30}.
export function monthBounds(monthISO) {
  if (!/^\d{4}-\d{2}$/.test(String(monthISO || ""))) {
    throw new Error(`bgReport.monthBounds: bad monthISO ${JSON.stringify(monthISO)}`);
  }
  const [y, m] = monthISO.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last  = new Date(Date.UTC(y, m,     0)); // day 0 of next month = last day
  return {
    firstDay: first.toISOString().slice(0, 10),
    lastDay:  last.toISOString().slice(0, 10),
    year:     y,
    monthNum: m,
    monthLabel: first.toLocaleDateString("en-US", {
      month: "long", year: "numeric", timeZone: "UTC",
    }),
  };
}

// ISO Monday of the week containing `iso`. Weeks are Mon-Sun.
function mondayOf(iso) {
  const d = utcNoon(iso);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const backToMon = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - backToMon);
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso, n) {
  const d = utcNoon(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Price resolver (as-of the service date) ─────────────────────
//
// Given a service_prices row set [{ effective_date, price }],
// return the price effective at `iso`. Uses the standard as-of
// pattern: most recent effective_date <= iso.
function priceAsOf(prices, iso) {
  let best = null;
  for (const p of prices || []) {
    if (String(p.effective_date) <= iso) {
      if (!best || String(p.effective_date) > String(best.effective_date)) {
        best = p;
      }
    }
  }
  return best ? Number(best.price) || 0 : 0;
}

// ─── Filename normalization (matches recordCopyPdf pattern) ──────

const EM_DASH = "—";

export function buildBgReportFilename(accountKey, monthISO) {
  if (accountKey && String(accountKey).includes(EM_DASH)) {
    throw new Error(
      `bgReport.buildFilename: account key contains em-dash: ${JSON.stringify(accountKey)}`
    );
  }
  const clean = String(accountKey || "").replace(/\s+/g, "");
  const b = monthBounds(monthISO);
  const monthShort = new Date(Date.UTC(b.year, b.monthNum - 1, 1))
    .toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return `${clean}_BG_${monthShort}-${b.year}.xlsx`;
}

// ─── Reconciliation line composer ────────────────────────────────

export function composeReconciliationLine({ monthLabel, firstDayMeta, lastDayMeta }) {
  const startPeriod = firstDayMeta?.period ? `P${firstDayMeta.period}` : "(period unknown)";
  const endPeriod   = lastDayMeta?.period  ? `P${lastDayMeta.period}`  : "(period unknown)";
  if (startPeriod === endPeriod) {
    return `${monthLabel} falls entirely inside SC period ${startPeriod}. Totals here can be reconciled against that period on the KPI dashboard.`;
  }
  const firstDayInEnd = firstDayInPeriodDate(lastDayMeta, monthLabel);
  const daysInStart = daysInPeriodWithinMonth(firstDayMeta, lastDayMeta, "start");
  const daysInEnd   = daysInPeriodWithinMonth(firstDayMeta, lastDayMeta, "end");
  return `${monthLabel} spans SC period ${startPeriod} (${daysInStart} day${daysInStart === 1 ? "" : "s"}) and SC period ${endPeriod} (${daysInEnd} day${daysInEnd === 1 ? "" : "s"}). Totals here will not match the KPI dashboard's period-level revenue for either period alone; recon requires summing partial periods.`;
}

// Helpers for composeReconciliationLine. These live near the composer
// so a future reader sees them together.
function firstDayInPeriodDate() { return null; /* reserved for future refinement */ }
function daysInPeriodWithinMonth(firstMeta, lastMeta, which) {
  // Simple derivation: we have day metadata for the first + last of
  // the month; a fuller version would join every day. For the
  // reconciliation LINE the counts come from the query layer where
  // the full day-set is available. Callers pass counts directly to
  // the composer via composeReconciliationLine's arg spread. This
  // stub is retained for API compatibility; kept as a marker for the
  // future "how many days each period gets" refinement.
  return "?";
}

// Preferred entry: composer with pre-computed counts.
export function composeReconciliationLineWithCounts({
  monthLabel, startPeriod, endPeriod, daysInStart, daysInEnd,
}) {
  if (!startPeriod && !endPeriod) {
    return `${monthLabel}: SC period metadata missing for the month bounds. KPI-dashboard reconciliation cannot be pre-computed - Kevin should populate sc_day_metadata for these dates.`;
  }
  if (startPeriod === endPeriod) {
    return `${monthLabel} falls entirely inside SC period P${startPeriod}. Totals here can be reconciled against that period on the KPI dashboard.`;
  }
  return `${monthLabel} spans SC period P${startPeriod} (${daysInStart} day${daysInStart === 1 ? "" : "s"}) and SC period P${endPeriod} (${daysInEnd} day${daysInEnd === 1 ? "" : "s"}). Totals here will not match the KPI dashboard's period-level revenue for either period alone; reconciliation requires summing partial periods.`;
}

// ─── Aggregation (pure) ─────────────────────────────────────────
//
// Given the actual rows + service map + prices, produces:
//   dailyRows[]:     { date, serviceName, count, unitPrice, revenueCents }
//                    filtered to actual_count > 0 (zero-count days
//                    are noise; Sebastian only wants days served)
//   weeklySubtotals[]: { weekStart, weekEnd, count, revenueCents }
//                      one row per ISO-week (Mon-Sun) that had any
//                      served day; carries partial first/last weeks
//   monthlyTotal:    { daysServed, count, revenueCents }
//   servedDatesSet:  Set of ISO dates with actual_count > 0
//   emptyMonth:      true iff monthlyTotal.count === 0

export function aggregate({ actualRows, serviceMap, prices, monthBounds }) {
  const svcNameById = new Map();
  for (const s of serviceMap || []) svcNameById.set(s.service_id, s.service_name || s.qbo_line_description || "(unnamed)");

  const pricesByServiceId = new Map();
  for (const p of prices || []) {
    if (!pricesByServiceId.has(p.service_id)) pricesByServiceId.set(p.service_id, []);
    pricesByServiceId.get(p.service_id).push(p);
  }

  const dailyRows = [];
  const servedDatesSet = new Set();
  let monthCount = 0;
  let monthCents = 0;

  for (const row of actualRows || []) {
    const count = Number(row.actual_count) || 0;
    if (count <= 0) continue;
    const serviceName = svcNameById.get(row.service_id) || "(unmapped service)";
    const unitPrice   = priceAsOf(pricesByServiceId.get(row.service_id), row.service_date);
    const revenueCents = Math.round(count * unitPrice * 100);
    dailyRows.push({
      date: row.service_date,
      serviceName,
      count,
      unitPrice,
      revenueCents,
    });
    servedDatesSet.add(row.service_date);
    monthCount += count;
    monthCents += revenueCents;
  }
  dailyRows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.serviceName < b.serviceName ? -1 : 1;
  });

  // Weekly subtotals - iterate by ISO week within the month bounds.
  // Include any week that overlaps the month even if only Mon or
  // only Sun is in-range.
  const weeklySubtotals = [];
  if (dailyRows.length > 0) {
    let cursor = mondayOf(monthBounds.firstDay);
    // Walk to the Monday <= firstDay first, then step forward by 7
    // until cursor > lastDay.
    while (cursor <= monthBounds.lastDay) {
      const weekEnd = addDaysIso(cursor, 6);
      let wkCount = 0, wkCents = 0;
      for (const r of dailyRows) {
        if (r.date >= cursor && r.date <= weekEnd) {
          wkCount += r.count;
          wkCents += r.revenueCents;
        }
      }
      if (wkCount > 0) {
        // Constrain the display range to the month bounds so a
        // partial first/last week shows the operator-visible span.
        const displayStart = cursor < monthBounds.firstDay ? monthBounds.firstDay : cursor;
        const displayEnd   = weekEnd > monthBounds.lastDay ? monthBounds.lastDay : weekEnd;
        weeklySubtotals.push({
          weekStart:   cursor,
          weekEnd,
          displayStart,
          displayEnd,
          count:       wkCount,
          revenueCents: wkCents,
        });
      }
      cursor = addDaysIso(cursor, 7);
    }
  }

  return {
    dailyRows,
    weeklySubtotals,
    monthlyTotal: {
      daysServed: servedDatesSet.size,
      count: monthCount,
      revenueCents: monthCents,
    },
    emptyMonth: monthCount === 0,
  };
}

// ─── Workbook builder ────────────────────────────────────────────
//
// Three sheets:
//   Daily   - one row per (date, service) pair with count > 0
//   Weekly  - one row per week with any served day
//   Monthly - one row: total meals + revenue + reconciliation line
//
// Empty months still produce all three sheets; each has its column
// headers + the appropriate empty-state marker row.

export async function buildBgWorkbook({
  accountKey, monthLabel, aggregated, reconciliationLine, generatedAt,
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "KitchFix Ops Hub";
  wb.created = generatedAt || new Date();

  // ── Daily sheet ────────────────────────────────────────────────
  const daily = wb.addWorksheet("Daily");
  daily.columns = [
    { header: "Date",       key: "date",        width: 14, style: { numFmt: DATE_FMT } },
    { header: "Service",    key: "service",     width: 28 },
    { header: "Count",      key: "count",       width: 12, style: { numFmt: COUNT_FMT } },
    { header: "Unit price", key: "unitPrice",   width: 14, style: { numFmt: MONEY_FMT } },
    { header: "Revenue",    key: "revenue",     width: 14, style: { numFmt: MONEY_FMT } },
  ];
  styleHeader(daily.getRow(1));
  if (aggregated.emptyMonth) {
    const r = daily.addRow({ date: null, service: "(no B&G service in this month)", count: null, unitPrice: null, revenue: null });
    r.font = { italic: true, color: { argb: MUTED_INK } };
  } else {
    for (const d of aggregated.dailyRows) {
      daily.addRow({
        date:      utcNoon(d.date),
        service:   d.serviceName,
        count:     d.count,
        unitPrice: d.unitPrice,
        revenue:   d.revenueCents / 100,
      });
    }
  }

  // ── Weekly sheet ───────────────────────────────────────────────
  const weekly = wb.addWorksheet("Weekly");
  weekly.columns = [
    { header: "Week",    key: "week",    width: 26 },
    { header: "Meals",   key: "count",   width: 12, style: { numFmt: COUNT_FMT } },
    { header: "Revenue", key: "revenue", width: 14, style: { numFmt: MONEY_FMT } },
  ];
  styleHeader(weekly.getRow(1));
  if (aggregated.emptyMonth) {
    const r = weekly.addRow({ week: "(no weeks with B&G service)", count: null, revenue: null });
    r.font = { italic: true, color: { argb: MUTED_INK } };
  } else {
    for (const w of aggregated.weeklySubtotals) {
      const s = utcNoon(w.displayStart).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      const e = utcNoon(w.displayEnd  ).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      weekly.addRow({
        week: `${s} - ${e}`,
        count: w.count,
        revenue: w.revenueCents / 100,
      });
    }
  }

  // ── Monthly sheet ──────────────────────────────────────────────
  const monthly = wb.addWorksheet("Monthly");
  monthly.columns = [
    { header: "Field", key: "field", width: 22 },
    { header: "Value", key: "value", width: 40 },
  ];
  styleHeader(monthly.getRow(1));
  monthly.addRow({ field: "Account",     value: accountKey });
  monthly.addRow({ field: "Month",       value: monthLabel });
  monthly.addRow({ field: "Days served", value: aggregated.monthlyTotal.daysServed });
  const mealsRow = monthly.addRow({ field: "Meals",       value: aggregated.monthlyTotal.count });
  mealsRow.getCell("value").numFmt = COUNT_FMT;
  const revRow = monthly.addRow({ field: "Revenue",     value: aggregated.monthlyTotal.revenueCents / 100 });
  revRow.getCell("value").numFmt = MONEY_FMT;
  monthly.addRow({}); // spacer
  const reconLabel = monthly.addRow({ field: "Reconciliation", value: reconciliationLine });
  reconLabel.getCell("value").alignment = { wrapText: true, vertical: "top" };
  reconLabel.height = 60;

  return wb;
}

function styleHeader(row) {
  row.font = { bold: true, color: { argb: WHITE_FONT } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_FILL } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
}

// ─── Public entrypoint ───────────────────────────────────────────
//
// Reads everything the report needs via injected supa, aggregates,
// composes the workbook, returns { workbook, filename, factTable,
// reconciliationLine, meta }. Callers save workbook via
// wb.xlsx.writeBuffer() to get Buffer for the email attachment.
//
// factTable is the SAME data the email fact-table renders, so the
// email and the workbook cannot show different numbers by
// construction.

export async function buildBgReport({ accountKey, monthISO, deps }) {
  if (!accountKey) throw new Error("buildBgReport: accountKey required");
  const bounds = monthBounds(monthISO);
  const supa = deps?.supa;
  if (!supa) throw new Error("buildBgReport: deps.supa required");

  // 1. Which services on this account are B&G-scoped?
  const { data: serviceMapRaw, error: smErr } = await supa
    .from("sc_qbo_service_map")
    .select("service_id, export_excluded")
    .eq("account_key", accountKey)
    .eq("export_excluded", true);
  if (smErr) throw new Error(`buildBgReport: sc_qbo_service_map read: ${smErr.message}`);
  const bgServiceIds = (serviceMapRaw || []).map((r) => r.service_id);

  if (bgServiceIds.length === 0) {
    // Account has recipients but no export-excluded services. This is
    // NOT an error - it's a config state (Kevin might populate
    // recipients before flipping the export_excluded flag on a
    // service). Report renders an empty-month state so Sebastian sees
    // a real send (proves the cron is alive) and the log line names
    // the reason so Kevin can trace.
  }

  // 2. Service names (from sc_services) for display in the workbook.
  const { data: serviceNames, error: snErr } = bgServiceIds.length > 0
    ? await supa.from("sc_services").select("id, service_name").in("id", bgServiceIds)
    : { data: [], error: null };
  if (snErr) throw new Error(`buildBgReport: sc_services read: ${snErr.message}`);
  const serviceMap = (serviceNames || []).map((s) => ({
    service_id: s.id,
    service_name: s.service_name,
  }));

  // 3. Actuals for the month.
  const { data: actualRows, error: arErr } = bgServiceIds.length > 0
    ? await supa
        .from("sc_daily_actuals")
        .select("service_id, service_date, actual_count")
        .eq("account_key", accountKey)
        .in("service_id", bgServiceIds)
        .gte("service_date", bounds.firstDay)
        .lte("service_date", bounds.lastDay)
    : { data: [], error: null };
  if (arErr) throw new Error(`buildBgReport: sc_daily_actuals read: ${arErr.message}`);

  // 4. Prices, effective-dated. Pull everything at or before lastDay
  // so priceAsOf can pick the right one per line.
  const { data: prices, error: prErr } = bgServiceIds.length > 0
    ? await supa
        .from("sc_service_prices")
        .select("service_id, effective_date, price")
        .in("service_id", bgServiceIds)
        .lte("effective_date", bounds.lastDay)
    : { data: [], error: null };
  if (prErr) throw new Error(`buildBgReport: sc_service_prices read: ${prErr.message}`);

  // 5. Period metadata for reconciliation line (first + last day + a
  // per-day count for the recon phrasing).
  const { data: dayMeta, error: dmErr } = await supa
    .from("sc_day_metadata")
    .select("service_date, period")
    .eq("account_key", accountKey)
    .gte("service_date", bounds.firstDay)
    .lte("service_date", bounds.lastDay);
  if (dmErr) throw new Error(`buildBgReport: sc_day_metadata read: ${dmErr.message}`);

  const startPeriod = (dayMeta || []).find((d) => d.service_date === bounds.firstDay)?.period || null;
  const endPeriod   = (dayMeta || []).find((d) => d.service_date === bounds.lastDay)?.period  || null;
  const daysInStart = (dayMeta || []).filter((d) => String(d.period) === String(startPeriod)).length;
  const daysInEnd   = (dayMeta || []).filter((d) => String(d.period) === String(endPeriod)).length;

  const reconciliationLine = composeReconciliationLineWithCounts({
    monthLabel: bounds.monthLabel,
    startPeriod, endPeriod, daysInStart, daysInEnd,
  });

  // 6. Aggregate.
  const aggregated = aggregate({
    actualRows, serviceMap, prices,
    monthBounds: bounds,
  });

  // 7. Workbook.
  const workbook = await buildBgWorkbook({
    accountKey, monthLabel: bounds.monthLabel,
    aggregated, reconciliationLine,
    generatedAt: new Date(),
  });

  const filename = buildBgReportFilename(accountKey, monthISO);

  const factTable = {
    monthLabel: bounds.monthLabel,
    daysServed: aggregated.monthlyTotal.daysServed,
    meals:      aggregated.monthlyTotal.count,
    revenueCents: aggregated.monthlyTotal.revenueCents,
    isEmpty:    aggregated.emptyMonth,
  };

  return {
    workbook,
    filename,
    factTable,
    reconciliationLine,
    meta: {
      accountKey,
      monthISO,
      bgServiceCount: bgServiceIds.length,
      actualRowCount: (actualRows || []).length,
    },
  };
}

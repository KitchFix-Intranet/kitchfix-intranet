import { auth } from "@/lib/auth";
import { readSheet, readSheetSA, appendRow, appendRows, appendRowSA, findRowByValue, updateCell, SHEET_IDS } from "@/lib/sheets";
import {
  handleInvoiceGet,
  handleInvoicePost,
  handleVendorList,
  handleVendorGet,
  handleVendorUpdate,
  handleVendorMasterUpdate,
  handleVendorDeactivate,
  handleVendorReactivate,
} from "@/lib/invoiceActions";
import { NextResponse } from "next/server";
import { logEvent } from "@/lib/analytics";

// ═══════════════════════════════════════
// OPS HUB API — v3.2
// Added: labor-bootstrap (pro-rating engine, variance, streaks, OT flags)
//        submit-labor-actuals
//        Invoice Capture (invoice-bootstrap, invoice-submit, vendor-add, etc.)
//        Vendor Portal (vendor-list, vendor-get, vendor-suggest, vendor-update, etc.)
// Architecture: OAuth session token
// Sheets: HUB (read-only config), COLLECTION (read/write data)
// ═══════════════════════════════════════

// Strip currency formatting from Sheets values ("$20,309.00" → 20309)
const parseNum = (v) => Number(String(v || 0).replace(/[$,]/g, '')) || 0;

const OPS_LEADERSHIP_EMAILS = [
  "k.fietek@kitchfix.com",
  "a.wasserman@kitchfix.com",
  "britt@kitchfix.com",
  "joe@kitchfix.com",
  "josh@kitchfix.com",
  "m.chavez@kitchfix.com",
  "s.lynch@kitchfix.com",
];

// Notification writer — matches People route format
// Columns: [timestamp, recipient, channel, subject, eventType, status, relatedInfo]
// Column H (read flag) left empty = unread
async function opsNotify(token, { recipient, subject, eventType, relatedInfo }) {
  const row = [
    new Date().toISOString(),
    recipient || "ALL",
    "bell",
    subject,
    eventType || "ops_info",
    "logged",
    relatedInfo || "",
  ];
  await appendRow(token, SHEET_IDS.COLLECTION, "notification_log", row).catch((e) => {
    console.warn("[OpsHub] notification_log write failed:", e.message);
  });
}

// ─── Simple email sender (uses user's OAuth token) ───
async function sendOpsEmail(token, { from, to, cc, subject, html }) {
  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: token });
    const gmail = google.gmail({ version: "v1", auth });

    const toStr = Array.isArray(to) ? to.join(", ") : to;
    const boundary = `boundary_${Date.now()}`;
    const lines = [
      `From: ${from}`,
      `To: ${toStr}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${subject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      ``,
      html,
    ];
    const raw = Buffer.from(lines.join("\r\n")).toString("base64url");
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    console.log(`[OpsHub] Email sent to ${toStr}: ${subject}`);
    return true;
  } catch (e) {
    console.error("[OpsHub] Email send failed:", e.message);
    return false;
  }
}

// ─── Date Helpers ───
function toDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T12:00:00");
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
  if (isoMatch) return new Date(isoMatch[1] + "T12:00:00");
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00`);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function fmtDate(d) {
  return d ? d.toISOString().split("T")[0] : "";
}
function dayOfWeek(d) {
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()];
}
function getMondayOfWeek(d) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return fmtDate(dt);
}

// ═══════════════════════════════════════
// LABOR ENGINE — Budget Pro-Rating & Variance
// ═══════════════════════════════════════

function buildLaborContext(scheduleRows, budgetRows, planRows, cleanRows, periodRows, accountKey, soldRevenueRows) {
  const REVENUE_FLEX_ACCOUNTS = ["TXR - TX - V"];
  const isRevenueFlex = REVENUE_FLEX_ACCOUNTS.includes(accountKey);
  function normDate(v) {
    if (!v) return "";
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
    if (isoMatch) return isoMatch[1];
    const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, m, d, y] = slashMatch;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const num = Number(s);
    if (!isNaN(num) && num > 40000 && num < 60000) {
      const epoch = new Date(1899, 11, 30);
      epoch.setDate(epoch.getDate() + num);
      return epoch.toISOString().split("T")[0];
    }
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    } catch {}
    return "";
  }

  const schedule = scheduleRows
    .filter((r) => String(r[0]).trim() === accountKey)
    .map((r) => ({
      account: String(r[0]).trim(),
      date: normDate(r[1]),
      dayOfWeek: String(r[2] || "").trim(),
      dayType: String(r[3]).trim().toUpperCase(),
      opponent: String(r[4] || "").trim(),
      homestandId: String(r[5]).trim(),
    }));

  const budgets = budgetRows
    .filter((r) => String(r[0]).trim() === accountKey)
    .map((r) => ({
      period: String(r[1]).trim(),
      hourlyBudget: Number(r[2]) || 0,
      salaryBudget: Number(r[3]) || 0,
      revenue: Number(r[4]) || 0,
      foodBudget: Number(r[5]) || 0,
      packagingBudget: Number(r[6]) || 0,
    }));

  const plans = planRows
    .filter((r) => String(r[3]).trim() === accountKey)
    .map((r) => ({
      planId: String(r[0]),
      timestamp: String(r[1]),
      email: String(r[2]),
      homestandId: String(r[4]).trim(),
      budgetEnvelope: Number(r[5]) || 0,
      carryForward: Number(r[6]) || 0,
      actualSpent: Number(r[7]) || 0,
      variance: Number(r[8]) || 0,
      cumulativeVariance: Number(r[9]) || 0,
      streakCount: Number(r[10]) || 0,
      notes: String(r[11] || ""),
      revenueActual: Number(r[12]) || 0,
      actualFood: Number(r[13]) || 0,
      actualPackaging: Number(r[14]) || 0,
    }));

  const cleanDays = cleanRows
    .filter((r) => String(r[0]).trim() === accountKey)
    .map((r) => ({
      date: normDate(r[1]),
      addedBy: String(r[2] || ""),
    }));

  const soldRevenueMap = {};
  if (isRevenueFlex && soldRevenueRows) {
    for (const r of soldRevenueRows) {
      if (String(r[0]).trim() === accountKey) {
        const hsId = String(r[1]).trim();
        soldRevenueMap[hsId] = {
          soldRevenue: Number(r[2]) || 0,
          enteredBy: String(r[3] || ""),
          enteredAt: String(r[4] || ""),
        };
      }
    }
  }

  for (const cd of cleanDays) {
    if (!schedule.some((s) => s.date === cd.date)) {
      const d = toDate(cd.date);
      schedule.push({
        account: accountKey,
        date: cd.date,
        dayOfWeek: d ? dayOfWeek(d) : "",
        dayType: "CLEAN",
        opponent: "",
        homestandId: "CLEAN",
      });
    }
  }

  schedule.sort((a, b) => a.date.localeCompare(b.date));

  const periods = periodRows
    .filter((r) => r[0])
    .map((r) => ({
      name: String(r[0]).trim(),
      start: normDate(r[1]),
      end: normDate(r[2]),
      due: normDate(r[3]),
    }));

  function getPeriodForDate(dateStr) {
    for (const p of periods) {
      if (dateStr >= p.start && dateStr <= p.end) return p.name;
    }
    return null;
  }

  const workingDaysPerPeriod = {};
  for (const day of schedule) {
    const p = getPeriodForDate(day.date);
    if (p) workingDaysPerPeriod[p] = (workingDaysPerPeriod[p] || 0) + 1;
  }

  const dailyRates = {};
  for (const b of budgets) {
    const wd = workingDaysPerPeriod[b.period] || 1;
    dailyRates[b.period] = b.hourlyBudget / wd;
  }

  const hsGroups = {};
  for (const day of schedule) {
    if (!hsGroups[day.homestandId]) hsGroups[day.homestandId] = [];
    hsGroups[day.homestandId].push(day);
  }

  const hsOrder = [];
  const seen = new Set();
  for (const day of schedule) {
    if (!seen.has(day.homestandId)) {
      seen.add(day.homestandId);
      hsOrder.push(day.homestandId);
    }
  }

  const today = fmtDate(new Date());
  const homestands = [];

  for (const hsId of hsOrder) {
    if (hsId === "CLEAN") continue;
    const days = hsGroups[hsId];
    if (!days || days.length === 0) continue;

    const startDate = days[0].date;
    const endDate = days[days.length - 1].date;
    const gameDays = days.filter((d) => d.dayType === "GAME");
    const prepDays = days.filter((d) => d.dayType === "PREP");
    const openDays = days.filter((d) => d.dayType === "OPEN");
    const closeDays = days.filter((d) => d.dayType === "CLOSE");
    const cleanDaysInHS = days.filter((d) => d.dayType === "CLEAN");
    const opponents = [...new Set(gameDays.map((d) => d.opponent).filter(Boolean))];

    let budgetEnvelope = 0;
    const budgetBreakdown = [];
    const periodsTouched = new Set();

    for (const day of days) {
      const p = getPeriodForDate(day.date);
      if (p && dailyRates[p]) {
        budgetEnvelope += dailyRates[p];
        periodsTouched.add(p);
      }
    }

    for (const pName of periodsTouched) {
      const daysInPeriod = days.filter((d) => getPeriodForDate(d.date) === pName).length;
      const rate = dailyRates[pName] || 0;
      const budget = budgets.find((b) => b.period === pName);
      budgetBreakdown.push({
        period: pName,
        dailyRate: Math.round(rate),
        days: daysInPeriod,
        subtotal: Math.round(rate * daysInPeriod),
        periodBudget: budget?.hourlyBudget || 0,
        workingDaysInPeriod: workingDaysPerPeriod[pName] || 0,
      });
    }

    budgetEnvelope = Math.round(budgetEnvelope);

    // ── OT Exposure: full week-by-week breakdown (Mon–Sun payroll weeks) ──
    const weekDetailMap = {};
    for (const day of days) {
      const d = toDate(day.date);
      if (!d) continue;
      const weekKey = getMondayOfWeek(d);
      if (!weekDetailMap[weekKey]) {
        const mon = toDate(weekKey);
        const sun = new Date(mon);
        sun.setDate(sun.getDate() + 6);
        weekDetailMap[weekKey] = {
          weekOf: weekKey,
          sunday: fmtDate(sun),
          workingDays: 0,
          slots: [null, null, null, null, null, null, null], // Mon(0)..Sun(6)
        };
      }
      const dayIdx = d.getDay() === 0 ? 6 : d.getDay() - 1; // Mon=0..Sun=6
      weekDetailMap[weekKey].slots[dayIdx] = day.dayType;
      weekDetailMap[weekKey].workingDays++;
    }
    const allWeeks = Object.values(weekDetailMap).sort((a, b) => a.weekOf.localeCompare(b.weekOf));
    const otExposure = allWeeks.some((w) => w.workingDays >= 5);
    const otWeeks = allWeeks.filter((w) => w.workingDays >= 5);
    const otWeekCount = otWeeks.length;
    const payrollWeekCount = allWeeks.length;
    const hasPayrollRelief = payrollWeekCount > 1 && !allWeeks.every((w) => w.workingDays >= 5);

    let hsRevenue = 0;
    let hsFoodBudget = 0;
    let hsPackagingBudget = 0;
    for (const day of days) {
      const p = getPeriodForDate(day.date);
      if (p) {
        const budget = budgets.find((b) => b.period === p);
        if (budget && workingDaysPerPeriod[p]) {
          hsRevenue += budget.revenue / workingDaysPerPeriod[p];
          hsFoodBudget += (budget.foodBudget || 0) / workingDaysPerPeriod[p];
          hsPackagingBudget += (budget.packagingBudget || 0) / workingDaysPerPeriod[p];
        }
      }
    }

    const plan = plans.filter((pl) => pl.homestandId === hsId).pop();
    let status = "upcoming";
    if (plan) {
      status = "completed";
    } else if (endDate < today) {
      status = "actuals_due";
    } else if (startDate <= today && endDate >= today) {
      status = "in_progress";
    }

    let laborRatio = 0;
    let forecastedRevenue = Math.round(hsRevenue);
    let soldRevEntry = soldRevenueMap[hsId] || null;
    let adjustedEnvelope = null;

    if (isRevenueFlex && forecastedRevenue > 0) {
      laborRatio = Math.round((budgetEnvelope / forecastedRevenue) * 10000) / 10000;
      if (soldRevEntry) {
        adjustedEnvelope = Math.round(soldRevEntry.soldRevenue * laborRatio);
      }
    }

    homestands.push({
      id: hsId,
      startDate,
      endDate,
      totalDays: days.length,
      gameDays: gameDays.length,
      prepDays: prepDays.length,
      openDays: openDays.length,
      closeDays: closeDays.length,
      cleanDays: cleanDaysInHS.length,
      opponents,
      budgetEnvelope,
      hourlyBudget: budgetEnvelope,
      foodBudget: Math.round(hsFoodBudget),
      packagingBudget: Math.round(hsPackagingBudget),
      budgetBreakdown,
      periodsTouched: [...periodsTouched],
      revenue: forecastedRevenue,
      laborRatio,
      soldRevenue: soldRevEntry ? soldRevEntry.soldRevenue : null,
      adjustedEnvelope,
      isRevenueFlex,
      otExposure,
      otWeeks,
      otWeekCount,
      allWeeks,
      payrollWeekCount,
      hasPayrollRelief,
      status,
      plan: plan || null,
      days: days.map((d) => ({
        date: d.date,
        dayOfWeek: d.dayOfWeek,
        dayType: d.dayType,
        opponent: d.opponent,
        period: getPeriodForDate(d.date),
      })),
    });
  }

  let cumulativeVariance = 0;
  let currentStreak = 0;
  let completedCount = 0;
  const seasonBudgetTotal = budgets.reduce((sum, b) => sum + b.hourlyBudget, 0);
  let budgetUsed = 0;
  let budgetExpectedAtThisPoint = 0;
  let foodActualTotal = 0;
  let packagingActualTotal = 0;
  let revenueActualTotal = 0;

  for (const hs of homestands) {
    if (hs.plan) {
      completedCount++;
      budgetUsed += hs.plan.actualSpent;
      foodActualTotal += hs.plan.actualFood || 0;
      packagingActualTotal += hs.plan.actualPackaging || 0;
      revenueActualTotal += hs.plan.revenueActual || 0;

      let hsVar;
      const ra = hs.plan.revenueActual || 0;
      const rf = hs.revenue || 0;
      if (ra > 0 && rf > 0) {
        const ratio = ra / rf;
        const lt = Math.round(hs.hourlyBudget * ratio);
        const ft = Math.round(hs.foodBudget * ratio);
        const pt = Math.round(hs.packagingBudget * ratio);
        hsVar = (lt + ft + pt) - (hs.plan.actualSpent + (hs.plan.actualFood || 0) + (hs.plan.actualPackaging || 0));
      } else {
        hsVar = hs.plan.variance;
      }
      cumulativeVariance += hsVar;

      if (hsVar >= 0) {
        currentStreak++;
      } else {
        currentStreak = 0;
      }
    }
    if (hs.status !== "upcoming") {
      budgetExpectedAtThisPoint += hs.budgetEnvelope;
    }
  }

  const seasonMetrics = {
    cumulativeVariance,
    currentStreak,
    completedCount,
    totalHomestands: homestands.length,
    seasonBudgetTotal: Math.round(seasonBudgetTotal),
    seasonSalaryTotal: Math.round(budgets.reduce((sum, b) => sum + b.salaryBudget, 0)),
    budgetUsed: Math.round(budgetUsed),
    budgetRemaining: Math.round(seasonBudgetTotal - budgetUsed),
    budgetExpectedAtThisPoint: Math.round(budgetExpectedAtThisPoint),
    seasonRevenue: budgets.reduce((sum, b) => sum + b.revenue, 0),
    revenueActualTotal: Math.round(revenueActualTotal),
    totalFoodBudget: budgets.reduce((sum, b) => sum + b.foodBudget, 0),
    totalPackagingBudget: budgets.reduce((sum, b) => sum + b.packagingBudget, 0),
    foodActualTotal: Math.round(foodActualTotal),
    packagingActualTotal: Math.round(packagingActualTotal),
  };

  const periodSummary = budgets
    .filter((b) => b.hourlyBudget > 0)
    .map((b) => {
      const touchingHS = homestands.filter((hs) => hs.periodsTouched.includes(b.period));
      const planned = touchingHS.reduce((sum, hs) => {
        const totalHsDays = hs.totalDays;
        const daysInThisPeriod = hs.days.filter((d) => d.period === b.period).length;
        const ratio = totalHsDays > 0 ? daysInThisPeriod / totalHsDays : 0;
        return sum + (hs.plan ? hs.plan.actualSpent * ratio : 0);
      }, 0);

      return {
        period: b.period,
        budget: b.hourlyBudget,
        salary: 0,
        revenue: b.revenue,
        workingDays: workingDaysPerPeriod[b.period] || 0,
        dailyRate: Math.round(dailyRates[b.period] || 0),
        homestands: touchingHS.map((hs) => hs.id),
        actualAllocated: Math.round(planned),
        variance: Math.round(b.hourlyBudget - planned),
      };
    });

  return { homestands, seasonMetrics, periodSummary, cleanDays, periods, budgets, isRevenueFlex };
}


// ═══════════════════════════════════════
// PDC LABOR ENGINE — Period-Based Tracking
// ═══════════════════════════════════════

function buildPDCContext(budgetRows, planRows, periodRows, accountKey) {
  function normDate(v) {
    if (!v) return "";
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})[T ]/);
    if (isoMatch) return isoMatch[1];
    const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slashMatch) {
      const [, m, d, y] = slashMatch;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const num = Number(s);
    if (!isNaN(num) && num > 40000 && num < 60000) {
      const epoch = new Date(1899, 11, 30);
      epoch.setDate(epoch.getDate() + num);
      return epoch.toISOString().split("T")[0];
    }
    try { const d = new Date(s); if (!isNaN(d.getTime())) return d.toISOString().split("T")[0]; } catch {}
    return "";
  }

  const budgets = budgetRows
    .filter((r) => String(r[0]).trim() === accountKey)
    .map((r) => ({
      period: String(r[1]).trim(),
      hourlyBudget: Number(r[2]) || 0,
      salaryBudget: Number(r[3]) || 0,
      revenue: Number(r[4]) || 0,
      foodBudget: Number(r[5]) || 0,
      packagingBudget: Number(r[6]) || 0,
    }));

  const periods = periodRows
    .filter((r) => r[0])
    .map((r) => ({
      name: String(r[0]).trim(),
      start: normDate(r[1]),
      end: normDate(r[2]),
      due: normDate(r[3]),
    }));

  const plans = planRows
    .filter((r) => String(r[3]).trim() === accountKey)
    .map((r) => ({
      planId: String(r[0]),
      timestamp: String(r[1]),
      email: String(r[2]),
      homestandId: String(r[4]).trim(),
      budgetEnvelope: Number(r[5]) || 0,
      carryForward: Number(r[6]) || 0,
      actualSpent: Number(r[7]) || 0,
      variance: Number(r[8]) || 0,
      cumulativeVariance: Number(r[9]) || 0,
      streakCount: Number(r[10]) || 0,
      notes: String(r[11] || ""),
      revenueActual: Number(r[12]) || 0,
      actualFood: Number(r[13]) || 0,
      actualPackaging: Number(r[14]) || 0,
    }));

  const today = fmtDate(new Date());
  const periodCards = [];
  const PEAK_PERIODS = ["P2", "P3"];

  for (const budget of budgets) {
    const periodInfo = periods.find((p) => p.name === budget.period);
    if (!periodInfo) continue;

    const startDate = periodInfo.start;
    const endDate = periodInfo.end;
    const dueDate = periodInfo.due;

    const start = toDate(startDate);
    const end = toDate(endDate);
    let calendarDays = 28;
    if (start && end) {
      calendarDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    }

    const dailyRate = calendarDays > 0 ? budget.hourlyBudget / calendarDays : 0;
    const weeksInPeriod = Math.max(1, Math.ceil(calendarDays / 7));
    const isPeakSeason = PEAK_PERIODS.includes(budget.period);
    const isMaintenance = budget.hourlyBudget === 0 && budget.foodBudget === 0 && budget.packagingBudget === 0 && budget.revenue === 0;

    const plan = plans.filter((pl) => pl.homestandId === budget.period).pop();
    let status = "upcoming";
    if (plan) {
      status = "completed";
    } else if (endDate < today) {
      status = "actuals_due";
    } else if (startDate <= today && endDate >= today) {
      status = "in_progress";
    }

    periodCards.push({
      id: budget.period,
      startDate,
      endDate,
      dueDate,
      calendarDays,
      weeksInPeriod,
      hourlyBudget: Math.round(budget.hourlyBudget),
      foodBudget: Math.round(budget.foodBudget),
      packagingBudget: Math.round(budget.packagingBudget),
      revenue: Math.round(budget.revenue),
      dailyRate: Math.round(dailyRate),
      isPeakSeason,
      isMaintenance,
      status,
      plan: plan || null,
    });
  }

  let cumulativeVariance = 0;
  let currentStreak = 0;
  let completedCount = 0;
  const seasonBudgetTotal = budgets.reduce((sum, b) => sum + b.hourlyBudget, 0);
  let budgetUsed = 0;
  let revenueActualTotal = 0;
  let foodActualTotal = 0;
  let packagingActualTotal = 0;

  function calcPeriodVariance(pc) {
    if (!pc.plan) return { variance: 0, laborVar: 0, foodVar: 0, packVar: 0 };
    const revActual = pc.plan.revenueActual || 0;
    const revForecast = pc.revenue;
    if (revActual > 0 && revForecast > 0) {
      const ratio = revActual / revForecast;
      const laborTarget = Math.round(pc.hourlyBudget * ratio);
      const foodTarget = Math.round(pc.foodBudget * ratio);
      const packTarget = Math.round(pc.packagingBudget * ratio);
      const laborVar = laborTarget - pc.plan.actualSpent;
      const foodVar = foodTarget - (pc.plan.actualFood || 0);
      const packVar = packTarget - (pc.plan.actualPackaging || 0);
      return { variance: laborVar + foodVar + packVar, laborVar, foodVar, packVar };
    }
    return { variance: pc.plan.variance, laborVar: pc.plan.variance, foodVar: 0, packVar: 0 };
  }

  for (const pc of periodCards) {
    if (pc.plan) {
      completedCount++;
      const pv = calcPeriodVariance(pc);
      cumulativeVariance += pv.variance;
      budgetUsed += pc.plan.actualSpent;
      revenueActualTotal += pc.plan.revenueActual || 0;
      foodActualTotal += pc.plan.actualFood || 0;
      packagingActualTotal += pc.plan.actualPackaging || 0;
      if (pv.variance >= 0) currentStreak++;
      else currentStreak = 0;
    }
  }

  const totalFoodBudget = budgets.reduce((sum, b) => sum + b.foodBudget, 0);
  const totalPackagingBudget = budgets.reduce((sum, b) => sum + b.packagingBudget, 0);
  const totalSalaryBudget = budgets.reduce((sum, b) => sum + b.salaryBudget, 0);

  const seasonMetrics = {
    cumulativeVariance,
    currentStreak,
    completedCount,
    totalHomestands: periodCards.length,
    seasonBudgetTotal: Math.round(seasonBudgetTotal),
    seasonSalaryTotal: Math.round(totalSalaryBudget),
    budgetUsed: Math.round(budgetUsed),
    budgetRemaining: Math.round(seasonBudgetTotal - budgetUsed),
    seasonRevenue: budgets.reduce((sum, b) => sum + b.revenue, 0),
    revenueActualTotal: Math.round(revenueActualTotal),
    totalFoodBudget: Math.round(totalFoodBudget),
    totalPackagingBudget: Math.round(totalPackagingBudget),
    foodActualTotal: Math.round(foodActualTotal),
    packagingActualTotal: Math.round(packagingActualTotal),
  };

  const periodSummary = budgets.map((b) => {
    const plan = plans.filter((p) => p.homestandId === b.period).pop();
    const pc = periodCards.find((p) => p.id === b.period);
    const pv = pc ? calcPeriodVariance(pc) : { variance: 0, laborVar: 0, foodVar: 0, packVar: 0 };
    return {
      period: b.period,
      budget: Math.round(b.hourlyBudget),
      foodBudget: Math.round(b.foodBudget),
      packagingBudget: Math.round(b.packagingBudget),
      revenue: Math.round(b.revenue),
      revenueActual: plan ? plan.revenueActual : 0,
      workingDays: pc?.calendarDays || 0,
      dailyRate: pc?.dailyRate || 0,
      homestands: [b.period],
      actualLabor: Math.round(plan?.actualSpent || 0),
      actualFood: Math.round(plan?.actualFood || 0),
      actualPackaging: Math.round(plan?.actualPackaging || 0),
      variance: Math.round(pv.variance),
      laborVar: Math.round(pv.laborVar),
      foodVar: Math.round(pv.foodVar),
      packVar: Math.round(pv.packVar),
    };
  });

  return { periodCards, seasonMetrics, periodSummary, periods, budgets, isPDC: true };
}


// ═══════════════════════════════════════
// GET HANDLER
// ═══════════════════════════════════════
export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const token = session.accessToken;
  if (!token) return NextResponse.json({ error: "No access token" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const email = session.user?.email?.toLowerCase().trim();

  const safeRead = async (id, tab) => {
try { return await readSheetSA(id, tab); }
    catch (e) { console.warn(`[OpsHub] Sheet "${tab}" error:`, e.message); return { headers: [], rows: [] }; }
  };

  try {
if (action === "bootstrap") {
       logEvent(token, { email, category: "ops", action: "page_view", page: "/ops" });
       const [accountsRaw, periodsRaw, heroRaw, inventoryRaw, budgetsRaw] = await Promise.all([
                safeRead(SHEET_IDS.HUB, "accounts"),
        safeRead(SHEET_IDS.HUB, "period_data"),
        safeRead(SHEET_IDS.HUB, "hero_images"),
        safeRead(SHEET_IDS.COLLECTION, "inventory_submissions"),
        safeRead(SHEET_IDS.HUB, "labor_budgets"),
      ]);

      // Build active period map from budget data
      const activePeriodMap = {};
      for (const r of budgetsRaw.rows) {
        const key = String(r[0] || "").trim();
        const period = String(r[1] || "").trim();
        const revenue = Number(r[4]) || 0;
        const hourly = Number(r[2]) || 0;
        const food = Number(r[5]) || 0;
        const pack = Number(r[6]) || 0;
        if (!key || !period) continue;
const salary = Number(r[3]) || 0;
        if (revenue > 0 || hourly > 0 || salary > 0 || food > 0 || pack > 0) {
                    if (!activePeriodMap[key]) activePeriodMap[key] = [];
          activePeriodMap[key].push(period);
        }
      }

const accounts = accountsRaw.rows
        .filter((r) => r[0])
        .map((r) => {
          const key = String(r[0]).trim();
          const level = r[2] ? String(r[2]).trim().toUpperCase() : "";
          const activePeriods = activePeriodMap[key] || [];
          // MLB/MiLB: include P3 for opening inventory even if no labor budget exists
          if ((level === "MLB" || level === "MILB" || level === "AAA") && !activePeriods.includes("P3")) {
            activePeriods.push("P3");
            activePeriods.sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
          }
          return {
            key,
            name: r[1] ? String(r[1]).trim() : "",
            label: r[1] ? `${key} - ${String(r[1]).trim()}` : key,
            level,
            activePeriods,
          };
        });

      const now = new Date();
      const periods = periodsRaw.rows
        .filter((r) => r[0])
        .map((r) => ({
          name: String(r[0]),
          start: r[1] || null,
          end: r[2] || null,
          due: r[3] || null,
        }));

let currentPeriod = null;
      for (const p of periods) {
        if (!p.start || !p.end) continue;
        const start = new Date(p.start);
        const end = new Date(p.end);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        if (now >= start && now <= end) { currentPeriod = p; break; }
      }
      
      const heroUrls = heroRaw.rows.flat().filter((u) => u && String(u).includes("http"));
      const heroImage = heroUrls.length ? heroUrls[Math.floor(Math.random() * heroUrls.length)] : "";

const inventoryLog = inventoryRaw.rows.map((r) => ({
        account: String(r[3] || ""),
        period: String(r[4] || ""),
        date: r[5] || null,
        food: parseNum(r[6]),
        packaging: parseNum(r[7]),
        supplies: parseNum(r[8]),
        snacks: parseNum(r[9]),
        beverages: parseNum(r[10]),
        total: parseNum(r[11]),
        email: String(r[2] || "").toLowerCase().trim(),
        notes: String(r[12] || ""),
      }));

      return NextResponse.json({
        success: true,
        email,
        firstName: session.user?.name?.split(" ")[0] || "Chef",
        isAdmin: OPS_LEADERSHIP_EMAILS.includes(email),
        accounts, periods, currentPeriod, heroImage, inventoryLog,
      });
    }

    if (action === "inventory-history") {
      const { rows } = await safeRead(SHEET_IDS.COLLECTION, "inventory_submissions");
const history = rows
.filter(() => true)
        .map((r, i) => ({
          id: i, account: String(r[3] || ""), period: String(r[4] || ""),
          date: r[5] || "", food: parseNum(r[6]), packaging: parseNum(r[7]),
          supplies: parseNum(r[8]), snacks: parseNum(r[9]),
          beverages: parseNum(r[10]), total: parseNum(r[11]),
          notes: String(r[12] || ""),
        }))
        .reverse().slice(0, 25);
              return NextResponse.json({ success: true, history });
    }

    if (action === "labor-bootstrap") {
      const acctParam = searchParams.get("account");

      const [accountsRaw, periodsRaw, scheduleRaw, budgetsRaw, plansRaw, cleanRaw, soldRevRaw] = await Promise.all([
        safeRead(SHEET_IDS.HUB, "accounts"),
        safeRead(SHEET_IDS.HUB, "period_data"),
        safeRead(SHEET_IDS.HUB, "homestand_schedule"),
        safeRead(SHEET_IDS.HUB, "labor_budgets"),
        safeRead(SHEET_IDS.COLLECTION, "labor_plans"),
        safeRead(SHEET_IDS.COLLECTION, "deep_clean_days"),
        safeRead(SHEET_IDS.COLLECTION, "labor_sold_revenue"),
      ]);

      const accounts = accountsRaw.rows
        .filter((r) => r[0])
        .map((r) => ({
          key: String(r[0]).trim(),
          name: r[1] ? String(r[1]).trim() : "",
          label: r[1] ? `${String(r[0]).trim()} - ${String(r[1]).trim()}` : String(r[0]).trim(),
          level: r[2] ? String(r[2]).trim().toUpperCase() : "MLB",
        }));

      const mlbAccounts = accounts.filter((a) => a.level === "MLB");
      const pdcAccounts = accounts.filter((a) => a.level === "PDC");
      const milbAccounts = accounts.filter((a) => a.level === "MILB" || a.level === "AAA");
      const laborAccounts = accounts.filter((a) => ["MLB", "PDC", "MILB", "AAA"].includes(a.level));

      const viewParam = searchParams.get("view") || "dashboard";

      let laborData = null;
      let plannerData = null;
      if (acctParam) {
        const acctInfo = accounts.find((a) => a.key === acctParam);
        const acctLevel = acctInfo?.level || "MLB";
        const isMlbLevel = acctLevel === "MLB";
        const isMilbLevel = acctLevel === "MILB" || acctLevel === "AAA";
        const isSeasonalAcct = isMlbLevel || isMilbLevel;

        laborData = buildPDCContext(
          budgetsRaw.rows, plansRaw.rows, periodsRaw.rows, acctParam
        );

        const isRevenueFixed = isSeasonalAcct && acctParam !== "TXR - TX - V";
        const hasHourlyLabor = !isMilbLevel;
        laborData.accountFlags = {
          level: acctLevel,
          isSeasonal: isSeasonalAcct,
          isRevenueFixed,
          hasHourlyLabor,
          hasHomestandPlanner: isMlbLevel,
        };

        if (isMlbLevel && (viewParam === "planner" || viewParam === "snapshot")) {
          plannerData = buildLaborContext(
            scheduleRaw.rows, budgetsRaw.rows, plansRaw.rows,
            cleanRaw.rows, periodsRaw.rows, acctParam, soldRevRaw.rows
          );
        }
      }

      const crossAccount = laborAccounts.map((acct) => {
        const ctx = buildPDCContext(budgetsRaw.rows, plansRaw.rows, periodsRaw.rows, acct.key);

        let nextItem = null;
        const nextPC = ctx.periodCards.find((pc) =>
          pc.status === "upcoming" || pc.status === "in_progress" || pc.status === "actuals_due"
        );
        if (nextPC) {
          nextItem = {
            id: nextPC.id,
            dates: `${nextPC.startDate} – ${nextPC.endDate}`,
            opponents: [],
            status: nextPC.status,
          };
        }

        const periodData = (ctx.periodSummary || []).map((ps) => {
          const matchingBudget = ctx.budgets.find(b => b.period === ps.period);
          return {
            period: ps.period,
            laborBudget: ps.budget,
            laborActual: ps.actualLabor,
            salaryBudget: matchingBudget ? Math.round(matchingBudget.salaryBudget) : 0,
            foodBudget: ps.foodBudget,
            foodActual: ps.actualFood,
            packBudget: ps.packagingBudget,
            packActual: ps.actualPackaging,
            revenueBudget: ps.revenue,
            revenueActual: ps.revenueActual,
            variance: ps.variance,
            laborVar: ps.laborVar,
            foodVar: ps.foodVar,
            packVar: ps.packVar,
            totalBudget: ps.budget + ps.foodBudget + ps.packagingBudget,
            totalActual: ps.actualLabor + ps.actualFood + ps.actualPackaging,
            completed: ps.actualLabor > 0 || ps.actualFood > 0,
            days: ps.workingDays,
          };
        });

        const totalCostBudget = ctx.seasonMetrics.seasonBudgetTotal + ctx.seasonMetrics.totalFoodBudget + ctx.seasonMetrics.totalPackagingBudget;
        const totalCostActual = (ctx.seasonMetrics.budgetUsed || 0) + (ctx.seasonMetrics.foodActualTotal || 0) + (ctx.seasonMetrics.packagingActualTotal || 0);
        const revActual = ctx.seasonMetrics.revenueActualTotal || 0;
        const grossMarginPct = revActual > 0 ? ((revActual - totalCostActual) / revActual * 100) : null;
        const grossMarginBudgetPct = ctx.seasonMetrics.seasonRevenue > 0 ? ((ctx.seasonMetrics.seasonRevenue - totalCostBudget) / ctx.seasonMetrics.seasonRevenue * 100) : null;

        return {
          key: acct.key,
          name: acct.name,
          label: acct.label,
          level: acct.level,
          streak: ctx.seasonMetrics.currentStreak,
          cumulativeVariance: ctx.seasonMetrics.cumulativeVariance,
          completed: ctx.seasonMetrics.completedCount,
          total: ctx.seasonMetrics.totalHomestands,
          seasonBudget: ctx.seasonMetrics.seasonBudgetTotal,
          seasonRevenue: ctx.seasonMetrics.seasonRevenue,
          revenueActualTotal: ctx.seasonMetrics.revenueActualTotal || 0,
          budgetUsed: ctx.seasonMetrics.budgetUsed || 0,
          salaryBudget: ctx.seasonMetrics.seasonSalaryTotal || 0,
          totalFoodBudget: ctx.seasonMetrics.totalFoodBudget || 0,
          totalPackagingBudget: ctx.seasonMetrics.totalPackagingBudget || 0,
          foodActualTotal: ctx.seasonMetrics.foodActualTotal || 0,
          packagingActualTotal: ctx.seasonMetrics.packagingActualTotal || 0,
          totalCostBudget,
          totalCostActual,
          grossMarginPct: grossMarginPct !== null ? Math.round(grossMarginPct * 10) / 10 : null,
          grossMarginBudgetPct: grossMarginBudgetPct !== null ? Math.round(grossMarginBudgetPct * 10) / 10 : null,
          nextHomestand: nextItem,
          periodData,
        };
      });

      const isAdmin = OPS_LEADERSHIP_EMAILS.includes(email);

      return NextResponse.json({
        success: true,
        email,
        isAdmin,
        firstName: session.user?.name?.split(" ")[0] || "Chef",
        mlbAccounts,
        pdcAccounts,
        milbAccounts,
        laborAccounts,
        laborData,
        plannerData,
        crossAccount,
      });
    }

    // ── Invoice Actions (GET) ──
    if (["invoice-bootstrap", "vendor-search", "invoice-history"].includes(action)) {
      const result = await handleInvoiceGet(action, searchParams, token, email);
      if (result) return NextResponse.json(result);
    }

    // ── Vendor Portal (GET) ──
    if (action === "vendor-list")              return NextResponse.json(await handleVendorList(searchParams, token, email));
    if (action === "vendor-get")               return NextResponse.json(await handleVendorGet(searchParams, token, email));

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[OpsHub GET]", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// ═══════════════════════════════════════
// POST HANDLER
// ═══════════════════════════════════════
export async function POST(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const token = session.accessToken;
  if (!token) return NextResponse.json({ error: "No access token" }, { status: 400 });

  const body = await request.json();
  const { action } = body;
  const email = session.user?.email?.toLowerCase().trim();
  const userName = session.user?.name || "Team Member";

  try {
    if (action === "submit-inventory") {
      const { account, period, food, packaging, supplies, snacks, beverages, total, notes } = body;
      const uuid = crypto.randomUUID();
      const now = new Date();
      const row = [
        uuid, now.toISOString(), email, account, period,
        now.toISOString().split("T")[0],
        Number(food) || 0, Number(packaging) || 0, Number(supplies) || 0,
        Number(snacks) || 0, Number(beverages) || 0, Number(total) || 0,
        String(notes || ""),
      ];
const result = await appendRowSA(SHEET_IDS.COLLECTION, "inventory_submissions", row);

       logEvent(token, { email, userName, category: "ops", action: "submit_inventory", page: "/ops", detail: { account, period, total: Number(total) || 0 } });

       if (result.success) {
const fmt = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v) || 0);
        const totalFmt = fmt(total);
        const foodFmt = fmt(food);
        const pkgFmt = fmt(packaging);
        const supFmt = fmt(supplies);
        const snkFmt = fmt(snacks);
        const bevFmt = fmt(beverages);

        // Bell notification to submitter
        await opsNotify(token, {
          recipient: email,
          subject: `[OPS] Inventory submitted - ${account} ${period} (${totalFmt})`,
          eventType: "inventory_submitted",
          relatedInfo: `${account} ${period}`,
        });

        // Email to submitter + ap@kitchfix.com
        const invHtml = `
          <div style="font-family:Inter,-apple-system,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#0f3057;padding:16px 24px;border-radius:12px 12px 0 0;">
              <span style="color:#fff;font-size:14px;font-weight:700;">KITCHFIX OPS HUB</span>
              <span style="float:right;color:#d97706;font-size:12px;font-weight:700;">INVENTORY</span>
            </div>
            <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
              <h2 style="margin:0 0 4px;color:#0f3057;font-size:18px;">Inventory Submitted</h2>
              <p style="margin:0 0 16px;color:#64748b;font-size:13px;">${account} - ${period} - ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
              <table style="width:100%;border-collapse:collapse;font-size:13px;">
<tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Food</td><td style="text-align:right;color:#0f3057;font-weight:700;">${foodFmt}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Packaging</td><td style="text-align:right;color:#0f3057;font-weight:700;">${pkgFmt}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Supplies</td><td style="text-align:right;color:#0f3057;font-weight:700;">${supFmt}</td></tr>
                ${Number(snacks) ? `<tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Snacks</td><td style="text-align:right;color:#0f3057;font-weight:700;">${snkFmt}</td></tr>` : ""}
                ${Number(beverages) ? `<tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Beverages</td><td style="text-align:right;color:#0f3057;font-weight:700;">${bevFmt}</td></tr>` : ""}
                <tr style="border-top:2px solid #e2e8f0;"><td style="padding:8px 0;color:#0f3057;font-weight:800;">Total</td><td style="text-align:right;color:#0f3057;font-weight:800;font-size:16px;">${totalFmt}</td></tr>
                              </table>
              ${notes ? `<p style="margin:16px 0 0;padding:12px;background:#f8fafc;border-radius:8px;font-size:12px;color:#475569;"><strong>Notes:</strong> ${notes}</p>` : ""}
              <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">Submitted by ${email}</p>
            </div>
          </div>`;

        sendOpsEmail(token, {
          from: email,
          to: "ap@kitchfix.com",
          cc: email,
          subject: `[KitchFix] Inventory - ${account} ${period} ${totalFmt}`,
          html: invHtml,
        }).catch(() => {});

        // Slack notification to #opshub-inventory-submissions
        if (process.env.SLACK_INVENTORY_WEBHOOK) {
          fetch(process.env.SLACK_INVENTORY_WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `Inventory submitted: ${account} ${period} ${totalFmt}`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
text: `*Inventory Submitted*\n*Account:* ${account}\n*Period:* ${period}\n*Food:* ${foodFmt}\n*Packaging:* ${pkgFmt}\n*Supplies:* ${supFmt}${Number(snacks) ? `\n*Snacks:* ${snkFmt}` : ""}${Number(beverages) ? `\n*Beverages:* ${bevFmt}` : ""}\n*Total:* ${totalFmt}${notes ? `\n*Notes:* ${notes}` : ""}\n*Submitted by:* ${email}`,
                  },
                },
              ],
            }),
          }).catch(() => {});
        }
      }

      return NextResponse.json(result);
    }

    if (action === "submit-labor-actuals") {
      const { account, homestandId, budgetEnvelope, carryForward, actualSpent, notes, revenueActual, actualFood, actualPackaging } = body;

      const variance = Math.round(budgetEnvelope - actualSpent);

const safeRead = async (id, tab) => {
        try { return await readSheetSA(id, tab); }
        catch { return { headers: [], rows: [] }; }
      };
            const { rows: existingPlans } = await safeRead(SHEET_IDS.COLLECTION, "labor_plans");
      const acctPlans = existingPlans
        .filter((r) => String(r[3]).trim() === account)
        .map((r) => ({
          homestandId: String(r[4]).trim(),
          variance: Number(r[8]) || 0,
        }));

      let cumulativeVariance = acctPlans.reduce((sum, p) => sum + p.variance, 0) + variance;
      let streak = 0;
      for (const p of acctPlans) {
        if (p.variance >= 0) streak++;
        else streak = 0;
      }
      if (variance >= 0) streak++;
      else streak = 0;

      const uuid = crypto.randomUUID();
      const now = new Date();
      const row = [
        uuid,
        now.toISOString(),
        email,
        account,
        homestandId,
        Math.round(budgetEnvelope),
        Math.round(carryForward),
        Math.round(actualSpent),
        variance,
        Math.round(cumulativeVariance),
        streak,
        (notes || "").slice(0, 300),
        Math.round(Number(revenueActual) || 0),
        Math.round(Number(actualFood) || 0),
        Math.round(Number(actualPackaging) || 0),
      ];

const result = await appendRow(token, SHEET_IDS.COLLECTION, "labor_plans", row);

    logEvent(token, { email, userName, category: "ops", action: "labor_submit", page: "/ops", detail: { account, homestandId, variance } });

      if (result.success) {
        const varFmt = variance >= 0 ? `+$${variance.toLocaleString()}` : `-$${Math.abs(variance).toLocaleString()}`;
await opsNotify(token, {
          recipient: email,
          subject: `[OPS] Labor actuals submitted - ${account} ${homestandId} (${varFmt})`,
          eventType: "labor_submitted",
          relatedInfo: `${account} ${homestandId}`,
        });
            }

      return NextResponse.json({
        ...result,
        variance,
        cumulativeVariance: Math.round(cumulativeVariance),
        streak,
      });
    }

    if (action === "submit-sold-revenue") {
      const { account, homestandId, soldRevenue } = body;

      const row = [
        account,
        homestandId,
        Math.round(Number(soldRevenue)),
        email,
        new Date().toISOString(),
      ];

const result = await appendRow(token, SHEET_IDS.COLLECTION, "labor_sold_revenue", row);

       logEvent(token, { email, userName, category: "ops", action: "sold_revenue", page: "/ops", detail: { account, homestandId, amount: Number(soldRevenue) || 0 } });

       if (result.success) {
                const revFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(soldRevenue) || 0);
await opsNotify(token, {
          recipient: email,
          subject: `[OPS] Sold revenue entered - ${account} ${homestandId} (${revFmt})`,
          eventType: "sold_revenue",
          relatedInfo: `${account} ${homestandId}`,
        });
            }

      return NextResponse.json(result);
    }

    if (action === "add-deep-clean") {
      const { account, date } = body;
      const row = [account, date, email, new Date().toISOString()];
      const result = await appendRow(token, SHEET_IDS.COLLECTION, "deep_clean_days", row);
      return NextResponse.json(result);
    }

    if (action === "sous-portfolio") {
      const { portfolioData } = body;
      if (!portfolioData) return NextResponse.json({ success: false, error: "Missing portfolio data" }, { status: 400 });

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return NextResponse.json({ success: false, error: "Sous AI not configured" }, { status: 500 });

      const d = portfolioData;
      const prompt = `You are Sous AI, the financial intelligence engine powering KitchFix's executive dashboard. You are briefing the CEO, CFO, VP of Ops, Director of Ops, and Regional Directors.

KitchFix runs premium food service at MLB stadiums, MiLB parks, and Player Development Centers (year-round kitchens).

IMPORTANT CONTEXT: This dashboard tracks three operational cost categories that ops managers directly control: hourly labor, food, and packaging & supplies. It does NOT include salary labor, SG&A, payroll taxes, leases, or other fixed overhead. All variance figures are revenue-adjusted (costs are scaled proportionally to actual revenue vs budgeted revenue).

PORTFOLIO SNAPSHOT:
- ${d.totalAccounts} active accounts (${d.mlbCount} MLB, ${d.pdcCount} PDC, ${d.milbCount} MiLB)
- Revenue Budget (Annual): $${d.totalRevenueBudget?.toLocaleString()}
- Revenue Actual (Reported): $${d.totalRevenueActual?.toLocaleString()} from ${d.periodsCompleted} closed periods
${d.totalSalaryBudget ? `- Salary Budget (Annual, not tracked in dashboard): $${d.totalSalaryBudget?.toLocaleString()}` : ""}
- Tracked Ops Costs Budget: $${d.totalCogsBudget?.toLocaleString()} (Hourly Labor: $${d.totalLaborBudget?.toLocaleString()}, Food: $${d.totalFoodBudget?.toLocaleString()}, Pkg: $${d.totalPackBudget?.toLocaleString()})
- Tracked Ops Costs Actual: $${d.totalCogsActual?.toLocaleString()} (Hourly Labor: $${d.totalLaborActual?.toLocaleString()}, Food: $${d.totalFoodActual?.toLocaleString()}, Pkg: $${d.totalPackActual?.toLocaleString()})
- Ops Variance (Rev-Adjusted): ${d.netVariance >= 0 ? "+" : ""}$${d.netVariance?.toLocaleString()}
- Periods Closed: ${d.periodsCompleted}/${d.periodsTotal} (currently in ${d.currentPeriod || "P1"}, ${d.acctReporting || 0} accounts reporting)

ACCOUNT-LEVEL VARIANCES:
${d.accountSummaries?.map(a => `  ${a.name} (${a.level}): Var ${a.variance >= 0 ? "+" : ""}$${a.variance?.toLocaleString()}, ${a.completed}/${a.total} closed`).join("\n")}

TOP CONCERNS:
${d.redFlags?.join("\n") || "None flagged"}

Write exactly 4 bullet points for the C-suite (one sentence each, max 50 words each). Format:
1. Portfolio headline — the overall operational cost story in one line
2. Biggest portfolio-wide risk or cost category concern
3. Specific account(s) needing immediate intervention with dollar amounts
4. Strategic recommendation for the next 30 days

Rules:
- Be executive-level: decisive, data-driven, no hedging
- Reference specific dollar amounts and account names
- Say "ops costs" or "tracked costs" not "total COGS" since salary/SG&A are excluded
- If the portfolio is healthy, still surface the #1 thing leadership should watch
- Be honest about severity — leadership wants truth, not optimism
- No accounting jargon — use operational language`;

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 600,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("[Sous AI Portfolio]", res.status, errText);
          return NextResponse.json({ success: false, error: `Sous AI error ${res.status}` }, { status: 502 });
        }

        const result = await res.json();
        const text = result.content?.[0]?.text || "";
        const bullets = text
          .split(/\n/)
          .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
          .filter((l) => l.length > 10);

        const tone = d.netVariance >= 5000 ? "positive" : d.netVariance >= -2000 ? "caution" : "negative";

        return NextResponse.json({ success: true, bullets: bullets.slice(0, 4), tone });
      } catch (err) {
        console.error("[Sous AI Portfolio error]", err.message);
        return NextResponse.json({ success: false, error: `Sous AI error: ${err.message}` }, { status: 500 });
      }
    }

    if (action === "sous-analyze") {
      const { periodData } = body;
      if (!periodData) return NextResponse.json({ success: false, error: "Missing period data" }, { status: 400 });

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return NextResponse.json({ success: false, error: "Sous AI not configured" }, { status: 500 });

      const p = periodData;
      const prompt = `You are Sous AI, a concise financial analyst built into KitchFix's operations dashboard. KitchFix runs food service operations at MLB stadiums and production kitchens.

Here is the Period ${p.period} data for ${p.account}:
- Status: ${p.status}
- Revenue: $${p.revActual?.toLocaleString() || 0} actual vs $${p.revBudget?.toLocaleString() || 0} budget
- Labor: $${p.laborActual?.toLocaleString() || 0} actual vs $${p.laborBudget?.toLocaleString() || 0} budget (variance: ${p.laborVar >= 0 ? "+" : ""}$${p.laborVar?.toLocaleString() || 0})
- Food: $${p.foodActual?.toLocaleString() || 0} actual vs $${p.foodBudget?.toLocaleString() || 0} budget (variance: ${p.foodVar >= 0 ? "+" : ""}$${p.foodVar?.toLocaleString() || 0})
- Pkg & Supplies: $${p.pkgActual?.toLocaleString() || 0} actual vs $${p.pkgBudget?.toLocaleString() || 0} budget (variance: ${p.pkgVar >= 0 ? "+" : ""}$${p.pkgVar?.toLocaleString() || 0})
- Gross Margin: ${p.grossMargin || "N/A"} (target: ${p.grossMarginTarget || "N/A"})
- Net Variance: ${p.totalVar >= 0 ? "+" : ""}$${p.totalVar?.toLocaleString() || 0} (revenue-adjusted)
- Unit Days: ${p.unitDays || 0} ${p.unitLabel || "days"}
- Labor per ${p.unitLabel || "day"}: $${p.laborPerUnit?.toLocaleString() || 0} (target: $${p.laborPerUnitTarget?.toLocaleString() || 0})
${p.pacing ? `- Pacing: ${p.pacing.through} through period, labor projected at $${p.pacing.laborProj?.toLocaleString()}, food projected at $${p.pacing.foodProj?.toLocaleString()}, ${p.pacing.daysLeft} days remaining` : ""}

Write exactly 3 bullet points (one sentence each, max 40 words each). Be specific with dollar amounts and percentages. Format:
1. The headline result or current status
2. The biggest risk, concern, or problem area
3. One specific, actionable recommendation with a number or target

Rules:
- Be direct and assertive. No hedging or qualifiers.
- Use kitchen/ops language, not accounting jargon.
- Reference specific dollar amounts from the data.
- If overall favorable, still identify the weakest category.
- If unfavorable, be honest about severity and urgency.
- Each bullet should stand alone — no "additionally" or "furthermore".`;

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 400,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("[Sous AI]", res.status, errText);
          return NextResponse.json({ success: false, error: `Sous AI error ${res.status}: ${errText.slice(0, 200)}` }, { status: 502 });
        }

        const result = await res.json();
        const text = result.content?.[0]?.text || "";

        const bullets = text
          .split(/\n/)
          .map((l) => l.replace(/^\d+[\.\)]\s*/, "").trim())
          .filter((l) => l.length > 10);

        const tone = p.totalVar >= 1000 ? "positive" : p.totalVar >= -500 ? "caution" : "negative";

        return NextResponse.json({ success: true, bullets: bullets.slice(0, 3), tone });
      } catch (err) {
        console.error("[Sous AI error]", err.message);
        return NextResponse.json({ success: false, error: `Sous AI error: ${err.message}` }, { status: 500 });
      }
    }

    if (action === "help-request") {
      const { message } = body;
      if (!message?.trim()) return NextResponse.json({ success: false, error: "Message is required" }, { status: 400 });
      await notify(token, {
        type: "help",
        title: `Ops Help Request from ${userName}`,
        body: `${userName} (${email}) needs help:\n\n${message.trim()}`,
        email, targetEmails: OPS_LEADERSHIP_EMAILS,
});
          logEvent(token, { email, userName, category: "ops", action: "help_request", page: "/ops", detail: { message: (message || "").slice(0, 100) } });
          return NextResponse.json({ success: true });
      }


// ── Invoice Actions (POST) ──
if (["invoice-submit", "vendor-add", "invoice-duplicate-check", "invoice-ocr", "invoice-photo-gate", "invoice-consistency-check"].includes(action)) {
            const result = await handleInvoicePost(action, body, token, email, userName);
          if (result) {
              // Analytics — log invoice-related actions
              const invoiceEvents = {
                  "invoice-submit":     { action: "submit_invoice", detail: { account: body.account, vendor: body.vendor, total: body.total, type: body.type } },
                  "invoice-ocr":        { action: "ocr_scan",       detail: { account: body.account, confidence: result.confidence } },
                  "invoice-photo-gate": { action: "photo_gate",     detail: { pass: result.pass, documentType: result.documentType } },
                  "vendor-add":         { action: "vendor_add",     detail: { vendorName: body.vendorName, account: body.account } },
              };
              const evt = invoiceEvents[action];
              if (evt) logEvent(token, { email, userName, category: "ops", page: "/ops", ...evt });
              return NextResponse.json(result);
          }
      }

// ── Vendor Portal (POST) ──
      if (action === "vendor-update") {
          const result = await handleVendorUpdate(body, token, email);
          logEvent(token, { email, userName, category: "ops", action: "vendor_update", page: "/ops", detail: { vendorId: body.vendorId, accountKey: body.accountKey } });
          return NextResponse.json(result);
      }
      if (action === "vendor-master-update") {
          const result = await handleVendorMasterUpdate(body, token, email);
          logEvent(token, { email, userName, category: "ops", action: "vendor_update", page: "/ops", detail: { vendorId: body.vendorId, name: body.name } });
          return NextResponse.json(result);
      }
      if (action === "vendor-deactivate") {
          const result = await handleVendorDeactivate(body, token, email);
          logEvent(token, { email, userName, category: "ops", action: "vendor_deactivate", page: "/ops", detail: { vendorId: body.vendorId, accountKey: body.accountKey } });
          return NextResponse.json(result);
      }
      if (action === "vendor-reactivate") {
          const result = await handleVendorReactivate(body, token, email);
          logEvent(token, { email, userName, category: "ops", action: "vendor_update", page: "/ops", detail: { vendorId: body.vendorId, accountKey: body.accountKey, reactivate: true } });
          return NextResponse.json(result);
      }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[OpsHub POST]", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
#!/usr/bin/env node
// scripts/probes/_probe_billback_cy.mjs
//
// PR-billback-1 finance-core probe. Builds the `billback` payload block
// stand-alone (mirror of the logic that will land in the resolver) for
// the three management-fee accounts and the non-MF control, then
// prints the anchors Kevin named so the finance core can be verified
// before the resolver edit is committed.
//
// USAGE
//   node --env-file=.env.local scripts/probes/_probe_billback_cy.mjs
//
// Reports: ytd totals, first_goal_period, through_period, per-period
// goal / actual / tone, pct_of_annual, breakdown (names only + counts
// only - no dollar literals captured in a committed artifact; the
// console output stays on Kevin's machine).

import { createClient } from "@supabase/supabase-js";

// ─── env sanity (presence, not value) ───────────────────────────────
const URL = process.env.SUPABASE_URL;
const SR  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!URL) { console.error("SUPABASE_URL: ABSENT"); process.exit(1); }
if (!SR)  { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(1); }
const supa = createClient(URL, SR, { auth: { persistSession: false } });

// ─── FY2026 period arithmetic (mirrors src/app/kpi/labor/lib/periods.js) ───
const FY_START_ISO = "2025-12-29";
const DAYS_PER_PERIOD = 28;
const MS_PER_DAY = 86400000;
const FISCAL_YEAR = 2026;

function parseISO(iso) {
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2]-1, +m[3]));
}
function periodStartISO(p) {
  const fy = parseISO(FY_START_ISO);
  return new Date(fy.getTime() + (p-1)*DAYS_PER_PERIOD*MS_PER_DAY).toISOString().slice(0,10);
}
function periodEndISO(p) {
  const fy = parseISO(FY_START_ISO);
  return new Date(fy.getTime() + (p*DAYS_PER_PERIOD-1)*MS_PER_DAY).toISOString().slice(0,10);
}
function periodOfDate(iso) {
  const d = parseISO(iso); const fy = parseISO(FY_START_ISO);
  if (!d || !fy) return null;
  const days = Math.floor((d.getTime() - fy.getTime()) / MS_PER_DAY);
  if (days < 0) return null;
  const p = Math.floor(days / DAYS_PER_PERIOD) + 1;
  return p >= 1 && p <= 13 ? p : null;
}

// R-93 FYTD end: last period whose end is >= 8 days before today.
function r93FytdEndISO(todayISO) {
  const today = parseISO(todayISO);
  const cutoff = new Date(today.getTime() - 8*MS_PER_DAY);
  for (let p = 13; p >= 1; p--) {
    const pe = parseISO(periodEndISO(p));
    if (pe.getTime() <= cutoff.getTime()) return periodEndISO(p);
  }
  return null;
}
function derivePeriodSpendSettled(periodNo, todayISO, periodStatusRow) {
  const pEnd = periodEndISO(periodNo);
  if (periodStatusRow?.verified_at) return true;
  const calendarClosed = pEnd < todayISO;
  const recordClosed = !!periodStatusRow?.closed_at;
  if (!calendarClosed && !recordClosed) return false;
  const fytdEnd = r93FytdEndISO(todayISO);
  if (!fytdEnd) return false;
  return fytdEnd >= pEnd;
}

// ─── deriveGlBucket - mirrors src/lib/purchasing/loaders.js ─────────
function deriveGlBucket(code) {
  const s = String(code || "");
  if (!s) return null;
  const two = s.slice(0, 2);
  if (two === "32" || two === "34" || two === "35") return "pl_cogs";
  if (two === "13") return "reimbursable";
  if (s.charAt(0) === "5") return "sga";
  return "other";
}

// ─── breakdown label - strip "{account_key} " prefix from gl_codes.name ──
function labelFromGlName(name, accountKey) {
  if (!name) return "Uncoded";
  const pfx = accountKey + " ";
  return name.startsWith(pfx) ? name.slice(pfx.length) : name;
}

// ─── loaders (paginate so no silent 1000-row truncation) ────────────
async function fetchAll(builder) {
  const PAGE = 1000; let from = 0; const out = [];
  while (true) {
    const q = await builder.range(from, from + PAGE - 1);
    if (q.error) throw new Error(q.error.message);
    const rows = q.data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function loadBillbackGoal(accountKey, fiscalYear) {
  const q = await supa
    .from("kpi_billback_goals")
    .select("annual_goal")
    .eq("account_key", accountKey)
    .eq("fiscal_year", fiscalYear)
    .maybeSingle();
  if (q.error) throw new Error(`kpi_billback_goals: ${q.error.message}`);
  return q.data?.annual_goal != null ? Number(q.data.annual_goal) : null;
}

async function loadProjectedMealsByPeriod(accountKey, fyStart, fyEnd) {
  const rows = await fetchAll(
    supa.from("sc_daily_revenue")
      .select("service_date, projected_count, is_non_revenue")
      .eq("account_key", accountKey)
      .gte("service_date", fyStart)
      .lte("service_date", fyEnd)
      .not("is_non_revenue", "is", true)
      .order("service_date")
  );
  const byP = new Map();
  for (const r of rows) {
    const p = periodOfDate(r.service_date);
    if (p == null) continue;
    byP.set(p, (byP.get(p) || 0) + Number(r.projected_count || 0));
  }
  return byP;
}

// Mirrors paginateActuals' R-147 cutover split in src/lib/purchasing/loaders.js:
//   Pre-cutover txn_date  : purchasing_actuals (all sources)
//   Post-cutover txn_date : (a) purchasing_actuals source='rippling_spend' (card lane)
//                           (b) invoice_submissions.gl_breakdown (bill lane)
// This probe serves the three MF accounts (STL-FL, STL-MO, CIN-OH) all of which
// are capture-eligible (NOT in CAPTURE_EXCLUDED_ACCOUNTS), so for them the
// post-cutover bill lane is invoice_submissions only.
const CAPTURE_CUTOVER_ISO = "2026-09-07";

async function loadReimbursableActualsByPeriod(accountKey, fyStart, fyEnd) {
  const preEnd = fyEnd < CAPTURE_CUTOVER_ISO
    ? fyEnd
    : (() => {
        const d = new Date(CAPTURE_CUTOVER_ISO + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      })();

  // Pre-cutover lane: all sources, purchasing_actuals.
  let preRows = [];
  if (fyStart <= preEnd) {
    preRows = await fetchAll(
      supa.from("purchasing_actuals")
        .select("txn_date, gl_line_code, amount, account_key, excluded, source")
        .eq("account_key", accountKey)
        .eq("excluded", false)
        .gte("txn_date", fyStart)
        .lte("txn_date", preEnd)
        .order("txn_date")
    );
  }

  // Post-cutover lane A: card lane in purchasing_actuals (source='rippling_spend').
  const postStart = fyStart > CAPTURE_CUTOVER_ISO ? fyStart : CAPTURE_CUTOVER_ISO;
  let cardRows = [];
  if (postStart <= fyEnd) {
    cardRows = await fetchAll(
      supa.from("purchasing_actuals")
        .select("txn_date, gl_line_code, amount, account_key, excluded, source")
        .eq("account_key", accountKey)
        .eq("excluded", false)
        .eq("source", "rippling_spend")
        .gte("txn_date", postStart)
        .lte("txn_date", fyEnd)
        .order("txn_date")
    );
  }

  // Post-cutover lane B: invoice_submissions (bill lane for capture-eligible accounts).
  // The three MF accounts in scope here are all capture-eligible.
  let invRows = [];
  if (postStart <= fyEnd) {
    invRows = await fetchAll(
      supa.from("invoice_submissions")
        .select("gl_breakdown, submitted_at, status, account_key")
        .eq("account_key", accountKey)
        .gte("submitted_at", postStart)
        .lte("submitted_at", fyEnd)
        .order("submitted_at")
    );
  }

  const byP = new Map();
  const push = (p, code, amt) => {
    if (p == null) return;
    if (!byP.has(p)) byP.set(p, []);
    byP.get(p).push({ code: String(code || ""), amount: Number(amt || 0) });
  };

  let preReimbursableRowCount = 0, cardReimbursableRowCount = 0, invReimbursableRowCount = 0;
  for (const r of preRows) {
    if (deriveGlBucket(r.gl_line_code) !== "reimbursable") continue;
    preReimbursableRowCount++;
    push(periodOfDate(r.txn_date), r.gl_line_code, r.amount);
  }
  for (const r of cardRows) {
    if (deriveGlBucket(r.gl_line_code) !== "reimbursable") continue;
    cardReimbursableRowCount++;
    push(periodOfDate(r.txn_date), r.gl_line_code, r.amount);
  }
  for (const r of invRows) {
    const breakdown = r.gl_breakdown || [];
    const items = Array.isArray(breakdown) ? breakdown : [];
    for (const it of items) {
      const code = it.gl_line_code || it.code;
      if (deriveGlBucket(code) !== "reimbursable") continue;
      invReimbursableRowCount++;
      push(periodOfDate(r.submitted_at), code, it.amount);
    }
  }
  return { byP, preReimbursableRowCount, cardReimbursableRowCount, invReimbursableRowCount };
}

async function loadPeriodStatus(fiscalYear) {
  const rows = await fetchAll(
    supa.from("kpi_period_status")
      .select("period_no, verified_at, closed_at")
      .eq("fiscal_year", fiscalYear)
  );
  const m = new Map();
  for (const r of rows) m.set(r.period_no, r);
  return m;
}

async function loadGlCodesForAccount(accountKey) {
  const rows = await fetchAll(
    supa.from("gl_codes")
      .select("account_key, code, name")
      .eq("account_key", accountKey)
      .like("code", "13%")
  );
  const m = new Map();
  for (const r of rows) m.set(String(r.code), r.name || null);
  return m;
}

// ─── buildBillback - the finance core, to be lifted verbatim ────────
async function buildBillback({ accountKey, revenueModel, rangeIsPeriod, todayISO }) {
  if (revenueModel !== "management_fee") return null;
  if (rangeIsPeriod) return null;

  const fy = FISCAL_YEAR;
  const fyStart = periodStartISO(1);
  const fyEnd = periodEndISO(13);

  const annualGoal = await loadBillbackGoal(accountKey, fy);
  const projByP = await loadProjectedMealsByPeriod(accountKey, fyStart, fyEnd);
  const { byP: reimbByP, preReimbursableRowCount, cardReimbursableRowCount, invReimbursableRowCount } = await loadReimbursableActualsByPeriod(accountKey, fyStart, fyEnd);
  const periodStatus = await loadPeriodStatus(fy);
  const glCodes = await loadGlCodesForAccount(accountKey);

  // Goaled periods: periods with projected > 0.
  const goaledPeriods = [...projByP.entries()]
    .filter(([, n]) => n > 0)
    .map(([p]) => p)
    .sort((a, b) => a - b);
  const firstGoalPeriod = goaledPeriods[0] || null;

  const totalFyMeals = goaledPeriods.reduce((s, p) => s + (projByP.get(p) || 0), 0);

  // Through period: last settled period in range using R-93 rule.
  // "range" for CY = all 13 periods; through_period is the last one
  // where derivePeriodSpendSettled returns true.
  let throughPeriod = null;
  for (let p = 13; p >= 1; p--) {
    if (derivePeriodSpendSettled(p, todayISO, periodStatus.get(p) || null)) { throughPeriod = p; break; }
  }

  // Pre-season actuals: reimbursable actuals in periods < firstGoalPeriod
  // get folded into firstGoalPeriod's `actual`.
  let preSeasonActual = 0;
  if (firstGoalPeriod) {
    for (let p = 1; p < firstGoalPeriod; p++) {
      const items = reimbByP.get(p) || [];
      for (const it of items) preSeasonActual += it.amount;
    }
  }

  // Build periods[] from firstGoalPeriod .. 13.
  const periodsOut = [];
  const seenPeriods = new Set();
  for (let p = firstGoalPeriod || 1; p <= 13; p++) {
    seenPeriods.add(p);
    const periodMeals = projByP.get(p) || 0;
    const isGoaled = periodMeals > 0;
    const goal = (annualGoal != null && isGoaled && totalFyMeals > 0)
      ? annualGoal * (periodMeals / totalFyMeals)
      : null;
    const items = reimbByP.get(p) || [];
    let actualRaw = 0;
    for (const it of items) actualRaw += it.amount;
    const actual = (p === firstGoalPeriod) ? actualRaw + preSeasonActual : actualRaw;

    const pStart = periodStartISO(p); const pEnd = periodEndISO(p);
    const state = pEnd < todayISO ? "closed"
      : (pStart <= todayISO && todayISO <= pEnd) ? "in_progress"
      : "not_started";
    const stateOut = isGoaled ? state : "off_season";

    let tone = "na";
    let delta = null; let pct = null;
    if (goal != null) {
      delta = actual - goal;
      pct = goal > 0 ? (actual / goal) * 100 : null;
      tone = actual > goal ? "over" : actual < goal ? "under" : "on";
    }
    periodsOut.push({ period_no: p, goal, actual, tone, delta, pct, state: stateOut });
  }

  // YTD: through throughPeriod (settled only).
  let goalToDate = 0, actualToDate = 0;
  for (const r of periodsOut) {
    if (throughPeriod != null && r.period_no <= throughPeriod) {
      if (r.goal != null) goalToDate += r.goal;
      actualToDate += r.actual;
    }
  }
  const ytdDelta = actualToDate - goalToDate;
  const ytdTone = ytdDelta > 0 ? "over" : ytdDelta < 0 ? "under" : "on";
  const pctOfGoalToDate = goalToDate > 0 ? (actualToDate / goalToDate) * 100 : null;
  const pctOfAnnual = annualGoal && annualGoal > 0 ? (actualToDate / annualGoal) * 100 : null;
  const goalRemaining = annualGoal != null ? annualGoal - goalToDate : null;

  // Breakdown: aggregate reimbursable actuals by gl_codes.name, strip
  // "{account} " prefix. Strays: bare parent code (no match in
  // gl_codes) OR gl_codes row with a different account_key.
  const byLabel = new Map();
  let strays = 0;
  for (const items of reimbByP.values()) {
    for (const it of items) {
      const code = it.code;
      const glName = glCodes.get(code) || null;
      if (!glName) { strays += it.amount; continue; }
      const label = labelFromGlName(glName, accountKey);
      byLabel.set(label, (byLabel.get(label) || 0) + it.amount);
    }
  }
  const breakdown = [...byLabel.entries()]
    .map(([label, amount]) => ({ label, amount, stray: false }))
    .sort((a, b) => b.amount - a.amount);
  if (strays > 0.005) breakdown.push({ label: "Uncoded / strays", amount: strays, stray: true });

  // Goal-sum assertion: sum of periods[].goal (where goal is not null)
  // must equal annual_goal (within 1 cent of rounding slack).
  const goalSum = periodsOut.reduce((s, r) => s + (r.goal || 0), 0);
  const goalSumOk = annualGoal == null || Math.abs(goalSum - annualGoal) < 0.01;

  return {
    annual_goal: annualGoal,
    fiscal_year: fy,
    first_goal_period: firstGoalPeriod,
    through_period: throughPeriod,
    periods: periodsOut,
    ytd: {
      goal_to_date: goalToDate,
      actual_to_date: actualToDate,
      delta: ytdDelta,
      tone: ytdTone,
      pct_of_goal_to_date: pctOfGoalToDate,
      pct_of_annual: pctOfAnnual,
      goal_remaining: goalRemaining,
    },
    breakdown,
    strays_amount: strays,
    _debug: {
      goal_sum_ok: goalSumOk,
      goal_sum: goalSum,
      total_fy_meals: totalFyMeals,
      pre_cutover_reimbursable_rows:  preReimbursableRowCount,
      post_cutover_card_rows:         cardReimbursableRowCount,
      post_cutover_invoice_items:     invReimbursableRowCount,
    },
  };
}

// ─── report format ──────────────────────────────────────────────────
function fmtMoney(n) {
  if (n == null) return "null";
  return Math.round(n).toLocaleString("en-US");
}
function fmtPct(n) {
  if (n == null) return "null";
  return n.toFixed(0) + "%";
}

async function reportAccount(accountKey, revenueModel, todayISO) {
  const bb = await buildBillback({ accountKey, revenueModel, rangeIsPeriod: false, todayISO });
  console.log("\n════ " + accountKey + " ════");
  if (!bb) { console.log("  billback: null (gate: revenue_model=" + revenueModel + ")"); return; }
  console.log("  annual_goal present:   " + (bb.annual_goal != null ? "yes" : "NO (no row)"));
  console.log("  fiscal_year:           " + bb.fiscal_year);
  console.log("  first_goal_period:     P" + bb.first_goal_period);
  console.log("  through_period:        P" + bb.through_period);
  console.log("  total_fy_proj_meals:   " + bb._debug.total_fy_meals.toLocaleString("en-US"));
  console.log("  goal_sum_ok:           " + bb._debug.goal_sum_ok + "  (sum=" + fmtMoney(bb._debug.goal_sum) + ")");
  console.log("  ytd.actual_to_date:    " + fmtMoney(bb.ytd.actual_to_date));
  console.log("  ytd.goal_to_date:      " + fmtMoney(bb.ytd.goal_to_date));
  console.log("  ytd.delta:             " + fmtMoney(bb.ytd.delta) + "  tone=" + bb.ytd.tone);
  console.log("  ytd.pct_of_goal_to_date: " + fmtPct(bb.ytd.pct_of_goal_to_date));
  console.log("  ytd.pct_of_annual:     " + fmtPct(bb.ytd.pct_of_annual));
  console.log("  ytd.goal_remaining:    " + fmtMoney(bb.ytd.goal_remaining));
  console.log("  rows (pre-cutover / card lane / invoice lane): "
    + bb._debug.pre_cutover_reimbursable_rows + " / "
    + bb._debug.post_cutover_card_rows + " / "
    + bb._debug.post_cutover_invoice_items);
  console.log("  periods (goal / actual / pct / state):");
  for (const r of bb.periods) {
    console.log("    P" + String(r.period_no).padStart(2) + "  goal=" + fmtMoney(r.goal).padStart(8)
      + "  actual=" + fmtMoney(r.actual).padStart(8)
      + "  pct=" + fmtPct(r.pct).padStart(5)
      + "  tone=" + r.tone.padEnd(5) + " state=" + r.state);
  }
  console.log("  breakdown (label | amount | stray):");
  for (const b of bb.breakdown) {
    console.log("    " + b.label.padEnd(30) + " " + fmtMoney(b.amount).padStart(10) + "  stray=" + b.stray);
  }
}

const TODAY = (() => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
})();

console.log("today ISO: " + TODAY);
console.log("r93 FYTD end: " + r93FytdEndISO(TODAY));

for (const a of ["STL - FL", "STL - MO", "CIN - OH"]) {
  await reportAccount(a, "management_fee", TODAY);
}
// Control: non-MF account; expect billback null.
await reportAccount("TBR - FL", "sc_driven", TODAY);

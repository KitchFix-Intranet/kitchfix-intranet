// PR-billback-2 finance-core probe. Builds billback_period for several
// (account, period) pairs stand-alone and prints each scorecard so the
// finance anchors can be verified before any UI mount. Mirrors the
// buildBillbackPeriod helper's shape by inlining the same math from
// _probe_billback_cy.mjs.
//
// USAGE
//   node --env-file=.env.local scripts/probes/_probe_billback_period.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SR  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL) { console.error("SUPABASE_URL: ABSENT"); process.exit(1); }
if (!SR)  { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(1); }
const supa = createClient(URL, SR, { auth: { persistSession: false } });

// Fiscal period arithmetic (mirrors @/app/kpi/labor/lib/periods.js).
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
  return new Date(parseISO(FY_START_ISO).getTime() + (p-1)*DAYS_PER_PERIOD*MS_PER_DAY).toISOString().slice(0,10);
}
function periodEndISO(p) {
  return new Date(parseISO(FY_START_ISO).getTime() + (p*DAYS_PER_PERIOD-1)*MS_PER_DAY).toISOString().slice(0,10);
}
function periodOfDate(iso) {
  const d = parseISO(iso); const fy = parseISO(FY_START_ISO);
  if (!d || !fy) return null;
  const days = Math.floor((d.getTime() - fy.getTime()) / MS_PER_DAY);
  if (days < 0) return null;
  const p = Math.floor(days / DAYS_PER_PERIOD) + 1;
  return p >= 1 && p <= 13 ? p : null;
}
function r93FytdEndISO(todayISO) {
  const today = parseISO(todayISO);
  const cutoff = new Date(today.getTime() - 8*MS_PER_DAY);
  for (let p = 13; p >= 1; p--) {
    const pe = parseISO(periodEndISO(p));
    if (pe.getTime() <= cutoff.getTime()) return periodEndISO(p);
  }
  return null;
}
function derivePeriodSpendSettled(periodNo, todayISO, statusRow) {
  const pEnd = periodEndISO(periodNo);
  if (statusRow?.verified_at) return true;
  const calendarClosed = pEnd < todayISO;
  const recordClosed = !!statusRow?.closed_at;
  if (!calendarClosed && !recordClosed) return false;
  const fytdEnd = r93FytdEndISO(todayISO);
  if (!fytdEnd) return false;
  return fytdEnd >= pEnd;
}
function deriveGlBucket(code) {
  const s = String(code || "");
  if (!s) return null;
  const two = s.slice(0, 2);
  if (two === "32" || two === "34" || two === "35") return "pl_cogs";
  if (two === "13") return "reimbursable";
  if (s.charAt(0) === "5") return "sga";
  return "other";
}
const CAPTURE_CUTOVER_ISO = "2026-09-07";

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

async function loadBillbackGoal(accountKey, fy) {
  const q = await supa.from("kpi_billback_goals")
    .select("annual_goal").eq("account_key", accountKey).eq("fiscal_year", fy).maybeSingle();
  if (q.error) throw new Error(q.error.message);
  return q.data?.annual_goal != null ? Number(q.data.annual_goal) : null;
}
async function loadProjectedMealsByPeriod(accountKey, fyStart, fyEnd) {
  const rows = await fetchAll(supa.from("sc_daily_revenue")
    .select("service_date, projected_count, is_non_revenue")
    .eq("account_key", accountKey).gte("service_date", fyStart).lte("service_date", fyEnd)
    .not("is_non_revenue", "is", true).order("service_date"));
  const byP = new Map();
  for (const r of rows) {
    const p = periodOfDate(r.service_date); if (p == null) continue;
    const n = Number(r.projected_count || 0); if (!n) continue;
    byP.set(p, (byP.get(p) || 0) + n);
  }
  return byP;
}
async function loadReimbursableByPeriod(accountKey, fyStart, fyEnd) {
  const preEnd = fyEnd < CAPTURE_CUTOVER_ISO ? fyEnd : (() => {
    const d = new Date(CAPTURE_CUTOVER_ISO + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const postStart = fyStart > CAPTURE_CUTOVER_ISO ? fyStart : CAPTURE_CUTOVER_ISO;

  let preRows = [];
  if (fyStart <= preEnd) {
    preRows = await fetchAll(supa.from("purchasing_actuals")
      .select("txn_date, gl_line_code, amount").eq("account_key", accountKey).eq("excluded", false)
      .gte("txn_date", fyStart).lte("txn_date", preEnd).order("txn_date"));
  }
  let cardRows = [];
  if (postStart <= fyEnd) {
    cardRows = await fetchAll(supa.from("purchasing_actuals")
      .select("txn_date, gl_line_code, amount").eq("account_key", accountKey).eq("excluded", false)
      .eq("source", "rippling_spend").gte("txn_date", postStart).lte("txn_date", fyEnd).order("txn_date"));
  }
  let invRows = [];
  if (postStart <= fyEnd) {
    invRows = await fetchAll(supa.from("invoice_submissions")
      .select("gl_breakdown, submitted_at").eq("account_key", accountKey)
      .gte("submitted_at", postStart).lte("submitted_at", fyEnd).order("submitted_at"));
  }

  const byP = new Map();
  const push = (p, amt) => { if (p == null) return; const n = Number(amt||0); if (!n) return;
    byP.set(p, (byP.get(p) || 0) + n);
  };
  for (const r of preRows)  if (deriveGlBucket(r.gl_line_code) === "reimbursable") push(periodOfDate(r.txn_date), r.amount);
  for (const r of cardRows) if (deriveGlBucket(r.gl_line_code) === "reimbursable") push(periodOfDate(r.txn_date), r.amount);
  for (const r of invRows) {
    const items = Array.isArray(r.gl_breakdown) ? r.gl_breakdown : [];
    for (const it of items) {
      const code = it.gl_line_code || it.code;
      if (deriveGlBucket(code) === "reimbursable") push(periodOfDate(r.submitted_at), it.amount);
    }
  }
  return byP;
}
async function loadPeriodStatus(fy) {
  const rows = await fetchAll(supa.from("kpi_period_status")
    .select("period_no, verified_at, closed_at").eq("fiscal_year", fy));
  const m = new Map(); for (const r of rows) m.set(r.period_no, r); return m;
}

// Mirror of buildBillback (returns full) and buildBillbackPeriod (one row).
async function buildBillback(accountKey, isMF, todayISO) {
  if (!isMF) return null;
  const fyStart = periodStartISO(1); const fyEnd = periodEndISO(13);
  const [annualGoal, projByP, reimbByP, periodStatus] = await Promise.all([
    loadBillbackGoal(accountKey, FISCAL_YEAR),
    loadProjectedMealsByPeriod(accountKey, fyStart, fyEnd),
    loadReimbursableByPeriod(accountKey, fyStart, fyEnd),
    loadPeriodStatus(FISCAL_YEAR),
  ]);
  const goaled = [...projByP.entries()].filter(([,n]) => n > 0).map(([p]) => p).sort((a,b)=>a-b);
  const firstGoalPeriod = goaled[0] || null;
  const totalFyMeals = goaled.reduce((s,p) => s + (projByP.get(p) || 0), 0);

  let through = null;
  for (let p = 13; p >= 1; p--) if (derivePeriodSpendSettled(p, todayISO, periodStatus.get(p) || null)) { through = p; break; }

  let preSeason = 0;
  if (firstGoalPeriod) for (let p = 1; p < firstGoalPeriod; p++) preSeason += reimbByP.get(p) || 0;

  const periods = [];
  for (let p = firstGoalPeriod || 1; p <= 13; p++) {
    const meals = projByP.get(p) || 0;
    const isGoaled = meals > 0;
    const goal = (annualGoal != null && isGoaled && totalFyMeals > 0) ? annualGoal * (meals / totalFyMeals) : null;
    const rawActual = reimbByP.get(p) || 0;
    const actual = (p === firstGoalPeriod) ? rawActual + preSeason : rawActual;
    const pStart = periodStartISO(p); const pEnd = periodEndISO(p);
    const calendarState = pEnd < todayISO ? "closed" : (pStart <= todayISO && todayISO <= pEnd) ? "in_progress" : "not_started";
    const state = isGoaled ? calendarState : "off_season";
    let tone = "na", delta = null, pct = null;
    if (goal != null) {
      delta = actual - goal; pct = goal > 0 ? (actual/goal)*100 : null;
      tone = actual > goal ? "over" : actual < goal ? "under" : "on";
    }
    periods.push({ period_no: p, goal, actual, tone, delta, pct, state });
  }
  return { annual_goal: annualGoal, fiscal_year: FISCAL_YEAR, first_goal_period: firstGoalPeriod, through_period: through, periods, pre_season_amount: preSeason };
}
async function buildBillbackPeriod(accountKey, isMF, todayISO, periodNo) {
  const full = await buildBillback(accountKey, isMF, todayISO);
  if (!full) return null;
  const row = (full.periods || []).find(r => r.period_no === periodNo);
  if (!row) {
    if (full.first_goal_period && periodNo < full.first_goal_period) {
      return { period_no: periodNo, goal: null, actual: null, tone: "na", delta: null, pct: null,
        state: "pre_season", annual_goal: full.annual_goal, fiscal_year: full.fiscal_year,
        first_goal_period: full.first_goal_period, is_first_goal_period: false,
        pre_season_amount: full.pre_season_amount };
    }
    return null;
  }
  return { period_no: row.period_no, goal: row.goal, actual: row.actual, tone: row.tone, delta: row.delta,
    pct: row.pct, state: row.state, annual_goal: full.annual_goal, fiscal_year: full.fiscal_year,
    first_goal_period: full.first_goal_period, is_first_goal_period: row.period_no === full.first_goal_period,
    pre_season_amount: full.pre_season_amount };
}

const TODAY = new Date().toISOString().slice(0, 10);
console.log("today ISO: " + TODAY);
console.log("r93 FYTD end: " + r93FytdEndISO(TODAY));
console.log("");

const fmt = n => n == null ? "null" : Math.round(n).toLocaleString("en-US");

const PAIRS = [
  ["STL - FL",  "management_fee",  8, "P8 goaled, no fold"],
  ["STL - FL",  "management_fee",  1, "P1 first_goal_period, no fold"],
  ["STL - MO",  "management_fee",  4, "P4 first_goal_period, fold expected"],
  ["STL - MO",  "management_fee",  2, "P2 pre-season"],
  ["STL - MO",  "management_fee",  7, "P7 goaled, no fold"],
  ["CIN - OH",  "management_fee",  4, "P4 first_goal_period, fold expected"],
  ["CIN - OH",  "management_fee",  3, "P3 pre-season"],
  ["TBR - FL",  "sc_driven",       5, "non-MF control, expect null"],
];

for (const [acct, model, p, note] of PAIRS) {
  const isMF = model === "management_fee";
  const bb = await buildBillbackPeriod(acct, isMF, TODAY, p);
  console.log(`-- ${acct} P${p} (${note})`);
  if (!bb) { console.log(`   billback_period: null`); continue; }
  console.log(`   state=${bb.state}  tone=${bb.tone}  is_first_goal_period=${bb.is_first_goal_period}  first_goal_period=P${bb.first_goal_period}`);
  console.log(`   goal=${fmt(bb.goal)}  actual=${fmt(bb.actual)}  delta=${fmt(bb.delta)}  pct=${bb.pct == null ? "null" : bb.pct.toFixed(0)+"%"}`);
  console.log(`   pre_season_amount=${fmt(bb.pre_season_amount)}  annual_goal=${fmt(bb.annual_goal)}`);
  console.log("");
}

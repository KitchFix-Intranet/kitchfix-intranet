"use client";
// /kpi/purchasing
//
// KPI Dashboard - Purchasing section (PR 2, at_risk accounts only).
//
// Shell + range + folio reuse labor's components (rule 2 - import only,
// never modify). Board content is scoped to this route.
//
// Cost-model gate:
//   at_risk       -> full purchasing board
//   pass_through  -> honest PR-3 placeholder (§2, §6.7)
//   revenue_flex  -> reserved / zero members today
//   aggregate     -> full board (mixes at-risk + pass-through spend;
//                    per §1 note "Aggregates are NOT short-circuited")
//
// URL state (subset of labor's, no ?workers / ?redact / ?homestand):
//   ?account   team_key or ALL / EAST / WEST
//   ?start     YYYY-MM-DD (defaults to current period start)
//   ?end       YYYY-MM-DD (defaults to current period end)

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

import "../kpi.css";
import "./purchasing.css";

import {
  FY_START_ISO,
  periodOf,
  periodStartISO,
  periodEndISO,
  currentPeriodNo,
  weekOfPeriod,
  inferRangeSelection,
  weekStartsInRange,
  rangeForPeriod,
} from "@/app/kpi/labor/lib/periods";
import { addDaysISO } from "@/lib/kpi/dateResolve";
import { Shell } from "@/app/kpi/labor/components/Shell";
import { FolioRail, PSEUDO_KEYS } from "@/app/kpi/labor/components/FolioRail";
import { costModelFor, isKnownAccount } from "@/lib/accountModels";
import { classifyTier } from "@/lib/kpi/classifyTier";

import {
  BUCKET_DEFS,
  LEDGER_DEFS,
  bucketBudget,
  kpiBudget,
  bucketWeeklySpend,
  periodWeeklySpend,
  finishedWeekCount,
  weeklyTargets,
  projectedClose as projectedCloseCalc,
  categoryFor,
  fmt$,
} from "./lib/board";

import { PeriodCard } from "./components/PeriodCard";
import { BucketCard } from "./components/BucketCard";
import { LedgerCard } from "./components/LedgerCard";
import { CardPurchases } from "./components/CardPurchases";
import { VendorBreakdown } from "./components/VendorBreakdown";
import { PassThroughPlaceholder } from "./components/PassThroughPlaceholder";

// Format ISO date -> "MM/DD" for chart week captions.
function isoToMMDD(iso) {
  if (!iso) return "";
  const parts = String(iso).slice(0, 10).split("-");
  if (parts.length !== 3) return "";
  return `${parts[1]}/${parts[2]}`;
}

// Format ISO date -> "MM/DD/YY" for range label.
function isoToMMDDYY(iso) {
  if (!iso) return "";
  const parts = String(iso).slice(0, 10).split("-");
  if (parts.length !== 3) return "";
  return `${parts[1]}/${parts[2]}/${parts[0].slice(2)}`;
}

const LAST_ACCOUNT_KEY = "kpi:purchasing:lastAccount";
const LAST_RANGE_KEY   = "kpi:purchasing:lastRange";
const AGGREGATE_KEYS   = new Set(["ALL", "EAST", "WEST"]);

export default function KpiPurchasingPage() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Client-side auth is advisory only - the API route is the sole
  // authority (mirrors labor's V-role-gates comment: "server is the
  // sole authority"). Fetch fires as soon as we know the session
  // status has settled (unauthenticated -> 401 is a valid response
  // path handled by the render). This also lets TEST_MODE local runs
  // render (middleware bypass short-circuits auth server-side; the
  // route accepts the request; gating client fetch on email would
  // leave the board blank during Playwright + smoke - the memory
  // rule "TEST_MODE bypass for Playwright + local UI battery"
  // requires this path to render).

  const urlAccount = searchParams.get("account");
  const account = urlAccount || "";

  const today = new Date().toISOString().slice(0, 10);
  const curPeriod = currentPeriodNo(today) || 1;
  const defaultStart = periodStartISO(curPeriod) || FY_START_ISO;
  const defaultEnd = periodEndISO(curPeriod) || today;

  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");
  const start = urlStart || defaultStart;
  const end = urlEnd || defaultEnd;

  const rangeSelectionEarly = useMemo(() => inferRangeSelection(start, end), [start, end]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (urlAccount) {
      try { localStorage.setItem(LAST_ACCOUNT_KEY, urlAccount); } catch {}
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem(LAST_ACCOUNT_KEY); } catch {}
    const p = new URLSearchParams(searchParams.toString());
    if (saved && (isKnownAccount(saved) || PSEUDO_KEYS.has(saved))) {
      p.set("account", saved);
    } else {
      // Default landing: ALL
      p.set("account", "ALL");
    }
    router.replace(`/kpi/purchasing?${p.toString()}`);
  }, [urlAccount, router, searchParams]);

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!account) return;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(new Error("timeout_15s")), 15000);
    setLoadState("loading");
    setErrorMsg(null);
    const params = new URLSearchParams({ account, start, end });
    fetch(`/api/kpi/purchasing?${params.toString()}`, {
      credentials: "include",
      signal: ctrl.signal,
    })
      .then(async (r) => {
        clearTimeout(to);
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          setLoadState("error");
          setErrorMsg(body?.error || `HTTP ${r.status}`);
          setData(null);
          return;
        }
        setData(body);
        setLoadState("ok");
      })
      .catch((e) => {
        clearTimeout(to);
        if (e?.name === "AbortError") return;
        setLoadState("error");
        setErrorMsg(String(e?.message || e));
        setData(null);
      });
    return () => {
      clearTimeout(to);
      ctrl.abort();
    };
  }, [account, start, end, status]);

  const setParam = useCallback((key, value) => {
    const p = new URLSearchParams(searchParams.toString());
    if (value == null || value === "") p.delete(key);
    else p.set(key, value);
    router.replace(`/kpi/purchasing?${p.toString()}`);
  }, [router, searchParams]);

  const onPickAccount = useCallback((k) => setParam("account", k), [setParam]);

  const onRangeCommit = useCallback((s, e /*, sel */) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set("start", s);
    p.set("end", e);
    router.replace(`/kpi/purchasing?${p.toString()}`);
    try {
      localStorage.setItem(LAST_RANGE_KEY, JSON.stringify({ startISO: s, endISO: e }));
    } catch {}
  }, [router, searchParams]);

  // Derived: is aggregate?
  const isAggregate = AGGREGATE_KEYS.has(account);

  // Cost model - only defined for single account; aggregates get null.
  const costModel = useMemo(() => {
    if (!account || isAggregate) return null;
    try { return costModelFor(account); }
    catch { return null; }
  }, [account, isAggregate]);

  // Period-lifecycle: closed if range end < today. Provisional if
  // still inside the 16-day bill.com lag.
  const rangePeriodNo = rangeSelectionEarly?.kind === "period" ? rangeSelectionEarly.value : null;
  const closed = new Date(end) < new Date(today);
  const provisional = !!data?.provisional;

  // Chart / KPI figures
  const board = useMemo(() => {
    if (!data) return null;

    const byGlLineCode = data?.budget?.by_gl_line_code || [];
    const weekly = data?.weekly || [];
    const pending = Number(data?.pending?.amount || 0);
    const pendingLineCount = Number(data?.pending?.line_count || 0);
    const elapsedFrac = Number(data?.fiscal?.elapsed_frac ?? 0);
    const weeks = weekStartsInRange(start, end);
    const weeksInRange = weeks.length;

    // Period length for the target math. §5.1: original = budget /
    // weeksInPeriod, adjusted = (budget - finishedSpend) / (weeksInPeriod
    // - finishedWeeks). Read from fiscal.weeks_in_range - the route
    // already ships it (labor board follows the same convention). Never
    // hardcode: on a 35-week FYTD range 4 turns adjusted into a divide
    // by (4 - 35) = negative denom, blanking the caption while the bar
    // still draws spend.
    //
    // Guard degenerate ranges: fiscal.weeks_in_range should never be
    // <= 0 (the API resolves it from weekStartsInRange), but if the
    // fetch fails or the payload is malformed we fall back to the
    // client-side enumeration; if that is also zero, weeklyTargets
    // already returns { original: null, adjusted: null } on !(weeksInPeriod > 0).
    const weeksInPeriod = Number(data?.fiscal?.weeks_in_range) || weeksInRange || 0;

    // Chart render decision (PR 2 R3 Part B):
    //   Tier A (<= 6 weeks)  -> one bar per fiscal WEEK in range
    //   Tier B (7-13 weeks)  -> one bar per fiscal WEEK in range
    //   Tier C (14+ weeks)   -> one bar per fiscal PERIOD in range
    // No trailing-window truncation. WeekChart asserts rendered_units
    // == weeks.length (or periods.length for Tier C) so silent drops
    // cannot happen. Chart width still fits the card because the CSS
    // grid is repeat(N, minmax(0, 1fr)).
    const tier = classifyTier(weeksInRange);

    // Running-week index across the FULL weeks array (only when open).
    let runningWeekIdxFull = null;
    if (!closed) {
      const MS = 86400000;
      const todayTime = new Date(today).getTime();
      for (let i = 0; i < weeks.length; i += 1) {
        const wStart = new Date(weeks[i]).getTime();
        const wEnd = wStart + 6 * MS;
        if (todayTime >= wStart && todayTime <= wEnd) { runningWeekIdxFull = i; break; }
      }
      if (runningWeekIdxFull == null && weeks.length > 0) runningWeekIdxFull = 0;
    }
    const finishedWksAll = runningWeekIdxFull != null ? runningWeekIdxFull : weeks.length;

    // Period card KPI-line spend + budget.
    const kpiSpentPerWeek = periodWeeklySpend({ weekly, start, end });
    const kpiSpentPerWeekAmounts = kpiSpentPerWeek.map(w => Number(w.amount || 0));
    const kpiSpent = kpiSpentPerWeekAmounts.reduce((s, v) => s + v, 0);
    const kpiBud = kpiBudget({ byGlLineCode });

    // PR-2 R4 Part A: derive period-card Bills + Cards by SUMMING the
    // route.buckets[] rows so the period card equals the sum of its
    // buckets by construction. Prior code computed
    //   billsApprox = totals.pl_cogs.spent - card.spent + pending
    // which subtracted ALL coded card spend from pl_cogs.spent even
    // though card-coded spend on 5002.x (equipment/R&M) and 13xx
    // (reimbursable) does not sit in pl_cogs.spent, so period Bills
    // was structurally understated by that non-pl_cogs coded card
    // spend. Gate check 2 (bucket bills sum == period card Bills) fires
    // on the mismatch.
    const kpiBucketRows = (data?.buckets || []).filter(b =>
      ['food', 'packaging', 'vehicle'].includes(b.bucket));
    const kpiBills = kpiBucketRows.reduce((s, b) => s + Number(b.spent || 0), 0);
    const kpiCardsCoded = kpiBucketRows.reduce((s, b) => s + Number(b.cards_coded || 0), 0);
    const billsApprox = Math.round(kpiBills * 100) / 100;
    const cardCodedInSpend = Math.round(kpiCardsCoded * 100) / 100;

    // Weekly targets for the KPI card (finishedSpend uses KPI-line
    // spend across FINISHED weeks only, per §5.1). weeksInPeriod IS
    // fiscal.weeks_in_range so the divisor tracks the actual range,
    // not the hardcoded 4 that turned adjusted null on multi-period
    // ranges. finishedSpend is summed across ALL finished weeks in
    // the range (not just the four in the chart window) - the target
    // math describes the whole range, the chart shows the trailing
    // four bars of that range.
    const finishedWks = finishedWeekCount({ start, end, todayISO: today });
    const finishedKpiSpend = kpiSpentPerWeekAmounts
      .slice(0, finishedWks)
      .reduce((s, v) => s + v, 0);
    const kpiTargets = weeklyTargets({
      budget: kpiBud,
      weeksInPeriod,
      finishedSpend: finishedKpiSpend,
      finishedWeeks: finishedWks,
    });
    // Fiscal periods that intersect the requested range - Tier C
    // strips consume this. `route.periods` (spec §6.4) is FYTD
    // P1..currentP; filter to those with any overlap.
    const routePeriods = Array.isArray(data?.periods) ? data.periods : [];
    const rangePeriods = routePeriods.filter(p =>
      p.end >= start && p.start <= end);
    const decoratedPeriods = rangePeriods.map(p => {
      const pEnd = new Date(p.end).getTime();
      const pStart = new Date(p.start).getTime();
      const now = new Date(today).getTime();
      const finished = pEnd < now;
      const running = !finished && pStart <= now && now <= pEnd;
      return { ...p, finished, running };
    });
    // KPI-line units for the tier-aware strip.
    const kpiUnits = (() => {
      if (tier === "C") {
        const perPeriodSpend = new Map();
        for (let i = 0; i < weeks.length; i += 1) {
          const wIso = weeks[i];
          const pNo = periodOf(wIso);
          if (pNo == null) continue;
          perPeriodSpend.set(pNo, (perPeriodSpend.get(pNo) || 0) + Number(kpiSpentPerWeekAmounts[i] || 0));
        }
        // PR-2 R4 Part B - owner ruling 2026-08-24: per-period target
        // is THAT PERIOD's budget, not a flat range average. Sum
        // by_bucket food+packaging+vehicle from route.periods[] so
        // the KPI line matches the "food + packaging + vehicle"
        // hero. Route ships the per-bucket per-period rollup at
        // `route.periods[].by_bucket.{food,packaging,vehicle}.budget`
        // (envelope-excluded, from kpi_budgets).
        return decoratedPeriods.map(p => {
          const bb = p.by_bucket || {};
          const kpiPeriodBudget =
            Number(bb?.food?.budget || 0) +
            Number(bb?.packaging?.budget || 0) +
            Number(bb?.vehicle?.budget || 0);
          return {
            period_no: p.period_no,
            start: p.start,
            end: p.end,
            spent: perPeriodSpend.get(p.period_no) || 0,
            budget: Math.round(kpiPeriodBudget * 100) / 100,
            finished: p.finished,
            running: p.running,
          };
        });
      }
      return weeks.map((wIso, i) => {
        const finished = runningWeekIdxFull != null
          ? i < runningWeekIdxFull
          : true;
        const running = runningWeekIdxFull === i && !closed;
        return {
          start: wIso,
          spent: Number(kpiSpentPerWeekAmounts[i] || 0),
          targetOrig: kpiTargets.original,
          targetAdj: tier === "A" ? kpiTargets.adjusted : null,
          finished,
          running,
        };
      });
    })();

    // Per-bucket unit builder. Same weekly aggregation feeds each
    // tier: Tier A/B loops weeks; Tier C loops periods and reads
    // per-bucket per-period budget from route.periods[].by_bucket
    // (PR-2 R4 Part B).
    function buildUnitsForBucket(perWeekArr, budget, finishedSpendVal, bucketKey) {
      if (tier === "C") {
        // Aggregate weeks -> periods.
        const perPeriodSpend = new Map();
        for (let i = 0; i < weeks.length; i += 1) {
          const wIso = weeks[i];
          const pNo = periodOf(wIso);
          if (pNo == null) continue;
          perPeriodSpend.set(pNo, (perPeriodSpend.get(pNo) || 0) + Number(perWeekArr[i] || 0));
        }
        return decoratedPeriods.map(p => {
          // PR-2 R4 Part B - owner ruling 2026-08-24: per-period
          // per-bucket budget from kpi_budgets, envelope-excluded,
          // shipped as route.periods[].by_bucket.{food|packaging|
          // vehicle}.budget. Prior state divided the bucket's WHOLE-
          // RANGE budget by weeks_in_range * weeks_in_period(p) -
          // that flat-average target called P1 catastrophically under
          // and P3 catastrophically over on TBR - FL Food (P1 budget
          // $4,264 vs P3 budget $164,897).
          const bb = p.by_bucket || {};
          const perPeriodBudget = Number(bb?.[bucketKey]?.budget || 0);
          return {
            period_no: p.period_no,
            start: p.start,
            end: p.end,
            spent: perPeriodSpend.get(p.period_no) || 0,
            budget: Math.round(perPeriodBudget * 100) / 100,
            finished: p.finished,
            running: p.running,
          };
        });
      }
      // Tier A/B - one unit per fiscal week.
      const targets = weeklyTargets({
        budget,
        weeksInPeriod,
        finishedSpend: finishedSpendVal,
        finishedWeeks: finishedWksAll,
      });
      return weeks.map((wIso, i) => {
        const finished = runningWeekIdxFull != null
          ? i < runningWeekIdxFull
          : true;
        const running = runningWeekIdxFull === i && !closed;
        return {
          start: wIso,
          spent: Number(perWeekArr[i] || 0),
          targetOrig: targets.original,
          // Adjusted only meaningful in Tier A (spec §B4).
          targetAdj: tier === "A" ? targets.adjusted : null,
          finished,
          running,
        };
      });
    }

    // Bucket data - budget, spent, tier-aware units. `spent` and
    // `finishedSpend` sum the WHOLE range so the hero number + target
    // math describe the same period the pill does.
    //
    // PR-2 R4 Part A: route.buckets[] now ships `cards_coded` per
    // bucket alongside `spent` (bills-only). Client `spent` (from the
    // weekly view) MUST equal bills + cards for the same fiscal-week
    // footprint - the BucketCard §Part A assertion enforces it.
    // Previously `cardsCoded = max(0, spent - bills)` clamped any
    // mismatch to 0 and hid the three-figures-don't-agree bug.
    const buckets = BUCKET_DEFS.map(def => {
      const bud = bucketBudget({ byGlLineCode, bucketKey: def.key });
      const perWeekAll = bucketWeeklySpend({ weekly, bucketKey: def.key, start, end })
        .map(w => Number(w.amount || 0));
      const spent = perWeekAll.reduce((s, v) => s + v, 0);
      const finishedSpend = perWeekAll.slice(0, finishedWksAll).reduce((s, v) => s + v, 0);
      const units = buildUnitsForBucket(perWeekAll, bud, finishedSpend, def.key);
      const targets = weeklyTargets({
        budget: bud,
        weeksInPeriod,
        finishedSpend,
        finishedWeeks: finishedWksAll,
      });
      const routeBucket = (data?.buckets || []).find(b => b.bucket === def.key);
      const billsForBucket = routeBucket ? Number(routeBucket.spent || 0) : spent;
      const cardsCoded = routeBucket ? Number(routeBucket.cards_coded || 0) : 0;
      return {
        ...def,
        budget: bud,
        spent,
        bills: billsForBucket,
        cardsCoded,
        units,
        targets,
      };
    });

    // Ledger cards - equipment + R&M + reimbursable via categories[]
    // and the PR-2 R6 Part B capped `ledgers.*` block from the route.
    const ledgers = LEDGER_DEFS.map(def => {
      // Hero sums categories[] for a single gl line code OR a family.
      let cat = null;
      let bud = 0;
      let spent = 0;
      if (def.glLineCode) {
        cat = categoryFor(data?.categories, def.glLineCode);
        bud = cat ? Number(cat.budget || 0) : 0;
        spent = cat ? Number(cat.spent || 0) : 0;
      } else if (def.glLikePrefix) {
        // Family bucket (e.g. reimbursable 13xx) - sum every matching
        // category's { budget, spent }. Same source of truth the route
        // uses to compute `ledger_reconciliation.reimbursable.hero`.
        const matches = (data?.categories || []).filter(c =>
          String(c.gl_line_code || "").startsWith(def.glLikePrefix));
        bud = matches.reduce((s, c) => s + Number(c.budget || 0), 0);
        spent = matches.reduce((s, c) => s + Number(c.spent || 0), 0);
      }
      // Per-card capped ledger rows from the route's PR-2 R6 payload.
      // Missing block -> empty (LedgerCard renders "line detail lands
      // with the drill route" when hero > 0, or "no purchases" when 0).
      const ledgerData = data?.ledgers?.[def.payloadKey] || null;
      const ledgerRows = ledgerData?.rows || [];
      const totalCount = ledgerData?.total_count ?? null;
      const totalAmount = ledgerData?.total_amount ?? null;
      const cap = ledgerData?.cap ?? null;
      return { ...def, budget: bud, spent, ledgerRows, totalCount, totalAmount, cap };
    });

    return {
      byGlLineCode,
      weekly,
      pending,
      pendingLineCount,
      elapsedFrac,
      weeks,
      weeksInRange,
      weeksInPeriod,
      tier,
      runningWeekIdxFull,
      kpiSpent,
      kpiSpentPerWeek,
      kpiUnits,
      kpiBud,
      kpiTargets,
      buckets,
      ledgers,
      billsApprox,
      cardCodedInSpend,
      decoratedPeriods,
    };
  }, [data, closed, start, end, today]);

  // Header text / fiscal chip context.
  const fiscalCtx = useMemo(() => {
    const p = rangePeriodNo || (data?.fiscal?.period_no ?? null);
    const w = start ? weekOfPeriod(today) : null;
    // PR-2 R2 Fix 9 - Shell renders `Today <b>{fiscal.today}</b>`. Labor
    // ships MM/DD; purchasing was shipping raw ISO ("2026-08-24"). Match
    // labor's convention exactly.
    return {
      today: today.slice(5).replace("-", "/"),
      period: p,
      week: w,
    };
  }, [rangePeriodNo, data?.fiscal?.period_no, today, start]);

  // Range label (period card meta).
  const rangeLabel = useMemo(() => {
    if (!start || !end) return "";
    return `${isoToMMDDYY(start)} - ${isoToMMDDYY(end)}`;
  }, [start, end]);

  // PR-2 R2 Fix 5 - derive account_periods client-side from the fiscal
  // calendar so `This period` and `Last period` presets fire. Prior state
  // passed `accountPeriods: []` with `hasPeriods: true` - a lie the
  // RangeMenu's `resolvePreset` believed, filtered the empty array,
  // returned null, and the commit never fired. Every past+current period
  // has known bounds via `rangeForPeriod`; use them.
  const accountPeriods = useMemo(() => {
    const curP = currentPeriodNo(today) || 1;
    const out = [];
    for (let p = 1; p <= curP; p += 1) {
      const r = rangeForPeriod(p);
      if (r) out.push({ fiscal_year: 2026, period_no: p, start: r.startISO, end: r.endISO });
    }
    return out;
  }, [today]);

  // PR-2 R2 Fix 6 - infer preset so the range trigger reads `FYTD`
  // (or `This period`, `Last period`, ...) instead of `Custom
  // 12/29/25 - 08/24/26`. Mirrors labor's inference exactly.
  const resolvedPreset = useMemo(() => {
    if (start === FY_START_ISO && end === today) return "fytd";
    if (start === addDaysISO(today, -27) && end === today) return "last_4wk";
    // Range PR-2 2026-08-24: last_13wk inference retired alongside
    // the labor picker sweep. A hand-crafted URL landing on the exact
    // today-90..today window now infers as a custom range, matching
    // what the picker itself can produce.
    if (accountPeriods.length) {
      const past = [...accountPeriods]
        .filter(p => p.start && p.end && p.start <= today)
        .sort((a, b) => a.start.localeCompare(b.start));
      const cur = past[past.length - 1];
      const prev = past[past.length - 2];
      if (cur && start === cur.start && end === cur.end) return "this_period";
      if (prev && start === prev.start && end === prev.end) return "last_period";
    }
    return null;
  }, [start, end, today, accountPeriods]);

  // Projected close.
  const projClose = useMemo(() => {
    if (!board) return null;
    if (closed) return null;
    return projectedCloseCalc({
      bills: board.billsApprox,
      pending: board.pending,
      elapsedFrac: board.elapsedFrac,
    });
  }, [board, closed]);

  // Render body ────────────────────────────────────────────────────
  const isPassThrough = costModel === "pass_through";

  // PR-2 R5 Part B - two freshness surfaces, one status split (owner
  // rulings 2026-08-24). Labor's pattern: pill = STATUS ("Data
  // current" / "Data slow" / "Data stale"), card = DETAIL ("LAST
  // PULLED …"). Purchasing keeps the split but the pill reflects the
  // WORST of the two sources - bills (last_derive_at) + cards
  // (cards_through, anchored end-of-day) - so it never claims
  // currency the board does not have. Rule 2 (no changes under
  // labor/) is honoured: we compute the worst-case ISO here and pass
  // it as Shell's `freshness.last_walk_at`; Shell's copy stays fixed.
  // Never hardcoded - both timestamps come off route.freshness.
  const cardsThroughISO = data?.freshness?.cards_through || null;
  const cardsThroughLabel = cardsThroughISO
    ? `${cardsThroughISO.slice(5, 7)}/${cardsThroughISO.slice(8, 10)}`
    : null;
  const cardsFreshAnchorISO = cardsThroughISO
    ? `${cardsThroughISO}T23:59:59Z`
    : null;
  const lastDeriveISO = data?.freshness?.last_derive_at || null;
  // Older ISO = older source = worst freshness (larger hoursSince).
  let worstSourceISO = null;
  if (lastDeriveISO && cardsFreshAnchorISO) {
    worstSourceISO = lastDeriveISO < cardsFreshAnchorISO
      ? lastDeriveISO
      : cardsFreshAnchorISO;
  } else {
    worstSourceISO = lastDeriveISO || cardsFreshAnchorISO;
  }

  const boardContent = (() => {
    if (loadState === "loading" || loadState === "idle") {
      return (
        <div className="kpi-p-board" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading purchasing board</span>
          <div className="kpi-p-emptybucket">Loading …</div>
        </div>
      );
    }
    if (loadState === "error") {
      return (
        <div className="kpi-p-placeholder" role="alert">
          <h2>Board did not load</h2>
          <p>{errorMsg || "Unknown error"}</p>
        </div>
      );
    }
    if (!data || !board) return null;

    if (isPassThrough) {
      const acctMeta = (data?.members || [])[0];
      return (
        <div className="kpi-p-board">
          <PassThroughPlaceholder account={account} client={acctMeta || account} />
        </div>
      );
    }

    // "week X of N" for the period header. runningWeekIdxFull is the
    // index inside the FULL weeks array so no chart-window offset is
    // needed - the header reads "week 35 of 35" on a 35-week range.
    const wop = board.runningWeekIdxFull != null ? board.runningWeekIdxFull + 1 : null;
    const weeksInPeriodDenom = board.weeksInPeriod || board.weeksInRange || null;

    // Card title follows the range PRESET like labor's card title.
    // §B3 owner ruling 2026-08-24: "PERIOD -" with a blank number on
    // every multi-period range was a UX regression. "PERIOD n" is only
    // correct when the range EQUALS a single fiscal period.
    const cardTitle = (() => {
      if (resolvedPreset === "fytd") return "FISCAL YEAR TO DATE";
      if (resolvedPreset === "last_4wk") return "THE LAST 4 WEEKS";
      // Range PR-2 2026-08-24: last_13wk band label retired alongside
      // the inference above and the preset itself.
      if (resolvedPreset === "this_period" || resolvedPreset === "last_period" || rangePeriodNo != null) {
        return `PERIOD ${rangePeriodNo}`;
      }
      // Custom range - use the date range as the title so nothing
      // shows a blank number.
      return rangeLabel ? rangeLabel.toUpperCase() : "CUSTOM RANGE";
    })();

    // PR-2 R5 Part B - sub-line detail (kpi-p-livenote): named
    // detail complementing the status pill above. The worst-source
    // anchor + pill label are computed at the outer scope so Shell
    // reads the same freshness the note explains.
    const freshnessDetail = cardsThroughLabel
      ? `Bills current · cards through ${cardsThroughLabel}`
      : "Bills current";

    return (
      <div className="kpi-p-board">
        <div className="kpi-p-livenote" role="status">
          <span className="kpi-p-livedot" aria-hidden="true" />
          <span><b>{freshnessDetail}</b></span>
        </div>
        <PeriodCard
          periodNo={rangePeriodNo}
          rangeLabel={rangeLabel}
          weekOfPeriod={wop}
          weeksInPeriod={weeksInPeriodDenom}
          elapsedFrac={board.elapsedFrac}
          closed={closed}
          provisional={provisional}
          spent={board.kpiSpent}
          budget={board.kpiBud}
          bills={board.billsApprox}
          cards={board.cardCodedInSpend}
          cardsThroughLabel={cardsThroughLabel}
          pending={board.pending}
          tier={board.tier}
          units={board.kpiUnits}
          original={board.kpiTargets.original}
          adjusted={board.kpiTargets.adjusted}
          budgetSpent={board.kpiTargets.budgetSpent}
          projectedClose={projClose}
          cardTitle={cardTitle}
        />

        {board.buckets.map(b => (
          <BucketCard
            key={b.key}
            bucketKey={b.key}
            label={b.label}
            sub={b.sub}
            strokeClass={b.strokeClass}
            identity={b.key === "packaging" ? "pkg" : (b.key === "vehicle" ? "veh" : "food")}
            budget={b.budget}
            spent={b.spent}
            bills={b.bills}
            cardsCoded={b.cardsCoded}
            elapsedFrac={board.elapsedFrac}
            closed={closed}
            tier={board.tier}
            units={b.units}
            original={b.targets.original}
            adjusted={b.targets.adjusted}
            budgetSpent={b.targets.budgetSpent}
          />
        ))}

        <div className="kpi-p-flatrow">
          {board.ledgers.map(l => (
            <LedgerCard
              key={l.key}
              bucketKey={l.key}
              label={l.label}
              sub={l.sub}
              strokeClass={l.strokeClass}
              budget={l.budget}
              spent={l.spent}
              elapsedFrac={board.elapsedFrac}
              closed={closed}
              ledgerRows={l.ledgerRows}
              totalCount={l.totalCount}
              totalAmount={l.totalAmount}
              cap={l.cap}
              isAggregate={isAggregate}
            />
          ))}
        </div>

        <div className="kpi-p-pairrow">
          <CardPurchases
            pendingAmount={board.pending}
            pendingLineCount={board.pendingLineCount}
            closed={closed}
            /* PR-2 R6 Part B - per-charge rows from the route
               (uncoded rippling_spend, capped at 50). */
            rows={data?.card_charges?.rows}
            totalCount={data?.card_charges?.total_count}
            totalAmount={data?.card_charges?.total_amount}
            cap={data?.card_charges?.cap}
            isAggregate={isAggregate}
          />
          <VendorBreakdown
            account={account}
            /* PR-2 R6 Part B - per-vendor rollup from the route
               (billcom_ref_vendors resolution, capped at 25). */
            rows={data?.vendors?.rows}
            totalCount={data?.vendors?.total_count}
            totalAmount={data?.vendors?.total_amount}
            cap={data?.vendors?.cap}
            unresolvedCount={data?.vendors?.unresolved_count}
            fragmentation={data?.vendors?.fragmentation}
            isAggregate={isAggregate}
          />
        </div>
      </div>
    );
  })();

  return (
    <div className="kpi-app">
      <div className="kpi-wrap">
        <Shell
          account={account || "…"}
          fiscal={fiscalCtx}
          freshness={{ last_walk_at: worstSourceISO }}
          dataLoading={loadState === "loading" || loadState === "idle"}
          activeSection="purchasing"
          rangeProps={data ? {
            startISO: start,
            endISO: end,
            todayISO: today,
            // PR-2 R2 Fix 5 / Fix 6: reflect reality. `hasPeriods` is
            // true only when we actually shipped periods; `accountPeriods`
            // carries them; `resolvedPreset` names the current preset so
            // the trigger reads `FYTD` etc instead of `Custom ...`.
            hasPeriods: accountPeriods.length > 0,
            accountPeriods,
            resolvedPreset,
            selectedPeriodNo: rangeSelectionEarly?.kind === "period" ? rangeSelectionEarly.value : null,
            selectedMonth: rangeSelectionEarly?.kind === "month" ? rangeSelectionEarly.value : null,
            onCommit: onRangeCommit,
          } : null}
          exportHref={null}
          folioRail={
            <FolioRail
              activeAccount={account}
              onPickAccount={onPickAccount}
              /* PR-2 R2 Fix 7: pass the live directory the route now ships.
                 Prior undefined forced STATIC_DIRECTORY (team_name null on
                 every row), leaving 8/11 rail rows blank. */
              accountsDirectory={data?.accounts_directory}
              regionalDirectorsDisplay={undefined}
              folioFoot={null}
            />
          }
          main={boardContent}
        />
      </div>
    </div>
  );
}

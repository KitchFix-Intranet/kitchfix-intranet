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
  FY_END_ISO,
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
import { costModelFor, isKnownAccount, goalFor } from "@/lib/accountModels";
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
// PR 3 - management-fee board components. Renders instead of the
// at-risk cards for CIN - OH, STL - FL, STL - MO.
import { ManagementFeeCard } from "./components/ManagementFeeCard";
import { ReimbursableRow } from "./components/ReimbursableRow";
import { FunMoneyCard } from "./components/FunMoneyCard";
// PR 2 R9 P0 - dedicated period card for pass-through accounts.
// The shared PeriodCard is only fed KPI-line spend (food + packaging
// + vehicle) which is essentially Fun Money at these sites and left
// the card reading $0.00 while $11k+ moved through reimbursable.
import { PassThroughPeriodCard } from "./components/PassThroughPeriodCard";
// PR 4 - drill-down table. Sits below Card purchases on the at-risk
// board. Pass-through boards skip the table (§2 - no COGS distinction
// to check; the ReimbursableRow already carries the 13xx ledger).
import { PurchasingTable } from "./components/PurchasingTable";
// PR 5 - loading skeleton + failure card.
import { SkeletonBoard } from "./components/SkeletonBoard";
import { FailureCard } from "./components/FailureCard";

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
  // PR 5 - keep the last-known freshness across a failed fetch so
  // the FailureCard can report `when it last worked` from real
  // timestamps. `freshness` is stored on `data`, but a failure sets
  // data = null; without a separate copy, "last worked" would be
  // "unknown" every time. Updated whenever a successful fetch lands.
  const [lastFreshness, setLastFreshness] = useState(null);
  // PR 5 - retry counter. FailureCard's Try-again button bumps this;
  // the fetch effect re-runs when the counter changes.
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (status === "loading") return;
    if (!account) return;
    const ctrl = new AbortController();
    // PR 5 - timeout FIRES the abort with a NAMED reason we can
    // detect in the catch block. Prior code called `ctrl.abort()`
    // and returned early on AbortError, which left loadState stuck
    // on 'loading' forever. Now the abort carries a `timeout_15s`
    // flag we surface as an error.
    let timedOut = false;
    const to = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, 15000);
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
        if (body?.freshness) setLastFreshness(body.freshness);
        setLoadState("ok");
      })
      .catch((e) => {
        clearTimeout(to);
        // PR 5 - timeout aborts surface as failure now (Check 6 - a
        // timeout that silently stays in `loading` is the failure
        // mode that looks like nothing happened). A NON-timeout
        // AbortError is still an intentional teardown (e.g. account
        // switched mid-flight) and should bail without surfacing.
        if (e?.name === "AbortError" && !timedOut) return;
        setLoadState("error");
        setErrorMsg(timedOut ? "request timed out after 15 seconds" : String(e?.message || e));
        setData(null);
      });
    return () => {
      clearTimeout(to);
      ctrl.abort();
    };
  }, [account, start, end, status, retryCount]);

  // PR 5 - skeleton show-delay. Delay showing the skeleton so a
  // fast fetch does not flash a skeleton for 80ms then disappear.
  // Measured warm P50 for /api/kpi/purchasing at ~2.5s (cold ~7s);
  // 150ms hides the flash on browser-cache hits without hiding the
  // skeleton on real fetches. The idle -> loading transition also
  // waits (rendering "Loading ..." with nothing visible for 150ms
  // is still better than a flashing skeleton).
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    if (loadState !== "loading" && loadState !== "idle") {
      setShowSkeleton(false);
      return;
    }
    const t = setTimeout(() => setShowSkeleton(true), 150);
    return () => clearTimeout(t);
  }, [loadState]);

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

  // PR 2 R9 P1-1 - like-for-like vs-prior scale. When the range is a
  // SINGLE IN-PROGRESS PERIOD, `prior_spend` covers a FULL prior
  // period; comparing part-current vs whole-prior guarantees a large
  // negative percentage on every vendor. Scale prior by elapsedFrac
  // so a 57%-through-P9 view compares vs 57% of P8. Null in every
  // other case - FYTD, LAST 4 wk, closed single-periods already
  // compare like-for-like.
  const midPeriodElapsedFrac = (
    rangePeriodNo != null
    && !closed
    && !(data?.is_future_range)
    && Number.isFinite(Number(data?.fiscal?.elapsed_frac))
  ) ? Number(data.fiscal.elapsed_frac) : null;

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

  // PR 2 R8 - align with labor. Server ships `is_future_range` true
  // when the requested START is strictly after today (labor
  // route.js:317, purchasing route addendum this PR). Broader Kevin
  // rule 2026-08-24: no spend means no verdict. We suppress the
  // projected-close row + swap the "% elapsed" header for "hasn't
  // started" so a future range cannot render "would close $X under
  // budget" - the false congratulation the labor brief predicted.
  //
  // Client-side does NOT recompute a parallel flag; the server flag is
  // the single source (rule: "consume the same server flag; do not
  // build a parallel one").
  const isFutureRange = data?.is_future_range === true;

  // Projected close.
  const projClose = useMemo(() => {
    if (!board) return null;
    if (closed) return null;
    if (isFutureRange) return null;
    return projectedCloseCalc({
      bills: board.billsApprox,
      pending: board.pending,
      elapsedFrac: board.elapsedFrac,
    });
  }, [board, closed, isFutureRange]);

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
      // PR 5 - skeleton the actual layout after a 150ms delay to
      // avoid a flash on very fast fetches. Pre-150ms: an accessible
      // status row (screen-reader hears "Loading purchasing board")
      // with no visual, which is quieter than the old "Loading ..."
      // placeholder.
      return showSkeleton ? (
        <SkeletonBoard />
      ) : (
        <div className="kpi-p-board" role="status" aria-live="polite" aria-busy="true">
          <span className="sr-only">Loading purchasing board</span>
        </div>
      );
    }
    if (loadState === "error") {
      // PR 5 - Check 6 gate. FailureCard uses REAL freshness (from
      // the last successful load on this page). If we have never
      // loaded successfully on this session, lastFreshness is null
      // and the card says "unknown" for each timestamp - never a
      // fabricated one.
      return (
        <FailureCard
          errorMsg={errorMsg}
          freshness={lastFreshness}
          onRetry={() => setRetryCount(c => c + 1)}
        />
      );
    }
    if (!data || !board) return null;

    if (isPassThrough) {
      // PR 3 - management-fee board (spec §2, §6.7).
      // Layout, top to bottom (Kevin ruling 2026-08-24 + v22 render):
      //   1. ManagementFeeCard           - annual goal, progress, 8-period trend
      //   2. PeriodCard (passthru state) - same shape, no verdict
      //   3. FunMoneyCard                - STL - FL only, real verdict on 3200.2
      //   4. ReimbursableRow             - full width, category split + ledger
      //   5. Equipment + R&M + Vendor    - three-up flatrow (reused from at-risk)
      //   6. CardPurchases               - full width (reused from at-risk)
      // COGS bucket cards are absent (§2 - would render as zeros).
      const acctMeta = (data?.accounts_directory || []).find(a => a.team_key === account);
      const clientLabel = acctMeta?.team_name || account;
      let goalRow = null;
      try { goalRow = goalFor(account); } catch { goalRow = null; }

      // Calendar-year fraction elapsed vs FY2026 window. Stable across
      // the day; used as the marker on the mgmt-fee progress bar.
      const fyStartMs = new Date(FY_START_ISO + "T00:00:00Z").getTime();
      const fyEndMs   = new Date(FY_END_ISO   + "T23:59:59Z").getTime();
      const todayMs   = new Date(today       + "T12:00:00Z").getTime();
      const yearElapsedFrac = fyEndMs > fyStartMs
        ? Math.max(0, Math.min(1, (todayMs - fyStartMs) / (fyEndMs - fyStartMs)))
        : 0;

      // Reimbursable stuff, all from route.
      const mgmt = data?.mgmt_fee || null;
      const reimbTotal = Number(data?.totals?.reimbursable?.spent || 0);
      const cats13 = (data?.categories || [])
        .filter(c => String(c.gl_line_code || "").startsWith("13"));

      // Card title matches at-risk logic.
      const wop = board.runningWeekIdxFull != null ? board.runningWeekIdxFull + 1 : null;
      const weeksInPeriodDenom = board.weeksInPeriod || board.weeksInRange || null;
      const cardTitle = (() => {
        if (resolvedPreset === "fytd") return "FISCAL YEAR TO DATE";
        if (resolvedPreset === "last_4wk") return "THE LAST 4 WEEKS";
        if (resolvedPreset === "this_period" || resolvedPreset === "last_period" || rangePeriodNo != null) {
          return `PERIOD ${rangePeriodNo}`;
        }
        return rangeLabel ? rangeLabel.toUpperCase() : "CUSTOM RANGE";
      })();

      return (
        <div className="kpi-p-board">
          <div className="kpi-p-livenote" role="status">
            <span className="kpi-p-livedot" aria-hidden="true" />
            <span><b>Food, packaging and supplies are billed back to {clientLabel}. No verdict on this board - the reimbursable line is not a KitchFix cost.</b></span>
          </div>

          <ManagementFeeCard
            account={account}
            client={clientLabel}
            goal={goalRow}
            goalFytdSpent={mgmt?.goal_fytd_spent}
            periodsTrend={mgmt?.periods_trend || []}
            yearElapsedFrac={yearElapsedFrac}
          />

          {/* PR 2 R9 P0 - pass-through period card shows TOTAL activity
              (reimbursable + Fun Money), not the KPI-line-only view the
              shared PeriodCard produces. That view left $0.00 next to
              $11k+ of client-billed activity at STL - FL P9 and
              duplicated the Fun Money card immediately below. Fun Money
              still gets its own card as the VERDICT surface (real
              state on 3200.2). */}
          <PassThroughPeriodCard
            cardTitle={cardTitle}
            rangeLabel={rangeLabel}
            weekOfPeriod={wop}
            weeksInPeriod={weeksInPeriodDenom}
            elapsedFrac={board.elapsedFrac}
            closed={closed}
            provisional={provisional}
            isFutureRange={isFutureRange}
            reimbursableSpent={reimbTotal}
            funMoneySpent={mgmt?.fun_money?.spent}
            funMoneyBudget={mgmt?.fun_money?.budget}
            pending={board.pending}
            cardsThroughLabel={cardsThroughLabel}
          />

          {mgmt?.fun_money && (
            <FunMoneyCard
              funMoney={mgmt.fun_money}
              elapsedFrac={board.elapsedFrac}
              closed={closed}
              isFutureRange={isFutureRange}
            />
          )}

          <ReimbursableRow
            account={account}
            client={clientLabel}
            spent={reimbTotal}
            annualGoal={goalRow?.annual}
            categories={cats13}
            ledgerRows={data?.ledgers?.reimbursable?.rows}
            ledgerTotalCount={data?.ledgers?.reimbursable?.total_count}
            ledgerTotalAmount={data?.ledgers?.reimbursable?.total_amount}
            ledgerCap={data?.ledgers?.reimbursable?.cap}
            isAggregate={false}
          />

          <div className="kpi-p-flatrow kpi-p-flatrow-3up">
            {board.ledgers
              .filter(l => l.key === "equip" || l.key === "rm")
              .map(l => (
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
                  isFutureRange={isFutureRange}
                  ledgerRows={l.ledgerRows}
                  totalCount={l.totalCount}
                  totalAmount={l.totalAmount}
                  cap={l.cap}
                  isAggregate={isAggregate}
                />
              ))}
            <VendorBreakdown
              account={account}
              rows={data?.vendors?.rows}
              totalCount={data?.vendors?.total_count}
              totalAmount={data?.vendors?.total_amount}
              cap={data?.vendors?.cap}
              unresolvedCount={data?.vendors?.unresolved_count}
              fragmentation={data?.vendors?.fragmentation}
              priorHasData={data?.vendors?.prior_has_data}
              priorRange={data?.vendors?.prior_range}
              midPeriodElapsedFrac={midPeriodElapsedFrac}
              isAggregate={isAggregate}
            />
          </div>

          <CardPurchases
            pendingAmount={board.pending}
            pendingLineCount={board.pendingLineCount}
            closed={closed}
            rows={data?.card_charges?.rows}
            totalCount={data?.card_charges?.total_count}
            totalAmount={data?.card_charges?.total_amount}
            cap={data?.card_charges?.cap}
            isAggregate={isAggregate}
          />
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
          isFutureRange={isFutureRange}
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
            isFutureRange={isFutureRange}
            tier={board.tier}
            units={b.units}
            original={b.targets.original}
            adjusted={b.targets.adjusted}
            budgetSpent={b.targets.budgetSpent}
          />
        ))}

        {/* PR 2 R7 Fix 5 - three-up: [Equipment] [R&M] [Vendor breakdown]
            on one flatrow, then Reimbursable (full width), then Card
            purchases (full width). Kevin's ruling 2026-08-24:
              [ Equipment ] [ Repair & maintenance ] [ Vendor breakdown ]
              [ Card purchases ................................ ]
            Reimbursable isn't shown in Kevin's diagram; it stays as a
            full-width row above Card purchases so no card is dropped.
            Measured at 1600px viewport - Vendor breakdown lands at
            ~382px card width; its grid rebalances to fit four columns
            (see .kpi-p-flatrow-3up .kpi-p-vbrow rule). */}
        <div className="kpi-p-flatrow kpi-p-flatrow-3up">
          {board.ledgers
            .filter(l => l.key === "equip" || l.key === "rm")
            .map(l => (
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
                isFutureRange={isFutureRange}
                ledgerRows={l.ledgerRows}
                totalCount={l.totalCount}
                totalAmount={l.totalAmount}
                cap={l.cap}
                isAggregate={isAggregate}
              />
            ))}
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
            /* PR 2 R7 Fix 2 - gate the "new" / "no prior period" split
               on whether the compared window has data at all. */
            priorHasData={data?.vendors?.prior_has_data}
            priorRange={data?.vendors?.prior_range}
            /* PR 2 R9 P1-1 - scale prior by elapsed fraction on
               single in-progress periods so vs-prior is like-for-like. */
            midPeriodElapsedFrac={midPeriodElapsedFrac}
            isAggregate={isAggregate}
          />
        </div>

        {/* Reimbursable - full width. Not shown in Kevin's 3-up diagram,
            but the card exists on the board (Fix 4 target); placing it
            here keeps every card visible without cramming a fourth
            column into the three-up row. */}
        {board.ledgers
          .filter(l => l.key === "reimb")
          .map(l => (
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
              isFutureRange={isFutureRange}
              ledgerRows={l.ledgerRows}
              totalCount={l.totalCount}
              totalAmount={l.totalAmount}
              cap={l.cap}
              isAggregate={isAggregate}
            />
          ))}

        {/* Card purchases - full width per Kevin's diagram. */}
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

        {/* PR 4 - drill-down table. Sits below Card purchases on the
            at-risk board. Bill rows load on expand via scoped GET;
            the mount payload is unchanged. Footer totals asserted to
            equal bucket card heroes (§9B one-source rule, Check 1). */}
        <PurchasingTable
          account={account}
          start={start}
          end={end}
          tier={board.tier}
          weeks={board.weeks}
          decoratedPeriods={board.decoratedPeriods}
          weekly={board.weekly}
          heroTotals={{
            food:      board.buckets.find(b => b.key === "food")?.spent      || 0,
            packaging: board.buckets.find(b => b.key === "packaging")?.spent || 0,
            vehicle:   board.buckets.find(b => b.key === "vehicle")?.spent   || 0,
            equipment: board.ledgers.find(l => l.key === "equip")?.spent     || 0,
            repair:    board.ledgers.find(l => l.key === "rm")?.spent        || 0,
          }}
          isAggregate={isAggregate}
          weeksInRange={board.weeksInRange}
        />
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
          // PR 2 R8 Gap 2 - Export what is on screen at the displayed
          // grain. Server figures only - the export route fetches the
          // same read route this page fetches and copies the payload
          // into cells. Match labor's placement (Shell wires it into
          // the top command bar).
          exportHref={data && account
            ? `/api/kpi/purchasing/export?account=${encodeURIComponent(account)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${resolvedPreset ? `&view_name=${encodeURIComponent(resolvedPreset)}&view_date_mode=preset` : ""}`
            : null}
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

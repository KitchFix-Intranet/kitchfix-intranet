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
// 2026-08-28 preview mode - adopts labor's shared helpers.
import { deriveClientAccount } from "@/lib/kpi/previewAccess";
// 2026-08-28 freshness popover - reuse labor's formatter so purchasing
// renders the timestamps the same way.
import { fmtTimestamp, hoursSinceISO } from "@/app/kpi/labor/lib/formatting";

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
import { CardCompliance } from "./components/CardCompliance";
// R15 E - VendorBreakdown deleted.  It carried a `vs prior` column and a
// fragmentation footer; both were ruled not-delivering-value.  The three
// matched ledger cards + the drill table cover the vendor view now.
// PR 3 - management-fee board components. Renders instead of the
// at-risk cards for CIN - OH, STL - FL, STL - MO.
import { ManagementFeeCard } from "./components/ManagementFeeCard";
// R14 - FunMoneyCard removed; fun money renders inline in ManagementFeeCard.
// PR 2 R9 P0 - dedicated period card for pass-through accounts.
// The shared PeriodCard is only fed KPI-line spend (food + packaging
// R14 - PassThroughPeriodCard and ReimbursableRow deleted; the R14
// ManagementFeeCard consumes both in a single two-pane card.
// PR 4 - drill-down table. Sits below Card purchases on the at-risk
// board. Pass-through boards skip the table (§2 - no COGS distinction
// to check; the ReimbursableRow already carries the 13xx ledger).
import { PurchasingTable } from "./components/PurchasingTable";
// PR 5 - loading skeleton + failure card.
import { SkeletonBoard } from "./components/SkeletonBoard";
import { FailureCard } from "./components/FailureCard";

// Format ISO date -> "MM/DD" for chart week captions.
// R13 P0-2 - per-unit elapsed fraction for a running WEEK.  Days
// since week_start (inclusive of today) divided by 7.  Only meaningful
// when called against the running week; the running-unit projection
// gate in WeekChart uses this to decide whether to draw the dashed
// extension.
function weekElapsedFrac(weekStartISO, todayISO) {
  const startMs = new Date(weekStartISO + "T00:00:00Z").getTime();
  const todayMs = new Date(todayISO + "T00:00:00Z").getTime();
  const days = Math.floor((todayMs - startMs) / 86400000) + 1;
  return Math.max(0, Math.min(1, days / 7));
}

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
  // 2026-08-28 preview mode - `preview=` is threaded through every
  // client fetch + URL rewrite.  Server intersects it against real
  // access via resolvePreviewAccess and returns preview_account in
  // the payload; the chip derives from that.
  const urlPreview = searchParams.get("preview") || "";
  const account = urlAccount || "";

  const today = new Date().toISOString().slice(0, 10);
  const curPeriod = currentPeriodNo(today) || 1;
  const defaultStart = periodStartISO(curPeriod) || FY_START_ISO;
  const defaultEnd = periodEndISO(curPeriod) || today;

  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");
  // R15 2026-08-27: `?preset=<kind>` in the URL was silently ignored
  // before this - page.js only read start/end, so any preset URL fell
  // back to the current period.  A URL parameter that looked like it
  // worked and was ignored.  The picker writes explicit dates so no
  // real user hits it via navigation; hand-crafted URLs, bookmarks,
  // and probe sweeps did.  Resolves the preset here so the URL means
  // what it says.  Canonicalization to ?start=X&end=Y happens in the
  // effect below.
  const urlPreset = searchParams.get("preset");
  const presetResolved = (() => {
    if (!urlPreset || urlStart || urlEnd) return null;
    if (urlPreset === "fytd")     return { startISO: FY_START_ISO,          endISO: today };
    // 2026-09-02: last_4wk preset retired.
    if (urlPreset === "this_period") {
      const r = rangeForPeriod(curPeriod);
      return r ? { startISO: r.startISO, endISO: r.endISO } : null;
    }
    if (urlPreset === "last_period" && curPeriod > 1) {
      const r = rangeForPeriod(curPeriod - 1);
      return r ? { startISO: r.startISO, endISO: r.endISO } : null;
    }
    return null;
  })();
  const start = urlStart || presetResolved?.startISO || defaultStart;
  const end   = urlEnd   || presetResolved?.endISO   || defaultEnd;

  const rangeSelectionEarly = useMemo(() => inferRangeSelection(start, end), [start, end]);

  // R15 - canonicalize a resolved preset URL to ?start=X&end=Y so the
  // shape one arrives at (bookmark, share, screenshot) matches the
  // shape the picker writes.  Runs after mount because router.replace
  // is a client-only effect.  Note: this does NOT resolve the SSR
  // hydration mismatch that fires on every preset URL - that comes
  // from `today = new Date()` differing between server render and
  // client hydration, unrelated to this canonicalization.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!urlPreset || urlStart || urlEnd || !presetResolved) return;
    const p = new URLSearchParams(searchParams.toString());
    p.delete("preset");
    p.set("start", presetResolved.startISO);
    p.set("end",   presetResolved.endISO);
    router.replace(`/kpi/purchasing?${p.toString()}`);
  }, [urlPreset, urlStart, urlEnd, presetResolved, router, searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (urlAccount) {
      try { localStorage.setItem(LAST_ACCOUNT_KEY, urlAccount); } catch {}
      return;
    }
    // 2026-08-28 preview mode - do NOT auto-inject ?account= when the
    // URL carries ?preview=.  Preview supplies the effective account
    // server-side; appending &account=ALL here would leave the URL
    // contradicting itself (same failure mode as labor's #874).
    if (urlPreview) return;
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
  }, [urlAccount, urlPreview, router, searchParams]);

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
    // 2026-08-28 preview - thread ?preview= through to the API.
    // Without this the server never sees preview and always returns
    // the URL account.  (This was the "?preview= silently ignored"
    // bug Kevin found.)
    const params = new URLSearchParams({ account, start, end });
    if (urlPreview) params.set("preview", urlPreview);
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
    // PR-2 R11 item 6b - purchasing tier B upper bound drops from 13 to
    // 9. Labor's default (13) stays untouched via classifyTier's
    // optional second argument.
    const tier = classifyTier(weeksInRange, 9);

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
      // R13 P0-2 - per-unit elapsed fraction so WeekChart can render
      // the running-unit projection.  Only meaningful on the running
      // unit (finished units are fully elapsed; future units haven't
      // started).  For period bars this is (days since period start)
      // / (period days), matching the elapsedFrac formula in
      // route.js at the range scope.
      const periodDaysMs = pEnd - pStart + 86400000;   // inclusive end
      const elapsedDaysMs = Math.max(0, Math.min(periodDaysMs, now - pStart + 86400000));
      const elapsedFrac = running ? (elapsedDaysMs / periodDaysMs) : (finished ? 1.0 : 0);
      return { ...p, finished, running, elapsedFrac };
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
            // R15 - R13 P0-2 added elapsedFrac to buildUnitsForBucket
            // (line ~497) but missed the parallel spot here.  So the
            // period-card chart never rendered the running-period
            // projection outline while the bucket-card charts did.
            elapsedFrac: p.elapsedFrac,
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
          // R13 P0-2 - per-unit elapsed fraction for the running-week
          // projection.  Weekly = (days since week start) / 7.
          elapsedFrac: running ? weekElapsedFrac(wIso, today) : (finished ? 1.0 : 0),
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
            elapsedFrac: p.elapsedFrac,
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
          // R13 P0-2 - per-unit elapsed fraction for the running week.
          elapsedFrac: running ? weekElapsedFrac(wIso, today) : (finished ? 1.0 : 0),
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
    // 2026-09-02 retire-custom PR: last_4wk inference removed (preset
    // retired). last_13wk was retired 2026-08-24 for the same reason:
    // rolling windows straddle periods and produce the grain-mismatch
    // defect Kevin measured. A hand-crafted URL landing on today-27
    // now snaps server-side to the containing period; the chip
    // reads "Period N · snapped from a custom range".
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
  // cards_through_effective covers report-only rows too (INV-P22 owner
  // ruling 2026-08-26 Part D).  Fall back to cards_through if the
  // effective field is absent (older payloads / pre-migration route).
  const cardsThroughISO = data?.freshness?.cards_through_effective
    || data?.freshness?.cards_through
    || null;
  const cardsThroughLabel = cardsThroughISO
    ? `${cardsThroughISO.slice(5, 7)}/${cardsThroughISO.slice(8, 10)}`
    : null;
  const cardsFreshAnchorISO = cardsThroughISO
    ? `${cardsThroughISO}T23:59:59Z`
    : null;
  // 2026-08-28 freshness popover (Kevin ruling: labor has one, purchasing
  // does not).  Three sources feed the pill on this route:
  //   - bill.com sync         (purchasing_derive_runs.source='billcom')
  //   - Rippling card sync    (purchasing_derive_runs.source='rippling_spend')
  //   - Nightly report ingest (purchasing_derive_runs.source='rippling_report')
  // The pill shows STATUS; the popover shows all three timestamps AND
  // marks the one that drove the state.  When an operator sees "Data
  // stale" they can tell in one click which lane is behind.
  //
  // "Behind" = oldest of the three ISO timestamps (missing = worst).
  // Chip anchor was previously min(last_derive_at, cards_through) - a
  // 2-source derivation that didn't line up with the 3 sources feeding
  // the board.  Aligning chip + popover on the same 3-source concept
  // is Kevin's ruling: the pill reports the worst of the three, and
  // the popover names which.
  const billcomISO = data?.freshness?.last_billcom_sync || null;
  const ripplingISO = data?.freshness?.last_rippling_sync || null;
  const reportISO = data?.freshness?.last_report_ingest_at || null;
  const reportStale = data?.freshness?.report_stale === true;
  const reportAgeH = data?.freshness?.report_age_hours;
  // F-11 (2026-09-01): the report-only-pending view has 500'd on
  // ALL/FYTD four times. The route now guards the view read with a
  // 6s timeout - on trip, this flag is true and the popover surfaces
  // it so the operator knows the report-only slice is missing from
  // the board (vs genuinely empty). Silent fallback would be a lie
  // by omission.
  const reportOnlyUnavailable = data?.freshness?.report_only_unavailable === true;
  const _sourceRows = [
    { key: "billcom",  label: "bill.com sync",         iso: billcomISO },
    { key: "rippling", label: "Rippling card sync",    iso: ripplingISO },
    { key: "report",   label: "Nightly report ingest", iso: reportISO },
  ];
  const _worst = _sourceRows.slice().sort((a, b) => {
    if (a.iso == null && b.iso == null) return 0;
    if (a.iso == null) return -1;   // missing = oldest
    if (b.iso == null) return 1;
    return a.iso < b.iso ? -1 : 1;
  })[0];
  const worstSourceKey = _worst?.key || null;
  // worstSourceISO is what the chip reads via freshness.last_walk_at.
  // Missing timestamp -> null anchor -> chip shows "No recent walk"
  // (fail-loud, better than pretending fresh).
  const worstSourceISO = _worst?.iso || null;
  const worstHours = hoursSinceISO(worstSourceISO);
  // Plain intro adapts to the pill state.  When Data current: reassure.
  // When Data slow / Data stale: point at the lane that's behind.
  const _stateIntro = (() => {
    if (loadState !== "ok" || !data) return null;
    // F-11: unavailable takes precedence in the intro. An operator
    // reading the popover needs to know the report-only slice is
    // missing before the freshness lane story.
    if (reportOnlyUnavailable) return "Report-only pending view timed out on this request. The board's hero, list and drill are all showing the API-side pending only; the report-only slice will return on the next refresh.";
    if (worstHours == null) return "No recent walk on any source.";
    const worstName = _worst?.label || "one source";
    if (worstHours >= 54) return `${worstName} is behind - the pill reflects that source.`;
    if (worstHours >= 30) return `${worstName} is running slow. Bills and cards land nightly around 2 AM CT.`;
    return "All three sources landed within the last day.";
  })();
  const freshnessPop = loadState === "ok" && data ? (
    <div className="kpi-fresh-pop-body">
      {_stateIntro && <div className="kpi-fresh-pop-plain">{_stateIntro}</div>}
      {_sourceRows.map(row => (
        <div key={row.key} className="kpi-fresh-pop-row">
          <span>
            {row.label}
            {row.key === worstSourceKey && worstHours != null && worstHours >= 30 && (
              <span className="kpi-fresh-pop-marker" aria-label="drove the pill state"> · behind</span>
            )}
          </span>
          <b>{row.iso ? fmtTimestamp(row.iso) : "—"}</b>
        </div>
      ))}
      <div className="kpi-fresh-pop-sep" aria-hidden="true" />
      <div className="kpi-fresh-pop-row">
        <span>Cards through</span>
        <b>{cardsThroughLabel ? cardsThroughLabel : "—"}</b>
      </div>
      {reportStale && (
        <div className="kpi-fresh-pop-row">
          <span>Report age</span>
          <b>{reportAgeH != null ? `${reportAgeH}h (SLA 36h)` : "not started"}</b>
        </div>
      )}
      {reportOnlyUnavailable && (
        <div className="kpi-fresh-pop-row">
          <span>Report-only pending</span>
          <b>temporarily unavailable</b>
        </div>
      )}
      <div className="kpi-fresh-pop-sep" aria-hidden="true" />
      <div className="kpi-fresh-pop-contract">
        bill.com and the Rippling card sync run nightly around 2 AM CT.  The nightly report ingests the scheduled Rippling email around 1 AM CT.  Cards trail purchase date by ~8 days per Rippling's post lag.
      </div>
    </div>
  ) : null;

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
        // 2026-09-02: last_4wk retired.
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

          {/* R14 - two-pane management-fee card consumes what was
              previously three cards: ManagementFeeCard + PassThroughPeriodCard
              + ReimbursableRow.  Resolver-owned.  See board.js
              resolveMgmtFeeCard for the shape contract. */}
          <ManagementFeeCard
            account={account}
            goal={goalRow}
            mgmtFee={mgmt}
            reimbSpentRange={reimbTotal}
            pending={board.pending}
            yearElapsedFrac={yearElapsedFrac}
            cardTitle={cardTitle}
            rangeLabel={rangeLabel}
            weekOfPeriod={wop}
            weeksInPeriod={weeksInPeriodDenom}
            elapsedFrac={board.elapsedFrac}
            closed={closed}
            provisional={provisional}
            isFutureRange={isFutureRange}
          />

          {/* R14 - FunMoneyCard deleted; the fun money row inside the
              mgmt-fee card carries the budget + variance verdict inline
              (Kevin ruling 2026-08-27).  Value colour is r/over or
              b/under matching the right-pane hero grammar. */}

          {/* R15 A/B/G - pass-through board: same three matched ledgers as
              at-risk (Vehicle + Equipment + R&M).  VendorBreakdown removed.
              Empty cards suppress; whole-empty row -> meta line. */}
          {(() => {
            const three = ["veh", "equip", "rm"]
              .map(k => board.ledgers.find(l => l.key === k))
              .filter(l => l && (Number(l.spent || 0) > 0.005 || (l.ledgerRows || []).length > 0));
            if (three.length === 0) {
              return (
                <div className="kpi-p-mf-empty-row" role="status">
                  No vehicle, equipment or repair spend in this range.
                </div>
              );
            }
            return (
              <div className="kpi-p-flatrow kpi-p-flatrow-3up kpi-p-flatrow-ledgers">
                {three.map(l => (
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
              </div>
            );
          })()}

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

          {/* PR 6 - compliance card. Pass-through accounts still have
              real card compliance work even though their spend is
              billed back to the client; a coder still has to code the
              row. Same population and rules as the at-risk mount below. */}
          <CardCompliance
            data={data?.compliance}
            isAggregate={isAggregate}
            scopeLabel={`${account} · ${resolvedPreset === "fytd" ? "FYTD" : (rangeLabel || "custom")}`}
          />

          {/* R16 P1 - drill table at pass-through with a single
              Reimbursable (13xx) column instead of the at-risk 5.
              Same flush wrapper the at-risk board uses. */}
          <div className="kpi-p-tablewrap kpi-p-tablewrap-flush">
            <PurchasingTable
              account={account}
              start={start}
              end={end}
              tier={board.tier}
              weeks={board.weeks}
              decoratedPeriods={board.decoratedPeriods}
              weekly={board.weekly}
              heroTotals={null}
              isAggregate={isAggregate}
              weeksInRange={board.weeksInRange}
              vendorRollup={data?.vendor_rollup}
              isPassThrough
            />
          </div>
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
      // 2026-09-02: last_4wk retired.
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
    // INV-P20 third freshness source. When the report-ingest lane is
    // stale (> 36h since last successful ingest, or has never run)
    // the pill replaces the reassuring "Bills current" copy with a
    // plain-language stale-report note so an operator can't miss it.
    // Owner-facing wording: "Report feed stale - last ingest Nh ago"
    // or "Report feed not started". Never a code or a stack trace.
    const reportStale = data?.freshness?.report_stale === true;
    const reportAgeH = data?.freshness?.report_age_hours;
    const reportEverRan = data?.freshness?.last_report_ingest_at != null;
    const freshnessDetail = reportStale
      ? (reportEverRan
          ? `Report feed stale · last ingest ${reportAgeH}h ago`
          : `Report feed not started`)
      : (cardsThroughLabel
          ? `Bills current · cards through ${cardsThroughLabel}`
          : "Bills current");

    return (
      <div className="kpi-p-board">
        <div className={`kpi-p-livenote${reportStale ? " kpi-p-livenote-stale" : ""}`} role="status">
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
          // R13 P0-1 - closed-card comparison block payload.  Null on
          // any range that isn't a closed single period; component
          // suppresses the block when null.
          periodHistory={data?.period_history || null}
        />

        {/* R15 A - Vehicle bucket card removed; Vehicle joins the
            matched-ledgers row below.  Only Food + Packaging render as
            bucket cards now (with charts). */}
        {board.buckets
          .filter(b => b.key !== "vehicle")
          .map(b => (
          <BucketCard
            key={b.key}
            bucketKey={b.key}
            label={b.label}
            sub={b.sub}
            strokeClass={b.strokeClass}
            identity={b.key === "packaging" ? "pkg" : "food"}
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

        {/* R15 B/G - three matched ledgers: Vehicle, Equipment, R&M.
            One shape, equal height (CSS: .kpi-p-flatrow-3up stretches
            children).  Empty cards suppress themselves; if all three are
            empty, one meta line replaces the row. */}
        {(() => {
          const three = ["veh", "equip", "rm"]
            .map(k => board.ledgers.find(l => l.key === k))
            .filter(l => l && (Number(l.spent || 0) > 0.005 || (l.ledgerRows || []).length > 0));
          if (three.length === 0) {
            return (
              <div className="kpi-p-mf-empty-row" role="status">
                No vehicle, equipment or repair spend in this range.
              </div>
            );
          }
          return (
            <div className="kpi-p-flatrow kpi-p-flatrow-3up kpi-p-flatrow-ledgers">
              {three.map(l => (
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
            </div>
          );
        })()}

        {/* PR-2 R11 item 3 - Reimbursable + Card purchases side-by-side
            on a live period, full-width fallback on a closed period.
            Owner ruling 2026-08-25 supersedes spec §6.6's "full-width"
            phrasing for the live case:
              - LIVE  : pair inside .kpi-p-pairrow (1fr 1fr).
              - CLOSED: CardPurchases returns null (no pending),
                        Reimbursable takes the full row.
            Prior state left Reimbursable stretched full-width even
            when Card purchases sat below it, which is the "stretch"
            defect this fix retires. Reimbursable may not render at
            accounts with no reimb data - then Card purchases takes
            the row alone on live, or nothing renders on closed. */}
        {(() => {
          const reimbLedger = board.ledgers.find(l => l.key === "reimb");
          const cardPurchasesActive = !closed;   // CardPurchases returns null when closed
          {/* R15 C - Reimbursable on the at-risk board is a receivable
              (billed back), not a cost.  noBudget hides the budget line,
              % used, Remaining/Over-by, and swaps the subline to
              "recovered in full · billed back". */}
          const reimbNode = reimbLedger && (Number(reimbLedger.spent || 0) > 0.005 || (reimbLedger.ledgerRows || []).length > 0) ? (
            <LedgerCard
              key={reimbLedger.key}
              bucketKey={reimbLedger.key}
              label={reimbLedger.label}
              sub={reimbLedger.sub}
              strokeClass={reimbLedger.strokeClass}
              budget={reimbLedger.budget}
              spent={reimbLedger.spent}
              elapsedFrac={board.elapsedFrac}
              closed={closed}
              isFutureRange={isFutureRange}
              ledgerRows={reimbLedger.ledgerRows}
              totalCount={reimbLedger.totalCount}
              totalAmount={reimbLedger.totalAmount}
              cap={reimbLedger.cap}
              isAggregate={isAggregate}
              noBudget={true}
            />
          ) : null;
          const cardPurchNode = cardPurchasesActive ? (
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
          ) : null;
          if (reimbNode && cardPurchNode) {
            return <div className="kpi-p-pairrow">{reimbNode}{cardPurchNode}</div>;
          }
          return <>{reimbNode}{cardPurchNode}</>;
        })()}

        {/* PR 6 - compliance card. Below the ledgers, above the drill
            table. Population is report-side uncoded (sentinel category)
            restricted to attributable work locations, so it counts what
            the period card counts on the same exclusion set. Card hides
            when nothing is outstanding (E-clause). Owner ruling ships
            Option B: site totals with people on expand. */}
        <CardCompliance
          data={data?.compliance}
          isAggregate={isAggregate}
          scopeLabel={`${isAggregate ? (account === "ALL" ? "All accounts" : account) : account} · ${resolvedPreset === "fytd" ? "FYTD" : (rangeLabel || "custom")}`}
        />

        {/* PR 4 - drill-down table. Sits below Card purchases on the
            at-risk board. Bill rows load on expand via scoped GET;
            the mount payload is unchanged. Footer totals asserted to
            equal bucket card heroes (§9B one-source rule, Check 1).
            R15 F - wrapped in a flush wrapper (no card frame), with the
            vendor rollup passed for the By vendor row mode. */}
        <div className="kpi-p-tablewrap kpi-p-tablewrap-flush">
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
            vendorRollup={data?.vendor_rollup}
          />
        </div>
      </div>
    );
  })();

  return (
    <div className="kpi-app">
      <div className="kpi-wrap">
        <Shell
          account={deriveClientAccount({
            urlAccount: account,
            previewAccount: data?.preview_account,
            landingAccount: data?.landing_account,
          }) || "…"}
          fiscal={fiscalCtx}
          freshness={{ last_walk_at: worstSourceISO }}
          freshnessPop={freshnessPop}
          previewAccount={data?.preview_account || null}
          onExitPreview={() => {
            const p = new URLSearchParams(searchParams.toString());
            p.delete("preview");
            router.replace(`/kpi/purchasing?${p.toString()}`);
          }}
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
            /* 2026-09-02 retire-custom PR: server-driven snap chip. */
            rangeSnap: data?.range_snap || null,
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
          folioRail={(() => {
            // 2026-08-28 rail-hide (labor #873 shape).  Rules:
            //   landing_account pseudo (ALL/EAST/WEST) -> multi-account
            //     access -> rail visible
            //   landing_account non-pseudo -> single-account user ->
            //     rail hidden
            //   preview_account set -> corporate narrowed to one ->
            //     rail hidden (previewing what a single-account user sees)
            // Passing null tells Shell to omit the aside; kpi.css collapses
            // the .kpi-cols grid via [data-no-folio].
            const PSEUDO = ["ALL", "EAST", "WEST"];
            const isPseudoLanding = PSEUDO.includes(data?.landing_account);
            const showRail = isPseudoLanding && !data?.preview_account;
            if (!showRail) return null;
            return (
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
            );
          })()}
          main={boardContent}
        />
      </div>
    </div>
  );
}

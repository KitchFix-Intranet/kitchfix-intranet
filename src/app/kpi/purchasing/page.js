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

import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

import "../kpi.css";
import "../current-period.css";
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
  r93FytdEndISO,
  r93ExcludedPeriodNo,
} from "@/app/kpi/labor/lib/periods";
import { addDaysISO } from "@/lib/kpi/dateResolve";
import { Shell } from "@/app/kpi/labor/components/Shell";
// Kevin 2026-09-14 reskin PR 1: FolioRail import removed - Purchasing
// no longer renders the rail. PSEUDO_KEYS moved to a local constant
// so the last-account restore still knows the pseudo landing shape.
const PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);
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
// R-109 PR 3 (Kevin 2026-09-16). On Current period only, the money
// card + where-it-went + week rail + drill table + coding strip are
// all replaced by the one-table view + review cards (with the coding
// strip folded into the review-card items so it isn't shipped twice).
import CurrentPeriodTable from "@/app/kpi/overview/components/CurrentPeriodTable";
import CurrentPeriodReview from "@/app/kpi/overview/components/CurrentPeriodReview";
// Kevin 2026-09-14 reskin PR 1: BucketCard import dropped - the two
// duplicate charts (food + packaging mini-charts) are gone. The
// LedgerCard + CardPurchases + CardCompliance imports remain because
// the pass-through board (STL-FL, STL-MO, CIN-OH) still renders them
// - PR 1 restructures the at-risk board only.
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
    // R-93 (2026-09-09): fytd end is the last-settled period's end,
    // not today. Consistent with Labor + Overview.
    if (urlPreset === "fytd") {
      const fytdEnd = r93FytdEndISO(today) || today;
      return { startISO: FY_START_ISO, endISO: fytdEnd };
    }
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
    // Fire fetch when EITHER a URL account or a ?preview= is present.
    // Server route (route.js resolvePreviewAccess) rewrites account =
    // preview when urlAccount is empty. Prior `if (!account) return`
    // stranded ?preview=X URLs (no ?account=) in the skeleton state:
    // useEffect above skips the auto-inject on ?preview=, then this
    // guard silently swallowed the fetch. Repro'd Purchasing prompt
    // bug 0.1 (135 skeleton nodes on /kpi/purchasing?preview=TBJ-FL).
    // Labor / Overview both fire fetch with empty account and let the
    // server resolve; matching that shape here.
    if (!account && !urlPreview) return;
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
    // Kevin 2026-09-15 reskin PR 2: request line-item detail on
    // single-period ranges (LP + CP + NP). The new LP spend list +
    // reimbursables table read `payload.actuals`. CY continues to
    // read `vendor_rollup.rows` - no drill needed on the multi-period
    // aggregate. Server-side gate: `?drill=lines` returns `actuals`
    // in the response body; extra bytes but bounded (LP is ~4 weeks).
    if (rangeSelectionEarly?.kind === "period") params.set("drill", "lines");
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
  }, [account, start, end, status, retryCount, rangeSelectionEarly, urlPreview]);

  // PR 5 - skeleton show-delay. Delay showing the skeleton so a
  // fast fetch does not flash a skeleton for 80ms then disappear.
  // Measured warm P50 for /api/kpi/purchasing at ~2.5s (cold ~7s);
  // 150ms hides the flash on browser-cache hits without hiding the
  // skeleton on real fetches. The idle -> loading transition also
  // waits (rendering "Loading ..." with nothing visible for 150ms
  // is still better than a flashing skeleton).
  const [showSkeleton, setShowSkeleton] = useState(false);
  // Kevin 2026-09-15 (#1125 follow-up): source toggle on the CY vendor
  // table. 'all' | 'bill' | 'card'. Server ships spend_bill + spend_card
  // per vendor row; client filters + retotals.
  const [cyVendorSource, setCyVendorSource] = useState("all");
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
    // R-93 (2026-09-09): fytd end is the last-settled period's end.
    const fytdEnd = r93FytdEndISO(today);
    if (start === FY_START_ISO && fytdEnd && end === fytdEnd) return "fytd";
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

  // R-109 PR 3 · Current period gate. Same predicate Labor uses (Labor
  // reads board.kind === "single_period_in_progress" from its own
  // payload; Purchasing does not expose kind at the top level, so we
  // key off resolvedPreset === "this_period" plus a hasn't-started
  // guard). When true the whole board (money card, where-it-went,
  // drill table, coding strip) is replaced by CurrentPeriodTable +
  // CurrentPeriodReview below.
  const cpGateActive = resolvedPreset === "this_period" && !isFutureRange;
  // R-110 (2026-09-16). NP gate on Purchasing.
  const npGateActive = isFutureRange === true;
  const useCpTable = cpGateActive || npGateActive;

  // R-109 PR 3 · fetch Overview payload on CP only. CurrentPeriodTable
  // needs Overview's week_rail + statement_rows + cards + todayISO for
  // the Revenue row; Purchasing's own board.weekly feeds the 3200/3400
  // rows and Purchasing's `data` (this component's) is the `purch`
  // prop. Only fires when the gate is on so non-CP ranges stay a
  // single-fetch page.
  const [cpOverview, setCpOverview] = useState(null);
  const [cpLabor, setCpLabor] = useState(null);
  const [cpAuxError, setCpAuxError] = useState(null);
  useEffect(() => {
    if (!useCpTable) {
      setCpOverview(null);
      setCpLabor(null);
      setCpAuxError(null);
      return;
    }
    if (!account || !start || !end) return;
    const preview = searchParams.get("preview");
    const mkUrl = (base, extra = {}) => {
      const u = new URL(base, window.location.origin);
      u.searchParams.set("account", account);
      u.searchParams.set("start", start);
      u.searchParams.set("end", end);
      for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
      if (preview) u.searchParams.set("preview", preview);
      return u.toString();
    };
    let cancelled = false;
    Promise.all([
      fetch(mkUrl("/api/kpi/overview", { include_salary: "1" }), { credentials: "include" })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`overview ${r.status}`))),
      fetch(mkUrl("/api/kpi/labor"), { credentials: "include" })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`labor ${r.status}`))),
    ]).then(([ov, lb]) => {
      if (!cancelled) { setCpOverview(ov); setCpLabor(lb); setCpAuxError(null); }
    }).catch(e => { if (!cancelled) setCpAuxError(String(e?.message || e)); });
    return () => { cancelled = true; };
  }, [useCpTable, account, start, end, searchParams]);

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
        if (resolvedPreset === "fytd") {
          // R-93: name the settled span + the excluded period.
          const fytdEnd = r93FytdEndISO(today);
          const lastP = fytdEnd ? periodOf(fytdEnd) : null;
          const excludedP = r93ExcludedPeriodNo(today);
          if (lastP != null) {
            const base = `CLOSED PERIODS · P1 – P${lastP}`;
            return excludedP != null ? `${base} · P${excludedP} AWAITING VERIFICATION` : base;
          }
          return "FISCAL YEAR TO DATE";
        }
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
            scopeLabel={`${account} · ${resolvedPreset === "fytd" ? "Current year" : (rangeLabel || "custom")}`}
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
      if (resolvedPreset === "fytd") {
        // R-93: name the settled span + the excluded period.
        const fytdEnd = r93FytdEndISO(today);
        const lastP = fytdEnd ? periodOf(fytdEnd) : null;
        const excludedP = r93ExcludedPeriodNo(today);
        if (lastP != null) {
          const base = `CLOSED PERIODS · P1 – P${lastP}`;
          return excludedP != null ? `${base} · P${excludedP} AWAITING VERIFICATION` : base;
        }
        return "FISCAL YEAR TO DATE";
      }
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

    // Kevin 2026-09-14 Purchasing reskin PR 1. Prior at-risk render
    // was six spend cards + duplicate food/packaging mini-charts +
    // compliance panel + reimbursable pair row + drill table with
    // filters. Per the render at docs/renders/purchasing-redesign.html
    // the board becomes: coding strip at the top, money hero, "where
    // it went" three-line table, then the shape (period chart) and
    // the detail (drill table). PR 1 lands the structural changes
    // and existing figures - PR 2 (spend list / vendor table / own
    // reimbursables table) and PR 3 (week rail + period burn on
    // running periods) rebuild the shape and the detail on top.
    //
    // Removed by this PR: BucketCards (food+packaging mini-charts,
    // "two duplicate charts"), three-up LedgerCards (Vehicle +
    // Equipment + R&M, three of six spend cards), Reimbursable pair
    // row (reimb LedgerCard + CardPurchases, remaining spend cards
    // plus the receipts panel), CardCompliance (compliance panel folds
    // into the coding strip below), FolioRail (removed in a separate
    // change above).
    // R-109 PR 3 · Current period one-table view. Same component
    // Overview + Labor render, with `rowSet="purchasing"` narrowing
    // to Revenue + Food + Packaging. The coding strip does NOT render
    // separately on CP - CurrentPeriodReview's purchasing item carries
    // the same signal (count + total + oldest), so Kevin's rule "do
    // not ship both" applies (same class as Labor's WeekTable
    // duplication removed in the previous PR). The freshness livenote
    // stays - it complements the shell's status pill and doesn't
    // duplicate anything on the CP surface.
    if (useCpTable) {
      // R-109 PR 3 (2026-09-15) + R-110 (2026-09-16). Same shared
      // table on CP and NP. Review cards only render on CP - nothing
      // to review on NP. Kevin ruling: NP has no coding strip, no
      // money card, no where-it-went, no drill; just the table + the
      // three small cards (which the component renders when isFuture).
      // Kevin fix 2026-09-17 item 1: keep the board skeleton up until
      // the overview + labor aux fetch lands - no second loader text
      // state between skeleton and table.
      if ((!cpOverview || !cpLabor) && !cpAuxError) {
        return <SkeletonBoard />;
      }
      return (
        <div className="kpi-p-board">
          <div className={`kpi-p-livenote${reportStale ? " kpi-p-livenote-stale" : ""}`} role="status">
            <span className="kpi-p-livedot" aria-hidden="true" />
            <span><b>{freshnessDetail}</b></span>
          </div>
          <CurrentPeriodTable
            rowSet="purchasing"
            payload={cpOverview}
            labor={cpLabor}
            purch={data}
            error={cpAuxError}
          />
          {cpGateActive && (
            <CurrentPeriodReview
              labor={cpLabor}
              purchasing={data}
            />
          )}
        </div>
      );
    }

    const comp = data?.compliance || null;
    const codingStripCount = comp?.total_count || 0;
    const codingStripAmount = Number(comp?.total_amount || 0);
    const codingStripOldest = comp?.oldest_age_days;
    return (
      <div className="kpi-p-board">
        {/* Coding strip · replaces the compliance panel. Amber when
            charges are outstanding, green when clear (per render). */}
        <div className={`kpi-p-codestrip ${codingStripCount > 0 ? "kpi-p-codestrip-attn" : "kpi-p-codestrip-ok"}`} role="status">
          {codingStripCount > 0 ? (
            <>
              <span className="kpi-p-codestrip-t">
                {codingStripCount} card charge{codingStripCount === 1 ? "" : "s"} need a P&amp;L line
              </span>
              <span className="kpi-p-codestrip-s">
                {fmt$(codingStripAmount)}
                {codingStripOldest != null ? ` · oldest ${codingStripOldest} day${codingStripOldest === 1 ? "" : "s"}` : ""}
              </span>
              <a className="kpi-p-codestrip-cta" href="https://app.rippling.com/spend" target="_blank" rel="noreferrer noopener">
                Open Rippling
              </a>
            </>
          ) : (
            <>
              <span className="kpi-p-codestrip-t">All charges coded</span>
              <span className="kpi-p-codestrip-s">every card charge in this range has a P&amp;L line</span>
            </>
          )}
        </div>

        <div className={`kpi-p-livenote${reportStale ? " kpi-p-livenote-stale" : ""}`} role="status">
          <span className="kpi-p-livedot" aria-hidden="true" />
          <span><b>{freshnessDetail}</b></span>
        </div>

        {/* Money hero (Spent / Plan / Adjusted / Verdict) - existing
            engine, existing figures. PR 3 replaces the embedded chart
            with the week rail + period burn on running ranges. */}
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
          periodHistory={data?.period_history || null}
        />

        {/* Where it went · three-line table (Food / Packaging /
            Vehicle). Figures come from board.buckets - the same
            source the removed BucketCard + LedgerCard heros read.
            Kevin 2026-09-14 (PR 1 fix): Adjusted column dropped.
            Purchasing payload has no adjusted field - that's the
            prompt § 2 (Section 2) work, landing in PR 3 alongside
            the week-basis adjusted formula. PR 1 compares spent
            against plan; PR 3 restores the Adjusted column with
            the correct per-week revenue basis. Money card above
            keeps its own adjusted figure via PeriodCard's existing
            projection math. */}
        {(() => {
          const rows = board.buckets.map(b => ({
            key: b.key,
            label: b.label,
            sub: b.sub,
            budget: Number(b.budget || 0),
            spent: Number(b.spent || 0),
          }));
          const totalBudget = rows.reduce((a, r) => a + r.budget, 0);
          const totalSpent = Number(board.kpiSpent || 0);
          const totalVar = totalSpent - totalBudget;
          const totalOver = totalVar > 0;
          return (
            <div className="kpi-p-card kpi-p-wig" data-card="where-it-went">
              <div className="kpi-p-wig-head">
                <span className="kpi-p-cardtitle">Where it {closed ? "went" : "goes"}</span>
                <span className="kpi-p-wig-note">variance vs plan · PR 3 adds adjusted at revenue earned</span>
              </div>
              <div className="kpi-p-wig-grid" role="table">
                <div className="kpi-p-wig-h" role="columnheader">Line</div>
                <div className="kpi-p-wig-h kpi-p-wig-r" role="columnheader">Plan</div>
                <div className="kpi-p-wig-h kpi-p-wig-r" role="columnheader">Spent</div>
                <div className="kpi-p-wig-h kpi-p-wig-r" role="columnheader">Variance</div>
                {rows.map(r => {
                  const v = r.spent - r.budget;
                  const over = v > 0;
                  return (
                    <Fragment key={r.key}>
                      <div className="kpi-p-wig-nm" role="cell">
                        {r.label}<span className="kpi-p-wig-gl">{r.sub}</span>
                      </div>
                      <div className="kpi-p-wig-c kpi-p-wig-r" role="cell">{fmt$(r.budget)}</div>
                      <div className="kpi-p-wig-c kpi-p-wig-r" role="cell">{fmt$(r.spent)}</div>
                      <div className={`kpi-p-wig-c kpi-p-wig-r ${r.spent === 0 ? "" : over ? "kpi-p-wig-neg" : "kpi-p-wig-pos"}`} role="cell">
                        {r.spent === 0 ? "" : `${over ? "▲ " : "▼ "}${fmt$(Math.abs(v))}`}
                      </div>
                    </Fragment>
                  );
                })}
                <div className="kpi-p-wig-nm kpi-p-wig-tot" role="cell">Total</div>
                <div className="kpi-p-wig-c kpi-p-wig-r kpi-p-wig-tot" role="cell">{fmt$(totalBudget)}</div>
                <div className="kpi-p-wig-c kpi-p-wig-r kpi-p-wig-tot" role="cell">{fmt$(totalSpent)}</div>
                <div className={`kpi-p-wig-c kpi-p-wig-r kpi-p-wig-tot ${totalOver ? "kpi-p-wig-neg" : "kpi-p-wig-pos"}`} role="cell">
                  {`${totalOver ? "▲ " : "▼ "}${fmt$(Math.abs(totalVar))}`}
                </div>
              </div>
            </div>
          );
        })()}

        {/* The detail · CY = vendor table, LP = spend list + own
            reimbursables table, CP = existing drill table (R-109
            replaces it), NP = no detail per prompt § 4.NP. Kevin
            2026-09-15 reskin PR 2. */}
        {(() => {
          const isCY = resolvedPreset === "fytd";
          const isLP = resolvedPreset === "last_period";
          const isCP = resolvedPreset === "this_period";
          // Purchasing doesn't infer `next_period` in resolvedPreset
          // (page.js:749 lacks the branch). Use `is_future_range` from
          // the server payload - true iff the range starts after today.
          // Prompt § 4.NP: "No chart, no spend list, no vendors, no
          // verdict." Money card + where-it-went above are the whole
          // board for NP.
          const isNP = isFutureRange;

          if (isNP) return null;

          // Current year: one row per vendor with the food / packaging
          // / vehicle split, plus a lines count and a total. Source is
          // `vendor_rollup.rows` (per-vendor aggregate; already shipped
          // by the route). Two follow-ups on the #1125 initial ship:
          //
          // 1. Source toggle (All / bill.com / Cards) - lives in the
          //    header. Cards + bills are separate rows in vendor_rollup
          //    (server aggregates rippling_spend by merchant name).
          // 2. Reimbursable-only vendors excluded from this table so
          //    the columns and totals agree. Their spend lives in the
          //    reimbursables table rendered below.
          if (isCY) {
            const rows = data?.vendor_rollup?.rows || [];
            // A vendor belongs in the main table if it has non-reimb
            // spend. Rows whose entire spend is 13xx move to the
            // reimbursables table (case: Vio Brands = $73,872 all in
            // 1371 - was rendering with — under every column and a
            // total that matched nothing).
            const mainVendors = rows.filter(v => {
              const gs = v.gl_split || {};
              const nonReimb = Number(gs.food || 0) + Number(gs.packaging || 0)
                             + Number(gs.vehicle || 0) + Number(gs.equipment || 0)
                             + Number(gs.repair || 0) + Number(gs.other || 0);
              return Math.abs(nonReimb) > 0.005;
            });
            const reimbVendors = rows.filter(v => {
              const gs = v.gl_split || {};
              return Number(gs.reimbursable || 0) > 0.005;
            }).sort((a, b) => Number(b.gl_split?.reimbursable || 0) - Number(a.gl_split?.reimbursable || 0));
            // Amount for a row under the active source toggle. When
            // filtered to bills/cards only, the "Total" and per-bucket
            // figures must reflect that lane. gl_split doesn't carry
            // per-source detail, so scaling the bucket by the row's
            // source share is the cheapest honest approximation - and
            // the common case is 100% one source anyway (a row is
            // either a bill row or a card row given how the server
            // keys them). Rows with mixed sources are rare (never for
            // rippling_spend, since it has no vendor_id to merge on).
            const activeAmount = (v) => {
              if (cyVendorSource === "all")  return Number(v.spend || 0);
              if (cyVendorSource === "bill") return Number(v.spend_bill || 0);
              if (cyVendorSource === "card") return Number(v.spend_card || 0);
              return 0;
            };
            const activeBucket = (v, gs, key) => {
              const raw = Number(gs?.[key] || 0);
              if (cyVendorSource === "all") return raw;
              const total = Number(v.spend || 0);
              const lane = activeAmount(v);
              if (total <= 0) return 0;
              return raw * (lane / total);
            };
            const filtered = mainVendors.filter(v => Math.abs(activeAmount(v)) > 0.005);
            const filteredTotal = filtered.reduce((s, v) => s + activeAmount(v), 0);
            const reimbTotal = reimbVendors.reduce((s, v) => s + Number(v.gl_split?.reimbursable || 0), 0);
            const laneLabel = cyVendorSource === "all" ? "All vendors" : cyVendorSource === "bill" ? "bill.com only" : "Cards only";
            return (
              <>
                <div className="kpi-p-card kpi-p-vt" data-card="vendor-table">
                  <div className="kpi-p-vt-head">
                    <span className="kpi-p-cardtitle">Every vendor</span>
                    <span className="kpi-p-vt-note">{filtered.length} of {mainVendors.length}</span>
                    <span className="kpi-p-vt-spacer" aria-hidden="true" />
                    <span className="kpi-p-vt-toggle" role="group" aria-label="Source filter">
                      {[
                        { k: "all",  label: "All" },
                        { k: "bill", label: "bill.com" },
                        { k: "card", label: "Cards" },
                      ].map(opt => (
                        <button
                          key={opt.k}
                          type="button"
                          className={cyVendorSource === opt.k ? "on" : ""}
                          onClick={() => setCyVendorSource(opt.k)}
                          aria-pressed={cyVendorSource === opt.k}
                        >{opt.label}</button>
                      ))}
                    </span>
                  </div>
                  <div className="kpi-p-vt-scroll">
                    <table className="kpi-p-vt-tbl">
                      <thead>
                        <tr>
                          <th className="kpi-p-vt-l">Vendor</th>
                          <th className="kpi-p-vt-r">Food</th>
                          <th className="kpi-p-vt-r">Packaging</th>
                          <th className="kpi-p-vt-r">Vehicle</th>
                          <th className="kpi-p-vt-r">Lines</th>
                          <th className="kpi-p-vt-r">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((v, i) => {
                          const displayName = v.name || (v.resolved === false && v.vendor_id ? "(unresolved vendor)" : "—");
                          const gs = v.gl_split || {};
                          const food = activeBucket(v, gs, "food");
                          const pack = activeBucket(v, gs, "packaging");
                          const veh  = activeBucket(v, gs, "vehicle");
                          const amt  = activeAmount(v);
                          const sourceCls = v.source === "card" ? "kpi-p-srcdot-card" : "kpi-p-srcdot-bill";
                          return (
                            <tr key={`${v.source}-${v.vendor_id || v.name || i}`}>
                              <td className="kpi-p-vt-l">
                                <span className={`kpi-p-srcdot ${sourceCls}`} aria-hidden="true" />
                                {displayName}
                              </td>
                              <td className="kpi-p-vt-r">{Math.abs(food) > 0.005 ? fmt$(food) : "—"}</td>
                              <td className="kpi-p-vt-r">{Math.abs(pack) > 0.005 ? fmt$(pack) : "—"}</td>
                              <td className="kpi-p-vt-r">{Math.abs(veh)  > 0.005 ? fmt$(veh)  : "—"}</td>
                              <td className="kpi-p-vt-r kpi-p-vt-muted">{v.line_count}</td>
                              <td className="kpi-p-vt-r">{fmt$(amt)}</td>
                            </tr>
                          );
                        })}
                        <tr className="kpi-p-vt-tot">
                          <td className="kpi-p-vt-l">{laneLabel}</td>
                          <td colSpan="4"></td>
                          <td className="kpi-p-vt-r">{fmt$(filteredTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {reimbVendors.length > 0 && (
                  <div className="kpi-p-card kpi-p-rt" data-card="reimbursables-table">
                    <div className="kpi-p-rt-head">
                      <span className="kpi-p-cardtitle">Also purchased · billed back to the club</span>
                      <span className="kpi-p-rt-note">{reimbVendors.length} vendors · not part of the budget above</span>
                    </div>
                    <div className="kpi-p-rt-scroll">
                      <table className="kpi-p-rt-tbl">
                        <thead>
                          <tr>
                            <th className="kpi-p-rt-l">Vendor</th>
                            <th className="kpi-p-rt-r">Lines</th>
                            <th className="kpi-p-rt-r">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reimbVendors.map((v, i) => {
                            const displayName = v.name || (v.resolved === false && v.vendor_id ? "(unresolved vendor)" : "—");
                            const sourceCls = v.source === "card" ? "kpi-p-srcdot-card" : "kpi-p-srcdot-bill";
                            return (
                              <tr key={`reimb-${v.source}-${v.vendor_id || v.name || i}`}>
                                <td className="kpi-p-rt-l">
                                  <span className={`kpi-p-srcdot ${sourceCls}`} aria-hidden="true" />
                                  {displayName}
                                </td>
                                <td className="kpi-p-rt-r kpi-p-rt-muted">{v.line_count}</td>
                                <td className="kpi-p-rt-r">{fmt$(v.gl_split.reimbursable)}</td>
                              </tr>
                            );
                          })}
                          <tr className="kpi-p-rt-tot">
                            <td className="kpi-p-rt-l" colSpan="2">All {reimbVendors.length} reimbursable vendors</td>
                            <td className="kpi-p-rt-r">{fmt$(reimbTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            );
          }

          // Last period: itemised spend list (bill.com + card charges)
          // above a separate reimbursables table. Source is
          // `payload.actuals` from `?drill=lines` (single-period gate
          // in the fetch effect above). Reimbursables split off by
          // `gl_line_code` starting with "13"; main list is everything
          // else.
          if (isLP) {
            const actuals = data?.actuals || [];
            const BUCKET_LABEL = (gl) => {
              const s = String(gl || "");
              if (s.startsWith("3200")) return "FOOD";
              if (s.startsWith("3400")) return "PACK";
              if (s.startsWith("3500")) return "VEH";
              if (s === "5002.5")       return "EQUIP";
              if (s === "5002.1")       return "R&M";
              if (s.startsWith("13"))   return "REIMB";
              if (!s)                    return "NOT CODED";
              return "OTHER";
            };
            const mainRows = actuals
              .filter(r => !String(r.gl_line_code || "").startsWith("13"))
              .slice()
              .sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)));
            const reimbRows = actuals
              .filter(r => String(r.gl_line_code || "").startsWith("13"))
              .slice()
              .sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)));
            const mainTotal = mainRows.reduce((s, r) => s + Number(r.amount || 0), 0);
            const reimbTotal = reimbRows.reduce((s, r) => s + Number(r.amount || 0), 0);
            const shortDate = (iso) => (iso || "").slice(5);   // MM-DD
            return (
              <>
                <div className="kpi-p-card kpi-p-sl" data-card="spend-list">
                  <div className="kpi-p-sl-head">
                    <span className="kpi-p-cardtitle">Every purchase</span>
                    <span className="kpi-p-sl-note">{mainRows.length} · invoice and card, newest first</span>
                  </div>
                  {mainRows.length === 0 ? (
                    <div className="kpi-p-sl-empty">No purchases in this range.</div>
                  ) : (
                    <div className="kpi-p-sl-scroll">
                      <table className="kpi-p-sl-tbl">
                        <thead>
                          <tr>
                            <th className="kpi-p-sl-l">Date</th>
                            <th className="kpi-p-sl-l">Vendor</th>
                            <th className="kpi-p-sl-l">GL</th>
                            <th className="kpi-p-sl-l">Bucket</th>
                            <th className="kpi-p-sl-l">Source</th>
                            <th className="kpi-p-sl-r">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mainRows.map((r, i) => (
                            <tr key={r.id || `m-${i}`}>
                              <td className="kpi-p-sl-l kpi-p-sl-muted">{shortDate(r.txn_date)}</td>
                              <td className="kpi-p-sl-l">
                                <span className={`kpi-p-srcdot ${r.source === "rippling_spend" ? "kpi-p-srcdot-card" : "kpi-p-srcdot-bill"}`} aria-hidden="true" />
                                {r.vendor || "—"}
                              </td>
                              <td className="kpi-p-sl-l kpi-p-sl-muted">{r.gl_line_code || "—"}</td>
                              <td className="kpi-p-sl-l">
                                <span className={`kpi-p-bkt kpi-p-bkt-${BUCKET_LABEL(r.gl_line_code).toLowerCase().replace(/[^a-z]/g, "")}`}>{BUCKET_LABEL(r.gl_line_code)}</span>
                              </td>
                              <td className="kpi-p-sl-l kpi-p-sl-muted">{r.source === "rippling_spend" ? "card" : "bill.com"}</td>
                              <td className="kpi-p-sl-r">{fmt$(r.amount)}</td>
                            </tr>
                          ))}
                          <tr className="kpi-p-sl-tot">
                            <td className="kpi-p-sl-l" colSpan="5">{mainRows.length} purchases</td>
                            <td className="kpi-p-sl-r">{fmt$(mainTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {reimbRows.length > 0 && (
                  <div className="kpi-p-card kpi-p-rt" data-card="reimbursables-table">
                    <div className="kpi-p-rt-head">
                      <span className="kpi-p-cardtitle">Also purchased · billed back to the club</span>
                      <span className="kpi-p-rt-note">{reimbRows.length} lines · not part of the budget above</span>
                    </div>
                    <div className="kpi-p-rt-scroll">
                      <table className="kpi-p-rt-tbl">
                        <thead>
                          <tr>
                            <th className="kpi-p-rt-l">Date</th>
                            <th className="kpi-p-rt-l">Vendor</th>
                            <th className="kpi-p-rt-l">GL</th>
                            <th className="kpi-p-rt-l">Source</th>
                            <th className="kpi-p-rt-r">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reimbRows.map((r, i) => (
                            <tr key={r.id || `r-${i}`}>
                              <td className="kpi-p-rt-l kpi-p-rt-muted">{shortDate(r.txn_date)}</td>
                              <td className="kpi-p-rt-l">
                                <span className={`kpi-p-srcdot ${r.source === "rippling_spend" ? "kpi-p-srcdot-card" : "kpi-p-srcdot-bill"}`} aria-hidden="true" />
                                {r.vendor || "—"}
                              </td>
                              <td className="kpi-p-rt-l kpi-p-rt-muted">{r.gl_line_code || "—"}</td>
                              <td className="kpi-p-rt-l kpi-p-rt-muted">{r.source === "rippling_spend" ? "card" : "bill.com"}</td>
                              <td className="kpi-p-rt-r">{fmt$(r.amount)}</td>
                            </tr>
                          ))}
                          <tr className="kpi-p-rt-tot">
                            <td className="kpi-p-rt-l" colSpan="4">All {reimbRows.length} reimbursable lines</td>
                            <td className="kpi-p-rt-r">{fmt$(reimbTotal)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            );
          }

          // Current period (or custom / snapped): keep the existing
          // drill table until R-109 replaces the CP surface entirely.
          // Kevin ruling 2026-09-15: PR 3 cancelled - the one-table
          // Current-period view lands as its own PR after this one.
          return (
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
          );
        })()}
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
          /* Kevin 2026-09-14 reskin PR 1: FolioRail removed from
             Purchasing entirely - account selection moves to the range
             chip in Shell. FolioRail component itself is untouched
             (Guard 1); Purchasing simply stops rendering it. Labor +
             Overview keep their rails via their own page.js. */
          folioRail={null}
          main={boardContent}
        />
      </div>
    </div>
  );
}

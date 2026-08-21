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
} from "@/app/kpi/labor/lib/periods";
import { Shell } from "@/app/kpi/labor/components/Shell";
import { FolioRail, PSEUDO_KEYS } from "@/app/kpi/labor/components/FolioRail";
import { costModelFor, isKnownAccount } from "@/lib/accountModels";

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

    // Week labels for the 4-column period card chart. When the range
    // is exactly one period the labels are the 4 week starts. When it
    // is not a single period (custom / month / FYTD), we still show
    // up to the first 4 weeks + counts; PR 2 focuses on single-period
    // display so the labels default to those.
    const weekLabels = weeks.slice(0, 4).map(w => ({ date: isoToMMDD(w) }));
    while (weekLabels.length < 4) weekLabels.push({ date: "" });

    // Running-week index inside the range (only when open).
    let runningWeekIdx = null;
    if (!closed) {
      const MS = 86400000;
      const todayTime = new Date(today).getTime();
      for (let i = 0; i < Math.min(4, weeks.length); i += 1) {
        const wStart = new Date(weeks[i]).getTime();
        const wEnd = wStart + 6 * MS;
        if (todayTime >= wStart && todayTime <= wEnd) { runningWeekIdx = i; break; }
      }
      if (runningWeekIdx == null && weeks.length > 0) {
        // Range ends in the future but today already past the range start.
        runningWeekIdx = 0;
      }
    }

    // Period card KPI-line spend + budget.
    const kpiSpentPerWeek = periodWeeklySpend({ weekly, start, end });
    const kpiSpent = kpiSpentPerWeek.reduce((s, w) => s + Number(w.amount || 0), 0);
    const kpiBud = kpiBudget({ byGlLineCode });

    // Bills-only for the KPI card sub-row (approximation - the route
    // does not split weekly by source, so we treat weekly as bills+coded
    // and back out from totals. For UI honesty in PR 2 we show
    // bills = totals.pl_cogs.spent - card.spent (coded only if
    // available); if card totals are absent we fall back to total.
    // The period card's TOTAL still uses kpiSpent for accuracy.
    const totalCogsSpent = Number(data?.totals?.pl_cogs?.spent || 0);
    const cardCodedInSpend = Math.max(0, Number(data?.totals?.card?.spent || 0) - pending);
    const billsApprox = Math.max(0, totalCogsSpent - cardCodedInSpend);

    // Weekly targets for the KPI card (finishedSpend uses KPI-line
    // spend across FINISHED weeks only, per §5.1).
    const finishedWks = finishedWeekCount({ start, end, todayISO: today });
    const finishedKpiSpend = kpiSpentPerWeek
      .slice(0, finishedWks)
      .reduce((s, w) => s + Number(w.amount || 0), 0);
    const kpiTargets = weeklyTargets({
      budget: kpiBud,
      weeksInPeriod: 4,
      finishedSpend: finishedKpiSpend,
      finishedWeeks: finishedWks,
    });

    // Bucket data - budget, spent, per-week bars.
    const buckets = BUCKET_DEFS.map(def => {
      const bud = bucketBudget({ byGlLineCode, bucketKey: def.key });
      const weekAmounts = bucketWeeklySpend({ weekly, bucketKey: def.key, start, end })
        .slice(0, 4)
        .map(w => Number(w.amount || 0));
      while (weekAmounts.length < 4) weekAmounts.push(0);
      const spent = weekAmounts.reduce((s, v) => s + v, 0);
      const finishedSpend = weekAmounts.slice(0, finishedWks).reduce((s, v) => s + v, 0);
      const targets = weeklyTargets({
        budget: bud,
        weeksInPeriod: 4,
        finishedSpend,
        finishedWeeks: finishedWks,
      });
      // For bucket state we need bills-only; route reports categories[]
      // with total spent (bills+coded). Approximate: card_coded_in_bucket
      // is small (route.buckets uses billsOnlySpentForGl). Route ships
      // buckets[] with bills-only in `spent`. Use that value directly.
      const routeBucket = (data?.buckets || []).find(b => b.bucket === def.key);
      const billsForBucket = routeBucket ? Number(routeBucket.spent || 0) : spent;
      const cardsCoded = Math.max(0, spent - billsForBucket);
      return {
        ...def,
        budget: bud,
        spent,
        bills: billsForBucket,
        cardsCoded,
        weekAmounts,
        targets,
      };
    });

    // Ledger cards - equipment + R&M via categories[].
    const ledgers = LEDGER_DEFS.map(def => {
      const cat = categoryFor(data?.categories, def.glLineCode);
      const bud = cat ? Number(cat.budget || 0) : 0;
      const spent = cat ? Number(cat.spent || 0) : 0;
      // Ledger rows: PR 2 has only the aggregate; per-purchase lands
      // with PR 4 drill. Placeholder shows the roll-up figure.
      const ledgerRows = [];
      return { ...def, budget: bud, spent, ledgerRows };
    });

    return {
      byGlLineCode,
      weekly,
      pending,
      pendingLineCount,
      elapsedFrac,
      weeks,
      weeksInRange,
      weekLabels,
      runningWeekIdx,
      kpiSpent,
      kpiSpentPerWeek,
      kpiBud,
      kpiTargets,
      buckets,
      ledgers,
      billsApprox,
      cardCodedInSpend,
    };
  }, [data, closed, start, end, today]);

  // Header text / fiscal chip context.
  const fiscalCtx = useMemo(() => {
    const p = rangePeriodNo || (data?.fiscal?.period_no ?? null);
    const w = start ? weekOfPeriod(today) : null;
    return {
      today,
      period: p,
      week: w,
    };
  }, [rangePeriodNo, data?.fiscal?.period_no, today, start]);

  // Range label (period card meta).
  const rangeLabel = useMemo(() => {
    if (!start || !end) return "";
    return `${isoToMMDDYY(start)} - ${isoToMMDDYY(end)}`;
  }, [start, end]);

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

    const runningWeekIdx = board.runningWeekIdx;
    const weekLabels = board.weekLabels;
    const wop = runningWeekIdx != null ? runningWeekIdx + 1 : null;

    return (
      <div className="kpi-p-board">
        <PeriodCard
          periodNo={rangePeriodNo}
          rangeLabel={rangeLabel}
          weekOfPeriod={wop}
          elapsedFrac={board.elapsedFrac}
          closed={closed}
          provisional={provisional}
          spent={board.kpiSpent}
          budget={board.kpiBud}
          bills={board.billsApprox}
          cards={board.cardCodedInSpend}
          pending={board.pending}
          weekAmounts={board.kpiSpentPerWeek.slice(0, 4).map(w => Number(w.amount || 0))}
          weekLabels={weekLabels}
          runningWeekIdx={runningWeekIdx}
          original={board.kpiTargets.original}
          adjusted={board.kpiTargets.adjusted}
          projectedClose={projClose}
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
            weekAmounts={b.weekAmounts}
            weekLabels={weekLabels}
            runningWeekIdx={runningWeekIdx}
            original={b.targets.original}
            adjusted={b.targets.adjusted}
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
            />
          ))}
        </div>

        <div className="kpi-p-pairrow">
          <CardPurchases
            pendingAmount={board.pending}
            pendingLineCount={board.pendingLineCount}
            closed={closed}
          />
          <VendorBreakdown account={account} rows={null} />
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
          freshness={{ last_walk_at: data?.freshness?.last_derive_at }}
          dataLoading={loadState === "loading" || loadState === "idle"}
          activeSection="purchasing"
          rangeProps={data ? {
            startISO: start,
            endISO: end,
            todayISO: today,
            hasPeriods: true,
            accountPeriods: [],
            resolvedPreset: null,
            selectedPeriodNo: rangeSelectionEarly?.kind === "period" ? rangeSelectionEarly.value : null,
            selectedMonth: rangeSelectionEarly?.kind === "month" ? rangeSelectionEarly.value : null,
            onCommit: onRangeCommit,
          } : null}
          exportHref={null}
          folioRail={
            <FolioRail
              activeAccount={account}
              onPickAccount={onPickAccount}
              accountsDirectory={undefined}
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

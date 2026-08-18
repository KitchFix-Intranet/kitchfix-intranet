"use client";
// /kpi/labor
//
// KPI Dashboard - Labor section.
//
// V7 shell (PR feat/kpi-v7-shell): chrome collapses to one command bar
// (V7-1..9), portfolio becomes carded selectable groups (V7-10..16), the
// right rail retires in favor of a folio-foot SYSTEM status strip
// (V7-17..20). Views API + table are unchanged server-side; no client
// surface references them after this PR (V7-2).
//
// URL state (surviving after v7): ?account, ?start, ?end, ?workers,
// ?redact. `?view=` is silently ignored - views UI retired.

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import { addDaysISO } from "@/lib/kpi/dateResolve";
import { fmt$, fmtHrs, hoursSinceISO, fmtTimestamp, buildPrintScopeLine } from "./lib/formatting";
import { ACCOUNTS, FY_START } from "./lib/accounts";
import { periodOf, fiscalYearOf, currentPeriodNo as periodOfDate, weekOfPeriod, inferRangeSelection } from "./lib/periods";
import { Shell } from "./components/Shell";
import { FolioRail, PSEUDO_KEYS } from "./components/FolioRail";
import { StoryBlock } from "./components/StoryBlock";
import { SignalCards } from "./components/SignalCards";
import { DetailsStrip } from "./components/DetailsStrip";
import { WeekTable } from "./components/WeekTable";
import {
  StateLoading, StateEmptyFirstRun, StateEmptyFiltered, StateEmptyRange, StateError,
  StateStale, StateSalaried, StateNotAuthorized, StateSessionExpired,
  errorCode,
} from "./components/StateBoxes";
import { ToastHost } from "./components/Toast";
import "../kpi.css";

// B15 last-viewed account key (localStorage). Read once on client mount
// only; server render always uses the URL/default. Never leaks data.
const LAST_ACCOUNT_KEY = "kpi:labor:lastAccount";
// V6-8 - last committed range persistence (kpi.range). Stores just
// { startISO, endISO } - the selection type is inferable from those
// via inferRangeSelection so we do not duplicate state.
const LAST_RANGE_KEY = "kpi:labor:lastRange";

function workerLabel(meta, worker_id, redact) {
  const num = meta?.number != null ? `#${meta.number}` : `#${String(worker_id).slice(0, 6)}`;
  if (redact || !meta?.display_name) {
    const title = meta?.title ? ` · ${meta.title}` : "";
    return `${num}${title}`;
  }
  return `${meta.display_name} (${num})`;
}

export default function KpiLaborPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const email = session?.user?.email?.toLowerCase().trim() || "";
  const isAllowed = OPS_LEADERSHIP_EMAILS.includes(email);

  // B15: default account resolution. URL wins. Otherwise on first client
  // mount we adopt the last-viewed account from localStorage; if none,
  // fall back to "CIN - OH" (the sentinel account).
  const urlAccount = searchParams.get("account");
  const account = urlAccount || "CIN - OH";
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (urlAccount) {
      // Remember whatever the user is actually on.
      try { localStorage.setItem(LAST_ACCOUNT_KEY, urlAccount); } catch {}
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem(LAST_ACCOUNT_KEY); } catch {}
    // V6 - accept pseudo-keys ALL / EAST / WEST alongside real
    // account team_keys in the last-account persistence.
    if (saved && saved !== "CIN - OH" && (ACCOUNTS.includes(saved) || PSEUDO_KEYS.has(saved))) {
      const p = new URLSearchParams(searchParams.toString());
      p.set("account", saved);
      router.replace(`/kpi/labor?${p.toString()}`);
    }
  }, [urlAccount, router, searchParams]);

  const today = new Date().toISOString().slice(0, 10);
  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");
  const start = urlStart || FY_START;
  const end = urlEnd || today;
  const redact = searchParams.get("redact") === "1";
  const workersParam = (searchParams.get("workers") || "").trim();
  const selectedWorkers = useMemo(
    () => (workersParam ? new Set(workersParam.split(",").filter(Boolean)) : null),
    [workersParam]
  );
  // V6-5/V6-7 - inference computed EARLY so the grouped memo can key
  // its grouping mode on it (month vs period). Downstream aliases
  // (selectedPeriodNo, selectedMonth, rangeSelection) are declared
  // near the RangeMenu wiring for readability.
  const rangeSelectionEarly = useMemo(() => inferRangeSelection(start, end), [start, end]);
  // Track how the current dates were arrived at (last preset click).
  // Used by the hero suffix inference.
  const [lastPreset, setLastPreset] = useState(null);

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState(null);
  const [errCode, setErrCode] = useState(null);
  const [authError, setAuthError] = useState(null); // "expired" (401) | "forbidden" (403) | null

  // P10 / P11 toast + B10 live region. One toast at a time.
  const [toast, setToast] = useState(null);
  // B10 live region text - kept separate so we can announce without a
  // visible toast (e.g., account switch, filter change).
  const [liveMsg, setLiveMsg] = useState("");
  // B10: focus target for account switch or filter clear. The ref lands
  // on the board wrapper so keyboard users get the verdict sentence read
  // aloud after every state change.
  const boardRef = useRef(null);
  const focusBoard = useCallback(() => {
    const el = boardRef.current;
    if (el && typeof el.focus === "function") el.focus();
  }, []);
  const [expandedWeeks, setExpandedWeeks] = useState(new Set());
  const [expandedPeriods, setExpandedPeriods] = useState(new Set());

  const [isCompact, setIsCompact] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => {
      const body = document.body;
      if (mq.matches) { body?.setAttribute("data-density", "compact"); setIsCompact(true); }
      else            { body?.removeAttribute("data-density");         setIsCompact(false); }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ── Fetch labor data ──────────────────────────────────
  // B14 timing marks: performance.mark bracketing the fetch to make
  // p95 measurable in devtools. See spec §5 initial ≤1.5s budget.
  //
  // 08/13 wedge hotfix - three defenses layered here:
  //   (a) AbortController: cleanup ABORTS the in-flight fetch instead of
  //       relying on a `cancelled` flag that stale closures still resolve.
  //       Prior pattern let two fetches race and both no-op their state
  //       transitions when their cleanup fired before their .then.
  //   (b) 15s hard timeout: if the network is quiet-but-stuck (extension,
  //       flaky VPN, ISP hiccup), the fetch transitions to an error state
  //       with a Retry CTA rather than spinning skeleton forever.
  //   (c) session status "loading" does NOT block a fetch we're already
  //       able to run. If we've been authenticated once (isAllowed was
  //       true) and status flaps back to "loading" (authjs refresh
  //       failure), we keep the last-good `data` on screen and don't
  //       reset back to skeleton.
  useEffect(() => {
    if (status !== "authenticated" || !isAllowed) return;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(new Error("timeout_15s")), 15000);
    setLoadState("loading");
    setErrorMsg(null);
    setErrCode(null);
    setAuthError(null);
    const params = new URLSearchParams({ account, start, end });
    const markBase = `kpi-labor-fetch-${account}`;
    try { performance.mark(`${markBase}-start`); } catch {}
    fetch(`/api/kpi/labor?${params}`, { signal: ctrl.signal })
      .then(async (r) => {
        // B4: auth states off the real fetch. 401 -> session-expired,
        // 403 -> not-authorized. Both render StateBoxes; zero data leak.
        if (r.status === 401) { setAuthError("expired"); throw new Error("session_expired"); }
        if (r.status === 403) { setAuthError("forbidden"); throw new Error("forbidden"); }
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setData(d); setLoadState("ok");
        try {
          performance.mark(`${markBase}-end`);
          performance.measure(markBase, `${markBase}-start`, `${markBase}-end`);
        } catch {}
      })
      .catch((e) => {
        // AbortError from cleanup: silent (a newer effect is inbound).
        // AbortError from our timeout: visible error with retry.
        if (e?.name === "AbortError" && String(ctrl.signal.reason?.message || "") !== "timeout_15s") {
          return;
        }
        if (String(e?.message) === "session_expired" || String(e?.message) === "forbidden") {
          setLoadState("auth");
          return;
        }
        const msg = e?.name === "AbortError" || String(ctrl.signal.reason?.message || "") === "timeout_15s"
          ? "Request took longer than 15 seconds. The API is reachable but the browser tab did not receive a response - retry, or check for a blocking extension."
          : String(e?.message || e).slice(0, 200);
        setLoadState("error");
        setErrorMsg(msg);
        setErrCode(errorCode("labor", e));
      })
      .finally(() => clearTimeout(to));
    return () => { clearTimeout(to); ctrl.abort(); };
  }, [status, isAllowed, account, start, end]);

  // ── URL setters ──────────────────────────────────────
  const setParam = (key, value) => {
    const p = new URLSearchParams(searchParams.toString());
    if (value == null || value === "") p.delete(key);
    else p.set(key, value);
    router.push(`/kpi/labor?${p.toString()}`);
  };
  const setParams = (patch) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    router.push(`/kpi/labor?${p.toString()}`);
  };

  // ── Actuals filtering (worker set) ────────────────────
  const filteredActuals = useMemo(() => {
    if (!data?.actuals) return [];
    if (!selectedWorkers || selectedWorkers.size === 0) return data.actuals;
    return data.actuals.filter(r => selectedWorkers.has(r.worker_id));
  }, [data, selectedWorkers]);

  // V25-1..V25-3 - aggregate roll-up POPULATION must match aggregate
  // budget POPULATION. When the account is a pseudo-key (ALL/EAST/WEST)
  // the server ships `aggregate_excluded_members` (envelope accounts
  // excluded from the aggregate budget). Rollup sums (week.amount,
  // grand.amount, totals) must exclude these members so both sides of
  // every variance compare like with like. The excluded rows are STILL
  // pushed into worker_rows so the aggregate drill can render them per
  // V25-2 (envelope row is never hidden).
  const aggregateExcludedSet = useMemo(
    () => new Set(data?.aggregate_excluded_members || []),
    [data]
  );
  const excludedFromRollup = (r) => aggregateExcludedSet.has(r.account_key);

  // ── weeksInRange: unique week_start values, sorted desc ──────
  // ONE canonical week count. Board + budget-for-range + pace calc all
  // read this. Never read grouped.length as "week count" (that's period
  // count). Never read filteredActuals.length as "week count" (that's
  // worker-week rows).
  const weekAggregates = useMemo(() => {
    if (!filteredActuals?.length) return [];
    const byWeek = new Map();
    for (const r of filteredActuals) {
      const wk = r.week_start;
      if (!byWeek.has(wk)) {
        byWeek.set(wk, {
          week_start: r.week_start, week_end: r.week_end,
          week_label: r.week_label,
          // H1: derive period client-side. Payload period_no is null on
          // backfill rows; we NEVER trust it.
          fiscal_year: fiscalYearOf(r.week_start) ?? r.fiscal_year ?? 2026,
          period_no: periodOf(r.week_start),
          hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0,
          dollars_regular: 0, dollars_overtime: 0, dollars_double_time: 0, dollars_premium_other: 0,
          amount: 0, hours_without_dollars: 0,
          worker_rows: [], coverage_states: new Set(),
        });
      }
      const w = byWeek.get(wk);
      // Drill payload gets EVERY row; rollup sums drop excluded members
      // so the vs-budget compare stays population-matched (V25-3).
      w.worker_rows.push(r);
      w.coverage_states.add(r.coverage_state);
      if (excludedFromRollup(r)) continue;
      w.hours_regular       += Number(r.hours_regular       || 0);
      w.hours_overtime      += Number(r.hours_overtime      || 0);
      w.hours_double_time   += Number(r.hours_double_time   || 0);
      w.hours_premium_other += Number(r.hours_premium_other || 0);
      w.dollars_regular       += Number(r.dollars_regular       || 0);
      w.dollars_overtime      += Number(r.dollars_overtime      || 0);
      w.dollars_double_time   += Number(r.dollars_double_time   || 0);
      w.dollars_premium_other += Number(r.dollars_premium_other || 0);
      w.amount                += Number(r.amount                || 0);
      w.hours_without_dollars += Number(r.hours_without_dollars || 0);
    }
    for (const w of byWeek.values()) {
      const states = [...w.coverage_states];
      w.coverage_state = states.length === 1 ? states[0] : "partial";
      if ((w.coverage_state === "unknown" || w.coverage_state === "hours_only") && w.amount > 0.01) {
        console.warn(`kpi-labor: collapsed row ${w.week_start} has amount=$${w.amount.toFixed(2)}; demoting to partial`);
        w.coverage_state = "partial";
      }
    }
    // Sort desc so the newest week (P9 today) appears first.
    return [...byWeek.values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
  }, [filteredActuals, aggregateExcludedSet]);

  const weeksInRange = weekAggregates.length; // canonical week count

  const grouped = useMemo(() => {
    if (!weekAggregates.length) return [];
    // V6-5 - grouping mode implied by selection. Month selection
    // groups by calendar month (weeks belong to the month their
    // MONDAY falls in - the same rule fiscalMonthsWithWeeks uses,
    // so a week never straddles). Every other selection groups by
    // fiscal period. No standalone group-by control.
    const groupByMonth = rangeSelectionEarly?.kind === "month";
    const MONTH_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
    const groups = [];
    for (const w of weekAggregates) {
      const fy = w.fiscal_year ?? 2026;
      let key, sortKey, groupLabel, groupHint;
      if (groupByMonth) {
        // Parse week_start UTC-safe (Mondays).
        const [yy, mm] = w.week_start.split("-").map(Number);
        const year = yy;
        const monthIndex = mm - 1;
        key = `M-${year}-${monthIndex}`;
        sortKey = year * 100 + monthIndex;
        groupLabel = `${MONTH_NAMES[monthIndex]} ${year}`;
        groupHint = { kind: "month", year, monthIndex };
      } else {
        const p = w.period_no ?? 0;
        key = `P-${fy}|${p}`;
        sortKey = -(fy * 100 + p);  // period desc (existing convention)
        groupHint = { kind: "period", period_no: p, fiscal_year: fy };
      }
      let g = groups.find(x => x.key === key);
      if (!g) {
        g = { key, fiscal_year: fy, period_no: w.period_no ?? 0, weeks: [], subtotal: null, groupLabel, groupHint, sortKey };
        groups.push(g);
      }
      g.weeks.push(w);
    }
    // Month mode - sort ascending (Jan first). Period mode retains
    // the descending-by-period convention D2 shipped.
    if (groupByMonth) {
      groups.sort((a, b) => a.sortKey - b.sortKey);
    } else {
      groups.sort((a, b) => a.sortKey - b.sortKey);
    }
    // Month group headers append "· N fiscal wks" per V6-5.
    if (groupByMonth) {
      for (const g of groups) {
        g.groupLabel = `${g.groupLabel} · ${g.weeks.length} fiscal wk${g.weeks.length === 1 ? "" : "s"}`;
      }
    }
    for (const g of groups) {
      const s = { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, hours_premium_other: 0, amount: 0, hours_without_dollars: 0 };
      for (const w of g.weeks) {
        s.hours_regular       += w.hours_regular;
        s.hours_overtime      += w.hours_overtime;
        s.hours_double_time   += w.hours_double_time;
        s.hours_premium_other += w.hours_premium_other;
        s.amount              += w.amount;
        s.hours_without_dollars += w.hours_without_dollars;
      }
      g.subtotal = s;
    }
    return groups;
  }, [weekAggregates, rangeSelectionEarly]);

  const totals = useMemo(() => {
    const t = { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, amount: 0, hours_without_dollars: 0 };
    for (const r of filteredActuals) {
      t.hours_regular += Number(r.hours_regular || 0);
      t.hours_overtime += Number(r.hours_overtime || 0);
      t.hours_double_time += Number(r.hours_double_time || 0);
      t.amount += Number(r.amount || 0);
      t.hours_without_dollars += Number(r.hours_without_dollars || 0);
    }
    return t;
  }, [filteredActuals]);

  const coverageCounts = useMemo(() => {
    const c = { complete: 0, partial: 0, hours_only: 0, unknown: 0, no_labor: 0 };
    for (const r of filteredActuals) c[r.coverage_state] = (c[r.coverage_state] || 0) + 1;
    return c;
  }, [filteredActuals]);

  const freshness = data?.derive_freshness;
  const freshnessH = hoursSinceISO(freshness?.last_walk_at);

  const workerRoster = useMemo(() => {
    if (!data?.actuals) return [];
    const ids = [...new Set(data.actuals.map(r => r.worker_id))];
    return ids
      .map(id => ({ id, label: workerLabel(data.workers?.[id], id, redact), meta: data.workers?.[id] }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data, redact]);

  const totalWorkersInRange = data?.actuals ? new Set(data.actuals.map(r => r.worker_id)).size : 0;
  const shownWorkers = selectedWorkers && selectedWorkers.size > 0 ? selectedWorkers.size : totalWorkersInRange;

  const grand = useMemo(() => {
    if (!grouped.length) return null;
    const g = { hours_regular: 0, hours_overtime: 0, hours_double_time: 0, amount: 0, hours_without_dollars: 0 };
    for (const period of grouped) {
      g.hours_regular       += period.subtotal.hours_regular;
      g.hours_overtime      += period.subtotal.hours_overtime;
      g.hours_double_time   += period.subtotal.hours_double_time;
      g.amount              += period.subtotal.amount;
      g.hours_without_dollars += period.subtotal.hours_without_dollars;
    }
    return g;
  }, [grouped]);

  const periodsIsAllHoursOnly = useMemo(() => {
    const set = new Set();
    for (const g of grouped) if (g.weeks.every(w => w.coverage_state === "hours_only")) set.add(g.key);
    return set;
  }, [grouped]);

  const grandLabel = grouped.length > 0
    ? `Range total (${grouped.length} period${grouped.length === 1 ? "" : "s"} with labor)`
    : "Range total";

  const isSalaried = data?.account_state === "salaried_only";

  // V25-15 - has the board EVER rendered in this session? Ref flips
  // true after the first successful data load. Cold start (never
  // rendered) gets a layout-mirroring skeleton; warm nav (previous
  // board present) keeps the previous board on screen at 0.45 opacity.
  const hasEverRenderedRef = useRef(false);
  useEffect(() => {
    if (loadState === "ok" && (data?.actuals?.length || 0) > 0) {
      hasEverRenderedRef.current = true;
    }
  }, [loadState, data]);

  // V25-4 + V25-18 - auto-open runs ONCE per account. Two rules:
  //   V25-4 - keying on `expandedPeriods.size === 0` re-fired every
  //           time the user emptied state (Collapse all), so Collapse
  //           never won. Keying on a ref keeps this a one-shot init:
  //             first mount / account switch  -> ref differs, open, update ref
  //             toggle / collapse-all / range -> ref matches, early return
  //   V25-18 - multi-period ranges open COLLAPSED. The collapsed period
  //            view is the most useful read in the table; only single-
  //            period ranges auto-open (their weeks visible on landing).
  const autoOpenAccountRef = useRef(null);
  useEffect(() => {
    if (!grouped.length) return;
    if (autoOpenAccountRef.current === account) return;
    autoOpenAccountRef.current = account;
    // V25-18 - only single-period ranges auto-open; multi-period
    // ranges (FYTD, month, custom, last_4wk, last_13wk) land collapsed.
    if (rangeSelectionEarly?.kind !== "period") {
      setExpandedPeriods(new Set());
      return;
    }
    // Open first two groups by default (single-period lands with its
    // weeks visible). V6-5 - key varies by grouping mode (period_no in
    // period mode, month-index in month mode).
    const openKey = (g) => g?.groupHint?.kind === "month" ? g.groupHint.monthIndex : g?.period_no;
    const next = new Set();
    const k0 = openKey(grouped[0]);
    const k1 = openKey(grouped[1]);
    if (k0 != null) next.add(k0);
    if (k1 != null) next.add(k1);
    setExpandedPeriods(next);
  }, [grouped, account, rangeSelectionEarly]);

  // F16 - per-worker range totals for the rate-on-hover title. Cheap;
  // derived from filteredActuals which is already memo'd.
  const workerRangeTotals = useMemo(() => {
    const m = {};
    for (const r of filteredActuals) {
      const id = r.worker_id;
      if (!m[id]) m[id] = { hoursWorked: 0, dollarsTotal: 0 };
      m[id].hoursWorked += Number(r.hours_regular || 0) + Number(r.hours_overtime || 0) + Number(r.hours_double_time || 0);
      m[id].dollarsTotal += Number(r.amount || 0);
    }
    return m;
  }, [filteredActuals]);

  // Current period for hero preset labels (P5). Derived client-side so
  // it holds even before /api/kpi/labor account_periods lands.
  const currentPeriodNo = useMemo(() => periodOfDate(today), [today]);

  // H3 - infer preset from (start, end, today) so hero suffix and
  // preset chip highlight even on a fresh page load (URL has no
  // preset param; user landed with FY defaults). If no preset matches
  // the resolved range, resolvedPreset is null and hero falls back to
  // "· MM/DD/YY – MM/DD/YY".
  const resolvedPreset = useMemo(() => {
    if (lastPreset) return lastPreset; // user clicked one this session
    if (start === FY_START && end === today) return "fytd";
    if (start === addDaysISO(today, -27)  && end === today) return "last_4wk";
    if (start === addDaysISO(today, -90)  && end === today) return "last_13wk";
    // this_period / last_period rely on account_periods bounds
    const periods = data?.account_periods || [];
    if (periods.length) {
      const past = periods.filter(p => p.start && p.end && p.start <= today)
        .sort((a, b) => a.start.localeCompare(b.start));
      const cur = past[past.length - 1];
      const prev = past[past.length - 2];
      if (cur && start === cur.start && end === cur.end) return "this_period";
      if (prev && start === prev.start && end === prev.end) return "last_period";
    }
    return null;
  }, [lastPreset, start, end, today, data]);

  function applyPreset(kind) {
    const t = today;
    setLastPreset(kind);
    if (kind === "last_4wk")  return setParams({ start: addDaysISO(t, -27), end: t });
    if (kind === "last_13wk") return setParams({ start: addDaysISO(t, -90), end: t });
    if (kind === "fytd")      return setParams({ start: FY_START,           end: t });
    const periods = data?.account_periods || [];
    if (!periods.length) return;
    const withStart = periods.filter(p => p.start && p.end).sort((a, b) => a.start.localeCompare(b.start));
    const past = withStart.filter(p => p.start <= t);
    if (kind === "this_period") {
      const cur = past[past.length - 1];
      if (cur) setParams({ start: cur.start, end: cur.end });
    } else if (kind === "last_period") {
      const prev = past[past.length - 2];
      if (prev) setParams({ start: prev.start, end: prev.end });
    }
  }

  // V6-3/V6-8 - RangeMenu commit path. selection: { kind, value? }
  //   preset -> setLastPreset(value); rely on inferred label
  //   period -> setLastPreset(null); the URL start/end resolves to
  //             "PERIOD n" via inferRangeSelection
  //   month  -> setLastPreset(null); resolves to "<MONTH> <year>"
  //   custom -> setLastPreset(null); no inference match -> "custom"
  // Also writes { startISO, endISO } to localStorage (kpi.range).
  function onRangeCommit(startISO, endISO, selection) {
    if (selection?.kind === "preset" && selection.value) {
      setLastPreset(selection.value);
    } else {
      setLastPreset(null);
    }
    setParams({ start: startISO, end: endISO });
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(LAST_RANGE_KEY, JSON.stringify({ startISO, endISO }));
      }
    } catch {}
    setLiveMsg("Range updated.");
  }

  // V6-7 - inferred selection consumed by the RangeMenu label + folio/
  // hero echo + V6-5 month grouping. Returns { kind: 'period'|'month',
  // value } when start/end matches; else null. Preset key is separately
  // tracked via resolvedPreset. Also used above in the grouped memo.
  // (See earlier declaration of rangeSelectionEarly for the grouped
  // dependency; this line is intentionally a re-export for readers.)
  const selectedPeriodNo = rangeSelectionEarly?.kind === "period" ? rangeSelectionEarly.value : null;
  const selectedMonth    = rangeSelectionEarly?.kind === "month"  ? rangeSelectionEarly.value : null;
  const rangeSelection = rangeSelectionEarly;

  function exportHref() {
    const p = new URLSearchParams({ account, start, end });
    if (selectedWorkers && selectedWorkers.size > 0) p.set("workers", [...selectedWorkers].join(","));
    if (redact) p.set("redact", "1");
    return `/api/kpi/labor/export?${p.toString()}`;
  }

  // ── Auth screens (P9 · nine states 1-3) ─────────────
  if (status === "loading") {
    return (<div className="kpi-app"><div className="kpi-wrap"><StateLoading /></div></div>);
  }
  if (status === "unauthenticated") {
    return (<div className="kpi-app"><div className="kpi-wrap"><StateSessionExpired /></div></div>);
  }
  if (!isAllowed) {
    return (<div className="kpi-app"><div className="kpi-wrap"><StateNotAuthorized /></div></div>);
  }

  const hasData = !isSalaried && loadState === "ok" && (data?.actuals?.length || 0) > 0;

  // Extract account list from data for the folio (D3 will replace with
  // server aggregate). For D2 the roster is the ACCOUNTS constant.
  // B10: announce switch + focus-to-hero for keyboard users.
  const onPickAccount = (a) => {
    setParams({ account: a, workers: "", view: "" });
    setLiveMsg(`Switched to ${a}.`);
    // Let the render complete before we grab focus.
    setTimeout(focusBoard, 60);
  };

  const workersOnChangeSet = (nextSet) => {
    if (nextSet == null) return setParam("workers", "");
    if (nextSet.size === 0) return setParam("workers", "__none__");
    if (nextSet.size === workerRoster.length) return setParam("workers", "");
    setParam("workers", [...nextSet].join(","));
  };

  // Print-time scope line - kept for @media print sheet identification.
  const printScopeText = buildPrintScopeLine({
    start, end, workerRoster, selectedWorkers, redact,
  });

  // Freshness popover content. Carries coverage plain-language + In
  // view counts + pipeline lines that used to live in the retired rail.
  const dominantCoverage = (() => {
    const rank = { complete: 0, hours_only: 1, partial: 2, no_labor: 3, unknown: 4 };
    const present = Object.keys(rank).filter(k => (coverageCounts?.[k] || 0) > 0);
    if (present.length === 0) return "complete";
    present.sort((a, b) => rank[b] - rank[a]);
    return present[0];
  })();
  const COVERAGE_LINE = {
    complete:   "Every shift in this range has priced hours. Nothing is missing from payroll.",
    hours_only: "Hours are in, pay data has not landed yet.",
    partial:    "Some shifts are missing pay data - dollars for those weeks are incomplete.",
    no_labor:   "No labor recorded in this range.",
    unknown:    "The data feed has not covered part of this range.",
  };
  const freshnessPop = loadState === "ok" && data ? (
    <div className="kpi-fresh-pop-body">
      <div className="kpi-fresh-pop-plain">{COVERAGE_LINE[dominantCoverage]}</div>
      <div className="kpi-fresh-pop-row"><span>In view</span><b>{weeksInRange} weeks · {filteredActuals.length} worker-weeks</b></div>
      <div className="kpi-fresh-pop-sep" aria-hidden="true" />
      <div className="kpi-fresh-pop-row"><span>Orphan facts</span><b>{data?.unattributed?.length ?? 0}</b></div>
      <div className="kpi-fresh-pop-row"><span>Unmapped earning types</span><b>{data?.unmapped_names?.length ?? 0}</b></div>
      {/* V31 item 1 - plain-English labels; walk + derive run on ONE
          nightly job so both timestamps land the same night. */}
      <div className="kpi-fresh-pop-row"><span>Rippling data pulled</span><b>{data?.derive_freshness?.last_walk_at ? fmtTimestamp(data.derive_freshness.last_walk_at) : "—"}</b></div>
      <div className="kpi-fresh-pop-row"><span>Dashboard figures rebuilt</span><b>{data?.derive_freshness?.last_derive_at ? fmtTimestamp(data.derive_freshness.last_derive_at) : "—"}</b></div>
      <div className="kpi-fresh-pop-sep" aria-hidden="true" />
      <div className="kpi-fresh-pop-contract">
        Updates nightly around 2:00 AM CT. Hours land as timesheets are approved; dollars land when payroll processes, so the current week reads as partial until then.
      </div>
    </div>
  ) : null;

  // SYSTEM status strip - hugs the folio foot (V7-19). V25-14 keeps
  // this mounted through every fetch (no unmount on `loadState ===
  // "loading"`); values freeze on the last-known data until the new
  // response lands, mirroring the freshness chip's `Loading data`.
  const systemStrip = data && !isSalaried ? (
    <SystemStrip
      coverageCounts={coverageCounts}
      dominantCoverage={dominantCoverage}
      freshness={freshness}
      freshnessH={freshnessH}
    />
  ) : null;

  // V6-1 fiscal context - TODAY (MM/DD), PERIOD n (from account_periods
  // when present, else client-derived via periodOf), WEEK w where w is
  // week-of-period (1..4) via periods.js weekOfPeriod().
  const fiscalCtx = (() => {
    const past = (data?.account_periods || [])
      .filter(p => p.start && p.end)
      .sort((a, b) => a.start.localeCompare(b.start))
      .filter(p => p.start <= today);
    const cur = past[past.length - 1];
    return {
      today: today.slice(5).replace("-", "/"),
      period: cur?.period_no ?? periodOfDate(today),
      week: weekOfPeriod(today),
    };
  })();

  // Human range label for the board's multi-period display.
  const rangeLabelForBoard = (() => {
    if (rangeSelectionEarly?.kind === "period") return `Period ${rangeSelectionEarly.value}`;
    if (rangeSelectionEarly?.kind === "month") {
      const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      return `${months[rangeSelectionEarly.value.monthIndex]} ${rangeSelectionEarly.value.year}`;
    }
    if (resolvedPreset === "fytd") return "fiscal year to date";
    if (resolvedPreset === "last_4wk") return "the last 4 weeks";
    if (resolvedPreset === "last_13wk") return "the last 13 weeks";
    if (resolvedPreset === "this_period" || resolvedPreset === "last_period") return `Period ${data?.board?.period_no ?? ""}`.trim();
    return `${start} to ${end}`;
  })();

  // ── Middle content: board (sentence + story) then WeekTable + 9 states ──
  const mainContent = (
    <>
      {/* C5.5 name-availability banner. */}
      {!isSalaried && loadState === "ok" && data?.name_availability && data.name_availability.total > 0 && data.name_availability.resolved < data.name_availability.total && (
        <div className="kpi-note-info" role="status">
          {data.name_availability.resolved === 0
            ? data.name_availability.reason === "users_table_empty_or_unreachable"
              ? <>Names unavailable: the users walk has not populated <code>rippling_raw_users</code> for the {data.name_availability.total} workers in scope. Falling back to numbers and titles. This resolves on the next successful users walk.</>
              : <>Names unavailable: none of the {data.name_availability.total} workers in scope have a canonical name field. Falling back to numbers and titles.</>
            : <>{data.name_availability.total - data.name_availability.resolved} of {data.name_availability.total} workers do not resolve to a canonical name and render as numbers.</>}
        </div>
      )}

      {/* V25-15 - board stays MOUNTED whenever we have data, regardless
          of loadState. During a warm refetch (loadState === "loading"
          with previous data) it renders at 0.45 opacity via
          `.kpi-board-loading`. It only unmounts on genuine cold start
          (no data ever), where the skeleton below takes over. */}
      {!isSalaried && (data?.actuals?.length || 0) > 0 && (
        <div
          ref={boardRef}
          tabIndex={-1}
          className={`kpi-board ${loadState === "loading" ? "kpi-board-loading" : ""}`}
          style={{ outline: "none" }}
          aria-busy={loadState === "loading" ? "true" : undefined}
        >
          {data.board?.applies !== false && (
            <>
              <StoryBlock
                board={data.board}
                account={account}
                rangeLabel={rangeLabelForBoard}
                budgetPeriods={data?.budget_periods || []}
                todayISO={today}
              />
              <SignalCards board={data.board} />
              <DetailsStrip board={data.board} />
            </>
          )}
        </div>
      )}

      {loadState === "auth" && authError === "expired" ? (
        <StateSessionExpired />
      ) : loadState === "auth" && authError === "forbidden" ? (
        <StateNotAuthorized />
      ) : loadState === "ok" && data.account_state === "salaried_only" ? (
        <StateSalaried account={account} message={data.account_state_message} />
      ) : loadState === "loading" && !hasEverRenderedRef.current ? (
        /* V25-16 - COLD skeleton mirrors the real layout so the shape
           of what is coming is promised: spend card + four signal
           cards + numbers strip + six table rows. */
        <BoardSkeleton />
      ) : loadState === "loading" ? (
        /* V25-15 warm nav: board above is opacity 0.45; render nothing
           here (the previous board and table hold the layout height). */
        null
      ) : loadState === "error" ? (
        <StateError
          code={errCode}
          category={errorMsg}
          onRetry={() => setParam("_r", Date.now())}
        />
      ) : loadState === "ok" && !filteredActuals.length ? (
        // Fix 4 (D2.1) - three-way branch per spec 3.9 + v5 line ~1052:
        //   worker filter active   -> StateEmptyFiltered
        //   pipeline never derived -> StateEmptyFirstRun (keyed off
        //                             derive_freshness.last_derive_at,
        //                             not row count - the range being
        //                             empty is a filter, not a pipeline
        //                             failure)
        //   otherwise              -> StateEmptyRange (the date range
        //                             is a filter; one-tap Use FYTD)
        selectedWorkers && selectedWorkers.size > 0 ? (
          <StateEmptyFiltered
            workerCount={selectedWorkers.size}
            onClear={() => { setParam("workers", ""); setLiveMsg("Worker filter cleared."); setTimeout(focusBoard, 60); }}
          />
        ) : !data?.derive_freshness?.last_derive_at ? (
          <StateEmptyFirstRun />
        ) : (
          <StateEmptyRange
            onUseFYTD={() => {
              applyPreset("fytd");
              setLiveMsg("Range set to fiscal year to date.");
              setTimeout(focusBoard, 60);
            }}
          />
        )
      ) : null}

      {/* V25-15 - WeekTable stays MOUNTED across every refetch as long
          as data exists. Warm loading dims to 0.45 via wrapper class;
          cold start (no data) omits it (skeleton is above). */}
      {!isSalaried && (data?.actuals?.length || 0) > 0 && filteredActuals.length > 0 && (
        <div className={loadState === "loading" ? "kpi-board-loading" : ""}>
        <WeekTable
          account={account}
          grouped={grouped}
          grandTotal={grand}
          workers={data.workers}
          redact={redact}
          onToggleRedact={(next) => {
            setParam("redact", next ? "1" : "");
            setLiveMsg(next ? "Names hidden on screen and in export." : "Names shown.");
          }}
          workerRoster={workerRoster}
          selectedWorkers={selectedWorkers}
          onWorkersChange={workersOnChangeSet}
          expandedPeriods={expandedPeriods}
          onTogglePeriod={(p) => {
            setExpandedPeriods(prev => {
              const next = new Set(prev);
              if (next.has(p)) next.delete(p); else next.add(p);
              return next;
            });
          }}
          expandedWeeks={expandedWeeks}
          onToggleWeek={(w) => {
            setExpandedWeeks(prev => {
              const next = new Set(prev);
              if (next.has(w)) next.delete(w); else next.add(w);
              return next;
            });
          }}
          onExpandAll={() => {
            // V6-5 - key varies by grouping mode: period_no in period
            // mode, month-index in month mode. Both live in the same
            // expandedPeriods Set; grouping-mode alignment is enforced
            // upstream by the group's openKey computation.
            const all = new Set(grouped.map(g => g.groupHint?.kind === "month" ? g.groupHint.monthIndex : g.period_no));
            setExpandedPeriods(all);
          }}
          onCollapseAll={() => {
            setExpandedPeriods(new Set());
            setExpandedWeeks(new Set());
          }}
          onJumpPeriod={(p) => {
            // V29-20 - chip TOGGLES. Prior handler was `new Set([...prev, p])`
            // (add-only) so a chip could open but never close. Now:
            //   closed group -> open + scroll
            //   open group   -> close + do NOT scroll (the group's row
            //                   is already in view; scrolling would be
            //                   disorienting).
            // V25-4 regression guard: Collapse all still clears every
            // group including the first (unchanged handler above).
            let willOpen;
            setExpandedPeriods(prev => {
              const next = new Set(prev);
              if (next.has(p)) { next.delete(p); willOpen = false; }
              else             { next.add(p);    willOpen = true;  }
              return next;
            });
            setTimeout(() => {
              if (!willOpen) return;
              // Try period anchor first, then month anchor.
              const el = document.getElementById(`kpi-per${p}`) || document.getElementById(`kpi-permo${p}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 60);
          }}
          onEscape={() => setExpandedWeeks(new Set())}
          todayISO={today}
          workerRangeTotals={workerRangeTotals}
          aggregateMode={PSEUDO_KEYS.has(account)}
          budgetPeriods={data?.budget_periods || []}
          weekBudgets={data?.week_budgets || []}
          onPickAccount={PSEUDO_KEYS.has(account) ? (k) => setParams({ account: k, workers: "", view: "" }) : null}
          rangeSelection={rangeSelectionEarly}
          resolvedPreset={resolvedPreset}
          rolledUpMembers={data?.rolled_up_members || []}
          aggregateExcludedMembers={data?.aggregate_excluded_members || []}
        />
        </div>
      )}
    </>
  );

  return (
    <div className="kpi-app" data-density={isCompact ? "compact" : undefined}>
      <div className="kpi-wrap">
        <Shell
          account={account}
          fiscal={fiscalCtx}
          freshness={freshness}
          dataLoading={loadState === "loading" || loadState === "idle"}
          activeSection="labor"
          printScopeText={printScopeText}
          /* V25-14 - Range control stays MOUNTED through every refetch.
             Uses last-known account_periods; the ranges keep responding
             the moment the loading chip clears. */
          rangeProps={!isSalaried && (data || loadState === "ok") ? {
            startISO: start,
            endISO: end,
            todayISO: today,
            hasPeriods: !!data?.account_periods?.length,
            accountPeriods: data?.account_periods || [],
            resolvedPreset,
            selectedPeriodNo,
            selectedMonth,
            onCommit: onRangeCommit,
          } : null}
          exportHref={data && data?.account_state !== "salaried_only" ? exportHref() : null}
          onExport={() => {
            setToast({
              message: redact ? "Export ready · names redacted." : "Export ready.",
              tone: "info",
              durationMs: 4000,
            });
            setLiveMsg(redact ? "Export downloading with names redacted." : "Export downloading.");
          }}
          exportRedact={redact}
          exportDisabledReason={PSEUDO_KEYS.has(account) ? "Per-account export for portfolio views ships next update." : null}
          freshnessPop={freshnessPop}
          folioRail={
            <FolioRail
              activeAccount={account}
              onPickAccount={onPickAccount}
              accountsDirectory={data?.accounts_directory}
              regionalDirectorsDisplay={data?.regional_directors_display}
              folioFoot={systemStrip}
            />
          }
          main={mainContent}
        />
      </div>

      {/* ── B10 live region · always mounted, silent when empty ── */}
      <div aria-live="polite" aria-atomic="true" className="kpi-sr-live">{liveMsg}</div>

      {/* ── P10/P11 toast host (M4 export) ─── */}
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

// V25-16 - COLD skeleton mirrors the actual board layout so the shape
// of the incoming content is promised: a spend-card block, four
// signal-card blocks, a numbers-strip block, six table rows, each at
// its real height. Only renders when the board has NEVER rendered in
// this session (first paint). Warm nav keeps the previous board.
function BoardSkeleton() {
  return (
    <div className="kpi-board kpi-board-skel" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading dashboard</span>
      <div className="kpi-skel kpi-skel-spend" />
      <div className="kpi-skel-sigs">
        <div className="kpi-skel kpi-skel-sig" />
        <div className="kpi-skel kpi-skel-sig" />
        <div className="kpi-skel kpi-skel-sig" />
        <div className="kpi-skel kpi-skel-sig" />
      </div>
      <div className="kpi-skel kpi-skel-det" />
      <div className="kpi-skel-tbl">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="kpi-skel kpi-skel-row" />
        ))}
      </div>
    </div>
  );
}

// SYSTEM status strip (V7-19). Two 22px rows, quietly stated: Payroll
// data + Nightly feed. Colors mirror coverage severity + freshness
// tint. Value classes: kpi-sys-v-ok / -warn / -bad. Dot mirrors.
function SystemStrip({ coverageCounts, dominantCoverage, freshness, freshnessH }) {
  const total = Object.values(coverageCounts || {}).reduce((s, n) => s + Number(n || 0), 0);
  const complete = Number(coverageCounts?.complete || 0);
  const payTone = dominantCoverage === "complete" ? "ok"
                : dominantCoverage === "unknown"  ? "bad"
                : "warn";
  const feedTone = freshnessH == null ? "bad"
                 : freshnessH >= 54    ? "bad"
                 : freshnessH >= 30    ? "warn"
                 : "ok";
  // Drop the timestamp - it's redundant with the freshness pill in the
  // command bar (which now owns the "when last touched" detail). Row
  // reads the status token only so the 260px folio never overflows.
  const feedValue = feedTone === "bad" ? "stale"
                  : feedTone === "warn" ? "slow"
                  : "healthy";
  return (
    <div className="kpi-sys" role="status" aria-label="System status">
      <div className="kpi-sys-h">SYSTEM</div>
      <div className="kpi-sys-r">
        <span className={`kpi-sys-dot kpi-sys-dot-${payTone}`} aria-hidden="true" />
        <span className="kpi-sys-k">Payroll data</span>
        <span className={`kpi-sys-v kpi-sys-v-${payTone}`}>{complete} of {total}</span>
      </div>
      <div className="kpi-sys-r">
        <span className={`kpi-sys-dot kpi-sys-dot-${feedTone}`} aria-hidden="true" />
        <span className="kpi-sys-k">Nightly feed</span>
        <span className={`kpi-sys-v kpi-sys-v-${feedTone}`}>{feedValue}</span>
      </div>
    </div>
  );
}

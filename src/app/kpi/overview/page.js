"use client";
// /kpi/overview
//
// KPI Dashboard - P&L Overview section (Phase 3 board client).
//
// Consumes /api/kpi/overview which returns a fully-formatted payload
// per KPI_MASTER_SCOPE.md v4 §5.4-§5.8. The client renders. It never
// computes a dollar, a percent, or a direction word - all of that
// arrives formatted from the resolver.
//
// URL state (subset of labor's, tuned for the Overview):
//   ?account         team_key / ALL / EAST / WEST
//   ?start           YYYY-MM-DD
//   ?end             YYYY-MM-DD
//   ?preview         preview target (narrows via role gate)
//   ?include_salary  '1' -> reveals 3100.1 / 3100.2 sub-lines (site
//                          posture only; corporate always includes)
//
// Overview Phase 4 (2026-08-31): the section is enabled and this route
// is reachable from the Section dropdown + the TopNav /kpi entry. The
// salary control renders on the site posture only (R-28) and drives
// ?include_salary=1 on this URL; the drill button to /kpi/labor
// preserves the flag so the two boards agree on which pool is counted.
//
// Loading philosophy (§5.4 charter 4):
//   - Skeleton on cold load (no prior data)
//   - Ghost + honest chip on warm refetch (prior data present)
//   - Never a blank canvas, never a stale control from the previous
//     account (see the loading-skeleton + wipe-on-account-change
//     defenses below)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

import "../kpi.css";
import "../current-period.css";
import "./overview.css";

import {
  FY_START_ISO,
  periodStartISO,
  periodEndISO,
  currentPeriodNo,
  weekOfPeriod,
  inferRangeSelection,
  r93FytdEndISO,
  r93ExcludedPeriodNo,
} from "@/app/kpi/labor/lib/periods";
import { Shell } from "@/app/kpi/labor/components/Shell";
import { FolioRail, PSEUDO_KEYS } from "@/app/kpi/labor/components/FolioRail";
import { ACCOUNTS, FY_START, STATIC_DIRECTORY, STATIC_RDO_DISPLAY } from "@/app/kpi/labor/lib/accounts";
import { deriveClientAccount } from "@/lib/kpi/previewAccess";
import {
  StateBox,
  StateNotAuthorized,
  StateSessionExpired,
  StateError,
  LockedPanel,
  errorCode,
} from "@/app/kpi/labor/components/StateBoxes";

import StatusLine from "./components/StatusLine";
import SettlingStrip from "./components/SettlingStrip";
import OverdueNudge from "./components/OverdueNudge";
import DataCurrentPop from "./components/DataCurrentPop";
import CardsRow from "./components/CardsRow";
import WeekRail from "./components/WeekRail";
import Chart from "./components/Chart";
import CostLines from "./components/CostLines";
import RevenueLines from "./components/RevenueLines";
import PnlStatement from "./components/PnlStatement";
import AlsoTracked from "./components/AlsoTracked";
import KpiLoader from "../components/KpiLoader";
// R-109 · new Current period one-table view. Kevin ruling 2026-09-15:
// on CP only, the three cards + week rail + cost-lines + P&L are all
// replaced by a single table with review cards below. Other ranges
// unchanged (Guard 1).
import CurrentPeriodTable from "./components/CurrentPeriodTable";
import CurrentPeriodReview from "./components/CurrentPeriodReview";
// Consolidation PR 1 (2026-09-22). Rippling labor detail as a fold
// below the Full P&L on closed / CY, below CurrentPeriodReview on
// CP. Server-side canSeeSalary gate holds via the fetch alone.
import LaborLedger from "./components/LaborLedger";
// Kevin ruling 2026-10-09 (PR-billback-1). Billed-back-to-club card
// (replaces Chart in the split-right column for management-fee
// accounts on multi-period ranges) + its bottom-of-page fold. Both
// components self-hide when billback is null, so the single-account
// branch can mount them unconditionally.
import BillbackCard from "./components/BillbackCard";
import BillbackLedger from "./components/BillbackLedger";
// Kevin ruling 2026-10-12. Single-period face of the billed-back card.
// Renders in the split-right slot on management-fee + single-period views;
// fed by the billback_period payload (same source as PurchasingFold's
// goal row, so the two agree by construction).
import BillbackPeriodCard from "./components/BillbackPeriodCard";
// R-150 (2026-09-22). Purchasing detail as a fold, period into weeks
// into transactions. Mounts beside the labor fold on single-period
// ranges only; multi-period (Current Year) is R-151 and does not
// render this. Own fetch of /api/kpi/purchasing?drill=lines, own
// controlled fold state.
import PurchasingFold from "./components/PurchasingFold";

const LAST_ACCOUNT_KEY = "kpi:overview:lastAccount";

export default function KpiOverviewPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const email = session?.user?.email?.toLowerCase().trim() || "";
  // Client-side auth is advisory only - the API route is the sole
  // authority (mirrors labor's V-role-gates + purchasing's TEST_MODE
  // comment). Fetch fires as soon as we know the session status has
  // settled (unauthenticated -> 401 is a valid response path handled
  // by the render). This also lets TEST_MODE local runs render, per
  // the memory rule "TEST_MODE bypass for Playwright + local UI
  // battery."

  const urlAccount = searchParams.get("account");
  const fetchAccount = urlAccount || "";

  // Persist last-viewed account so re-open lands on the last selection.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (urlAccount) {
      try { localStorage.setItem(LAST_ACCOUNT_KEY, urlAccount); } catch {}
      return;
    }
    let saved = null;
    try { saved = localStorage.getItem(LAST_ACCOUNT_KEY); } catch {}
    const savedIsValidAccount = !!saved && (ACCOUNTS.includes(saved) || PSEUDO_KEYS.has(saved));
    const urlPreview = searchParams.get("preview") || "";
    if (!saved || !savedIsValidAccount || urlPreview) return;
    const p = new URLSearchParams(searchParams.toString());
    p.set("account", saved);
    router.replace(`/kpi/overview?${p.toString()}`);
  }, [urlAccount, router, searchParams]);

  const today = new Date().toISOString().slice(0, 10);
  const urlStart = searchParams.get("start");
  const urlEnd = searchParams.get("end");
  const urlPreview = searchParams.get("preview");
  const urlLabel = searchParams.get("label");
  // Overview Phase 4 (R-28): salary reveal is a URL-tracked flag,
  // mirroring the labor board's ?salary=1 pattern. The route re-checks
  // the visibility gate every request, so a shared link that opens as
  // a caller without salary access renders without the split - no
  // error, no message, just correct behaviour.
  const urlIncludeSalary = searchParams.get("include_salary") === "1";

  const start = urlStart || FY_START;
  // Kevin ruling 2026-09-08. Landing with no range params applies the
  // fytd preset, same as clicking "This year" in the picker. Prior
  // default of `today` produced a Custom range (FY_START to today)
  // that included the just-closed-but-not-yet-verified period and
  // silently disagreed with the picker path - live verified TBJ - FL
  // landed at $1,834,952 vs picker's $1,702,872. R-93 helper used
  // (same one the picker's fytd branch uses), so both paths converge.
  const end = urlEnd || r93FytdEndISO(today) || today;

  const rangeSelection = useMemo(() => inferRangeSelection(start, end), [start, end]);

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState("idle"); // idle | loading | refetching | ok | error | auth
  // Kevin ruling 2026-10-13 (cleanup). errorMsg was write-only - the
  // rendered error state consumes errCode (via <StateError code={errCode}
  // ... />). Removed with its two setter calls.
  const [errCode, setErrCode] = useState(null);
  const [authError, setAuthError] = useState(null);
  // Kevin ruling 2026-10-13 (KPI perf). Landing redirect sets this to
  // skip the next Effect 2 run - the data we have is already scoped to
  // the landing account, so re-fetching after the URL rewrites would be
  // a redundant round-trip.
  const skipRedirectFetchRef = useRef(false);

  const account = deriveClientAccount({
    urlAccount,
    previewAccount: data?.preview_account,
    landingAccount: data?.landing_account,
  });

  // 2026-09-01 preview-render fix: no derived-account wipe. Prior
  // implementation ran an effect on `account` change and setData(null)
  // to defend against showing stale numbers from a previous account.
  // But `account` is derived from the response (preview_account /
  // landing_account) as well as the URL, so the initial "" -> real
  // transition on preview arrival wiped the just-fetched payload and
  // left the client on skeleton forever. Labor + Purchasing carry no
  // equivalent wipe; the refetching state below already renders the
  // prior board at reduced opacity with a "Refreshing..." chip on real
  // URL-driven account switches (charter 4 satisfied by the ghost
  // pattern, not by nuking data).

  // ── Fetch overview data ─────────────────────────────────────
  useEffect(() => {
    if (status === "loading") return;
    if (skipRedirectFetchRef.current) {
      skipRedirectFetchRef.current = false;
      return;
    }
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(new Error("timeout_55s")), 55000);
    // Warm refetch vs cold load:
    //   - No prior data                    -> loading (skeleton)
    //   - Prior data (account preserved)   -> refetching (ghost + chip)
    setLoadState(data ? "refetching" : "loading");
    setErrCode(null);
    setAuthError(null);
    const params = new URLSearchParams();
    if (fetchAccount) params.set("account", fetchAccount);
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (urlPreview) params.set("preview", urlPreview);
    if (urlIncludeSalary) params.set("include_salary", "1");
    // TEST_MODE role-injection forwards (Overview Phase 3, PR #916).
    // These params only take effect on the server when the route sees
    // TEST_MODE=true && VERCEL!=1 (double-gated in route.js). On Vercel
    // they are silently ignored - the real session role wins.
    const urlTestRole = searchParams.get("_test_role");
    const urlTestScope = searchParams.get("_test_scope");
    if (urlTestRole) params.set("_test_role", urlTestRole);
    if (urlTestScope) params.set("_test_scope", urlTestScope);
    fetch(`/api/kpi/overview?${params}`, { signal: ctrl.signal })
      .then(async (r) => {
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
        setData(d);
        setLoadState("ok");
      })
      .catch((e) => {
        if (e?.name === "AbortError" && String(ctrl.signal.reason?.message || "") !== "timeout_55s") {
          return;
        }
        if (String(e?.message) === "session_expired" || String(e?.message) === "forbidden") {
          setLoadState("auth");
          return;
        }
        setLoadState("error");
        setErrCode(errorCode("overview", e));
      })
      .finally(() => clearTimeout(to));
    return () => { clearTimeout(to); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, fetchAccount, start, end, urlPreview, urlIncludeSalary]);

  // Landing redirect - when the URL has no account and preview is not
  // active, redirect to the caller's landing_account once known.
  useEffect(() => {
    if (urlAccount) return;
    if (data?.preview_account) return;
    const landing = data?.landing_account;
    if (!landing) return;
    const p = new URLSearchParams(searchParams.toString());
    p.set("account", landing);
    skipRedirectFetchRef.current = true;
    router.replace(`/kpi/overview?${p.toString()}`);
  }, [urlAccount, data?.landing_account, data?.preview_account, router, searchParams]);

  // R-109 · Labor + Purchasing fetch for the Current period one-table
  // view. Prompt § 2: "one source, three consumers" for week_rail
  // (Overview owns it). Per-week 3100 landed lives on Labor's board;
  // per-week 3200/3400 lives on Purchasing weekly[]. Fired only when
  // the CP gate is true so no extra fetches on any other range
  // (Guard 1: other ranges untouched).
  // Kevin ruling 2026-10-13 (KPI perf). cpLabor used to be its own state
  // slot filled by Effect 4's labor fetch - but Effect 5's labor-ledger
  // fetch fires with identical params on every single-account view
  // (including CP), producing a redundant /api/kpi/labor round-trip. The
  // state is now a derivation off laborLedger when useCpTable is active;
  // Effect 4 was reduced to a purchasing-only fetch below.
  const [cpPurch, setCpPurch] = useState(null);
  const [cpAuxError, setCpAuxError] = useState(null);
  const cpGateActive = data?.range?.kind === "period" && data?.period_state === "open";
  // R-110 (2026-09-16). NP gate. On planned periods the shared
  // CurrentPeriodTable renders too, driven off is_future_range from
  // the labor payload (Overview does NOT ship is_future_range - that
  // asymmetry is intentional: Overview's period_state === "planned"
  // is what tells us this is a future range, and it is authoritative
  // enough for the fetch gate below). Any consumer that needs both
  // sides has to know to consult labor's flag or overview's period_
  // state - do not add a parallel flag to Overview without matching
  // its planning-board consumers.
  const npGateActive = data?.range?.kind === "period" && data?.period_state === "planned";
  const useCpTable = cpGateActive || npGateActive;
  useEffect(() => {
    if (!useCpTable) {
      setCpPurch(null);
      setCpAuxError(null);
      return;
    }
    // Kevin 2026-09-15 follow-up 1. Same defect class as Purchasing
    // #1121: `?preview=<account>` URL has no ?account=, so fetchAccount
    // is "" and the old guard stranded the fetch indefinitely. Fire the
    // fetch when EITHER a fetchAccount or a preview is present; still
    // bail if neither is set (no range to fetch).
    if (!fetchAccount && !urlPreview) return;
    if (!start || !end) return;
    // Kevin ruling 2026-10-13 (KPI perf). This effect used to fetch BOTH
    // labor and purchasing in Promise.all. The labor leg was byte-
    // identical to Effect 5's labor-ledger fetch below (same account +
    // start + end + preview + include_salary params), producing one
    // wasted labor round-trip per CP cold load. The labor leg is removed
    // here; cpLabor derives from laborLedger (Effect 5's state) via the
    // `const cpLabor = useCpTable ? laborLedger : null` binding below.
    // Any labor-side error during the CP wait surfaces through the
    // laborLedgerError union at the CP table's `error` prop.
    const ctrl = new AbortController();
    setCpAuxError(null);
    const p = new URLSearchParams({ account: fetchAccount, start, end });
    if (urlPreview) p.set("preview", urlPreview);
    // include_salary intentionally not forwarded - purchasing has no
    // salary dimension and the route rejects the flag silently; matches
    // Effect 5's cache-key hygiene for the purchasing-fold fetch.
    fetch(`/api/kpi/purchasing?${p}`, { signal: ctrl.signal })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`purchasing HTTP ${r.status}`)))
      .then((pu) => {
        if (ctrl.signal.aborted) return;
        setCpPurch(pu);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setCpAuxError(String(e?.message || e));
      });
    return () => ctrl.abort();
  }, [useCpTable, fetchAccount, start, end, urlPreview]);

  // Fold-open state hoisted here 2026-10-15 (lazy-fold perf change).
  // These two must be declared ABOVE the fetch effects below: they now
  // appear in those effects' dependency arrays, and dep arrays are
  // evaluated during render at this point in the component body, so a
  // declaration further down would hit the temporal dead zone and
  // throw. Same declaration-order hazard the PORTFOLIO_KEYS note
  // further down describes.
  const [laborLedgerOpen, setLaborLedgerOpen] = useState(false);
  const [purchasingFoldOpen, setPurchasingFoldOpen] = useState(false);

  // Consolidation PR 1 (2026-09-22). Labor ledger fetch.
  //
  // LAZY 2026-10-15 (Kevin ruling, measured): this used to fire on
  // every single-account load. Measured at 16,066 ms on production -
  // the slowest call on the page by more than 2x, and it gated the
  // whole load even though the fold starts collapsed. Now it fires
  // when the fold is opened, OR when the Current-Period table needs
  // it (cpLabor derives from laborLedger under useCpTable - see the
  // binding further down; gating on the fold alone would blank the CP
  // table on CP / NP ranges).
  //
  // Same account + range as the Overview fetch; forwards
  // include_salary and preview only. Failure isolation: 401 / 403 /
  // network errors land in laborLedgerError; the Overview above
  // renders normally.
  useEffect(() => {
    if (!fetchAccount && !urlPreview) return;
    if (!start || !end) return;
    if (!laborLedgerOpen && !useCpTable) return;
    // Kevin ruling 2026-10-12. Portfolio views never render LaborLedger;
    // skip the aggregate labor fetch here instead of letting it fire and
    // throw the payload away. Inlined account list rather than
    // PORTFOLIO_KEYS because PORTFOLIO_KEYS is defined below this hook
    // in component-body order; the effect runs post-render so it would
    // still resolve, but keeping the gate self-contained avoids any
    // declaration-order confusion.
    if (["ALL", "EAST", "WEST"].includes(fetchAccount)) return;
    const ctrl = new AbortController();
    // Cold vs warm refetch (2026-10-22). Opening the labor fold adds
    // `rates=1` to the URL, which refires this effect (laborLedgerOpen
    // is in the deps). On CP the rolling grid also derives from
    // laborLedger (R-109 one-table derivation), so an unconditional
    // setLaborLedger(null) at the top blanks BOTH the grid and the
    // fold on every open - reads as a full-section reload. Fix: null
    // only on a COLD load (account / range / preview / salary toggle
    // actually changed). A WARM run (same data-shape key, only
    // laborLedgerOpen or useCpTable flipped) keeps the existing
    // payload rendered; the in-flight fetch replaces it when it
    // resolves, now with rates=1. laborLedgerLoading flips true for
    // the window so LaborLedger can show a quiet in-fold indicator.
    const dataShapeKey = `${fetchAccount}|${start}|${end}|${urlPreview || ""}|${urlIncludeSalary ? "1" : "0"}`;
    const coldLoad = prevLaborKeyRef.current !== dataShapeKey;
    prevLaborKeyRef.current = dataShapeKey;
    if (coldLoad) {
      setLaborLedger(null);
      setLaborLedgerError(null);
    }
    setLaborLedgerLoading(true);
    const p = new URLSearchParams({ account: fetchAccount, start, end });
    if (urlPreview) p.set("preview", urlPreview);
    if (urlIncludeSalary) p.set("include_salary", "1");
    // rates=1 only when the fold is actually open (2026-10-15, measured).
    // The per-worker hourly-rate column lives in WeekTable's ChildRow
    // inside this fold and nowhere else; the CP / NP table does not read
    // worker_week_rates. Asking for it unconditionally cost ~13 s on
    // every CP load. laborLedgerOpen is already in this effect's
    // dependency array, so opening the fold refetches with the flag set.
    if (laborLedgerOpen) p.set("rates", "1");
    fetch(`/api/kpi/labor?${p}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (r.status === 401) throw new Error("session_expired");
        if (r.status === 403) throw new Error("forbidden");
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setLaborLedger(d);
        setLaborLedgerLoading(false);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setLaborLedgerError(String(e?.message || e));
        setLaborLedgerLoading(false);
      });
    return () => ctrl.abort();
  }, [fetchAccount, start, end, urlPreview, urlIncludeSalary, laborLedgerOpen, useCpTable]);

  // R-150 (2026-09-22). Purchasing fold fetch. Same cadence as the
  // labor fetch: fires on every range, so a subsequent range change
  // starts the request in flight before the fold renders. drill=lines
  // is added only on a single-period range (Kevin's rule: multi-
  // period, no fold, no drill). Failure lands in the fold's own error
  // state; the Overview above renders normally.
  //
  // No include_salary forward. Purchasing has no salary dimension and
  // the route rejects the flag silently, but not sending it keeps the
  // request cache-key cleaner.
  useEffect(() => {
    if (!fetchAccount && !urlPreview) return;
    if (!start || !end) return;
    // Kevin ruling 2026-10-12. Portfolio views never render
    // PurchasingFold; skip the aggregate purchasing fetch here instead
    // of letting it fire. Same inlined account list as the labor hook
    // above; same rationale on PORTFOLIO_KEYS placement.
    if (["ALL", "EAST", "WEST"].includes(fetchAccount)) return;
    // LAZY 2026-10-15 (Kevin ruling, measured at 5,933 ms). Unlike
    // labor, purchasingLedger feeds ONLY the PurchasingFold - the CP
    // table reads its own cpPurch state from a separate effect - so
    // the fold-open flag is the whole gate here.
    if (!purchasingFoldOpen) return;
    const ctrl = new AbortController();
    setPurchasingLedger(null);
    setPurchasingLedgerError(null);
    const p = new URLSearchParams({ account: fetchAccount, start, end });
    if (urlPreview) p.set("preview", urlPreview);
    if (rangeSelection?.kind === "period") p.set("drill", "lines");
    fetch(`/api/kpi/purchasing?${p}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (r.status === 401) throw new Error("session_expired");
        if (r.status === 403) throw new Error("forbidden");
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setPurchasingLedger(d);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setPurchasingLedgerError(String(e?.message || e));
      });
    return () => ctrl.abort();
  }, [fetchAccount, start, end, urlPreview, rangeSelection?.kind, purchasingFoldOpen]);

  // ── URL setters ─────────────────────────────────────────────
  const setParams = useCallback((patch) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    router.push(`/kpi/overview?${p.toString()}`);
  }, [router, searchParams]);

  const onPickAccount = useCallback((teamKey) => {
    setParams({ account: teamKey });
  }, [setParams]);

  const onExitPreview = useCallback(() => {
    setParams({ preview: "" });
  }, [setParams]);

  // Range commit - carries the same shape labor + purchasing pass.
  // Redesign 2026-09-03: multi-period selection retired; only preset
  // + single-period land here.
  const onCommitRange = useCallback((startISO, endISO, selection) => {
    const patch = { start: startISO, end: endISO };
    if (selection?.kind === "period") {
      patch.label = `P${selection.value}`;
    } else {
      patch.label = null;
    }
    setParams(patch);
  }, [setParams]);

  // R-40 polish (2026-09-01): the revenue-source toggle was retired.
  // Revenue reads SC actuals when the account's sc_revenue_live is
  // true, planned otherwise, with no user control. Nothing to wire.

  // Salary control (Phase 4, R-28). Site posture only; corporate
  // always includes salary in totals. The route re-checks the gate,
  // so on Vercel a shared link opened by a caller without salary
  // access renders without the split - silent-drop, no error.
  const setIncludeSalary = useCallback((next) => {
    setParams({ include_salary: next ? "1" : "" });
  }, [setParams]);

  // ── Fold state ──────────────────────────────────────────────
  // Kevin ruling final-presentation (2026-09-03): the chart moves
  // back into the right column beneath Cost of goods, always open;
  // only P&L remains a fold at the bottom.
  const [pnlOpen, setPnlOpen] = useState(false);
  // Consolidation PR 1 (2026-09-22). Labor ledger fold state +
  // client-side fetch of /api/kpi/labor for this range. Mirrors
  // labor/page.js:268 exactly - same account, same range, forwards
  // include_salary and preview, does NOT forward homestand (out of
  // scope per Kevin). 401/403 land silently in the fold's error
  // state; the Overview above never breaks.
  // laborLedgerOpen moved above the fetch effects (lazy-fold change,
  // 2026-10-15) - it is a dependency of the labor effect now.
  // Kevin ruling 2026-10-09 (PR-billback-1). Fold state for the
  // Billed-back-to-club bottom fold on the single-account split
  // branch. Mounts unconditionally; the ledger self-hides when
  // billback payload is null (non-MF accounts, single-period ranges).
  const [billbackLedgerOpen, setBillbackLedgerOpen] = useState(false);
  const [laborLedger, setLaborLedger] = useState(null);
  const [laborLedgerError, setLaborLedgerError] = useState(null);
  // Cold vs warm refetch state. laborLedgerLoading is true while a
  // labor fetch is in flight; the ref tracks the data-shape key of
  // the last run so the effect can decide cold (wipe laborLedger)
  // vs warm (keep the existing payload rendered). See the effect's
  // "Cold vs warm" comment for the full rationale.
  const [laborLedgerLoading, setLaborLedgerLoading] = useState(false);
  const prevLaborKeyRef = useRef(null);
  // R-150 (2026-09-22). Purchasing fold state + fetch. Single-period
  // only; the fetch fires on every range (mirrors labor's cadence),
  // adds ?drill=lines only when the range is a single period. Failure
  // isolation: the fold renders its own error state; the Overview
  // above never breaks.
  // purchasingFoldOpen moved above the fetch effects (lazy-fold
  // change, 2026-10-15) - it is a dependency of the purchasing effect.
  const [purchasingLedger, setPurchasingLedger] = useState(null);
  const [purchasingLedgerError, setPurchasingLedgerError] = useState(null);

  // Kevin ruling 2026-10-13 (KPI perf). CP labor dedup bridges here.
  // cpLabor is a derivation of laborLedger (Effect 5's state) under the
  // CP / NP gate - avoids a redundant /api/kpi/labor fetch Effect 4 used
  // to make. cpEffectiveError unions Effect 4's purchasing error with
  // Effect 5's labor error so the CP table's `error` prop surfaces both
  // sides and the "waiting" skeleton exits on either failure.
  const cpLabor = useCpTable ? laborLedger : null;
  const cpEffectiveError = cpAuxError || (useCpTable ? laborLedgerError : null);

  // ── Fiscal context (today / period / week) ──────────────────
  const fiscal = useMemo(() => {
    const t = today;
    const p = currentPeriodNo(t);
    return {
      today: `${t.slice(5, 7)}/${t.slice(8, 10)}`,
      period: p,
      week: weekOfPeriod(t),
    };
  }, [today]);

  // ── Range menu wiring ───────────────────────────────────────
  const rangeProps = useMemo(() => {
    // Fake accountPeriods list from FY periods so the range menu can
    // resolve "this period" / "last period" without a per-account
    // period feed from the payload. The Overview does not need
    // account-specific period boundaries - all accounts share the FY.
    const accountPeriods = Array.from({ length: 13 }, (_, i) => {
      const n = i + 1;
      return { period_no: n, start: periodStartISO(n), end: periodEndISO(n) };
    });
    // P2-3 (2026-09-01): infer resolvedPreset from (start, end, today)
    // so the range chip reads "FYTD" instead of "Custom 12/29/25 -
    // 08/31/26" on the default landing. Mirrors labor page.js's
    // resolvedPreset useMemo (L719). Same fix class as R14's
    // `?preset=` silent-ignore: the range dates carry across the
    // section hop but the preset identity did not. Server-side range
    // classification is normalized separately in resolver.js
    // (normalizeExplicitToPreset) so the FYTD full-year budget label
    // (P2-5) also fires - two surfaces, same root cause.
    // 2026-09-02 retire-custom PR: `last_4wk` inference removed - the
    // preset itself is retired. Any URL with dates that don't fold
    // into a period boundary gets snapped server-side; the returned
    // payload.range_snap drives the chip disclosure.
    // R-93 (2026-09-09): fytd end is the last-settled period's end,
    // not today. Excludes periods less than 8 days past close.
    const fytdEnd = r93FytdEndISO(today);
    let resolvedPreset = null;
    if (start === FY_START && fytdEnd && end === fytdEnd) {
      resolvedPreset = "fytd";
    } else {
      const past = accountPeriods
        .filter(p => p.start && p.end && p.start <= today)
        .sort((a, b) => a.start.localeCompare(b.start));
      const cur = past[past.length - 1];
      const prev = past[past.length - 2];
      if (cur && start === cur.start && end === cur.end) resolvedPreset = "this_period";
      else if (prev && start === prev.start && end === prev.end) resolvedPreset = "last_period";
    }
    // Kevin 2026-09-02 blocker Item 1: on FYTD the chip primary reads
    // "FYTD · P1-P9" so the reader sees the periods included instead
    // of the anonymous "FYTD". Single-period ranges are unchanged
    // (chipOverride only fires when composition spans more than one
    // period). Composition-driven; the payload's range_composition is
    // the source of truth.
    const rc = data?.range_composition;
    let chipOverride = null;
    if (resolvedPreset === "fytd" && rc && rc.periods_total > 1) {
      const first = 1;
      const last = rc.periods_total;
      // Kevin ruling 2026-09-08. Chip is a range selector label - it
      // says the range, not the status. #1063 folded "P9 awaiting
      // verification" into the chip label; that's status text, and
      // it now moves to its own pill in the status area (see
      // StatusLine + the `awaiting` prop passed from page below).
      chipOverride = { primary: `P${first}-P${last}` };
    }
    return {
      startISO: start,
      endISO: end,
      todayISO: today,
      hasPeriods: true,
      accountPeriods,
      resolvedPreset,
      selectedPeriodNo: rangeSelection?.kind === "period" ? rangeSelection.value : null,
      urlLabel,
      rangeSnap: data?.range_snap || null,
      chipOverride,
      onCommit: onCommitRange,
    };
  }, [start, end, today, rangeSelection, urlLabel, onCommitRange, data?.range_snap, data?.range_composition]);

  // R-40 polish (2026-09-01): revenue-source toggle retired end-to-end.
  // Kevin ruling 2026-10-13 (cleanup): dropped the `const
  // revSourceToggle = null` + its Shell prop pass; Shell accepts an
  // undefined slot without rendering anything.

  // R-40: folio rail visibility mirrors Labor's mechanism exactly -
  // show the rail when landing_account is a portfolio pseudo-key
  // (ALL / EAST / WEST) AND the corporate/rdo user is not previewing
  // a specific site (preview narrows to one account, so the rail
  // collapses to reclaim the width for the board). See
  // src/app/kpi/labor/page.js:1383-1411 for the source pattern.
  // No layout branch on posture - this is access, not layout.
  const PORTFOLIO_KEYS = ["ALL", "EAST", "WEST"];
  const isPortfolioLanding = PORTFOLIO_KEYS.includes(data?.landing_account);
  const showFolioRail = isPortfolioLanding && !data?.preview_account;
  const folioRail = showFolioRail ? (
    <FolioRail
      activeAccount={account}
      onPickAccount={onPickAccount}
      accountsDirectory={data?.accounts_directory || STATIC_DIRECTORY}
      regionalDirectorsDisplay={data?.regional_directors_display || STATIC_RDO_DISPLAY}
    />
  ) : null;

  // ── Board content selector ──────────────────────────────────
  let mainContent;
  // PR-2 item 20b: the skeleton must match the loaded layout so the
  // page does not reflow when data arrives. Portfolio and single-
  // account paint different shapes; the skeleton follows the shape
  // driven by the URL account, since the landing_account isn't
  // known yet on the very first cold load.
  const skelIsPortfolio = PORTFOLIO_KEYS.includes(urlAccount || "");
  // Kevin R-128 Part 3 item 8 (2026-09-19, review-fix 2026-09-19).
  // Detect the CP / NP surface from the URL on cold load so the
  // skeleton shape matches the loaded table. Heuristic: a specific
  // range with dates spanning less than 60 days AND ending on or
  // after today is either CP (running) or NP (planned) - the two
  // surfaces that use CurrentPeriodTable. Finalized periods (Last
  // period, P1 / P5 / P9 signed off 2026-09-18) also span 28 days
  // but end in the past; they render the closed board, not the
  // period grid, so the span check alone would flash the wrong
  // skeleton then reflow. `urlEnd >= today` gates them out. When
  // data has landed, useCpTable is definitive and takes precedence.
  // Kevin ruling 2026-10-13 (V-LOADER). The three cold-skeleton shapes
  // (portfolio, closed, cp) collapsed into one unified KpiLoader with no
  // per-shape variant. The dead `skelStateCold` / `skelStateKnownCp` /
  // `urlIsPeriodRange` computations retired alongside them.

  if (status === "loading" && !data) {
    mainContent = <KpiLoader />;
  } else if (loadState === "auth") {
    mainContent = authError === "expired"
      ? <StateSessionExpired />
      : <StateNotAuthorized />;
  } else if (loadState === "error") {
    mainContent = <StateError code={errCode} onRetry={() => { setData(null); setLoadState("loading"); }} />;
  } else if (data?.locked) {
    mainContent = <LockedPanel />;
  } else if (loadState === "loading" && !data) {
    mainContent = <KpiLoader />;
  } else if (!data || (!data.cards && !data.landing_account)) {
    mainContent = <KpiLoader />;
  } else if (useCpTable && (!cpLabor || !cpPurch) && !cpEffectiveError) {
    // Kevin fix 2026-09-17 item 1: on CP or NP the CurrentPeriodTable
    // depends on a second (labor+purchasing) fetch. Keep the loader up
    // until that lands - no second loader text state.
    mainContent = <KpiLoader />;
  } else if (data && data.cards) {
    const rangeMeta = { ...data.range, period_state: data.period_state };
    // Kevin ruling 2026-10-13 (V-LOADER). Warm refetch dims the board
    // via .kpi-loader-dim and floats a <KpiLoader overlay /> above it.
    // The dim + overlay siblings sit inside a .kpi-loader-wrap div that
    // creates the positioning context.
    const dimClass = loadState === "refetching" ? "kpi-loader-dim" : "";
    mainContent = (
      <div className="kpi-loader-wrap">
      <div className={dimClass} data-kpi-ov="board">
        {/* R-40 (2026-09-01): the Overview is one layout everywhere.
            Role governs access only - portfolio rail visibility, the
            salary control. It does not fork the board. Same account +
            range = same board render for every role.

            A2 + A3 + A4 (PR 2 polish, 2026-09-01): the standalone
            sources strip retired - its content moved into the Data
            current pill popover (passed as freshnessPop to Shell,
            below). The ticker retired - a single-sentence StatusLine
            with a fixed shape (no account-model notes) replaces it. */}
        {/* Kevin Prompt 2 PR-B (2026-09-04): Planning view branch.
            When the requested range is a future period (period_state
            === "planned"), the board renders as a budget-hero surface
            with no verdicts on the top cards, budget-only tables, and
            (for TBR - FL P13 and similar) a callout naming a
            budgeted-loss period as intent rather than defect. The
            standard Overview components below are skipped for this
            state - a future period has no actuals, so the This period
            surface would render mostly empty and mislead. */}
        {/* R-110 (2026-09-16): Next period · same table with is_
            future_range on. Replaces the old PlanningBoard (which
            was two plan tables + three cards). The CP branch below
            still handles the running-period case; NP takes over the
            `planned` state. */}
        {npGateActive ? (
          <>
            <CurrentPeriodTable
              payload={data}
              labor={cpLabor}
              purch={cpPurch}
              error={cpEffectiveError}
            />
            <LaborLedger
              labor={laborLedger}
              laborError={laborLedgerError}
              loading={laborLedgerLoading}
              account={account}
              start={start}
              end={end}
              today={today}
              open={laborLedgerOpen}
              onToggle={() => setLaborLedgerOpen(o => !o)}
            />
          </>
        ) : (
          <>
            {/* R-112 PR 2 (2026-09-16): CurrentPeriodTable now owns
                its own status strip on CP with the PLAN / ROLLING
                toggle right of the period pill. Suppress the shell's
                StatusLine on CP to avoid two "Period running" pills
                stacking above the table. Every other range keeps
                the shell strip untouched. */}
            {!cpGateActive && (
            <StatusLine
              statusLine={data.status_line}
              rangeLabels={data.range_labels}
              awaiting={(() => {
                // Kevin ruling 2026-09-08. Second pill beside the
                // status pill: "● P9 awaiting verification · closes
                // 9/14" - amber, only while a period is past its
                // end and before its R-93 settle date. Chip carries
                // the span; this pill carries the state. Same
                // helper as R-93, no new date logic.
                //
                // Kevin ruling 2026-09-08 cleanup (this PR). Scoped
                // to Current year only. P9 has nothing to do with
                // running P10 - the pill belongs on the range whose
                // span omits that period (fytd's end sits at P8),
                // not on the running period itself, and not on
                // Last period (which IS P9 and carries its own
                // "Awaiting verification" status pill via R-94).
                if (rangeProps.resolvedPreset !== "fytd") return null;
                const p = r93ExcludedPeriodNo(today);
                if (p == null) return null;
                const pEnd = periodEndISO(p);
                if (!pEnd) return null;
                const t = new Date(pEnd + "T00:00:00Z").getTime();
                const settle = new Date(t + 8 * 86400000).toISOString().slice(0, 10);
                return {
                  period_no: p,
                  close_iso: pEnd,
                  settle_iso: settle,
                };
              })()}
            />
            )}
            <SettlingStrip settling={data.settling} />
            <OverdueNudge overduePeriods={data.overdue_periods} />
            {/* R-109 · CP gate. On the running period (CP), the three
                cards + week rail + cost-lines + P&L below are ALL
                replaced by the one-table view + review cards. Every
                other range keeps its existing surface (Guard 1). */}
            {cpGateActive ? (
              <>
                <CurrentPeriodTable
                  payload={data}
                  labor={cpLabor}
                  purch={cpPurch}
                  error={cpEffectiveError}
                />
                <CurrentPeriodReview
                  labor={cpLabor}
                  purchasing={cpPurch}
                />
                <LaborLedger
                  labor={laborLedger}
                  laborError={laborLedgerError}
                  loading={laborLedgerLoading}
                  account={account}
                  start={start}
                  end={end}
                  today={today}
                  open={laborLedgerOpen}
                  onToggle={() => setLaborLedgerOpen(o => !o)}
                />
                {/* R-150 · Purchasing fold on CP. Single-period only;
                    CP is by construction a single period so the guard
                    is a belt-and-braces (matches the mount rule
                    elsewhere so a future range mode does not surprise
                    the fold). */}
                {rangeSelection?.kind === "period" && (
                  <PurchasingFold
                    payload={purchasingLedger}
                    error={purchasingLedgerError}
                    start={start}
                    end={end}
                    today={today}
                    open={purchasingFoldOpen}
                    onToggle={() => setPurchasingFoldOpen(o => !o)}
                    billbackPeriod={data.billback_period}
                    periodCurrent={true}
                  />
                )}
              </>
            ) : (
              <>
                <CardsRow
                  cards={data.cards}
                  rangeMeta={rangeMeta}
                  scCountsWithoutDollars={data.sc_counts_without_dollars}
                  hasTarget={data.has_target}
                  revenueSourceState={data.revenue_source_state}
                  rangeLabels={data.range_labels}
                  revenueModel={data.revenue_model}
                  statementTotals={data.statement_totals}
                  awaiting={data.status_line?.tone === "wait"}
                />
                <WeekRail weekRail={data.week_rail} />
              </>
            )}
          </>
        )}
        {/* PR-2 layout branch: two-column single-account grid ONLY
            when the EFFECTIVE account is a single site. A corporate
            user with landing_account=ALL who drilled into TBR - FL
            gets the single-account layout for TBR - FL - the
            portfolio branch belongs to ALL / EAST / WEST scope
            itself (the aggregated view). Kevin Prompt 2 PR-B
            (2026-09-04): Planning-state boards render the whole
            surface via <PlanningBoard/> above - skip the standard
            split (Chart + tables have no meaning on a future
            period). */}
        {/* R-109 · on CP, the whole bottom fold (CostLines + PnlStatement
            + Chart + AlsoTracked + RevenueLines) is replaced by the
            CurrentPeriodTable + CurrentPeriodReview rendered above.
            Nothing else renders below on CP. Other ranges unchanged. */}
        {data.period_state === "planned" || cpGateActive ? null : PORTFOLIO_KEYS.includes(account) ? (
          /* Portfolio scope (account ∈ ALL / EAST / WEST). Kevin ruling
              2026-10-12. The ALL / EAST / WEST rollups now use the same
              two-column split layout the single-account branch below
              uses - RevenueLines + AlsoTracked on the left, CostLines +
              Chart on the right, PnlStatement fold below. Portfolio
              never carries BillbackCard (billback is per-account) and
              never carries LaborLedger / PurchasingFold (both are
              site-specific transaction detail that does not aggregate
              across accounts with different hourly / salary / billing
              models). The split uses data-kpi-ov="portfolio-split" so
              probes can distinguish it from the single-account split
              below. */
          <>
            <div className="kpi-ov-split" data-kpi-ov="portfolio-split">
              <div className="kpi-ov-split-left">
                <RevenueLines payload={data} />
                <AlsoTracked payload={data} />
              </div>
              <div className="kpi-ov-split-right">
                <CostLines payload={data} previewAccount={data.preview_account} />
                <Chart chart={data.chart} revenueModel={data.revenue_model} />
              </div>
            </div>
            <PnlStatement payload={data} open={pnlOpen} onToggle={() => setPnlOpen(o => !o)} />
          </>
        ) : (
          /* Kevin ruling final-presentation (2026-09-03): the chart
              moves out of the bottom fold and back into the right
              column beneath Cost of goods sold, always open. It's the
              only surface showing shape over time - "the tables show
              where you are; the chart shows whether you are drifting"
              - and it belongs where the cost story is. P&L stays a
              fold at the bottom.
              Columns still swap per simplified-layout ruling: Revenue
              lines + Also tracked on the LEFT (5fr); Cost of goods
              sold + Chart on the RIGHT (7fr). */
          <>
            <div className="kpi-ov-split" data-kpi-ov="single-account-split">
              <div className="kpi-ov-split-left">
                <RevenueLines payload={data} />
                <AlsoTracked payload={data} />
              </div>
              <div className="kpi-ov-split-right">
                <CostLines payload={data} previewAccount={data.preview_account} />
                {/* Kevin ruling 2026-10-09 (PR-billback-1). Management-
                    fee + multi-period only: BillbackCard replaces the
                    cost-of-goods period-by-period chart. Every other
                    account keeps the chart. The resolver ships
                    billback=null when the gate fails, so the picked
                    component short-circuits either way; the explicit
                    revenue_model check keeps the swap readable at the
                    call site. */}
                {data.revenue_model === "management_fee" && (data.billback?.annual_goal != null || data.billback_period?.annual_goal != null)
                  ? (data.billback
                      ? <BillbackCard billback={data.billback} revenueModel={data.revenue_model} />
                      : <BillbackPeriodCard billbackPeriod={data.billback_period} />)
                  : <Chart chart={data.chart} revenueModel={data.revenue_model} />}
              </div>
            </div>
            <PnlStatement payload={data} open={pnlOpen} onToggle={() => setPnlOpen(o => !o)} />
            <LaborLedger
              labor={laborLedger}
              laborError={laborLedgerError}
              loading={laborLedgerLoading}
              account={account}
              start={start}
              end={end}
              today={today}
              open={laborLedgerOpen}
              onToggle={() => setLaborLedgerOpen(o => !o)}
            />
            {/* Kevin ruling 2026-10-09 (PR-billback-1). Billed-back
                fold mounts beside LaborLedger on the single-account
                split branch. Self-hides when billback payload is null,
                so this unconditional mount is safe for non-MF accounts
                and single-period ranges. */}
            <BillbackLedger
              billback={data.billback}
              open={billbackLedgerOpen}
              onToggle={() => setBillbackLedgerOpen(o => !o)}
            />
            {/* R-150 · Purchasing fold on Closed / CY single-account
                branch (the "non-chart" one, chart lives inside the
                split above). Single-period only. periodCurrent=false
                here so the card-coding chrome (header badge, feed
                banner, uncoded strip) does not render on a closed /
                verified period - the table + buckets still render. */}
            {rangeSelection?.kind === "period" && (
              <PurchasingFold
                payload={purchasingLedger}
                error={purchasingLedgerError}
                start={start}
                end={end}
                today={today}
                open={purchasingFoldOpen}
                onToggle={() => setPurchasingFoldOpen(o => !o)}
                billbackPeriod={data.billback_period}
                periodCurrent={false}
              />
            )}
          </>
        )}
        {/* Consolidation PR 1 (2026-09-22). Explicit multi-period
            ranges whose LAST period is planned (e.g. TXR - AZ full
            FY where P11-P13 are dark) trip the
            `period_state === "planned"` null-gate above and would
            otherwise miss the fold. Render it here for that case,
            outside the closed/CY branch. cpGateActive + npGateActive
            already own their own mounts above, so gate on both to
            avoid double-rendering. */}
        {!cpGateActive && !npGateActive && data.period_state === "planned" && data.range?.kind !== "period" && (
          <LaborLedger
            labor={laborLedger}
            laborError={laborLedgerError}
            loading={laborLedgerLoading}
            account={account}
            start={start}
            end={end}
            today={today}
            open={laborLedgerOpen}
            onToggle={() => setLaborLedgerOpen(o => !o)}
          />
        )}
      </div>
        {loadState === "refetching" && <KpiLoader overlay />}
      </div>
    );
  } else {
    mainContent = <KpiLoader />;
  }

  return (
    <div className="kpi-app" data-kpi-app>
      {/* 2026-09-01 follow-up: wrap the Shell in .kpi-wrap to match
          Labor and Purchasing (max-width: var(--sc2-shell-max) = 1520px,
          padding: var(--space-5) var(--space-6) var(--space-7), auto-
          centred). Without this the Overview cmd bar starts at x=0
          full-viewport-width while Labor's is auto-centred at 1520px -
          Overview reads ~200px oversized at 1680 even though every
          token matches. See labor page.js:1320 for the source pattern. */}
      <div className="kpi-wrap">
        <Shell
          account={account}
          fiscal={fiscal}
        /* P2-4d (2026-09-01): pass the composed last_walk_at the
           resolver ships on freshness.last_walk_at (max of labor +
           purchasing derive timestamps). Prior implementation
           hard-coded null which the Shell's FreshnessChip renders
           as red "No recent walk" - a false alarm on an account
           where purchasing was simultaneously reading "Data current"
           on its own board. Kevin's ruling: a false red alarm is
           worse than no chip. When both pipes are fresh (< 30h
           per freshnessTint) the chip flips to "Data current" and
           the two boards agree. */
        freshness={{ last_walk_at: data?.freshness?.last_walk_at || null }}
        dataLoading={loadState === "loading" || loadState === "refetching"}
        activeSection="pnl_overview"
        rangeProps={rangeProps}
        /* Salary control - access-gated by salary_toggle_visible on
           the payload (mirrors Labor's canSeeSalary). R-40: no
           layout branch; the control appears whenever access permits,
           regardless of role. Absent, never disabled, for anyone the
           route would refuse. */
        salaryToggle={data?.salary_toggle_visible ? {
          on: urlIncludeSalary,
          onChange: (next) => setIncludeSalary(next),
        } : null}
          folioRail={folioRail}
          main={mainContent}
          previewAccount={data?.preview_account || null}
          onExitPreview={onExitPreview}
          /* A2 (2026-09-01): the sources block that used to render as
             a standalone strip above the board now lives inside the
             Data current pill popover, same pattern as Labor. Shell
             wires this node as the FreshnessChip popover body. */
          freshnessPop={data?.sources ? <DataCurrentPop sources={data.sources} /> : null}
        />
      </div>
    </div>
  );
}

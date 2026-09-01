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
import "./overview.css";

import {
  FY_START_ISO,
  periodOf,
  periodStartISO,
  periodEndISO,
  currentPeriodNo,
  weekOfPeriod,
  inferRangeSelection,
  rangeForPeriod,
} from "@/app/kpi/labor/lib/periods";
import { addDaysISO } from "@/lib/kpi/dateResolve";
import { Shell } from "@/app/kpi/labor/components/Shell";
import { FolioRail, PSEUDO_KEYS } from "@/app/kpi/labor/components/FolioRail";
import { ACCOUNTS, FY_START, STATIC_DIRECTORY, STATIC_RDO_DISPLAY } from "@/app/kpi/labor/lib/accounts";
import { isKnownAccount } from "@/lib/accountModels";
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
import DataCurrentPop from "./components/DataCurrentPop";
import CardsRow from "./components/CardsRow";
import Chart from "./components/Chart";
import DrillButtons from "./components/DrillButtons";
import PnlStatement from "./components/PnlStatement";
import AlsoTracked from "./components/AlsoTracked";
import WhatIsLeft from "./components/WhatIsLeft";
import SkeletonBoard from "./components/SkeletonBoard";

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
  const end = urlEnd || today;

  const rangeSelection = useMemo(() => inferRangeSelection(start, end), [start, end]);

  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState("idle"); // idle | loading | refetching | ok | error | auth
  const [errorMsg, setErrorMsg] = useState(null);
  const [errCode, setErrCode] = useState(null);
  const [authError, setAuthError] = useState(null);

  const account = deriveClientAccount({
    urlAccount,
    previewAccount: data?.preview_account,
    landingAccount: data?.landing_account,
  });

  // Track fetch identity: any account change wipes prior data (avoids
  // showing stale numbers from the previous account during warm
  // refetch - Kevin's charter 4 rule "never a stale control from the
  // previous account").
  const prevAccountRef = useRef(account);
  useEffect(() => {
    if (prevAccountRef.current !== account) {
      setData(null);
      prevAccountRef.current = account;
    }
  }, [account]);

  // ── Fetch overview data ─────────────────────────────────────
  useEffect(() => {
    if (status === "loading") return;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(new Error("timeout_15s")), 15000);
    // Warm refetch vs cold load:
    //   - No prior data                    -> loading (skeleton)
    //   - Prior data (account preserved)   -> refetching (ghost + chip)
    setLoadState(data ? "refetching" : "loading");
    setErrorMsg(null);
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
        if (e?.name === "AbortError" && String(ctrl.signal.reason?.message || "") !== "timeout_15s") {
          return;
        }
        if (String(e?.message) === "session_expired" || String(e?.message) === "forbidden") {
          setLoadState("auth");
          return;
        }
        const msg = e?.name === "AbortError" || String(ctrl.signal.reason?.message || "") === "timeout_15s"
          ? "Request took longer than 15 seconds. Retry, or check for a blocking extension."
          : String(e?.message || e).slice(0, 200);
        setLoadState("error");
        setErrorMsg(msg);
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
    router.replace(`/kpi/overview?${p.toString()}`);
  }, [urlAccount, data?.landing_account, data?.preview_account, router, searchParams]);

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
  const onCommitRange = useCallback((startISO, endISO, selection) => {
    const patch = { start: startISO, end: endISO };
    // Preserve preset info in the label param so the chip reads back
    // correctly on reload.
    if (selection?.kind === "preset") {
      patch.label = null;
    } else if (selection?.kind === "period") {
      patch.label = `P${selection.value}`;
    } else if (selection?.kind === "periods") {
      patch.label = `P${selection.start} - P${selection.end}`;
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

  // ── Statement fold state ────────────────────────────────────
  const [pnlOpen, setPnlOpen] = useState(false);

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
    let resolvedPreset = null;
    if (start === FY_START && end === today) {
      resolvedPreset = "fytd";
    } else if (start === addDaysISO(today, -27) && end === today) {
      resolvedPreset = "last_4wk";
    } else {
      const past = accountPeriods
        .filter(p => p.start && p.end && p.start <= today)
        .sort((a, b) => a.start.localeCompare(b.start));
      const cur = past[past.length - 1];
      const prev = past[past.length - 2];
      if (cur && start === cur.start && end === cur.end) resolvedPreset = "this_period";
      else if (prev && start === prev.start && end === prev.end) resolvedPreset = "last_period";
    }
    return {
      startISO: start,
      endISO: end,
      todayISO: today,
      hasPeriods: true,
      accountPeriods,
      resolvedPreset,
      selectedPeriodNo: rangeSelection?.kind === "period" ? rangeSelection.value : null,
      selectedMonth: rangeSelection?.kind === "month" ? rangeSelection.value : null,
      urlLabel,
      onCommit: onCommitRange,
    };
  }, [start, end, today, rangeSelection, urlLabel, onCommitRange]);

  // R-40 polish (2026-09-01): revenue-source toggle retired
  // end-to-end. Nothing to render.
  const revSourceToggle = null;

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

  if (status === "loading" && !data) {
    mainContent = <SkeletonBoard />;
  } else if (loadState === "auth") {
    mainContent = authError === "expired"
      ? <StateSessionExpired />
      : <StateNotAuthorized />;
  } else if (loadState === "error") {
    mainContent = <StateError code={errCode} onRetry={() => { setData(null); setLoadState("loading"); }} />;
  } else if (data?.locked) {
    mainContent = <LockedPanel />;
  } else if (loadState === "loading" && !data) {
    mainContent = <SkeletonBoard />;
  } else if (!data || (!data.cards && !data.landing_account)) {
    mainContent = <SkeletonBoard />;
  } else if (data && data.cards) {
    const rangeMeta = { ...data.range, period_state: data.period_state };
    // Ghost the prior board at reduced opacity during warm refetch.
    const wrapClass = loadState === "refetching" ? "kpi-ov-ghost" : "";
    mainContent = (
      <div className={wrapClass} data-kpi-ov="board">
        {loadState === "refetching" && (
          <div style={{ marginBottom: 12 }}>
            <span className="kpi-ov-refresh-chip" data-kpi-ov="refresh-chip">
              <span className="kpi-ov-refresh-dot" aria-hidden="true" />
              Refreshing...
            </span>
          </div>
        )}
        {/* R-40 (2026-09-01): the Overview is one layout everywhere.
            Role governs access only - portfolio rail visibility, the
            salary control. It does not fork the board. Same account +
            range = same board render for every role.

            A2 + A3 + A4 (PR 2 polish, 2026-09-01): the standalone
            sources strip retired - its content moved into the Data
            current pill popover (passed as freshnessPop to Shell,
            below). The ticker retired - a single-sentence StatusLine
            with a fixed shape (no account-model notes) replaces it. */}
        <StatusLine statusLine={data.status_line} />
        <CardsRow cards={data.cards} rangeMeta={rangeMeta} />
        {/* R-34 "What is left" - self-hides on portfolio scope,
            closed periods, and FYTD (server sets what_is_left=null in
            those cases). */}
        <WhatIsLeft whatIsLeft={data.what_is_left} />
        <DrillButtons payload={data} includeSalary={urlIncludeSalary} />
        <Chart chart={data.chart} />
        <PnlStatement payload={data} open={pnlOpen} onToggle={() => setPnlOpen(o => !o)} />
        <AlsoTracked payload={data} />
      </div>
    );
  } else {
    mainContent = <SkeletonBoard />;
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
        revSourceToggle={revSourceToggle}
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

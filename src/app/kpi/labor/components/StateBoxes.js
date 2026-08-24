"use client";
// src/app/kpi/labor/components/StateBoxes.js
//
// D2 P9 - nine states (spec §3.9 + B4).
// data · loading (skeletons matching final shape) · empty first-run ·
// empty filtered (names the filter, one-tap clear) · error (nothing
// changed, retry, B9 code) · stale (chip + alarm, last synced) ·
// salaried (D26) · not-authorized (statebox, zero data leak) ·
// session-expired (statebox + re-auth with Google, return-to-URL).
//
// B9 - error-correlation codes: `KPI-labor-{yymmddhhmm}-{rand4}`, same
// ID rendered on-screen and logged to console.

import { signIn } from "next-auth/react";

// B9 - generate a correlation code, log it, return the string.
export function errorCode(route = "labor", err) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6);
  const code = `KPI-${route}-${yy}${mm}${dd}${hh}${mi}-${rand}`;
  // eslint-disable-next-line no-console
  console.error(`[kpi] ${code}`, err?.message || err);
  return code;
}

function Icon({ children }) {
  return (
    <svg className="kpi-state-svg" viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
  );
}

export function StateBox({ variant, title, children, cta, errCode }) {
  return (
    <div className="kpi-statebox">
      {variant === "loading" ? (
        <div className="kpi-skel-wrap" aria-label="Loading">
          <div className="kpi-skel" style={{ width: "40%" }} />
          <div className="kpi-skel" style={{ width: "80%" }} />
          <div className="kpi-skel" style={{ width: "60%" }} />
        </div>
      ) : (
        <>
          {variant === "empty-first" && <Icon><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Icon>}
          {variant === "empty-range" && <Icon><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></Icon>}
          {variant === "empty-filtered" && <Icon><path d="M22 3H2l8 9.46V19l4 2v-8.54z" /></Icon>}
          {variant === "error" && <Icon><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></Icon>}
          {variant === "stale" && <Icon><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Icon>}
          {variant === "salaried" && <Icon><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></Icon>}
          {variant === "not-authorized" && <Icon><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></Icon>}
          {variant === "locked" && <Icon><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></Icon>}
          {variant === "session-expired" && <Icon><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 2" /></Icon>}
          <h3>{title}</h3>
          <div className="kpi-statebox-body">{children}</div>
          {cta}
          {errCode && (
            <div className="kpi-errcode">
              {errCode}
              <span>include this code if you report it</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Specific pre-built state boxes for common cases so page.js stays
// short. All zero data leak.
export function StateLoading() {
  return <StateBox variant="loading" title="Loading labor data" />;
}
export function StateEmptyFirstRun() {
  return (
    <StateBox variant="empty-first" title="No labor derived yet">
      Once the nightly walk and derivation run, weekly labor for every
      account appears here automatically. Nothing to configure.
    </StateBox>
  );
}
export function StateEmptyFiltered({ workerCount, onClear }) {
  return (
    <StateBox
      variant="empty-filtered"
      title="No rows match"
      cta={<button type="button" className="kpi-btn kpi-btn-primary-v5" onClick={onClear}>Clear worker filter</button>}
    >
      The worker filter ({workerCount} selected) matches nothing in this range.
    </StateBox>
  );
}
// Fix 4 (D2.1) - the date range IS a filter per spec 3.9. Was
// misrouted to StateEmptyFirstRun before, which claimed pipeline
// failure on a healthy pipeline. v5 line ~1052 defines this
// state; the CTA drops back to FYTD through the canonical preset
// path so URL and preset-suffix resolution stay consistent.
export function StateEmptyRange({ onUseFYTD }) {
  return (
    <StateBox
      variant="empty-range"
      title="No weeks in this range"
      cta={<button type="button" className="kpi-btn kpi-btn-primary-v5" onClick={onUseFYTD}>Use FYTD</button>}
    >
      Nothing was derived between these dates. Widen the range or use FYTD.
    </StateBox>
  );
}
export function StateError({ code, onRetry, category }) {
  return (
    <StateBox
      variant="error"
      title="Could not load labor data"
      cta={<button type="button" className="kpi-btn kpi-btn-primary-v5" onClick={onRetry}>Try again</button>}
      errCode={code}
    >
      The derivation table did not respond. Your query was not run, so nothing changed. {category ? `Category: ${category}.` : ""}
    </StateBox>
  );
}
export function StateStale({ lastSynced }) {
  return (
    <StateBox variant="stale" title="Data is stale">
      Last synced {lastSynced || "(unknown)"}. Figures were true then and will not include this week. The nightly walk will refresh; open a support ticket if it does not by tomorrow morning.
    </StateBox>
  );
}
// PR-E - operator-facing empty state for CIN - KY / TBJ - NY per
// kitchfix-help-copy.html "Empty state · salaried-only accounts". The
// prior copy (`carries no hourly labor pipeline per D26. Salary books
// to 3100.2 and comes from the P&L upload, not Rippling.`) reads as a
// technical error; the new copy tells the operator what to do (turn
// salary on). City is derived via folioMemberDescription so there is
// one source of truth for account -> city and a future rename cannot
// leave a hardcoded city string here.
export function StateSalaried({ account, city }) {
  const place = city || "This site";
  return (
    <StateBox variant="salaried" title="No hourly labor at this account">
      {place} is run by salaried staff, so there are no hourly hours to track here.
      Turn on <b>+ Salary</b> in the header to see this account&apos;s labor cost.
    </StateBox>
  );
}
export function StateNotAuthorized() {
  return (
    <StateBox variant="not-authorized" title="Access limited to operations leadership">
      This dashboard is restricted to the operations leadership group.
      If you should have access, reach out to Kevin.
    </StateBox>
  );
}
// V-role-gates - the LOCKED PANEL. Rendered in place of the board
// when the server ships { locked: true } for an account the caller
// cannot view. The command bar, portfolio rail, and section switcher
// (all in Shell above this) STAY visible so the person navigates
// back to their own account without the browser back button.
// Copy is verbatim from spec §3.
export function LockedPanel() {
  return (
    <StateBox variant="locked" title="ACCOUNT LOCKED">
      You do not have access to this account&apos;s data.
      If you need access, please reach out to Kevin Fietek.
    </StateBox>
  );
}
// PR-3b - refusal state for pre-floor partial-week ranges. Replaces
// the misroute to StateEmptyFirstRun ("pipeline never derived") that
// dropped the server's owner-approved message on the floor. Copy is
// the server's refusalMessage verbatim; no client-side string.
export function RefusalPanel({ message }) {
  return (
    <StateBox variant="empty-range" title="Daily detail not available for this range">
      {message}
    </StateBox>
  );
}
export function StateSessionExpired({ returnUrl }) {
  const url = returnUrl || (typeof window !== "undefined" ? window.location.pathname + window.location.search : "/kpi/labor");
  return (
    <StateBox
      variant="session-expired"
      title="Your session expired"
      cta={<button type="button" className="kpi-btn kpi-btn-primary-v5" onClick={() => signIn("google", { callbackUrl: url })}>Sign in with Google</button>}
    >
      For your security you have been signed out. Sign in again and we
      will return you to this exact view.
    </StateBox>
  );
}

"use client";

import { useMemo } from "react";
import { GREEN, AMBER } from "./ServiceCalendar";
import { OperationalTileBody } from "./OperationalView";

// PeriodLensView - View C surface for the Period lens (PR-B2a).
//
// Pure presentation. State lives in ServiceCalendar.js and is passed
// in via props. Reuses the day-tile markup via the .sc-tile--period
// CSS modifier, the classify/STATUS enum/color constants from
// ServiceCalendar.js, the OperationalView no-$ tile body, and DayDetail
// unchanged via onDayClick.
//
// Render branches:
//   - loading skeleton (matches final shape, no spinner)
//   - partial-data banner + skeleton header (one fetch missing - NEVER
//     a wrong total from half data)
//   - off-season empty (no service days in this period)
//   - the active week's tiles + the pinned financial frame
//
// Week switch is a hard cut in B2a; B2b adds the directional slide.

const fmt$ = (n) => "$" + Math.round(n).toLocaleString("en-US");

// "2026-06-29" -> "Mon Jun 29" for mobile card headers + tooltips.
const DOW_LABELS_FULL = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function dateParts(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return { dow: DOW_LABELS_FULL[d.getDay()], mon: MONTH_SHORT[d.getMonth()], day: d.getDate() };
}

// Pretty-format the period's start/end as "Jun 29 - Jul 26".
function fmtRange(startStr, endStr) {
  const s = dateParts(startStr);
  const e = dateParts(endStr);
  return `${s.mon} ${s.day} - ${e.mon} ${e.day}`;
}

// Per-week status icon: GREEN check if fully entered, AMBER dot if
// in-progress, RED "!" if any overdue, nothing if all future.
function weekStatusIcon(w) {
  if (!w) return null;
  if (w.overdue > 0) return { ch: "!", color: "#dc2626" };
  if (w.complete >= w.total && w.total > 0) return { ch: "✓", color: GREEN };
  if (w.complete > 0 || w.needsEntry > 0) return { ch: "●", color: AMBER };
  return null;
}

export default function PeriodLensView({
  data,
  periodDays,
  periodMetrics,
  periodKey,
  periodRange,
  weekKey,
  onWeekChange,
  onDayClick,
  isFeeAccount,
  hasHomestandSchedule,
  homestandMap,
  isMilb,
  today,
  loading,
  partialError,
  onRetryPartial,
  STATUS,
  dayStatus,
  daySummary,
  nextServicePeriod,
  onJumpToNextPeriod,
}) {
  // The weeks present in this period, in label order ("W1".."W4").
  // Derived from the loaded days' meta.week. Empty for off-season periods.
  const weeks = useMemo(() => {
    if (!periodDays?.length) return [];
    const set = new Set();
    for (const d of periodDays) {
      const w = d?.meta?.week;
      if (w) set.add(w);
    }
    return [...set].sort();
  }, [periodDays]);

  // The active week's days (filtered + sorted by date).
  const activeWeekDays = useMemo(() => {
    if (!periodDays?.length || !weekKey) return [];
    return periodDays.filter(d => d.meta?.week === weekKey);
  }, [periodDays, weekKey]);

  // The week containing today (for the GREEN today-dot marker on the
  // sub-nav, regardless of which week is active).
  const todayWeek = useMemo(() => {
    if (!periodDays?.length) return null;
    const todayDay = periodDays.find(d => d.date === today);
    return todayDay?.meta?.week || null;
  }, [periodDays, today]);

  // ── Loading skeleton ────────────────────────────────────────────
  if (loading && !partialError) {
    return <PeriodSkeleton />;
  }

  // ── Partial-data state (one fetch failed) ──────────────────────
  // Header skeleton (NEVER a wrong total from half data) + amber banner
  // + skeleton tiles. Retry re-fetches the failing month only.
  if (partialError) {
    return (
      <div className="sc-period-view sc-fade-in">
        <div className="sc-period-partial-banner" role="status">
          <span aria-hidden="true">⚠</span>
          <span>Partial data - we couldn't load {partialError.failedMonth}. We'll show the full period when this completes.</span>
          <button type="button" className="sc-period-retry" onClick={onRetryPartial}>Retry</button>
        </div>
        <PeriodSkeleton />
      </div>
    );
  }

  // ── Off-season empty state ─────────────────────────────────────
  // No service days in the loaded payloads for this period. Calm
  // onboarding tone with a jump-to-next-service-period affordance so
  // the user is never stuck on a dead-end screen.
  if (!periodDays?.length || periodDays.every(d => !d.totals?.projectedRevenue && !d.hasActuals)) {
    // For STL-FL/fee accounts, projectedRevenue is always 0 - so we
    // also gate on hasActuals before declaring "off-season." If we have
    // ANY day data, fall through to the normal render (with $0 frame).
    const reallyOff = !periodDays?.length;
    if (reallyOff) {
      return (
        <div className="sc-period-view sc-fade-in">
          <div className="sc-period-empty">
            <svg className="sc-period-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#153968" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="9" y1="15" x2="15" y2="19" />
              <line x1="15" y1="15" x2="9" y2="19" />
            </svg>
            <h2 className="sc-period-empty-title">No service in Period {periodKey?.replace(/^P/, "") || ""}</h2>
            <p className="sc-period-empty-sub">
              {nextServicePeriod
                ? `Off-season - the next service period is Period ${nextServicePeriod.replace(/^P/, "")}.`
                : "Off-season."}
            </p>
            {nextServicePeriod && (
              <button
                type="button"
                className="sc-period-empty-jump"
                onClick={onJumpToNextPeriod}
              >
                Jump to Period {nextServicePeriod.replace(/^P/, "")}
              </button>
            )}
          </div>
        </div>
      );
    }
  }

  // ── Pinned header values (financial frame F-A, polymorphic) ───
  const m = periodMetrics || { actRev: 0, projRev: 0, complete: 0, needsEntry: 0, overdue: 0, total: 0, actMeals: 0, weeks: {} };
  const completionPct = m.total > 0 ? Math.round(m.complete / m.total * 100) : 0;
  const fullyEntered = m.total > 0 && m.complete === m.total && m.needsEntry + m.overdue === 0;
  const progressColor = (m.needsEntry + m.overdue) > 0 ? AMBER : GREEN;
  const delta = m.actRev - m.projRev;
  const deltaLabel = delta >= 0
    ? `+${fmt$(delta)} ahead`
    : `${fmt$(delta)} to go`;
  const deltaColor = delta >= 0 ? GREEN : "#d97706";

  // Homestand context line for the pinned header (MLB fee path).
  const homestandContext = useMemo(() => {
    if (!hasHomestandSchedule || !periodDays?.length) return null;
    const seen = new Set();
    const ctx = [];
    for (const d of periodDays) {
      const hs = homestandMap?.[d.date];
      if (!hs?.homestandId || seen.has(hs.homestandId)) continue;
      seen.add(hs.homestandId);
      ctx.push({ id: hs.homestandId, opponent: hs.opponent || null });
    }
    return ctx.slice(0, 3); // cap visual width
  }, [hasHomestandSchedule, periodDays, homestandMap]);

  // ── Render the full view ──────────────────────────────────────
  return (
    <div className={`sc-period-view sc-fade-in ${fullyEntered ? "sc-period-view--complete" : ""}`}>
      {/* Pinned period header (D-1-A, F-A frame) */}
      <div className="sc-period-header">
        <div className="sc-period-header-top">
          <h2
            className="sc-period-label"
            tabIndex={-1}
          >
            Period {periodKey?.replace(/^P/, "") || ""}
          </h2>
          <span className="sc-period-range">
            {periodRange ? fmtRange(periodRange.start, periodRange.end) : ""}
          </span>
        </div>

        {isFeeAccount && !hasHomestandSchedule ? (
          // Operational-only (STL-FL): days-complete is the hero, no $.
          <div className="sc-period-frame sc-period-frame--operational">
            <div className="sc-period-frame-hero">
              <span className="sc-period-frame-num">{m.complete}</span>
              <span className="sc-period-frame-divisor"> / {m.total}</span>
            </div>
            <div className="sc-period-frame-labels">
              <span className="sc-period-frame-label">DAYS ENTERED</span>
            </div>
          </div>
        ) : (
          // Per-meal + homestand share the financial frame (the homestand
          // path also shows the optional context line below it).
          <div className="sc-period-frame">
            <div className="sc-period-frame-numbers">
              <span className="sc-period-frame-entered">{fmt$(m.actRev)}</span>
              <span className="sc-period-frame-projected">{fmt$(m.projRev)}</span>
              <span className="sc-period-frame-delta" style={{ color: deltaColor }}>{deltaLabel}</span>
            </div>
            <div className="sc-period-frame-labels">
              <span className="sc-period-frame-label">ENTERED</span>
              <span className="sc-period-frame-label">PROJECTED</span>
              <span />
            </div>
          </div>
        )}

        {hasHomestandSchedule && homestandContext?.length > 0 && (
          <div className="sc-period-homestand-ctx">
            Homestand{homestandContext.length > 1 ? "s" : ""}{" "}
            {homestandContext.map((h, i) => (
              <span key={h.id}>
                {i > 0 && " · "}
                {h.id}{h.opponent ? ` vs ${h.opponent}` : ""}
              </span>
            ))}
          </div>
        )}

        <div className="sc-period-progress">
          <span className="sc-period-progress-label">
            {fullyEntered ? `All ${m.total} days entered ✓` : `${m.complete} of ${m.total} days`}
          </span>
          <div className="sc-progress-bar">
            <div
              className="sc-progress-fill"
              style={{ width: completionPct + "%", background: progressColor }}
            />
          </div>
        </div>

        {/* Audit-rail caption - the "this is where the numbers come from"
            signal that distinguishes Ramp-grade audit clarity from a
            generic dashboard. */}
        {!isFeeAccount && (
          <div className="sc-period-audit" title="Revenue values read directly from the sc_daily_revenue view (the price-effective-dated source).">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span>Live from sc_daily_revenue</span>
          </div>
        )}
      </div>

      {/* Week sub-nav (D-2-B) */}
      {weeks.length > 0 && (
        <div className="sc-period-week-nav">
          <div className="sc-period-week-pills">
            {weeks.map((w) => (
              <button
                key={w}
                type="button"
                className={`sc-period-week-pill ${weekKey === w ? "sc-period-week-pill--active" : ""}`}
                onClick={() => onWeekChange(w)}
                aria-pressed={weekKey === w}
              >
                {w}
                {w === todayWeek && <span className="sc-period-week-today-dot" aria-label="Today" />}
              </button>
            ))}
          </div>
          <div className="sc-period-week-stats">
            {weeks.map((w) => {
              const ws = m.weeks?.[w];
              const icon = weekStatusIcon(ws);
              if (!ws) return <div key={w} className="sc-period-week-stat" />;
              return (
                <div key={w} className="sc-period-week-stat">
                  {isFeeAccount && !hasHomestandSchedule ? (
                    <span className="sc-period-week-subtotal sc-period-week-subtotal--meals">
                      {(ws.actMeals || 0).toLocaleString("en-US")} meals
                    </span>
                  ) : (
                    <span
                      className={`sc-period-week-subtotal ${ws.actRev > 0 ? "sc-period-week-subtotal--entered" : ""}`}
                    >
                      {fmt$(ws.actRev > 0 ? ws.actRev : ws.projRev)}
                    </span>
                  )}
                  <span className="sc-period-week-completion">
                    {ws.complete}/{ws.total}
                    {icon && <span className="sc-period-week-icon" style={{ color: icon.color }}>{" "}{icon.ch}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day tiles for the active week (D-3-A: existing .sc-tile +
          .sc-tile--period modifier). Mobile renders as stacked cards
          via the same markup + the CSS .sc-tile--period mobile rules
          (G-A). */}
      <div className="sc-period-tiles">
        {activeWeekDays.map((dd) => {
          const status = dayStatus(dd);
          const isTodayTile = dd.date === today;
          const st = STATUS[status] || STATUS.future;
          const { meals, revenue } = daySummary(dd);
          const dParts = dateParts(dd.date);
          const gameType = dd.gameType || dd.meta?.gameType || "";
          const milbPill = isMilb && gameType
            ? (gameType.toLowerCase().includes("day") ? "day"
              : gameType.toLowerCase().includes("night") ? "night"
              : null)
            : null;
          const hs = homestandMap?.[dd.date];

          return (
            <div
              key={dd.date}
              className={`sc-tile sc-tile--active sc-tile--period sc-tile-state--${status} ${isTodayTile ? "sc-tile--today" : ""} ${hasHomestandSchedule && status === "prep" ? "sc-tile--prep" : ""} ${status === "no-service" ? "sc-tile--no-service" : ""}`}
              onClick={() => onDayClick(dd.date)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDayClick(dd.date); } }}
            >
              <div className="sc-tile-top">
                <span className={`sc-tile-date ${isTodayTile ? "sc-tile-date--today" : ""}`}>
                  <span className="sc-tile-dow">{dParts.dow}</span>
                  <span className="sc-tile-dom">{dParts.day}</span>
                  {isTodayTile && <span className="sc-today-pill">TODAY</span>}
                </span>
                <span className={`sc-badge ${st.className}`}>{st.icon}</span>
              </div>
              {hasHomestandSchedule ? (
                hs?.dayType === "GAME" ? (
                  <>
                    {hs.opponent && <div className="sc-tile-game">vs {hs.opponent}</div>}
                    <div className="sc-tile-meals">{hs.homestandId}</div>
                    {dd.hasActuals && <div className="sc-tile-rev sc-tile-rev--actual">{meals.toLocaleString()} meals</div>}
                  </>
                ) : (
                  <>
                    <div className="sc-tile-game">{hs?.dayType || "OFF"}</div>
                    <div className="sc-tile-noservice">{hs?.homestandId || ""}</div>
                  </>
                )
              ) : isFeeAccount ? (
                <OperationalTileBody
                  meals={meals}
                  gameType={gameType}
                  milbPill={milbPill}
                  status={status}
                  hasActuals={dd.hasActuals}
                />
              ) : (
                <>
                  {gameType && (
                    <div className="sc-tile-game">
                      {milbPill ? (
                        <span className={`sc-mlb-pill sc-mlb-pill--${milbPill}`}>
                          <span className="sc-mlb-pill-dot" />
                          {milbPill === "day" ? "Day" : "Night"}
                        </span>
                      ) : gameType}
                    </div>
                  )}
                  {status === "no-service" ? (
                    <div className="sc-tile-noservice">No service</div>
                  ) : (
                    <>
                      <div className={`sc-tile-meals ${dd.hasActuals ? "" : "sc-tile-meals--proj"}`}>{meals.toLocaleString()} meals</div>
                      <div className={`sc-tile-rev ${dd.hasActuals ? "sc-tile-rev--actual" : status === "future" ? "sc-tile-rev--future" : "sc-tile-rev--projected"}`}>
                        {!dd.hasActuals && status !== "future" ? "est. " : ""}{status === "future" ? "~" : ""}{fmt$(revenue)}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Skeleton matching the View C shape - prevents layout shift when data
// lands. Shimmer respects prefers-reduced-motion via CSS (static
// gradient under reduce).
function PeriodSkeleton() {
  return (
    <div className="sc-period-view sc-period-view--loading" aria-hidden="true">
      <div className="sc-period-header">
        <div className="sc-period-header-top">
          <div className="sc-skel sc-skel--label" />
          <div className="sc-skel sc-skel--range" />
        </div>
        <div className="sc-period-frame">
          <div className="sc-skel sc-skel--hero" />
          <div className="sc-skel sc-skel--sub" />
          <div className="sc-skel sc-skel--sub" />
        </div>
        <div className="sc-skel sc-skel--progress" />
      </div>
      <div className="sc-period-week-nav">
        <div className="sc-period-week-pills">
          {["W1","W2","W3","W4"].map((w) => <div key={w} className="sc-skel sc-skel--pill" />)}
        </div>
      </div>
      <div className="sc-period-tiles">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="sc-skel sc-skel--tile" />
        ))}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useRef } from "react";
import { GREEN, AMBER } from "./ServiceCalendar";
import { OperationalTileBody } from "./OperationalView";
import useAnimatedNumber from "./useAnimatedNumber";

// PeriodLensView - View C surface for the Period lens.
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
//   - the full period rendered with all weeks in a transform-driven
//     track; the active week is the one in the viewport.
//
// PR-B2b polish: week switch is a M-C directional slide (translateX on
// a per-week track), with a mobile touch-swipe equivalent and reduced-
// motion fallback to hard cut. Entered $ figures count up via
// useAnimatedNumber on save. No refetch happens on week switch - all
// the period's tiles are already rendered in the track; the transform
// just moves the viewport (the P1 from B2a held intact).

const fmt$ = (n) => "$" + Math.round(n).toLocaleString("en-US");

// AnimatedDollar - drop-in for fmt$(value) on entered-$ figures. Wraps
// useAnimatedNumber so the parent JSX stays clean. Returns plain text
// so the caller's existing span/className is preserved.
function AnimatedDollar({ value }) {
  const v = useAnimatedNumber(value);
  return <>{fmt$(v)}</>;
}

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

  // Per-week sorted day lists. The slide track renders ALL weeks
  // simultaneously and the transform translates the viewport - so we
  // pre-bucket all days by week once, then the inner grid lays them
  // out side-by-side. This is what makes the week switch a 0ms
  // transform (no refetch, no re-derive - the data is already there).
  const daysByWeek = useMemo(() => {
    const m = {};
    for (const w of weeks) m[w] = [];
    if (periodDays) {
      for (const d of periodDays) {
        const w = d.meta?.week;
        if (w && m[w]) m[w].push(d);
      }
    }
    return m;
  }, [periodDays, weeks]);

  // Touch swipe state for the mobile equivalent of the directional
  // slide. Horizontal swipe past 80px (and dominantly horizontal vs
  // vertical) triggers the prev/next week. Reuses the same CSS
  // transform so reduced-motion still gives a hard cut on swipe.
  const touchStartRef = useRef(null);

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
              <span className="sc-period-frame-entered"><AnimatedDollar value={m.actRev} /></span>
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
                      {ws.actRev > 0
                        ? <AnimatedDollar value={ws.actRev} />
                        : fmt$(ws.projRev)}
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

      {/* Day tiles in the slide track (M-C directional slide). ALL
          weeks render side-by-side; the transform translates the
          viewport. Week switch is a 0ms transform - no refetch, no
          re-render of off-screen weeks beyond what React reconciles.
          Mobile gets the touch-swipe equivalent. Both fall back to a
          hard cut under prefers-reduced-motion via the CSS. */}
      <div
        className="sc-period-tile-track"
        onTouchStart={(e) => {
          touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchEnd={(e) => {
          const s = touchStartRef.current;
          if (!s) return;
          touchStartRef.current = null;
          const dx = e.changedTouches[0].clientX - s.x;
          const dy = e.changedTouches[0].clientY - s.y;
          // Require dominant horizontal motion + 80px threshold; in a
          // cooler with gloves the gesture is often noisy.
          if (Math.abs(dx) < 80 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          const curIdx = weeks.indexOf(weekKey);
          if (curIdx === -1) return;
          if (dx < 0 && curIdx < weeks.length - 1) onWeekChange(weeks[curIdx + 1]);
          if (dx > 0 && curIdx > 0) onWeekChange(weeks[curIdx - 1]);
        }}
      >
        <div
          className="sc-period-tile-track-inner"
          style={{ "--week-index": Math.max(0, weeks.indexOf(weekKey)), "--week-count": weeks.length || 1 }}
        >
          {weeks.map((w) => {
            const inactive = w !== weekKey;
            // inert blocks focus + clicks + screen readers from the
            // off-screen weeks. The active week is interactive; the
            // tab order skips the others cleanly.
            const inertProps = inactive ? { inert: "" } : {};
            return (
              <div
                className="sc-period-tile-week"
                key={w}
                aria-hidden={inactive}
                {...inertProps}
              >
                {daysByWeek[w].map((dd) => renderDayTile(dd, {
                  STATUS, dayStatus, daySummary,
                  isFeeAccount, hasHomestandSchedule, homestandMap, isMilb,
                  today, onDayClick,
                }))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Day tile renderer - extracted so the slide-track render can iterate
// every week's days using the same tile body. Same JSX shape as the
// B2a inline version; closure variables pulled in via the ctx arg.
function renderDayTile(dd, ctx) {
  const {
    STATUS, dayStatus, daySummary,
    isFeeAccount, hasHomestandSchedule, homestandMap, isMilb,
    today, onDayClick,
  } = ctx;
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

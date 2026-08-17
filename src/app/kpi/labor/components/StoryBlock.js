"use client";
// src/app/kpi/labor/components/StoryBlock.js
//
// V8-8..V8-12. One card, two panels: left = the money, right = the weeks.
// Both panels bottom-align. Left: eyebrow / headline / three-stat rail /
// budget track. Right: header (title + legend pills + $/hrs + ?) / week
// columns (one per fiscal week per V8-12 rules).

import { useEffect, useRef, useState } from "react";
import { fmt$, fmtHrs, fmtDate } from "../lib/formatting.js";

const LENS_KEY = "kpi:board:lens";

function useLens() {
  const [lens, setLens] = useState("$");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { const v = localStorage.getItem(LENS_KEY); if (v === "$" || v === "hrs") setLens(v); } catch {}
  }, []);
  const commit = (v) => {
    setLens(v);
    try { localStorage.setItem(LENS_KEY, v); } catch {}
  };
  return [lens, commit];
}

function Help({ children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span className="kpi-help-anchor" ref={rootRef}>
      <button
        type="button"
        className="kpi-help"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        aria-label="Show explanation"
        onClick={() => setOpen(o => !o)}
      >?</button>
      {open && <div className="kpi-help-pop" role="dialog">{children}</div>}
    </span>
  );
}

function BudgetTrack({ board }) {
  const budget = board.period_budget || board.range_budget;
  if (!budget || budget <= 0) return null;
  const spentPct = Math.max(0, Math.min(100, (board.spent_to_date / budget) * 100));
  const elapsedPct = board.elapsed_pct != null ? Math.max(0, Math.min(100, board.elapsed_pct)) : null;
  const projectedPct = board.projected_period_end != null
    ? Math.max(0, Math.min(100, (board.projected_period_end / budget) * 100))
    : null;
  const projExtra = projectedPct != null ? Math.max(0, projectedPct - spentPct) : 0;
  return (
    <div className="kpi-track">
      <div className="kpi-track-rail" role="img" aria-label={`Spent ${board.spent_to_date != null ? fmt$(board.spent_to_date) : "—"} of ${fmt$(budget)}`}>
        <span className="kpi-track-spent" style={{ width: `${spentPct}%` }} />
        {projectedPct != null && (
          <span className="kpi-track-proj" style={{ left: `${spentPct}%`, width: `${projExtra}%` }} />
        )}
        {elapsedPct != null && (
          <span className="kpi-track-today" style={{ left: `${elapsedPct}%` }}>
            <span className="kpi-track-today-lab">TODAY</span>
          </span>
        )}
        {projectedPct != null && (
          <span className="kpi-track-projend" style={{ left: `${projectedPct}%` }}>PROJECTED PERIOD END</span>
        )}
      </div>
      <div className="kpi-track-keys">
        <div><i className="kpi-key-spent" />spent <b>{fmt$(board.spent_to_date || 0)}</b></div>
        {projectedPct != null && (
          <div><i className="kpi-key-proj" />projected <b>{fmt$(board.projected_period_end || 0)}</b></div>
        )}
        <div>budget <b>{fmt$(budget)}</b></div>
      </div>
    </div>
  );
}

function WeekBar({ w, lens, weeklyOriginal, rollingTarget }) {
  // Determine plot value + max for scaling. Max is the largest of
  // (week value, its target) so bars and dashes both fit.
  const value = lens === "$"
    ? (w.state === "not_started" ? (w.rolling_target ?? rollingTarget ?? 0) : (w.spent || 0))
    : (w.hours || 0);
  const target = lens === "$"
    ? (w.state === "not_started" ? (w.rolling_target ?? rollingTarget ?? 0) : (w.original_target ?? weeklyOriginal ?? 0))
    : null;
  const stackMax = Math.max(value, target || 0);
  const scale = stackMax > 0 ? stackMax : 1;
  const barPct = w.state === "not_started" ? 0 : Math.max(0, Math.min(100, (value / scale) * 90));
  const targetPct = target != null ? Math.max(0, Math.min(100, (target / scale) * 90)) : null;
  const isNotStarted = w.state === "not_started";
  const isInProgress = w.state === "in_progress";
  const isClosed = w.state === "closed";
  const barCls = isInProgress
    ? "kpi-wb-bar kpi-wb-bar-prog"
    : isClosed
      ? `kpi-wb-bar ${w.delta_sign === "over" ? "kpi-wb-bar-over" : "kpi-wb-bar-under"}`
      : "";
  const showRollingDash = isNotStarted;
  const dashCls = showRollingDash ? "kpi-wb-target kpi-wb-target-roll" : "kpi-wb-target";

  // Caption
  let captionValue;
  if (lens === "$") {
    captionValue = w.state === "in_progress" && w.unapproved_flag
      ? `≥ ${fmt$(value)}`
      : fmt$(value);
  } else {
    captionValue = fmtHrs(value);
  }
  let statusLine;
  if (isClosed && w.delta_vs_original != null) {
    const arrow = w.delta_sign === "under" ? "▼" : w.delta_sign === "over" ? "▲" : "•";
    const cls = w.delta_sign === "under" ? "kpi-wb-d-good" : w.delta_sign === "over" ? "kpi-wb-d-bad" : "kpi-wb-d-mute";
    statusLine = <span className={`kpi-wb-d ${cls}`}>{arrow} {fmt$(Math.abs(w.delta_vs_original))} {w.delta_sign}</span>;
  } else if (isInProgress) {
    if (w.unapproved_flag && w.unapproved_hours > 0) {
      statusLine = <span className="kpi-wb-warn">⚠ {fmtHrs(w.unapproved_hours)} hrs awaiting approval</span>;
    } else {
      // days-elapsed-of-7 from week_start to today
      const days = daysElapsed(w.week_start);
      statusLine = <span className="kpi-wb-d kpi-wb-d-mute">{days} of 7 days</span>;
    }
  } else if (isNotStarted) {
    statusLine = <span className="kpi-wb-d kpi-wb-d-mute">to stay on budget</span>;
  }
  const captionCls = isNotStarted ? "kpi-wb-cap-value kpi-wb-cap-roll" : "kpi-wb-cap-value";

  return (
    <div className="kpi-wb">
      <div className="kpi-wb-plot">
        {targetPct != null && (
          <span className={dashCls} style={{ bottom: `${targetPct}%` }} />
        )}
        {isNotStarted ? (
          <div className="kpi-wb-basel" />
        ) : (
          <div className={barCls} style={{ height: `${Math.max(barPct, 2)}%` }} />
        )}
      </div>
      <div className="kpi-wb-cap">
        <b className={captionCls}>{captionValue}</b>
        <span className="kpi-wb-dates">{fmtDate(w.week_start)} – {fmtDate(w.week_end)}{isInProgress ? " · in progress" : ""}</span>
        {statusLine}
      </div>
    </div>
  );
}

function daysElapsed(weekStartISO) {
  const [y, m, d] = weekStartISO.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d);
  const now = Date.now();
  const days = Math.floor((now - start) / 86400000) + 1;
  return Math.max(1, Math.min(7, days));
}

export function StoryBlock({ board, account, rangeLabel }) {
  const [lens, setLens] = useLens();
  const budget = board?.period_budget || board?.range_budget;
  const eyebrowLabel = board?.kind === "single_period_in_progress" || board?.kind === "single_period_closed"
    ? `PERIOD ${board.period_no}`
    : (rangeLabel || "").toUpperCase();
  const dateRange = board?.period_start && board?.period_end
    ? `${fmtDate(board.period_start)} – ${fmtDate(board.period_end)}`
    : "";
  const workers = board?.distinct_workers ?? 0;
  const hours = board?.hours ?? 0;
  const avgRate = board?.avg_rate;

  return (
    <div className="kpi-story">
      <div className="kpi-story-left">
        <div className="kpi-story-eye">
          <span className="kpi-story-eye-1">{eyebrowLabel}</span>
          {dateRange && <span className="kpi-story-eye-2">{dateRange}</span>}
        </div>
        <div className="kpi-story-headline">
          <span className="kpi-story-hn num">{fmt$(board?.spent_to_date || 0)}</span>
          <span className="kpi-story-hlab">Total labor spent</span>
        </div>
        <div className="kpi-story-rail3">
          <div className="kpi-story-s"><span className="kpi-story-v num">{workers}</span><span className="kpi-story-k">Workers</span></div>
          <div className="kpi-story-s"><span className="kpi-story-v num">{fmtHrs(hours)}</span><span className="kpi-story-k">Hours</span></div>
          <div className="kpi-story-s"><span className="kpi-story-v num">{avgRate != null ? `$${avgRate.toFixed(2)}` : "—"}</span><span className="kpi-story-k">Avg&nbsp;rate</span></div>
        </div>
        {budget > 0 && <BudgetTrack board={board} />}
      </div>

      <div className="kpi-story-right">
        <div className="kpi-wh">
          <span className="kpi-wh-t">THE PERIOD · WEEK BY WEEK</span>
          <span className="kpi-wh-sp" aria-hidden="true" />
          {board?.weekly_original_target != null && (
            <span className="kpi-lpill kpi-lpill-a">
              <span className="kpi-lpill-dash" aria-hidden="true" />
              original <b>{fmt$(board.weekly_original_target)}</b>
            </span>
          )}
          {board?.rolling_weekly_target != null && !board.budget_exhausted && (
            <span className="kpi-lpill kpi-lpill-n">
              <span className="kpi-lpill-dash" aria-hidden="true" />
              rolling <b>{fmt$(board.rolling_weekly_target)}</b>
            </span>
          )}
          {board?.budget_exhausted && (
            <span className="kpi-lpill kpi-lpill-n">
              <span className="kpi-lpill-dash" aria-hidden="true" />
              rolling <b>{fmt$(0)}</b> · budget exhausted
            </span>
          )}
          <span className="kpi-seg" role="group" aria-label="Lens">
            <button type="button" className={lens === "$" ? "on" : ""} onClick={() => setLens("$")} aria-pressed={lens === "$"}>$</button>
            <button type="button" className={lens === "hrs" ? "on" : ""} onClick={() => setLens("hrs")} aria-pressed={lens === "hrs"}>hrs</button>
          </span>
          <Help>
            <h5>HOW THESE LINES WORK</h5>
            <b>Original</b> is the flat weekly budget - the period budget divided by four. Closed weeks keep it, because that is what they were judged against.
            {board?.rolling_weekly_target != null && (
              <div className="kpi-help-calc">
                Rolling = (budget − closed spend − in-progress spend) ÷ weeks left = <b>{fmt$(board.rolling_weekly_target)}</b>
              </div>
            )}
            <b>Rolling</b> replaces it on upcoming weeks: what each remaining week can spend and still land on budget.
          </Help>
        </div>

        <div className="kpi-wbars">
          {(board?.weeks || []).map(w => (
            <WeekBar
              key={w.week_start}
              w={w}
              lens={lens}
              weeklyOriginal={board.weekly_original_target}
              rollingTarget={board.rolling_weekly_target}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

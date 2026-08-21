"use client";
// src/app/kpi/labor/components/HomestandBoard.js
//
// PR-2 - the homestand view. Renders only when
// data.homestands?.length > 0 (six MLB accounts today). Sits under
// the command bar's "Homestand" tab; ?view=homestand keeps a shared
// link on the right view.
//
// Owner reminders 2026-08-21 baked in
//   #1 salary gate works EXACTLY as period board. Client renders
//      only what the server sent. When salary is off, actuals_range
//      contains no salaried rows -> employee expansion is hourly
//      only, and per-stand actual figures on the rail sit against
//      hourly-only budget. Sum-of-employee-rows == stand total to
//      the cent (DOM probe asserts this).
//   #2 colour encodes IDENTITY, pattern encodes STATE. Day strip
//      uses variant="identity": navy night, blue day, hatch prep,
//      stub zero. Never green or red on the day strip - those mean
//      under and over on the rail, and a green day-game would read
//      as "good" when it only means daylight.
//   #3 season-to-date card is FIXED SEASON TRUTH. Reads data
//      .homestand_bank + data.homestands, which the server computes
//      per request from the FULL season. It does NOT re-derive on
//      stand selection. Only the .kpi-hs-sbar-mark navy outline
//      moves.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { fmt$, fmtHrs, fmtDate } from "../lib/formatting.js";
import { DayStripPlot, aggregatePerDay, isoRange } from "./DayStrip.js";

function fmt$0(v) {
  return "$" + Math.round(Number(v || 0)).toLocaleString("en-US");
}
function arrow(v, goodWhenPositive = true) {
  const good = goodWhenPositive ? v >= 0 : v <= 0;
  return { glyph: v >= 0 ? "▼" : "▲", cls: good ? "kpi-hs-good" : "kpi-hs-bad" };
}

// PR-2 audit 2026-08-21 - v11 render carried a ? popover on every
// card; the initial homestand build shipped zero. This restores them
// with the v11 copy verbatim. Popover positions absolutely under the
// button; flips up when the trigger sits near the bottom of the
// viewport. Outside-click and Escape close. Card z-index lifts via
// `.kpi-hs-card:has(.kpi-hs-qwrap.on)` so the popover paints above
// its sibling cards.
function HsHelpPop({ id, title, body }) {
  const [open, setOpen] = useState(false);
  const [flip, setFlip] = useState(false);
  const rootRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const r = popRef.current.getBoundingClientRect();
    setFlip(r.bottom > window.innerHeight - 8);
  }, [open]);

  return (
    <span className={`kpi-hs-qwrap ${open ? "on" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="kpi-hs-qbtn"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        aria-label={`About: ${title}`}
        data-hs-help={id}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >?</button>
      {open && (
        <div
          ref={popRef}
          className={`kpi-hs-pop ${flip ? "kpi-hs-pop-flip" : ""}`}
          role="dialog"
          aria-label={title}
          data-hs-pop
        >
          <b className="kpi-hs-pop-title">{title}</b>
          <div className="kpi-hs-pop-body">{body}</div>
        </div>
      )}
    </span>
  );
}

// ─── Season rail card ───────────────────────────────────────────────
function SeasonRailCard({ homestands, selectedGameStart, onSelect }) {
  const rail = useMemo(() => {
    // Scale by max spend across played stands. Pre-floor + future stands
    // render at a floor height so the rail never disappears at the tails.
    let max = 1;
    for (const h of homestands) {
      const v = h.actual != null ? h.actual : 0;
      if (v > max) max = v;
      if (h.budget && h.budget > max) max = h.budget;
    }
    return { scale: max * 1.10 };
  }, [homestands]);

  return (
    <div className="kpi-hs-card kpi-hs-card-rail" role="region" aria-label="Season by homestand">
      <header className="kpi-hs-card-hdr">
        <span className="kpi-hs-eyebrow">Season by homestand</span>
        <span className="kpi-hs-note">Click on a homestand to open it</span>
        <HsHelpPop
          id="qRail"
          title="Season by homestand"
          body={<>One bar per homestand, height is what it cost. Green came in under budget, red went over.<br /><br />The navy dashed line is the original budget for that stand.</>}
        />
      </header>
      <div className="kpi-hs-rail">
        {homestands.map(h => {
          const isSel = h.game_start === selectedGameStart;
          const isFuture = !h.pre_floor && h.actual == null;
          const val = h.actual != null ? h.actual : 0;
          const barPct = h.pre_floor
            ? 0
            : (isFuture ? 0 : Math.min(100, (val / rail.scale) * 100));
          const tickPct = h.budget != null ? Math.min(100, (h.budget / rail.scale) * 100) : null;
          const over = h.actual != null && h.budget != null && h.actual > h.budget;
          const barCls = h.pre_floor
            ? "kpi-hs-rail-bar kpi-hs-rail-bar-pre"
            : isFuture
              ? "kpi-hs-rail-bar kpi-hs-rail-bar-future"
              : over
                ? "kpi-hs-rail-bar kpi-hs-rail-bar-over"
                : "kpi-hs-rail-bar kpi-hs-rail-bar-under";
          const opp0 = (h.opponents?.[0] || "").slice(0, 6) + (h.opponents?.length > 1 ? "+" : "");
          const cls = [
            "kpi-hs-rail-stand",
            isSel ? "on" : "",
            isFuture ? "fut" : "",
            h.pre_floor ? "pre" : "",
          ].filter(Boolean).join(" ");
          return (
            <button
              key={h.game_start}
              type="button"
              className={cls}
              onClick={() => !h.pre_floor && onSelect(h.game_start)}
              disabled={h.pre_floor}
              data-game-start={h.game_start}
              data-pre-floor={h.pre_floor ? "true" : "false"}
              title={h.pre_floor ? "Before daily detail starts (04/20/26)" : `${h.game_start} - ${h.game_end}`}
            >
              <div className="kpi-hs-rail-plot">
                {tickPct != null && !h.pre_floor && (
                  <span className="kpi-hs-rail-tick" style={{ bottom: `${tickPct}%` }} />
                )}
                <span className={barCls} style={{ height: `${Math.max(barPct, 3)}%` }} />
              </div>
              <div className="kpi-hs-rail-amt">
                {h.pre_floor ? "–" : (h.actual != null ? fmt$0(h.actual) : "~ plan")}
              </div>
              <div className="kpi-hs-rail-nm">
                {opp0}<br />{fmtDate(h.game_start).slice(0, 5)}
              </div>
              {h.pre_floor && <div className="kpi-hs-rail-tag">no detail</div>}
            </button>
          );
        })}
      </div>
      <div className="kpi-hs-rail-key">
        <span><i className="kpi-hs-key-sw kpi-hs-key-under" /> under target</span>
        <span><i className="kpi-hs-key-sw kpi-hs-key-over" /> over target</span>
        <span><i className="kpi-hs-key-sw kpi-hs-key-pre" /> before daily detail (04/20)</span>
        <span><i className="kpi-hs-key-sw kpi-hs-key-future" /> not played yet</span>
        <span className="kpi-hs-key-line">– – – original target</span>
      </div>
    </div>
  );
}

// ─── Season-to-date card - FIXED per owner reminder #3 ─────────────
// Owner ruling 2026-08-21 after PR-2 v1 shipped a display bug: any
// figure the server computes must be READ, never re-derived
// client-side. Previous client filtered `h.actual != null` for
// "finished" - but future stands had actual = 0 (not null), which
// (a) counted 11 finished (9 + 2 future) instead of 9, and (b) left
// stands_remaining at 0 and remaining_budget at $0. Bug was invisible
// because the load-bearing money figures (bank, spent, budget_to_date)
// were correct - only the counts and remaining-budget were wrong.
// Fix: read stands_finished, stands_remaining, and remaining_budget
// directly off bank. Server owns the discrimination.
function SeasonToDateCard({ bank, homestands, selectedGameStart }) {
  if (!bank) return null;
  const finishedCount   = Number(bank.stands_finished || 0);
  const remainingCount  = Number(bank.stands_remaining || 0);
  const remainingBudget = Number(bank.remaining_budget || 0);
  const budgetToDate    = Number(bank.budget_to_date || 0);
  const seasonBudget    = budgetToDate + remainingBudget;
  const scale = seasonBudget || 1;
  const pct = v => Math.max((v / scale) * 100, 0);
  const bankVal = Number(bank.bank || 0);
  const spent = Number(bank.spent_to_date || 0);
  const bankAbs = Math.abs(bankVal);

  // Selected-stand outline anchor: where the selected stand's actual
  // dollars sit along the "spent" bar. Only the OUTLINE moves per
  // reminder #3; every dollar figure below stays fixed.
  let outline = null;
  if (selectedGameStart) {
    let before = 0;
    for (const h of homestands) {
      if (h.game_start === selectedGameStart) {
        if (h.actual != null) outline = { left: pct(before), width: pct(h.actual) };
        break;
      }
      if (h.actual != null) before += h.actual;
    }
  }

  return (
    <div className="kpi-hs-card kpi-hs-card-season" role="region" aria-label="Season to date">
      <header className="kpi-hs-card-hdr">
        <span className="kpi-hs-eyebrow">Season to date</span>
        <span className="kpi-hs-note" data-season-rn>
          {finishedCount} stand{finishedCount === 1 ? "" : "s"} finished · {remainingCount} remaining
        </span>
        <span className={`kpi-hs-pill ${bankVal >= 0 ? "kpi-hs-pill-good" : "kpi-hs-pill-bad"}`} data-bank-pill>
          Bank {bankVal >= 0 ? "▲" : "▼"} {fmt$0(bankAbs)}
        </span>
        <HsHelpPop
          id="qSeason"
          title="Season to date"
          body={<>The solid bar is what you have spent. The green hatch is the bank - budget you were given but did not use. The grey hatch is what is still budgeted for the stands you have left.<br /><br />The navy outline shows where the stand you are looking at sits in the season.</>}
        />
      </header>
      <div className="kpi-hs-sbar" data-season-sbar>
        <span className="kpi-hs-sbar-spent" style={{ width: `${pct(spent)}%` }}>
          {pct(spent) > 12 ? `SPENT ${fmt$0(spent)}` : ""}
        </span>
        <span
          className={`kpi-hs-sbar-bank ${bankVal >= 0 ? "" : "kpi-hs-sbar-over"}`}
          style={{ width: `${pct(bankAbs)}%` }}
        >
          {pct(bankAbs) > 8 ? `${bankVal >= 0 ? "BANK " : "OVER "}${fmt$0(bankAbs)}` : ""}
        </span>
        <span className="kpi-hs-sbar-remain" style={{ width: `${pct(remainingBudget)}%` }}>
          {pct(remainingBudget) > 6 ? `${fmt$0(remainingBudget)} remaining` : ""}
        </span>
        {outline && (
          <span
            className="kpi-hs-sbar-mark"
            style={{ left: `${outline.left}%`, width: `${outline.width}%` }}
            data-selected-outline
          />
        )}
      </div>
      <div className="kpi-hs-sbar-key">
        <span><b data-key-season-budget>{fmt$0(seasonBudget)}</b> season budget</span>
        <span><b data-key-spent>{fmt$0(spent)}</b> spent · {finishedCount} stand{finishedCount === 1 ? "" : "s"}</span>
        <span className={bankVal >= 0 ? "kpi-hs-good" : "kpi-hs-bad"} data-key-bank>
          <b>{bankVal >= 0 ? "▲ " : "▼ "}{fmt$0(bankAbs)}</b> in the bank
        </span>
        <span><b data-key-remaining>{fmt$0(remainingBudget)}</b> budgeted for the {remainingCount} remaining stand{remainingCount === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

// ─── Stand header ──────────────────────────────────────────────────
function StandHeader({ stand }) {
  if (!stand) return null;
  const opp = stand.opponents?.join(" / ") || "(no opponents)";
  return (
    <div className="kpi-hs-card kpi-hs-card-standhdr" role="region" aria-label="Selected stand">
      <div className="kpi-hs-standhdr-row">
        <span className="kpi-hs-standhdr-title">Homestand {stand.index} · {opp}</span>
        <span className="kpi-hs-standhdr-dates">
          {fmtDate(stand.game_start)} - {fmtDate(stand.game_end)} · {stand.window_days} days · {stand.game_days} games
        </span>
      </div>
    </div>
  );
}

// ─── Day strip - identity variant per reminder #2 ──────────────────
function StandDayStrip({ stand, actualsDaily, gameDates, nightGameDates, todayISO }) {
  const days = useMemo(
    () => isoRange(stand.window_start, stand.window_end),
    [stand.window_start, stand.window_end],
  );
  const { perDay } = aggregatePerDay(actualsDaily, days);
  return (
    <div className="kpi-hs-card kpi-hs-card-strip" role="region" aria-label="Day by day">
      <header className="kpi-hs-card-hdr">
        <span className="kpi-hs-eyebrow">Day by day</span>
        <span className="kpi-hs-note">
          <span className="kpi-hs-legend-sw kpi-hs-day-night" /> night game
          <span className="kpi-hs-legend-sw kpi-hs-day-day" /> day game
          <span className="kpi-hs-legend-sw kpi-hs-day-prep" /> prep or off day
        </span>
      </header>
      <DayStripPlot
        perDay={perDay}
        todayISO={todayISO}
        variant="identity"
        gameDates={gameDates}
        nightGameDates={nightGameDates}
        ariaLabel={`Homestand ${stand.index} day strip`}
      />
    </div>
  );
}

// ─── Five signal cards ─────────────────────────────────────────────
function GaugeBar({ ot, band }) {
  // band = [lo, hi, mid]. Position mark on 0-50% axis, band as
  // amber region, mark as navy stub.
  const clamp = v => Math.max(0, Math.min(50, v));
  const bandStart = (clamp(band[0]) / 50) * 100;
  const bandWidth = ((clamp(band[1]) - clamp(band[0])) / 50) * 100;
  const markPos = (clamp(ot) / 50) * 100;
  const color = ot < band[0] ? "kpi-hs-good" : ot > band[1] ? "kpi-hs-bad" : "kpi-hs-mid";
  return (
    <div className="kpi-hs-gauge">
      <div className="kpi-hs-gauge-track" />
      <div className="kpi-hs-gauge-band" style={{ left: `${bandStart}%`, width: `${Math.max(bandWidth, 2)}%` }} />
      <div className={`kpi-hs-gauge-mark ${color}`} style={{ left: `${markPos}%` }} />
      <div className="kpi-hs-gauge-labels">
        <span>0%</span><span>25%</span><span>50%</span>
      </div>
    </div>
  );
}

// Owner-measured OT norms per peak_games_in_week (PR-3 spec table).
const OT_NORMS = {
  3:  [0.0,   4.2,  1.8],
  4:  [2.1,  11.2,  6.6],
  5:  [2.1,  11.2,  6.6],
  6:  [0.0,  41.8, 20.7],
  7:  [26.0, 43.2, 34.4],
  8:  [26.0, 43.2, 34.4],
  9:  [26.0, 43.2, 34.4],
  10: [26.0, 43.2, 34.4],
};

function SignalCards({ stand, split, employees, hourlyRate, salaryAvailable = false, salaryOn = false }) {
  if (!stand || !split) return null;
  const budget = stand.budget || 0;
  const actual = stand.actual || 0;
  const variance = budget - actual;   // positive = under budget = good
  const arr = arrow(variance, true);
  const perGame = stand.game_days > 0 ? split.game_day_dollars / stand.game_days : 0;
  const perOffDay = split.off_day_count > 0 ? split.off_day_dollars / split.off_day_count : 0;
  const norm = OT_NORMS[Math.min(stand.peak_games_in_week, 10)] || OT_NORMS[3];
  const otPct = employees.reduce((s, e) => s + (e.hours_regular > 0 ? (e.hours_overtime / e.hours_regular) * 100 : 0), 0) / Math.max(employees.length, 1);
  const otBand = otPct < norm[0] ? "kpi-hs-pill-good" : otPct > norm[1] ? "kpi-hs-pill-bad" : "kpi-hs-pill-amber";
  const totalHrs = employees.reduce((s, e) => s + (e.hours_regular || 0) + (e.hours_overtime || 0) + (e.hours_double_time || 0), 0);
  const crewSize = employees.length;
  const unapprovedHrs = employees.reduce((s, e) => s + (e.anomaly_no_clockout || 0) + (Math.max(0, (e.hours_without_dollars || 0))), 0);

  return (
    <div className="kpi-hs-signals" role="region" aria-label="Stand signal cards">
      {/* Spend - variance is the hero. Scope pill sits beside the
          on-track / over-budget pill per the header cleanup - moved
          off the command-bar title into the first card at that
          card's pill scale. Renders whenever the caller can toggle
          salary so a printed / screenshotted stand board always
          states which pool of workers it counted. */}
      <div className={`kpi-hs-card kpi-hs-signal ${variance >= 0 ? "kpi-hs-edge-good" : "kpi-hs-edge-bad"}`} data-card="spend">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">HS {stand.index} spend</span>
          <span className="kpi-hs-card-hdr-pills">
            <span className={`kpi-hs-pill ${variance >= 0 ? "kpi-hs-pill-good" : "kpi-hs-pill-bad"}`}>
              {variance >= 0 ? "Under" : "Over"}
            </span>
            {salaryAvailable && (
              <span
                className={"kpi-hs-pill " + (salaryOn ? "kpi-hs-pill-amber" : "kpi-hs-pill-mute")}
                aria-label={salaryOn ? "Salary included" : "Hourly labor only"}
                data-scope-pill
              >{salaryOn ? "+ SALARY" : "HOURLY ONLY"}</span>
            )}
          </span>
          <HsHelpPop
            id="qSpend"
            title="What this stand cost"
            body={<>Every dollar of hourly labor on the days this homestand owns - the prep day before it, the games, and any other day worked before the next stand opens.<br /><br />The arrow compares it to the budget for those same days. Down and green means you came in under.</>}
          />
        </header>
        <div className={`kpi-hs-hero ${arr.cls}`} data-figure="variance">
          {arr.glyph} {fmt$(Math.abs(variance))}
          <span className="kpi-hs-hero-sub">{variance >= 0 ? "under" : "over"}</span>
        </div>
        <div className="kpi-hs-sub"><b data-figure="actual">{fmt$(actual)}</b> spent against budget</div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Budget</div><div className="kpi-hs-fact-v" data-figure="budget">{fmt$(budget)}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Days</div><div className="kpi-hs-fact-v">{stand.window_days}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Hours</div><div className="kpi-hs-fact-v">{totalHrs.toFixed(1)}</div></div>
        </div>
      </div>

      {/* Prep & off days */}
      <div className="kpi-hs-card kpi-hs-signal kpi-hs-edge-blue" data-card="prep">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">Prep &amp; off days</span>
          <span className="kpi-hs-pill kpi-hs-pill-blue">
            {actual > 0 ? Math.round((split.off_day_dollars / actual) * 100) : 0}%
          </span>
          <HsHelpPop
            id="qPrep"
            title="Prep and off days"
            body={<>Labor on days with no game - the prep day before the stand opens, plus anything worked while the team was away.<br /><br />This is the part of the stand you control. Game days are fixed by the schedule; these days are your call.</>}
          />
        </header>
        <div className="kpi-hs-hero kpi-hs-blue" data-figure="off-day-dollars">
          {fmt$(split.off_day_dollars)} <span className="kpi-hs-hero-sub">spent</span>
        </div>
        <div className="kpi-hs-sub">on {split.off_day_count} day{split.off_day_count === 1 ? "" : "s"} outside game days</div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Per off day</div><div className="kpi-hs-fact-v kpi-hs-blue">{fmt$0(perOffDay)}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Game days</div><div className="kpi-hs-fact-v">{fmt$0(split.game_day_dollars)}</div></div>
        </div>
      </div>

      {/* Cost per game day */}
      <div className="kpi-hs-card kpi-hs-signal kpi-hs-edge-purple" data-card="game">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">Cost per game day</span>
          <span className="kpi-hs-pill kpi-hs-pill-purple">{stand.game_days} games</span>
          <HsHelpPop
            id="qGame"
            title="Cost per game day"
            body={<>Game-day labor divided by the number of games. Prep days are left out so this is a clean per-game number.<br /><br />Night games cost more than day games because they run later and the crew size is typically the same. Per-account base rates land with the pre-floor estimator.</>}
          />
        </header>
        <div className="kpi-hs-hero kpi-hs-purple" data-figure="per-game">{fmt$(perGame)}</div>
        <div className="kpi-hs-sub">across {stand.night_games} night + {stand.day_games} day game{stand.game_days === 1 ? "" : "s"}</div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Night</div><div className="kpi-hs-fact-v">{stand.night_games}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Day</div><div className="kpi-hs-fact-v">{stand.day_games}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Crew</div><div className="kpi-hs-fact-v">{crewSize}</div></div>
        </div>
      </div>

      {/* Overtime for this shape */}
      <div className="kpi-hs-card kpi-hs-signal kpi-hs-edge-amber" data-card="ot">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">Overtime for this shape</span>
          <span className={`kpi-hs-pill ${otBand}`}>
            {otPct < norm[0] ? "Below normal" : otPct > norm[1] ? "Above normal" : "Typical"}
          </span>
          <HsHelpPop
            id="qOT2"
            title="Why this stand carries overtime"
            body={<>
              {stand.peak_games_in_week} game days land in one Monday-Sunday week, and the 40-hour clock resets Monday - so a stand packed into a single week carries overtime no matter how it is scheduled. This is the cost of the calendar, not the crew.
              <table className="kpi-hs-pop-table">
                <tbody>
                  <tr><td>3 games in a week</td><td>2% OT</td></tr>
                  <tr><td>6 games</td><td>23%</td></tr>
                  <tr><td>7 games</td><td>38%</td></tr>
                </tbody>
              </table>
              <span className="kpi-hs-pop-foot">Measured across 36 homestands at 4 accounts this season.</span>
            </>}
          />
        </header>
        <div className={`kpi-hs-hero ${otPct < norm[0] ? "kpi-hs-good" : otPct > norm[1] ? "kpi-hs-bad" : "kpi-hs-mid"}`}>
          {otPct.toFixed(1)}%
        </div>
        <div className="kpi-hs-sub">
          <b>{stand.peak_games_in_week}</b> game days fell in one week before the Monday reset<br />
          stands like this usually run <b>{norm[0].toFixed(1)}–{norm[1].toFixed(0)}%</b>
        </div>
        <GaugeBar ot={otPct} band={norm} />
      </div>

      {/* Payroll data */}
      <div className={`kpi-hs-card kpi-hs-signal ${unapprovedHrs > 0 ? "kpi-hs-edge-amber" : "kpi-hs-edge-good"}`} data-card="payroll">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">Payroll data</span>
          <span className={`kpi-hs-pill ${unapprovedHrs > 0 ? "kpi-hs-pill-amber" : "kpi-hs-pill-good"}`}>
            {unapprovedHrs > 0 ? "Needs attention" : "Complete"}
          </span>
          <HsHelpPop
            id="qPay"
            title="Payroll data"
            body={<>Hours clocked in Rippling that nobody has approved yet. Rippling does not calculate pay until a manager approves, so these hours carry no dollars.<br /><br />Will rise is what this stand grows by once they are approved.</>}
          />
        </header>
        <div className={`kpi-hs-hero ${unapprovedHrs > 0 ? "kpi-hs-amber" : ""}`}>
          {unapprovedHrs > 0 ? `${unapprovedHrs.toFixed(1)} hrs` : "All in"}
        </div>
        <div className="kpi-hs-sub">{unapprovedHrs > 0 ? "unapproved in Rippling" : "every shift approved"}</div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Will rise</div>
            <div className={`kpi-hs-fact-v ${unapprovedHrs > 0 ? "kpi-hs-amber" : ""}`}>
              {unapprovedHrs > 0 && hourlyRate > 0 ? `~${fmt$0(unapprovedHrs * hourlyRate)}` : "–"}
            </div>
          </div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Crew</div><div className="kpi-hs-fact-v">{crewSize}</div></div>
        </div>
      </div>
    </div>
  );
}

// ─── Season table with employee expansion ──────────────────────────
// PR-2 audit 2026-08-21: row-click now selects AND expands. Prior
// behavior called only onToggleExpand, but actuals_range is populated
// only for the currently-selected stand, so expanding any other row
// yielded an empty list ("cursor:pointer but clicking does nothing").
// Fix: clicking a non-selected row fires onSelectStand (URL push -> new
// fetch) AND onToggleExpand; a compact skeleton renders in the
// expansion slot for the ~1s until data lands. Clicking an already-
// selected + expanded row collapses (single onToggleExpand).
function SeasonTable({ homestands, selectedGameStart, expandedGameStart, onToggleExpand, onSelectStand, employeesByStand, workers, redact }) {
  const handleRowClick = (gameStart) => {
    if (gameStart !== selectedGameStart) onSelectStand?.(gameStart);
    onToggleExpand?.(gameStart);
  };
  return (
    <div className="kpi-hs-card kpi-hs-card-table" role="region" aria-label="Season table">
      <table className="kpi-hs-table">
        <thead>
          <tr>
            <th>Homestand</th>
            <th>Window</th>
            <th className="num">Days</th>
            <th className="num">Games</th>
            <th className="num kpi-hs-th-help">
              Peak
              <HsHelpPop
                id="qPeak"
                title="Busiest week"
                body={<>The most game days that fall inside any single Monday-Sunday week during the stand. The 40-hour overtime clock resets Monday, so this number - not the total game count - is what drives overtime.</>}
              />
            </th>
            <th className="num">Target</th>
            <th className="num">Prep &amp; off</th>
            <th className="num">Actual</th>
            <th className="num">Bank after</th>
          </tr>
        </thead>
        <tbody>
          {homestands.map(h => {
            const isSel = h.game_start === selectedGameStart;
            const isOpen = h.game_start === expandedGameStart;
            const isFuture = !h.pre_floor && h.actual == null;
            if (h.pre_floor) {
              return (
                <tr key={h.game_start} className="kpi-hs-tr-prefloor">
                  <td>HS {h.index} · {h.opponents?.[0] || "(no opp)"}</td>
                  <td className="num">{fmtDate(h.game_start)} – {fmtDate(h.game_end)}</td>
                  <td className="num">{h.window_days}</td>
                  <td className="num">{h.game_days}</td>
                  <td className="num">{h.peak_games_in_week}</td>
                  <td colSpan="4" className="kpi-hs-tr-prefloor-note">before daily detail starts 04/20/26</td>
                </tr>
              );
            }
            if (isFuture) {
              return (
                <tr
                  key={h.game_start}
                  className={`kpi-hs-tr-band kpi-hs-tr-future ${isSel ? "kpi-hs-tr-sel" : ""}`}
                  data-game-start={h.game_start}
                >
                  <td>HS {h.index} · {h.opponents?.join(" / ") || "(no opp)"}</td>
                  <td className="num">{fmtDate(h.game_start)} – {fmtDate(h.game_end)}</td>
                  <td className="num">{h.window_days}</td>
                  <td className="num">{h.game_days}</td>
                  <td className="num">{h.peak_games_in_week}</td>
                  <td className="num">{h.budget != null ? fmt$0(h.budget) : "–"}</td>
                  <td colSpan="3" className="kpi-hs-tr-future-note">not played yet</td>
                </tr>
              );
            }
            const bankAfter = (h.budget || 0) - (h.actual || 0);
            const bankAfterArr = arrow(bankAfter, true);
            const employees = employeesByStand?.get(h.game_start);
            const employeesPending = isOpen && (!employees || employees.length === 0);
            return (
              <React.Fragment key={h.game_start}>
                <tr
                  className={`kpi-hs-tr-band ${isSel ? "kpi-hs-tr-sel" : ""} ${isOpen ? "kpi-hs-tr-open" : ""}`}
                  data-game-start={h.game_start}
                  data-hs-row-expandable
                  aria-expanded={isOpen ? "true" : "false"}
                  onClick={() => handleRowClick(h.game_start)}
                >
                  <td>
                    <span className={`kpi-hs-chev ${isOpen ? "kpi-hs-chev-open" : ""}`}>›</span>
                    HS {h.index} · {h.opponents?.join(" / ") || "(no opp)"}
                  </td>
                  <td className="num">{fmtDate(h.game_start)} – {fmtDate(h.game_end)}</td>
                  <td className="num">{h.window_days}</td>
                  <td className="num">{h.game_days}</td>
                  <td className={`num ${h.peak_games_in_week >= 6 ? "kpi-hs-amber-strong" : ""}`}>{h.peak_games_in_week}</td>
                  <td className="num">{fmt$0(h.budget || 0)}</td>
                  <td className="num">–</td>
                  <td className="num kpi-hs-strong">{fmt$0(h.actual || 0)}</td>
                  <td className={`num ${bankAfterArr.cls} kpi-hs-strong`}>
                    {bankAfterArr.glyph} {fmt$0(Math.abs(bankAfter))}
                  </td>
                </tr>
                {employeesPending && (
                  <tr className="kpi-hs-tr-emp-skel" data-hs-emp-skel={h.game_start}>
                    <td colSpan="9">
                      <span className="kpi-skel kpi-hs-emp-skel-bar" aria-hidden="true" />
                      <span className="kpi-skel kpi-hs-emp-skel-bar" aria-hidden="true" />
                      <span className="kpi-skel kpi-hs-emp-skel-bar" aria-hidden="true" />
                      <span className="sr-only">Loading employees</span>
                    </td>
                  </tr>
                )}
                {isOpen && (employees || []).map((e, i) => {
                  const meta = workers?.[e.worker_id] || {};
                  const name = redact ? `#${e.worker_id.slice(-4)}` : (meta.name || `#${e.worker_id.slice(-4)}`);
                  const title = meta.title || "";
                  const hrs = (e.hours_regular || 0) + (e.hours_overtime || 0) + (e.hours_double_time || 0);
                  return (
                    <tr key={`${h.game_start}-${e.worker_id}-${i}`} className="kpi-hs-tr-emp" data-emp-row={h.game_start}>
                      <td className="kpi-hs-tr-emp-name">
                        {name}{title && <span className="kpi-hs-tr-emp-title"> · {title}</span>}
                        {e.salaried && <span className="kpi-hs-chip kpi-hs-chip-salary">SALARY</span>}
                      </td>
                      <td colSpan="4" className="num kpi-hs-tr-emp-meta">{fmtHrs(hrs)}</td>
                      <td className="num">{e.hours_overtime > 0 ? fmtHrs(e.hours_overtime) : "–"}</td>
                      <td className="num">–</td>
                      <td className="num" data-emp-amount>{fmt$(e.amount || 0)}</td>
                      <td className="num">
                        {e.anomaly_no_clockout > 0 && <span className="kpi-hs-chip kpi-hs-chip-amber">no clock-out</span>}
                      </td>
                    </tr>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Stand-region skeleton (warm-nav pending) ──────────────────────
// PR-2 transition stability. Mirrors the height stack of the three
// stand-region cards (StandHeader, StandDayStrip, SignalCards row) so
// the rail below does not jump when the real content lands. Uses the
// existing .kpi-skel shimmer from kpi.css; new .kpi-hs-skel-* classes
// carry heights.
function StandRegionSkeleton() {
  return (
    <div className="kpi-hs-skel" role="status" aria-live="polite" aria-busy="true" data-hs-skel>
      <span className="sr-only">Loading selected homestand</span>
      <div className="kpi-skel kpi-hs-skel-header" />
      <div className="kpi-skel kpi-hs-skel-strip" />
      <div className="kpi-hs-skel-sigs">
        <div className="kpi-skel kpi-hs-skel-sig" />
        <div className="kpi-skel kpi-hs-skel-sig" />
        <div className="kpi-skel kpi-hs-skel-sig" />
      </div>
    </div>
  );
}

// ─── The board ─────────────────────────────────────────────────────
export function HomestandBoard({
  data,
  selectedGameStart,
  onSelectStand,
  expandedGameStart,
  onToggleExpand,
  todayISO,
  redact,
  hourlyRate,
  loading = false,
  salaryAvailable = false,
  salaryOn = false,
}) {
  const homestands = data?.homestands || [];
  const bank = data?.homestand_bank || null;
  const stand = data?.homestand || null;
  const split = data?.homestand_split || null;
  // Owner ruling 2026-08-21 after PR-2 audit: a refusal must not
  // destroy navigation. Rail + season card + tabs survive; the stand
  // region alone shows the refusal message. Same rule as the
  // account-locked panel: board region is replaced, navigation stays.
  const isRefused = data?.refused === true;
  const refusalMessage = isRefused ? data?.message : null;
  // Only trust `refused` as terminal state when the fetch has settled.
  // A stale refusal from the prior selection must not linger through
  // a new stand's fetch - skeleton wins over stale amber.
  const settledRefusal = !loading && isRefused;
  // Homestand PR-2 transition-stability (Kevin audit 2026-08-21):
  // "the entire page goes blank, then returns. Sampling at 380ms after
  // a click catches three stands with no rail and no board at all."
  //
  // The blink was upstream (hasHomestandTab dropped through fetch);
  // fixed in page.js. Here we handle the follow-on: after the URL
  // moves to a new stand, `stand` still reflects the PRIOR selection
  // until the next response lands, so the stand region would show
  // stale content for ~1s. Detect the mismatch and render a skeleton
  // in the stand region only. Rail + season card + season table stay
  // mounted on the prior data - they're either fixed truth (season
  // card) or not selection-dependent (rail, table).
  //
  // Refusal is a terminal state (server ships refused:true without a
  // matching stand); it must resolve to the refusal card, not the
  // skeleton. Same for cold homestand-view browse (no ?homestand=
  // in URL): render nothing in the stand region, not a skeleton.
  // Use `settledRefusal`, not `isRefused`, so a stale refusal from
  // the previous fetch doesn't override the pending skeleton.
  const standIsPending = !settledRefusal && !!selectedGameStart && (
    loading || (stand?.game_start !== selectedGameStart)
  );
  const gameDates = useMemo(() => new Set(data?.homestand_game_dates || []), [data?.homestand_game_dates]);
  const nightGameDates = useMemo(() => new Set(data?.homestand_night_dates || []), [data?.homestand_night_dates]);

  // Employees for the selected stand come from data.actuals_range
  // (per-worker aggregates the server already produced for the
  // selected window). Owner reminder #1: with salary off, no
  // salaried worker rows are in actuals_range, so this map is
  // trivially hourly-only. When salary is on, salaried rows appear
  // exactly as they do on the period board.
  const employeesByStand = useMemo(() => {
    const m = new Map();
    if (stand && Array.isArray(data?.actuals_range)) {
      m.set(stand.game_start, data.actuals_range);
    }
    return m;
  }, [stand?.game_start, data?.actuals_range]);

  return (
    <div className="kpi-hs-board" data-view="homestand">
      <SeasonRailCard
        homestands={homestands}
        selectedGameStart={selectedGameStart}
        onSelect={onSelectStand}
      />
      <SeasonToDateCard
        bank={bank}
        homestands={homestands}
        selectedGameStart={selectedGameStart}
      />
      {standIsPending ? (
        <StandRegionSkeleton />
      ) : (
        <>
          {stand && !settledRefusal && <StandHeader stand={stand} />}
          {stand && !settledRefusal && (
            <StandDayStrip
              stand={stand}
              actualsDaily={data.actuals_daily || []}
              gameDates={gameDates}
              nightGameDates={nightGameDates}
              todayISO={todayISO}
            />
          )}
          {stand && split && !settledRefusal && (
            <SignalCards
              stand={stand}
              split={split}
              employees={employeesByStand.get(stand.game_start) || []}
              hourlyRate={hourlyRate}
              salaryAvailable={salaryAvailable}
              salaryOn={salaryOn}
            />
          )}
          {settledRefusal && (
            <div className="kpi-hs-card kpi-hs-card-refusal" role="alert" data-refusal>
              <div className="kpi-hs-eyebrow">Selected stand unavailable</div>
              <div className="kpi-hs-refusal-msg">{refusalMessage}</div>
              <div className="kpi-hs-refusal-hint">Pick another stand from the rail above.</div>
            </div>
          )}
        </>
      )}
      <SeasonTable
        homestands={homestands}
        selectedGameStart={selectedGameStart}
        expandedGameStart={expandedGameStart}
        onToggleExpand={onToggleExpand}
        onSelectStand={onSelectStand}
        employeesByStand={employeesByStand}
        workers={data?.workers}
        redact={redact}
      />
    </div>
  );
}

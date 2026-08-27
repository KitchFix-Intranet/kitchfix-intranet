"use client";
// src/app/kpi/labor/components/HomestandBoard.js
//
// PR-2 - the homestand view. Renders only when
// data.homestands?.length > 0 (four MLB accounts today per owner
// ruling 2026-08-21 - HOMESTAND_ACCOUNTS_FY2026 in homestandResolver
// carries the list + reasoning). Sits under the command bar's
// "Homestand" tab; ?view=homestand keeps a shared link on the right
// view.
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

import React, { useMemo, useState, useEffect } from "react";
import { fmt$, fmtHrs, fmtDate, standWindow } from "../lib/formatting.js";
import { DayStripPlot, aggregatePerDay, isoRange } from "./DayStrip.js";
import HelpPop from "./HelpPop.js";

function fmt$0(v) {
  return "$" + Math.round(Number(v || 0)).toLocaleString("en-US");
}
function arrow(v, goodWhenPositive = true) {
  const good = goodWhenPositive ? v >= 0 : v <= 0;
  return { glyph: v >= 0 ? "▼" : "▲", cls: good ? "kpi-hs-good" : "kpi-hs-bad" };
}

// ─── Season rail card ───────────────────────────────────────────────
// 2026-08-26 homestand redesign: Actuals | Plan toggle REMOVED per
// owner ruling. The board decides which cards to show, keyed on
// game state (see gameState() helper). Signature drops viewMode /
// onViewModeChange / actualsAvailable props.
function SeasonRailCard({ homestands, selectedGameStart, onSelect, salaryAvailable, salaryOn }) {
  const rail = useMemo(() => {
    // Scale by max spend across played stands. Pre-floor stands with
    // an estimator amount contribute; future stands still render at a
    // floor height.
    let max = 1;
    for (const h of homestands) {
      const disp = h.actual != null ? h.actual : (h.is_estimated ? (h.actual_estimated || 0) : 0);
      if (disp > max) max = disp;
      if (h.budget && h.budget > max) max = h.budget;
    }
    return { scale: max * 1.10 };
  }, [homestands]);

  return (
    <div className="kpi-hs-card kpi-hs-card-rail" role="region" aria-label="Season by homestand">
      {/* HS FB1 final polish items 1 + 2 2026-08-25:
          - "Click on a homestand to open it" helper text dropped
            (item 2) - the bars are obviously clickable, the line was
            filler.
          - .kpi-hs-card-hdr-right wraps pill + toggle so both sit as
            one right cluster with a shared auto-margin; toggle sits
            immediately left of the ? (item 2).
          - Scope pill (HOURLY ONLY / + SALARY) moves in from the HS
            spend card (item 1) - the scope applies to the whole
            board, not one stand, so its honest home is here. Left of
            the toggle. Print header keeps its own scope line (V41). */}
      <header className="kpi-hs-card-hdr">
        <span className="kpi-hs-eyebrow">Season by homestand</span>
        <span className="kpi-hs-card-hdr-right">
          {salaryAvailable && (
            // homestand-fixes round 2 item 9 (2026-08-26): "HOURLY
            // ONLY" -> "HOURLY", muted outline (kpi-hs-pill-quiet)
            // rather than filled amber/mute. Applies to both boards -
            // period-board copy mirrors this in StoryBlock.js.
            <span
              className={"kpi-hs-pill kpi-hs-pill-quiet " + (salaryOn ? "kpi-hs-pill-scope-on" : "kpi-hs-pill-scope-off")}
              aria-label={salaryOn ? "Salary included" : "Hourly labor only"}
              data-scope-pill
            >{salaryOn ? "+ SALARY" : "HOURLY"}</span>
          )}
          {/* 2026-08-26 homestand redesign: Actuals | Plan segmented
              control removed. Game-state now decides which cards
              render below - the toggle's job moved into the layout
              rules. */}
        </span>
        <HelpPop
          id="qRail"
          title="Season by homestand"
          body={<>One bar per homestand, height is what it cost. Green came in under budget, red went over.<br /><br />The navy dashed line is the original budget for that stand. Pre-floor stands (before 04/20/26) render as estimates - the hatched bar shows what the schedule predicts against known weekly totals.<br /><br />Click a stand to open its detail below. The cards there change depending on whether the stand is upcoming or already played.</>}
        />
      </header>
      <div className="kpi-hs-rail">
        {homestands.map(h => {
          const isSel = h.game_start === selectedGameStart;
          const isFuture = !h.pre_floor && h.actual == null;
          const isEstimated = h.pre_floor && h.is_estimated;
          const displayVal = h.actual != null
            ? h.actual
            : (isEstimated ? (h.actual_estimated || 0) : 0);
          const barPct = (h.pre_floor && !isEstimated)
            ? 0
            : (isFuture ? 0 : Math.min(100, (displayVal / rail.scale) * 100));
          const tickPct = h.budget != null ? Math.min(100, (h.budget / rail.scale) * 100) : null;
          const over = h.actual != null && h.budget != null && h.actual > h.budget;
          const barCls = h.pre_floor
            ? (isEstimated ? "kpi-hs-rail-bar kpi-hs-rail-bar-est" : "kpi-hs-rail-bar kpi-hs-rail-bar-pre")
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
            isEstimated ? "est" : "",
          ].filter(Boolean).join(" ");
          // Pre-floor stands with an estimate are now SELECTABLE - clicking
          // opens the plan-mode cards. Only pre-floor stands WITHOUT an
          // estimate (e.g. no low-OT stands played yet) stay disabled.
          const isDisabled = h.pre_floor && !isEstimated;
          return (
            <button
              key={h.game_start}
              type="button"
              className={cls}
              onClick={() => !isDisabled && onSelect(h.game_start)}
              disabled={isDisabled}
              data-game-start={h.game_start}
              data-pre-floor={h.pre_floor ? "true" : "false"}
              data-estimated={isEstimated ? "true" : "false"}
              title={isDisabled ? "Before daily detail starts (04/20/26) - no estimate yet" : `${h.game_start} - ${h.game_end}${isEstimated ? " (est.)" : ""}`}
            >
              <div className="kpi-hs-rail-plot">
                {tickPct != null && !h.pre_floor && (
                  <span className="kpi-hs-rail-tick" style={{ bottom: `${tickPct}%` }} />
                )}
                <span className={barCls} style={{ height: `${Math.max(barPct, 3)}%` }} />
              </div>
              <div className="kpi-hs-rail-amt">
                {isDisabled ? "–" : (isEstimated ? `~${fmt$0(displayVal)}` : (h.actual != null ? fmt$0(h.actual) : "~ plan"))}
              </div>
              <div className="kpi-hs-rail-nm">
                {opp0}<br />{fmtDate(h.game_start).slice(0, 5)}
              </div>
              {isDisabled && <div className="kpi-hs-rail-tag">no detail</div>}
              {/* HS FB1 PR-3 3a 2026-08-25: est. tag removed. Hatched bar +
                  `~` prefix on the amount already signal "estimated"; the
                  extra tag pushed pre-floor bars one visual step above
                  the played ones. */}
            </button>
          );
        })}
      </div>
      <div className="kpi-hs-rail-key">
        <span><i className="kpi-hs-key-sw kpi-hs-key-under" /> under target</span>
        <span><i className="kpi-hs-key-sw kpi-hs-key-over" /> over target</span>
        <span><i className="kpi-hs-key-sw kpi-hs-key-est" /> estimated (before 04/20)</span>
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
//
// HS FB1 PR-3 3b 2026-08-25: selected-stand outline removed (Kevin
// ruling - Chat-Claude specced it, owner does not want it), bank arrow
// dropped, bank fact reads "in the bank" (green) / "budget deficit"
// (red), and "budgeted for" -> "budget for" on the remaining line.
function SeasonToDateCard({ bank, homestands }) {
  if (!bank) return null;
  const finishedCount   = Number(bank.stands_finished || 0);
  const remainingCount  = Number(bank.stands_remaining || 0);
  // homestand-fixes round 2 item 8 (2026-08-26) + partition fix
  // 2026-08-26 (post-verify): filter to PRE-FLOOR AND is_estimated.
  //
  // Prior implementation filtered is_estimated alone and returned 3
  // on STL - MO (HS 1, HS 2 pre-floor + HS 13 future). But HS 13 is
  // also counted in bank.stands_remaining (any future stand carries
  // is_estimated per HS PR-A ruling because plan-mode surfaces the
  // forecast), so "to come" and "estimated" overlapped and the sum
  // read 14 against 13 total stands.
  //
  // Owner ruling: the three buckets answer "where is each stand in
  // its life," and life-state has to partition. Estimated is a
  // genuine state distinct from "not yet played":
  //
  //   finished    played, actuals landed
  //   to come     not yet started (may carry a forecast in plan mode)
  //   estimated   pre-floor - will NEVER have actuals, the estimate
  //               is permanent (daily detail does not go back that
  //               far, so no amount of waiting fixes them)
  //
  // A future stand's forecast is NOT a category; it is what "to
  // come" means. Filter to pre-floor so estimated names the
  // permanent-estimate state cleanly.
  const estimatedCount = (homestands || []).filter(h => h?.pre_floor === true && h?.is_estimated === true).length;
  const remainingBudget = Number(bank.remaining_budget || 0);
  const budgetToDate    = Number(bank.budget_to_date || 0);
  const seasonBudget    = budgetToDate + remainingBudget;
  const scale = seasonBudget || 1;
  const pct = v => Math.max((v / scale) * 100, 0);
  const bankVal = Number(bank.bank || 0);
  const spent = Number(bank.spent_to_date || 0);
  const bankAbs = Math.abs(bankVal);

  return (
    <div className="kpi-hs-card kpi-hs-card-season" role="region" aria-label="Season to date">
      <header className="kpi-hs-card-hdr">
        <span className="kpi-hs-eyebrow">Season to date</span>
        <span className="kpi-hs-note" data-season-rn>
          {/* item 8 - three-part count: N finished · N to come · N
              estimated. Estimated bucket is skipped when zero to
              keep the note tight on accounts without pre-floor
              stands or future estimates. */}
          {finishedCount} finished · {remainingCount} to come{estimatedCount > 0 ? ` · ${estimatedCount} estimated` : ""}
        </span>
        {/* homestand-fixes round 2 item 4 (2026-08-26): "bank"
            language dropped from every surface. Owner ruling: "bank"
            tells an operator they have money to spend; they do not,
            it is cumulative variance against target. Popover copy
            rewritten to "budget you have not spent" (plainer, and
            names what the hatch actually is). */}
        <HelpPop
          id="qSeason"
          title="Season to date"
          body={<>The solid bar is what you have spent. The green hatch is budget you have not spent - the amount you are under target so far. The grey hatch is what is still budgeted for the stands you have left.<br /><br /><b>Estimated</b> stands are before our daily detail starts, so these are worked out from the weeks around them.</>}
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
          {/* item 4 - bar label: "UNDER" / "OVER" replaces "BANK". */}
          {pct(bankAbs) > 8 ? `${bankVal >= 0 ? "UNDER " : "OVER "}${fmt$0(bankAbs)}` : ""}
        </span>
        <span className="kpi-hs-sbar-remain" style={{ width: `${pct(remainingBudget)}%` }}>
          {pct(remainingBudget) > 6 ? `${fmt$0(remainingBudget)} remaining` : ""}
        </span>
      </div>
      <div className="kpi-hs-sbar-key">
        <span><b data-key-season-budget>{fmt$0(seasonBudget)}</b> season budget</span>
        <span><b data-key-spent>{fmt$0(spent)}</b> spent · {finishedCount} stand{finishedCount === 1 ? "" : "s"}</span>
        <span className={bankVal >= 0 ? "kpi-hs-good" : "kpi-hs-bad"} data-key-bank>
          {/* item 4 - "under target so far" / "over target" replaces
              "in the bank" / "budget deficit". "over target" reads
              red per Kevin's ruling. */}
          <b>{fmt$0(bankAbs)}</b> {bankVal >= 0 ? "under target so far" : "over target"}
        </span>
        <span><b data-key-remaining>{fmt$0(remainingBudget)}</b> budget for the {remainingCount} remaining stand{remainingCount === 1 ? "" : "s"}</span>
      </div>
    </div>
  );
}

// ─── Day strip - identity variant per reminder #2 ──────────────────
// HS FB1 final polish items 3 + 12 + 13 2026-08-25:
//   12) Absorbs the former StandHeader card (Homestand N · MIA/STL ·
//       dates · window · games) as its title line. Prior render used a
//       whole card of vertical space for one text line; merging into
//       this card puts the stand name next to the days it describes.
//   13) Legend gets its own row under the title (was competing on the
//       eyebrow row alongside stand name + dates).
//    3) Leading zero-days are trimmed from the visual strip. Interior
//       and trailing zero-days stay - a dark day between games is
//       real information; leading zero-days before any labor lands
//       carry none. WINDOW IS UNCHANGED - the stand still owns those
//       days, per-stand totals still include them; this is a display
//       trim only. Card totals must be identical before/after.
function StandDayStrip({ stand, actualsDaily, gameDates, nightGameDates, todayISO, scheduleByDate, accountTimezone, otByDate }) {
  const days = useMemo(
    () => isoRange(stand.window_start, stand.window_end),
    [stand.window_start, stand.window_end],
  );
  const { perDay } = aggregatePerDay(actualsDaily, days);
  // Trim leading zero-days ONLY. Interior + trailing zero-days stay.
  // Reduce runs from index 0 until the first day with amount > 0 (or
  // a future day - future zeros are "not yet", also worth keeping so
  // an in-progress stand shows the days that have not happened yet).
  const trimmedPerDay = useMemo(() => {
    if (!perDay || perDay.length === 0) return perDay;
    let firstIdx = 0;
    while (firstIdx < perDay.length) {
      const d = perDay[firstIdx];
      const amt = (d.amountX10000 || 0) / 10000;
      const isFuture = d.workDate > todayISO;
      if (amt > 0.5 || isFuture) break;
      firstIdx++;
    }
    // All-zero past strip (edge case) - render the tail so the user
    // sees something rather than an empty card. Should not happen in
    // practice because the stand would have no signal to render.
    if (firstIdx >= perDay.length) return perDay;
    return firstIdx === 0 ? perDay : perDay.slice(firstIdx);
  }, [perDay, todayISO]);
  const opp = stand.opponents?.join(" / ") || "(no opponents)";
  return (
    <div className="kpi-hs-card kpi-hs-card-strip" role="region" aria-label="Day by day">
      {/* Stand identity line (was its own card, merged here per item 12). */}
      <div className="kpi-hs-standhdr-row">
        <span className="kpi-hs-standhdr-title">Homestand {stand.index} · {opp}</span>
        {/* homestand-fixes round 2 item 3 (2026-08-26): header renders
            the WINDOW dates (from standWindow helper), not the game
            dates. Prior state showed game_start-game_end (7 days on
            HS 8) alongside window_days (11) - internally inconsistent,
            and contradicted the command chip above (which reads
            window_start-window_end correctly). The standWindow helper
            is now the ONE source; table cells + command chip call it
            too so all three surfaces cannot drift apart again. */}
        <span className="kpi-hs-standhdr-dates">
          {(() => { const w = standWindow(stand); return `${fmtDate(w.start)} - ${fmtDate(w.end)} · ${w.days} days · ${stand.game_days} games`; })()}
        </span>
      </div>
      <header className="kpi-hs-card-hdr kpi-hs-card-hdr-strip">
        <span className="kpi-hs-eyebrow">Day by day</span>
        {/* HS FB1 PR-3 3c 2026-08-25: legend splits prep from off-day
            per Kevin ruling - hatch is reserved for pending, prep is
            confirmed spend, so prep gets its own solid identity. Four
            entries: night game, day game, prep day, off day.
            HS FB1 final polish item 13 2026-08-25: legend now lives on
            its own row via .kpi-hs-card-hdr-strip layout rules (was
            cramped alongside the stand identity line + eyebrow). */}
        <span className="kpi-hs-note kpi-hs-note-legend">
          <span className="kpi-hs-legend-sw kpi-hs-day-night" /> night game
          <span className="kpi-hs-legend-sw kpi-hs-day-day" /> day game
          <span className="kpi-hs-legend-sw kpi-hs-day-prep" /> prep day
          <span className="kpi-hs-legend-sw kpi-hs-day-off" /> off day
          {/* 2026-08-26 homestand redesign - "still to come" swatch
              added for ghost bars on upcoming stands (round-2 item 6).
              Uses the ghost-day variant (hatched fill on the day-game
              identity colour) so the legend chip visually matches the
              bar. Ghosts appear only on upcoming or part-played stands;
              the swatch stays visible on all stands for legend stability. */}
          <span className="kpi-hs-legend-sw kpi-hs-day-ghost-day" /> still to come
        </span>
      </header>
      <DayStripPlot
        perDay={trimmedPerDay}
        todayISO={todayISO}
        variant="identity"
        gameDates={gameDates}
        nightGameDates={nightGameDates}
        scheduleByDate={scheduleByDate}
        accountTimezone={accountTimezone}
        otByDate={otByDate}
        ariaLabel={`Homestand ${stand.index} day strip`}
      />
    </div>
  );
}

// ─── Five signal cards ─────────────────────────────────────────────
function GaugeBar({ ot, band }) {
  // band = [lo, hi, mid]. Position mark on 0-75% axis, band as
  // amber region, mark as navy stub.
  //
  // Owner ruling 2026-08-26 (homestand-fixes round 2, P0-1): axis
  // extended from 50% to 75%. The prior 50% ceiling meant a real
  // reading like 41% (STL - MO HS 8) or 72% (the misclassified
  // per-worker-avg reading) had nowhere to sit. Every OT norm
  // through 8+ games peaks at 43% (see OT_NORMS below), and a real
  // outlier stand can push above 50% - 75% gives the mark somewhere
  // to point on any realistic reading.
  const clamp = v => Math.max(0, Math.min(75, v));
  const bandStart = (clamp(band[0]) / 75) * 100;
  const bandWidth = ((clamp(band[1]) - clamp(band[0])) / 75) * 100;
  const markPos = (clamp(ot) / 75) * 100;
  const color = ot < band[0] ? "kpi-hs-good" : ot > band[1] ? "kpi-hs-bad" : "kpi-hs-mid";
  return (
    <div className="kpi-hs-gauge">
      <div className="kpi-hs-gauge-track" />
      <div className="kpi-hs-gauge-band" style={{ left: `${bandStart}%`, width: `${Math.max(bandWidth, 2)}%` }} />
      <div className={`kpi-hs-gauge-mark ${color}`} style={{ left: `${markPos}%` }} />
      <div className="kpi-hs-gauge-labels">
        <span>0%</span><span>25%</span><span>50%</span><span>75%</span>
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
              <HelpPop
                id="qPeak"
                title="Busiest week"
                body={<>The most game days that fall inside any single Monday-Sunday week during the stand. The 40-hour overtime clock resets Monday, so this number - not the total game count - is what drives overtime.</>}
              />
            </th>
            <th className="num">Target</th>
            <th className="num">Prep &amp; off</th>
            <th className="num">Actual</th>
            {/* item 4 - "VS TARGET" replaces "Bank after". The
                column carries per-stand variance, not a running
                balance - "bank" implied you could add the column up,
                which the numbers do not support. */}
            <th className="num">Vs target</th>
          </tr>
        </thead>
        <tbody>
          {homestands.map(h => {
            const isSel = h.game_start === selectedGameStart;
            const isOpen = h.game_start === expandedGameStart;
            const isFuture = !h.pre_floor && h.actual == null;
            if (h.pre_floor) {
              // PR #273 - pre-floor rows now render the estimator's total
              // when is_estimated. They stay excluded from the bank
              // (bank_after column reads "-") but the row is now click-
              // to-select so operators can open the plan-mode cards.
              const isEst = h.is_estimated;
              return (
                <tr
                  key={h.game_start}
                  className={`kpi-hs-tr-prefloor ${isEst ? "kpi-hs-tr-prefloor-est" : ""} ${isSel ? "kpi-hs-tr-sel" : ""}`}
                  data-game-start={h.game_start}
                  data-estimated={isEst ? "true" : "false"}
                  onClick={isEst ? () => handleRowClick(h.game_start) : undefined}
                  style={isEst ? { cursor: "pointer" } : undefined}
                >
                  <td>HS {h.index} · {h.opponents?.[0] || "(no opp)"}</td>
                  {/* HS PR-B: Window column shows WINDOW dates. The
                      forward-looking window is what owns the labor;
                      the game-only span was contradicting the Days
                      column (e.g. HS 3 game span 04/24-04/30 = 7d
                      beside Days column reading 11). */}
                  <td className="num">{(() => { const w = standWindow(h); return `${fmtDate(w.start)} – ${fmtDate(w.end)}`; })()}</td>
                  <td className="num">{h.window_days}</td>
                  <td className="num">{h.game_days}</td>
                  <td className="num">{h.peak_games_in_week}</td>
                  <td className="num">{h.budget != null ? fmt$0(h.budget) : "–"}</td>
                  {/* Pre-floor stands have no per-day actuals to split,
                      so Prep & off stays `–` here. */}
                  <td className="num">–</td>
                  <td className="num kpi-hs-strong">
                    {/* homestand-fixes round 2 item 2 (2026-08-26):
                        est. suffix removed. The ~ prefix + amber tone
                        already carry the estimated state; the extra
                        tag was redundant. Wire is positive on every
                        stand (verified via _probe_stlmo_actual_estimated_wire),
                        so the render is `~$N` positive. */}
                    {isEst ? `~${fmt$0(h.actual_estimated)}` : "–"}
                  </td>
                  <td className="num">–</td>
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
                  {/* HS PR-B: Window column shows WINDOW dates. */}
                  <td className="num">{(() => { const w = standWindow(h); return `${fmtDate(w.start)} – ${fmtDate(w.end)}`; })()}</td>
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
                  {/* HS PR-B: Window column shows WINDOW dates. */}
                  <td className="num">{(() => { const w = standWindow(h); return `${fmtDate(w.start)} – ${fmtDate(w.end)}`; })()}</td>
                  <td className="num">{h.window_days}</td>
                  <td className="num">{h.game_days}</td>
                  <td className={`num ${h.peak_games_in_week >= 6 ? "kpi-hs-amber-strong" : ""}`}>{h.peak_games_in_week}</td>
                  <td className="num">{fmt$0(h.budget || 0)}</td>
                  {/* HS PR-B: Prep & off now populates on every played
                      row. Reads from h.split, the folded per-stand
                      data foldPerStandSplits attaches server-side.
                      Absent when the split is missing or zero -
                      standing rule: a value the payload can compute
                      renders; a value that does not apply is `–`. */}
                  <td className="num">
                    {h.split && h.split.off_day_dollars > 0.005
                      ? fmt$0(h.split.off_day_dollars)
                      : "–"}
                  </td>
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
                  const name = redact ? `#${e.worker_id.slice(-4)}` : (meta.display_name || `#${e.worker_id.slice(-4)}`);
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

// ─── Plan cards for pre-floor (estimated) stand selection ──────────
// PR #273 - when a pre-floor stand is selected the server ships
// 2026-08-26 homestand redesign - drop the toggle
// ================================================
//
// Owner ruling per CC_PROMPT_HOMESTAND_REDESIGN.md: Actuals | Plan
// toggle is gone. The board decides which cards to show, keyed on
// the GAMES not the window. Three states:
//
//   games not started      -> UpcomingCards (4 cards)
//   part played            -> UpcomingCards (same 4, plus spent-to-
//                                            date on card one)
//   all games played       -> PlayedCards (4 cards)
//
// A window that opened early for prep days does NOT make a stand in
// progress - the games do. Prior gate keyed off window_start > today
// and rendered plan cards on stands whose prep had begun; that read
// as "0 spent against budget · under" on a stand that hadn't kicked
// off. Game-state key fixes it.
function gameState(stand, todayISO) {
  if (!stand?.game_start || !stand?.game_end || !todayISO) return "unknown";
  if (todayISO < stand.game_start) return "not_started";
  if (todayISO > stand.game_end)   return "all_played";
  return "part_played";
}

// Sum estimate.per_day amounts filtered by day_type. Kevin's spec
// splits "What it should cost" into night / day / prep facts; the
// per_day array carries day_type in {'night','day','prep','other'}.
function sumEstimateByDayType(estimate, dayType) {
  if (!estimate?.per_day) return 0;
  return estimate.per_day.reduce(
    (s, p) => (p.day_type === dayType ? s + Number(p.amount || 0) : s),
    0,
  );
}

// Count workers (not shifts) with any unapproved time in the stand.
// Owner ruling 2026-08-26: "a chef thinks in people, not shifts";
// copy reads "N people still need approval". Uses the same fields
// the SignalCards row used (hours_without_dollars OR anomaly_no_clockout).
function unapprovedPeopleCount(employees) {
  return (employees || []).filter(
    e => Number(e.hours_without_dollars || 0) > 0.004 || Number(e.anomaly_no_clockout || 0) > 0,
  ).length;
}
function unapprovedHoursTotal(employees) {
  return (employees || []).reduce(
    (s, e) => s + Math.max(0, Number(e.hours_without_dollars || 0)) + Number(e.anomaly_no_clockout || 0),
    0,
  );
}

// ── UpcomingCards - four cards, games-not-started OR part-played ──
//
// Card 1  "What you have"          budget hero, Spent so far + Left facts
// Card 2  "What it should cost"    plan total hero, night/day/prep + Vs budget
// Card 3  "Hours to schedule"      regular hours hero, per game day + crew
// Card 4  "Expect overtime"        expected % hero, dollar guess + norm band
//
// All figures reference the ESTIMATE (homestand_estimated + OT_NORMS).
// On part-played, card 1's "Spent so far" > 0 - naturally handled by
// data. The rest of the cards remain forward-looking; the plan is
// still what a chef schedules against for the games remaining.
function UpcomingCards({ stand, estimate, split, hourlyRate }) {
  if (!stand) return null;
  const budget = Number(stand.budget || 0);
  const spent = Number(split?.spent_to_date || 0);
  const left = Math.max(0, budget - spent);
  const planTotal = Number(estimate?.total || 0);
  const nightTotal = sumEstimateByDayType(estimate, "night");
  const dayTotal   = sumEstimateByDayType(estimate, "day");
  const prepTotal  = sumEstimateByDayType(estimate, "prep");
  const vsBudget = budget - planTotal;   // positive = plan under budget = good
  const vsArr = arrow(vsBudget, true);
  const rate = Number(hourlyRate) || 22.79;
  const regularHours = rate > 0 ? planTotal / rate : 0;
  const workingDays = (estimate?.per_day || []).filter(p => p.day_type !== "other").length;
  const perGameDayHrs = workingDays > 0 ? regularHours / workingDays : 0;
  // Crew size on an upcoming stand: no per-worker actuals to count,
  // so use the account's typical crew from recent stands. Approximate
  // as employees.length on the current homestand response - which is
  // empty on future stands. Fall back to 5 as a plausible average;
  // owner will refine if it matters. TODO(follow-up): expose
  // stand.typical_crew from server.
  const crewOfN = 5;
  const perPersonHrs = crewOfN > 0 ? perGameDayHrs / crewOfN : 0;
  const norm = OT_NORMS[Math.min(stand.peak_games_in_week, 10)] || OT_NORMS[3];
  const expectedOtPct = norm[2];
  const expectedOtDollars = planTotal * expectedOtPct / 100 * 0.5;   // half-hour OT premium

  return (
    <div className="kpi-hs-signals" role="region" aria-label="Upcoming homestand cards">
      {/* Card 1 - What you have */}
      <div className="kpi-hs-card kpi-hs-signal kpi-hs-edge-good" data-card="have">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">What you have</span>
          <HelpPop id="qUpHave" title="What you have" body={<>The budget for this homestand. Spent so far is anything already clocked in the window - usually prep-day labor before the games start. Left is what remains for the days ahead.</>} />
        </header>
        <div className="kpi-hs-hero kpi-hs-good">{fmt$0(budget)}</div>
        <div className="kpi-hs-sub">budget for this homestand</div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Spent so far</div><div className="kpi-hs-fact-v">{fmt$0(spent)}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Left</div><div className="kpi-hs-fact-v kpi-hs-good">{fmt$0(left)}</div></div>
        </div>
      </div>

      {/* Card 2 - What it should cost */}
      <div className="kpi-hs-card kpi-hs-signal" data-card="plan-cost">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">What it should cost</span>
          <HelpPop id="qUpPlan" title="What it should cost" body={<>Your own averages this season - night game / day game / prep day - applied to the games on this homestand's calendar. Compares against the budget above.</>} />
        </header>
        <div className="kpi-hs-hero">{fmt$0(planTotal)}</div>
        <div className="kpi-hs-sub">
          {stand.game_days} game{stand.game_days === 1 ? "" : "s"}
          {workingDays > stand.game_days ? ` plus ${workingDays - stand.game_days} prep day${(workingDays - stand.game_days) === 1 ? "" : "s"}` : ""}
        </div>
        <div className="kpi-hs-facts">
          {stand.night_games > 0 && <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">{stand.night_games} night game{stand.night_games === 1 ? "" : "s"}</div><div className="kpi-hs-fact-v">{fmt$0(nightTotal)}</div></div>}
          {stand.day_games > 0 && <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">{stand.day_games} day game{stand.day_games === 1 ? "" : "s"}</div><div className="kpi-hs-fact-v">{fmt$0(dayTotal)}</div></div>}
          {prepTotal > 0.5 && <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Prep day{workingDays - stand.game_days === 1 ? "" : "s"}</div><div className="kpi-hs-fact-v">{fmt$0(prepTotal)}</div></div>}
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Vs budget</div><div className={`kpi-hs-fact-v ${vsArr.cls}`}>{vsArr.glyph} {fmt$0(Math.abs(vsBudget))} {vsBudget >= 0 ? "under" : "over"}</div></div>
        </div>
        <div className="kpi-hs-covers"><b>Your own averages</b> this season, applied to the games on the calendar</div>
      </div>

      {/* Card 3 - Hours to schedule */}
      <div className="kpi-hs-card kpi-hs-signal kpi-hs-edge-blue" data-card="hrs">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">Hours to schedule</span>
          <HelpPop id="qUpHrs" title="Hours to schedule" body={<>The regular hours behind the plan. Divide across the working days for the per-day number; divide again across a crew of N for a rough per-person estimate. This is the ceiling, not the schedule - overtime + doubleheaders will move it.</>} />
        </header>
        <div className="kpi-hs-hero">{Math.round(regularHours)}<span className="kpi-hs-hero-unit">hrs</span></div>
        <div className="kpi-hs-sub">across {workingDays} working day{workingDays === 1 ? "" : "s"}</div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Per game day</div><div className="kpi-hs-fact-v">{Math.round(perGameDayHrs)} hrs</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Crew of {crewOfN}</div><div className="kpi-hs-fact-v">~{Math.round(perPersonHrs)} hrs each</div></div>
        </div>
        <div className="kpi-hs-covers"><b>At ${rate.toFixed(2)}/hr</b>, your blended rate this season</div>
      </div>

      {/* Card 4 - Expect overtime */}
      <div className="kpi-hs-card kpi-hs-signal kpi-hs-edge-amber" data-card="ot-expect">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">Expect overtime</span>
          <span className={`kpi-hs-pill kpi-hs-pill-amber`}>{stand.peak_games_in_week} in a week</span>
          <HelpPop id="qUpOT" title="Expect overtime" body={<>The 40-hour clock resets Monday, so a packed week carries overtime no matter how you schedule it. This is what stands with the same peak-week shape have run at this season.</>} />
        </header>
        <div className={`kpi-hs-hero ${expectedOtPct > 20 ? "kpi-hs-bad" : expectedOtPct > 5 ? "kpi-hs-mid" : "kpi-hs-good"}`}>~{expectedOtPct.toFixed(0)}%</div>
        <div className="kpi-hs-sub">{stand.peak_games_in_week} game{stand.peak_games_in_week === 1 ? "" : "s"} fall in one Mon-Sun week</div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Roughly</div><div className={`kpi-hs-fact-v ${expectedOtPct > 20 ? "kpi-hs-bad" : expectedOtPct > 5 ? "kpi-hs-mid" : ""}`}>{fmt$0(expectedOtDollars)}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Stands like this</div><div className="kpi-hs-fact-v">{norm[0].toFixed(0)} – {norm[1].toFixed(0)}%</div></div>
        </div>
        <div className="kpi-hs-covers"><b>The 40-hour clock resets Monday</b> - a packed week carries OT whatever you do</div>
      </div>
    </div>
  );
}

// ── PlayedCards - four cards, all-games-played ────────────────────
//
// Card 1  "What it cost"           actual hero, variance sub, budget/hours facts
//                                  + `>= $X` prefix + "N people still need
//                                  approval" note when unapproved hours exist
// Card 2  "Vs the plan"            game-day actual hero, plan sub, low/high +
//                                  accuracy % (100 - abs(plan-actual)/actual;
//                                  direction stated in words, never signed)
// Card 3  "Prep & off days"        off+prep hero, per-day + share-of-total
// Card 4  "Overtime"               actual % hero, N of M sub with plan expected
//
// Vs the plan replaces the toggle: it puts the retrospective on the
// card itself so nobody has to hold a plan number in mind while
// looking at an actual number on a different screen. Accuracy formula
// per owner: 100 - abs(plan - actual) / actual. Direction stated in
// WORDS - "$177 low" - never a signed number, because a negative
// accuracy would be meaningless to read.
function PlayedCards({ stand, split, employees, estimate, hourlyRate }) {
  if (!stand || !split) return null;
  const budget = Number(stand.budget || 0);
  const actual = Number(stand.actual || 0);
  const variance = budget - actual;
  const vArr = arrow(variance, true);
  const unapprovedHrs = unapprovedHoursTotal(employees);
  const unapprovedPeople = unapprovedPeopleCount(employees);
  const hasUnapproved = unapprovedHrs > 0.004;
  const rate = Number(hourlyRate) || 22.79;
  const willRise = hasUnapproved ? unapprovedHrs * rate : 0;

  const gameDayActual = Number(split.game_day_dollars || 0);
  const gameDayPlan = sumEstimateByDayType(estimate, "night") + sumEstimateByDayType(estimate, "day");
  const planDelta = gameDayPlan - gameDayActual;   // positive => plan was HIGH
  const planDeltaDir = Math.abs(planDelta) < 0.5 ? "on the number" : planDelta > 0 ? "high" : "low";
  const planDeltaAbs = Math.abs(planDelta);
  const accuracyPct = gameDayActual > 0 ? Math.max(0, Math.round(100 - (Math.abs(gameDayPlan - gameDayActual) / gameDayActual) * 100)) : null;

  const offPlusPrep = Number(split.off_day_dollars || 0) + Number(split.prep_day_dollars || 0);
  const offCount = Number(split.off_day_count || 0);
  const prepCount = Number(split.prep_day_count || 0);
  const nonGameDays = offCount + prepCount;
  const perOffDay = nonGameDays > 0 ? offPlusPrep / nonGameDays : 0;
  const offShare = actual > 0 ? (offPlusPrep / actual) * 100 : 0;

  const norm = OT_NORMS[Math.min(stand.peak_games_in_week, 10)] || OT_NORMS[3];
  const totalOtHrs  = employees.reduce((s, e) => s + Number(e.hours_overtime || 0), 0);
  const totalAllHrs = employees.reduce(
    (s, e) => s + Number(e.hours_regular || 0) + Number(e.hours_overtime || 0) + Number(e.hours_double_time || 0),
    0,
  );
  const actualOtPct = totalAllHrs > 0 ? (totalOtHrs / totalAllHrs) * 100 : 0;
  const otBand = actualOtPct < norm[0] ? "kpi-hs-pill-good" : actualOtPct > norm[1] ? "kpi-hs-pill-bad" : "kpi-hs-pill-amber";
  const otBandLabel = actualOtPct < norm[0] ? "Below normal" : actualOtPct > norm[1] ? "Above normal" : "Typical";
  const otCost = employees.reduce((s, e) => s + Number(e.dollars_overtime || 0), 0);
  const expectedOtPct = norm[2];

  return (
    <div className="kpi-hs-signals" role="region" aria-label="Played homestand cards">
      {/* Card 1 - What it cost */}
      <div className={`kpi-hs-card kpi-hs-signal ${variance >= 0 ? "kpi-hs-edge-good" : "kpi-hs-edge-bad"}`} data-card="cost">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">What it cost</span>
          <span className={`kpi-hs-pill ${variance >= 0 ? "kpi-hs-pill-good" : "kpi-hs-pill-bad"}`}>{variance >= 0 ? "Under" : "Over"}</span>
          <HelpPop id="qPlCost" title="What it cost" body={<>Actual hourly labor for the stand's window, against the budget from your season plan. Under is green; over is red.<br /><br /><b>If unapproved hours exist,</b> the hero shows a `&ge; $X` prefix. Approving those hours may grow the number.</>} />
        </header>
        <div className={`kpi-hs-hero ${variance < 0 ? "kpi-hs-bad" : ""}`}>{hasUnapproved ? `≥ ${fmt$0(actual)}` : fmt$0(actual)}</div>
        <div className={`kpi-hs-sub ${variance >= 0 ? "kpi-hs-good" : "kpi-hs-bad"}`}>
          <b>{vArr.glyph} {fmt$0(Math.abs(variance))} {variance >= 0 ? "under" : "over"} budget</b>
        </div>
        {hasUnapproved && (
          <div className="kpi-hs-action-line" data-approvals-note>
            {unapprovedPeople} {unapprovedPeople === 1 ? "person" : "people"} still need approval (~{fmt$0(willRise)})
          </div>
        )}
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Budget</div><div className="kpi-hs-fact-v">{fmt$0(budget)}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Hours</div><div className="kpi-hs-fact-v">{totalAllHrs.toFixed(1)}</div></div>
        </div>
      </div>

      {/* Card 2 - Vs the plan (replaces the toggle) */}
      <div className="kpi-hs-card kpi-hs-signal" data-card="vs-plan">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">Vs the plan</span>
          {accuracyPct != null && <span className={`kpi-hs-pill ${accuracyPct >= 90 ? "kpi-hs-pill-good" : accuracyPct >= 75 ? "kpi-hs-pill-amber" : "kpi-hs-pill-bad"}`}>{accuracyPct >= 90 ? "Close" : accuracyPct >= 75 ? "Off" : "Way off"}</span>}
          <HelpPop id="qPlVs" title="Vs the plan" body={<>Game-day spend against what the plan predicted for those same games. <b>Accuracy</b> is 100 percent minus the absolute error divided by the actual - the higher the better. Direction is stated in words (low or high) rather than as a signed number.</>} />
        </header>
        <div className="kpi-hs-hero">{fmt$0(gameDayActual)}</div>
        <div className="kpi-hs-sub">the plan said <b>{fmt$0(gameDayPlan)}</b></div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Plan was</div><div className="kpi-hs-fact-v">{planDeltaDir === "on the number" ? "on the number" : `${fmt$0(planDeltaAbs)} ${planDeltaDir}`}</div></div>
          {accuracyPct != null && <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Accuracy</div><div className={`kpi-hs-fact-v ${accuracyPct >= 90 ? "kpi-hs-good" : accuracyPct >= 75 ? "kpi-hs-mid" : "kpi-hs-bad"}`}>{accuracyPct}%</div></div>}
        </div>
        <div className="kpi-hs-covers">Game-day spend against what the model predicted</div>
      </div>

      {/* Card 3 - Prep & off days */}
      <div className="kpi-hs-card kpi-hs-signal kpi-hs-edge-blue" data-card="prep-off">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">Prep &amp; off days</span>
          <HelpPop id="qPlPrep" title="Prep & off days" body={<>Labor on days outside the games - prep the day before openers, cleanup the day after closers, and any off day inside the window. These are stand-related costs even though nobody was at the ballpark.</>} />
        </header>
        <div className="kpi-hs-hero">{fmt$0(offPlusPrep)}</div>
        <div className="kpi-hs-sub">on {nonGameDays} day{nonGameDays === 1 ? "" : "s"} outside game days</div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Per off day</div><div className="kpi-hs-fact-v">{nonGameDays > 0 ? fmt$0(perOffDay) : "—"}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Share</div><div className="kpi-hs-fact-v">{actual > 0 ? `${offShare.toFixed(0)}%` : "—"}</div></div>
        </div>
      </div>

      {/* Card 4 - Overtime (actual, with plan expected for context) */}
      <div className="kpi-hs-card kpi-hs-signal kpi-hs-edge-amber" data-card="ot">
        <header className="kpi-hs-card-hdr">
          <span className="kpi-hs-eyebrow">Overtime</span>
          <span className={`kpi-hs-pill ${otBand}`}>{otBandLabel}</span>
          <HelpPop id="qPlOT" title="Overtime" body={<>Actual overtime as a share of all hours worked. The plan expected roughly the norm shown below.<br /><br /><b>Sum-over-sum</b>: total OT hours divided by total hours across the crew. A per-worker-avg formula inflates whenever a subset carries the OT (the reason this reading was 72% pre-fix on a stand that ran 41%).</>} />
        </header>
        <div className={`kpi-hs-hero ${actualOtPct < norm[0] ? "kpi-hs-good" : actualOtPct > norm[1] ? "kpi-hs-bad" : "kpi-hs-mid"}`}>{actualOtPct.toFixed(1)}%</div>
        <div className="kpi-hs-sub">
          <b>{totalOtHrs.toFixed(1)}</b> of <b>{totalAllHrs.toFixed(1)}</b> hours · plan expected <b>~{expectedOtPct.toFixed(0)}%</b>
        </div>
        <div className="kpi-hs-facts">
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">OT cost</div><div className={`kpi-hs-fact-v ${actualOtPct > 20 ? "kpi-hs-bad" : actualOtPct > 5 ? "kpi-hs-mid" : ""}`}>{fmt$0(otCost)}</div></div>
          <div className="kpi-hs-fact"><div className="kpi-hs-fact-k">Stands like this</div><div className="kpi-hs-fact-v">{norm[0].toFixed(0)} – {norm[1].toFixed(0)}%</div></div>
        </div>
      </div>
    </div>
  );
}

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
  // 2026-08-26 homestand redesign - per-day schedule map for the
  // strip captions (opponent + first pitch on upcoming days; opponent
  // + OT % on played days). data.homestand_schedule is scoped to the
  // selected stand's window and only carries GAME days (day_type
  // === "GAME"); prep/off days are absent.
  const scheduleByDate = useMemo(() => {
    const m = new Map();
    for (const r of (data?.homestand_schedule || [])) m.set(r.date, r);
    return m;
  }, [data?.homestand_schedule]);
  // Account timezone: NO fallback to UTC. Owner ruling 2026-08-26 -
  // "a wrong first pitch is worse than no first pitch"; if timezone is
  // null the caption drops the time and shows opponent only.
  const accountTimezone = useMemo(() => {
    const acct = (data?.accounts_directory || []).find(a => a.team_key === data?.account);
    return acct?.timezone || null;
  }, [data?.accounts_directory, data?.account]);
  // Per-day OT hours aggregate so the played-day caption can render
  // `91% OT`. Sum-over-sum, not mean-of-means - matches PlayedCards.
  // hours_regular + hours_overtime are per-worker per-day; sum both
  // over each work_date and take hours_ot / hours_all as the day's OT %.
  const otByDate = useMemo(() => {
    const m = new Map();
    for (const r of (data?.actuals_daily || [])) {
      const key = r.work_date;
      const cur = m.get(key) || { hours_ot: 0, hours_all: 0 };
      const reg = Number(r.hours_regular || 0);
      const ot  = Number(r.hours_overtime || 0);
      cur.hours_ot  += ot;
      cur.hours_all += reg + ot;
      m.set(key, cur);
    }
    return m;
  }, [data?.actuals_daily]);

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

  // HS FB1 PR-4 2026-08-25: Actuals | Plan view mode. Derives the
  // NATURAL default per Kevin's spec ("Default: Actuals on played
  // stands, Plan on unplayed") from the same signal the pre-toggle
  // planMode used. actualsAvailable is the same predicate flipped -
  // true on played stands, false on pre-floor / future / not-yet-
  // played. When the selected stand changes, the mode SNAPS to that
  // stand's natural default (an operator picking an unplayed stand
  // gets Plan even if they were on Actuals for the previous one).
  // 2026-08-26 homestand redesign: viewMode toggle removed. Board
  // keys off game-state, not window-state. See gameState() helper.
  const gs = gameState(stand, todayISO);
  const showPlayed = gs === "all_played" && !!split;

  return (
    <div className="kpi-hs-board" data-view="homestand">
      {/* HS FB1 PR-1 (owner ruling 2026-08-24, defect 1d): season
          summary reads first, then the per-stand rail. */}
      <SeasonToDateCard bank={bank} homestands={homestands} />
      <SeasonRailCard
        homestands={homestands}
        selectedGameStart={selectedGameStart}
        onSelect={onSelectStand}
        salaryAvailable={salaryAvailable}
        salaryOn={salaryOn}
      />
      {standIsPending ? (
        <StandRegionSkeleton />
      ) : (
        <>
          {/* HS PR-A (owner ruling 2026-08-24): plan mode keys off
              game_start > today, NOT window_start > today. A window
              opening a few prep days early does not make a stand
              "in progress" - the games do. Chef opening HS 12 today
              wants THE PLAN, not "$0 spent against budget · under".
              One derived boolean gates PlanCards + SignalCards so
              the two cannot drift. */}
          {/* HS FB1 final polish item 12 2026-08-25: <StandHeader />
              deleted - its content (stand identity line: opponents +
              dates + window + game count) merged into StandDayStrip.
              Plan mode does not render the day strip, so it does not
              get the identity line; Plan mode's plan-1 eyebrow reads
              "HS N budget" and already carries stand index as
              context - full opponents / dates / games are implicit
              since the plan runs per-stand. If Plan mode also wants
              the identity line, add it inside PlanCards as a parallel
              merge (not done here). */}
          {(() => {
            if (!stand || settledRefusal) return null;
            // 2026-08-26 homestand redesign: game-state selection.
            // Day strip always renders (with schedule captions in a
            // follow-up commit). Card layout switches on game-state:
            //   all_played   -> PlayedCards (four cards including
            //                   Vs the plan; the retrospective is on
            //                   the card so no toggle needed)
            //   else         -> UpcomingCards (four cards, forward-
            //                   looking; part-played adds spent-so-far
            //                   naturally via split.spent_to_date)
            return (
              <>
                <StandDayStrip
                  stand={stand}
                  actualsDaily={data.actuals_daily || []}
                  gameDates={gameDates}
                  nightGameDates={nightGameDates}
                  todayISO={todayISO}
                  scheduleByDate={scheduleByDate}
                  accountTimezone={accountTimezone}
                  otByDate={otByDate}
                />
                {showPlayed ? (
                  <PlayedCards
                    stand={stand}
                    split={split}
                    employees={employeesByStand.get(stand.game_start) || []}
                    estimate={data?.homestand_estimated}
                    hourlyRate={hourlyRate}
                  />
                ) : (
                  <UpcomingCards
                    stand={stand}
                    estimate={data?.homestand_estimated}
                    split={split}
                    hourlyRate={hourlyRate}
                  />
                )}
              </>
            );
          })()}
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

"use client";
// src/app/kpi/labor/components/StoryBlock.js
//
// V21 board simplification (V21-5..V21-10, V21-13). Left panel is the
// spend card: header (period + dates + verdict pill) / equal-height
// split block (spent | left-to-spend | under | over | muted dash) /
// budget footer. Right panel is the week strip; Tier A carries a
// single continuous target line and amber running / navy allowance
// treatment. Tier B and Tier C are untouched.

import { useRef, useState } from "react";
import { fmt$, fmtHrs, fmtDate } from "../lib/formatting.js";
import { estimateUnpricedDollars } from "@/lib/labor/estimateUnpricedDollars";
import HelpPop from "./HelpPop.js";
import Arrow from "./Arrow.js";

// PR-E - "Your budget for this period" and "Week by week" popovers
// per kitchfix-help-copy.html (section "Period board · other regions").
// Bodies kept out-of-render so the spend card + week header stay
// readable.
const BUDGET_CARD_BODY = (
  <>
    The hourly labor budget for these four weeks, from the FY2026 plan. <b>Spent so far</b> is what has actually been paid.
    <br /><br />
    <b>Left to spend</b> is the difference - the money still available for the weeks remaining.
    <br /><br />
    With the salary toggle on, this includes salaried staff. With it off, hourly only. The pill beside the status tells you which.
    <span className="kpi-hs-pop-foot">Most periods&apos; budgets come from the P&amp;L; a few use an envelope allocation set at the region level. The number is the same shape either way, but the source can matter if you are comparing figures with finance.</span>
  </>
);

const WEEK_BY_WEEK_BODY = (
  <>
    One bar per week. Bar height is what that week cost.
    <br /><br />
    <b>The reference line is that week&apos;s budget</b> - what your labour target buys at the week&apos;s revenue. <b>Amber dashed</b> for weeks with confirmed counts. <b>Grey dashed with a `plan` tag</b> for weeks still on projected counts. When counts confirm mid-week the number moves - the tile is deliberate about which state it is on.
    <br /><br />
    <b>Hatched means the number will grow.</b> Hours are clocked but not yet priced by Rippling, so that bar is not final.
    <span className="kpi-hs-pop-foot">A grey stub means nobody worked that day - genuinely zero, not missing.</span>
  </>
);
import { classifyTier } from "@/lib/kpi/classifyTier";
import { periodsInBoardWeeks } from "../lib/signalCardModels.js";

// PR-B - MM/DD/YY from ISO for the "range closed through DATE"
// suffix. Same convention signalCardModels.js uses.
function fmtMMDDYY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return "";
  return `${m}/${d}/${y.slice(2)}`;
}

// Audit close 2026-08-24 - subtract one UTC day from an ISO date.
// Used to derive "last closed week's end" (Sunday) from an
// in-progress week's start (Monday). Never render bare "range
// closed" - always name the through date.
function isoMinusDay(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// Verdict pill in the SpendCard header. One source of truth.
// Kevin post-1057 sweep item 1 (2026-09-08): pill copy names the
// TARGET, not the budget. "Over target" / "On target" reads with
// the percent-first body, and mirrors the Overview cost card's
// language directly. Prior copy ("OVER BUDGET", "ON TRACK") talked
// about the dollar comparison; the panel is now a percent-first
// board and the pill has to match. "watch" (0.5-3% over) stays as
// an amber "Watch" pill - a real distinction Kevin ruled worth
// keeping (post-1051 sweep item 2).
function verdictDisplay(verdict) {
  if (verdict === "on_track") return { label: "On target", cls: "good" };
  if (verdict === "watch")    return { label: "Watch", cls: "warn" };
  if (verdict === "over")     return { label: "Over target", cls: "bad" };
  // Kevin CC prompt 2026-09-10 item 2. `under` fires on closed +
  // multi-period ranges when pacePctPoints <= 0 - the definitive
  // "under target" answer that closed ranges now render instead of
  // "on_track" / "Watch". Green pill (under-budget is favourable).
  if (verdict === "under")    return { label: "Under target", cls: "good" };
  return null;
}

// ── Spend card (V21-5..V21-9 + V29-5..V29-6) ─────────────────────
// V29-6: BUDGET LEADS. Order is eyebrow -> BUDGET hero card -> paired
// (Spent so far | Left to spend). Budget is the dominant figure; spent
// and left are secondary. Closed periods keep the under/over treatment
// on the right cell of the pair.
function SpendCard({ board, eyebrowLabel, dateRange, salary, salaryAvailable, isFutureRange, awaiting = null }) {
  const kind = board?.kind;
  // Kevin Labor PR-A items 1 + 6 + 8 (2026-09-04):
  //
  // Item 1 (both closed ranges) + Item 8 (This year excludes running
  // period): on multi-period ranges that span a running period, the
  // hero shows CLOSED-only spent - the same P1-P8 figures the
  // Overview counts. On single closed periods (Last period), the
  // range IS the closed subset. On single running periods (This
  // period), the running week rule (item 6 PR-B) applies - not
  // this PR's scope.
  //
  // R-77 fix: the comparison target is the ADJUSTED budget (batr) -
  // what the target percent buys at the revenue actually earned -
  // NOT the raw dollar budget. Shared batr helper on the payload
  // enforces the R-77 invariant by construction. See
  // src/lib/kpi/shared/batr.js.
  //
  // Kevin ruling: "right number, wrong surface. A site lead reading
  // the board today still sees the wrong figure."
  const isMultiWithClosedSubset = kind === "multi_period"
    && board?.closed_range_budget != null
    && board?.closed_spent_to_date != null;
  // Actual: closed-only for multi-with-running, otherwise the range
  // total. On a closed single period, spent_to_date IS the closed
  // period sum.
  const spent = isMultiWithClosedSubset
    ? board.closed_spent_to_date
    : (board?.spent_to_date ?? 0);
  // Kevin walkthrough sweep item 2 (2026-09-07). Precedence:
  //   1. Range-level batr (board.budget_at_this_revenue) - authoritative
  //      when defined. Uses P&L verified revenue across the whole range,
  //      including periods pre-SC-seeding where per-week SC-derived
  //      batr is zero.
  //   2. Sum of per-week batr - correct for single-period ranges where
  //      P&L has not verified yet (TBJ - FL P9 open period).
  //   3. Raw range_budget - final fallback with the label rewritten
  //      to plain "Budget" so nothing lies about adjustment.
  //
  // Kevin measured live: TBJ - FL This year sum of per-week batr =
  // $244,787.71 (misses P1-P4 pre-SC-seeding) vs range-level batr
  // $305,312 (covers all periods). Range-level is right on multi-
  // period; earlier walkthrough PR-A picked per-week first and drew
  // the wrong number. Order flipped now.
  //
  // For multi-period ranges spanning a running period, the per-week
  // fallback restricts to CLOSED weeks (matches R-63); range-level
  // batr already does this internally via periodsClosedBefore().
  const budget = (() => {
    // Preferred: range-level batr from the resolver (whole-range,
    // P&L-driven, closed-only for multi-with-running).
    if (board?.budget_at_this_revenue != null) return board.budget_at_this_revenue;

    // Fallback: sum of per-week batr for single-period ranges where
    // P&L is not yet verified but SC data is present.
    const weeks = board?.weeks || [];
    if (weeks.length > 0) {
      const filter = isMultiWithClosedSubset
        ? (w => w.revenue_basis_temporal === "closed" || w.state === "closed")
        : (() => true);
      const eligible = weeks.filter(filter);
      const anyWithBatr = eligible.some(w => w.budget_at_this_week_revenue != null);
      if (anyWithBatr) {
        const sum = eligible.reduce((s, w) => s + (w.budget_at_this_week_revenue != null ? Number(w.budget_at_this_week_revenue) : 0), 0);
        return Math.round(sum * 100) / 100;
      }
    }
    // Final fallback: raw range_budget. Label flips to plain "Budget".
    return board?.period_budget || board?.range_budget || null;
  })();
  // Was the comparison built from the adjusted per-week or range-level
  // figures, or did it fall through to raw? Label follows.
  const budgetIsAdjusted = (() => {
    if (budget == null) return false;
    if (board?.budget_at_this_revenue != null) return true;
    const weeks = board?.weeks || [];
    if (weeks.some(w => w.budget_at_this_week_revenue != null)) return true;
    return false;
  })();
  // Variance is spent - budget on whatever the current pair reads.
  // When budget = batr (R-77 target), variance = spent - batr which
  // matches the Overview's per-line dollar variance operand. Falls
  // back to board.variance only when budget is null (no comparison
  // possible either way).
  const variance = (spent != null && budget != null)
    ? Math.round((spent - budget) * 100) / 100
    : (board?.variance ?? null);
  const noBudget = !budget || kind === "no_budget";
  const isPeriod = kind === "single_period_in_progress" || kind === "single_period_closed";

  // V29-5 verdict pill: STATE WORD ONLY. Owner ruling 2026-08-24: a
  // future range (`isFutureRange`, server flag `is_future_range` at
  // start > today) suppresses the verdict pill entirely - there is
  // no verdict on a range that hasn't happened. Straddling ranges
  // (start <= today <= end) keep their pill because they ARE in
  // progress and the verdict is honest.
  //
  // Kevin post-1057 sweep item 3 (2026-09-08): This period on day 1
  // has no revenue earned, so labour-as-percent-of-revenue can't be
  // computed. Pill reads "Nothing earned yet" (neutral) instead of
  // an on/off-target verdict against a comparison that doesn't
  // exist. Detected via total_revenue_for_batr = null. Overrides
  // the server verdict for this case only.
  const revenueEarnedForPanel = (typeof board?.total_revenue_for_batr === "number" && board.total_revenue_for_batr > 0)
    ? board.total_revenue_for_batr
    : null;
  const noRevenueYet = revenueEarnedForPanel == null;
  const vd = isFutureRange
    ? null
    : noRevenueYet
      ? { label: "Nothing earned yet", cls: "neu" }
      : verdictDisplay(board?.verdict);

  // Left-cell (Spent so far) sub. Always the % of budget. On a
  // future range the sub reads "this range has not started" in muted
  // grey so 0% of budget does not read as an achievement.
  const spentPct = budget > 0 ? Math.round((spent / budget) * 100) : null;

  // Right-cell state (V29-6). In-progress -> Left to spend (navy tint);
  // closed/multi with variance -> Under/Over budget; no-budget -> muted.
  const right = (() => {
    if (noBudget) {
      const reason = kind === "no_budget"
        ? "no budget"
        : board?.reason === "envelope" ? "envelope-based" : "no budget";
      return { variantCls: "kpi-spend-cell-mute", label: reason, value: "—", sub: "" };
    }
    if (kind === "single_period_in_progress") {
      const left = Math.max(0, (budget || 0) - spent);
      const denom = (board?.in_progress_week_start ? 1 : 0) + (board?.not_started_weeks_count || 0);
      return {
        variantCls: "kpi-spend-cell-nav",
        label: "Left to spend",
        value: fmt$(left),
        sub: `${denom} week${denom === 1 ? "" : "s"} remaining`,
      };
    }
    // Closed period or multi-period range with a resolved budget.
    // Kevin post-1051 sweep item 2 (2026-09-08): card label must
    // agree with pill state. Prior code said "Over budget" for any
    // variance > 0.5 - but a WATCH pill (0.5-3% over) with a card
    // saying "OVER BUDGET" reads as two different verdicts. Read
    // board.verdict directly so pill + card come from the same
    // owner (attachBatrToBoard); server-side verdict already uses
    // the same panel figure per item 1.
    const verdict = board?.verdict;
    if (verdict === "over") {
      return {
        variantCls: "kpi-spend-cell-over",
        label: "Over budget",
        value: variance != null ? fmt$(Math.abs(variance)) : "—",
        sub: "vs budget",
      };
    }
    if (verdict === "watch") {
      // Watch is real (0.5-3% over). Say what it means: the exact
      // percent over. Amber tone (existing kpi-spend-cell-over
      // colour reads red; keep the over class for variance colouring
      // but the label names the state).
      const pctOver = (variance != null && budget > 0)
        ? Math.round((variance / budget) * 1000) / 10  // 1 decimal
        : null;
      return {
        variantCls: "kpi-spend-cell-over",
        label: pctOver != null ? `${pctOver}% over` : "Watch",
        value: variance != null ? fmt$(Math.abs(variance)) : "—",
        sub: "vs budget",
      };
    }
    return {
      variantCls: "kpi-spend-cell-under",
      label: "Under budget",
      value: variance != null ? fmt$(Math.abs(variance)) : "—",
      sub: "vs budget",
    };
  })();

  // V29-6 budget-card sub line. V29-14: `period closed` becomes `range
  // closed` on non-period ranges. V37-4 - append `· envelope` or
  // `· pnl` when board.budget_basis names one.
  //
  // PR-B (owner ruling 2026-08-24) - two edits on the in-progress /
  // closed-range branches:
  //   1. "43% of period gone" flips to "57% of period remains"
  //      COMPUTED as (100 - elapsedPct), not the same number with a
  //      new label. Owner's specific warning: "That is the kind of
  //      change that looks done and is wrong."
  //   2. "range closed" (multi_period fully closed) gains "through
  //      MM/DD/YY" using board.range_end_iso. Multi_period with a
  //      running week keeps the current "range closed" for now
  //      (owner did not address it in this pass; will surface if
  //      wrong on prod).
  const budgetSub = (() => {
    if (noBudget) return "no budget for this range";
    const prefix = isPeriod ? "FY2026 budget" : "FY2026 range budget";
    let core;
    if (kind === "single_period_in_progress") {
      const p = board?.elapsed_pct;
      const remaining = p != null ? Math.max(0, Math.round(100 - p)) : null;
      core = `${prefix} · ${remaining != null ? `${remaining}% of period remains` : ""}`;
    } else if (isPeriod) {
      core = `${prefix} · period closed`;
    } else {
      // multi_period: always name a date. Owner ruling 2026-08-24
      // (audit close): FYTD shipped bare "range closed" because a
      // running week is present and the fully-closed branch didn't
      // fire. The bare string surfaced on prod - owner rule "never
      // render a bare range closed". Fix: when a running week is in
      // the range, the "through" date is the last CLOSED week's end
      // (Sunday before the in-progress Monday). Otherwise (range is
      // fully closed) it's range_end_iso as before. "Closed" already
      // means "up to here", so the date makes it MORE informative
      // rather than less accurate.
      const inProgressWeekStart = board?.in_progress_week_start;
      const rangeEnd = board?.range_end_iso;
      const throughISO = inProgressWeekStart
        ? isoMinusDay(inProgressWeekStart)
        : rangeEnd;
      core = throughISO
        ? `${prefix} · range closed through ${fmtMMDDYY(throughISO)}`
        : `${prefix} · range closed`;
    }
    // Salary PR 3 C2 - when salary is on, the sub-line names the
    // combined basis so the reader knows the budget hero includes
    // 3100.2 not just 3100.1. Overrides the envelope/pnl basis word
    // - a merged budget is neither; the basis is the composition.
    if (salary) return `${core} · hourly + salary`;
    // 2026-08-26 polish round 2 item 4 - the bare "· pnl" token was
    // opaque as a first read (owner: "a bare lowercase token on the
    // first card an operator reads"). Moved into the budget card's ?
    // popover; a real distinction but not first-card real estate. The
    // salary sub-line above still names its own composition because
    // that IS a first-read concern.
    return core;
  })();

  return (
    <div className="kpi-spend">
      {/* Header row: period + dates + verdict pill (V29-5: state word)
          + scope pill (Homestand PR-2 audit 2026-08-21). Scope pill
          moved off the command-bar title into the first card, beside
          the on-track / over-budget pill, at the card's pill scale.
          Renders whenever the caller can toggle salary (regardless of
          on/off state), so a printed / screenshotted board always
          states which pool of workers it counted. */}
      <div className="kpi-spend-h">
        <div className="kpi-spend-h-left">
          <span className="kpi-spend-h-title">{eyebrowLabel}</span>
          {dateRange && <span className="kpi-spend-h-dates">{dateRange}</span>}
        </div>
        <div className="kpi-spend-h-right">
          {vd && (
            <span className={`kpi-vpill kpi-vpill-${vd.cls}`}>
              <span className="kpi-vpill-dot" aria-hidden="true" />
              {vd.label}
            </span>
          )}
          {/* Kevin CC prompt 2026-09-10 item 1. Awaiting-verification
              amber pill beside the verdict pill on Current year -
              matches the Overview's status-line pattern
              (StatusLine.js). Renders only when the parent passes
              awaiting != null (Current year, and R-93 says the just-
              closed period has not yet settled). Same helper +
              same close-date derivation (period_end + 8 days) so
              the two boards cannot disagree. */}
          {awaiting?.period_no != null && awaiting.settle_iso && (() => {
            const [, mo, da] = awaiting.settle_iso.split("-");
            const copy = `P${awaiting.period_no} AWAITING VERIFICATION · CLOSES ${Number(mo)}/${Number(da)}`;
            return (
              <span
                className="kpi-vpill kpi-vpill-awaiting-period"
                data-vpill-awaiting-period
                aria-label={`Period ${awaiting.period_no} awaiting verification, closes ${Number(mo)}/${Number(da)}`}
              >
                <span className="kpi-vpill-dot" aria-hidden="true" />
                {copy}
              </span>
            );
          })()}
          {/* Labor unapproved-hours fix (Kevin 2026-09-07). Verdict
              qualification pill. Kevin acceptance: "a period with
              unapproved hours never renders an unqualified verdict".
              Data: sum draft_hours across board.weeks in the range +
              count of weeks with any draft_hours (the "N open weeks"
              side of Kevin's phrasing "the open week and its size").
              Only fires when verdict exists (skips future ranges,
              nothing to approve).
              Copy grammar: singular vs plural on both dimensions.
              Muted outline pill - not a warning colour per Kevin
              ("nothing is wrong, the week is simply not settled"). */}
          {vd && (() => {
            const weeks = board?.weeks || [];
            const openWeeks = weeks.filter(w => Number(w.draft_hours || 0) > 0.004).length;
            const totalDraft = weeks.reduce((s, w) => s + Number(w.draft_hours || 0), 0);
            if (openWeeks === 0 || totalDraft < 0.004) return null;
            const hrsLabel = totalDraft >= 100 ? totalDraft.toFixed(0) : totalDraft.toFixed(1);
            const wkLabel = openWeeks === 1 ? "1 WK" : `${openWeeks} WKS`;
            return (
              <span
                className="kpi-vpill kpi-vpill-awaiting"
                aria-label={`${totalDraft.toFixed(1)} hours across ${openWeeks} week${openWeeks === 1 ? "" : "s"} awaiting site-lead approval`}
                data-vpill-awaiting
              >
                AWAITING · {wkLabel} · {hrsLabel} HRS
              </span>
            );
          })()}
          {salaryAvailable && (
            // homestand-fixes round 2 item 9 (2026-08-26): "HOURLY
            // ONLY" -> "HOURLY" (shorter, less crowding beside the
            // date). Scope pill also switches to a MUTED OUTLINE
            // (kpi-vpill-scope-quiet) rather than a filled bordered
            // pill - verdict pill stays loud, scope becomes context.
            // Measured before: HOURLY ONLY was 93px against a 97px
            // date, and two filled pills competed for attention.
            // Applies to both boards - homestand copy mirrors this.
            <span
              className={"kpi-vpill kpi-vpill-scope kpi-vpill-scope-quiet " + (salary ? "kpi-vpill-scope-on" : "kpi-vpill-scope-off")}
              aria-label={salary ? "Salary included" : "Hourly labor only"}
              data-scope-pill
            >{salary ? "+ SALARY" : "HOURLY"}</span>
          )}
          <HelpPop id="qBudgetCard" title="Your budget for this period" body={BUDGET_CARD_BODY} />
        </div>
      </div>

      {/* Kevin post-1057 sweep item 1 + 3 (2026-09-08). Panel reads
          percent-first, same grammar as the Overview's cost card.
          Render of record: docs/renders/labor-panel-percent-first.html.
          Actual row (big % + small $) over Target row (smaller,
          muted) over foot with dollar variance + arrow.
          Item 3: when no revenue has been earned yet (This period
          day 1), keep dollars and add the "No percentage yet" copy
          block. Computing % against a full-period basis would read
          4.8% on TBJ - FL P10 - looks like a triumph. Not that. */}
      {(() => {
        if (noBudget) {
          return (
            <>
              <div className="kpi-spend-pf-row">
                <span className="k">{isPeriod ? "Spent in Period" : "Actual · to date"}</span>
                <span className="v num">{fmt$(spent)}</span>
              </div>
              <div className="kpi-spend-pf-rule" />
              <div className="kpi-spend-pf-row ref">
                <span className="k">Budget</span>
                <span className="v num" style={{ color: "var(--text-subtle)" }}>—</span>
              </div>
              <div className="kpi-spend-pf-nodata">
                <b>{kind === "no_budget" ? "No budget for this range." : "Envelope-based - no fixed budget."}</b>
              </div>
            </>
          );
        }
        const weeks = board?.weeks || [];
        // Revenue basis for the actual %. board.total_revenue_for_batr
        // is set by attachBatrToBoard = sum of per-period revenue from
        // the Overview picker (closed periods only). Null on This
        // period (no closed periods in range). actPct null in that
        // case - card falls to "No percentage yet".
        const revenueEarned = (typeof board?.total_revenue_for_batr === "number") ? board.total_revenue_for_batr : null;
        // Target % denominator on TP falls to the forecast total so
        // the tile can carry a legitimate "% target" figure - render
        // of record's tgtPct=33.29 on TBJ - FL P10.
        const rangeRevenueForTgt = revenueEarned != null && revenueEarned > 0
          ? revenueEarned
          : (() => {
              const s = weeks.reduce((acc, w) => acc + (w.week_revenue != null ? Number(w.week_revenue) : 0), 0);
              return s > 0 ? s : null;
            })();
        const actPct = (revenueEarned != null && revenueEarned > 0 && spent != null)
          ? (Number(spent) / revenueEarned) * 100 : null;
        const tgtPct = (rangeRevenueForTgt != null && budget != null && budget > 0)
          ? (Number(budget) / rangeRevenueForTgt) * 100 : null;
        const over = variance != null && variance > 0.005;
        const under = variance != null && variance < -0.005;
        const signCls = over ? "over" : under ? "under" : "";
        const arrow = over ? "▲" : under ? "▼" : "";
        if (actPct != null && !isFutureRange) {
          // Kevin post-1061 sweep (2026-09-09). Dollars-first (R-91
          // supersedes R-89). Amount is hero, percent sits beside as
          // small text - both figures in the verdict colour on the
          // Actual row. Same order as the Overview cost + margin
          // cards; the two boards now read identically. Only the two
          // hero-row string orders flip; the footer, pill, week
          // cards and table stay as #1060 shipped them. Render of
          // record: docs/renders/labor-panel-dollars-first.html.
          return (
            <>
              <div className="kpi-spend-pf-row">
                <span className="k">Actual</span>
                <span className={`v num ${signCls}`}>
                  {fmt$(spent)}
                  <small>{actPct.toFixed(1)}%</small>
                </span>
              </div>
              <div className="kpi-spend-pf-rule" />
              <div className="kpi-spend-pf-row ref">
                <span className="k">Target</span>
                <span className="v num">
                  {fmt$(budget)}
                  {tgtPct != null && <small>{tgtPct.toFixed(1)}%</small>}
                </span>
              </div>
              <div className="kpi-spend-pf-foot">
                <span className="k">{over ? "Over target" : under ? "Under target" : "On target"}</span>
                <span className={`v ${signCls}`}>
                  {arrow ? `${arrow} ` : ""}{fmt$(Math.abs(variance || 0))}
                </span>
              </div>
            </>
          );
        }
        // No revenue yet (TP day 1) OR future range. Dollars + copy.
        const spentUsedPct = (budget != null && budget > 0 && spent != null)
          ? (Number(spent) / Number(budget)) * 100 : null;
        return (
          <>
            <div className="kpi-spend-pf-row">
              <span className="k">Spent so far</span>
              <span className="v num">{fmt$(spent)}</span>
            </div>
            <div className="kpi-spend-pf-rule" />
            <div className="kpi-spend-pf-row ref">
              <span className="k">Budget</span>
              <span className="v num">
                {fmt$(budget)}
                {tgtPct != null && <small>{tgtPct.toFixed(1)}% target</small>}
              </span>
            </div>
            <div className="kpi-spend-pf-nodata">
              {isFutureRange
                ? <><b>Range has not started.</b> No spend, no revenue, nothing to be a percent of.</>
                : <>
                    <b>No percentage yet.</b> Labour as a percent of revenue needs revenue, and no week of this period has closed.
                    {spentUsedPct != null && <> <b>{spentUsedPct.toFixed(1)}% of the budget used.</b></>}
                  </>
              }
            </div>
          </>
        );
      })()}

      {/* Salary PR 3 C3 - salary vacancy line. States the arithmetic;
          never guesses the cause (spec is explicit: "under budget can
          be an unfilled role, a mid-period departure, or a role filled
          below budget - the board cannot tell them apart"). Three
          shapes: at-budget (== budget), under-budget (< budget),
          over-budget (> budget). Roles-filled clause omitted here -
          we do not carry a budgeted-headcount on the wire, and
          salary_summary.workers is filled count only. */}
      {salary && salary.vacancy && (() => {
        const rows = salary.vacancy.filter(v => v.budget > 0 || v.actual > 0);
        if (rows.length === 0) return null;
        const budgetSum = rows.reduce((s, v) => s + Number(v.budget || 0), 0);
        const actualSum = rows.reduce((s, v) => s + Number(v.actual || 0), 0);
        if (budgetSum <= 0 && actualSum <= 0) return null;
        const pct = budgetSum > 0 ? Math.round((actualSum / budgetSum) * 100) : null;
        const cls = actualSum > budgetSum ? "kpi-spend-salary-over"
                  : Math.abs(actualSum - budgetSum) < 0.5 ? "kpi-spend-salary-at"
                  : "kpi-spend-salary-under";
        return (
          <div className={`kpi-spend-salary ${cls}`}>
            salary <b>{fmt$(actualSum)}</b> of <b>{fmt$(budgetSum)}</b>
            {pct != null && <> · {pct}%</>}
          </div>
        );
      })()}
    </div>
  );
}

// ── TIER A: per-week columns with captions ────────────────────────
// Labor PR-B (Kevin 2026-09-07) - per-week revenue basis + adjusted
// budget per week. Rewritten to consume board.weeks[i].revenue_basis
// + budget_at_this_week_revenue when set (the PR-B payload) and fall
// back to the pre-PR-B period-split target lines when unset (safety
// for boards whose route doesn't run the weekly loader yet).
//
// Item 4 - reference line reads that week's own budget, not a
// quarter of the period plan. Confirmed weeks: amber dashed at
// budget_at_this_week_revenue. Forecast weeks: grey dashed at the
// same field (based on projected revenue), with a `plan` tag on the
// caption so the reader knows the number will move.
//
// Item 6 (R-80) - the running week caption renders as a fraction
// (`$X of $Y · Z% used · N days left`), not a variance. Its budget
// covers days not yet worked; an over/under against it is false.
//
// Kevin ruling: `forecast` must read as provisional, not just a
// source label. Grounded in TBJ - FL P9 W2 flip ($13,167 forecast to
// $21,876 confirmed - a chef who scheduled to the forecast was 60%
// short). The tile carries the warning; no separate banner.
function TierAWeekBar({ w, weeklyOriginal, weeklyAllowance, scale, rate }) {
  const isNotStarted = w.state === "not_started";
  const isInProgress = w.state === "in_progress";
  const isClosed = w.state === "closed";
  // PR-B basis-aware temporal state. Falls back to w.state when the
  // per-week loader hasn't attached fields (mixed-mode safety).
  const basisTemporal = w.revenue_basis_temporal
    || (isClosed ? "closed" : isInProgress ? "running" : "future");
  const isRunning = basisTemporal === "running";
  const isFuture = basisTemporal === "future";
  // Walkthrough item 3 (2026-09-07): three basis states now.
  const isForecast = w.revenue_basis === "forecast";
  const isPartial = w.revenue_basis === "partial";
  const value = isNotStarted
    ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
    : (w.spent || 0);
  const isZero = !isNotStarted && (!value || value <= 0.5);
  const barPct = isNotStarted ? 0 : Math.max(0, Math.min(100, (value / scale) * 90));
  // Kevin post-1055 sweep item 4 (2026-09-08). Closed-week bar fill
  // colour is derived from the ADJUSTED variance (spent - per-week
  // batr) so the fill matches the sign of its own caption. #1055
  // fixed the caption but left the fill on w.delta_sign, which is
  // the RAW basis (spent - original_target). Reproducer TBJ - FL
  // Last period: bar fill red, caption green "under $2,940.90" -
  // three weeks in a row.
  const closedAdjBudget = w.budget_at_this_week_revenue;
  const closedAdjSign = (isClosed && closedAdjBudget != null && w.spent != null)
    ? ((Number(w.spent) - Number(closedAdjBudget)) > 0.005 ? "over" : "under")
    : w.delta_sign;
  const barCls = isInProgress
    ? "kpi-wb-bar kpi-wb-bar-prog"
    : isClosed
      ? `kpi-wb-bar ${closedAdjSign === "over" ? "kpi-wb-bar-over" : "kpi-wb-bar-under"}`
      : "";
  // V42 REVISED (C2) - hatched cap. Estimated dollars for hours with
  // no covering pay-segment yet - "this bar will grow when payroll
  // processes those hours." Signal is unpriced_hrs (aggregate of
  // hours_without_dollars), NOT draft_hours: priced drafts are
  // already in the solid bar, so capping by draft_hours would
  // double-count. Owner correction 2026-08-20 after TXR - AZ 08/10
  // measurement (173.93 draft hrs, 0.00 unpriced, $3,430.45 priced).
  //
  // Cap renders on any week where unpriced_hrs > 0, closed or in
  // progress. Reuses existing kpi-wb-bar-prog (45deg amber gradient) -
  // no new pattern, no new colour token. Clamp: total (bar + cap)
  // cannot exceed plot; cap gets at least 0.5% so it never scales
  // to zero when it is real.
  const capDollars = estimateUnpricedDollars(w.unpriced_hrs, rate);
  const capPctRaw = capDollars != null ? (capDollars / scale) * 90 : 0;
  const capHeadroom = Math.max(0, 90 - barPct);
  const capPct = capDollars != null
    ? Math.max(0.5, Math.min(capHeadroom, capPctRaw))
    : 0;
  // Labor unapproved-hours fix (Kevin 2026-09-07). Grey hatched slice
  // sitting WITHIN the solid bar to name the priced-but-not-approved
  // portion of this week's spend. Kevin: "86.88 hours at $21.58 is
  // roughly $1,875 - nearly double the $986 the period is under by. A
  // chef who reads ON TRACK on Monday, approves the weekend, and comes
  // back to a different verdict will stop believing the board."
  //
  // Dollar math: draft_hours * rate. Slice height = barPct * (unapp $
  // / spent $). Bar's total height unchanged - the slice OVERLAYS the
  // top portion of the solid bar within the same height envelope,
  // rather than adding to it (that's what the amber cap does for
  // unpriced hours).
  //
  // Only fires on closed/in-progress weeks with real spend AND real
  // draft_hours. Zero-spend and future weeks skip.
  const draftHrs = Number(w.draft_hours || 0);
  const unappDollars = (!isZero && !isNotStarted && draftHrs > 0.004 && rate)
    ? draftHrs * Number(rate)
    : 0;
  const unappRatio = (unappDollars > 0 && value > 0.5)
    ? Math.min(1, unappDollars / value)
    : 0;
  const unappPct = unappRatio > 0 ? barPct * unappRatio : 0;
  const approvedPct = unappRatio > 0 ? barPct - unappPct : 0;
  // PR-C hatch gap fix (owner ruling 2026-08-24). When a cap is
  // present, remove the bar's rounded top so bar + cap merge cleanly.
  // Prior state: both elements carried `border-radius: 4px 4px 0 0`;
  // the bar's rounded top curved down at the corners while the cap's
  // flat bottom left a triangular gap. `.kpi-wb-bar-capped` overrides
  // border-radius to 0 so the pair reads as one column.
  //
  // Extended for the unapproved slice: when a slice sits within the
  // bar, the bar's top-rounded corners are hidden by the slice's flat
  // bottom, so the corners visually disappear regardless. We still
  // apply -capped so the slice's rounded top is what the reader sees
  // (no double-round competing).
  const hasOverlay = capPct > 0 || unappPct > 0;
  const barClsFinal = (barCls && hasOverlay) ? `${barCls} kpi-wb-bar-capped` : barCls;
  // Labor PR-B item 4 - reference line reads this week's own budget
  // (budget_at_this_week_revenue = week_revenue × line_target_pct),
  // not a quarter of the period plan. The line is styled per basis:
  // amber dashed for confirmed weeks, grey dashed for forecast weeks
  // (with a `plan` tag on the caption to name the projection).
  //
  // Fallback: when the loader has not attached the per-week batr
  // (older routes, salaried-only accounts where applies=false, weeks
  // outside FY2026), keep the pre-PR-B target: amber original for
  // closed/in-progress, blue allowance for not-started. Same shape,
  // familiar look on legacy code paths.
  const perWeekAdjusted = w.budget_at_this_week_revenue;
  const perWeekLegacy = isNotStarted
    ? (w.weekly_allowance ?? weeklyAllowance)
    : (w.original_target ?? weeklyOriginal);
  const perWeekTarget = perWeekAdjusted != null ? perWeekAdjusted : perWeekLegacy;
  // Kevin walkthrough follow-up (2026-09-07): running-week target
  // line was suppressed on zero-spend weeks (Monday morning of a
  // new period) via the `!isZero` gate. V29-14's original rule
  // hid the line so an empty week did not "read as broken"; that
  // rule now inverts. Kevin: "the budget exists whether or not
  // anything has been spent against it, and an empty bar with a
  // line above it is precisely the useful picture on Monday
  // morning." Every week gets its line whenever the budget is
  // defined, including zero-spend weeks.
  const targetPct = (perWeekTarget != null && perWeekTarget > 0)
    ? Math.max(0, Math.min(100, (perWeekTarget / scale) * 90))
    : null;
  // Walkthrough item 3 - target line styling per basis:
  //   confirmed  amber dashed (default)
  //   partial    amber dashed (day count on caption tells the story)
  //   forecast   grey dashed
  const targetCls = (perWeekAdjusted != null && isForecast)
    ? "kpi-wb-target kpi-wb-target-forecast"
    : (perWeekAdjusted != null)
      ? "kpi-wb-target"
      : (isNotStarted ? "kpi-wb-target kpi-wb-target-blue" : "kpi-wb-target");

  // V42 REVISED - `≥` prefix on the caption fires when the bar will
  // grow (unpriced money signal), not when there are drafts.
  const hasUnpriced = (w.unpriced_hrs || 0) > 0.004;
  // Labor PR-B item 4 - future forecast weeks display the WEEK's
  // ADJUSTED BUDGET (grey dashed reference above the baseline stub),
  // not the weekly_allowance carry-over. When rendered, the caption
  // reads that budget - the reader's next question after "this week
  // has no spend yet" is "what's it planning against?".
  const captionValueRaw = (isNotStarted && perWeekAdjusted != null)
    ? perWeekAdjusted
    : value;
  const captionValue = hasUnpriced ? `≥ ${fmt$(captionValueRaw)}` : fmt$(captionValueRaw);
  let statusLine;
  if (isRunning && perWeekAdjusted != null && value > 0.5) {
    // Labor PR-B item 6 (R-80) - running week reads as a fraction,
    // never a variance. Its budget covers days not yet worked, so an
    // over/under against it is false. Kevin's example format:
    //   $3,933 of $4,217 · 93% used · 2 days left
    //
    // Kevin walkthrough item 4a (2026-09-07): the fraction only fires
    // when spend exists. Prior gate rendered "$0.00 of $5,431.54 · 0%
    // used · 7 days left" on day one - noise on a week that reads like
    // any other not-started week. The `value > 0.5` guard drops the
    // fraction until real spend lands; the caption then falls through
    // to the `isRunning && !fraction` branch below which shows the
    // week's budget as its plan.
    const spent = value;
    const bud = perWeekAdjusted;
    const pct = bud > 0 ? Math.round((spent / bud) * 100) : null;
    const daysLeft = w.days_left_in_week;
    const parts = [`${fmt$(spent)} of ${fmt$(bud)}`];
    if (pct != null) parts.push(`${pct}% used`);
    if (daysLeft != null) parts.push(`${daysLeft} day${daysLeft === 1 ? "" : "s"} left`);
    statusLine = <span className={`kpi-wb-d kpi-wb-d-frac`}>{parts.join(" · ")}</span>;
  } else if (isRunning && perWeekAdjusted != null) {
    // Walkthrough item 4a fall-through - running week with zero spend
    // reads like a not-started week. The bar draws the baseline stub
    // (already handled by `isZero` above) and the caption names the
    // per-week budget as the plan.
    const daysLeft = w.days_left_in_week;
    statusLine = <span className="kpi-wb-d kpi-wb-d-mute">
      week started · {daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "budget covers the whole week"}
    </span>;
  } else if (isClosed && perWeekAdjusted != null && w.spent != null) {
    // Kevin post-1053 sweep item 1 (2026-09-08). Bar caption now
    // uses the ADJUSTED per-week budget, not the raw
    // period-budget/4 in w.delta_vs_original. Prior code: bar said
    // "▲ OVER $672.87" (raw) while the week card said "▼ under
    // $2,940.90" (adjusted) - same spend, opposite verdicts. Kevin's
    // rule: "the over-or-under is the total labour spend against the
    // adjusted budget. That logic carries across the bar graph, the
    // week-by-week detail under it, and into the table."
    const spentN = Number(w.spent);
    const budN = Number(perWeekAdjusted);
    const delta = Math.round((spentN - budN) * 100) / 100;
    const sign = delta < -0.005 ? "under" : delta > 0.005 ? "over" : "flat";
    const dir = sign === "under" ? "down" : sign === "over" ? "up" : "flat";
    const cls = sign === "under" ? "kpi-wb-d-good" : sign === "over" ? "kpi-wb-d-bad" : "kpi-wb-d-mute";
    statusLine = <span className={`kpi-wb-d ${cls}`}><Arrow dir={dir} />{fmt$(Math.abs(delta))} {sign}</span>;
  } else if (isClosed && w.delta_vs_original != null) {
    // Legacy fallback - fires when the per-week batr loader has not
    // attached (older routes, salaried-only boards). Reads the raw
    // basis so the caption still renders something.
    const dir = w.delta_sign === "under" ? "down" : w.delta_sign === "over" ? "up" : "flat";
    const cls = w.delta_sign === "under" ? "kpi-wb-d-good" : w.delta_sign === "over" ? "kpi-wb-d-bad" : "kpi-wb-d-mute";
    statusLine = <span className={`kpi-wb-d ${cls}`}><Arrow dir={dir} />{fmt$(Math.abs(w.delta_vs_original))} {w.delta_sign}</span>;
  } else if (isInProgress) {
    // Legacy in_progress path - fires when the per-week loader has
    // not attached basis (older routes / boards). Keeps the pre-PR-B
    // "running · $X budget" caption. When basis IS attached, the
    // R-80 fraction branch above wins.
    const perWeekBudget = w.original_target ?? weeklyOriginal;
    const draftHrs = Number(w.draft_hours || 0);
    if (draftHrs > 0.004) {
      statusLine = <span className="kpi-wb-d kpi-wb-d-warn">running · <b>{fmtHrs(draftHrs)}</b>{" "}hrs not yet approved</span>;
    } else if (perWeekBudget != null) {
      statusLine = <span className="kpi-wb-d kpi-wb-d-warn">running · <b>{fmt$(perWeekBudget)}</b>{" "}budget</span>;
    } else {
      statusLine = <span className="kpi-wb-d kpi-wb-d-warn">running</span>;
    }
  } else if (isFuture && perWeekAdjusted != null) {
    // Labor PR-B item 5 - future weeks (temporal=future) name their
    // reference as "plan". The caption number IS the plan, so the
    // status line just carries the descriptor. Distinct from a closed
    // forecast week (data gap - has spend, needs the variance rule).
    statusLine = <span className="kpi-wb-d kpi-wb-d-mute">plan for the week</span>;
  } else if (isNotStarted) {
    statusLine = <span className="kpi-wb-d kpi-wb-d-mute">to stay on budget</span>;
  }
  const captionCls = ((isNotStarted && perWeekAdjusted == null) || (isNotStarted && isFuture && perWeekAdjusted != null))
    ? "kpi-wb-cap-value kpi-wb-cap-roll"
    : "kpi-wb-cap-value";
  return (
    <div className="kpi-wb">
      <div className="kpi-wb-plot">
        {targetPct != null && (
          <span className={targetCls} style={{ bottom: `${targetPct}%` }} />
        )}
        {isNotStarted || isZero ? (
          <div className="kpi-wb-basel" />
        ) : (
          <div className={barClsFinal} style={{ height: `${Math.max(barPct, 2)}%` }} />
        )}
        {/* V42 REVISED - hatched cap. Sits ON TOP of the solid bar,
            visually stacked via `bottom` position. Hatch is unique
            to this element after the PR-B render fix; the in-progress
            bar itself is now solid amber, so the legend reads true:
            hatched means exactly one thing (not costed yet).
            v43-1 language sweep: "pending" replaced with "not costed
            yet" - owner ruling 2026-08-26, "pending" was doing double
            duty for both approval-state and cost-state and that
            ambiguity produced the entire Approvals-card investigation. */}
        {capPct > 0 && (
          <div
            className="kpi-wb-bar kpi-wb-cap-est"
            style={{ height: `${capPct}%`, bottom: `${barPct}%` }}
            title={capDollars != null ? `Estimated ~${fmt$(capDollars)} not costed yet` : undefined}
            aria-label="not costed yet, estimated"
          />
        )}
        {/* Labor unapproved-hours fix (Kevin 2026-09-07). Grey hatched
            slice within the solid bar, positioned at the top of the
            bar's height envelope. Kevin acceptance: "the hatched portion
            of a week bar equals that week's unapproved share of its own
            spend" - unappPct is barPct * (unappDollars / spent), so the
            visual ratio exactly matches the dollar ratio.
            Title carries the number so a hover on any bar surfaces the
            dollars-at-stake without a second click. */}
        {unappPct > 0 && (
          <div
            className="kpi-wb-bar kpi-wb-slice-unapp"
            style={{ height: `${unappPct}%`, bottom: `${approvedPct}%` }}
            title={`${draftHrs.toFixed(1)} hrs awaiting approval · ~${fmt$(unappDollars)}`}
            aria-label={`${draftHrs.toFixed(1)} hours awaiting approval, roughly ${fmt$(unappDollars)}`}
          />
        )}
      </div>
      <div className={`kpi-wb-cap${(isForecast || isPartial) ? " kpi-wb-cap-forecast" : ""}`}>
        <b className={captionCls}>
          {captionValue}
          {/* Labor PR-B item 5 - `plan` tag on the budget number for
              forecast weeks. Two contexts fire it:
                1. Future forecast week - caption value IS the budget.
                2. Closed/running forecast week with a data gap - caption
                   value is the spent, but the reference line above the
                   bar is the plan, so the tag names the reference the
                   reader will next fixate on.
              The tag is the visible warning Kevin asked for; without it
              the operator cannot tell a $21,876 confirmed number apart
              from a $13,167 forecast one. */}
          {isForecast && perWeekAdjusted != null && isFuture && (
            <span className="kpi-wb-plan-tag" aria-label="Projected from forecast counts">plan</span>
          )}
        </b>
        <span className="kpi-wb-dates">
          {fmtDate(w.week_start)} – {fmtDate(w.week_end)}
          {isInProgress ? " · in progress" : ""}
          {/* Walkthrough item 3 - partial state names the confirmed
              share explicitly. "3 of 13 services confirmed · budget
              will move" tells the reader why the number is
              provisional without leaning on the forecast label alone. */}
          {isPartial && w.total_services > 0 && (
            ` · ${w.confirmed_services} of ${w.total_services} services confirmed · budget will move`
          )}
          {isForecast && !isFuture && !isPartial && " · forecast, will move as counts confirm"}
          {isForecast && isFuture && !isInProgress && " · projected"}
        </span>
        {statusLine}
      </div>
    </div>
  );
}

function TierAStrip({ board, salary }) {
  const weeks = board?.weeks || [];
  const weeklyOriginal = board?.weekly_original_target;
  const weeklyAllowance = board?.weekly_allowance;
  // V42 REVISED - rate for the hatched cap. Same source the Payroll
  // Data card reads (SignalCards.js) so bar + card cannot disagree.
  const rate = salary?.blended_rate_hourly ?? board?.avg_rate ?? null;
  // Shared scale across the strip so both target lines and every bar
  // reference the same plot band. V42: include the hatched cap in
  // the scale so a large cap does not clip the bar it sits on top of.
  const scale = (() => {
    let max = 1;
    for (const w of weeks) {
      const v = w.state === "not_started"
        ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
        : (w.spent || 0);
      // PR-B - the per-week adjusted budget (batr) is the reference
      // line for the bar. Include it in the scale so the dashed line
      // never clips off the top on a forecast week whose projected
      // revenue produces a batr above weekly_original_target.
      const perWeekAdj = w.budget_at_this_week_revenue;
      const perWeekLegacy = w.state === "not_started"
        ? (w.weekly_allowance ?? weeklyAllowance ?? 0)
        : (w.original_target ?? weeklyOriginal ?? 0);
      const t = perWeekAdj != null ? perWeekAdj : perWeekLegacy;
      const cap = estimateUnpricedDollars(w.unpriced_hrs, rate) || 0;
      const local = Math.max(v + cap, t || 0);
      if (local > max) max = local;
    }
    if (weeklyOriginal) max = Math.max(max, weeklyOriginal);
    if (weeklyAllowance) max = Math.max(max, weeklyAllowance);
    return max * 1.10;
  })();

  return (
    <div
      className="kpi-wbars"
      style={{ gridTemplateColumns: `repeat(${Math.max(1, weeks.length)}, minmax(0, 1fr))` }}
    >
      {weeks.map(w => (
        <TierAWeekBar
          key={w.week_start}
          w={w}
          weeklyOriginal={weeklyOriginal}
          weeklyAllowance={weeklyAllowance}
          scale={scale}
          rate={rate}
        />
      ))}
    </div>
  );
}

// ── WEEK RAIL: the cards under the bars (Kevin PR-B walkthrough 2026-09-07) ─
// The render at docs/renders/labor-this-period-weekly-budget.html
// specified a card per week; the board only shipped a caption on
// each bar. Kevin: "This is the piece that makes the board a
// planning tool rather than a report. A chef opening Monday sees
// `schedule to $3,981` for next week - a real number from counts
// their client already gave them."
//
// Each tile does three different jobs depending on state:
//   ahead   -> "schedule to $X" - the number a chef staffs against
//   running -> "N% used" + "M days left" sub-line
//   closed  -> "▲ $X over" or "▼ $X under" vs the week's OWN budget
//
// Treatment per basis (walkthrough item 3):
//   confirmed  solid border
//   partial    solid, muted (subtle grey wash)
//   forecast   dashed grey border + `plan` tag on the budget number
//
// Revenue row copy per basis:
//   confirmed  "Confirmed revenue"
//   partial    "Confirmed + forecast"
//   forecast   "Forecast revenue"
//
// Weeks with no budget_at_this_week_revenue (loader didn't run,
// older route, salaried-only account) get a muted "budget unavailable"
// tile rather than a skipped position - the rail stays 4-wide so the
// eye can trace bar to tile.
function WeekRail({ board }) {
  const weeks = board?.weeks || [];
  if (weeks.length === 0) return null;

  return (
    <div className="kpi-wrail" role="list" aria-label="Week detail tiles">
      {weeks.map(w => {
        const basis = w.revenue_basis || "forecast";
        const temporal = w.revenue_basis_temporal
          || (w.state === "closed" ? "closed" : w.state === "in_progress" ? "running" : "future");
        const spent = w.spent != null ? Number(w.spent) : null;
        const budget = w.budget_at_this_week_revenue != null ? Number(w.budget_at_this_week_revenue) : null;
        const revenue = w.week_revenue != null ? Number(w.week_revenue) : null;

        // State pill copy (top-right). Temporal takes precedence for
        // closed/running so a chef sees the actionable state; ahead
        // weeks show basis so the chef sees whether the number is
        // real or projected.
        const stateLabel = temporal === "closed"
          ? "closed"
          : temporal === "running"
            ? "running"
            : basis; // ahead -> confirmed | partial | forecast

        // Revenue row label per basis + derivation. Kevin post-1056
        // sweep (2026-09-08): verified periods derive week revenue by
        // distributing the finance-posted period total across weeks
        // by Service Calendar shape. Chef needs to see that the
        // number is derived, not measured, so the row label + a sub-
        // caption + a hover tooltip all name the source.
        const isDerivedFromPnl = w.week_revenue_derivation === "pnl_distributed_by_sc";
        const revLabel = isDerivedFromPnl
          ? "Verified revenue"
          : basis === "confirmed"
            ? "Confirmed revenue"
            : basis === "partial"
              ? "Confirmed + forecast"
              : "Forecast revenue";
        const derivedTooltip = isDerivedFromPnl
          ? "Finance-posted period total, distributed by Service Calendar weekly shape. Derived, not measured - unlike closed-awaiting weeks whose revenue is the SC count itself."
          : null;

        // Verdict/schedule/fraction line per temporal.
        const hasSpent = spent != null && spent > 0.5;
        const ok = hasSpent && budget != null && spent <= budget;
        const over = hasSpent && budget != null && spent > budget;

        let vdCls = "kpi-wrail-vd";
        let vdText = "";
        let subText = null;

        if (temporal === "future" || (temporal === "running" && !hasSpent)) {
          // Ahead (or running with no spend yet - walkthrough item 4a
          // fall-through). Show the number to staff against.
          vdCls += " kpi-wrail-vd-plan";
          vdText = budget != null ? `schedule to ${fmt$(budget)}` : "budget unavailable";
          if (temporal === "running") {
            const daysLeft = w.days_left_in_week;
            subText = daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : null;
          }
        } else if (temporal === "running") {
          // Running with real spend - R-80 fraction (no over/under).
          vdCls += " kpi-wrail-vd-run";
          const pct = budget != null && budget > 0 ? Math.round((spent / budget) * 100) : null;
          vdText = pct != null ? `${pct}% used` : fmt$(spent);
          const daysLeft = w.days_left_in_week;
          subText = daysLeft != null
            ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left · budget covers the whole week`
            : null;
        } else {
          // Closed week - over or under against its OWN budget.
          if (budget == null || !hasSpent) {
            vdCls += " kpi-wrail-vd-plan";
            vdText = hasSpent ? fmt$(spent) : "no spend";
          } else if (over) {
            vdCls += " kpi-wrail-vd-bad";
            vdText = `▲ ${fmt$(spent - budget)}`;
          } else {
            vdCls += " kpi-wrail-vd-good";
            vdText = `▼ ${fmt$(budget - spent)}`;
          }
        }

        // Verdict for the left-border tint (temporal + spent).
        const verdictAttr = temporal === "running"
          ? "running"
          : (temporal === "closed" && hasSpent && budget != null)
            ? (over ? "over" : "under")
            : null;

        // Partial-tile sub caption: "N of M services confirmed"
        // (walkthrough item 3). Sits beneath the verdict line as a
        // secondary caption so a chef sees WHY the budget is
        // provisional at a glance.
        let partialSub = null;
        if (basis === "partial" && w.total_services > 0) {
          partialSub = `${w.confirmed_services} of ${w.total_services} services confirmed · budget will move`;
        }
        // Kevin post-1057 sweep item 4 (2026-09-08). Week cards read
        // the same language as the panel above them - percent where
        // a percentage exists, dollars where it does not. Closed +
        // running weeks with revenue carry an actual %/target %
        // sub-caption; the ▲/▼ dollar variance stays the primary
        // verdict line.
        let pctSub = null;
        if (revenue != null && revenue > 0 && spent != null && budget != null && budget > 0) {
          const actP = (Number(spent) / Number(revenue)) * 100;
          const tgtP = (Number(budget) / Number(revenue)) * 100;
          pctSub = `${actP.toFixed(1)}% actual · ${tgtP.toFixed(1)}% target`;
        }

        return (
          <div
            key={w.week_start}
            className="kpi-wrail-tile"
            role="listitem"
            data-basis={basis}
            data-temporal={temporal}
            {...(verdictAttr ? { "data-verdict": verdictAttr } : {})}
            {...(isDerivedFromPnl ? { "data-derived": "pnl_distributed_by_sc" } : {})}
          >
            <div className="kpi-wrail-head">
              <div>
                <div className="kpi-wrail-n">{`Wk of ${fmtDate(w.week_start)}`}</div>
                <div className="kpi-wrail-dt">{fmtDate(w.week_start)} – {fmtDate(w.week_end)}</div>
              </div>
              <span className="kpi-wrail-st" {...(isDerivedFromPnl ? { title: derivedTooltip } : {})}>{isDerivedFromPnl ? "verified" : stateLabel}</span>
            </div>
            <div className="kpi-wrail-row" {...(isDerivedFromPnl ? { title: derivedTooltip } : {})}>
              <span className="kpi-wrail-row-k">{revLabel}</span>
              <span className="kpi-wrail-row-v">{revenue != null ? fmt$(revenue) : "—"}</span>
            </div>
            <div className="kpi-wrail-row">
              <span className="kpi-wrail-row-k">Budget</span>
              <span className="kpi-wrail-row-v">
                {budget != null ? fmt$(budget) : "—"}
                {basis === "forecast" && budget != null && (
                  <span className="kpi-wrail-plan-tag" aria-label="Projected budget">plan</span>
                )}
              </span>
            </div>
            <div className="kpi-wrail-row">
              <span className="kpi-wrail-row-k">Spent</span>
              <span className={`kpi-wrail-row-v${spent == null ? " kpi-wrail-row-v-mute" : ""}`}>
                {spent != null ? fmt$(spent) : "—"}
              </span>
            </div>
            <div className={vdCls}>{vdText}</div>
            {subText && <div className="kpi-wrail-sub">{subText}</div>}
            {partialSub && <div className="kpi-wrail-sub">{partialSub}</div>}
            {pctSub && <div className="kpi-wrail-sub">{pctSub}</div>}
            {isDerivedFromPnl && (
              <div className="kpi-wrail-sub" title={derivedTooltip}>
                distributed by SC shape · derived, not measured
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── TIER B: 7-13 weeks, one row of compact bars (untouched V21-10) ─
function TierBStrip({ board }) {
  const weeks = board?.weeks || [];
  const [tip, setTip] = useState(null);
  const rootRef = useRef(null);

  const values = weeks.map(w => {
    const actual = w.spent || 0;
    const budget = w.original_target ?? 0;
    return { w, actual, budget };
  });
  const maxScale = Math.max(...values.map(v => Math.max(v.actual, v.budget || 0)), 1) * 1.12;

  const stepPath = (() => {
    if (!values.some(v => v.budget)) return null;
    const n = values.length;
    const stepW = 100 / n;
    let d = "";
    values.forEach((v, i) => {
      const y = v.budget ? 100 - (v.budget / maxScale) * 100 : 100;
      const x0 = i * stepW;
      const x1 = (i + 1) * stepW;
      d += (i === 0 ? `M${x0} ${y}` : ` L${x0} ${y}`) + ` L${x1} ${y}`;
    });
    return d;
  })();

  return (
    <div className="kpi-stripB" ref={rootRef}>
      <div className="kpi-plotB">
        {values.map((v) => {
          const isProg = v.w.state === "in_progress";
          const isClosed = v.w.state === "closed";
          const over = isClosed && v.budget > 0 && v.actual > v.budget;
          const cls = isProg
            ? "kpi-bB kpi-bB-prog"
            : over
              ? "kpi-bB kpi-bB-over"
              : "kpi-bB kpi-bB-under";
          const h = Math.max(0.5, (v.actual / maxScale) * 100);
          return (
            <button
              key={v.w.week_start}
              type="button"
              className={cls}
              style={{ height: `${h}%` }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const parent = rootRef.current?.getBoundingClientRect();
                if (!parent) return;
                setTip({
                  left: rect.left - parent.left + rect.width / 2,
                  top: rect.top - parent.top - 8,
                  actual: v.actual,
                  budget: v.budget,
                  week: v.w,
                });
              }}
              onMouseLeave={() => setTip(null)}
              onFocus={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const parent = rootRef.current?.getBoundingClientRect();
                if (!parent) return;
                setTip({ left: rect.left - parent.left + rect.width / 2, top: rect.top - parent.top - 8, actual: v.actual, budget: v.budget, week: v.w });
              }}
              onBlur={() => setTip(null)}
              aria-label={`Week of ${fmtDate(v.w.week_start)}: ${fmt$(v.actual)}`}
            />
          );
        })}
        {stepPath && (
          <svg className="kpi-stripB-line" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden="true">
            <path d={stepPath} fill="none" stroke="var(--amber-600)" strokeWidth="1.4" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <div className="kpi-axisB" aria-hidden="true">
        {values.map((v, i) => (
          <span key={v.w.week_start}>{i % 2 === 0 ? fmtDate(v.w.week_start).slice(0, 5) : ""}</span>
        ))}
      </div>
      {tip && <TierBTip tip={tip} />}
    </div>
  );
}

function TierBTip({ tip }) {
  const { actual, budget, week } = tip;
  const isClosed = week.state === "closed";
  const isProg = week.state === "in_progress";
  const delta = budget ? actual - budget : null;
  const dir = delta == null ? null : delta < 0 ? "down" : "up";
  const cls = delta == null ? "" : delta < 0 ? "kpi-wb-d-good" : "kpi-wb-d-bad";
  return (
    <div className="kpi-stripB-tip" style={{ left: `${tip.left}px`, top: `${tip.top}px` }}>
      <b>{fmt$(actual)}</b>
      <span>week of {fmtDate(week.week_start)}</span>
      {budget != null && budget > 0 && (
        <span>budget {fmt$(budget)}</span>
      )}
      {isProg && <span className="kpi-wb-d-mute">in progress</span>}
      {isClosed && delta != null && (
        <span className={cls}><Arrow dir={dir} />{fmt$(Math.abs(delta))} {delta < 0 ? "under" : "over"}</span>
      )}
    </div>
  );
}

// ── TIER C: > 13 weeks, one bar per fiscal period (untouched V21-10) ─
// Kevin CC prompt 2026-09-10 item 3. TierCHeader retired with the
// dashed target line - the legend named a treatment that no longer
// renders. Bars carry the verdict via colour; the variance printed
// under each bar carries the magnitude. TierCStrip render below
// skips this header entirely - the strip title above ("THE RANGE ·
// PERIOD BY PERIOD") already names what the reader is looking at.

function TierCStrip({ board, budgetPeriods }) {
  const weeks = board?.weeks || [];
  const budgetByPeriod = new Map((budgetPeriods || []).map(b => [b.period_no, Number(b.amount)]));

  // 2026-08-26 polish round 2 item 6 - period list comes from
  // periodsInBoardWeeks(board), the SAME helper the WeekTable
  // grouping in page.js reads. Prior inline derivation would have
  // drifted from the table's grouping the next time either changed;
  // the shared helper is the guard against that. Aggregation of
  // spend/hours per period stays inline because the shape here (bar
  // heights) is chart-specific.
  const canonicalPeriods = periodsInBoardWeeks(board);
  const perPeriod = new Map(canonicalPeriods.map(p => [p.period_no, { period_no: p.period_no, spent: 0, hours: 0, weeks: [], adjustedBudgetSum: 0, adjustedAny: false }]));
  for (const w of weeks) {
    const p = w.period_no;
    if (p == null) continue;
    const cur = perPeriod.get(p);
    if (!cur) continue;
    cur.spent += w.spent || 0;
    cur.hours += w.hours || 0;
    cur.weeks.push(w);
    if (w.budget_at_this_week_revenue != null) {
      cur.adjustedBudgetSum += Number(w.budget_at_this_week_revenue);
      cur.adjustedAny = true;
    }
  }
  const allPeriods = [...perPeriod.values()].sort((a, b) => a.period_no - b.period_no);
  for (const pp of allPeriods) {
    // Kevin post-1053 sweep item 1 (2026-09-08). Period bar budget
    // now uses the ADJUSTED per-period budget (sum of per-week batr)
    // so the chart agrees with panel + table. Raw period budget is
    // fallback when per-week batr not attached.
    pp.budget = pp.adjustedAny
      ? Math.round(pp.adjustedBudgetSum * 100) / 100
      : (budgetByPeriod.has(pp.period_no) ? budgetByPeriod.get(pp.period_no) : null);
    const anyInProgress = pp.weeks.some(w => w.state === "in_progress" || w.state === "not_started");
    pp.in_progress = anyInProgress;
  }
  // Kevin post-1053 sweep item 3 (2026-09-08). Running period drops
  // out of the This year chart entirely. R-63: the running period
  // does not enter the total and does not render as a bar. Prior
  // behavior painted P10 as an "in progress" bar with a raw budget
  // reference line even though it could not contribute to the
  // closed-only comparison.
  const periods = board?.kind === "multi_period"
    ? allPeriods.filter(pp => !pp.in_progress)
    : allPeriods;

  // Kevin CC prompt 2026-09-10 item 3. Dashed per-period target
  // line removed - it sat above bars on a different scale and read
  // as misleading. Bar colour (green under, red over) carries the
  // verdict; the variance printed under each bar carries the
  // magnitude. maxScale now scales to bars alone; keep the ×1.1
  // headroom.
  const maxScale = Math.max(
    ...periods.map(p => p.spent),
    1,
  ) * 1.1;

  return (
    <div className="kpi-stripC">
      <div className="kpi-plotC">
        {periods.map(p => {
          const value = p.spent;
          const h = Math.max(0.5, (value / maxScale) * 100);
          const over = !p.in_progress && p.budget != null && value > p.budget;
          const cls = p.in_progress
            ? "kpi-pcol-bar kpi-pcol-bar-prog"
            : over
              ? "kpi-pcol-bar kpi-pcol-bar-over"
              : "kpi-pcol-bar kpi-pcol-bar-under";
          return (
            <div key={p.period_no} className="kpi-pcol">
              <div className={cls} style={{ height: `${h}%` }} />
            </div>
          );
        })}
      </div>
      <div className="kpi-axisC" aria-hidden="true">
        {periods.map(p => {
          const delta = p.budget != null && !p.in_progress ? p.spent - p.budget : null;
          const dir = delta == null ? null : delta < 0 ? "down" : "up";
          const dCls = delta == null ? "" : delta < 0 ? "kpi-wb-d-good" : "kpi-wb-d-bad";
          return (
            <div key={p.period_no} className="kpi-axisC-cell">
              <div className="kpi-axisC-p">P{p.period_no}</div>
              <div className="kpi-axisC-v">{fmtCompact(p.spent)}</div>
              {p.in_progress ? (
                <div className="kpi-axisC-d kpi-wb-d-mute">in progress</div>
              ) : delta != null ? (
                <div className={`kpi-axisC-d ${dCls}`}><Arrow dir={dir} />{fmtCompact(Math.abs(delta))}</div>
              ) : (
                <div className="kpi-axisC-d kpi-wb-d-mute">no budget</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtCompact(v) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 10000) return `$${(v / 1000).toFixed(1)}k`;
  return "$" + Math.round(v).toLocaleString("en-US");
}

// ── Story block main ───────────────────────────────────────────────
// classifyTier lifted to src/lib/kpi/classifyTier.js so purchasing can
// import it too. PR 2 R3 Part B (2026-08-24).

export function StoryBlock({ board, account, rangeLabel, budgetPeriods, todayISO, salary, salaryAvailable, isFutureRange, awaiting = null }) {
  const eyebrowLabel = board?.kind === "single_period_in_progress" || board?.kind === "single_period_closed"
    ? `PERIOD ${board.period_no}`
    : (rangeLabel || "").toUpperCase();
  const dateRange = board?.period_start && board?.period_end
    ? `${fmtDate(board.period_start)} – ${fmtDate(board.period_end)}`
    : "";

  const weekCount = (board?.weeks || []).length;
  const tier = classifyTier(weekCount);
  const stripTitle = tier === "C" ? "THE RANGE · PERIOD BY PERIOD" : (tier === "A" ? "THE PERIOD · WEEK BY WEEK" : "THE RANGE · WEEK BY WEEK");

  return (
    <div className="kpi-story">
      <div className="kpi-story-left">
        <SpendCard board={board} eyebrowLabel={eyebrowLabel} dateRange={dateRange} salary={salary} salaryAvailable={salaryAvailable} isFutureRange={isFutureRange} awaiting={awaiting} />
      </div>

      <div className="kpi-story-right">
        <div className="kpi-wh">
          <span className="kpi-wh-t">{stripTitle}</span>
          <HelpPop id="qWeekByWeek" title="Week by week" body={WEEK_BY_WEEK_BODY} />
          <span className="kpi-wh-sp" aria-hidden="true" />
          {/* Kevin walkthrough item 2 (2026-09-07). Prior legend had
              "weekly target $4,777.27" (from board.weekly_original_target)
              which named ONE flat number when each bar's line sits at
              THAT week's own budget - the number in the legend was
              wrong on every bar. On single-period-in-progress the
              `original` and `adjusted` entries always read identically
              ($4,940.60 on both); Kevin ruling: if two legend entries
              always show the same number, one of them is not a real
              distinction - resolve or remove. Removed. Replaced with a
              descriptor naming the treatment, not a value.

              R-84 (Kevin walkthrough item 4b, 2026-09-07): a legend may
              not promise a treatment nothing uses. `amber hatched = not
              costed yet` fires nowhere in current data (verified across
              4 accounts x 2 ranges, all `unpriced_hrs = 0`). The
              `.kpi-wb-cap-est` render code stays (defensive; may fire
              during payroll windows) but the legend entry goes until
              the treatment fires. If the amber cap ever renders and no
              legend explains it, that gap is easy to notice and add
              back. */}
          {tier === "A" && (
            <>
              <span className="kpi-wh-tgt kpi-wh-tgt-cap">
                <span className="kpi-wh-tgt-dash" aria-hidden="true" />
                each week&rsquo;s own budget
              </span>
              <span className="kpi-wh-tgt kpi-wh-tgt-cap">
                <span className="kpi-wh-unapp-swatch" aria-hidden="true" />
                grey hatched = awaiting approval
              </span>
            </>
          )}
        </div>

        {tier === "A" && <TierAStrip board={board} salary={salary} />}
        {tier === "A" && <WeekRail board={board} />}
        {tier === "B" && <TierBStrip board={board} />}
        {tier === "C" && (
          <TierCStrip board={board} budgetPeriods={budgetPeriods} todayISO={todayISO} />
        )}
      </div>
    </div>
  );
}

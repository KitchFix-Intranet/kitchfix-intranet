"use client";
import { useState } from "react";
import { pickHeadline } from "./submissionMessages";
import { fmt$ } from "./format";

export default function SubmissionToast({
  amount,
  daysEntered,
  totalDays,
  scopeWord = "period",
  isBulk = false,
  bulkDays = 0,
  isFeeAccount = false,
  noService = false,
  onDismiss,
}) {
  // Pick headline once on mount so a re-render doesn't reroll it. Parent
  // unmounts + remounts on the next submission, so each toast gets one.
  // SC-066: mark-no-service overrides the clubhouse rotator with a
  // literal headline (no milestone treatment - the amber gold glow
  // doesn't fit a cancelled-service submission).
  const [headline] = useState(() =>
    noService
      ? { text: "No service recorded", milestone: null }
      : pickHeadline({ daysEntered, totalDays, isBulk, bulkDays })
  );
  const hasProgress = Number.isFinite(daysEntered) && Number.isFinite(totalDays) && totalDays > 0;
  const pct = hasProgress ? Math.min(100, Math.round((daysEntered / totalDays) * 100)) : 0;
  const isMilestone = headline.milestone === "complete";
  // Money line drops on no-service submits (amount is 0 by definition;
  // showing "$0" next to "No service recorded" is redundant + reads
  // wrong on a per-meal-day card).
  const showAmount = !noService && !isFeeAccount && Number.isFinite(amount);

  // SC-060: whole-card click-to-dismiss. Rendered as a <button> so
  // Enter/Space also dismiss and focus-visible produces a real outline
  // for keyboard users. Title + cursor + focus outline telegraph the
  // dismiss affordance.
  //
  // C1b (F11): the live region is CONDITIONAL to avoid double-announce.
  //   single-day save (isBulk = false): DayDetail's success screen
  //     carries role="status" + aria-live="polite"; toast stays silent
  //     to the screen reader.
  //   bulk save (isBulk = true): no success screen exists, so the toast
  //     itself gets role="status" + aria-live="polite" and announces the
  //     recorded totals.
  // Never both.
  const liveRegionProps = isBulk
    ? { role: "status", "aria-live": "polite" }
    : {};
  return (
    <button
      type="button"
      className={`sc-toast-recorded${isMilestone ? " sc-toast-recorded--milestone" : ""}`}
      {...liveRegionProps}
      title="Click to dismiss"
      onClick={onDismiss}
    >
      <div className="sc-toast-recorded__head">
        <span className="sc-toast-recorded__check" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <span className="sc-toast-recorded__headline">{headline.text}</span>
        {/* SC-057: whole dollars (was ".XX" cents on a surface where every
            other dollar reading is whole). fmt$ default is decimals=0. */}
        {showAmount && <span className="sc-toast-recorded__amount">{fmt$(amount)}</span>}
      </div>
      {hasProgress && (
        <>
          <div className="sc-toast-recorded__bar" aria-hidden="true" style={{ "--pct": `${pct}%` }}>
            <span className="sc-toast-recorded__bar-fill" />
          </div>
          <div className="sc-toast-recorded__meta">
            <span>{daysEntered} of {totalDays} days this {scopeWord}</span>
            <span className="sc-toast-recorded__pct">{pct}%</span>
          </div>
        </>
      )}
    </button>
  );
}

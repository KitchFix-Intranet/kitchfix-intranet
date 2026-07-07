"use client";
import { useState } from "react";
import { pickHeadline } from "./submissionMessages";

const fmt$ = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function SubmissionToast({
  amount,
  daysEntered,
  totalDays,
  scopeWord = "period",
  isBulk = false,
  bulkDays = 0,
  isFeeAccount = false,
}) {
  // Pick headline once on mount so a re-render doesn't reroll it. Parent
  // unmounts + remounts on the next submission, so each toast gets one.
  const [headline] = useState(() => pickHeadline({ daysEntered, totalDays, isBulk, bulkDays }));
  const hasProgress = Number.isFinite(daysEntered) && Number.isFinite(totalDays) && totalDays > 0;
  const pct = hasProgress ? Math.min(100, Math.round((daysEntered / totalDays) * 100)) : 0;
  const isMilestone = headline.milestone === "complete";
  const showAmount = !isFeeAccount && Number.isFinite(amount);

  return (
    <div
      className={`sc-toast-recorded${isMilestone ? " sc-toast-recorded--milestone" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="sc-toast-recorded__head">
        <span className="sc-toast-recorded__check" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
        <span className="sc-toast-recorded__headline">{headline.text}</span>
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
    </div>
  );
}

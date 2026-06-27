"use client";

// InfoCard - the split context + action bands (Design Batch 2,
// audit P1-1). Replaces the single-sentence YearBanner with two
// side-by-side bands:
//   LEFT  - context: "Today <date> | Period <n> | Week <n> | <pct>%
//           recorded" in calm body weight
//   RIGHT - action: three states
//     (a) HAS WORK   - amber band + jump-to-next button
//     (b) ALL CLEAR  - green band + "All caught up, nicely done"
//     (c) FEE        - homestand/contract status (CC-7)
//
// Stacks vertically on narrow viewports (<768px). PRESENTATIONAL:
// takes resolved props in, emits onClick out.

import "./infoCard.css";

export default function InfoCard({
  // context-band data
  todayLabel,                 // "Jun 26"
  periodNum,                  // "7"
  weekNum,                    // "2"
  pctRecorded,                // 54  (already rounded)
  // action-band data
  isFeeAccount = false,
  needsEntry = 0,
  overdue = 0,
  feeHeadline = null,         // { current, opponents[], note } for fee account headline
  // actions
  onJumpToNext,               // () => void; rendered only when there's work
  hasJumpTarget = false,      // boolean - whether the jump-to-next target is resolvable
  loading = false,
}) {
  // Loading skeleton
  if (loading) {
    return (
      <div className="sc-info-card sc-info-card--loading" aria-hidden="true">
        <div className="sc-info-card-context">
          <span className="sc-info-card-skel" style={{ width: 90 }} />
          <span className="sc-info-card-skel" style={{ width: 70 }} />
          <span className="sc-info-card-skel" style={{ width: 110 }} />
        </div>
        <div className="sc-info-card-action">
          <span className="sc-info-card-skel sc-info-card-skel--block" style={{ width: 220 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="sc-info-card">
      <ContextBand
        todayLabel={todayLabel}
        periodNum={periodNum}
        weekNum={weekNum}
        pctRecorded={pctRecorded}
      />
      <ActionBand
        isFeeAccount={isFeeAccount}
        needsEntry={needsEntry}
        overdue={overdue}
        feeHeadline={feeHeadline}
        todayLabel={todayLabel}
        onJumpToNext={onJumpToNext}
        hasJumpTarget={hasJumpTarget}
      />
    </div>
  );
}

function ContextBand({ todayLabel, periodNum, weekNum, pctRecorded }) {
  return (
    <div className="sc-info-card-context" role="group" aria-label="Today context">
      <span className="sc-info-card-context-segment">
        <span className="sc-info-card-context-label">Today</span>
        <span className="sc-info-card-context-value">{todayLabel || "—"}</span>
      </span>
      <span className="sc-info-card-context-sep" aria-hidden="true" />
      <span className="sc-info-card-context-segment">
        <span className="sc-info-card-context-label">Period</span>
        <span className="sc-info-card-context-value">{periodNum || "—"}</span>
      </span>
      {weekNum && (
        <>
          <span className="sc-info-card-context-sep" aria-hidden="true" />
          <span className="sc-info-card-context-segment">
            <span className="sc-info-card-context-label">Week</span>
            <span className="sc-info-card-context-value">{weekNum}</span>
          </span>
        </>
      )}
      <span className="sc-info-card-context-sep" aria-hidden="true" />
      <span className="sc-info-card-context-segment">
        <span className="sc-info-card-context-value">{pctRecorded != null ? `${pctRecorded}%` : "—"}</span>
        <span className="sc-info-card-context-label">recorded</span>
      </span>
    </div>
  );
}

// Action band: three states. The branch order matters - fee accounts
// short-circuit before the per-meal action/all-clear branches because
// they never carry needs-entry/overdue counts.
function ActionBand({ isFeeAccount, needsEntry, overdue, feeHeadline, todayLabel, onJumpToNext, hasJumpTarget }) {
  if (isFeeAccount) {
    return <FeeBand headline={feeHeadline} />;
  }
  const hasWork = (needsEntry || 0) > 0 || (overdue || 0) > 0;
  if (hasWork) {
    return (
      <div className="sc-info-card-action sc-info-card-action--work" role="group" aria-label="Work to do">
        <span className="sc-info-card-action-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </span>
        <span className="sc-info-card-action-counts">
          {needsEntry > 0 && (
            <span className="sc-info-card-action-count">
              <strong>{needsEntry}</strong> need entry
            </span>
          )}
          {needsEntry > 0 && overdue > 0 && (
            <span className="sc-info-card-action-dot" aria-hidden="true">·</span>
          )}
          {overdue > 0 && (
            <span className="sc-info-card-action-count sc-info-card-action-count--alert">
              <strong>{overdue}</strong> overdue
            </span>
          )}
        </span>
        {onJumpToNext && hasJumpTarget && (
          <button
            type="button"
            className="sc-info-card-action-jump"
            onClick={onJumpToNext}
          >
            Jump to next
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    );
  }
  // ALL CLEAR. Earned closure - the Zeigarnik-effect satisfying state
  // (rubric Part 4). Not a void: it confirms the work is done.
  return (
    <div className="sc-info-card-action sc-info-card-action--clear" role="group" aria-label="All caught up">
      <span className="sc-info-card-action-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span className="sc-info-card-action-text">
        <strong>All caught up</strong>
        {todayLabel && (
          <span className="sc-info-card-action-sub"> as of {todayLabel} - nicely done</span>
        )}
      </span>
    </div>
  );
}

// Fee account: homestand + contract state. NO needs-entry/overdue
// (fee accounts don't track per-meal actuals - audit CC-7). When
// current-homestand detail is available, render it. When between
// homestands or off-season, fall back to a contract-only headline.
function FeeBand({ headline }) {
  if (!headline) {
    return (
      <div className="sc-info-card-action sc-info-card-action--fee">
        <span className="sc-info-card-action-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </span>
        <span className="sc-info-card-action-text">
          <strong>Season in progress</strong>
          <span className="sc-info-card-action-sub"> · contract on track</span>
        </span>
      </div>
    );
  }
  const { current, opponents = [], note } = headline;
  return (
    <div className="sc-info-card-action sc-info-card-action--fee">
      <span className="sc-info-card-action-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      </span>
      <span className="sc-info-card-action-text">
        {current ? (
          <>
            <strong>{current} in progress</strong>
            {opponents.length > 0 && (
              <span className="sc-info-card-action-sub"> · {opponents.join(" -> ")}</span>
            )}
          </>
        ) : (
          <>
            <strong>{note || "Between homestands"}</strong>
          </>
        )}
        <span className="sc-info-card-action-sub"> · contract on track</span>
      </span>
    </div>
  );
}

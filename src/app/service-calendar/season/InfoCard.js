"use client";

// InfoCard - the action band of the season landing (Design Batch 2,
// audit P1-1). Bundle 1 (Section B) promoted the prior ContextBand
// (Today / Period / Week / Recorded) up into the ChromeBar so the
// info card now carries only the action signal:
//   (a) HAS WORK   - amber band + jump-to-next button
//   (b) ALL CLEAR  - green band + "All caught up, nicely done"
//   (c) FEE        - homestand/contract status (CC-7)
//
// PRESENTATIONAL: takes resolved props in, emits onClick out.

import "./infoCard.css";

export default function InfoCard({
  // action-band data
  isFeeAccount = false,
  needsEntry = 0,
  overdue = 0,
  feeStats = null,            // { gameDaysEntered, totalGameDays } for fee account contract band
  todayLabel,                 // "Jun 28" - used only by the all-clear sub-text
  // actions
  onJumpToNext,               // () => void; rendered only when there's work
  hasJumpTarget = false,      // boolean - whether the jump-to-next target is resolvable
  loading = false,
}) {
  // Loading skeleton
  if (loading) {
    return (
      <div className="sc-info-card sc-info-card--loading" aria-hidden="true">
        <div className="sc-info-card-action">
          <span className="sc-info-card-skel sc-info-card-skel--block" style={{ width: 220 }} />
        </div>
      </div>
    );
  }

  return (
    <div className="sc-info-card">
      <ActionBand
        isFeeAccount={isFeeAccount}
        needsEntry={needsEntry}
        overdue={overdue}
        feeStats={feeStats}
        todayLabel={todayLabel}
        onJumpToNext={onJumpToNext}
        hasJumpTarget={hasJumpTarget}
      />
    </div>
  );
}

// Action band: three states. The branch order matters - fee accounts
// short-circuit before the per-meal action/all-clear branches because
// they never carry needs-entry/overdue counts.
function ActionBand({ isFeeAccount, needsEntry, overdue, feeStats, todayLabel, onJumpToNext, hasJumpTarget }) {
  if (isFeeAccount) {
    return <FeeBand feeStats={feeStats} />;
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

// Fee account: contract status only. The homestand / opponent detail
// used to render here AND in the SeasonStepper caption AND in the
// mobile spotlight - three copies of the same fact on one screen.
// As of the mobile overhaul, this band is contract-only; the
// stepper owns homestand detail.
function FeeBand({ feeStats }) {
  // feeStats may be null (per-meal account) - the parent gates this
  // branch on isFeeAccount === true so we never render that case.
  const hasGameDays = feeStats?.totalGameDays > 0;
  return (
    <div className="sc-info-card-action sc-info-card-action--fee">
      <span className="sc-info-card-action-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span className="sc-info-card-action-text">
        {hasGameDays ? (
          <>
            <strong>
              {feeStats.gameDaysEntered} of {feeStats.totalGameDays} game days recorded
            </strong>
            <span className="sc-info-card-action-sub"> · contract on track</span>
          </>
        ) : (
          <>
            <strong>Contract on track</strong>
            <span className="sc-info-card-action-sub"> · season in progress</span>
          </>
        )}
      </span>
    </div>
  );
}

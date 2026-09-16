// src/app/kpi/overview/components/currentPeriodRolling.js
//
// R-112 · Section B · PLAN / ROLLING respread. Pure computation, no
// React, no browser globals - so `scripts/tests/rolling_c3.test.mjs`
// can import and prove C3 on a synthetic negative remainder (no live
// data reaches that edge today).
//
// Semantics (Kevin § B):
//   plan gives every week its own budget from its own revenue.
//   rolling takes what is left of the period envelope and respreads
//   it across weeks that have not closed, in proportion to revenue.
//
//   closedSpent = sum landed on weeks where closedFlags[i] is true
//   openRev     = sum weekRev on weeks where closedFlags[i] is false
//   remain      = envelope - closedSpent
//   rolling[i]  = closedFlags[i] ? plan[i] : round(weekRev[i] / openRev × remain)
//
// Closed weeks never move. The period column never moves (envelope
// is envelope; the shift is inside open weeks).
//
// Edge cases (Kevin § C):
//   C1  no closed weeks     -> rolling == plan, control still renders
//   C2  one open week       -> that week absorbs remain
//   C3  remain < 0          -> clamp open weeks to $0
//   C4  future range        -> caller does not render the toggle at all
//                             (CurrentPeriodTable never mounts on a
//                              future range; nothing to do here)

export function rollingOf(plan, landed, envelope, closedFlags, weekRev) {
  const N = plan.length;
  let closedSpent = 0, openRev = 0, openWeekCount = 0;
  for (let i = 0; i < N; i++) {
    if (closedFlags[i]) closedSpent += Number(landed[i] || 0);
    else { openRev += Number(weekRev[i] || 0); openWeekCount++; }
  }
  const remain = Number(envelope || 0) - closedSpent;
  const isC1 = closedFlags.every(f => !f);
  const isC2 = openWeekCount === 1;
  const isC3 = remain < 0;
  const rolling = plan.map((p, i) => {
    if (closedFlags[i]) return Number(p || 0);
    if (isC3) return 0;
    if (openRev <= 0) return 0;
    return Math.round(Number(weekRev[i] || 0) / openRev * remain);
  });
  return { rolling, closedSpent, openRev, openWeekCount, remain, isC1, isC2, isC3 };
}

// Summary card figures per cost line (Kevin § B "The summary card"):
//   totalDelta      = sum(rolling[open] - plan[open])  (== -closedVar within $1)
//   thisWeekDelta   = rolling[current] - plan[current]  or 0 if no current
//   trim            = true when totalDelta < 0 (open weeks need to trim)
export function summaryFor(plan, rolling, closedFlags, currentIdx) {
  let totalDelta = 0;
  for (let i = 0; i < plan.length; i++) {
    if (!closedFlags[i]) totalDelta += (Number(rolling[i] || 0) - Number(plan[i] || 0));
  }
  const thisWeekDelta = currentIdx >= 0 && !closedFlags[currentIdx]
    ? (Number(rolling[currentIdx] || 0) - Number(plan[currentIdx] || 0))
    : 0;
  return { totalDelta, thisWeekDelta, trim: totalDelta < 0 };
}

// Rolling invariant (Kevin § B "The invariant that proves it"):
//   sum(rolling[open] - plan[open]) == -sum(landed[closed] - plan[closed])
// within $1 for rounding. Returns { openShift, closedVar, delta } for
// the caller to assert. C3 skips the invariant check (rolling is
// clamped to 0, not respread, so the identity does not hold).
export function invariantCheck(plan, landed, rolling, closedFlags) {
  let openShift = 0, closedVar = 0;
  for (let i = 0; i < plan.length; i++) {
    if (closedFlags[i]) closedVar += (Number(landed[i] || 0) - Number(plan[i] || 0));
    else                openShift += (Number(rolling[i] || 0) - Number(plan[i] || 0));
  }
  const delta = openShift - (-closedVar);
  return { openShift, closedVar, delta, holds: Math.abs(delta) <= 1 };
}

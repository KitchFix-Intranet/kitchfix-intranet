"use client";
// ═══════════════════════════════════════════════════════════════════
// Handoff coordinator (Phase 3-B, 2026-07-28; flight retired 2026-08-01)
// ═══════════════════════════════════════════════════════════════════
//
// Owns two things after the flight retirement:
//   1. `sessionMap` - the per-day totals the session strip reads.
//      Kept as a plain object in state (setState with a new reference
//      each mutation so consumers re-render). Re-edits overwrite by
//      key = LAST-SAVED wins (owner Ruling 3, P3-B).
//   2. The finalize-timer clock - `startHandoff` schedules the
//      onFinalize callback (next-day advance / modal close) on ONE
//      clock so DayEntryV2 does not run a second setTimeout that
//      could drift.
//
// Retired 2026-08-01 by owner ruling after the audit confirmed the
// pill-clone flight was structurally impossible:
//   - Phase 2 (pillIn beat) never committed. Observed sequence
//     0 -> 1 -> 3 -> 5 -> 0 on every save on every account.
//   - HandoffPill mounted on the phase-3 commit; HandoffLayer's
//     phase-3 effect read pillSourceRef in the same tick and got
//     null, hit the early return, and aborted.
// Every save-feedback effect an operator relies on is independent
// of the flight and is preserved:
//   - Tile flip (workspace-level via prevHasActualsMap; not phase
//     driven - see DaySquare.js + PeriodWorkspace).
//   - Queue clear (queueRows re-derives from the day's updated
//     status; not phase driven).
//   - Session strip (reads sessionMap directly).
//   - Next-day advance (onFinalize callback fired by startHandoff's
//     timer below).
//   - Month-complete card (monthComplete state, set via
//     showMonthComplete from HandoffAmbient).
//
// No-service saves: DO NOT call startHandoff. commitSessionOnly adds
// the day to the strip at zero units (owner Ruling 5: no celebration
// for a cancellation, but the day IS resolved).
//
// Reduced motion (2026-08-03, sc-save-confirm #598 ruling 2):
// startHandoff schedules onFinalize on the same FINALIZE_DELAY clock
// regardless of the operator's motion preference. Suppress motion is
// not suppress time. The delay is the save-confirmation overlay's
// visible window - a modal holding still for a beat while a static
// confirmation sits on it is not motion, and the preference does not
// ask us to skip it. Before this change the RM branch short-circuited
// to fireFinalize() synchronously, which closed the modal in the same
// tick the overlay mounted - RM users got one paint frame of the
// confirmation, which is invisible to a whole group of sighted
// operators who enable RM for vestibular reasons.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

/* Delay before the onFinalize callback (next-day advance / modal
   close) fires. Was 1350ms in the P3-B "one clock" design - the beat
   at which the ambient effects (tile flip, session strip) had
   settled and the operator was ready to move on. Bumped to 1800ms
   2026-08-03 (sc-save-confirm #598 ruling 3): the SaveConfirmation
   overlay owns this window as its visible-hold budget, and 1350ms
   was too fast to register the count + money before the advance
   fired. 1800 gives ~800ms of full-opacity hold, which is the
   register-time floor for a static confirmation. Owner is the final
   word if a live run reads this as too long or still too short. */
const FINALIZE_DELAY = 1800;

const HandoffContext = createContext(null);

export function HandoffProvider({ children }) {
  const [sessionMap, setSessionMap] = useState(() => ({}));
  const [monthComplete, setMonthComplete] = useState(null);
  const timeoutIdsRef = useRef([]);
  /* finalizeRef holds the pending onFinalize callback. Stored as a
     ref so a mid-sequence cancel (unmount / account change) can drop
     the callback without firing. */
  const finalizeRef = useRef(null);

  const clearTimers = useCallback(() => {
    for (const id of timeoutIdsRef.current) clearTimeout(id);
    timeoutIdsRef.current = [];
  }, []);

  const fireFinalize = useCallback(() => {
    const fn = finalizeRef.current;
    finalizeRef.current = null;
    if (typeof fn === "function") fn();
  }, []);

  const commitSession = useCallback((dayDate, totals) => {
    setSessionMap(prev => ({
      ...prev,
      [dayDate]: {
        units: Number(totals?.units) || 0,
        revenue: Number(totals?.revenue) || 0,
      },
    }));
  }, []);

  const resetSession = useCallback(() => {
    setSessionMap({});
    setMonthComplete(null);
  }, []);

  /* startHandoff - commit the session entry, schedule the finalize
     callback. No phase machine, no flight, no pill. The visible save
     feedback is delivered by DayEntryV2's justSaved screen + the
     workspace-level tile flip + the ambient session strip + the
     queue-clear reaction; the coordinator's job is the data commit
     and the one-clock timer for the drill-advance callback. */
  const startHandoff = useCallback(({ dayDate, totals, onFinalize }) => {
    if (!dayDate) return;
    clearTimers();
    finalizeRef.current = typeof onFinalize === "function" ? onFinalize : null;
    commitSession(dayDate, totals);

    // One clock for every user (2026-08-03, sc-save-confirm ruling 2).
    // See top-of-file note - the delay is the confirmation's visible
    // window, not a motion beat, so RM keeps it too.
    const finalizeId = setTimeout(fireFinalize, FINALIZE_DELAY);
    timeoutIdsRef.current.push(finalizeId);
  }, [clearTimers, commitSession, fireFinalize]);

  const cancelHandoff = useCallback(() => {
    clearTimers();
    finalizeRef.current = null;
  }, [clearTimers]);

  const dismissMonthComplete = useCallback(() => setMonthComplete(null), []);

  /* Month-complete card entry point. Sets card state and NOTHING
     else - no clearTimers, no finalizeRef overwrite, no commitSession.
     Callable from any effect that detects the completing edge
     without racing an in-flight day sequence. HandoffAmbient uses
     this. */
  const showMonthComplete = useCallback((mc) => {
    if (mc) setMonthComplete(mc);
  }, []);

  /* Session commit for save paths that must NOT trigger the finalize
     clock (no-service saves - Ruling 5: no pill, no toast, and the
     day should not auto-advance). */
  const commitSessionOnly = useCallback((dayDate, totals) => {
    if (!dayDate) return;
    commitSession(dayDate, totals);
  }, [commitSession]);

  const value = useMemo(() => ({
    sessionMap,
    monthComplete,
    startHandoff,
    cancelHandoff,
    resetSession,
    dismissMonthComplete,
    showMonthComplete,
    commitSessionOnly,
  }), [
    sessionMap, monthComplete,
    startHandoff, cancelHandoff, resetSession,
    dismissMonthComplete, showMonthComplete, commitSessionOnly,
  ]);

  return (
    <HandoffContext.Provider value={value}>
      {children}
    </HandoffContext.Provider>
  );
}

export function useHandoff() {
  return useContext(HandoffContext);
}

// Safe-fallback accessor for components mounted outside a provider
// (defensive; provider always wraps in production).
export function useHandoffSafe() {
  const ctx = useContext(HandoffContext);
  return ctx || {
    sessionMap: {},
    monthComplete: null,
    startHandoff: () => {},
    cancelHandoff: () => {},
    resetSession: () => {},
    dismissMonthComplete: () => {},
    showMonthComplete: () => {},
    commitSessionOnly: () => {},
  };
}

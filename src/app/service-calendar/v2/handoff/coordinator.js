"use client";
// ═══════════════════════════════════════════════════════════════════
// Handoff coordinator (Phase 3-B; flight retired 2026-07-31).
// ═══════════════════════════════════════════════════════════════════
//
// Owns two things after the flight retirement:
//   1. `sessionMap` - the per-day totals the session strip reads. Kept
//      as a plain object in state (setState with a new reference each
//      mutation so consumers re-render). Re-edits overwrite by key =
//      LAST-SAVED wins (owner Ruling 3).
//   2. The finalize-timer clock - `startHandoff` schedules the
//      onFinalize callback (next-day advance / modal close) on ONE
//      clock so DayEntryV2 does not run a second setTimeout that
//      could drift.
//
// Retired 2026-07-31 by owner ruling: the pill-clone flight motion
// (HandoffLayer + HandoffPill + phase machine + registerFlightTarget)
// never ran on any account. Owner traced the cause end to end:
// even phases (2, 4) never commit, the phase-3 effect fires with the
// pill source ref null, and every save-feedback effect an operator
// relies on is independent of the flight. See SC_STATUS.md for the
// trace and the retirement rationale.
//
// What still fires on save (unchanged by the retirement):
//   - The success pill inside the form (DayEntryV2's own justSaved
//     screen; not this coordinator's).
//   - The tile flip (workspace-level via prevHasActualsMap; not phase
//     driven, see DaySquare.js + PeriodWorkspace).
//   - The queue clear (queueRows re-derives from the day's updated
//     status; not phase driven).
//   - The session strip (reads sessionMap directly).
//   - Next-day advance (onFinalize callback fired by startHandoff's
//     timer below).
//   - The month-complete card (monthComplete state, set via
//     showMonthComplete).
//
// No-service saves: DO NOT call startHandoff. commitSessionOnly adds
// the day to the strip at zero units (owner Ruling 5: no celebration
// for a cancellation, but the day IS resolved).
//
// Reduced motion: startHandoff fires onFinalize immediately instead
// of waiting the FINALIZE_DELAY. Data truth is instant; the delay
// is a visual settle beat.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { prefersReducedMotion } from "../motion";

/* Delay before the onFinalize callback (next-day advance / modal
   close) fires. Was 1350ms in the P3-B "one clock" design - the beat
   at which the ambient effects (tile flip, session strip, ring
   sweep) had settled and the operator was ready to move on. Kept at
   the same value so cadence is preserved. */
const FINALIZE_DELAY = 1350;

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
     callback. No phase machine, no flight. Owner ruling 2026-07-31:
     the visible save feedback is delivered by DayEntryV2's own
     justSaved screen + the workspace-level tile flip + the ambient
     session strip + queue-clear reactions; the coordinator's job is
     the data commit + the one-clock timer for the drill-advance
     callback. */
  const startHandoff = useCallback(({ dayDate, totals, onFinalize }) => {
    if (!dayDate) return;
    clearTimers();
    finalizeRef.current = typeof onFinalize === "function" ? onFinalize : null;
    commitSession(dayDate, totals);

    if (prefersReducedMotion()) {
      fireFinalize();
      return;
    }

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

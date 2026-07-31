"use client";
// ═══════════════════════════════════════════════════════════════════
// Handoff coordinator (Phase 3-B, 2026-07-28).
// ═══════════════════════════════════════════════════════════════════
//
// Owns the beat clock for the Handoff sequence. One entry point
// (startHandoff) drives every downstream animation via phase state
// + registered target refs. Consumers hook in without knowing the
// timing table - they subscribe to phase + the day being animated.
//
// Beat table (contract, from RENDER_HANDOFF_BLENDED.html + owner):
//   phase 0  idle
//   phase 1  0-200ms    fadeSvc (service rows lift, stagger)
//   phase 2  200-660ms  pillIn (confirmed pill forms, overshoot)
//   phase 3  660-1210ms pillFly (JS clone travels) + tile flip
//   phase 4  1020-1400ms ringSweep (ambient CSS transition) + queue
//                       clear + badge tick
//   phase 5  1350-1850ms slideNext (next day slides in)
//   -> back to 0
//
// Trigger: DayEntryV2.executeConfirm success branch calls
//   startHandoff({ dayDate, totals, feeNoDollar, monthComplete }).
// Failure never starts the sequence - inline banner path (P3-A) fires
// instead.
//
// Session strip: sessionMap Map<date, {units, revenue}> holds the
// LAST-SAVED values per date. Re-edits (200 -> 210) overwrite the
// entry so the strip shows 210, not 410 (owner Ruling 3). Resets on
// account or scope change (see the resetSession call in Service-
// Calendar's account/scope-change effects).
//
// No-service saves: DO NOT fire startHandoff (owner Ruling 5).
// The panel's inline state + ambient ring/queue updates are the
// confirmation. sessionMap DOES get a { units: 0, revenue: 0 }
// entry per Ruling 5 - "days cleared = days resolved."
//
// Reduced motion: startHandoff checks prefersReducedMotion() and
// applies end-states directly (phase 0 -> 5 skipping intermediate
// beats). Downstream consumers still update via the sessionMap
// commit; the flight/pill/slide animations skip.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { prefersReducedMotion } from "../motion";

// Beat delays in ms. Anchored to the render's timing table.
const BEAT_DELAYS = {
  1: 0,      // idle -> fadeSvc immediately
  2: 200,    // fadeSvc -> pillIn
  3: 660,    // pillIn -> pillFly + flip
  4: 1020,   // pillFly -> ringSweep + queue clear
  5: 1350,   // ringSweep -> slideNext
  0: 1850,   // slideNext -> idle (drop the sequence)
};

const HandoffContext = createContext(null);

export function HandoffProvider({ children }) {
  // Phase state - drives CSS classes and consumer readouts.
  const [phase, setPhase] = useState(0);
  const [handoffDay, setHandoffDay] = useState(null);
  const [handoffTotals, setHandoffTotals] = useState(null);
  // Session strip. Map<date, {units, revenue}>. Kept as a plain object
  // in state (setState with a NEW reference each mutation so consumers
  // re-render). Re-edits overwrite by key = LAST-SAVED wins.
  const [sessionMap, setSessionMap] = useState(() => ({}));
  // Month complete card. Populated on a save that completes the month.
  const [monthComplete, setMonthComplete] = useState(null);

  /* Refs registered by the drill rail (target) and DayEntryV2 (pill
     source). useRef here holds the CURRENT element; a stable reference
     the coordinator can read at the moment of startHandoff.
     R2-2 (2026-07-31) - renamed from ringTargetRef. The ring is no
     longer the flight destination anywhere - the target is now the
     bar-plus-caption block (`.sc-rail-progress-block`) registered by
     the new RailProgressBlock primitive. The ref name is generic
     because the destination shape may evolve; the coordinator does
     not care what visual sits at the rect. */
  const flightTargetRef = useRef(null);
  const pillSourceRef = useRef(null);
  const timeoutIdsRef = useRef([]);
  // P3-B gate-2 fix (2026-07-28): finalize (onNextException / onClose)
  // runs on the coordinator's clock, NOT a separate setTimeout inside
  // DayEntryV2. One clock. Stored as a ref so a mid-sequence cancel
  // (unmount / account change) can drop the callback without firing.
  const finalizeRef = useRef(null);

  const clearTimers = useCallback(() => {
    for (const id of timeoutIdsRef.current) clearTimeout(id);
    timeoutIdsRef.current = [];
  }, []);

  // P3-B gate-2: fire the pending finalize callback once, then drop.
  // Called from the coordinator's phase-5 timer (or immediately on RM).
  const fireFinalize = useCallback(() => {
    const fn = finalizeRef.current;
    finalizeRef.current = null;
    if (typeof fn === "function") fn();
  }, []);

  const registerFlightTarget = useCallback((el) => {
    flightTargetRef.current = el;
    return () => {
      if (flightTargetRef.current === el) flightTargetRef.current = null;
    };
  }, []);

  const registerPillSource = useCallback((el) => {
    pillSourceRef.current = el;
    return () => {
      if (pillSourceRef.current === el) pillSourceRef.current = null;
    };
  }, []);

  // Session commit - happens synchronously on the trigger regardless
  // of RM. Data truth is instant; motion is decoration.
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

  // Main entry point.
  //
  // P3-B gate-2 (2026-07-28): accepts `onFinalize` - the slide-next /
  // close callback that used to run on a separate setTimeout inside
  // DayEntryV2 (two-clock risk). Now stored in finalizeRef and fired
  // on the coordinator's own phase-5 timer, so if the sequence is
  // cancelled (unmount, account change) the callback drops cleanly.
  //
  // P3-B re-gate 5 fix 2 (2026-07-28): month-complete is NO LONGER
  // routed through startHandoff. The old shape called startHandoff
  // with dayDate=null, which cleared the pending day sequence's
  // timers + finalizeRef even when a day save had just kicked off
  // its own sequence - the day modal stayed open behind the card
  // because onFinalize never fired. showMonthComplete below owns
  // the card path exclusively; it's a one-shot state set with no
  // side effects on the day sequence.
  const startHandoff = useCallback(({ dayDate, totals, onFinalize }) => {
    if (!dayDate) return;
    clearTimers();
    finalizeRef.current = typeof onFinalize === "function" ? onFinalize : null;
    commitSession(dayDate, totals);
    setHandoffDay(dayDate);
    setHandoffTotals(totals);

    if (prefersReducedMotion()) {
      // RM path: skip every intermediate beat. sessionMap is already
      // committed; consumers pick up the new value on next render.
      // finalize fires immediately - the drill still needs to advance.
      setPhase(0);
      setHandoffDay(null);
      fireFinalize();
      return;
    }

    // Full sequence: schedule phase transitions per BEAT_DELAYS.
    // Phase 1 fires immediately (fadeSvc begins). Phase 5 fires the
    // slideNext callback (finalize) on the SAME clock - no drift.
    setPhase(1);
    const schedule = (nextPhase) => {
      const id = setTimeout(() => setPhase(nextPhase), BEAT_DELAYS[nextPhase]);
      timeoutIdsRef.current.push(id);
    };
    schedule(2);
    schedule(3);
    schedule(4);
    const phase5Id = setTimeout(() => {
      setPhase(5);
      fireFinalize();
    }, BEAT_DELAYS[5]);
    timeoutIdsRef.current.push(phase5Id);
    const dropId = setTimeout(() => {
      setPhase(0);
      setHandoffDay(null);
      setHandoffTotals(null);
    }, BEAT_DELAYS[0]);
    timeoutIdsRef.current.push(dropId);
  }, [clearTimers, commitSession, fireFinalize]);

  const cancelHandoff = useCallback(() => {
    clearTimers();
    // Drop the pending finalize on cancel - the surface owning the
    // callback is going away, we should not push it into an unmounted
    // consumer.
    finalizeRef.current = null;
    setPhase(0);
    setHandoffDay(null);
    setHandoffTotals(null);
  }, [clearTimers]);

  const isFlippingDate = useCallback((date) => {
    return handoffDay === date && phase >= 3 && phase <= 4;
  }, [handoffDay, phase]);

  const dismissMonthComplete = useCallback(() => setMonthComplete(null), []);

  // P3-B re-gate 5 fix 2 (2026-07-28): dedicated month-complete entry
  // point. Sets the card state and NOTHING else - no clearTimers, no
  // finalizeRef overwrite, no commitSession. Callable from any effect
  // that detects the completing edge without racing an in-flight day
  // sequence. HandoffAmbient at ServiceCalendar.js:433 now uses this.
  const showMonthComplete = useCallback((mc) => {
    if (mc) setMonthComplete(mc);
  }, []);

  // P3-B re-gate 5 fix 3 (2026-07-28): expose sessionMap commit
  // separately from startHandoff so no-service saves can add their
  // day to the strip at zero units without firing the beat clock
  // (Ruling 5: no pill, no toast). Callers use this on save success
  // paths that must NOT trigger the Handoff sequence.
  const commitSessionOnly = useCallback((dayDate, totals) => {
    if (!dayDate) return;
    commitSession(dayDate, totals);
  }, [commitSession]);

  const value = useMemo(() => ({
    phase,
    handoffDay,
    handoffTotals,
    sessionMap,
    monthComplete,
    startHandoff,
    cancelHandoff,
    registerFlightTarget,
    registerPillSource,
    isFlippingDate,
    resetSession,
    dismissMonthComplete,
    showMonthComplete,
    commitSessionOnly,
    // Ref accessors for HandoffLayer (does not participate in React
    // subscription - reads the current DOM element at the moment it
    // schedules the flight).
    _refs: { flightTargetRef, pillSourceRef },
  }), [
    phase, handoffDay, handoffTotals, sessionMap, monthComplete,
    startHandoff, cancelHandoff, registerFlightTarget, registerPillSource,
    isFlippingDate, resetSession, dismissMonthComplete,
    showMonthComplete, commitSessionOnly,
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
    phase: 0,
    handoffDay: null,
    handoffTotals: null,
    sessionMap: {},
    monthComplete: null,
    startHandoff: () => {},
    cancelHandoff: () => {},
    registerFlightTarget: () => () => {},
    registerPillSource: () => () => {},
    isFlippingDate: () => false,
    resetSession: () => {},
    dismissMonthComplete: () => {},
    showMonthComplete: () => {},
    commitSessionOnly: () => {},
    _refs: { flightTargetRef: { current: null }, pillSourceRef: { current: null } },
  };
}

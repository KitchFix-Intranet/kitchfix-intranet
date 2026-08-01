"use client";

// ════════════════════════════════════════════════════════════════════════════
// SousLockup - the landing heading lockup (round 2, L-A + living mark)
// ════════════════════════════════════════════════════════════════════════════
//
// Composition: 48px 1C mark left of the heading + subcopy in one flex row.
// The wake choreography moves here (per round 2) - the hero mark holds rest
// drift only, one wake per page. On this instance only, an idle-flourish
// timer runs while the landing is visible.
//
// Flourish system:
//   - First flourish fires at earliest 12s after mount (wake completes
//     ~0.7s; the 12s bound gives ~11.3s of clear rest so the wake reads
//     as arriving, not as restlessness).
//   - Subsequent flourishes at uniform random 20-45s between them.
//   - Three flourish kinds, each a one-shot CSS animation class:
//       check  - sequential base-lift lap, ~1.3s
//       leg    - single synchronized quarter-step of the turn, ~1.5s
//       glint  - the settled-state brightness pulse, ~0.65s
//   - Between flourishes: rest drift (the mark's default st-rest animation).
//   - Suppressed entirely under prefers-reduced-motion.
//   - Timer suspends on document.visibilitychange (background tabs never
//     animate) and resumes when the tab becomes visible again.
//   - The 8-second-after-state-change pause is implicit: this component
//     only mounts when the landing is visible; asking a question unmounts
//     the landing entirely, and a New Question remounts it (resetting the
//     first-flourish 12s bound).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import SousMark from "./SousMark";

const FLOURISH_KINDS = ["check", "leg", "glint"];
const FIRST_MIN_MS = 12000;
const FIRST_JITTER_MS = 1000;
const NEXT_MIN_MS = 20000;
const NEXT_JITTER_MS = 25000;

function pickFlourishClass() {
  const kind = FLOURISH_KINDS[Math.floor(Math.random() * FLOURISH_KINDS.length)];
  return `sa-mark--flourish-${kind}`;
}

export default function SousLockup({ children }) {
  const [flourishClass, setFlourishClass] = useState("");
  const timerRef = useRef(null);
  const isFirstRef = useRef(true);
  const reducedMotionRef = useRef(false);

  const scheduleNext = useCallback(() => {
    if (reducedMotionRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    const first = isFirstRef.current;
    isFirstRef.current = false;
    const delay = first
      ? FIRST_MIN_MS + Math.random() * FIRST_JITTER_MS
      : NEXT_MIN_MS + Math.random() * NEXT_JITTER_MS;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (typeof document !== "undefined" && document.hidden) {
        // Background tab; re-schedule and try again after the same window.
        scheduleNext();
        return;
      }
      setFlourishClass(pickFlourishClass());
    }, delay);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mql && mql.matches) {
      reducedMotionRef.current = true;
      return;
    }
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      } else if (!timerRef.current && !flourishClass) {
        scheduleNext();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    scheduleNext();
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      document.removeEventListener("visibilitychange", onVis);
    };
    // scheduleNext is stable via useCallback([]); flourishClass intentionally
    // excluded so this effect runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAnimEnd = () => {
    // Guard: ignore wake/rest animation events (flourishClass empty).
    if (!flourishClass) return;
    setFlourishClass("");
    scheduleNext();
  };

  return (
    <div className="sa-lockup" onAnimationEnd={onAnimEnd}>
      <SousMark
        variant="display"
        state="rest"
        size={48}
        wake
        className={flourishClass}
      />
      <div className="sa-lockup-text">{children}</div>
    </div>
  );
}

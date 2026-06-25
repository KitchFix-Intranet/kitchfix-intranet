"use client";

import { useEffect, useRef, useState } from "react";

// useAnimatedNumber - eases the displayed number toward `value` over
// `durationMs`. Used for the live-instrument feel on the Period lens:
// when a save bumps the entered $ figure, the number counts up rather
// than snapping.
//
// Only animates UPWARD changes - within a period, entered-$ is
// monotonic upward as saves land. A period switch causes a downward
// jump (or any jump from a different baseline) and should snap, not
// animate down. The PR-B2 plan's note: "calm, NOT confetti."
//
// `animate` (default true) lets callers disable interpolation while
// still calling the hook unconditionally - the rules-of-hooks
// discipline for components that switch between animated and
// non-animated display modes inside a loop (e.g. per-week subtotals
// where some weeks show entered $ animated and others show projected
// $ static). Callers should NEVER conditionally mount the component
// that calls this hook.
//
// Respects prefers-reduced-motion. Cleans up RAF on unmount + on
// value-change so concurrent animations don't fight each other.
export default function useAnimatedNumber(value, { durationMs = 250, animate = true } = {}) {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    const startValue = displayRef.current;
    if (startValue === value) return;
    // animate=false (caller wants snap), downward jump, or reduced-
    // motion all collapse to the same snap path. The hook still ran;
    // only interpolation is skipped.
    const prefersReduce = typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || value < startValue || prefersReduce) {
      displayRef.current = value;
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      // ease-out cubic - decelerating arrival, the calm feel.
      const eased = 1 - Math.pow(1 - t, 3);
      const next = startValue + (value - startValue) * eased;
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, durationMs, animate]);

  return display;
}

"use client";
// ═══════════════════════════════════════════════════════════════════
// HandoffLayer - fixed-position pill clone for the pillFly beat.
// ═══════════════════════════════════════════════════════════════════
//
// Owner Ruling 1 (Phase 3, 2026-07-25): fixed-position clone, no
// portal. Containing-block chain from html -> .oh-app -> .oh-bound ->
// .sc-root verified CLEAN [code-read Phase 3-B gate 1] - no
// transform/filter/perspective/will-change/contain: on any ancestor
// of this layer, so `position: fixed` is anchored to the viewport as
// intended. Escape hatch (React portal) is pre-authorized but
// unnecessary.
//
// Layer lives as a SIBLING of the modal overlay under .sc-root. The
// modal fades during 660-1210ms; the pill clone travels from the
// modal-internal pill's rect to the RailRing's <circle> rect on the
// same clock.
//
// Motion: JS reads source + target rects at phase 3 start; applies
// `transform: translate(dx, dy) scale(sf)` via CSS transition. The
// transition duration matches the beat table (.55s @ .66s in the
// render). Reduced-motion path skips the clone entirely (coordinator
// bypasses to phase 0 on RM).

import { useEffect, useRef } from "react";
import { useHandoff } from "./coordinator";

export default function HandoffLayer() {
  const { phase, _refs } = useHandoff();
  const cloneRef = useRef(null);

  useEffect(() => {
    // Fire the flight when phase enters 3 (pillFly beat).
    // Reads source + target rects once at phase entry - both elements
    // must be mounted. If either is null the flight is a no-op; the
    // sequence still advances via the coordinator's beat clock.
    if (phase !== 3) return;
    const source = _refs.pillSourceRef.current;
    const target = _refs.flightTargetRef.current;
    const clone = cloneRef.current;
    /* DIAG (2026-07-31, retirement step 1) - state of the three refs
       AT THE MOMENT the phase-3 effect fires. Owner's fiber walk
       polled AFTER phase 3 and saw all three set. If this log shows
       source=false at effect time, HandoffPill mounted + registered
       AFTER this effect ran (race in the same commit). Removed in
       the deletion commit. */
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.log(`[handoff-diag] phase-3 effect t=${Math.round(performance.now())} source=${!!source} target=${!!target} clone=${!!clone}`);
    }
    if (!source || !target || !clone) return;

    const srcRect = source.getBoundingClientRect();
    const tgtRect = target.getBoundingClientRect();
    // Source and target are both viewport-relative. Clone starts at
    // the source and translates to the target center. Scale down
    // proportionally (pill is wider than ring; scale to ~0.4 gives
    // "flies into the ring" reading).
    const startX = srcRect.left;
    const startY = srcRect.top;
    const targetX = tgtRect.left + tgtRect.width / 2 - srcRect.width / 2;
    const targetY = tgtRect.top + tgtRect.height / 2 - srcRect.height / 2;
    const dx = targetX - startX;
    const dy = targetY - startY;

    // Set start position + copy source dimensions (once), then next
    // frame trigger the transform.
    clone.style.left = `${startX}px`;
    clone.style.top = `${startY}px`;
    clone.style.width = `${srcRect.width}px`;
    clone.style.height = `${srcRect.height}px`;
    clone.style.transform = "translate(0, 0) scale(1)";
    clone.style.opacity = "1";

    // Force reflow so the transition sees the starting values, then
    // apply the target transform.
    // eslint-disable-next-line no-unused-expressions
    void clone.offsetWidth;
    clone.classList.add("sc-handoff-clone--flying");
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.4)`;
    clone.style.opacity = "0.7";
  }, [phase, _refs]);

  useEffect(() => {
    // Reset clone visuals when the sequence idles.
    if (phase !== 0) return;
    const clone = cloneRef.current;
    if (!clone) return;
    clone.classList.remove("sc-handoff-clone--flying");
    clone.style.opacity = "0";
    clone.style.transform = "translate(0, 0) scale(1)";
  }, [phase]);

  // P3-B gate-2 (2026-07-28): "idle means idle" - descendants
  // (icon svg + polyline + content spans, 6 nodes total) mount only
  // during the sequence. The clone <div> itself stays mounted so the
  // CSS transition on transform has a stable target node before +
  // after (same P3-A gate-3 lesson: fresh nodes cannot transition).
  // Between saves the layer wrap is empty; the clone div is present
  // but visually + interactively inert (opacity 0, pointer-events
  // none, aria-hidden).
  const active = phase > 0;
  return (
    <div className="sc-handoff-layer" aria-hidden="true">
      <div
        ref={cloneRef}
        className="sc-handoff-clone sc-ar sc-ar--success"
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          opacity: 0,
          pointerEvents: "none",
          zIndex: 10001,
        }}
      >
        {active && (
          <>
            <span className="sc-ar-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span className="sc-ar-content">
              <span className="sc-ar-title">Confirmed</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

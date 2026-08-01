"use client";

// ════════════════════════════════════════════════════════════════════════════
// SousMark - the identity mark, per docs/SOUS_MARK_SPEC.md
// ════════════════════════════════════════════════════════════════════════════
//
// The mark is the Mise on the diamond: four rotated tiles at the base
// positions plus a fixed center mound. Two colorways form one responsive
// identity:
//   1C (display, "variant=display"):  bases + mound in Flame, paths in
//                                     yellow. 24px and above.
//   1A (small,   "variant=small"):    bases + mound in Flame, no paths.
//                                     Below 24px, plus the nav and favicon.
//   nav          ("variant=nav"):     same as small but drives from the
//                                     24-basis geometry so the SVG doesn't
//                                     need to be re-drawn; rendered inline.
//
// Geometry is the 64-basis from the spec, scaled via CSS transform so
// animation keyframes always compute against the same coordinate space.
//
// State machine - external `state` prop drives what the mark renders,
// but transitioning OUT OF `turn` waits for the current orbit iteration
// to complete (animationiteration on the S tile) before swapping. This
// is the "settle handoff" - never swap mid-leg. If the new state is
// `settled` we then attach a one-shot glint class for 700ms.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";

const DISPLAY_BASIS = 64;

export default function SousMark({
  variant = "display",   // "display" | "small" | "nav"
  state = "rest",        // "rest" | "turn" | "write" | "settled" | "part" | "off"
  size = 34,             // px display size
  wake = false,          // play the wake choreography on mount (1C surfaces only)
  onNavy = false,        // white-on-navy tinting (hero + panel band)
  className = "",
}) {
  const [renderedState, setRenderedState] = useState(state);
  const [glinting, setGlinting] = useState(false);
  const bSRef = useRef(null);
  const wakePlayed = useRef(false);

  // Settle handoff - transitioning out of `turn` waits for the S tile's
  // animationiteration so the bases visibly finish the current leg. Any
  // other transition swaps immediately. Glint is a one-shot on settled.
  useEffect(() => {
    if (state === renderedState) return;
    if (renderedState === "turn" && state !== "turn") {
      const el = bSRef.current;
      if (!el) { setRenderedState(state); return; }
      const handler = () => {
        setRenderedState(state);
        if (state === "settled") {
          setGlinting(true);
          setTimeout(() => setGlinting(false), 700);
        }
      };
      el.addEventListener("animationiteration", handler, { once: true });
      return () => el.removeEventListener("animationiteration", handler);
    }
    setRenderedState(state);
    if (state === "settled") {
      setGlinting(true);
      const t = setTimeout(() => setGlinting(false), 700);
      return () => clearTimeout(t);
    }
  }, [state, renderedState]);

  // Wake plays exactly once per mount.
  const wakeClass = wake && !wakePlayed.current ? " sa-mark--wake" : "";
  useEffect(() => { if (wake) wakePlayed.current = true; }, [wake]);

  const scale = size / DISPLAY_BASIS;
  const cls = [
    "sa-mark",
    `sa-mark--${variant}`,
    `sa-mark--st-${renderedState}`,
    onNavy ? "sa-mark--on-navy" : "",
    glinting ? "sa-mark--glint" : "",
    wakeClass,
    className,
  ].filter(Boolean).join(" ");

  return (
    <span
      className="sa-mark-wrap"
      style={{ width: `${size}px`, height: `${size}px` }}
      aria-hidden="true"
    >
      <span
        className={cls}
        style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {variant === "display" && (
          <svg className="sa-mark-paths" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M32 16 L48 32 L32 48 L16 32 Z" />
          </svg>
        )}
        <span className="sa-mark-mound" />
        <span className="sa-mark-b sa-mark-bN" />
        <span className="sa-mark-b sa-mark-bE" />
        <span ref={bSRef} className="sa-mark-b sa-mark-bS" />
        <span className="sa-mark-b sa-mark-bW" />
      </span>
    </span>
  );
}

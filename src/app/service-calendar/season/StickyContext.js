"use client";

// StickyContext - the slim mobile-only context bar (Mobile Overhaul,
// audit-driven Nielsen #1 add). After the user scrolls past the hero
// and the InfoCard, they lose their orienting context. This bar
// appears once they've scrolled past a threshold and sticks under the
// global TopNav. ~36px tall.
//
// Mobile only. CSS gates desktop off via display:none above the
// phone breakpoint. The visibility toggle is rAF-throttled to avoid
// jank; prefers-reduced-motion disables the slide-in transition.
//
// Content forks by account type:
//   per-meal: "<account> · Today Jun 27 · P7 · <pct>% · <n> need entry"
//   fee:      "<account> · Today Jun 27 · P7 · <X/Y> game days"

import { useEffect, useRef, useState } from "react";
import "./stickyContext.css";

const SHOW_AFTER = 220; // pixels - past the hero + roughly the InfoCard

export default function StickyContext({
  accountKey,
  todayLabel,
  periodNum,
  weekNum,
  pctRecorded,
  isFeeAccount = false,
  needsEntry = 0,
  overdue = 0,
  gameDaysEntered = 0,
  totalGameDays = 0,
}) {
  const [visible, setVisible] = useState(false);
  const tickingRef = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (tickingRef.current) return;
      tickingRef.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY || window.pageYOffset || 0;
        setVisible((prev) => {
          const next = y > SHOW_AFTER;
          return next === prev ? prev : next;
        });
        tickingRef.current = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className={`sc-sticky-context ${visible ? "sc-sticky-context--visible" : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className="sc-sticky-context-inner">
        <span className="sc-sticky-context-account">{accountKey || ""}</span>
        <span className="sc-sticky-context-sep" aria-hidden="true">·</span>
        <span className="sc-sticky-context-segment">
          <span className="sc-sticky-context-label">Today</span>
          <span className="sc-sticky-context-value">{todayLabel || "-"}</span>
        </span>
        {periodNum && (
          <>
            <span className="sc-sticky-context-sep" aria-hidden="true">·</span>
            <span className="sc-sticky-context-segment">
              <span className="sc-sticky-context-label">P</span>
              <span className="sc-sticky-context-value">{periodNum}</span>
              {weekNum && <span className="sc-sticky-context-week">W{weekNum}</span>}
            </span>
          </>
        )}
        {isFeeAccount ? (
          totalGameDays > 0 ? (
            <>
              <span className="sc-sticky-context-sep" aria-hidden="true">·</span>
              <span className="sc-sticky-context-segment">
                <span className="sc-sticky-context-value">
                  {gameDaysEntered}/{totalGameDays}
                </span>
                <span className="sc-sticky-context-label">game days</span>
              </span>
            </>
          ) : null
        ) : (
          <>
            {pctRecorded != null && (
              <>
                <span className="sc-sticky-context-sep" aria-hidden="true">·</span>
                <span className="sc-sticky-context-segment">
                  <span className="sc-sticky-context-value">{pctRecorded}%</span>
                </span>
              </>
            )}
            {(needsEntry > 0 || overdue > 0) && (
              <>
                <span className="sc-sticky-context-sep" aria-hidden="true">·</span>
                <span className="sc-sticky-context-segment sc-sticky-context-segment--alert">
                  <span className="sc-sticky-context-value">{needsEntry + overdue}</span>
                  <span className="sc-sticky-context-label">to enter</span>
                </span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

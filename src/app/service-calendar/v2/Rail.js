"use client";

// SC v2 Rail primitives - the shared shell + row atoms used by both
// Calendar and Period modes of the season rail.
//
// Structural laws for the rail (bundle scope §2 + §5):
//   - one label / hero / progress at the top (RailShell + RailHero + RailProgress)
//   - one internal scroll region for the middle content (RailScroll)
//   - exactly one footer button (RailFooter) - rows navigate, footer acts
//   - queue rows and line rows are WHOLE-row targets (a native <button>
//     wrapping the whole span with a chevron affordance)
//   - money format is compact per the overview law (fmt$K), never 2dp
//
// This module is PRESENTATIONAL - all figures resolved by callers via
// overviewDerive.js.

import { useEffect, useRef, useState } from "react";
// P3-B gate-4 (2026-07-28): ring transition write deferred via
// double-rAF - see committedOffset state below. Owner ruling: the
// paint pipeline had no start value at the write moment (ancestor
// hidden at the frame boundary), so the browser reappeared the ring
// already at the new value. Deferring TWO frames lets the browser
// paint the current (old) value, ancestor visibility restore, then
// the new value trip the transition on a painted node.
//
// Retirement plan: when the gate-4 fix verifies (transitionrun +
// transitionend fire), the paint-state log + committed-offset lag
// stay; the gate-3 write/commit/mutation logs get pulled in the same
// commit per owner's one-deletion promise (see comments below).
import { useHandoffSafe } from "./handoff/coordinator";
import useAnimatedNumber from "../useAnimatedNumber";
import "./rail.css";
// P3-A (2026-07-25): accent-rail primitive shared across surfaces
// (rail chips, failure banner, dialog top-rails, notes chip). Imported
// here so any consumer that pulls a Rail primitive gets the accent
// language for free. Also imported explicitly by DayEntryV2 for the
// panel's failure banner + dialog rails.
import "./accentRail.css";

// ─── Shell wrapper ─────────────────────────────────────────────
export function RailShell({ label, children }) {
  return (
    <div className="sc-rail" role="complementary" aria-label={label || "Season rail"}>
      {label && (
        <div className="sc-rail-label">{label}</div>
      )}
      {children}
    </div>
  );
}

// ─── Hero: big animated value + meta line ─────────────────────
// Two call patterns:
//   1. Numeric  - pass `value` (number) + `format` (fn). The number
//      runs through useAnimatedNumber (250ms ease-out; upward only)
//      and each frame is passed to `format` so the display ticks
//      $1.02M -> $1.03M -> $1.05M through the settle. Reduced-motion
//      snaps to the final value.
//   2. String   - pass `value` (pre-formatted string) with no
//      `format`; the hero renders it verbatim (no animation).
//
// aria-live="polite" announces on text change, so the SR reads the
// settled value once ticking finishes (React only re-announces when
// the text node's content actually differs from the previous read).
export function RailHero({ value, format, label, meta, projection, ariaSuffix }) {
  const isNumeric = typeof value === "number" && typeof format === "function";
  const animated = useAnimatedNumber(isNumeric ? value : 0);
  const displayed = isNumeric ? format(animated) : value;
  return (
    <div className="sc-rail-hero">
      {/* OV-3 Wave 4a - hero line is INLINE:
          "$X.XM  ENTERED YTD  · ~$Y projected"
          Value + label + projection sit on one baseline. The old
          two-line meta split moved: the projection joins the top
          line (projection prop); the "N of M days entered" caption
          moves BELOW the progress bar (RailHeroProgressCaption). */}
      <span className="sc-rail-hero-value" aria-live="polite">
        {displayed}
      </span>
      {label && <span className="sc-rail-hero-label">{label}</span>}
      {projection && <span className="sc-rail-hero-projection">{projection}</span>}
      {meta && <span className="sc-rail-hero-meta">{meta}</span>}
      {ariaSuffix && <span className="sc-visually-hidden">{ariaSuffix}</span>}
    </div>
  );
}

// OV-3 Wave 4a - caption rendered BELOW the progress bar. Consumer
// puts this between RailProgress and any following section.
export function RailHeroProgressCaption({ children }) {
  if (!children) return null;
  return <div className="sc-rail-hero-progress-caption">{children}</div>;
}

// ─── Progress bar ──────────────────────────────────────────────
export function RailProgress({ pct, complete }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return (
    <div
      className={`sc-rail-progress${complete ? " sc-rail-progress--complete" : ""}`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="sc-rail-progress-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
}

// ─── Progress ring (P3-A, 2026-07-25) ──────────────────────────
// Peer primitive to RailProgress. RailProgress is UNTOUCHED because
// MLB rail composition must stay byte-identical (owner ruling: MLB
// keeps <RailProgress + RailHeroProgressCaption>). RailRing is a
// per-meal / fee-no-dollar swap-in.
//
// Geometry (SVG values from RENDER_HANDOFF_BLENDED.html:65-73):
//   viewBox 0 0 92 92, cx=46, cy=46, r=39, stroke-width 8, dasharray
//   2*pi*r = 245.04. Rotated -90deg so the arc starts at the top.
//   Compact size (owner pick: 92px wrap; ring geometry is structural
//   sizing, not type/spacing/radius, so px is sanctioned).
//
// Ambient sweep: CSS transition on `stroke-dashoffset` via a duration
// token (rail.css). Any pct change animates the arc; prefers-reduced-
// motion collapses the duration to 0ms via the --duration-* token
// cascade (motion.js header rule).
//
// Variants:
//   default (per-meal): `label` renders the percent inside the ring
//     (e.g. "72%"). Caption OUTSIDE the ring (adjacent
//     RailHeroProgressCaption) carries the fraction "N of M days
//     entered". Both come from consumer scope.
//   showLabel={false} (fee-no-dollar / STL-FL): arc only, no inner
//     label. Caller keeps the existing hero + caption above / beside
//     - the 2B days-confirmed hero already carries the fraction, so
//     duplicating it inside the small ring is redundant (owner pick:
//     option A).
export function RailRing({ pct, label, showLabel = true, complete, ariaLabel }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct || 0)));
  const C = 245.04; // 2 * PI * 39
  const dashOffset = C - (C * clamped) / 100;
  // P3-B gate-4 fix (2026-07-28): double-rAF defer of the SVG style
  // write. Applied ONLY when the pct actually changes from the last
  // rendered value (first mount + no-op updates skip the lag). The
  // paint-state log below reports which ancestor was hidden at the
  // write moment. This defer buys two frames for React to commit,
  // the browser to paint the current value, and any transiently-
  // hidden ancestor to restore its render tree state. Then the
  // NEW value writes onto a painted node, tripping the transition.
  const [committedOffset, setCommittedOffset] = useState(dashOffset);
  useEffect(() => {
    if (committedOffset === dashOffset) return undefined;
    const target = dashOffset;
    let raf2 = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setCommittedOffset(target);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
    };
  }, [dashOffset, committedOffset]);
  // P3-B gate-2 fix (2026-07-28): register the ring container as the
  // handoff target. Deps pinned to the STABLE `registerRingTarget`
  // callback (empty-deps useCallback in coordinator) - NOT the full
  // context value. The full value re-identifies on every phase change
  // (isFlippingDate closes over phase), which caused cleanup+register
  // churn 5x per save. Node identity unaffected either way, but the
  // churn was noise. Instance stamp below (data-ring-instance) proves
  // <circle> node stability across refetch cycles.
  const containerRef = useRef(null);
  const { registerRingTarget } = useHandoffSafe();
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    return registerRingTarget(el);
  }, [registerRingTarget]);
  // Instance stamp: one random ID per RailRing mount, written to the
  // <circle>'s data-ring-instance. If the ID changes between saves,
  // the ring was remounted (transition cannot fire from a fresh node).
  // P3-B gate-2 evidence for the code-read stability claim.
  const instanceIdRef = useRef(null);
  if (instanceIdRef.current == null) {
    instanceIdRef.current = `r${Math.random().toString(36).slice(2, 8)}`;
  }

  // ═══════════════════════════════════════════════════════════════
  // P3-B GATE-3 INSTRUMENTATION (2026-07-28) - dashoffset write trace
  // ═══════════════════════════════════════════════════════════════
  // Owner report: node identity preserved + transition armed at 280ms
  // but ZERO transitionrun events on a pct-moving save. Three logs
  // (all dev-only, gated on NODE_ENV):
  //   A) render-scope log - every render's computed dashOffset value
  //      with perf.now(), so we can correlate React commits with
  //      transition events.
  //   B) MutationObserver on the <circle>'s style attribute - catches
  //      EVERY write (React, foreign scripts, direct DOM manip). If
  //      React re-applies the SAME value in the same frame twice, or
  //      applies while hidden, the observer picks it up.
  //   C) transitionrun / transitionend listeners on the SAME node -
  //      the acceptance signal.
  // Retire when P0 lands - kept as `if (isDev)` gate so removal is
  // one deletion, not a scavenger hunt.
  const isDev = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";
  useEffect(() => {
    if (!isDev) return undefined;
    // eslint-disable-next-line no-console
    console.log(`[ring ${instanceIdRef.current}] commit dashoffset=${dashOffset.toFixed(2)} pct=${clamped} @${performance.now().toFixed(1)}ms`);
    return undefined;
  }, [dashOffset, clamped, isDev]);
  useEffect(() => {
    if (!isDev) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const fg = container.querySelector(".sc-rail-ring-fg");
    if (!fg) return undefined;
    const id = instanceIdRef.current;
    const onRun = (e) => {
      if (e.propertyName !== "stroke-dashoffset") return;
      // eslint-disable-next-line no-console
      console.log(`[ring ${id}] transitionrun stroke-dashoffset @${performance.now().toFixed(1)}ms`);
    };
    const onEnd = (e) => {
      if (e.propertyName !== "stroke-dashoffset") return;
      // eslint-disable-next-line no-console
      console.log(`[ring ${id}] transitionend stroke-dashoffset @${performance.now().toFixed(1)}ms`);
    };
    const onCancel = (e) => {
      if (e.propertyName !== "stroke-dashoffset") return;
      // eslint-disable-next-line no-console
      console.log(`[ring ${id}] transitioncancel stroke-dashoffset @${performance.now().toFixed(1)}ms`);
    };
    fg.addEventListener("transitionrun", onRun);
    fg.addEventListener("transitionend", onEnd);
    fg.addEventListener("transitioncancel", onCancel);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName !== "style") continue;
        const t = performance.now().toFixed(1);
        // eslint-disable-next-line no-console
        console.log(`[ring ${id}] style mutation @${t}ms: ${fg.getAttribute("style")}`);
        // P3-B gate-4 (2026-07-28) - paint-state at the mutation
        // moment. Owner ruling: transition suppressed because element
        // not painted at write time. Walk the ring's ancestor chain
        // and capture display/visibility/opacity/clientRects for each.
        // One save's output pinpoints which ancestor collapsed.
        const chain = [
          ["fg", fg],
          ["ringbox", fg.closest(".sc-rail-ringbox")],
          ["rail", fg.closest(".sc-rail")],
          ["aside", fg.closest("aside")],
          ["drill", fg.closest(".sc-drill")],
          ["scroot", fg.closest(".sc-root")],
        ];
        for (const [name, el] of chain) {
          if (!el) continue;
          const cs = window.getComputedStyle(el);
          // eslint-disable-next-line no-console
          console.log(`[ring ${id}]   ${name} display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity} rects=${el.getClientRects().length}`);
        }
      }
    });
    observer.observe(fg, { attributes: true, attributeFilter: ["style"] });
    // eslint-disable-next-line no-console
    console.log(`[ring ${id}] instrumented @${performance.now().toFixed(1)}ms; getComputedStyle transition=${window.getComputedStyle(fg).transition}`);
    return () => {
      fg.removeEventListener("transitionrun", onRun);
      fg.removeEventListener("transitionend", onEnd);
      fg.removeEventListener("transitioncancel", onCancel);
      observer.disconnect();
    };
  }, [isDev]);
  return (
    <div
      ref={containerRef}
      className={`sc-rail-ring${complete ? " sc-rail-ring--complete" : ""}`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel || `${clamped} percent complete`}
    >
      <svg
        className="sc-rail-ring-svg"
        viewBox="0 0 92 92"
        aria-hidden="true"
      >
        <circle
          className="sc-rail-ring-bg"
          cx="46"
          cy="46"
          r="39"
          fill="none"
        />
        <circle
          className="sc-rail-ring-fg"
          cx="46"
          cy="46"
          r="39"
          fill="none"
          strokeLinecap="round"
          data-ring-instance={instanceIdRef.current}
          /* P3-B gate-4: strokeDashoffset reads the double-rAF-deferred
             `committedOffset`, NOT the freshly-computed `dashOffset`,
             so the DOM write lands on a painted node. */
          style={{ strokeDasharray: C, strokeDashoffset: committedOffset }}
        />
      </svg>
      {showLabel && (
        <div className="sc-rail-ring-txt" aria-hidden="true">
          <span className="sc-rail-ring-n">{label ?? `${clamped}%`}</span>
        </div>
      )}
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────
// OV-3 G13: metaTone optional prop drives the pill's tone class.
//   metaTone="needs"    -> amber "{n} need" pill
//   metaTone="overdue"  -> red   "{n} overdue" pill
//   default (undefined) -> plain muted text (pre-G13 behavior)
// Callers compute the pill copy + tone from their own worst-state
// count (Rail is presentational; no derivation lives here).
export function RailSection({ label, meta, metaTone, children }) {
  return (
    <div className="sc-rail-section">
      <div className="sc-rail-section-head">
        <span className="sc-rail-section-label">{label}</span>
        {meta && (
          <span
            className={`sc-rail-section-meta${metaTone ? ` sc-rail-section-meta--${metaTone}` : ""}`}
          >
            {meta}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Scroll region + bottom fade ───────────────────────────────
// The rail's middle content scrolls internally when it exceeds the
// available height; a bottom fade appears when there's more content
// below the fold. Fade toggles on scroll end.
export function RailScroll({ children }) {
  const scrollRef = useRef(null);
  const [atBottom, setAtBottom] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => {
      const room = el.scrollHeight - el.clientHeight - el.scrollTop;
      setAtBottom(room <= 2);
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    if (ro) ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      if (ro) ro.disconnect();
    };
  }, []);
  return (
    <div className="sc-rail-scroll-wrap">
      <div className="sc-rail-scroll" ref={scrollRef}>
        {children}
      </div>
      {!atBottom && <div className="sc-rail-scroll-fade" aria-hidden="true" />}
    </div>
  );
}

// ─── Queue row: whole-row button, date + status + aging ────────
// mode: "needs-entry" | "overdue". Aging (N days old) only shown for
// overdue rows per the bundle scope.
export function RailQueueRow({ date, status, aging, periodLabel, onClick }) {
  const isOverdue = status === "overdue";
  const dateLabel = formatQueueDate(date);
  const statusLabel = isOverdue
    ? `Overdue · ${aging} ${aging === 1 ? "day" : "days"} old`
    : "Needs entry";
  const ariaLabel = `${dateLabel}, ${statusLabel}${periodLabel ? `, in ${periodLabel}` : ""}, open`;
  return (
    <button
      type="button"
      className={`sc-rail-queue-row sc-rail-queue-row--${isOverdue ? "overdue" : "needs"}`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span className={`sc-rail-queue-dot sc-rail-queue-dot--${isOverdue ? "overdue" : "needs"}`} aria-hidden="true" />
      <span className="sc-rail-queue-body">
        <span className="sc-rail-queue-date">{dateLabel}</span>
        <span className="sc-rail-queue-status">{statusLabel}</span>
      </span>
      <span className="sc-rail-queue-chevron" aria-hidden="true">
        <ChevronRight />
      </span>
    </button>
  );
}

// ─── "N more" overflow row (still a whole-row target) ──────────
export function RailQueueMore({ count, onClick }) {
  return (
    <button
      type="button"
      className="sc-rail-queue-more"
      onClick={onClick}
      aria-label={`Show ${count} more`}
    >
      <span className="sc-rail-queue-more-label">+ {count} more</span>
      <span className="sc-rail-queue-chevron" aria-hidden="true">
        <ChevronRight />
      </span>
    </button>
  );
}

// ─── Line row (season month/period line) ───────────────────────
// tone drives colored value: "done" | "current" | "upcoming" | "off" | "attention"
export function RailLine({ label, value, sublabel, tone, onClick }) {
  const isDone = tone === "done";
  const isAttention = tone === "attention";
  const isOff = tone === "off";
  const isUpcoming = tone === "upcoming";
  const clickable = !!onClick && !isOff;
  const Tag = clickable ? "button" : "div";
  const cls = [
    "sc-rail-line",
    `sc-rail-line--${tone || "in-progress"}`,
    clickable && "sc-rail-line--clickable",
  ].filter(Boolean).join(" ");
  const aria = clickable ? `${label}, ${value}${sublabel ? `, ${sublabel}` : ""}, open` : undefined;
  return (
    <Tag
      type={clickable ? "button" : undefined}
      className={cls}
      onClick={clickable ? onClick : undefined}
      aria-label={aria}
    >
      <span className="sc-rail-line-label">{label}</span>
      <span className="sc-rail-line-body">
        <span className={`sc-rail-line-value${isUpcoming ? " sc-rail-line-value--ghost" : ""}${isAttention ? " sc-rail-line-value--attention" : ""}`}>{value}</span>
        {isDone && (
          <span className="sc-rail-line-check" aria-label="complete">
            <CheckGlyph />
          </span>
        )}
        {sublabel && (
          <span className="sc-rail-line-sub">{sublabel}</span>
        )}
      </span>
      {clickable && (
        <span className="sc-rail-line-chevron" aria-hidden="true">
          <ChevronRight />
        </span>
      )}
    </Tag>
  );
}

// ─── Footer action ────────────────────────────────────────────
// kind: "today" | "oldest-overdue" | "oldest-needs" | "clear-period-overdue" | "caught-up"
export function RailFooter({ kind, label, onClick }) {
  const isCaughtUp = kind === "caught-up";
  if (isCaughtUp) {
    return (
      <div className="sc-rail-footer sc-rail-footer--caught-up">
        <span className="sc-rail-footer-glyph" aria-hidden="true">
          <CheckGlyph />
        </span>
        <span className="sc-rail-footer-caught-up-label">All caught up</span>
      </div>
    );
  }
  return (
    <div className="sc-rail-footer">
      <button
        type="button"
        className="sc-rail-footer-cta"
        onClick={onClick}
        aria-label={label}
      >
        {label}
      </button>
    </div>
  );
}

// ─── Glyphs ────────────────────────────────────────────────────
function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// ─── Utilities ─────────────────────────────────────────────────
function formatQueueDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${DOW[date.getDay()]}, ${MON[date.getMonth()]} ${date.getDate()}`;
}

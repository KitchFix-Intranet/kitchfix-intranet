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
  return (
    <div
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
          style={{ strokeDasharray: C, strokeDashoffset: dashOffset }}
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

"use client";

// Shared progress bar (extracted in cleanup C1a). Consolidates the four
// inline sites that had drifted on class names but shared the same
// track-plus-fill shape:
//   line       PeriodWorkspace ProgressLine (dynamic color via `color` prop)
//   card       MonthCard + PeriodCard footer bars (--complete swaps to
//              --text-success; visually identical between month + period)
//   fullseason FullSeasonCard capstone bar (--complete swaps to
//              --accent-sc-dark; carries progressbar aria on the track)
// The toast bar stays out - its fill animates from 0 with a keyframed
// width, a different anatomy than these three.
//
// Props:
//   pct       0-100 (rendered as inline width%)
//   complete  boolean - swaps to the variant's --complete fill
//   variant   "line" | "card" | "fullseason"  (default "card")
//   color     only meaningful on "line"; inline fill background override
//   ariaLabel only meaningful on "fullseason"; the accessible name

export default function ProgressBar({ pct = 0, complete = false, variant = "card", color, ariaLabel }) {
  const fillStyle = { width: pct + "%" };
  if (variant === "line" && color) fillStyle.background = color;

  const trackProps = variant === "fullseason"
    ? {
        role: "progressbar",
        "aria-valuenow": pct,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-label": ariaLabel,
      }
    : { "aria-hidden": "true" };

  return (
    <div className={`sc-progress sc-progress--${variant}`} {...trackProps}>
      <div
        className={`sc-progress-fill sc-progress-fill--${variant}${complete ? " sc-progress-fill--complete" : ""}`}
        style={fillStyle}
      />
    </div>
  );
}

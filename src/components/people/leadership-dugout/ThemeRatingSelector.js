"use client";

// ════════════════════════════════════════════════════════════════════════════
// ThemeRatingSelector — 1-5 rating buttons with anchor labels
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (shared component, used by WOW Plan + Cycle Review)
// CSS prefix: pp-ldug-
//
// Props:
//   value           number (1-5) | null
//   onChange        (n) => void
//   disabled        bool
//   scaleDirection  "1-low" (default for v1 leadership; future-proofed for v2)
// ════════════════════════════════════════════════════════════════════════════

import { RATING_SCALE } from "@/lib/performanceSchema";

const ANCHORS_1_LOW = ["Unsat.", "Below", "Standard", "Exceeds", "Except."];
const ANCHORS_1_HIGH = ["Except.", "Exceeds", "Standard", "Below", "Unsat."];

export default function ThemeRatingSelector({
  value = null,
  onChange,
  disabled = false,
  scaleDirection = "1-low",
}) {
  const anchors = scaleDirection === "1-low" ? ANCHORS_1_LOW : ANCHORS_1_HIGH;

  return (
    <div className="pp-ldug-rating-selector" role="radiogroup" aria-label="Rating 1 to 5">
      {RATING_SCALE.map((rating, idx) => {
        const isSelected = value === rating.value;
        const cls = `pp-ldug-rating-btn${isSelected ? " pp-ldug-rating-btn--selected" : ""}${disabled ? " pp-ldug-rating-btn--disabled" : ""}`;
        return (
          <button
            key={rating.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => !disabled && onChange?.(rating.value)}
            className={cls}
          >
            <span className="pp-ldug-rating-num">{rating.value}</span>
            <span className="pp-ldug-rating-anchor">{anchors[idx]}</span>
          </button>
        );
      })}
    </div>
  );
}
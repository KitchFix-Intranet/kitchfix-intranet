"use client";

// ════════════════════════════════════════════════════════════════════════════
// DeltaFlag — calibration view callout for self vs manager rating gaps
//
// Module: People Portal · Leadership Dugout
// Sprint: 2
// CSS prefix: pp-ldug-
//
// Auto-flags themes where |self - manager rating| ≥ delta_flag_threshold (2).
// ════════════════════════════════════════════════════════════════════════════

export default function DeltaFlag({ selfRating, managerRating, threshold = 2, compact = false }) {
  if (selfRating == null || managerRating == null) return null;
  const delta = Math.abs(managerRating - selfRating);
  if (delta < threshold) return null;

  const sign = managerRating > selfRating ? "+" : "−";

  if (compact) {
    return (
      <span className="pp-ldug-delta pp-ldug-delta--chip" title={`Self: ${selfRating}, Manager: ${managerRating}`}>
        Δ{delta}
      </span>
    );
  }

  return (
    <div className="pp-ldug-delta pp-ldug-delta--callout">
      <span className="pp-ldug-delta-icon" aria-hidden>⚠</span>
      <span>
        <strong>Δ{delta}</strong> — manager is {sign}{delta} vs self ({selfRating} → {managerRating}). Worth discussing in the conversation.
      </span>
    </div>
  );
}
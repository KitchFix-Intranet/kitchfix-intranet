"use client";

// ════════════════════════════════════════════════════════════════════════════
// RoleAnchorDrawer — surfaces the role-specific Cadence Matrix anchor
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (generic anchors)  →  v2 (real Cadence Matrix from PB-001)
// CSS prefix: pp-ldug-
// ════════════════════════════════════════════════════════════════════════════

const GENERIC_ANCHORS = {
  people: {
    standard: "Holds team accountable to standards. Coaches in real time. Manages performance issues without escalation.",
    exceeds: "Develops people at a faster rate than peers. Builds bench. Promotes from within.",
  },
  operations: {
    standard: "Service runs cleanly. HACCP / safety logs current. Equipment issues surfaced and resolved within 48h.",
    exceeds: "Pre-shift cadence is example-setting. Anticipates equipment issues before they hit. Cross-account ops support.",
  },
  financial: {
    standard: "Hits food cost target ±0.5%. Labor within 2% of plan. Period close clean and on time.",
    exceeds: "Beats food cost by 0.5%+ consistently. Drives labor efficiencies. Owns full P&L commentary.",
  },
  client: {
    standard: "Daily client interaction. Concerns addressed within 24h. Quarterly business review held on cadence.",
    exceeds: "Client volunteers public praise. Trusted advisor. New scope opportunities surfaced.",
  },
  culinary: {
    standard: "Menu hits cycle on time. Dish-out quality consistent across services. Allergen protocols enforced.",
    exceeds: "Menu innovation drives client engagement. Develops culinary talent. Influences corporate culinary direction.",
  },
  compliance: {
    standard: "All required certifications current. Health-dept-ready at all times. Allergen and incident protocols followed.",
    exceeds: "Sets compliance standard for the region. Trains other sites. Zero findings on health/regulatory inspections.",
  },
};

export default function RoleAnchorDrawer({ role, theme, open, onClose }) {
  if (!open) return null;
  const anchors = GENERIC_ANCHORS[theme] || {};
  return (
    <>
      <div className="pp-ldug-anchor-backdrop" onClick={onClose} />
      <div className="pp-ldug-anchor-drawer" role="dialog" aria-label="Role anchor">
        <div className="pp-ldug-anchor-drawer-header">
          <h4>Role anchor — {role} · {theme}</h4>
          <button onClick={onClose} className="pp-ldug-anchor-drawer-close" aria-label="Close">×</button>
        </div>
        <div className="pp-ldug-anchor-section">
          <span className="pp-ldug-anchor-label">Rating 3 — Meets Standard</span>
          <p>{anchors.standard || "Standard anchor pending Cadence Matrix integration."}</p>
        </div>
        <div className="pp-ldug-anchor-section">
          <span className="pp-ldug-anchor-label">Rating 4 — Exceeds Standard</span>
          <p>{anchors.exceeds || "Exceeds anchor pending Cadence Matrix integration."}</p>
        </div>
        <div className="pp-ldug-anchor-footnote">
          v1 anchors are generic. Future iteration wires real role-specific anchors from PB-001 Cadence Matrix.
        </div>
      </div>
    </>
  );
}
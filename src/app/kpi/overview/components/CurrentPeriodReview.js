"use client";
// src/app/kpi/overview/components/CurrentPeriodReview.js
//
// R-109 · the "Needs review today" cards. Sits beneath the
// CurrentPeriodTable on Overview CP. Two cards side-by-side, amber
// left border. Suppressed if there is nothing to review.
//
// Populated from the two payloads the table already fetched:
//   labor.board.pending_hours + amount        - hours awaiting approval
//   purchasing.compliance.total_count + $     - card charges without a GL
//
// Copy is fixed per prompt § 0's render.

const dollar0 = (n) => (Number(n || 0) < 0 ? "-$" : "$") + Math.abs(Math.round(Number(n || 0))).toLocaleString("en-US");

export default function CurrentPeriodReview({ labor, purchasing }) {
  const items = [];

  // Labor · pending approval. Labor board carries an approval signal;
  // hourly waiting for a manager to sign off counts as spent under
  // R-103's definition, so it shows here as review-required.
  const laborPending = laborPendingSummary(labor);
  if (laborPending) items.push(laborPending);

  // Purchasing · uncoded card charges (compliance panel data).
  const purchPending = purchasingPendingSummary(purchasing);
  if (purchPending) items.push(purchPending);

  if (items.length === 0) return null;

  return (
    <div className="kpi-ov-cp-rv">
      <div className="kpi-ov-cp-rv-h">
        <span className="kpi-ov-cp-rv-t">Needs review today</span>
        <span className="kpi-ov-cp-pill kpi-ov-cp-pill-amb">{items.length}</span>
      </div>
      <div className="kpi-ov-cp-rv-items">
        {items.map((it, i) => (
          <div key={i} className="kpi-ov-cp-rv-item">
            <div>
              <div className="kpi-ov-cp-rv-item-t">{it.title}</div>
              <div className="kpi-ov-cp-rv-item-s">{it.detail}</div>
            </div>
            {it.href && (
              <a className="kpi-ov-cp-rv-go" href={it.href}>Open</a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function laborPendingSummary(labor) {
  if (!labor) return null;
  const board = labor.board || {};
  // Prefer aggregate signals when the labor route ships them. Fall
  // back to summing per-worker approval-waiting hours if surface-level
  // signals are absent. Render copy: "N hours waiting on approval".
  const pendingHours =
    Number(board.pending_approval_hours || 0)
    || Number(board.unapproved_hours || 0)
    || 0;
  if (!(pendingHours > 0)) return null;
  const pendingAmount =
    Number(board.pending_approval_amount || 0)
    || Number(board.unapproved_amount || 0)
    || null;
  const detail = pendingAmount != null
    ? `Labor · ${dollar0(pendingAmount)} · counts as spent until signed off`
    : "Labor · counts as spent until signed off";
  return {
    title: `${Math.round(pendingHours)} hours waiting on approval`,
    detail,
    href: null,
  };
}

function purchasingPendingSummary(purchasing) {
  if (!purchasing) return null;
  const comp = purchasing.compliance || null;
  if (!comp) return null;
  const count = Number(comp.total_count || 0);
  if (!(count > 0)) return null;
  const amount = Number(comp.total_amount || 0);
  const oldest = comp.oldest_age_days;
  const detail = `Purchasing · ${dollar0(amount)}${oldest != null ? ` · oldest ${oldest} day${oldest === 1 ? "" : "s"}` : ""}`;
  return {
    title: `${count} card charge${count === 1 ? "" : "s"} need a P&L line`,
    detail,
    href: null,
  };
}

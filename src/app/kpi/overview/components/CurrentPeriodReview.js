"use client";
// src/app/kpi/overview/components/CurrentPeriodReview.js
//
// R-109 · the "Needs review today" cards. Sits beneath the
// CurrentPeriodTable on Overview CP. Two cards side-by-side, amber
// left border. Suppressed if there is nothing to review.
//
// 2026-11-09, Kevin ruling (supersedes 2026-09-24).
//
// Previously the purchasing headline read `purchasing.card_charges`
// (loadCardCharges: uncoded api + report-only merge). Retired. The
// Cards purchasing fold and this review item now share one derivation
// over `purchasing.actuals` via uncodedCardCount - so the count on
// this card and the absence of those rows in the Cards fold table
// describe the same set. The old CARD_FEED_PAUSED flag is retired
// too; the stale comment claimed the feed had been down since
// 2026-10-06, but TXR - AZ carries itemized card charges dated
// 2026-11-02 through 2026-11-06.

import { uncodedCardCount } from "@/lib/kpi/overview/uncodedCards";

const dollar0 = (n) => (Number(n || 0) < 0 ? "-$" : "$") + Math.abs(Math.round(Number(n || 0))).toLocaleString("en-US");

export default function CurrentPeriodReview({ labor, purchasing }) {
  const items = [];

  // Labor · pending approval. Labor board carries an approval signal;
  // hourly waiting for a manager to sign off counts as spent under
  // R-103's definition, so it shows here as review-required.
  const laborPending = laborPendingSummary(labor);
  if (laborPending) items.push(laborPending);

  // Purchasing · uncoded card charges. Sourced from the shared
  // uncodedCardCount off purchasing.actuals so the Cards fold and
  // this card read the same set.
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
  // Kevin 2026-09-15 follow-up 4. The prior read looked for board.
  // pending_approval_hours / board.unapproved_hours - neither exists
  // at the top level of the labor payload. Per-week `unapproved_hours`
  // does (attachWeeklyBasisToBoard sets it on every week); sum across
  // the four weeks. Dollar equivalent = pending_hours × avg_rate
  // (board.avg_rate is the range's payroll-weighted average). Card
  // suppression only kicks in on genuine zero.
  const weeks = Array.isArray(board.weeks) ? board.weeks : [];
  const pendingHours = weeks.reduce((s, w) => s + Number(w.unapproved_hours || 0), 0);
  if (!(pendingHours > 0.005)) return null;
  const avgRate = Number(board.avg_rate || 0);
  const pendingAmount = avgRate > 0 ? pendingHours * avgRate : null;
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
  const actuals = Array.isArray(purchasing.actuals) ? purchasing.actuals : null;
  if (!actuals) return null;
  const { n, total } = uncodedCardCount(actuals);
  if (!(n > 0)) return null;
  return {
    title: `${n} card ${n === 1 ? "charge needs" : "charges need"} coding`,
    detail: `Cards · ${dollar0(total)} · not counted in Food until a category is picked`,
    href: null,
  };
}

"use client";
// ═══════════════════════════════════════════════════════════════════
// BulkReview - the shared itemised review surface (Phase 2A, owner
// Ruling 1 2026-07-24). Both bulk paths (All match projections + Enter
// custom values) converge here. Replaces the two near-identical inline
// IIFEs in ServiceCalendar.js.
// ═══════════════════════════════════════════════════════════════════
//
// Props:
//   days          - [{ date, actual, projected, priceAtDate, totals, hasActuals }]
//   serviceGroups - the account's service catalog (for per-service expand)
//   subtitle      - scoreboard subtitle text ("Match projections - N days")
//   statusPill    - scoreboard pill text ("projected totals" / "custom totals")
//   headerTotals  - { meals, revenue } computed by the caller (server-derived
//                   sums; never client-computed money)
//   perDayRow     - fn(day) -> { meals, revenue } for each row's display
//   perDayServices - fn(day) -> [{ serviceId, serviceName, value }] for the
//                   expand detail
//   overwrites    - Map<date, { prevMeals, prevServices }> for days already
//                   having actuals (counts only; no currency per standing
//                   rule + owner ruling on destructive-context numbers)
//   isFeeAccount  - hides revenue in the row's right cluster
//   acctName      - scoreboard account label
//   saving        - disables Confirm
//   confirmLabel  - button copy ("Confirm & save")
//   onConfirm     - fires the write path (handleBulkConfirm or handleBulkSave)
//   onBack        - closes the review
//
// Reuses:
//   - `.sc-day--review` scoreboard + action bar (same as the two
//     retired IIFEs).
//   - `.sc-bulk-review-list` + `.sc-bulk-review-item` (dayDetail.css:1006).
//   - Ledger's expand pattern: local `expanded` Set, `role="button"`,
//     `aria-expanded`. One expand interaction across the product.

import { useState } from "react";
import { fmt$, fmtDateShort } from "../../season/format";

export default function BulkReview({
  days,
  serviceGroups,
  subtitle,
  statusPill,
  headerTotals,
  perDayRow,
  perDayServices,
  overwrites,
  isFeeAccount,
  acctName,
  saving,
  confirmLabel = "Confirm & save",
  onConfirm,
  onBack,
  cardRef,
  titleId = "sc-bulk-review-title",
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (date) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(date)) next.delete(date); else next.add(date);
    return next;
  });

  const overwriteCount = overwrites ? overwrites.size : 0;

  return (
    <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onBack(); }}>
      <div
        ref={cardRef}
        className="sc-overlay-card"
        data-density="comfortable"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sc-day sc-day--review">
          <div className="sc-day-scoreboard sc-day-review-board">
            <div className="sc-day-sb-row1">
              <div className="sc-day-sb-ctx">
                <span className="sc-day-review-title2" id={titleId}>{subtitle}</span>
                {acctName && <span className="sc-day-sb-account">{acctName}</span>}
              </div>
              <button className="sc-day-review-back" onClick={onBack}>‹ Go back</button>
            </div>
            <div className="sc-day-sb-line">
              <div className="sc-day-sb-fig">
                {!isFeeAccount && Number.isFinite(headerTotals?.revenue) && (
                  <span className="sc-day-sb-amount sc-day-sb-amount--recorded">
                    {fmt$(headerTotals.revenue)}
                  </span>
                )}
                {Number.isFinite(headerTotals?.meals) && (
                  <span className="sc-day-sb-meals">
                    {headerTotals.meals.toLocaleString()} meals
                  </span>
                )}
              </div>
              <span className="sc-day-sb-status sc-day-sb-status--entry">{statusPill}</span>
            </div>
          </div>

          <div className="sc-day-body">
            {overwriteCount > 0 && (
              <p className="sc-bulk-review-warning" role="note">
                <span className="sc-bulk-review-warning-icon" aria-hidden="true">⚠</span>
                {" "}
                <strong>{overwriteCount} of these day{overwriteCount === 1 ? "" : "s"} already ha{overwriteCount === 1 ? "s" : "ve"} counts.</strong>
                {" Confirming will replace them."}
              </p>
            )}

            <ul className="sc-bulk-review-list">
              {days.map(d => {
                const row = perDayRow(d);
                const isOpen = expanded.has(d.date);
                const ow = overwrites?.get(d.date);
                return (
                  <li key={d.date} className={`sc-bulk-review-item sc-bulk-review-item--expandable${isOpen ? " sc-bulk-review-item--open" : ""}`}>
                    <div
                      className="sc-bulk-review-row sc-bulk-review-row--toggle"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => toggle(d.date)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(d.date); }
                      }}
                    >
                      <span className="sc-bulk-review-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                      <span className="sc-bulk-review-date">{fmtDateShort(d.date)}</span>
                      <span className="sc-bulk-review-vals">
                        <span className="sc-bulk-review-meals">{row.meals.toLocaleString()} meals</span>
                        {!isFeeAccount && Number.isFinite(row.revenue) && (
                          <span className="sc-bulk-review-rev">{fmt$(row.revenue)}</span>
                        )}
                      </span>
                      {ow && (
                        <span className="sc-bulk-review-overwrite">
                          {"⚠ replacing "}
                          <strong>{ow.prevMeals.toLocaleString()} meal{ow.prevMeals === 1 ? "" : "s"}</strong>
                          {ow.prevServices > 0 ? ` across ${ow.prevServices} service${ow.prevServices === 1 ? "" : "s"}` : ""}
                        </span>
                      )}
                    </div>
                    {isOpen && (
                      <ul className="sc-bulk-review-detail">
                        {perDayServices(d).map(en => (
                          <li key={en.serviceId} className="sc-bulk-review-detail-row">
                            <span className="sc-bulk-review-detail-name">{en.serviceName}</span>
                            <span className="sc-bulk-review-detail-qty">{Number(en.value).toLocaleString()}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>

            <p className="sc-bulk-review-footer-note">
              Saves as one batch. All {days.length} or none.
            </p>
          </div>

          <div className="sc-day-footer">
            <div className="sc-day-actions">
              <button className="sc-btn sc-btn--outline" onClick={onBack}>Go back</button>
              <button
                className="sc-btn sc-btn--primary"
                disabled={saving || days.length === 0}
                onClick={onConfirm}
              >
                {saving ? "Saving..." : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

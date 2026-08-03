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
//   skips              - Map<date, Set<serviceId>> - (service, day) pairs the
//                        write path will refuse (archive-edge guard, 2026-07-25).
//                        Mount-site-computed, matches the write predicate.
//   batchSkipCount     - total pair-count across the batch. Informational
//                        line above the list, quiet treatment; amber stays
//                        reserved for overwrites.
//   zeroApplicableDays - Set<date> for days where every entry is skipped.
//                        Row shows "No services offered this day" and is
//                        excluded from the writable-N footer count.
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

import { useMemo, useState } from "react";
import { fmt$, fmtDateShort } from "../../season/format";
import { LEDGER_HEAD_FEE } from "../../DayDetail";

export default function BulkReview({
  days,
  serviceGroups,
  subtitle,
  statusPill,
  headerTotals,
  perDayRow,
  perDayServices,
  overwrites,
  skips,
  batchSkipCount = 0,
  zeroApplicableDays,
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

  // sc-bulk-ui PR 2 item 3 (2026-08-03): the expanded per-service
  // detail used to render as a flat <ul> with no styling and no
  // grouping. On accounts with multiple groups sharing service
  // names (STL - FL, TXR - AZ, etc.) that produced the "Breakfast
  // Lunch Dinner Breakfast Lunch Dinner" repetition owner flagged:
  // correct data that read as a bug. Bucket by group so the same
  // name in two groups reads as two group sections, not two loose
  // rows. Order preserved via serviceGroups declaration order so
  // the review section order matches the modal's group order.
  // colIndex -> groupName is O(services) once; the per-row lookup
  // is O(1).
  const serviceGroupMap = useMemo(() => {
    const m = new Map();
    for (const g of serviceGroups || []) {
      for (const s of g.services || []) m.set(s.colIndex, g.name);
    }
    return m;
  }, [serviceGroups]);

  const overwriteCount = overwrites ? overwrites.size : 0;
  // Writable-N = days that will produce at least one row. Excludes
  // zero-applicable days (all pairs archived). Footer "All N or none"
  // reflects the post-guard payload, not the pre-guard form.
  const zeroApplicableCount = zeroApplicableDays ? zeroApplicableDays.size : 0;
  const writableDays = days.length - zeroApplicableCount;

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
            {batchSkipCount > 0 && (
              <p className="sc-bulk-review-skipnote" role="note">
                {batchSkipCount.toLocaleString()} value{batchSkipCount === 1 ? "" : "s"} will be skipped on days where the service is not offered.
              </p>
            )}

            {overwriteCount > 0 && (() => {
              // Split the batch line: some overwrites are entered days
              // with real counts; others are no-service cancellations
              // (all zeros). Report both counts distinctly so the
              // operator sees exactly what will be replaced.
              let enteredCount = 0, noServiceCount = 0;
              for (const ow of overwrites.values()) {
                if (ow.isNoService) noServiceCount++;
                else enteredCount++;
              }
              const parts = [];
              if (enteredCount > 0) {
                parts.push(`${enteredCount} already ha${enteredCount === 1 ? "s" : "ve"} counts`);
              }
              if (noServiceCount > 0) {
                parts.push(`${noServiceCount} ${noServiceCount === 1 ? "is" : "are"} marked no service`);
              }
              const dayPhrase = `${overwriteCount} of these day${overwriteCount === 1 ? "" : "s"}`;
              return (
                <p className="sc-bulk-review-warning" role="note">
                  <span className="sc-bulk-review-warning-icon" aria-hidden="true">⚠</span>
                  {" "}
                  <strong>{dayPhrase} - {parts.join(", ")}.</strong>
                  {" Confirming will replace them."}
                </p>
              );
            })()}

            <ul className="sc-bulk-review-list">
              {days.map(d => {
                const row = perDayRow(d);
                const isOpen = expanded.has(d.date);
                const ow = overwrites?.get(d.date);
                const daySkips = skips?.get(d.date);
                const isZeroApplicable = zeroApplicableDays?.has(d.date);
                return (
                  <li key={d.date} className={`sc-bulk-review-item sc-bulk-review-item--expandable${isOpen ? " sc-bulk-review-item--open" : ""}${isZeroApplicable ? " sc-bulk-review-item--not-offered" : ""}`}>
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
                      {isZeroApplicable ? (
                        <span className="sc-bulk-review-skipmark">
                          No services offered this day - will not be written
                        </span>
                      ) : ow ? (
                        <span className="sc-bulk-review-overwrite">
                          {"⚠ "}
                          {ow.isNoService ? (
                            <>replacing <strong>&quot;no service&quot;</strong> status</>
                          ) : (
                            <>replacing <strong>{ow.prevMeals.toLocaleString()} meal{ow.prevMeals === 1 ? "" : "s"}</strong>{ow.prevServices > 0 ? ` across ${ow.prevServices} service${ow.prevServices === 1 ? "" : "s"}` : ""}</>
                          )}
                        </span>
                      ) : null}
                    </div>
                    {isOpen && (() => {
                      // Bucket the flat perDayServices output by group.
                      // Preserve serviceGroups declaration order so the
                      // review's group order matches the modal's.
                      const byGroup = new Map();
                      for (const en of perDayServices(d)) {
                        const groupName = serviceGroupMap.get(en.serviceId) || "";
                        if (!byGroup.has(groupName)) byGroup.set(groupName, []);
                        byGroup.get(groupName).push(en);
                      }
                      const orderedGroupNames = (serviceGroups || [])
                        .map(g => g.name)
                        .filter(n => byGroup.has(n));
                      // Trailing unnamed bucket (shouldn't happen with a
                      // correct serviceGroupMap, but defended so a data
                      // shape drift renders visibly rather than dropping
                      // rows silently).
                      if (byGroup.has("") && !orderedGroupNames.includes("")) {
                        orderedGroupNames.push("");
                      }
                      return (
                        <div className="sc-bulk-review-detail">
                          {orderedGroupNames.map(groupName => (
                            <section key={groupName || "(other)"} className="sc-bulk-review-detail-group">
                              {groupName && (
                                <header className="sc-bulk-review-detail-group-title">
                                  {groupName}
                                </header>
                              )}
                              {/* Reuse the modal's ledger primitive
                                  (dayDetail.css:1178) at its 2-col fee
                                  shape - name + qty. Same subgrid the
                                  modal uses for its off-schedule chip
                                  measurement pass in PR 2 item 2; the
                                  two surfaces now speak the same
                                  ledger grammar. */}
                              <div className="sc-day-ledger sc-day-ledger--fee">
                                {LEDGER_HEAD_FEE}
                                {byGroup.get(groupName).map(en => {
                                  const skipped = daySkips?.has(en.serviceId);
                                  return (
                                    <div
                                      key={en.serviceId}
                                      className={`sc-day-row sc-day-row--ledger${skipped ? " sc-bulk-review-detail-row--skipped" : ""}`}
                                    >
                                      <div className="sc-day-row-left">
                                        <span className="sc-day-row-name">{en.serviceName}</span>
                                      </div>
                                      <span className="sc-bulk-review-detail-qty">
                                        {skipped ? "not offered" : Number(en.value).toLocaleString()}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </section>
                          ))}
                        </div>
                      );
                    })()}
                  </li>
                );
              })}
            </ul>

            <p className="sc-bulk-review-footer-note">
              Saves as one batch. All {writableDays.toLocaleString()} or none.
            </p>
          </div>

          <div className="sc-day-footer">
            <div className="sc-day-actions">
              <button className="sc-btn sc-btn--outline" onClick={onBack}>Go back</button>
              <button
                className="sc-btn sc-btn--primary"
                disabled={saving || writableDays === 0}
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

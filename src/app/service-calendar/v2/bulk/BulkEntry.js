"use client";
// ═══════════════════════════════════════════════════════════════════
// BulkEntry - pos-style bulk custom-entry panel (Phase 2A, owner
// redline #11 / Ruling 2 2026-07-24). Replaces the legacy .sc-day
// shell that dropped the operator into a v1 rendering on PDC.
// ═══════════════════════════════════════════════════════════════════
//
// Reuses GroupBlock / ServiceRow imported from DayEntryV2 (same
// classes as the single-day modal, per computed-style diff gate).
// Passes hideAmount=true so the per-day Amount column is omitted -
// amounts vary per day, so a single amount here would be wrong. The
// amount arrives in the shared BulkReview surface after Confirm.
//
// Contract:
//   - Same values applied to every selected day.
//   - Untouched services stay untouched per-day (handleBulkSave's
//     empty-guard). The primary is disabled until at least one
//     value is entered.
//   - Primary hands off to a review step (setBulkCustomReviewOpen)
//     which lands on BulkReview.

import { useState, useCallback } from "react";
import { X } from "../../Icons";
import { GroupBlock } from "../entry/DayEntryV2";

export default function BulkEntry({
  daysCount,
  serviceGroups,
  values,             // { colIndex: string } - hoisted state (bulkValues in ServiceCalendar)
  onChange,           // (colIndex, value) => void
  onCancel,
  onReview,           // opens the shared BulkReview after "Review N days"
  saving,
  accountSegment,
  cardRef,
  syntheticDay,       // { date, projected, actual, priceAtDate } - the "template" day
                      // BulkEntry needs to render pos-style rows. First selected
                      // day works (matches the existing "Init bulk values from
                      // first selected day's projections" pattern at :2035).
}) {
  // touched Set: whichever colIndexes the operator has typed into.
  // Mirrors DayEntryV2's touched semantics so ServiceRow's ghost /
  // solid states behave identically.
  const [touched, setTouched] = useState(() => new Set());
  const handleChange = useCallback((colIndex, value) => {
    const clean = String(value ?? "").replace(/[^0-9]/g, "");
    onChange(colIndex, clean);
    setTouched(prev => {
      const next = new Set(prev);
      if (clean === "") next.delete(colIndex); else next.add(colIndex);
      return next;
    });
  }, [onChange]);

  const hasAnyValue = touched.size > 0;

  // GroupBlock needs {editValues, groupSummary, projectedGroupSummary}.
  // Provide the same signatures the single-day modal uses so the
  // rendered card is the same class tree.
  const projectedGroupSummary = useCallback((group) => {
    let meals = 0, revenue = 0;
    for (const s of group.services) {
      const p = syntheticDay?.projected?.[s.colIndex] ?? 0;
      const price = syntheticDay?.priceAtDate?.[s.colIndex] ?? s.price ?? 0;
      meals += p;
      revenue += p * price;
    }
    return { meals, revenue };
  }, [syntheticDay]);

  const groupSummary = useCallback((group) => {
    // In BULK context the "entered" totals are per-day (values × days),
    // but the group card is a template - show the per-day sum only.
    let meals = 0, revenue = 0;
    for (const s of group.services) {
      const v = values[s.colIndex];
      if (v === undefined || v === "") continue;
      const n = Number(v) || 0;
      const price = syntheticDay?.priceAtDate?.[s.colIndex] ?? s.price ?? 0;
      meals += n;
      revenue += n * price;
    }
    return { meals, revenue };
  }, [values, syntheticDay]);

  // Match-projections: fill each service in this group with its
  // projected value. Mirrors DayEntryV2's fillGroupWithProjections but
  // without the stagger animation (bulk context, no per-day flash).
  const onFillProjections = useCallback((group) => {
    for (const s of group.services) {
      const p = syntheticDay?.projected?.[s.colIndex];
      if (p != null) handleChange(s.colIndex, String(p));
    }
  }, [handleChange, syntheticDay]);

  return (
    <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div
        ref={cardRef}
        className="sc-overlay-card"
        data-density="comfortable"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-bulk-entry-title"
        tabIndex={-1}
      >
        <div className="sc-v2-entry">
          <div className="sc-v2-entry-head">
            <div className="sc-v2-entry-head-brand">
              <h2 className="sc-v2-entry-title" id="sc-bulk-entry-title">
                Bulk entry - {daysCount} day{daysCount === 1 ? "" : "s"}
              </h2>
              <span className="sc-v2-entry-account">
                Enter values once, apply to all {daysCount} selected day{daysCount === 1 ? "" : "s"}.
              </span>
            </div>
            <button className="sc-day-close" onClick={onCancel} aria-label="Close">
              <X size="sm" />
            </button>
          </div>

          <div className="sc-v2-entry-body">
            <div className="sc-v2-entry-list">
              {serviceGroups.map(group => (
                <GroupBlock
                  key={group.name}
                  group={group}
                  day={syntheticDay}
                  editValues={values}
                  touched={touched}
                  flashMap={null}
                  accountSegment={accountSegment}
                  onChange={handleChange}
                  onFillProjections={onFillProjections}
                  groupSummary={groupSummary}
                  projectedGroupSummary={projectedGroupSummary}
                  expanded={true}
                  variant="bulk"
                />
              ))}
            </div>
          </div>

          <div className="sc-day-footer">
            <div className="sc-day-actions">
              <button className="sc-btn sc-btn--outline" onClick={onCancel}>Cancel</button>
              <button
                className="sc-btn sc-btn--primary"
                disabled={saving || !hasAnyValue}
                onClick={onReview}
              >
                {`Review ${daysCount} day${daysCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

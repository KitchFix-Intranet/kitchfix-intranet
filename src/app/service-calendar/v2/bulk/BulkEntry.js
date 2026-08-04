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

import { useState, useCallback, useMemo } from "react";
import { X } from "../../Icons";
import { GroupBlock } from "../entry/DayEntryV2";
import SpringTrainingSection from "../entry/SpringTrainingSection";

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
  // sc-bulk-ui PR 2 item 2 (2026-08-03): off-schedule annotation
  // computed by the parent against the ACTUAL selected days, not
  // the syntheticDay. Passed through to GroupBlock -> ServiceRow.
  // Absence = no chip.
  getNotScheduled = null,
  // Bulk on fee-no-dollar (owner Ruling 1, 2026-08-04). Two behavior
  // changes when true:
  //   1. variant flip: GroupBlock renders as "fee" (2-col Service +
  //      Qty; no Rate cell, no Amount cell). Closes the rate-cell
  //      "$0.00 / meal" leak on STL-FL where every service is $0.
  //   2. Spring Training grouping: the four " - ST" services peel
  //      out of their real MLB / MiLB groups into a synthetic ST
  //      section at the top (owner Ruling 2). No phase gating in
  //      bulk - phase is per-day, bulk is per-selection; the "Not
  //      scheduled (N of M)" chip carries the per-day truth.
  feeNoDollar = false,
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
  // Accepts the synthetic ST group as-is because it carries the same
  // { services: [...] } shape as a real group.
  const onFillProjections = useCallback((group) => {
    for (const s of group.services) {
      const p = syntheticDay?.projected?.[s.colIndex];
      if (p != null) handleChange(s.colIndex, String(p));
    }
  }, [handleChange, syntheticDay]);

  // Bulk on fee-no-dollar (owner Ruling 2, 2026-08-04). Spring Training
  // is a grouping, not a state - render it always, no phase gating.
  // stServices flattens the four " - ST" services with tier=g.name
  // (SpringTrainingSection renders sub-tier headers from that field).
  // nonStGroups strips ST services from their real MLB / MiLB groups
  // and drops any group left empty after the strip (STL - FL's MLB
  // group holds only the two ST services and disappears from bulk).
  // Data untouched: services keep their real group membership in the
  // catalog - this is a display-only reshape at the bulk entry surface.
  const { stServices, nonStGroups } = useMemo(() => {
    if (!feeNoDollar) return { stServices: [], nonStGroups: serviceGroups };
    const st = [];
    const rest = [];
    for (const g of serviceGroups) {
      const kept = [];
      for (const s of g.services) {
        if (typeof s.name === "string" && s.name.endsWith(" - ST")) {
          st.push({ ...s, tier: g.name });
        } else {
          kept.push(s);
        }
      }
      if (kept.length > 0) rest.push({ ...g, services: kept });
    }
    return { stServices: st, nonStGroups: rest };
  }, [serviceGroups, feeNoDollar]);

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
              {/* Spring Training grouping - bulk fee-no-dollar only.
                  #613 bounce (2026-08-04): passing isSpringDate=true
                  did NOT produce "Shared dining room" alone - it fell
                  through to WHY_IN_PHASE_UNPROJECTED because the
                  syntheticDay has no ST projections, and the two
                  in-phase branches split on hasProjectedMeals. All
                  four state-derived subtitles make claims about ONE
                  date; bulk spans a selection. subtitleOverride is
                  the day-neutral escape hatch. The chip
                  ("Not scheduled (N of M)") carries per-day truth -
                  do not duplicate that axis in this subtitle.
                  Match snapshots not wired in bulk (no Clear);
                  onClearToPreMatch stays undefined which keeps
                  the button inert. */}
              {feeNoDollar && stServices.length > 0 && (
                <SpringTrainingSection
                  stServices={stServices}
                  day={syntheticDay}
                  editValues={values}
                  touched={touched}
                  flashMap={null}
                  isSpringDate={true}
                  hasSTValue={false}
                  expanded={true}
                  onChange={handleChange}
                  onFillProjections={onFillProjections}
                  hasMatchSnapshot={false}
                  feeGroupSummary={groupSummary}
                  feeProjectedGroupSummary={projectedGroupSummary}
                  getNotScheduled={getNotScheduled}
                  subtitleOverride="Shared dining room"
                />
              )}
              {nonStGroups.map(group => (
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
                  variant={feeNoDollar ? "fee" : "bulk"}
                  getNotScheduled={getNotScheduled}
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

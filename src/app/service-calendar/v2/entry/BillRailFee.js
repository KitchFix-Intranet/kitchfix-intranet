"use client";
// ═══════════════════════════════════════════════════════════════════
// BillRailFee - sibling of BillRail for the fee-no-dollar shape.
// Phase 2B (2026-07-25, owner Ruling 2).
// ═══════════════════════════════════════════════════════════════════
//
// Why a sibling and not a variant prop on BillRail: BillRail is dollar-
// native at six render sites (hero value, hero display, meta line,
// per-service subtotal, BillLine amount, tooltip). A variant prop
// would branch every path and put the per-meal rail inside this PR's
// blast radius. The sibling keeps per-meal untouched by construction -
// zero edits inside BillRail. The mount site branches on the fee
// predicate (isFeeNoDollar) and mounts one or the other.
//
// Content (per RENDER_STL_FL.html, owner-approved):
//   - Label: "CONFIRMED" (touched) or "SCHEDULED" (pristine)
//   - Hero: {served} served (count, no dollars anywhere)
//   - Progress: enteredCount / totalToEnter services (existing primitive)
//   - Per-service list: name + count, NO amount cell
//   - Month block: Days confirmed X/Y · Served to date · Billing: Flat fee
//
// Reuses:
//   - .sc-v2-entry-rail-shell (container geometry)
//   - .sc-v2-entry-rail-label (label typography)
//   - .sc-v2-entry-rail-hero + -hero-value + -hero-meta (hero shape)
//   - .sc-v2-entry-rail-progress + -progress-fill (progress bar atom)
//   - .sc-v2-entry-rail-invoice + -group + -group-name (per-service list shell)
// New fee-only classes:
//   - .sc-v2-entry-rail-line-fee (per-service line without amount cell)
//   - .sc-v2-entry-rail-month (Month block container)
//   - .sc-v2-entry-rail-month-row (label + value stat row)
//
// Shared derivations imported (L7 drift rule):
//   - useAnimatedNumber from ../../useAnimatedNumber (same hero pulse)
//   - isInServiceOnDay from ../../DayDetail (same archive-gate)

import { useEffect, useRef } from "react";
import useAnimatedNumber from "../../useAnimatedNumber";
import { isInServiceOnDay } from "../../DayDetail";

export default function BillRailFee({
  serviceGroups,
  day,
  editValues,
  touched,
  hasTouchedAny,
  enteredCount,
  totalToEnter,
  periodStats,   // { daysConfirmed, daysTotal, servedToDate } | null
}) {
  // Served-count derivations. Ignore isFlatFee here (unlike per-meal's
  // `summary.meals` which skips flat-fee services because they have
  // no per-meal count). On STL-FL the operator's typed value IS the
  // served count for every line - flatFee is a billing signal, not a
  // rendering one.
  let enteredServed = 0;
  let projectedServed = 0;
  for (const g of serviceGroups) {
    for (const s of g.services) {
      if (!isInServiceOnDay(s, day.date)) continue;
      const proj = day.projected[s.colIndex] ?? 0;
      projectedServed += proj;
      const v = editValues[s.colIndex];
      if (v !== "" && v !== undefined && touched.has(s.colIndex)) {
        enteredServed += Number(v) || 0;
      }
    }
  }
  const heroValue = hasTouchedAny ? enteredServed : projectedServed;
  const heroAnimated = useAnimatedNumber(heroValue);

  // Hero pulse - mirrors BillRail's pattern verbatim so the two rails
  // share the animation cadence. Reduced-motion behavior falls out of
  // the same token-layer rules.
  const heroRef = useRef(null);
  const lastHeroRef = useRef(heroValue);
  useEffect(() => {
    if (lastHeroRef.current === heroValue) return;
    lastHeroRef.current = heroValue;
    const el = heroRef.current;
    if (!el) return;
    el.classList.remove("sc-v2-entry-rail-hero--pulse");
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth;
    el.classList.add("sc-v2-entry-rail-hero--pulse");
    const timer = setTimeout(() => el?.classList.remove("sc-v2-entry-rail-hero--pulse"), 400);
    return () => clearTimeout(timer);
  }, [heroValue]);

  const pctComplete = totalToEnter > 0 ? Math.round((enteredCount / totalToEnter) * 100) : 0;

  return (
    <div className="sc-v2-entry-rail-shell">
      <div className="sc-v2-entry-rail-label">
        {hasTouchedAny ? "CONFIRMED" : "SCHEDULED"}
      </div>
      <div
        ref={heroRef}
        className={`sc-v2-entry-rail-hero${!hasTouchedAny ? " sc-v2-entry-rail-hero--pristine" : ""}`}
      >
        <span className="sc-v2-entry-rail-hero-value" aria-hidden="true">
          {hasTouchedAny ? "" : "~"}{Math.round(heroAnimated).toLocaleString()} served
        </span>
        <span className="sc-visually-hidden" aria-live="polite">
          {hasTouchedAny ? "Confirmed total " : "Scheduled total "}
          {heroValue.toLocaleString()} served
        </span>
        <span className="sc-v2-entry-rail-hero-meta">
          {enteredCount} of {totalToEnter} services confirmed
        </span>
      </div>

      <div
        className="sc-v2-entry-rail-progress"
        role="progressbar"
        aria-valuenow={pctComplete}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="sc-v2-entry-rail-progress-fill" style={{ width: `${pctComplete}%` }} />
      </div>

      {/* Per-service list - counts only, no amount cell (redline #11
          shape, same rationale as BulkEntry's hideAmount). */}
      <div className="sc-v2-entry-rail-invoice">
        {serviceGroups.map(group => {
          const lines = group.services.filter(s => isInServiceOnDay(s, day.date));
          if (!lines.length) return null;
          return (
            <div key={group.name} className="sc-v2-entry-rail-group">
              <div className="sc-v2-entry-rail-group-name">{group.name}</div>
              {lines.map(s => {
                const proj = day.projected[s.colIndex] ?? 0;
                const editVal = editValues[s.colIndex] ?? "";
                const isTouched = touched.has(s.colIndex);
                const isEmpty = editVal === "";
                const entered = isTouched && !isEmpty;
                const displayVal = entered ? Number(editVal) : proj;
                return (
                  <div
                    key={s.colIndex}
                    className={`sc-v2-entry-rail-line-fee ${entered ? "sc-v2-entry-rail-line-fee--solid" : "sc-v2-entry-rail-line-fee--ghost"}`}
                  >
                    <span className="sc-v2-entry-rail-line-name">{s.name}</span>
                    <span className="sc-v2-entry-rail-line-count">
                      {entered ? displayVal.toLocaleString() : `~${displayVal.toLocaleString()}`}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Month block - period-scoped stats replace the contract block
          that lives on the outer rail. periodStats optional - the
          block collapses cleanly when the mount site can't derive it. */}
      {periodStats && (
        <div className="sc-v2-entry-rail-month" aria-label="Month summary">
          <div className="sc-v2-entry-rail-month-row">
            <span className="sc-v2-entry-rail-month-label">Days confirmed</span>
            <span className="sc-v2-entry-rail-month-value">
              {periodStats.daysConfirmed.toLocaleString()} of {periodStats.daysTotal.toLocaleString()}
            </span>
          </div>
          <div className="sc-v2-entry-rail-month-row">
            <span className="sc-v2-entry-rail-month-label">Served to date</span>
            <span className="sc-v2-entry-rail-month-value">
              {periodStats.servedToDate.toLocaleString()}
            </span>
          </div>
          <div className="sc-v2-entry-rail-month-row">
            <span className="sc-v2-entry-rail-month-label">Billing</span>
            <span className="sc-v2-entry-rail-month-value">Flat fee</span>
          </div>
        </div>
      )}
    </div>
  );
}

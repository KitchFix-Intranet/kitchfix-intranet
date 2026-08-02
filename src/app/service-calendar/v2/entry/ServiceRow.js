"use client";
// ═══════════════════════════════════════════════════════════════════
// ServiceRow - one row atom for a v2 day-entry ledger.
// ═══════════════════════════════════════════════════════════════════
//
// Reuses the v1 CSS class names so the atom style inherits
// automatically. See DayDetail.js:837-914 for the shape.
//
// Extracted from DayEntryV2.js on 2026-08-01 to break the import
// cycle between DayEntryV2 and SpringTrainingSection (both need
// ServiceRow; the cycle back through DayEntryV2 was tolerated by
// dev bundlers but risks production TDZ failures - same class as
// the a1e8af1 P3-B hotfix). No behavior change; identical export
// signature.
//
// Cell drops (GroupBlock composes these from its `variant` prop):
//   hideAmount  - drop the trailing amount cell (bulk + fee)
//   hideRate    - drop the rate cell (fee only; Phase 2B gate-2)
// Caller's ledger wrapper must carry the matching subgrid variant:
//   .sc-day-ledger--no-amount (3-col) for hideAmount
//   .sc-day-ledger--fee (2-col) for both hideAmount and hideRate

import {
  deltaChip,
  deriveUnit,
  renderRate,
  isInServiceOnDay,
} from "../../DayDetail";
import { fmt$ } from "../../season/format";

export default function ServiceRow({ svc, day, editValues, touched, flashDelay, onChange, hideAmount = false, hideRate = false, readOnly = false }) {
  const projVal = day.projected[svc.colIndex] ?? 0;
  const editVal = editValues[svc.colIndex] ?? "";
  const isTouched = touched.has(svc.colIndex);
  const isEmpty = editVal === "";
  const inService = isInServiceOnDay(svc, day.date);
  const archiveDate = !inService ? String(svc.activeUntil).slice(0, 10) : null;
  // W7 PR 2/3 motion: `flashDelay` is a stagger delay in ms (0 for
  // single-input flash; N*60 for the Match-projections cascade). When
  // defined, the row gets the `sc-v2-entry-row--flash` class + inline
  // animation-delay style. Undefined = no class = no animation.
  const isFlashing = flashDelay != null;

  let chip = null;
  if (inService && isTouched && !isEmpty) {
    chip = deltaChip(Number(editVal), projVal);
  }

  const qtyCell = inService ? (
    <div className="sc-day-row-right">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={svc.name}
        className={`sc-day-input ${isTouched && !isEmpty ? "sc-day-input--touched" : "sc-day-input--ghost"}`}
        placeholder={String(projVal)}
        value={editVal}
        disabled={readOnly}
        onChange={e => onChange(svc.colIndex, e.target.value)}
      />
      {chip ? (
        <span className={`sc-day-row-delta ${chip.cls}`}>{chip.text}</span>
      ) : (
        <span className="sc-day-row-delta" />
      )}
    </div>
  ) : (
    <span className="sc-day-row-archived-chip" title={`Archived as of ${archiveDate}`}>
      Archived {archiveDate}
    </span>
  );

  const rate = day.priceAtDate?.[svc.colIndex] ?? svc.price ?? 0;
  const unit = deriveUnit(svc.name, svc.isFlatFee);
  const entered = inService && isTouched && !isEmpty;

  return (
    <div
      className={`sc-day-row sc-day-row--ledger${!inService ? " sc-day-row--archived" : ""}${isFlashing ? " sc-v2-entry-row--flash" : ""}`}
      style={isFlashing ? { animationDelay: `${flashDelay}ms` } : undefined}
    >
      <div className="sc-day-row-left">
        <span className="sc-day-row-name">{svc.name}</span>
      </div>
      {!hideRate && (
        <span className="sc-day-row-rate">{renderRate(svc, rate, unit)}</span>
      )}
      {qtyCell}
      {!hideAmount && (
        <span className="sc-day-row-amount">
          {svc.isNonRevenue
            ? <span className="sc-day-amount-none" title="Not billed">—</span>
            : entered
              ? fmt$(Number(editVal) * rate)
              : inService
                ? <span className="sc-day-amount-ghost">~{fmt$(projVal * rate)}</span>
                : <span className="sc-day-amount-pending">–</span>}
        </span>
      )}
    </div>
  );
}

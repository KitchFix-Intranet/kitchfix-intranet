// src/app/kpi/labor/lib/weekFlag.js
//
// Pure model function for the WeekTable's per-week exception chip
// (aka "V42 state"). Extracted from WeekTable.js on 2026-08-26 so a
// Node probe can assert its label/tooltip contract without JSX
// compilation. Same pattern as signalCardModels.js — one source of
// truth for the derivation, one assertion in the probe.
//
// Owner directive 2026-08-26 (homestand-fixes round 2 addendum): the
// anomaly chip's label must state the COUNT ONLY. The reason
// breakdown belongs on the row's title attribute, one hover away.
// Prior chip enumerated its reasons ("2 need attention - 1 never
// clocked out, 1 over 16h" = 267px) and grew unbounded past 350px
// on three anomaly types with larger counts, breaking the row.
// _probe_anomaly_chip_length.mjs asserts the count-only contract.

/**
 * Compute the per-week exception state for the WeekTable.
 * @param {object} w - week row (server board.weeks[] or client aggregate)
 * @param {boolean} isClosed - whether the week is closed
 * @returns {null | {state, label, cls, tooltip, glyph}}
 */
export function flagForV42State(w, isClosed) {
  // Sum anomaly parts directly - server-side board weeks carry a
  // pre-summed anomaly_total, client-side weekAggregates in page.js
  // does not. Reading parts always agrees.
  const nc  = Number(w.anomaly_no_clockout || 0);
  const u1  = Number(w.anomaly_under_1h    || 0);
  const o16 = Number(w.anomaly_over_16h    || 0);
  const anomalies = nc + u1 + o16;
  // Aggregated week rows in page.js expose the raw column name
  // `hours_without_dollars`; server-side board weeks expose the
  // renamed `unpriced_hrs`. Read either so both callers land here
  // correctly.
  const unpriced = Number(w.unpriced_hrs ?? w.hours_without_dollars ?? 0);
  const drafts   = Number(w.draft_entry_count || 0);
  const draftHrs = Number(w.draft_hours || 0);
  if (anomalies > 0) {
    // homestand-fixes round 2 addendum (2026-08-26): chip states the
    // COUNT ONLY. Owner ruling: enumerated reasons ran the chip past
    // 267px on ALL accounts P9 - the cell also carries date range +
    // OT tag, and three reason types with larger counts break the
    // row past 350px. The count is the signal (an operator looks at
    // the count and clicks); the reason breakdown moves to the title
    // attribute where it lives one hover away without occupying the
    // table. The account + worker breadcrumb ⚠ chips already carry
    // the specific reason in their titles.
    const detail = [];
    if (nc  > 0) detail.push(`${nc} never clocked out`);
    if (u1  > 0) detail.push(`${u1} under 1h`);
    if (o16 > 0) detail.push(`${o16} over 16h`);
    return {
      state: "s2",
      label: `${anomalies} need${anomalies === 1 ? "s" : ""} attention`,
      cls: "kpi-flag-warn",
      tooltip: `These time entries can't be approved as-is - a human has to fix them in Rippling. ${detail.join(", ")}.`,
      glyph: "⚠",
    };
  }
  if (isClosed && unpriced > 0.004) {
    return {
      state: "s3b",
      label: `closed week understated - ${unpriced.toFixed(1)} hrs missing pay data`,
      cls: "kpi-flag-bad",
      tooltip: "This closed week's dollar total is incomplete. Pay-segments for the missing hours have not landed yet.",
      glyph: "⚠",
    };
  }
  if (isClosed && drafts > 0) {
    return {
      state: "s3a",
      label: `closed week awaiting approval${draftHrs > 0.004 ? ` - ${draftHrs.toFixed(1)} hrs` : ""}`,
      cls: "kpi-flag-warn kpi-flag-warn-soft",
      tooltip: "Dollars for this week are complete. The entries have not been formally approved in Rippling.",
      glyph: "⚠",
    };
  }
  // HS FB1 hotfix 2026-08-25 - State 1: in-progress week with drafts.
  // Muted neutral chip; not a warning. States a fact, does not raise
  // an alarm. No glyph so it reads distinct from the ⚠ chips above.
  if (!isClosed && drafts > 0) {
    return {
      state: "s1",
      label: `${draftHrs > 0.004 ? draftHrs.toFixed(1) : drafts} hrs pending approval`,
      cls: "kpi-flag-mute",
      tooltip: "Time entries clocked but not yet approved in Rippling. Approving them will not change the dollar total.",
      glyph: null,
    };
  }
  return null;   // truly no signal (no drafts, no anomalies, no unpriced)
}

"use client";
// ═══════════════════════════════════════════════════════════════════
// BulkReviewMatrix - the week-at-once bulk review surface (PR-J,
// 2026-08-18). Replaces BulkReview's accordion stack with one table:
// services down, days across.
// ═══════════════════════════════════════════════════════════════════
//
// Design authority: docs/design/KF_BULK_ENTRY_GOOD_BETTER_BEST.html
// "Best" section. Kevin ruling 2026-08-18 supersedes PR Ruling 1
// (accordion) with the matrix shape - and ruled Option 3 (horizontal
// scroll) as the >7-day fallback, with three requirements:
//   1. Service-name column freezes (sticky first column).
//   2. Batch totals live in the modal header, not only column footers.
//   3. Column width holds a floor sized for three-digit counts;
//      horizontal scroll begins when days no longer fit at that width
//      rather than shrinking cells below legibility.
//
// Fences (also per PR-J prompt):
//   - Read-only cells. Editing a single day stays in the day-entry
//     modal (DayEntryV2). No inline editing, no focus management,
//     no per-cell validation here.
//   - No migration. No change to save payload or save action.
//   - Tokens only, no raw hex, no new px literals for type / spacing /
//     radius. Fixed pixel values below are intrinsic layout geometry
//     (day-column floor width, sticky-column width).
//   - Inter with var(--num-tabular) for every figure - no mono, per
//     the PR-H1 / PR-H2 supersession chain. Verified J7 by computed
//     style.
//
// Both bulk paths (match-projections + custom-values) converge here.
// The two paths differ only in what `perDayServices(d)` returns; the
// matrix is source-agnostic.

import { useMemo, useState } from "react";
import { fmt$ } from "../../season/format";

// Given the row's day values, return the modal (most common) value.
// Returns null when no dominant value exists (tie for first).
// Excludes non-service days (services with proj 0 and no touched value
// for a given day) via the `serviceDayFlags` map: the caller passes an
// array of booleans matching `values` for whether each day is a
// service day for this service. Only service-day values participate
// in the mode computation - otherwise a service that runs 5 days at
// 110 and doesn't run 1 day would tint the off-day as an "outlier."
function computeMode(values, serviceDayFlags) {
  const counts = new Map();
  for (let i = 0; i < values.length; i++) {
    if (!serviceDayFlags[i]) continue;
    const v = values[i];
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  if (counts.size <= 1) return counts.size === 1 ? [...counts.keys()][0] : null;
  let bestCount = 0;
  let bestVal = null;
  let tied = false;
  for (const [v, c] of counts) {
    if (c > bestCount) { bestCount = c; bestVal = v; tied = false; }
    else if (c === bestCount) { tied = true; }
  }
  return tied ? null : bestVal;
}

// Weekday-abbrev + date-number pair for a column header.
// "Mon 17" style; the design breaks weekday + day into two lines so
// header cells stay narrow.
function fmtDayHeader(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow  = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const dayN = d.getUTCDate();
  return { dow, dayN };
}

// "Mon Aug 17 to Sat Aug 22" span label for the header meta line.
function fmtSpanLabel(firstIso, lastIso) {
  const opts = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
  const a = new Date(`${firstIso}T12:00:00Z`).toLocaleDateString("en-US", opts);
  const b = new Date(`${lastIso}T12:00:00Z`).toLocaleDateString("en-US", opts);
  return `${a} to ${b}`;
}

export default function BulkReviewMatrix({
  days,                 // [{ date, projected, actual, priceAtDate, totals, hasActuals }]
  serviceGroups,        // account's service catalog, in display order
  subtitle,             // scoreboard subtitle ("Match projections - N days" / "Custom values, N days")
  headerTotals,         // { meals, revenue } - server-derived aggregate
  perDayRow,            // fn(day) -> { meals, revenue } per-day figures
  perDayServices,       // fn(day) -> [{ serviceId, serviceName, value }]
  overwrites,           // Map<date, { prevMeals, prevServices, isNoService }>
  skips,                // Map<date, Set<serviceId>> - archive-edge (service, day)
                        // pairs the write path will refuse. Renders as "off"
                        // in the matrix cell and drops out of mode computation.
  batchSkipCount = 0,
  zeroApplicableDays,   // Set<date> - days where every entry is skipped
  isFeeAccount,
  acctName,
  saving,
  confirmLabel = "Confirm & save",
  onConfirm,            // (batchNote) -> void
  onBack,               // () -> void
  cardRef,
  titleId = "sc-bulk-review-title",
}) {
  const [batchNote, setBatchNote] = useState("");
  const [foldOpen, setFoldOpen]   = useState(false);

  // Sort days by date (defensive - caller usually already does).
  const sortedDays = useMemo(() => {
    return [...(days || [])].sort((a, b) => a.date.localeCompare(b.date));
  }, [days]);

  // Flatten catalog into a service list (with groupName attached) so
  // the matrix can render group divider rows between service rows.
  // Order preserved from serviceGroups declaration.
  const flatServices = useMemo(() => {
    const out = [];
    for (const g of serviceGroups || []) {
      for (const s of g.services || []) {
        out.push({ ...s, __group: g.name });
      }
    }
    return out;
  }, [serviceGroups]);

  // Per-service, per-day value map:
  //   valuesByService.get(serviceId)[dayIndex] = numeric value
  //   serviceDayByService.get(serviceId)[dayIndex] = boolean (is this
  //     day a service day for this service - drives "off" state and
  //     mode computation exclusion).
  const { valuesByService, serviceDayByService } = useMemo(() => {
    const vals = new Map();
    const sd   = new Map();
    for (const s of flatServices) {
      vals.set(s.colIndex, []);
      sd.set(s.colIndex, []);
    }
    for (const day of sortedDays) {
      const rows = perDayServices(day) || [];
      const byId = new Map();
      for (const r of rows) byId.set(r.serviceId, Number(r.value) || 0);
      const daySkips = skips?.get(day.date) || null;
      for (const s of flatServices) {
        const v = byId.get(s.colIndex);
        const proj = day.projected?.[s.colIndex] ?? 0;
        const act  = day.actual?.[s.colIndex]    ?? 0;
        // Archive-edge skip: (service, day) pair the write path
        // refuses. Renders as "off" and drops out of mode
        // computation.
        const isSkipped    = !!daySkips?.has(s.colIndex);
        const isServiceDay = !isSkipped && ((v !== undefined && v > 0) || proj > 0 || act > 0);
        vals.get(s.colIndex).push(v ?? 0);
        sd.get(s.colIndex).push(isServiceDay);
      }
    }
    return { valuesByService: vals, serviceDayByService: sd };
  }, [flatServices, sortedDays, perDayServices, skips]);

  // Partition services into two buckets - running-this-week vs
  // not-running. A service is "not running this week" when every
  // day in the span has serviceDay=false. Matches the entry-ledger
  // rail's not-running predicate, extended across the span rather
  // than one day.
  const { runningServices, notRunningServices } = useMemo(() => {
    const running = [];
    const notRunning = [];
    for (const s of flatServices) {
      const flags = serviceDayByService.get(s.colIndex) || [];
      if (flags.some(Boolean)) running.push(s);
      else notRunning.push(s);
    }
    return { runningServices: running, notRunningServices: notRunning };
  }, [flatServices, serviceDayByService]);

  // Per-day footer figures (meals + dollars per column). Sourced from
  // perDayRow so the numbers agree with the header totals - the
  // caller's aggregation is server-derived. Never recomputed here.
  const perDayFooters = useMemo(() => {
    return sortedDays.map(d => {
      const r = perDayRow(d) || {};
      return {
        date:    d.date,
        meals:   Number.isFinite(r.meals)   ? r.meals   : 0,
        revenue: Number.isFinite(r.revenue) ? r.revenue : 0,
      };
    });
  }, [sortedDays, perDayRow]);

  // Modal computation per running service. Modal = most common value
  // across service-days only (off-days excluded). If tied, no modal
  // and no tint on that row.
  const modeByService = useMemo(() => {
    const m = new Map();
    for (const s of runningServices) {
      const values = valuesByService.get(s.colIndex) || [];
      const flags  = serviceDayByService.get(s.colIndex) || [];
      m.set(s.colIndex, computeMode(values, flags));
    }
    return m;
  }, [runningServices, valuesByService, serviceDayByService]);

  // Compose group-blocks: [{ groupName, services }] with only
  // running-this-week services. Empty groups drop out.
  const runningByGroup = useMemo(() => {
    const groups = new Map();
    for (const s of runningServices) {
      if (!groups.has(s.__group)) groups.set(s.__group, []);
      groups.get(s.__group).push(s);
    }
    return [...groups.entries()].map(([groupName, services]) => ({ groupName, services }));
  }, [runningServices]);

  // notRunning fold: group names + service names.
  const notRunningByGroup = useMemo(() => {
    const groups = new Map();
    for (const s of notRunningServices) {
      if (!groups.has(s.__group)) groups.set(s.__group, []);
      groups.get(s.__group).push(s);
    }
    return [...groups.entries()].map(([groupName, services]) => ({ groupName, services }));
  }, [notRunningServices]);

  const dayCount    = sortedDays.length;
  const totalCols   = 1 + dayCount;
  const spanLabel   = dayCount > 0 ? fmtSpanLabel(sortedDays[0].date, sortedDays[dayCount - 1].date) : "";
  const overwriteCount = overwrites ? overwrites.size : 0;
  const zeroApplicableCount = zeroApplicableDays ? zeroApplicableDays.size : 0;
  const writableDays = dayCount - zeroApplicableCount;

  return (
    <div className="sc-overlay-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onBack(); }}>
      <div
        ref={cardRef}
        className="sc-overlay-card sc-brm-card"
        data-density="comfortable"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sc-brm-shell">
          {/* Modal header: title + total + meals + span (Kevin
              ruling 2026-08-18 requirement 2 - batch totals live in
              the header, not only column footers). */}
          <header className="sc-brm-head">
            <div className="sc-brm-head-topline">
              <div className="sc-brm-head-title" id={titleId}>
                <span className="sc-brm-head-subtitle">{subtitle}</span>
                {acctName && <span className="sc-brm-head-account">{acctName}</span>}
              </div>
              <button type="button" className="sc-brm-head-back" onClick={onBack}>
                <span aria-hidden="true">&#8249;</span> Go back
              </button>
            </div>
            <div className="sc-brm-head-figs">
              {!isFeeAccount && Number.isFinite(headerTotals?.revenue) && (
                <span className="sc-brm-head-amount">{fmt$(headerTotals.revenue)}</span>
              )}
              <span className="sc-brm-head-meta">
                {Number.isFinite(headerTotals?.meals) && (
                  <>{headerTotals.meals.toLocaleString()} meals</>
                )}
                {spanLabel && (
                  <>
                    {" "}
                    <span className="sc-brm-head-sep" aria-hidden="true">&middot;</span>
                    {" "}
                    {spanLabel}
                  </>
                )}
              </span>
            </div>
          </header>

          <div className="sc-brm-body">
            {batchSkipCount > 0 && (
              <p className="sc-brm-note sc-brm-note--skip" role="note">
                {batchSkipCount.toLocaleString()} value{batchSkipCount === 1 ? "" : "s"} will be skipped on days where the service is not offered.
              </p>
            )}

            {overwriteCount > 0 && (
              <p className="sc-brm-note sc-brm-note--overwrite" role="note">
                <span className="sc-brm-note-icon" aria-hidden="true">&#9888;</span>
                <strong>
                  {overwriteCount} of these day{overwriteCount === 1 ? "" : "s"} already have{overwriteCount === 1 ? "s" : ""} counts or a no-service status.
                </strong>
                {" Confirming will replace them."}
              </p>
            )}

            {/* The matrix. Sticky first column via CSS; horizontal
                scroll kicks in when day columns no longer fit at
                the min-width floor (Kevin ruling requirement 3). */}
            <div className="sc-brm-matrix-wrap">
              <div
                className="sc-brm-matrix-scroll"
                role="region"
                aria-label={`Bulk entry review, ${dayCount} day${dayCount === 1 ? "" : "s"}`}
                tabIndex={0}
              >
                <table className="sc-brm-matrix">
                  <thead>
                    <tr>
                      <th scope="col" className="sc-brm-th-lead">Service</th>
                      {sortedDays.map(d => {
                        const { dow, dayN } = fmtDayHeader(d.date);
                        return (
                          <th key={d.date} scope="col" className="sc-brm-th-day">
                            <span className="sc-brm-th-dow">{dow}</span>
                            <b className="sc-brm-th-num">{dayN}</b>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {runningByGroup.map(({ groupName, services }) => (
                      <>
                        <tr key={`grp-${groupName}`} className="sc-brm-row-group">
                          <td colSpan={totalCols}>{groupName}</td>
                        </tr>
                        {services.map(s => {
                          const values = valuesByService.get(s.colIndex) || [];
                          const flags  = serviceDayByService.get(s.colIndex) || [];
                          const mode   = modeByService.get(s.colIndex);
                          return (
                            <tr key={`svc-${s.colIndex}`} className="sc-brm-row-svc">
                              <td className="sc-brm-cell-lead" scope="row">{s.name}</td>
                              {values.map((v, i) => {
                                const isServiceDay = flags[i];
                                const isOff  = !isServiceDay;
                                const isDiff = mode !== null && isServiceDay && v !== mode;
                                const cellClass = `sc-brm-cell${isOff ? " sc-brm-cell--off" : ""}${isDiff ? " sc-brm-cell--diff" : ""}`;
                                const label = isOff ? "-" : v.toLocaleString();
                                return (
                                  <td key={sortedDays[i].date} className={cellClass}>
                                    {/* PR-K matrix polish (Kevin ruling
                                        2026-08-18): outlier tint is a
                                        rounded pill inset from the cell
                                        edge, not a full-bleed fill. The
                                        wrapper span carries the pill;
                                        non-diff cells stay unwrapped. */}
                                    {isDiff ? <span className="sc-brm-cell-fill">{label}</span> : label}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="sc-brm-foot-row sc-brm-foot-row--meals">
                      <td className="sc-brm-cell-lead sc-brm-foot-label">Meals</td>
                      {perDayFooters.map(f => (
                        <td key={`m-${f.date}`} className="sc-brm-cell">{f.meals.toLocaleString()}</td>
                      ))}
                    </tr>
                    {!isFeeAccount && (
                      <tr className="sc-brm-foot-row sc-brm-foot-row--money">
                        <td className="sc-brm-cell-lead sc-brm-foot-label">Total</td>
                        {/* PR-K matrix polish (Kevin ruling 2026-08-18):
                            dollar signs on the Total row. Two adjacent
                            all-numeric footer rows (meals + money) need
                            the disambiguator - this is the deliberate
                            exception to the drop-the-dollar-signs rule
                            established in the ledger + rail redesign. */}
                        {perDayFooters.map(f => (
                          <td key={`t-${f.date}`} className="sc-brm-cell">${Math.round(f.revenue).toLocaleString()}</td>
                        ))}
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>

              {notRunningServices.length > 0 && (
                <div className={`sc-brm-fold${foldOpen ? " sc-brm-fold--open" : ""}`}>
                  <button
                    type="button"
                    className="sc-brm-fold-toggle"
                    onClick={() => setFoldOpen(v => !v)}
                    aria-expanded={foldOpen}
                  >
                    <span>{notRunningServices.length} service{notRunningServices.length === 1 ? "" : "s"} not running this week</span>
                    <span className="sc-brm-fold-cta">{foldOpen ? "HIDE" : "SHOW"}</span>
                  </button>
                  {foldOpen && (
                    <div className="sc-brm-fold-body">
                      {notRunningByGroup.map(g => (
                        <div key={g.groupName} className="sc-brm-fold-group">
                          <span className="sc-brm-fold-group-name">{g.groupName}</span>
                          {g.services.map(s => (
                            <div key={s.colIndex} className="sc-brm-fold-row">{s.name}</div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="sc-brm-note-composer">
              <label className="sc-brm-note-label" htmlFor="sc-brm-note-input">
                Add a note to every day in this batch (optional)
              </label>
              <input
                id="sc-brm-note-input"
                type="text"
                className="sc-brm-note-input"
                placeholder="e.g. Cancelled morning setup for weather"
                value={batchNote}
                onChange={(e) => setBatchNote(e.target.value)}
                disabled={saving}
                maxLength={500}
              />
            </div>

          </div>

          <footer className="sc-brm-foot">
            {/* PR-K matrix polish (Kevin ruling 2026-08-18): batch hint
                moves next to Confirm - "Saves as one batch, all N or
                none" is a consequence of pressing Confirm, so it
                belongs beside Confirm, not stranded above the note
                field. */}
            <span className="sc-brm-foot-hint">
              Saves as one batch. All {writableDays.toLocaleString()} or none.
            </span>
            <div className="sc-brm-foot-actions">
              <button type="button" className="sc-brm-btn sc-brm-btn--ghost" onClick={onBack}>Go back</button>
              <button
                type="button"
                className="sc-brm-btn sc-brm-btn--primary"
                disabled={saving || writableDays === 0}
                onClick={() => onConfirm(batchNote)}
              >
                {saving ? "Saving..." : (confirmLabel === "Confirm & save" ? `Confirm and save ${writableDays} day${writableDays === 1 ? "" : "s"}` : confirmLabel)}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

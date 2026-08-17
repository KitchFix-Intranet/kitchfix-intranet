"use client";
// ═══════════════════════════════════════════════════════════════════
// EntryLedgerRail - the redesigned day-entry rail (PR-H, 2026-08-17).
// Replaces BillRail (kept as sibling for the fee-no-dollar path).
// ═══════════════════════════════════════════════════════════════════
//
// Design authority: docs/design/KF_LEDGER_GOOD_BETTER_BEST.html "Best"
// column, three states (empty, mid-entry with flag firing, all-entered).
// Kevin's ruling 2026-08-17 is the visual + copy authority. Where the
// prompt and the render disagree, the render wins.
//
// What this rail carries, in order top -> bottom:
//   1. Header - "Entry progress" kick, "N of M" hero, progress bar,
//      "Next up / Start with <first-pending>" affordance.
//   2. All-entered ready block (only when enteredCount === totalToEnter).
//   3. Group blocks (Minor League / Rehab / etc.):
//        - group name with horizontal rule
//        - single-line rows: state dot | name | qty | amount
//        - inline "Check this" advisory when the digit-drop rule fires
//   4. "N services not running today" collapsed disclosure.
//   5. Total block at the bottom: entered total + "of $X projected" or
//      "$X under projection".
//
// Server behavior UNTOUCHED. The entry payload, the save action, and
// every server predicate are the parent's concern; this component only
// renders and warns.
//
// State-by-shape (accessibility rule, not a preference):
//   - filled green dot   = entered
//   - open ring          = pending
//   - lit ring           = currently focused in the form
// The ring/filled distinction is the color-alone rule - a grayscale
// user still tells entered from pending by shape.
//
// Variance flag is ADVISORY. Save button (owned by the parent's
// pinned actions row) is never blocked by a fired flag.

import { useMemo, useState } from "react";
import { fmt$, round2 } from "../../season/format";
import { isInServiceOnDay } from "../../DayDetail";
import { shouldFlagVariance } from "@/lib/billing/variance";

// Classify each in-service row as done / focused / pending. Groups
// filter out services not in service on the day; a service is "not
// running today" when it IS in-service on the day but has projection 0
// AND no touched entry AND no saved actual.
function classifyRow({ svc, day, editValues, touched, focusedColIndex }) {
  const proj = day.projected?.[svc.colIndex] ?? 0;
  const editVal = editValues[svc.colIndex] ?? "";
  const isTouched = touched.has(svc.colIndex);
  const isEmpty = editVal === "";
  const isFocused = focusedColIndex === svc.colIndex;
  const isDone = isTouched && !isEmpty;
  // "Not running today" per Kevin's spec: projection zero, nothing
  // entered, nothing focused. Actuals check for edit-mode of an
  // already-saved day (touched carries edits; actual carries the
  // saved value the parent hydrated into editValues at mount).
  const hasSavedActual = day.hasActuals && (day.actual?.[svc.colIndex] ?? 0) > 0;
  const isNotRunning = proj <= 0 && !isDone && !hasSavedActual && !isFocused;
  const state = isDone ? "done" : (isFocused ? "focus" : "pending");
  return { proj, editVal, isTouched, isEmpty, isDone, isFocused, isNotRunning, state };
}

// Row atom - the one-grid single-line row per Best design.
function LedgerRow({ svc, day, editValues, touched, focusedColIndex }) {
  const c = classifyRow({ svc, day, editValues, touched, focusedColIndex });
  if (c.isNotRunning) return null;
  const rate = day.priceAtDate?.[svc.colIndex] ?? svc.price ?? 0;
  const qtyValue = c.isDone ? Number(c.editVal) : c.proj;
  const amtValue = round2(qtyValue * rate);

  // Variance advisory fires only on touched-and-entered digit-drops.
  // Silent on flat-fee, tiny projections, overshoots, and zeros.
  const flag = c.isDone
    ? shouldFlagVariance({
        projected: c.proj,
        entered: Number(c.editVal),
        isFlatFee: !!svc.isFlatFee,
      })
    : null;

  return (
    <div
      className={`sc-elr-row sc-elr-row--${c.state}${flag ? " sc-elr-row--flagged" : ""}`}
      data-col-index={svc.colIndex}
    >
      <span className={`sc-elr-dot sc-elr-dot--${c.state}`} aria-hidden="true" />
      <span className="sc-elr-name">{svc.name}</span>
      <span className="sc-elr-qty">{qtyValue}</span>
      <span className="sc-elr-amount">
        {svc.isNonRevenue ? (
          <span aria-label="Not billed">-</span>
        ) : (
          amtValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        )}
      </span>
      {flag && (
        <span className="sc-elr-flag" role="note">
          {flag.message}
        </span>
      )}
    </div>
  );
}

// Group block - "MINOR LEAGUE" header + rule + rows. Skips entirely
// when no rows would render (all services not-running).
function LedgerGroup({ group, day, editValues, touched, focusedColIndex }) {
  const inServiceRows = useMemo(() => {
    return group.services.filter((s) => {
      if (!isInServiceOnDay(s, day.date)) return false;
      const c = classifyRow({ svc: s, day, editValues, touched, focusedColIndex });
      return !c.isNotRunning;
    });
  }, [group.services, day, editValues, touched, focusedColIndex]);
  if (inServiceRows.length === 0) return null;
  return (
    <div className="sc-elr-group">
      <div className="sc-elr-grp-head">
        <span className="sc-elr-grp-name">{group.name}</span>
        <span className="sc-elr-grp-rule" aria-hidden="true" />
      </div>
      {inServiceRows.map((s) => (
        <LedgerRow
          key={s.colIndex}
          svc={s}
          day={day}
          editValues={editValues}
          touched={touched}
          focusedColIndex={focusedColIndex}
        />
      ))}
    </div>
  );
}

// The "N services not running today" disclosure, folded by default.
// Expanded state lists the folded services grouped the same way.
function NotRunningFold({ notRunningByGroup, totalNotRunning }) {
  const [open, setOpen] = useState(false);
  if (totalNotRunning === 0) return null;
  const label = `${totalNotRunning} service${totalNotRunning === 1 ? "" : "s"} not running today`;
  return (
    <div className={`sc-elr-fold${open ? " sc-elr-fold--open" : ""}`}>
      <button
        type="button"
        className="sc-elr-fold-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{label}</span>
        <span className="sc-elr-fold-cta">{open ? "HIDE" : "SHOW"}</span>
      </button>
      {open && (
        <div className="sc-elr-fold-body">
          {notRunningByGroup.map((g) => (
            <div key={g.name} className="sc-elr-fold-group">
              <span className="sc-elr-fold-group-name">{g.name}</span>
              {g.services.map((s) => (
                <div key={s.colIndex} className="sc-elr-fold-row">
                  <span className="sc-elr-dot sc-elr-dot--muted" aria-hidden="true" />
                  <span className="sc-elr-name">{s.name}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EntryLedgerRail({
  serviceGroups,          // ALL groups; component partitions running vs not
  day,
  editValues,
  touched,
  focusedColIndex,        // number | null - which colIndex is currently focused
  enteredTotals,          // { revenue, meals }
  dayProjection,          // { revenue, meals }
  enteredCount,
  totalToEnter,
  hasTouchedAny,
}) {
  // Partition once: services that render above the fold vs services
  // that go into the "not running today" disclosure.
  const { runningGroups, notRunningByGroup, totalNotRunning, firstPendingName } = useMemo(() => {
    const running = [];
    const notRunning = [];
    let firstPending = null;
    for (const g of serviceGroups) {
      const runningSvcs = [];
      const notRunningSvcs = [];
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        const c = classifyRow({ svc: s, day, editValues, touched, focusedColIndex });
        if (c.isNotRunning) notRunningSvcs.push(s);
        else {
          runningSvcs.push(s);
          if (!firstPending && !c.isDone) firstPending = s.name;
        }
      }
      if (runningSvcs.length) running.push({ ...g, services: runningSvcs });
      if (notRunningSvcs.length) notRunning.push({ name: g.name, services: notRunningSvcs });
    }
    return {
      runningGroups: running,
      notRunningByGroup: notRunning,
      totalNotRunning: notRunning.reduce((n, g) => n + g.services.length, 0),
      firstPendingName: firstPending,
    };
  }, [serviceGroups, day, editValues, touched, focusedColIndex]);

  const pctComplete = totalToEnter > 0 ? Math.round((enteredCount / totalToEnter) * 100) : 0;
  const isAllEntered = totalToEnter > 0 && enteredCount === totalToEnter;
  const enteredRevenue = enteredTotals?.revenue ?? 0;
  const projectedRevenue = dayProjection?.revenue ?? 0;
  const varianceCents = round2(enteredRevenue - projectedRevenue);

  // Header affordance line: "Next up: X" once anything's been entered,
  // "Start with: X" when nothing entered, "Nothing scheduled" when
  // totalToEnter is zero.
  let affordance = null;
  if (isAllEntered) {
    affordance = null;
  } else if (totalToEnter === 0) {
    affordance = <span className="sc-elr-next-quiet">Nothing scheduled today</span>;
  } else if (firstPendingName) {
    const label = hasTouchedAny ? "Next up" : "Start with";
    affordance = (
      <>
        <span>{label}</span>
        <b>{firstPendingName}</b>
      </>
    );
  }

  return (
    <div className="sc-elr-shell">
      <div className="sc-elr-header">
        <div className="sc-elr-kick">Entry progress</div>
        <div className="sc-elr-hero">
          <span className="sc-elr-hero-count">{enteredCount}</span>
          <span className="sc-elr-hero-of">of {totalToEnter}</span>
        </div>
        <div
          className="sc-elr-bar"
          role="progressbar"
          aria-valuenow={pctComplete}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="sc-elr-bar-fill" style={{ width: `${pctComplete}%` }} />
        </div>
        {affordance && <div className="sc-elr-next">{affordance}</div>}
      </div>

      {isAllEntered && (
        <div className="sc-elr-ready" role="status">
          <span className="sc-elr-ready-check" aria-hidden="true">&#10003;</span>
          <span className="sc-elr-ready-msg">Every service entered</span>
        </div>
      )}

      <div className="sc-elr-groups">
        {runningGroups.map((g) => (
          <LedgerGroup
            key={g.name}
            group={g}
            day={day}
            editValues={editValues}
            touched={touched}
            focusedColIndex={focusedColIndex}
          />
        ))}
      </div>

      <NotRunningFold
        notRunningByGroup={notRunningByGroup}
        totalNotRunning={totalNotRunning}
      />

      <div className="sc-elr-total">
        {isAllEntered ? (
          <>
            <div className="sc-elr-total-label">Total entered</div>
            <div className="sc-elr-total-value">{fmt$(enteredRevenue)}</div>
            <div className="sc-elr-total-vs">
              {varianceCents === 0 ? (
                <>matches projection</>
              ) : (
                <>
                  <b>
                    {fmt$(Math.abs(varianceCents))} {varianceCents < 0 ? "under" : "over"}
                  </b>{" "}
                  projection
                </>
              )}
            </div>
          </>
        ) : hasTouchedAny ? (
          <>
            <div className="sc-elr-total-label">Entered so far</div>
            <div className="sc-elr-total-value">{fmt$(enteredRevenue)}</div>
            <div className="sc-elr-total-vs">
              of <b>{fmt$(projectedRevenue)}</b> projected
            </div>
          </>
        ) : (
          <>
            <div className="sc-elr-total-label">Projected today</div>
            <div className="sc-elr-total-value">{fmt$(projectedRevenue)}</div>
            <div className="sc-elr-total-vs">nothing entered yet</div>
          </>
        )}
      </div>
    </div>
  );
}

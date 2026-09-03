// ═══════════════════════════════════════════════════════════════════
// partitionServices - shared "running vs not-running today" helpers.
// Extracted 2026-09-03 (SC cleanup 5b) from EntryLedgerRail.js:107-212
// so the same rule powers both the right-rail ledger AND DayEntryV2's
// main body render. Reuse-not-duplicate: the classifier lives here.
// ═══════════════════════════════════════════════════════════════════
//
// A service is "not running today" when it IS in-service on the day
// (isInServiceOnDay passes) but every non-entry signal says nothing
// will land: projection <= 0, no touched entry, no saved actual, and
// not currently focused. Kevin's spec verbatim (per the original
// EntryLedgerRail comment: "projection zero, nothing entered, nothing
// focused"). Actual check covers the edit-mode-of-a-saved-day case -
// touched carries in-session edits; day.actual carries what the
// parent hydrated at mount for a previously-finalized entry.
//
// The archive filter (isInServiceOnDay) is applied HERE too so
// callers get one call surface. PR #1003 also filters archived
// services from operator view via activeGroups/inactiveGroups
// useMemo; both filter points are idempotent (archived services
// have already been dropped by the time they reach this helper on
// DayEntryV2's path; the redundant check keeps this module callable
// standalone from EntryLedgerRail without depending on caller-side
// filtering).

import { isInServiceOnDay } from "../../DayDetail";

/**
 * classifyRow - per-service pending/done/focus/not-running classification.
 * Pure function of (service, day, editValues, touched, focusedColIndex).
 *
 * @returns {{
 *   proj: number,
 *   editVal: string,
 *   isTouched: boolean,
 *   isEmpty: boolean,
 *   isDone: boolean,
 *   isFocused: boolean,
 *   isNotRunning: boolean,
 *   state: 'done' | 'focus' | 'pending'
 * }}
 */
export function classifyRow({ svc, day, editValues, touched, focusedColIndex }) {
  const proj = day.projected?.[svc.colIndex] ?? 0;
  const editVal = editValues[svc.colIndex] ?? "";
  const isTouched = touched.has(svc.colIndex);
  const isEmpty = editVal === "";
  const isFocused = focusedColIndex === svc.colIndex;
  const isDone = isTouched && !isEmpty;
  const hasSavedActual = day.hasActuals && (day.actual?.[svc.colIndex] ?? 0) > 0;
  const isNotRunning = proj <= 0 && !isDone && !hasSavedActual && !isFocused;
  const state = isDone ? "done" : (isFocused ? "focus" : "pending");
  return { proj, editVal, isTouched, isEmpty, isDone, isFocused, isNotRunning, state };
}

/**
 * partitionServicesByRunning - split every service across every group
 * into running / not-running buckets. Groups with zero running services
 * do not appear in runningGroups (they are entirely under the fold).
 *
 * @param {Object} args
 * @param {Array<{name:string, services:Array<{colIndex:number, ...}>}>} args.serviceGroups
 * @param {Object} args.day
 * @param {Object} args.editValues
 * @param {Set<number>} args.touched
 * @param {number|null} args.focusedColIndex
 * @returns {{
 *   runningGroups: Array,          // groups with at least one running service; group.services is filtered to the running set
 *   notRunningByGroup: Array,      // { name, services } per group that had any not-running-today service
 *   totalNotRunning: number,       // sum across notRunningByGroup for the fold's count label
 *   firstPendingName: string|null  // name of the first pending (non-done) running service, for the "Next up: X" affordance
 * }}
 */
export function partitionServicesByRunning({ serviceGroups, day, editValues, touched, focusedColIndex }) {
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
}

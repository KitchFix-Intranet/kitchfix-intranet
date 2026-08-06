"use client";

// WeekFinalizeControl - the drill-in per-week Finalize surface.
// sc-30 (2026-08-06, PR-A of the SC -> QBO billing arc).
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC.md §3.
//   Copy verbatim per spec:
//     "Week finalized - sent to billing"
//         (statuses: finalized, billed)
//     "Week finalized - billing push failed, [name] has been alerted"
//         (status: push_failed)
//   sc-25's period-lock copy stays untouched; the two locks stack.
//
// Placement: rendered ONCE per week band in the drill-in period
// view for per-meal accounts. Fee / MLB / MiLB-AAA accounts do not
// render this control - the finalize state is per-meal only.
//
// Completeness rule (spec §3): the button stays disabled with a
// plain-english reason until all 7 days in the week resolve to
// status IN {entered, no-service}. The client mirrors the server-
// side `computeWeekCompleteness` rule from scWeekFinalize.js
// exactly - a wrong client-side gate would ship a "button disabled
// for no reason" defect. Both sides key on the same day.status,
// which comes from `classifyDayStatus` in dataStore/serviceCalendar.js.
//
// Override affordances (SC_LOCK_OVERRIDE = Kevin + Joe + Sebastian,
// K-10): the Revert control renders only for override members and
// only when the live row's status is finalized or push_failed. A
// billed row is a one-way door (K-3); Revert is hidden on billed.
// Retry is a placeholder in PR-A - the actual retry ships in PR-C.

import { useMemo, useState } from "react";

// Days that satisfy the finalize completeness rule. Mirrors
// scWeekFinalize.js `computeWeekCompleteness` for per-meal accounts:
// a day is COMPLETE when
//   status === "entered"        OR
//   status === "no-service"
// The atom-status classifier (dataStore/serviceCalendar.js:326-333)
// emits "no-service" for both variants (has-actuals-all-zero + no-
// actuals-planned-off-day), so client + server converge on the
// same 7-day check.
function isDayComplete(day) {
  if (!day || !day.status) return false;
  return day.status === "entered" || day.status === "no-service";
}

function countMissing(weekDays) {
  if (!Array.isArray(weekDays)) return 0;
  let n = 0;
  for (const d of weekDays) if (!isDayComplete(d)) n++;
  return n;
}

// Copy per spec §3. Kept as a small pure function so the string
// tables live in one place - PR-C extends this map with the QBO
// success / retry variants without editing the render code.
function bannerCopyFor(status, alertedName) {
  if (status === "push_failed") {
    const who = alertedName || "leadership";
    return `Week finalized - billing push failed, ${who} has been alerted`;
  }
  if (status === "finalized" || status === "billed") {
    return "Week finalized - sent to billing";
  }
  return null;
}

export default function WeekFinalizeControl({
  accountKey,
  weekStart,          // ISO YYYY-MM-DD Monday
  weekDays,           // array of day records: [{ date, status, ... }]
  liveRow,            // { status, finalized_by, finalized_at } | null
  isOverrideUser,     // boolean; true when session email is in SC_LOCK_OVERRIDE
  onFinalize,         // async ({ accountKey, weekStart }) -> Promise
  onRevert,           // async ({ accountKey, weekStart, reason }) -> Promise
  onRetry,            // async ({ accountKey, weekStart }) -> Promise   (PR-C placeholder)
}) {
  const [saving, setSaving] = useState(false);
  const [errText, setErrText] = useState(null);

  const missing = useMemo(() => countMissing(weekDays), [weekDays]);
  const isComplete = missing === 0 && Array.isArray(weekDays) && weekDays.length === 7;

  // State branches, in the order the spec enumerates them.

  // Push-failed: banner + Retry (override only).
  if (liveRow?.status === "push_failed") {
    const alertedName = "Kevin"; // Placeholder for step 2 UI copy; the
                                 // K-1 notification names the actor.
    return (
      <div
        className="sc-week-finalize sc-week-finalize--push-failed"
        role="status"
        aria-label={`Week ${weekStart} billing push failed`}
      >
        <span className="sc-week-finalize-banner">{bannerCopyFor("push_failed", alertedName)}</span>
        {isOverrideUser && (
          <button
            type="button"
            className="sc-week-finalize-action sc-week-finalize-action--retry"
            disabled={saving}
            onClick={async () => {
              setErrText(null);
              setSaving(true);
              try {
                await onRetry?.({ accountKey, weekStart });
              } catch (e) {
                setErrText(e?.message || "Retry failed");
              } finally {
                setSaving(false);
              }
            }}
          >
            Retry
          </button>
        )}
        {isOverrideUser && (
          <RevertAction
            accountKey={accountKey}
            weekStart={weekStart}
            onRevert={onRevert}
            saving={saving}
            setSaving={setSaving}
            setErrText={setErrText}
          />
        )}
        {errText && <span className="sc-week-finalize-err" role="alert">{errText}</span>}
      </div>
    );
  }

  // Finalized or Billed: banner. Revert visible for override users
  // on FINALIZED only (K-3 freezes BILLED).
  if (liveRow?.status === "finalized" || liveRow?.status === "billed") {
    return (
      <div
        className={`sc-week-finalize sc-week-finalize--${liveRow.status}`}
        role="status"
        aria-label={`Week ${weekStart} ${liveRow.status}`}
      >
        <span className="sc-week-finalize-banner">{bannerCopyFor(liveRow.status)}</span>
        {isOverrideUser && liveRow.status === "finalized" && (
          <RevertAction
            accountKey={accountKey}
            weekStart={weekStart}
            onRevert={onRevert}
            saving={saving}
            setSaving={setSaving}
            setErrText={setErrText}
          />
        )}
        {errText && <span className="sc-week-finalize-err" role="alert">{errText}</span>}
      </div>
    );
  }

  // OPEN: the Finalize button. Disabled + reason when incomplete;
  // enabled when complete.
  const disabledReason = isComplete
    ? null
    : `${missing} day${missing === 1 ? "" : "s"} still need entry or no-service`;

  return (
    <div className="sc-week-finalize sc-week-finalize--open" aria-label={`Week ${weekStart}`}>
      <button
        type="button"
        className="sc-week-finalize-btn"
        disabled={!isComplete || saving}
        aria-disabled={!isComplete || saving}
        title={disabledReason || undefined}
        onClick={async () => {
          setErrText(null);
          setSaving(true);
          try {
            await onFinalize?.({ accountKey, weekStart });
          } catch (e) {
            setErrText(e?.message || "Finalize failed");
          } finally {
            setSaving(false);
          }
        }}
      >
        {saving ? "Finalizing..." : "Finalize week"}
      </button>
      {!isComplete && (
        <span className="sc-week-finalize-reason" aria-live="polite">{disabledReason}</span>
      )}
      {errText && <span className="sc-week-finalize-err" role="alert">{errText}</span>}
    </div>
  );
}

function RevertAction({ accountKey, weekStart, onRevert, saving, setSaving, setErrText }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        className="sc-week-finalize-action sc-week-finalize-action--revert"
        disabled={saving}
        onClick={() => setOpen(true)}
      >
        Revert
      </button>
    );
  }
  return (
    <form
      className="sc-week-finalize-revert-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = reason.trim();
        if (!r) {
          setErrText("Reason required");
          return;
        }
        setErrText(null);
        setSaving(true);
        try {
          await onRevert?.({ accountKey, weekStart, reason: r });
          setOpen(false);
          setReason("");
        } catch (err) {
          setErrText(err?.message || "Revert failed");
        } finally {
          setSaving(false);
        }
      }}
    >
      <label className="sc-week-finalize-revert-label" htmlFor={`sc-revert-reason-${weekStart}`}>
        Revert reason
      </label>
      <input
        id={`sc-revert-reason-${weekStart}`}
        type="text"
        className="sc-week-finalize-revert-input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={280}
        placeholder="Why is this being reverted?"
        autoFocus
      />
      <button
        type="submit"
        className="sc-week-finalize-action sc-week-finalize-action--revert-confirm"
        disabled={saving || reason.trim().length === 0}
      >
        Confirm revert
      </button>
      <button
        type="button"
        className="sc-week-finalize-action sc-week-finalize-action--cancel"
        onClick={() => {
          setOpen(false);
          setReason("");
          setErrText(null);
        }}
        disabled={saving}
      >
        Cancel
      </button>
    </form>
  );
}

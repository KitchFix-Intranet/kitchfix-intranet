"use client";

// WeekFinalizeControl - the drill-in per-week Finalize surface.
// PR-D (2026-08-11) reworks PR-A's bare button into the confirmed
// flow: blocked with clickable fixes, confirmation overlay, named
// progress steps, toast, quiet done state, and the failed banner.
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A1 for state
// treatments; docs/design/KF_FINALIZE_FLOW_RENDER.html for the
// visual + copy authority.
//
// Server behaviour is untouched. The finalize action, the completeness
// predicate, and runFinalizeEffects behave exactly as PR-C shipped
// them. This PR changes only what the operator sees and confirms.

import { useMemo, useRef, useState } from "react";
import FinalizeOverlay from "./FinalizeOverlay";
import FinalizeToast from "./FinalizeToast";
import { getQboMode, getInvoiceDestination } from "@/lib/billing/qboMode";

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

function missingDayList(weekDays) {
  if (!Array.isArray(weekDays)) return [];
  return weekDays.filter((d) => !isDayComplete(d));
}

// Short chip label per missing day: "Fri Jul 31".
function chipLabelFor(day) {
  if (!day?.date) return "Day";
  try {
    return new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch (_) {
    return String(day.date);
  }
}

// Quiet done caption. Format: "Finalized {Mon Jul 27} by {name}".
function fmtCaptionDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch (_) {
    return String(iso).slice(0, 10);
  }
}

function displayName(email) {
  if (!email) return "the site leader";
  const local = String(email).split("@")[0] || email;
  // "k.fietek" -> "K Fietek". Kept minimal; the notification carries
  // the authoritative display name.
  return local
    .split(".")
    .map((s) => (s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s))
    .join(" ");
}

export default function WeekFinalizeControl({
  accountKey,
  weekStart,              // ISO YYYY-MM-DD Monday
  weekEnd,                // ISO YYYY-MM-DD Sunday (optional; derived if missing)
  weekDays,               // array of day records
  liveRow,                // { status, finalized_by, finalized_at } | null
  isOverrideUser,         // boolean
  onFinalize,             // async ({ accountKey, weekStart }) -> Promise
  onRevert,               // async ({ accountKey, weekStart, reason }) -> Promise
  onRetry,                // async ({ accountKey, weekStart }) -> Promise
  onOpenDay,              // (isoDate) -> void   navigate to that day's entry
  // metrics used by the overlay
  daysServed,             // number of days with actual entry (or all 7 for full)
  totalMeals,             // sum of actual_count across the week
  pretaxTotalDollars,     // number in dollars
  liveCustomerName,       // string (used in live mode; test mode ignores)
}) {
  const [saving, setSaving] = useState(false);
  const [errText, setErrText] = useState(null);
  // Overlay state machine within the OPEN branch.
  //   'idle'    : button visible (blocked or ready)
  //   'confirm' : overlay open in confirm mode
  //   'working' : overlay open in working mode
  const [overlayMode, setOverlayMode] = useState("idle");
  const [workingStepIndex, setWorkingStepIndex] = useState(0);
  const [toastOpen, setToastOpen] = useState(false);
  const openButtonRef = useRef(null);

  const missing = useMemo(() => missingDayList(weekDays), [weekDays]);
  const isComplete = missing.length === 0 && Array.isArray(weekDays) && weekDays.length === 7;

  // Push-failed banner (loud, red).
  if (liveRow?.status === "push_failed") {
    return (
      <div className="sc-week-finalize sc-week-finalize--push-failed" role="status">
        <span className="sc-week-finalize-fail-banner">
          Billing push failed - Kevin has been alerted
        </span>
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
            revertLabel="Unlock"
          />
        )}
        {errText && <span className="sc-week-finalize-err" role="alert">{errText}</span>}
      </div>
    );
  }

  // Quiet done state. Copy per addendum §A1: no QBO link, operator
  // terms only. Unlock renders for override users only, on FINALIZED.
  if (liveRow?.status === "finalized" || liveRow?.status === "billed") {
    const dateText = fmtCaptionDate(liveRow.finalized_at || weekStart);
    const nameText = displayName(liveRow.finalized_by);
    return (
      <div
        className={`sc-week-finalize sc-week-finalize--${liveRow.status}`}
        role="status"
        aria-label={`Week ${weekStart} ${liveRow.status}`}
      >
        <span className="sc-week-finalize-quiet">
          <span className="sc-week-finalize-quiet-tick" aria-hidden="true">&#10003;</span>
          <span>
            Finalized <b>{dateText}</b> by <b>{nameText}</b>
            {" · Sent to AP for review"}
          </span>
        </span>
        {isOverrideUser && liveRow.status === "finalized" && (
          <RevertAction
            accountKey={accountKey}
            weekStart={weekStart}
            onRevert={onRevert}
            saving={saving}
            setSaving={setSaving}
            setErrText={setErrText}
            revertLabel="Unlock"
          />
        )}
        {errText && <span className="sc-week-finalize-err" role="alert">{errText}</span>}
      </div>
    );
  }

  // OPEN: blocked (with chips) OR ready (with button). The Finalize
  // action opens the confirmation overlay; the overlay drives the
  // real submit + progress + toast.
  const qboMode = getQboMode(accountKey);
  const invoiceDestination = getInvoiceDestination(accountKey, liveCustomerName);
  // Derive weekEnd if not supplied (7 days from weekStart).
  const derivedWeekEnd = weekEnd || (() => {
    if (!weekStart) return "";
    const d = new Date(`${weekStart}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  })();

  async function walkWorkingProgress() {
    // Named steps advance on a single server round trip. We report
    // this honestly - the real work happens in runFinalizeEffects
    // and we cannot see intermediate progress from the client. Steps
    // 1..3 tick at 700ms intervals for perceived progress; step 4
    // only enters the doing state when the fetch actually returns.
    setWorkingStepIndex(1);
    let currentStep = 1;
    const tickTimer = setInterval(() => {
      currentStep = Math.min(currentStep + 1, 3);
      setWorkingStepIndex(currentStep);
    }, 700);

    try {
      await onFinalize?.({ accountKey, weekStart });
      clearInterval(tickTimer);
      setWorkingStepIndex(4);
      // Small settle to render the "Telling billing" step before
      // toast + close.
      await new Promise((r) => setTimeout(r, 250));
      setWorkingStepIndex(5);
      setOverlayMode("idle");
      setToastOpen(true);
    } catch (e) {
      clearInterval(tickTimer);
      setOverlayMode("idle");
      setErrText(e?.message || "Finalize failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sc-week-finalize sc-week-finalize--open" aria-label={`Week ${weekStart}`}>
      {isComplete ? (
        <button
          ref={openButtonRef}
          type="button"
          className="sc-week-finalize-btn"
          disabled={saving}
          onClick={() => {
            setErrText(null);
            setOverlayMode("confirm");
          }}
        >
          Finalize week
        </button>
      ) : (
        <>
          <span className="sc-week-finalize-chips-label">
            {missing.length} day{missing.length === 1 ? "" : "s"} still need entry or no-service
          </span>
          {missing.slice(0, 7).map((day) => (
            <button
              key={day.date}
              type="button"
              className="sc-week-finalize-chip"
              onClick={() => onOpenDay?.(day.date)}
            >
              {chipLabelFor(day)}
            </button>
          ))}
          <button
            ref={openButtonRef}
            type="button"
            className="sc-week-finalize-btn"
            disabled
            aria-disabled="true"
          >
            Finalize week
          </button>
        </>
      )}
      {errText && <span className="sc-week-finalize-err" role="alert">{errText}</span>}

      <FinalizeOverlay
        open={overlayMode !== "idle"}
        mode={overlayMode === "working" ? "working" : "confirm"}
        workingStepIndex={workingStepIndex}
        onCancel={() => {
          if (saving) return;
          setOverlayMode("idle");
          setWorkingStepIndex(0);
        }}
        onConfirm={() => {
          if (saving) return;
          setSaving(true);
          setOverlayMode("working");
          walkWorkingProgress();
        }}
        invokerRef={openButtonRef}
        accountKey={accountKey}
        weekStart={weekStart}
        weekEnd={derivedWeekEnd}
        daysServed={daysServed}
        totalDays={7}
        totalMeals={totalMeals}
        invoiceDestination={invoiceDestination}
        pretaxTotalDollars={pretaxTotalDollars}
        qboMode={qboMode}
      />

      <FinalizeToast
        open={toastOpen}
        onDismiss={() => setToastOpen(false)}
      />
    </div>
  );
}

function RevertAction({
  accountKey, weekStart, onRevert, saving, setSaving, setErrText,
  revertLabel = "Revert",
}) {
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
        {revertLabel}
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
        Unlock reason
      </label>
      <input
        id={`sc-revert-reason-${weekStart}`}
        type="text"
        className="sc-week-finalize-revert-input"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={280}
        placeholder="Why is this being unlocked?"
        autoFocus
      />
      <button
        type="submit"
        className="sc-week-finalize-action sc-week-finalize-action--revert-confirm"
        disabled={saving || reason.trim().length === 0}
      >
        Confirm
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

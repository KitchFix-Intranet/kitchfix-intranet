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
  weekDays,               // legacy: array of day records (client-computed).
                          //   PR-E prefers serverWeekInfo.
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
  // ─── PR-E (2026-08-14) additions ───────────────────────────────
  // Server-authoritative completeness + pair role for this week.
  // Shape: { complete, missingDates:[isoDate], weekStart, weekEnd,
  //          weekIndex, pairRole:'solo'|'first'|'close',
  //          pairPartnerMonday, period, weekLabel }
  serverWeekInfo = null,
  // Same shape for the partner week in a bi-weekly pair. null when
  // pairRole==='solo'. Used to gate the pair-close button when the
  // first week of the pair is incomplete.
  pairPartnerInfo = null,
  // 'weekly' | 'biweekly'. Read from sc_qbo_account_map.cadence via
  // sc-finalize-states. Drives §A4 rendering.
  accountCadence = null,
  // 2026-09-03 (Kevin ruling on SC cleanup item 2): true when the
  // caller is the CALENDAR / MONTH drill rather than the Period drill.
  // The week ghosting + state captions render unchanged; every action
  // button (Finalize week / Finalize 2-week period / Retry / Unlock /
  // RevertAction) is suppressed. The rationale is that offering
  // finalize from a month-shaped screen invites finalizing a billing
  // week from the wrong context. The jump chip stays because it is
  // navigation, not a finalize affordance.
  readOnlyFinalize = false,
  // 2026-09-04 (motion cleanup): finalize success routes through the
  // shared SC toast primitive rather than the retired FinalizeToast.
  // Optional so old call-sites keep working; missing showToast becomes
  // a no-op success (the overlay still closes cleanly).
  showToast = null,
}) {
  const [saving, setSaving] = useState(false);
  const [errText, setErrText] = useState(null);
  // Overlay state machine within the OPEN branch.
  //   'idle'    : button visible (blocked or ready)
  //   'confirm' : overlay open in confirm mode
  //   'working' : overlay open in working mode
  const [overlayMode, setOverlayMode] = useState("idle");
  const [workingStepIndex, setWorkingStepIndex] = useState(0);
  const openButtonRef = useRef(null);

  // PR-E: prefer server-authoritative completeness. Falls back to
  // legacy client-side count when the server hasn't returned a row
  // for this week (fetch not yet resolved, or account not in the
  // finalize surface). Legacy path also requires the 7-day guard so
  // a partial visible week never presents as complete.
  const useServer = serverWeekInfo != null;
  const legacyMissing = useMemo(() => missingDayList(weekDays), [weekDays]);
  const missing = useServer
    ? (serverWeekInfo.missingDates || []).map((d) => ({ date: d, status: null }))
    : legacyMissing;
  const isComplete = useServer
    ? !!serverWeekInfo.complete
    : (legacyMissing.length === 0 && Array.isArray(weekDays) && weekDays.length === 7);

  // Bi-weekly pair semantics (§A4).
  const pairRole = accountCadence === "biweekly" ? (serverWeekInfo?.pairRole || "solo") : "solo";
  const partnerComplete = pairPartnerInfo ? !!pairPartnerInfo.complete : true;
  const partnerMissing = pairPartnerInfo?.missingDates || [];
  const pairCloseSunday = (() => {
    if (pairRole !== "close" || !serverWeekInfo?.weekEnd) return null;
    return serverWeekInfo.weekEnd;
  })();

  // Push-failed bar - one bordered container so the message, Retry,
  // and Unlock read as a single element aligned to the same right
  // edge the Finalize button uses. Prevents jitter when a row
  // toggles between ready and failed states (addendum §A1 + PR-D1
  // 2026-08-13 polish).
  if (liveRow?.status === "push_failed") {
    return (
      <div className="sc-week-finalize sc-week-finalize--push-failed" role="status">
        <div className="sc-week-finalize-failbar">
          <span className="sc-week-finalize-failbar-msg">
            Billing push failed - Kevin has been alerted
          </span>
          {isOverrideUser && !readOnlyFinalize && (
            <>
              <button
                type="button"
                className="sc-week-finalize-failbar-action"
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
              <RevertAction
                accountKey={accountKey}
                weekStart={weekStart}
                onRevert={onRevert}
                saving={saving}
                setSaving={setSaving}
                setErrText={setErrText}
                revertLabel="Unlock"
                variant="failbar"
              />
            </>
          )}
        </div>
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
        {isOverrideUser && liveRow.status === "finalized" && !readOnlyFinalize && (
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
      const finalizeResult = await onFinalize?.({ accountKey, weekStart });
      clearInterval(tickTimer);
      setWorkingStepIndex(4);
      // sc-38 (2026-09-02): capture invoiceRecords.length from the
      // response so the toast can render "AP has N invoices for
      // review." for accounts producing multiple invoices per week
      // (TBJ 3-8 typical). Falls back to 1 if the shape is legacy
      // or the response is malformed - matches prior behaviour.
      const count =
        Array.isArray(finalizeResult?.invoiceRecords)
          ? finalizeResult.invoiceRecords.length
          : (Number.isFinite(finalizeResult?.invoiceCount) ? finalizeResult.invoiceCount : 1);
      const displayCount = count > 0 ? count : 1;
      // Small settle to render the "Telling billing" step before
      // toast + close.
      await new Promise((r) => setTimeout(r, 250));
      setWorkingStepIndex(5);
      setOverlayMode("idle");
      // 2026-09-04 (motion cleanup): use the shared SC toast. FinalizeToast
      // retired. Same copy shape as the retired component:
      //   1 invoice  -> "AP has the invoice for review."
      //   N > 1      -> "AP has N invoices for review."
      showToast?.({
        variant: "generic",
        tier: "ok",
        title: "Week finalized",
        detail: displayCount === 1
          ? "AP has the invoice for review."
          : `AP has ${displayCount} invoices for review.`,
      });
    } catch (e) {
      clearInterval(tickTimer);
      setOverlayMode("idle");
      setErrText(e?.message || "Finalize failed");
    } finally {
      setSaving(false);
    }
  }

  // PR-E: pair-first quiet state (§A4). When a bi-weekly pair's
  // first week is complete AND the partner (closing) week has not
  // yet been finalized, render a quiet caption instead of a button.
  // The pair finalizes on the closing week.
  if (pairRole === "first" && isComplete) {
    const partnerLabel = serverWeekInfo?.weekIndex
      ? `Week ${serverWeekInfo.weekIndex + 1}`
      : "the closing week";
    const partnerSunday = pairPartnerInfo?.weekEnd || null;
    const dateFmt = partnerSunday
      ? new Date(`${partnerSunday}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      : null;
    return (
      <div className="sc-week-finalize sc-week-finalize--pair-first" aria-label={`Week ${weekStart} awaits pair close`}>
        <span className="sc-week-finalize-quiet">
          <span className="sc-week-finalize-quiet-tick" aria-hidden="true">&#10003;</span>
          <span>
            Week complete - finalizes with <b>{partnerLabel}</b>
            {dateFmt ? <> on <b>{dateFmt}</b></> : null}
          </span>
        </span>
      </div>
    );
  }

  // Buttonless when incomplete AND pairRole=first (chip line only,
  // no misleading Finalize button).
  const suppressButton = pairRole === "first";

  // Pair-close button + pair-partner gate. If the partner week is
  // incomplete, the button disables and names the shortfall.
  const pairPartnerGate = pairRole === "close" && !partnerComplete;
  const buttonLabel = pairRole === "close" ? "Finalize 2-week period" : "Finalize week";

  return (
    <div className="sc-week-finalize sc-week-finalize--open" aria-label={`Week ${weekStart}`}>
      {isComplete && !pairPartnerGate ? (
        readOnlyFinalize ? null : (
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
            {buttonLabel}
          </button>
        )
      ) : (
        <>
          {/* PR-D1 (2026-08-13): single clickable count line replaces
              per-day chips.
              PR-E (2026-08-14): pair-partner gate uses the partner's
              missing-count instead of this week's. */}
          {pairPartnerGate ? (
            <button
              type="button"
              className="sc-week-finalize-jump"
              onClick={() => {
                const first = partnerMissing[0];
                if (first) onOpenDay?.(first);
              }}
              aria-label={`Jump to first day of Week ${(serverWeekInfo?.weekIndex || 2) - 1} needing entry`}
            >
              Week {(serverWeekInfo?.weekIndex || 2) - 1} still needs {partnerMissing.length} day{partnerMissing.length === 1 ? "" : "s"}
            </button>
          ) : (
            <button
              type="button"
              className="sc-week-finalize-jump"
              onClick={() => {
                const first = missing[0];
                if (first?.date) onOpenDay?.(first.date);
              }}
              aria-label={`Jump to first day needing entry (${missing[0]?.date ? chipLabelFor(missing[0]) : ""})`}
            >
              {missing.length} day{missing.length === 1 ? "" : "s"} still need entry or no-service
            </button>
          )}
          {!suppressButton && !readOnlyFinalize && (
            <button
              ref={openButtonRef}
              type="button"
              className="sc-week-finalize-btn"
              disabled
              aria-disabled="true"
            >
              {buttonLabel}
            </button>
          )}
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
    </div>
  );
}

function RevertAction({
  accountKey, weekStart, onRevert, saving, setSaving, setErrText,
  revertLabel = "Revert",
  variant, // 'failbar' when embedded in the failed-state bar
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) {
    const cls = variant === "failbar"
      ? "sc-week-finalize-failbar-action"
      : "sc-week-finalize-action sc-week-finalize-action--revert";
    return (
      <button
        type="button"
        className={cls}
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

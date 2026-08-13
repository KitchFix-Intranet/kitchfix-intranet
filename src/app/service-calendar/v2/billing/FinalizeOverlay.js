"use client";

// FinalizeOverlay - the confirm-before-finalize modal.
// PR-D of the SC -> QBO billing arc (2026-08-11).
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC_ADDENDUM_A.md §A2, plus
// docs/design/KF_FINALIZE_FLOW_RENDER.html for row order + copy.
//
// The overlay has two content modes rendered in the same shell:
//   confirm : title "Finalize the week of {date}?" + rows +
//             lock warning + Cancel / Finalize buttons
//   working : title "Finalizing the week of {date}" +
//             4-step progress list + disabled Working... button
//
// The addendum ruled out the recipient list ("redundant - everyone
// on it receives the email anyway"). The addendum ruled the row
// order and the visual anchor: Pre-tax total renders at the display
// tier, is the largest thing in the modal.
//
// Focus trap: PR-A shipped a partial trap on the earlier finalize
// surface. This closes it - Tab cycles inside the first + last
// focusable descendants, Shift+Tab reverses, Esc closes in confirm,
// backdrop click closes in confirm. Focus returns to the invoking
// button on close (invokerRef.current.focus()).
//
// TEST MODE badge + "ZZ TEST - KitchFix Intranet" destination render
// whenever qboMode === 'test'. PR-D reads qboMode via the stub in
// src/lib/billing/qboMode.js; PR-F swaps the stub for the DB read.

import { useEffect, useRef } from "react";

const WORKING_STEPS = [
  { id: 1, label: "Locking the week" },
  { id: 2, label: "Building the invoice" },
  { id: 3, label: "Creating the draft in QuickBooks" },
  { id: 4, label: "Telling billing" },
];

function fmtMoney(cents) {
  const dollars = Math.round(Number(cents || 0)) / 100;
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtMoneyFromDollars(dollars) {
  const n = Number(dollars || 0);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtWeekRange(weekStart, weekEnd) {
  if (!weekStart) return "";
  const opts = { weekday: "short", month: "short", day: "numeric" };
  const start = new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  if (!weekEnd) return start;
  const end = new Date(`${weekEnd}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  return `${start} - ${end}`;
}

function fmtWeekTitle(weekStart) {
  if (!weekStart) return "";
  const opts = { month: "short", day: "numeric" };
  return new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

// Query the DOM subtree for tab-eligible elements. Skips disabled +
// aria-hidden; includes standard focusable HTML elements + tabindex-0.
function focusableWithin(root) {
  if (!root) return [];
  const q =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll(q)).filter((el) => !el.hasAttribute("aria-hidden"));
}

export default function FinalizeOverlay({
  open,
  mode,                 // 'confirm' | 'working'
  workingStepIndex,     // 0..4 - 0=none doing, 1..4=step N doing, 5=all done
  onCancel,             // fires from Cancel + Esc + backdrop (confirm only)
  onConfirm,            // fires from Finalize button (confirm only)
  invokerRef,           // ref to the button that opened the overlay
  // content
  accountKey,
  weekStart,
  weekEnd,
  daysServed,           // number, e.g. 6 of 7 -> pass 6 and totalDays=7
  totalDays,            // default 7
  totalMeals,           // number
  invoiceDestination,   // string - "ZZ TEST - KitchFix Intranet" or real customer name
  pretaxTotalDollars,   // number in dollars
  qboMode,              // 'test' | 'live'
  headerKick = "Finalize week",
}) {
  const scrimRef = useRef(null);
  const modalRef = useRef(null);
  const firstFocusableRef = useRef(null);

  // Manage focus + Esc + Tab cycle when open.
  useEffect(() => {
    if (!open) return;

    // Capture the invoker ref value NOW so the cleanup does not read
    // through a potentially stale ref.current on unmount.
    const capturedInvoker = invokerRef?.current || null;
    // Save active element as fallback (invoker may unmount before us).
    const prevActive = document.activeElement;
    const moveFocus = () => {
      // PR-D1 (2026-08-13): focus the [data-autofocus] element when
      // present (the primary CTA in confirm mode). Falls back to the
      // first focusable. Keeps the trap intact - Tab still cycles the
      // full set - but avoids putting the "primary treatment" focus
      // ring on Cancel where it competes with the Finalize CTA.
      const focusables = focusableWithin(modalRef.current);
      if (focusables.length === 0) {
        modalRef.current?.focus();
        return;
      }
      firstFocusableRef.current = focusables[0];
      const preferred = modalRef.current?.querySelector("[data-autofocus]");
      const target = (preferred && focusables.includes(preferred)) ? preferred : focusables[0];
      target.focus();
    };
    const raf = requestAnimationFrame(moveFocus);

    function onKeyDown(e) {
      if (e.key === "Escape" && mode === "confirm") {
        e.preventDefault();
        onCancel?.();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = focusableWithin(modalRef.current);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      // Return focus to the captured invoking button. Fall back to
      // prev active if the invoker unmounted between open and close.
      const target = capturedInvoker || prevActive;
      if (target && typeof target.focus === "function") {
        try { target.focus(); } catch (_) { /* ignore */ }
      }
    };
  }, [open, mode, onCancel, invokerRef]);

  // Backdrop click: close only in confirm mode + only if the click
  // originated on the scrim itself (not bubbling from within).
  function onScrimMouseDown(e) {
    if (mode !== "confirm") return;
    if (e.target === scrimRef.current) onCancel?.();
  }

  if (!open) return null;

  const isTest = qboMode === "test";
  const titleConfirm = `Finalize the week of ${fmtWeekTitle(weekStart)}?`;
  const titleWorking = `Finalizing the week of ${fmtWeekTitle(weekStart)}`;
  const subConfirm = "Send finals to QuickBooks for AP review and billing to client.";
  const subWorking = "Creating the invoice in QuickBooks. AP will review and send to client.";

  const title = mode === "working" ? titleWorking : titleConfirm;
  const sub = mode === "working" ? subWorking : subConfirm;
  const titleId = `sc-finalize-overlay-title-${weekStart || "x"}`;

  return (
    <div
      className="sc-finalize-scrim"
      ref={scrimRef}
      onMouseDown={onScrimMouseDown}
      data-open="true"
    >
      <div
        className="sc-finalize-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="sc-finalize-modal-head">
          {/* PR-D1 (2026-08-13): "FINALIZE WEEK" eyebrow dropped -
              the title says it. TEST MODE badge kept, moved beside
              the title, saturation stepped down so it does not
              compete with the primary CTA. */}
          <div className="sc-finalize-modal-title-row">
            <h3 id={titleId} className="sc-finalize-modal-title">{title}</h3>
            {isTest && (
              <span className="sc-finalize-testtag" aria-label="Test mode">Test mode</span>
            )}
          </div>
          <p className="sc-finalize-modal-sub">{sub}</p>
        </div>

        {mode === "confirm" && (
          <>
            <div className="sc-finalize-modal-body">
              <dl className="sc-finalize-rows">
                <div className="sc-finalize-row">
                  <dt>Account</dt>
                  <dd>{accountKey}</dd>
                </div>
                <div className="sc-finalize-row">
                  <dt>Service week</dt>
                  <dd>{fmtWeekRange(weekStart, weekEnd)}</dd>
                </div>
                {/* PR-D1: mono reserved for money + aligned columns.
                    Days-served + meals-and-snacks return to sans -
                    they read looser in mono than the sans labels
                    beside them. Only Pre-tax total keeps mono. */}
                <div className="sc-finalize-row">
                  <dt>Days served</dt>
                  <dd>
                    {typeof daysServed === "number" ? daysServed : "-"} of {totalDays || 7}
                  </dd>
                </div>
                <div className="sc-finalize-row">
                  <dt>Meals and snacks</dt>
                  <dd>
                    {typeof totalMeals === "number" ? totalMeals.toLocaleString("en-US") : "-"}
                  </dd>
                </div>
                <div className="sc-finalize-row">
                  <dt>Invoice goes to</dt>
                  <dd>{invoiceDestination || "-"}</dd>
                </div>
                <div className="sc-finalize-row sc-finalize-row--big">
                  <dt>Pre-tax total</dt>
                  <dd className="sc-finalize-num">{fmtMoneyFromDollars(pretaxTotalDollars)}</dd>
                </div>
              </dl>
              <div className="sc-finalize-lock" role="note">
                <b className="sc-finalize-lock-lead">This locks the week.</b>
                <span className="sc-finalize-lock-body">
                  After this you cannot change these numbers. Kevin, Joe, or Sebastian can unlock it.
                </span>
              </div>
            </div>
            <div className="sc-finalize-modal-foot">
              <button
                type="button"
                className="sc-finalize-btn sc-finalize-btn--ghost"
                onClick={onCancel}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sc-finalize-btn sc-finalize-btn--go"
                onClick={onConfirm}
                data-autofocus="true"
              >
                Finalize and send to billing
              </button>
            </div>
          </>
        )}

        {mode === "working" && (
          <>
            <div className="sc-finalize-modal-body sc-finalize-modal-body--progress">
              <ol className="sc-finalize-progress" aria-live="polite">
                {WORKING_STEPS.map((step) => {
                  let cls = "sc-finalize-progress-step";
                  if (workingStepIndex > step.id) cls += " sc-finalize-progress-step--done";
                  else if (workingStepIndex === step.id) cls += " sc-finalize-progress-step--doing";
                  return (
                    <li key={step.id} className={cls}>
                      <span className="sc-finalize-progress-dot" aria-hidden="true" />
                      <span className="sc-finalize-progress-label">{step.label}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="sc-finalize-modal-foot">
              <button
                type="button"
                className="sc-finalize-btn sc-finalize-btn--ghost"
                disabled
                aria-disabled="true"
              >
                Working...
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

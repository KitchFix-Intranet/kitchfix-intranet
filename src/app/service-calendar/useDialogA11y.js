"use client";

// useDialogA11y - minimal dialog a11y hook for the SC overlays
// (DayDetail entry + bulk entry). Both overlays share
// .sc-overlay-card wrapper, so both get the same contract:
//   1. On open, capture the previously-focused element.
//   2. On open, focus the first focusable inside the card (or the
//      card itself if none).
//   3. Escape closes.
//   4. Tab / Shift+Tab cycle within the card (focus containment).
//   5. On close, restore focus to the element from step 1.
//
// No new dependency. Follows the same pattern already used in
// season/LegendInfoPopup.js so the trap logic is consistent across
// the SC surface.
//
// The card itself should carry:
//   role="dialog"
//   aria-modal="true"
//   aria-labelledby={idOfDialogTitle}
//   tabIndex={-1}
// so it can accept focus when the card has no focusable children yet.

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogA11y({ cardRef, isOpen, onClose }) {
  const restoreFocusRef = useRef(null);
  // Keep the latest onClose in a ref so the main effect only re-runs
  // when isOpen actually changes. If onClose was in the dep array we'd
  // re-capture restoreFocus (and re-run focus-in) on every parent
  // render while the dialog was open.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    // Save the element that had focus before open (best effort).
    restoreFocusRef.current =
      typeof document !== "undefined" ? document.activeElement : null;

    const card = cardRef.current;
    if (!card) return;

    // After the card is painted, move focus inside. Using RAF so the
    // DOM is settled and any inner useEffect/render has completed.
    const raf = requestAnimationFrame(() => {
      const focusables = card.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) {
        focusables[0].focus({ preventScroll: true });
      } else {
        card.focus({ preventScroll: true });
      }
    });

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;

      // Focus containment: cycle within the card at the boundaries.
      const focusables = card.querySelectorAll(FOCUSABLE_SELECTOR);
      if (focusables.length === 0) {
        e.preventDefault();
        card.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;

      // If focus is outside the card entirely (edge case after DOM
      // updates), pull it back to the first focusable.
      if (!card.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      // Restore focus to the element that had it before open.
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === "function") {
        el.focus({ preventScroll: true });
      }
      restoreFocusRef.current = null;
    };
  }, [isOpen, cardRef]);
}

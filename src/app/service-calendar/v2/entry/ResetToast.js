"use client";
// ═══════════════════════════════════════════════════════════════════
// ResetToast - a hoisted workspace-level feedback surface for a
// successful sc-reset-day. Sibling of SaveConfirmation - same
// hoisted-overlay pattern, different content per owner ruling:
//
//   SaveConfirmation is a celebration (a save landed money).
//   ResetToast is a correction (something is un-recorded).
//
// The pattern (2026-08-04 reconciliation, one shape not two):
//   1. State lives on ServiceCalendarInner. The day-detail modal
//      unmounts during the post-save refetch, so any state inside
//      it dies before the overlay can render. See SC_STATUS'
//      "Day-detail modal remounts during post-save refetch" entry.
//   2. Setter callback fires from the success branch of the parent's
//      write handler (handleResetDay here; handleSave for the save
//      case).
//   3. Component renders at workspace level as a sibling of the
//      day-overlay conditional, position: fixed at var(--z-toast),
//      pointer-events: none - never blocks input.
//   4. Auto-clear via a paired timer on the parent (useEffect
//      + setTimeout, cleared on unmount).
//   5. The component is pure display - no state, no effects. All
//      lifecycle owned by the parent. Same shape as
//      SaveConfirmation.js.
//
// Visual per owner: subtle top-centered pill, small type, muted
// treatment. Deliberately NOT the SaveConfirmation stamp shape - a
// reset should not feel like a win.
//
// Accessibility: role="status" + aria-live="polite" gives AT users
// the same 'reset happened' confirmation as sighted users get from
// the visible pill. No aria-hidden decoration to hide; the whole
// element is the message.

export default function ResetToast({ message }) {
  return (
    <div className="sc-reset-toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

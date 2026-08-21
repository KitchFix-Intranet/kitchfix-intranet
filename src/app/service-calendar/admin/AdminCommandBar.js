"use client";
// SC Admin - command bar.
// Adopts the calendar's chrome + adds:
//   - ADMIN tag pill
//   - "Calendar" back-link
//   - Global counts block (accounts / services / scheduled)
//   - Cross-account search field with "/" hotkey
// Kevin ruling: no force-failure toggle (demo affordance only).
// The account selector is a "you are here" chip (display), not a
// dropdown - the accounts rail is the single account-switching path
// so nothing repeats in the same eyeline.

import { useEffect, useRef } from "react";

export default function AdminCommandBar({
  activeAccountKey,
  activeAccountName,
  totalAccounts,
  totalServices,
  totalScheduled,
  search,
  onSearchChange,
  onBackToCalendar,
  searchInputRef,
}) {
  const localRef = useRef(null);
  const ref = searchInputRef || localRef;

  return (
    <div className="scav-bar" role="banner">
      <div className="scav-brand">Service Calendar</div>
      <div className="scav-vr" aria-hidden="true" />
      <div className="scav-here" aria-label="Current account">
        {activeAccountKey ? (activeAccountName ? `${activeAccountKey} - ${activeAccountName}` : activeAccountKey) : "No account selected"}
      </div>
      <span className="scav-tag">ADMIN</span>
      <div className="scav-back">
        <button type="button" onClick={onBackToCalendar}>&#8249; Calendar</button>
      </div>
      <div className="scav-counts" aria-label="Global counts">
        <span>ACCOUNTS <b>{totalAccounts}</b></span>
        <span>SERVICES <b>{totalServices}</b></span>
        <span>SCHEDULED <b>{totalScheduled}</b></span>
      </div>
      <div className="scav-grow" />
      <div className="scav-search">
        <input
          ref={ref}
          id="scav-search-input"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Find a service"
        />
        <span className="k" aria-hidden="true">/</span>
      </div>
    </div>
  );
}

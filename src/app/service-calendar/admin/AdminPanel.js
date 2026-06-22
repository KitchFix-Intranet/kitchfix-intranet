"use client";
// SC admin three-state switch, extracted from the (now-retired) AdminClient.
// Hosted by ServiceCalendar.js inside the in-page admin view mode. The
// parent owns the view state (so the calendar's control row can render
// the "Admin - all accounts" label + "Overview" back-link in the
// selector slot when the user has drilled into a specific account).
//
//   view.mode === "overview"    -> AccountsOverview (the landing)
//   view.mode === "account"     -> AccountEditor   (per-meal drill-in)
//   view.mode === "feeAccount"  -> FeeAccountEditor (flat-fee drill-in)
//
// view.key carries the accountKey for the two drill-in modes.
//
// No hero, no toast container, no surrounding card chrome here - all of
// that lives in the calendar shell. AdminPanel is just the body switch.

import AccountsOverview from "./AccountsOverview";
import AccountEditor from "./AccountEditor";
import FeeAccountEditor from "./FeeAccountEditor";
// Co-locate the admin stylesheet with the admin component. Deleting
// AdminClient.js in PR #243 removed the only import of this stylesheet
// and nothing re-imported it, so every sc-admin-* class rendered
// unstyled. Anchoring the import here means the styles ship with
// AdminPanel wherever it mounts.
import "./ops-sc-admin.css";

export default function AdminPanel({ view, onViewChange, showToast }) {
  if (view?.mode === "overview" || !view) {
    return (
      <AccountsOverview
        onSelectPerMeal={(key) => onViewChange({ mode: "account", key })}
        onSelectFee={(key) => onViewChange({ mode: "feeAccount", key })}
      />
    );
  }
  if (view.mode === "account") {
    return (
      <AccountEditor
        accountKey={view.key}
        onBack={() => onViewChange({ mode: "overview" })}
        showToast={showToast}
      />
    );
  }
  if (view.mode === "feeAccount") {
    return (
      <FeeAccountEditor
        accountKey={view.key}
        onBack={() => onViewChange({ mode: "overview" })}
        showToast={showToast}
      />
    );
  }
  return null;
}

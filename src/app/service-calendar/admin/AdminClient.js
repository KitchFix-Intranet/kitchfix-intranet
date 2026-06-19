"use client";
// SC admin Stage 2 - shell with three states:
//   view === "overview"    -> AccountsOverview (the landing)
//   view === "account"     -> AccountEditor   (per-meal drill-in)
//   view === "feeAccount"  -> FeeAccountEditor (flat-fee drill-in)

import Link from "next/link";
import { useCallback, useState } from "react";
import AccountsOverview from "./AccountsOverview";
import AccountEditor from "./AccountEditor";
import FeeAccountEditor from "./FeeAccountEditor";
import "../ops-sc.css";
import "./ops-sc-admin.css";

export default function AdminClient({ email }) {
  const [view, setView] = useState({ mode: "overview" });
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  return (
    <div className="sc-admin-root" data-density="comfortable">
      <div className="sc-admin-card">
        <div className="sc-admin-header">
          <div className="sc-admin-title-row">
            <h1 className="sc-admin-title">Service Calendar admin</h1>
            <span className="sc-admin-corp-chip" title="Visible to corporate only">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Corporate only
            </span>
          </div>
          {view.mode === "overview" ? (
            <p className="sc-admin-subtitle">
              Pricing + fee control. All-account overview; drill in to edit.
            </p>
          ) : null}
        </div>

        {view.mode === "overview" && (
          <AccountsOverview
            onSelectPerMeal={(key) => setView({ mode: "account", key })}
            onSelectFee={(key) => setView({ mode: "feeAccount", key })}
          />
        )}
        {view.mode === "account" && (
          <AccountEditor
            accountKey={view.key}
            onBack={() => setView({ mode: "overview" })}
            showToast={showToast}
          />
        )}
        {view.mode === "feeAccount" && (
          <FeeAccountEditor
            accountKey={view.key}
            onBack={() => setView({ mode: "overview" })}
            showToast={showToast}
          />
        )}

        {view.mode === "overview" && (
          <Link href="/service-calendar" className="sc-admin-back" prefetch={false}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to Service Calendar
          </Link>
        )}
      </div>

      {toast && (
        <div className="sc-admin-toast-container">
          <div className={`sc-admin-toast sc-admin-toast--${toast.type}`}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}

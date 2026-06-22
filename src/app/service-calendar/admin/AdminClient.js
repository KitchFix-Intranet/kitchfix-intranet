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
// ops-shared.css supplies the .oh-hero / .oh-hero-overlay / .oh-hero-content
// / .oh-hero-title / .oh-hero-subtitle classes. Same import as the operator
// page (src/app/service-calendar/page.js) so the admin reads as the same
// product when you cross from calendar to admin.
import "@/app/ops/css/ops-shared.css";
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
      {/* Hero band - reuses .oh-hero so the admin reads as the same product
          as the operator calendar. Height dialed down via .sc-admin-hero
          modifier; no food photo (workspace, not landing). */}
      <div className="oh-hero sc-admin-hero">
        <div className="oh-hero-overlay" />
        <div className="oh-hero-content sc-admin-hero-content">
          <Link href="/service-calendar" className="sc-admin-hero-back" prefetch={false}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to Service Calendar
          </Link>
          <div className="sc-admin-hero-row">
            <h1 className="oh-hero-title">Service Calendar admin</h1>
            <span className="sc-admin-corp-chip sc-admin-corp-chip--hero" title="Visible to corporate only">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Corporate only
            </span>
          </div>
          <p className="oh-hero-subtitle">Pricing and fee control - corporate only</p>
        </div>
      </div>

      <div className="sc-admin-card">
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

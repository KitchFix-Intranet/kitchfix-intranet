"use client";
// Stage 1 placeholder shell. Future stages drop the section nav, price
// editor, fee schedule, services archive, fun money, and change log into
// this layout. The shell uses sc- CSS prefix + comfortable density to
// match the broader SC visual system. Brand navy + green only; no
// generic Tailwind blues.

import Link from "next/link";
import "../ops-sc.css";
import "./ops-sc-admin.css";

export default function AdminClient({ email }) {
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
          <p className="sc-admin-subtitle">
            Control panel for pricing, fees, and services. Editing tools arrive in later stages.
          </p>
        </div>

        <div className="sc-admin-scaffold">
          <p className="sc-admin-scaffold-line">
            This is a scaffold. The price overview, fee schedule, services archive,
            fun-money config, and change log will land in their own staged PRs.
          </p>
          <Link href="/service-calendar" className="sc-admin-back" prefetch={false}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to Service Calendar
          </Link>
        </div>
      </div>
    </div>
  );
}

"use client";
// The admin landing. Lists all active non-CORP accounts:
//   - Per-meal accounts (PDC + STL-FL hybrid + MiLB) are clickable rows
//     that open the price editor for that account.
//   - Fee accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V) are non-clickable
//     placeholders with "Fee schedule coming soon" copy; their per-meal
//     prices are operationally $0 and editing them would mislead.
//
// Uses GET /api/service-calendar?action=sc-admin-all-config.
// AbortController guards against stale responses if the user clicks fast.

import { useEffect, useState } from "react";

function fmtDate(iso) {
  if (!iso) return "Never";
  // iso may be a date "YYYY-MM-DD" or a timestamptz; slice the date part.
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}

function categoryLabel(level) {
  if (!level) return "";
  const L = String(level).toUpperCase();
  if (L === "MLB") return "MLB";
  if (L === "AAA" || L === "AA" || L === "MILB") return "MiLB";
  if (L === "PDC") return "PDC";
  return level;
}

export default function AccountsOverview({ onSelect }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch("/api/service-calendar?action=sc-admin-all-config", { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) {
          setError(d.error || "Failed to load");
          setData(null);
        } else {
          setData(d);
        }
      })
      .catch((e) => { if (e.name !== "AbortError") setError("Network error"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="sc-admin-loading">
        <div className="oh-spinner" />
        <p>Loading accounts...</p>
      </div>
    );
  }
  if (error) {
    return <div className="sc-admin-error">Couldn&apos;t load accounts: {error}</div>;
  }
  if (!data || !data.accounts?.length) {
    return <div className="sc-admin-empty">No accounts available.</div>;
  }

  // Fee accounts = MLB-level flat_fee. The 4 MLB fee accounts (CIN-OH,
  // STL-MO, TXR-TX-H, TXR-TX-V) use the fee schedule for billing; their
  // per-meal prices in sc_service_prices are operationally $0. STL-FL
  // is flat_fee but PDC-level - the calendar treats it as per-meal
  // (homestand schedule is empty) and so does the admin editor.
  const isFee = (a) => a.billingModel === "flat_fee" && String(a.level || "").toUpperCase() === "MLB";
  const perMeal = data.accounts.filter((a) => !isFee(a));
  const fee = data.accounts.filter(isFee);

  return (
    <div className="sc-admin-overview">
      {perMeal.length > 0 && (
        <section className="sc-admin-section">
          <h2 className="sc-admin-section-title">Per-meal accounts</h2>
          <ul className="sc-admin-list">
            {perMeal.map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  className="sc-admin-row sc-admin-row--clickable"
                  onClick={() => onSelect(a.key)}
                >
                  <span className="sc-admin-row-key">{a.key}</span>
                  <span className="sc-admin-row-name">{a.name}</span>
                  <span className={`sc-cat sc-cat--${(categoryLabel(a.level) || "").toLowerCase()}`}>{categoryLabel(a.level)}</span>
                  <span className="sc-admin-row-count">{a.services?.length || 0} svc</span>
                  <span className="sc-admin-row-updated">upd {fmtDate(a.lastUpdatedAt)}</span>
                  <span className="sc-admin-row-chev" aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fee.length > 0 && (
        <section className="sc-admin-section">
          <h2 className="sc-admin-section-title">Fee accounts</h2>
          <ul className="sc-admin-list">
            {fee.map((a) => (
              <li key={a.key}>
                <div className="sc-admin-row sc-admin-row--disabled" aria-disabled="true">
                  <span className="sc-admin-row-key">{a.key}</span>
                  <span className="sc-admin-row-name">{a.name}</span>
                  <span className={`sc-cat sc-cat--${(categoryLabel(a.level) || "").toLowerCase()}`}>{categoryLabel(a.level)}</span>
                  <span className="sc-admin-row-fee-note">Fee schedule coming soon</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

"use client";
// The admin landing. Lists all active non-CORP accounts:
//   - Per-meal accounts (PDC + MiLB) are clickable rows that open the per-
//     service price editor for that account.
//   - Fee accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V, STL-FL) are clickable
//     rows that open the fee schedule editor. TXR-TX-V displays "covered by
//     TXR - TX - H" in place of the dollar amount.
//
// Two fetches in parallel: sc-admin-all-config (for both sections' base data
// + per-meal counts) and sc-admin-fee-list (for the current fee amounts).
// AbortController guards against stale responses if the user clicks fast.

import { useEffect, useState } from "react";

function fmtDate(iso) {
  if (!iso) return "Never";
  const d = iso.slice(0, 10);
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}

function fmtAmount(n) {
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function categoryLabel(level) {
  if (!level) return "";
  const L = String(level).toUpperCase();
  if (L === "MLB") return "MLB";
  if (L === "AAA" || L === "AA" || L === "MILB") return "MiLB";
  if (L === "PDC") return "PDC";
  return level;
}

export default function AccountsOverview({ onSelectPerMeal, onSelectFee }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [feesByKey, setFeesByKey] = useState({});

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/service-calendar?action=sc-admin-all-config", { signal: controller.signal }).then((r) => r.json()),
      fetch("/api/service-calendar?action=sc-admin-fee-list", { signal: controller.signal }).then((r) => r.json()),
    ])
      .then(([cfgRes, feeRes]) => {
        if (!cfgRes.success) { setError(cfgRes.error || "Failed to load"); setData(null); return; }
        if (!feeRes.success) { setError(feeRes.error || "Failed to load fees"); setData(null); return; }
        setData(cfgRes);
        const idx = {};
        for (const f of feeRes.fees || []) idx[f.accountKey] = f;
        setFeesByKey(idx);
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

  // Fee accounts = billing_model = flat_fee (all 5: 4 MLB + STL-FL the
  // promoted PDC). Per-meal = everything else.
  const isFee = (a) => a.billingModel === "flat_fee";
  const perMeal = data.accounts.filter((a) => !isFee(a));
  const fee = data.accounts.filter(isFee);
  const totalCount = data.accounts.length;

  return (
    <div className="sc-admin-overview">
      {/* At-a-glance summary strip. Echoes the operator calendar's stat
          banner pattern. Counts derived from the already-loaded accounts
          payload; no new fetch, no new orchestrator call. */}
      <div className="sc-admin-summary">
        <span className="sc-admin-summary-item"><strong>{totalCount}</strong> account{totalCount === 1 ? "" : "s"}</span>
        <span className="sc-admin-summary-sep" aria-hidden="true">·</span>
        <span className="sc-admin-summary-item"><strong>{perMeal.length}</strong> per-meal</span>
        <span className="sc-admin-summary-sep" aria-hidden="true">·</span>
        <span className="sc-admin-summary-item"><strong>{fee.length}</strong> fee</span>
      </div>

      {perMeal.length > 0 && (
        <section className="sc-admin-section">
          <h2 className="sc-admin-section-title">Per-meal accounts</h2>
          <ul className="sc-admin-list">
            {perMeal.map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  className="sc-admin-row sc-admin-row--clickable"
                  onClick={() => onSelectPerMeal(a.key)}
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
            {fee.map((a) => {
              const feeEntry = feesByKey[a.key];
              const isBundled = !!feeEntry?.current?.coveredByAccountKey;
              const amountDisplay = !feeEntry?.current
                ? "no fee on file"
                : isBundled
                  ? `covered by ${feeEntry.current.coveredByAccountKey}`
                  : `${fmtAmount(feeEntry.current.amount)} annual`;
              return (
                <li key={a.key}>
                  <button
                    type="button"
                    className="sc-admin-row sc-admin-row--clickable"
                    onClick={() => onSelectFee(a.key)}
                  >
                    <span className="sc-admin-row-key">{a.key}</span>
                    <span className="sc-admin-row-name">{a.name}</span>
                    <span className={`sc-cat sc-cat--${(categoryLabel(a.level) || "").toLowerCase()}`}>{categoryLabel(a.level)}</span>
                    <span className="sc-admin-row-fee-amount">{amountDisplay}</span>
                    <span className="sc-admin-row-chev" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

"use client";
// Per-account fee editor. Shows the active annual fee + any scheduled
// upcoming change + history. Wraps FeeEditPanel for the write path.
//
// Special handling for bundled accounts (TXR-TX-V is the canonical case):
//   - amount = 0 with covered_by_account_key set
//   - displays "Bundled into <covered_by>" instead of "$0 annual"
//   - Edit is disabled (the schema's chk_bundled_zero_amount + the Bundle 1
//     scope decision: bundled markers are seed-time decisions, not admin-
//     toggleable)

import { useCallback, useEffect, useState } from "react";
import FeeEditPanel from "./FeeEditPanel";
import LaborBudgetsPanel from "./LaborBudgetsPanel";
// M-1 (2026-08-09): Labor budgets are MLB-only. Same gate the
// derivation uses.
const MLB_LABOR_BUDGET_ACCOUNTS = new Set([
  "CIN - OH",
  "STL - MO",
  "TXR - TX - H",
  "TXR - TX - V",
]);

function fmtAmount(n) {
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = String(iso).slice(0, 10);
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}

function fmtCadence(c) {
  if (!c) return "";
  if (c === "monthly-6") return "6 monthly installments";
  if (c === "monthly-7") return "7 monthly installments";
  if (c === "quarterly") return "Quarterly";
  if (c === "annual") return "Annual";
  return c;
}

function categoryLabel(level) {
  if (!level) return "";
  const L = String(level).toUpperCase();
  if (L === "MLB") return "MLB";
  if (L === "AAA" || L === "AA" || L === "MILB") return "MiLB";
  if (L === "PDC") return "PDC";
  return level;
}

export default function FeeAccountEditor({ accountKey, onBack, showToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [feeData, setFeeData] = useState(null);   // { current, upcoming, name, level, ... } for this account
  const [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      fetch("/api/service-calendar?action=sc-admin-fee-list", { signal: controller.signal }).then((r) => r.json()),
      fetch(`/api/service-calendar?action=sc-admin-fee-history&account=${encodeURIComponent(accountKey)}`,
        { signal: controller.signal }).then((r) => r.json()),
    ]).then(([listRes, histRes]) => {
      if (!listRes.success) { setError(listRes.error || "Failed to load fee"); return; }
      if (!histRes.success) { setError(histRes.error || "Failed to load fee history"); return; }
      const entry = (listRes.fees || []).find((f) => f.accountKey === accountKey);
      if (!entry) { setError(`Fee account ${accountKey} not found`); return; }
      setFeeData(entry);
      setHistory(histRes.history || []);
    }).catch((e) => {
      if (e.name !== "AbortError") setError("Network error");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });

    return () => controller.abort();
  }, [accountKey, reloadKey]);

  const handleSaved = useCallback(() => {
    setEditing(false);
    setReloadKey((k) => k + 1);
    showToast("Fee updated", "success");
  }, [showToast]);

  if (loading) {
    return (
      <div className="sc-admin-loading">
        <div className="oh-spinner" />
        <p>Loading fee schedule...</p>
      </div>
    );
  }
  if (error) {
    return <div className="sc-admin-error">Couldn&apos;t load fee: {error}</div>;
  }
  if (!feeData) return null;

  const current = feeData.current;
  const upcoming = feeData.upcoming;
  const isBundled = !!current?.coveredByAccountKey;

  return (
    <div className="sc-admin-editor">
      <button type="button" className="sc-admin-back sc-admin-back--inline" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        All accounts
      </button>

      <div className="sc-admin-editor-head">
        <div className="sc-admin-editor-title-row">
          <h2 className="sc-admin-editor-title">{accountKey}</h2>
          {feeData.name && <span className="sc-admin-editor-name">{feeData.name}</span>}
          {feeData.level && (
            <span className={`sc-cat sc-cat--${(categoryLabel(feeData.level) || "").toLowerCase()}`}>{categoryLabel(feeData.level)}</span>
          )}
        </div>
        <p className="sc-admin-editor-section">Fee schedule</p>
      </div>

      <section className="sc-admin-fee-current-card">
        {!current ? (
          <div className="sc-admin-empty">No fee on file for this account.</div>
        ) : isBundled ? (
          <div className="sc-admin-fee-bundled">
            <div className="sc-admin-fee-bundled-label">Bundled</div>
            <div className="sc-admin-fee-bundled-text">
              Covered by <strong>{current.coveredByAccountKey}</strong>
            </div>
            <div className="sc-admin-fee-bundled-note">
              Billed as part of the {current.coveredByAccountKey} contract. Do not bill separately - it would double-count.
            </div>
          </div>
        ) : (
          <div className="sc-admin-fee-active">
            <div className="sc-admin-fee-active-label">Current annual fee</div>
            <div className="sc-admin-fee-active-amount">{fmtAmount(current.amount)}</div>
            <div className="sc-admin-fee-active-meta">
              <span>since {fmtDate(current.effectiveDate)}</span>
              {current.paymentCadence && <span> · {fmtCadence(current.paymentCadence)}</span>}
            </div>
            {upcoming && (
              <div className="sc-admin-svc-upcoming">
                scheduled {fmtAmount(upcoming.amount)} {fmtDate(upcoming.effectiveDate)}
              </div>
            )}
            <div className="sc-admin-fee-active-actions">
              <button
                type="button"
                className="sc-admin-svc-edit"
                onClick={() => setEditing((v) => !v)}
                aria-expanded={editing}
              >
                {editing ? "Close" : "Edit fee"}
              </button>
            </div>
          </div>
        )}
      </section>

      {editing && !isBundled && (
        <FeeEditPanel
          accountKey={accountKey}
          current={current}
          onCancel={() => setEditing(false)}
          onSaved={handleSaved}
          showToast={showToast}
        />
      )}

      {MLB_LABOR_BUDGET_ACCOUNTS.has(accountKey) && (
        <LaborBudgetsPanel accountKey={accountKey} showToast={showToast} />
      )}

      <section className="sc-admin-fee-history">
        <h3 className="sc-admin-section-title">History</h3>
        {history.length === 0 ? (
          <div className="sc-admin-empty">No history rows.</div>
        ) : (
          <ul className="sc-admin-fee-history-list">
            {history.map((h) => (
              <li key={h.id} className="sc-admin-fee-history-row">
                <span className="sc-admin-fee-history-amount">
                  {h.coveredByAccountKey
                    ? `covered by ${h.coveredByAccountKey}`
                    : fmtAmount(h.amount)}
                </span>
                <span className="sc-admin-fee-history-eff">eff {fmtDate(h.effectiveDate)}</span>
                <span className="sc-admin-fee-history-by">{h.changedBy}</span>
                <span className="sc-admin-fee-history-when" title={h.createdAt}>{fmtDate(h.createdAt)}</span>
                {h.reason && <span className="sc-admin-fee-history-reason" title={h.reason}>{h.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

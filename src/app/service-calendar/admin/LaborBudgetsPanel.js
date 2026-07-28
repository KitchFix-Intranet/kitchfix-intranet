"use client";
// M-1 (2026-08-09): Labor budgets admin panel.
//
// Mounts inside FeeAccountEditor for the four MLB accounts (via the
// DERIVE_HOMESTANDS_ACCOUNTS gate). Shows per-period live budgets +
// TXR-V's labor_ratio; inline edit forms write through the M-1 API.
//
// Missing-vs-zero: NULL renders as "not set" (muted italic), never
// as "$0". First real edit fills the field. Save requires a reason.

import { useCallback, useEffect, useState } from "react";

// sc-21 (2026-08-15): storage is BARE NUMERIC ("4"..."10"), matching
// sc_day_metadata's house convention. Display adds the "P" prefix at
// render (see fmtPeriod below). Never store the P-form; the join
// against sc_day_metadata.period would break silently.
const PERIODS = ["4", "5", "6", "7", "8", "9", "10"];
const fmtPeriod = (p) => `P${p}`;

const REVENUE_FLEX_ACCOUNTS = new Set(["TXR - TX - V"]);

function fmtAmount(n) {
  if (n == null) return null;
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = String(iso).slice(0, 10);
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ─── Panel ──────────────────────────────────────────────────────
export default function LaborBudgetsPanel({ accountKey, showToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [budgets, setBudgets] = useState([]); // live rows
  const [laborRatio, setLaborRatio] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editingPeriod, setEditingPeriod] = useState(null); // "4" | null (bare numeric per sc-21)
  const [editingRatio, setEditingRatio] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/service-calendar?action=sc-admin-labor-budgets-list&account=${encodeURIComponent(accountKey)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res.success) { setError(res.error || "Failed to load labor budgets"); return; }
        setBudgets(res.budgets || []);
        setLaborRatio(res.laborRatio ?? null);
      })
      .catch((e) => { if (e.name !== "AbortError") setError("Network error"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [accountKey, reloadKey]);

  const onSaved = useCallback(() => {
    setReloadKey((k) => k + 1);
    setEditingPeriod(null);
    setEditingRatio(false);
    showToast?.("Labor budget updated", "success");
  }, [showToast]);

  const isRevenueFlex = REVENUE_FLEX_ACCOUNTS.has(accountKey);
  const byPeriod = Object.fromEntries((budgets || []).map(b => [b.period, b]));

  if (loading) {
    return (
      <section className="sc-admin-fee-current-card">
        <p className="sc-admin-section-title">Labor budget</p>
        <div className="sc-admin-loading">
          <div className="oh-spinner" />
          <p>Loading labor budgets...</p>
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="sc-admin-fee-current-card">
        <p className="sc-admin-section-title">Labor budget</p>
        <div className="sc-admin-error">Couldn&apos;t load: {error}</div>
      </section>
    );
  }

  return (
    <>
      <section className="sc-admin-fee-current-card">
        <p className="sc-admin-section-title">Labor budget (MLB)</p>
        <p className="sc-admin-editor-section" style={{ marginTop: 0 }}>
          Per-period hourly + salary + revenue forecast. Hourly is the chef target.
          Salary is reporting only. Revenue forecast drives TXR-V flex.
        </p>
        <table className="sc-admin-labor-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Hourly</th>
              <th>Salary</th>
              <th>Revenue</th>
              <th>Effective</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((p) => {
              const b = byPeriod[p];
              return (
                <tr key={p}>
                  <td><strong>{fmtPeriod(p)}</strong></td>
                  <td>{b?.hourly_budget != null ? fmtAmount(b.hourly_budget) : <em style={{ color: "var(--text-muted, #888)" }}>not set</em>}</td>
                  <td>{b?.salary_budget != null ? fmtAmount(b.salary_budget) : <em style={{ color: "var(--text-muted, #888)" }}>not set</em>}</td>
                  <td>{b?.revenue_forecast != null ? fmtAmount(b.revenue_forecast) : <em style={{ color: "var(--text-muted, #888)" }}>not set</em>}</td>
                  <td>{b?.effective_from ? fmtDate(b.effective_from) : <em style={{ color: "var(--text-muted, #888)" }}>—</em>}</td>
                  <td>
                    <button
                      type="button"
                      className="sc-admin-svc-edit"
                      onClick={() => setEditingPeriod(editingPeriod === p ? null : p)}
                      aria-expanded={editingPeriod === p}
                    >
                      {editingPeriod === p ? "Close" : "Edit"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {editingPeriod && (
          <LaborBudgetEditPanel
            accountKey={accountKey}
            period={editingPeriod}
            current={byPeriod[editingPeriod] || null}
            onCancel={() => setEditingPeriod(null)}
            onSaved={onSaved}
            showToast={showToast}
          />
        )}
      </section>

      {isRevenueFlex && (
        <section className="sc-admin-fee-current-card">
          <p className="sc-admin-section-title">Labor ratio (revenue-flex)</p>
          <p className="sc-admin-editor-section" style={{ marginTop: 0 }}>
            Sold revenue × ratio = adjusted labor envelope per homestand.
          </p>
          <div className="sc-admin-fee-active">
            <div className="sc-admin-fee-active-label">Current ratio</div>
            <div className="sc-admin-fee-active-amount">
              {laborRatio != null
                ? `${(Number(laborRatio) * 100).toFixed(2)}%`
                : <em style={{ color: "var(--text-muted, #888)" }}>not set</em>}
            </div>
            <div className="sc-admin-fee-active-actions">
              <button
                type="button"
                className="sc-admin-svc-edit"
                onClick={() => setEditingRatio((v) => !v)}
                aria-expanded={editingRatio}
              >
                {editingRatio ? "Close" : "Edit ratio"}
              </button>
            </div>
          </div>
          {editingRatio && (
            <LaborRatioEditPanel
              accountKey={accountKey}
              current={laborRatio}
              onCancel={() => setEditingRatio(false)}
              onSaved={onSaved}
              showToast={showToast}
            />
          )}
        </section>
      )}
    </>
  );
}

// ─── Budget edit form ───────────────────────────────────────────
function LaborBudgetEditPanel({ accountKey, period, current, onCancel, onSaved, showToast }) {
  const [hourly, setHourly] = useState(current?.hourly_budget ?? "");
  const [salary, setSalary] = useState(current?.salary_budget ?? "");
  const [revenue, setRevenue] = useState(current?.revenue_forecast ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(localToday());
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const normalize = (v) => (v === "" || v == null) ? null : Number(v);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { showToast?.("Reason required", "error"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "sc-admin-labor-budget-set",
          accountKey,
          period,
          hourlyBudget: normalize(hourly),
          salaryBudget: normalize(salary),
          revenueForecast: normalize(revenue),
          effectiveFrom,
          reason: reason.trim(),
          requestedBy: requestedBy.trim() || null,
        }),
      }).then((r) => r.json());
      if (!res.success) { showToast?.(res.error || "Save failed", "error"); setSaving(false); return; }
      onSaved();
    } catch {
      showToast?.("Network error", "error");
      setSaving(false);
    }
  };

  return (
    <form className="sc-admin-fee-edit-panel" onSubmit={submit}>
      <div className="sc-admin-edit-row">
        <label>Hourly <input type="number" step="0.01" min="0" value={hourly} onChange={(e) => setHourly(e.target.value)} /></label>
        <label>Salary <input type="number" step="0.01" min="0" value={salary} onChange={(e) => setSalary(e.target.value)} /></label>
        <label>Revenue <input type="number" step="0.01" min="0" value={revenue} onChange={(e) => setRevenue(e.target.value)} /></label>
      </div>
      <div className="sc-admin-edit-row">
        <label>Effective from <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required /></label>
      </div>
      <label className="sc-admin-edit-full">
        Reason (required)
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} required />
      </label>
      <label className="sc-admin-edit-full">
        Requested by (optional)
        <input type="text" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} maxLength={280} />
      </label>
      <div className="sc-admin-edit-actions">
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" disabled={saving || !reason.trim()}>{saving ? "Saving..." : "Save"}</button>
      </div>
    </form>
  );
}

// ─── Ratio edit form ────────────────────────────────────────────
function LaborRatioEditPanel({ accountKey, current, onCancel, onSaved, showToast }) {
  const [ratioPct, setRatioPct] = useState(current != null ? (Number(current) * 100).toFixed(2) : "");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { showToast?.("Reason required", "error"); return; }
    const pct = Number(ratioPct);
    if (isNaN(pct) || pct <= 0 || pct >= 100) { showToast?.("Ratio must be in (0, 100)%", "error"); return; }
    const ratio = pct / 100;
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "sc-admin-labor-ratio-set",
          accountKey,
          laborRatio: ratio,
          reason: reason.trim(),
          requestedBy: requestedBy.trim() || null,
        }),
      }).then((r) => r.json());
      if (!res.success) { showToast?.(res.error || "Save failed", "error"); setSaving(false); return; }
      onSaved();
    } catch {
      showToast?.("Network error", "error");
      setSaving(false);
    }
  };

  return (
    <form className="sc-admin-fee-edit-panel" onSubmit={submit}>
      <div className="sc-admin-edit-row">
        <label>Ratio % <input type="number" step="0.01" min="0.01" max="99.99" value={ratioPct} onChange={(e) => setRatioPct(e.target.value)} required /></label>
      </div>
      <label className="sc-admin-edit-full">
        Reason (required)
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={280} required />
      </label>
      <label className="sc-admin-edit-full">
        Requested by (optional)
        <input type="text" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} maxLength={280} />
      </label>
      <div className="sc-admin-edit-actions">
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" disabled={saving || !reason.trim()}>{saving ? "Saving..." : "Save"}</button>
      </div>
    </form>
  );
}

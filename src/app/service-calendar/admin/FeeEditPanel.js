"use client";
// Inline edit panel for one fee account's annual fee. Mirrors PriceEditPanel
// (Today / Future / Backdate effective-date radios, required reason, optional
// requested-by) - the contract-revenue layer's editor twin.
//
// SAME MECHANICS AS PriceEditPanel:
// 1. effectiveDate is computed CLIENT-SIDE from the browser's LOCAL clock.
//    Vercel runs in UTC; "Today" picked in a US-evening session would roll
//    to tomorrow if the server decided. The operator's local today wins.
// 2. roundCents on both display and compare so a no-op same-amount save
//    cannot accidentally fire.
// 3. Future radio's date picker is min={tomorrow}.
// 4. Backdate (Stage 3) is fenced behind a third radio; max={yesterday},
//    min=2024-01-01. Warning copy differs from the price panel because fees
//    do NOT flow through the Service Calendar's revenue. Save payload sets
//    allowBackdate: true.

import { useEffect, useMemo, useState } from "react";

const BACKDATE_FLOOR = "2024-01-01";

function roundCents(n) {
  return Math.round(Number(n) * 100) / 100;
}

function localToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function localTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function localYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtAmount(n) {
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtDateHuman(iso) {
  if (!iso) return "";
  const d = String(iso).slice(0, 10);
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}

export default function FeeEditPanel({ accountKey, current, onCancel, onSaved, showToast }) {
  const currentAmount = roundCents(current?.amount ?? 0);
  const [newAmount, setNewAmount] = useState(currentAmount.toFixed(2));
  const [effMode, setEffMode] = useState("today");   // "today" | "future" | "backdate"
  const [futureDate, setFutureDate] = useState("");
  const [backdateDate, setBackdateDate] = useState("");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const today = useMemo(() => localToday(), []);
  const tomorrow = useMemo(() => localTomorrow(), []);
  const yesterday = useMemo(() => localYesterday(), []);

  useEffect(() => {
    const interval = setInterval(() => {}, 60_000);
    return () => clearInterval(interval);
  }, []);

  const newAmountNum = Number(newAmount);
  const newAmountRounded = isNaN(newAmountNum) ? null : roundCents(newAmountNum);
  const amountChanged = newAmountRounded !== null && newAmountRounded !== currentAmount;
  const effDate = effMode === "today" ? today : effMode === "future" ? futureDate : backdateDate;
  const isBackdate = effMode === "backdate";
  const effReady =
    effMode === "today" ||
    (effMode === "future" && /^\d{4}-\d{2}-\d{2}$/.test(futureDate) && futureDate >= tomorrow) ||
    (effMode === "backdate" && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday);
  const reasonReady = reason.trim().length > 0 && reason.length <= 280;
  const canSave = !saving && amountChanged && newAmountRounded >= 0 && effReady && reasonReady;

  // Admin PR 1 (2026-08-04, owner ruling): warn on backdate that
  // reaches a closed period. Same two-phase flow as PriceEditPanel.
  // Fee has NO revenue-delta number - sc_daily_revenue does not
  // include fee amounts, and per-period fee attribution requires
  // proration + payment-cadence design work distinct from this PR.
  // The warning still names the closed periods and the day count,
  // which is the honest signal for the fee case.
  const [backdateImpact, setBackdateImpact] = useState(null);
  const handleSave = async () => {
    if (!canSave) return;
    if (isBackdate && !backdateImpact) {
      setSaving(true);
      try {
        const previewRes = await fetch("/api/service-calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "sc-admin-backdate-preview",
            type: "fee",
            accountKey,
            effectiveDate: effDate,
          }),
        });
        const preview = await previewRes.json();
        if (preview.success && Array.isArray(preview.closedPeriods) && preview.closedPeriods.length > 0) {
          setBackdateImpact(preview);
          setSaving(false);
          return;
        }
      } catch {
        // Owner ruling: do not fail closed. On preview network error,
        // proceed to write.
      }
    }
    setSaving(true);
    try {
      const payload = {
        action: "sc-admin-fee-set",
        accountKey,
        amount: newAmountRounded,
        effectiveDate: effDate,
        reason: reason.trim(),
        requestedBy: requestedBy.trim() || undefined,
      };
      if (isBackdate) payload.allowBackdate = true;
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.success) {
        onSaved();
      } else {
        showToast(result.error || "Save failed", "error");
        setSaving(false);
        setBackdateImpact(null);
      }
    } catch {
      showToast("Network error", "error");
      setSaving(false);
      setBackdateImpact(null);
    }
  };

  const cancelBackdateConfirm = () => {
    setBackdateImpact(null);
    setSaving(false);
  };

  return (
    <div className="sc-admin-panel">
      <div className="sc-admin-panel-current">
        Current fee: <strong>{fmtAmount(currentAmount)} annual</strong>
        {current?.effectiveDate && (
          <span className="sc-admin-panel-since"> (since {fmtDateHuman(current.effectiveDate)})</span>
        )}
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`new-fee-${accountKey}`}>New annual fee</label>
        <div className="sc-admin-price-input-wrap sc-admin-fee-input-wrap">
          <span className="sc-admin-price-input-dollar">$</span>
          <input
            id={`new-fee-${accountKey}`}
            type="text"
            inputMode="decimal"
            className="sc-admin-price-input"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="sc-admin-field">
        <span className="sc-admin-field-label">Effective</span>
        <div className="sc-admin-eff-options">
          <label className="sc-admin-eff-option">
            <input
              type="radio"
              name={`fee-eff-${accountKey}`}
              checked={effMode === "today"}
              onChange={() => setEffMode("today")}
            />
            <span>
              <strong>Today</strong> ({fmtDateHuman(today)})
              <span className="sc-admin-eff-caption">Applies from today forward; history rows untouched.</span>
            </span>
          </label>
          <label className="sc-admin-eff-option">
            <input
              type="radio"
              name={`fee-eff-${accountKey}`}
              checked={effMode === "future"}
              onChange={() => setEffMode("future")}
            />
            <span className="sc-admin-eff-future-row">
              <strong>Future date</strong>
              <input
                type="date"
                className="sc-admin-eff-date"
                value={futureDate}
                min={tomorrow}
                onChange={(e) => { setFutureDate(e.target.value); setEffMode("future"); }}
                disabled={effMode !== "future"}
              />
              <span className="sc-admin-eff-caption sc-admin-eff-caption--inline">Becomes the active fee on that date automatically.</span>
            </span>
          </label>
          <label className="sc-admin-eff-option">
            <input
              type="radio"
              name={`fee-eff-${accountKey}`}
              checked={effMode === "backdate"}
              onChange={() => setEffMode("backdate")}
            />
            <span className="sc-admin-eff-future-row">
              <strong>Backdate</strong>
              <input
                type="date"
                className="sc-admin-eff-date"
                value={backdateDate}
                min={BACKDATE_FLOOR}
                max={yesterday}
                onChange={(e) => { setBackdateDate(e.target.value); setEffMode("backdate"); }}
                disabled={effMode !== "backdate"}
              />
              <span className="sc-admin-eff-caption sc-admin-eff-caption--inline">Sets the fee as if it had been in effect since that past date.</span>
            </span>
          </label>
        </div>
        {isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday && (
          <div className="sc-admin-eff-warning" role="alert">
            <strong>Backdate warning.</strong> Backdating changes the contract-revenue history starting {fmtDateHuman(backdateDate)}. This becomes the fee of record for those past dates in the contract-revenue history. The Service Calendar is not affected - fees do not flow through calendar revenue. Verify the date is correct before saving.
          </div>
        )}
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`fee-reason-${accountKey}`}>
          Reason <span className="sc-admin-field-required">required</span>
        </label>
        <textarea
          id={`fee-reason-${accountKey}`}
          className="sc-admin-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this fee changing? (CPI escalator, renegotiation, correction, etc.)"
          maxLength={280}
          rows={2}
        />
        <span className="sc-admin-field-count">{reason.length}/280</span>
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`fee-reqby-${accountKey}`}>
          Requested by <span className="sc-admin-field-optional">optional</span>
        </label>
        <input
          id={`fee-reqby-${accountKey}`}
          type="text"
          className="sc-admin-text-input"
          value={requestedBy}
          onChange={(e) => setRequestedBy(e.target.value)}
          placeholder="Who asked for this change?"
          maxLength={280}
        />
      </div>

      <div className="sc-admin-panel-actions">
        <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="sc-admin-btn sc-admin-btn--primary" onClick={handleSave} disabled={!canSave}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {backdateImpact && (
        <FeeBackdateClosedConfirm
          impact={backdateImpact}
          onCancel={cancelBackdateConfirm}
          onConfirm={handleSave}
          saving={saving}
        />
      )}
    </div>
  );
}

// Fee variant of the backdate warning modal. Same structure as
// PriceEditPanel's BackdateClosedConfirm, but no dollar delta line -
// fees do not per-day-attribute through sc_daily_revenue.
function FeeBackdateClosedConfirm({ impact, onCancel, onConfirm, saving }) {
  const { closedPeriods = [], affectedDayCount = 0 } = impact;
  const periodList = closedPeriods.map(p => `P${p}`).join(", ");
  const dayWord = affectedDayCount === 1 ? "day" : "days";
  const periodWord = closedPeriods.length === 1 ? "period" : "periods";
  return (
    <div className="sc-admin-backdate-modal" role="dialog" aria-modal="true" aria-labelledby="sc-fee-backdate-title">
      <div className="sc-admin-backdate-modal-card">
        <h3 id="sc-fee-backdate-title" className="sc-admin-backdate-modal-title">Backdate reaches a closed {periodWord}</h3>
        <div className="sc-admin-backdate-modal-body">
          <p>
            This fee change touches <strong>closed {periodWord} {periodList}</strong> across{" "}
            <strong>{affectedDayCount} {dayWord}</strong>.
          </p>
          <p>
            Fees do not flow through <code>sc_daily_revenue</code>, so no per-day dollar delta is
            computed. The contract-revenue history for those {periodWord} will still reflect the
            new fee on the next read.
          </p>
          <p className="sc-admin-backdate-modal-note">
            Confirming records the closed {periodWord} and {affectedDayCount} {dayWord} in the
            changelog alongside your reason.
          </p>
        </div>
        <div className="sc-admin-panel-actions">
          <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="sc-admin-btn sc-admin-btn--primary" onClick={onConfirm} disabled={saving}>
            {saving ? "Saving..." : "Confirm + save"}
          </button>
        </div>
      </div>
    </div>
  );
}

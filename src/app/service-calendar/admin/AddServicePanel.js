"use client";
// Inline add-service form rendered under an existing group. Captures
// serviceName, initialPrice, the three flag booleans, required reason,
// optional requested-by. Initial price lands at effective_date=today
// through the orchestrator.
//
// feeNoDollar prop (admin wave commit 1, 2026-08-04): on a flat-fee
// account, the initial-price field is hidden and the create posts
// price=0. Owner ruling: no price editing on a fee account; the
// annual fee is the billing, and any per-service price is
// irrelevant. Zero is the value the schema records so downstream
// views (sc_daily_revenue) compute projected/actual revenue as
// 0 * count = 0, matching how existing fee-account services
// already read.

import { useState } from "react";

export default function AddServicePanel({ accountKey, group, onCancel, onSaved, showToast, feeNoDollar = false }) {
  const [serviceName, setServiceName] = useState("");
  const [initialPrice, setInitialPrice] = useState("0.00");
  const [isFlatFee, setIsFlatFee] = useState(false);
  const [isTaxFree, setIsTaxFree] = useState(false);
  const [isNonRevenue, setIsNonRevenue] = useState(false);
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const nameReady = serviceName.trim().length > 0 && serviceName.length <= 120;
  // On feeNoDollar we bypass the operator-controlled price and post 0.
  const effectivePriceNum = feeNoDollar ? 0 : Number(initialPrice);
  const priceReady = feeNoDollar || (!isNaN(effectivePriceNum) && effectivePriceNum >= 0);
  const reasonReady = reason.trim().length > 0 && reason.length <= 280;
  const canSave = !saving && nameReady && priceReady && reasonReady;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sc-admin-add-service",
          accountKey,
          groupId: group.id,
          serviceName: serviceName.trim(),
          initialPrice: effectivePriceNum,
          isFlatFee,
          isTaxFree,
          isNonRevenue,
          reason: reason.trim(),
          requestedBy: requestedBy.trim() || undefined,
        }),
      });
      const result = await res.json();
      if (result.success) {
        onSaved();
      } else {
        showToast(result.error || "Add failed", "error");
        setSaving(false);
      }
    } catch {
      showToast("Network error", "error");
      setSaving(false);
    }
  };

  return (
    <div className="sc-admin-panel">
      <div className="sc-admin-panel-current">
        Add a service to <strong>{group.groupName}</strong>. {feeNoDollar
          ? "This account bills a flat annual fee; the new service is created at price 0 and archive uses the same flow."
          : "The initial price applies from today forward; archive uses the same flow as other services."}
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`add-svc-name-${group.id}`}>
          Service name <span className="sc-admin-field-required">required</span>
        </label>
        <input
          id={`add-svc-name-${group.id}`}
          type="text"
          className="sc-admin-text-input"
          value={serviceName}
          onChange={(e) => setServiceName(e.target.value)}
          placeholder="e.g. Continental Plus"
          maxLength={120}
        />
      </div>

      {!feeNoDollar && (
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor={`add-svc-price-${group.id}`}>Initial price</label>
          <div className="sc-admin-price-input-wrap">
            <span className="sc-admin-price-input-dollar">$</span>
            <input
              id={`add-svc-price-${group.id}`}
              type="text"
              inputMode="decimal"
              className="sc-admin-price-input"
              value={initialPrice}
              onChange={(e) => setInitialPrice(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
            />
          </div>
        </div>
      )}

      <div className="sc-admin-field">
        <span className="sc-admin-field-label">Flags</span>
        <div className="sc-admin-flag-row">
          <label className="sc-admin-flag-label">
            <input type="checkbox" checked={isTaxFree} onChange={(e) => setIsTaxFree(e.target.checked)} />
            <span>Tax-free</span>
          </label>
          <label className="sc-admin-flag-label">
            <input type="checkbox" checked={isFlatFee} onChange={(e) => setIsFlatFee(e.target.checked)} />
            <span>Flat fee</span>
          </label>
          <label className="sc-admin-flag-label">
            <input type="checkbox" checked={isNonRevenue} onChange={(e) => setIsNonRevenue(e.target.checked)} />
            <span>Non-revenue (e.g. Fun Money)</span>
          </label>
        </div>
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`add-svc-reason-${group.id}`}>
          Reason <span className="sc-admin-field-required">required</span>
        </label>
        <textarea
          id={`add-svc-reason-${group.id}`}
          className="sc-admin-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this service being added?"
          maxLength={280}
          rows={2}
        />
        <span className="sc-admin-field-count">{reason.length}/280</span>
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`add-svc-reqby-${group.id}`}>
          Requested by <span className="sc-admin-field-optional">optional</span>
        </label>
        <input
          id={`add-svc-reqby-${group.id}`}
          type="text"
          className="sc-admin-text-input"
          value={requestedBy}
          onChange={(e) => setRequestedBy(e.target.value)}
          placeholder="Who asked for this addition?"
          maxLength={280}
        />
      </div>

      <div className="sc-admin-panel-actions">
        <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="sc-admin-btn sc-admin-btn--primary" onClick={handleSave} disabled={!canSave}>
          {saving ? "Adding..." : "Add service"}
        </button>
      </div>
    </div>
  );
}

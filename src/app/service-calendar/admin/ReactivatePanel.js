"use client";
// Inline confirm for reactivating a service or group. Reactivate sets
// active_until back to NULL; no date picker needed (reactivate is
// immediate). Required reason + optional requested-by.

import { useState } from "react";

export default function ReactivatePanel({ accountKey, entity, entityType, onCancel, onSaved, showToast }) {
  // entityType: "service" | "group"
  // entity:    { id, serviceName? | groupName?, activeUntil }
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const label = entityType === "group" ? entity.groupName : entity.serviceName;
  const action = entityType === "group" ? "sc-admin-reactivate-group" : "sc-admin-reactivate-service";
  const idField = entityType === "group" ? "groupId" : "serviceId";

  const reasonReady = reason.trim().length > 0 && reason.length <= 280;
  const canSave = !saving && reasonReady;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          accountKey,
          [idField]: entity.id,
          reason: reason.trim(),
          requestedBy: requestedBy.trim() || undefined,
        }),
      });
      const result = await res.json();
      if (result.success) {
        onSaved();
      } else {
        showToast(result.error || "Reactivate failed", "error");
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
        Reactivate <strong>{label}</strong>. Clears the archive marker - the {entityType} becomes active again from today forward. Historical data unchanged.
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`rea-reason-${entity.id}`}>
          Reason <span className="sc-admin-field-required">required</span>
        </label>
        <textarea
          id={`rea-reason-${entity.id}`}
          className="sc-admin-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`Why is this ${entityType} being reactivated?`}
          maxLength={280}
          rows={2}
        />
        <span className="sc-admin-field-count">{reason.length}/280</span>
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`rea-reqby-${entity.id}`}>
          Requested by <span className="sc-admin-field-optional">optional</span>
        </label>
        <input
          id={`rea-reqby-${entity.id}`}
          type="text"
          className="sc-admin-text-input"
          value={requestedBy}
          onChange={(e) => setRequestedBy(e.target.value)}
          placeholder="Who asked for this reactivation?"
          maxLength={280}
        />
      </div>

      <div className="sc-admin-panel-actions">
        <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="sc-admin-btn sc-admin-btn--primary" onClick={handleSave} disabled={!canSave}>
          {saving ? "Reactivating..." : "Reactivate"}
        </button>
      </div>
    </div>
  );
}

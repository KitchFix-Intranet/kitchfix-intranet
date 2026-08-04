"use client";
// Inline add-group form rendered at the bottom of the per-account editor.
// Captures groupName + required reason + optional requested-by.

import { useRef, useState } from "react";
// Admin wave commit 3 (2026-08-04): inline dialog a11y.
import { useDialogA11y } from "../useDialogA11y";

export default function AddGroupPanel({ accountKey, onCancel, onSaved, showToast }) {
  const cardRef = useRef(null);
  useDialogA11y({ cardRef, isOpen: true, onClose: onCancel, trapTab: false });
  const [groupName, setGroupName] = useState("");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const nameReady = groupName.trim().length > 0 && groupName.length <= 120;
  const reasonReady = reason.trim().length > 0 && reason.length <= 280;
  const canSave = !saving && nameReady && reasonReady;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sc-admin-add-group",
          accountKey,
          groupName: groupName.trim(),
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
    <div className="sc-admin-panel" ref={cardRef} tabIndex={-1}>
      <div className="sc-admin-panel-current">
        Add a new service group to <strong>{accountKey}</strong>. After creating the group you can add services to it.
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`add-grp-name-${accountKey}`}>
          Group name <span className="sc-admin-field-required">required</span>
        </label>
        <input
          id={`add-grp-name-${accountKey}`}
          type="text"
          className="sc-admin-text-input"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="e.g. Rehab, Minor League"
          maxLength={120}
        />
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`add-grp-reason-${accountKey}`}>
          Reason <span className="sc-admin-field-required">required</span>
        </label>
        <textarea
          id={`add-grp-reason-${accountKey}`}
          className="sc-admin-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this group being added?"
          maxLength={280}
          rows={2}
        />
        <span className="sc-admin-field-count">{reason.length}/280</span>
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`add-grp-reqby-${accountKey}`}>
          Requested by <span className="sc-admin-field-optional">optional</span>
        </label>
        <input
          id={`add-grp-reqby-${accountKey}`}
          type="text"
          className="sc-admin-text-input"
          value={requestedBy}
          onChange={(e) => setRequestedBy(e.target.value)}
          placeholder="Who asked for this group?"
          maxLength={280}
        />
      </div>

      <div className="sc-admin-panel-actions">
        <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="sc-admin-btn sc-admin-btn--primary" onClick={handleSave} disabled={!canSave}>
          {saving ? "Adding..." : "Add group"}
        </button>
      </div>
    </div>
  );
}

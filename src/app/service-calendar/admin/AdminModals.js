"use client";
// SC Admin - modal wrappers.
// Provides ModalShell (scrim + centered card + Escape/focus a11y) and
// four modal components that wrap the existing write-path panels in
// modal chrome:
//   - AddServiceModal     -> POST sc-admin-add-service   (with feeNoDollar threading)
//   - AddGroupModal       -> POST sc-admin-add-group
//   - ArchiveGroupModal   -> POST sc-admin-archive-group (with acknowledged blast-radius gate)
//   - ReactivateGroupModal-> POST sc-admin-reactivate-group
//
// Payloads unchanged from the retired *Panel components. Same date
// fence for archive-group backdate. Same reason + acknowledged
// requirements.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BACKDATE_FLOOR,
  localToday,
  localTomorrow,
  localYesterday,
  daysBetweenInclusive,
  fmtDateHuman,
} from "./railFormHelpers";

// ─────────────────────────────────────────────────────────────
// ModalShell

function ModalShell({ title, onClose, children }) {
  const cardRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose?.(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    // PR-N audit R2 D2 (2026-08-21): focus lands on the first
    // focusable CONTROL, not the modal itself. The modal never
    // renders a focus ring - one ring token, on controls only.
    const first = cardRef.current?.querySelector(
      "input:not([disabled]), textarea:not([disabled]), select:not([disabled])"
    );
    (first || cardRef.current)?.focus();
  }, []);
  return (
    <div className="scav-modal-scrim" onClick={onClose}>
      <div
        className="scav-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="scav-modal-hd"><h3>{title}</h3></div>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AddServiceModal

export function AddServiceModal({ accountKey, group, feeNoDollar, onClose, onSaved, showToast }) {
  const [serviceName, setServiceName] = useState("");
  const [initialPrice, setInitialPrice] = useState("");
  const [isTaxFree, setIsTaxFree] = useState(false);
  const [isNonRevenue, setIsNonRevenue] = useState(false);
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const nameReady = serviceName.trim().length > 0 && serviceName.length <= 120;
  const priceReady = feeNoDollar || (!isNaN(Number(initialPrice)) && Number(initialPrice) >= 0);
  const reasonReady = reason.trim().length > 0 && reason.length <= 280;
  const canSave = !saving && nameReady && priceReady && reasonReady;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        action: "sc-admin-add-service",
        accountKey,
        groupId: group.id,
        serviceName: serviceName.trim(),
        initialPrice: feeNoDollar ? 0 : Number(initialPrice),
        isTaxFree,
        isNonRevenue,
        reason: reason.trim(),
        requestedBy: requestedBy.trim() || undefined,
      };
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.success) {
        showToast({ variant: "generic", tier: "ok", title: "Service added", detail: `${serviceName.trim()} added to ${group.groupName}.` });
        onSaved?.();
      } else {
        showToast({ variant: "generic", tier: "bad", title: "Could not add service", detail: "Nothing was changed and your entry is still here.", actionLabel: "Try again", onAction: () => handleSave() });
        setSaving(false);
      }
    } catch {
      showToast({ variant: "generic", tier: "bad", title: "Could not add service", detail: "Nothing was changed and your entry is still here.", actionLabel: "Try again", onAction: () => handleSave() });
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Add service to ${group.groupName}`} onClose={onClose}>
      <div className="scav-modal-body">
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="asm-name">
            Service name <span className="sc-admin-field-required">required</span>
          </label>
          <input id="asm-name" type="text" className="sc-admin-text-input"
            value={serviceName} disabled={saving}
            onChange={(e) => setServiceName(e.target.value)}
            placeholder="e.g. Continental Plus" maxLength={120} />
        </div>
        {!feeNoDollar && (
          <div className="sc-admin-field">
            <label className="sc-admin-field-label" htmlFor="asm-price">Initial price</label>
            <div className="sc-admin-price-input-wrap">
              <span className="sc-admin-price-input-dollar">$</span>
              <input id="asm-price" type="text" inputMode="decimal" className="sc-admin-price-input"
                value={initialPrice} disabled={saving}
                onChange={(e) => setInitialPrice(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.00" />
            </div>
          </div>
        )}
        {/* PR-N audit R2 D3 + R3 item 6 (Kevin 2026-08-21): same
            indent, one-line hint under each. A checkbox that
            decides whether something reaches an invoice earns a
            sentence. */}
        <div className="sc-admin-field scav-checkbox-stack">
          <label className="scav-checkbox">
            <input type="checkbox" checked={isTaxFree} disabled={saving} onChange={(e) => setIsTaxFree(e.target.checked)} />
            <span>
              Tax-free
              <span className="scav-checkbox-hint">No sales tax is applied to this service.</span>
            </span>
          </label>
          <label className="scav-checkbox">
            <input type="checkbox" checked={isNonRevenue} disabled={saving} onChange={(e) => setIsNonRevenue(e.target.checked)} />
            <span>
              Non-revenue
              <span className="scav-checkbox-hint">Counted on the calendar but never billed to the client.</span>
            </span>
          </label>
        </div>
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="asm-reason">
            Reason <span className="sc-admin-field-required">required</span>
          </label>
          <textarea id="asm-reason" className="sc-admin-textarea"
            value={reason} disabled={saving}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this service being added?" maxLength={280} rows={2} />
        </div>
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="asm-req">
            Requested by <span className="sc-admin-field-optional">optional</span>
          </label>
          <input id="asm-req" type="text" className="sc-admin-text-input"
            value={requestedBy} disabled={saving}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="Who asked for this?" maxLength={280} />
        </div>
      </div>
      <div className="scav-modal-ft">
        <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="sc-admin-btn sc-admin-btn--primary" onClick={handleSave} disabled={!canSave}>
          {saving ? "Adding..." : "Add service"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────
// AddGroupModal

export function AddGroupModal({ accountKey, onClose, onSaved, showToast }) {
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
        showToast({ variant: "generic", tier: "ok", title: "Group added", detail: `${groupName.trim()} added to ${accountKey}.` });
        onSaved?.();
      } else {
        showToast({ variant: "generic", tier: "bad", title: "Could not add group", detail: "Nothing was changed and your entry is still here.", actionLabel: "Try again", onAction: () => handleSave() });
        setSaving(false);
      }
    } catch {
      showToast({ variant: "generic", tier: "bad", title: "Could not add group", detail: "Nothing was changed and your entry is still here.", actionLabel: "Try again", onAction: () => handleSave() });
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Add group" onClose={onClose}>
      <div className="scav-modal-body">
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="agm-name">
            Group name <span className="sc-admin-field-required">required</span>
          </label>
          <input id="agm-name" type="text" className="sc-admin-text-input"
            value={groupName} disabled={saving}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="e.g. Major League" maxLength={120} />
        </div>
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="agm-reason">
            Reason <span className="sc-admin-field-required">required</span>
          </label>
          <textarea id="agm-reason" className="sc-admin-textarea"
            value={reason} disabled={saving}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this group being added?" maxLength={280} rows={2} />
        </div>
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="agm-req">
            Requested by <span className="sc-admin-field-optional">optional</span>
          </label>
          <input id="agm-req" type="text" className="sc-admin-text-input"
            value={requestedBy} disabled={saving}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="Who asked for this?" maxLength={280} />
        </div>
      </div>
      <div className="scav-modal-ft">
        <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="sc-admin-btn sc-admin-btn--primary" onClick={handleSave} disabled={!canSave}>
          {saving ? "Adding..." : "Add group"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────
// ArchiveGroupModal (with acknowledged blast-radius gate)

export function ArchiveGroupModal({ accountKey, group, activeServiceCount, onClose, onSaved, showToast }) {
  const [mode, setMode] = useState("today");
  const [futureDate, setFutureDate] = useState("");
  const [backdateDate, setBackdateDate] = useState("");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  // PR-N audit R2 C3 (Kevin ruling 2026-08-21): acknowledged auto-
  // checks when the group has zero services - there is no blast
  // radius to acknowledge. The server still requires the flag; this
  // just spares the operator a deliberate act on the safe case.
  // Wherever there is anything to lose (activeServiceCount > 0), the
  // checkbox remains a deliberate act.
  const isEmpty = activeServiceCount === 0;
  const [acknowledged, setAcknowledged] = useState(isEmpty);
  const [saving, setSaving] = useState(false);

  const today = useMemo(() => localToday(), []);
  const tomorrow = useMemo(() => localTomorrow(), []);
  const yesterday = useMemo(() => localYesterday(), []);
  const isBackdate = mode === "backdate";
  const archiveDate = mode === "today" ? today : mode === "future" ? futureDate : backdateDate;
  const dateReady =
    mode === "today" ||
    (mode === "future" && /^\d{4}-\d{2}-\d{2}$/.test(futureDate) && futureDate >= tomorrow) ||
    (mode === "backdate" && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday);
  const reasonReady = reason.trim().length > 0 && reason.length <= 280;
  const canSave = !saving && dateReady && reasonReady && acknowledged;

  const backdateSpanDays = isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate)
    ? daysBetweenInclusive(backdateDate, today) : 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        action: "sc-admin-archive-group",
        accountKey,
        groupId: group.id,
        archiveDate,
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
        showToast({ variant: "generic", tier: "ok", title: `${group.groupName} archived`, detail: `${activeServiceCount} service${activeServiceCount === 1 ? "" : "s"} hidden from ${archiveDate}.` });
        onSaved?.();
      } else {
        showToast({ variant: "generic", tier: "bad", title: "Could not archive group", detail: "Nothing was changed and your entry is still here.", actionLabel: "Try again", onAction: () => handleSave() });
        setSaving(false);
      }
    } catch {
      showToast({ variant: "generic", tier: "bad", title: "Could not archive group", detail: "Nothing was changed and your entry is still here.", actionLabel: "Try again", onAction: () => handleSave() });
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Archive ${group.groupName}`} onClose={onClose}>
      <div className="scav-modal-body">
        <div className="sc-admin-panel-current">
          {isEmpty ? (
            <>This group has no services. Nothing will be archived with it.</>
          ) : (
            <>Archiving <strong>{group.groupName}</strong> hides <strong>{activeServiceCount}</strong> active service{activeServiceCount === 1 ? "" : "s"} from the group.</>
          )}
        </div>
        <div className="sc-admin-field">
          <span className="sc-admin-field-label">Effective</span>
          <div className="sc-admin-eff-options">
            <label className="sc-admin-eff-option">
              <input type="radio" name={`agm-${group.id}`} checked={mode === "today"} onChange={() => setMode("today")} />
              <span><strong>Today</strong> ({fmtDateHuman(today)})</span>
            </label>
            <label className="sc-admin-eff-option">
              <input type="radio" name={`agm-${group.id}`} checked={mode === "future"} onChange={() => setMode("future")} />
              <span>
                <strong>Future date</strong>
                <input type="date" className="sc-admin-eff-date" value={futureDate} min={tomorrow}
                  onChange={(e) => { setFutureDate(e.target.value); setMode("future"); }}
                  disabled={mode !== "future"} />
              </span>
            </label>
            <label className="sc-admin-eff-option">
              <input type="radio" name={`agm-${group.id}`} checked={mode === "backdate"} onChange={() => setMode("backdate")} />
              <span>
                <strong>Backdate</strong>
                <input type="date" className="sc-admin-eff-date" value={backdateDate}
                  min={BACKDATE_FLOOR} max={yesterday}
                  onChange={(e) => { setBackdateDate(e.target.value); setMode("backdate"); }}
                  disabled={mode !== "backdate"} />
              </span>
            </label>
          </div>
          {isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday && (
            <div className="sc-admin-eff-warning" role="alert">
              <strong>Backdate warning.</strong> Backdating archives the group as of {fmtDateHuman(backdateDate)}, hiding {activeServiceCount} service{activeServiceCount === 1 ? "" : "s"} across {backdateSpanDays} calendar day{backdateSpanDays === 1 ? "" : "s"}. This system has no record of which days have been invoiced - verify against your billing before saving.
            </div>
          )}
        </div>
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="agm-reason">
            Reason <span className="sc-admin-field-required">required</span>
          </label>
          <textarea id="agm-reason" className="sc-admin-textarea"
            value={reason} disabled={saving}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Why is ${group.groupName} being archived?`} maxLength={280} rows={2} />
        </div>
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="agm-req">
            Requested by <span className="sc-admin-field-optional">optional</span>
          </label>
          <input id="agm-req" type="text" className="sc-admin-text-input"
            value={requestedBy} disabled={saving}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="Who asked for this?" maxLength={280} />
        </div>
        {!isEmpty && (
          /* PR-N audit R2 C3: checkbox only renders when there's
             something to lose. Empty groups auto-check acknowledged
             (see useState default) and drop the confirm-friction. */
          <div className="sc-admin-field">
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={acknowledged} disabled={saving}
                onChange={(e) => setAcknowledged(e.target.checked)} />
              I understand this hides {activeServiceCount} active service{activeServiceCount === 1 ? "" : "s"}.
            </label>
          </div>
        )}
      </div>
      <div className="scav-modal-ft">
        <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="sc-admin-btn sc-admin-btn--primary" onClick={handleSave} disabled={!canSave}
          style={{ background: canSave ? "var(--sc2-state-overdue-fg)" : undefined, color: canSave ? "#fff" : undefined }}>
          {saving ? "Archiving..." : "Archive group"}
        </button>
      </div>
    </ModalShell>
  );
}

// ─────────────────────────────────────────────────────────────
// ReactivateGroupModal

export function ReactivateGroupModal({ accountKey, group, onClose, onSaved, showToast }) {
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);
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
          action: "sc-admin-reactivate-group",
          accountKey,
          groupId: group.id,
          reason: reason.trim(),
          requestedBy: requestedBy.trim() || undefined,
        }),
      });
      const result = await res.json();
      if (result.success) {
        showToast({ variant: "generic", tier: "ok", title: `${group.groupName} reactivated`, detail: `${accountKey} - services in this group available again from today.` });
        onSaved?.();
      } else {
        showToast({ variant: "generic", tier: "bad", title: "Could not reactivate group", detail: "Nothing was changed and your entry is still here.", actionLabel: "Try again", onAction: () => handleSave() });
        setSaving(false);
      }
    } catch {
      showToast({ variant: "generic", tier: "bad", title: "Could not reactivate group", detail: "Nothing was changed and your entry is still here.", actionLabel: "Try again", onAction: () => handleSave() });
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Reactivate ${group.groupName}`} onClose={onClose}>
      <div className="scav-modal-body">
        <div className="sc-admin-panel-current">
          Reactivate <strong>{group.groupName}</strong>. Clears the archive marker - services in the group become available from today forward. Historical data unchanged.
        </div>
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="rgm-reason">
            Reason <span className="sc-admin-field-required">required</span>
          </label>
          <textarea id="rgm-reason" className="sc-admin-textarea"
            value={reason} disabled={saving}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Why is ${group.groupName} being reactivated?`} maxLength={280} rows={2} />
        </div>
        <div className="sc-admin-field">
          <label className="sc-admin-field-label" htmlFor="rgm-req">
            Requested by <span className="sc-admin-field-optional">optional</span>
          </label>
          <input id="rgm-req" type="text" className="sc-admin-text-input"
            value={requestedBy} disabled={saving}
            onChange={(e) => setRequestedBy(e.target.value)}
            placeholder="Who asked for this?" maxLength={280} />
        </div>
      </div>
      <div className="scav-modal-ft">
        <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className="sc-admin-btn sc-admin-btn--primary" onClick={handleSave} disabled={!canSave}>
          {saving ? "Reactivating..." : "Reactivate group"}
        </button>
      </div>
    </ModalShell>
  );
}

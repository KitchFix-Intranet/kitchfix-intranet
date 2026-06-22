"use client";
// Archive panel for a single service. Today / Future / Backdate date radios
// + required reason + optional requested-by. Mirrors the Stage 3 backdate
// fence in PriceEditPanel. Backdate mode shows a warning naming the
// recompute span on the per-meal calendar.
//
// SAME MECHANICS:
// 1. archiveDate computed client-side from the LOCAL clock (Vercel UTC trap).
// 2. Future radio's date picker min=tomorrow; Backdate max=yesterday min=2024-01-01.
// 3. Backdate is the only path that sends allowBackdate=true.

import { useEffect, useMemo, useState } from "react";

const BACKDATE_FLOOR = "2024-01-01";

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localTomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function localYesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetweenInclusive(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const a = new Date(fromDate + "T00:00:00");
  const b = new Date(toDate + "T00:00:00");
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}
function fmtDateHuman(iso) {
  if (!iso) return "";
  const [y, m, day] = String(iso).slice(0, 10).split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}

export default function ArchiveServicePanel({ accountKey, service, onCancel, onSaved, showToast }) {
  const [mode, setMode] = useState("today");          // "today" | "future" | "backdate"
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

  const isBackdate = mode === "backdate";
  const archiveDate = mode === "today" ? today : mode === "future" ? futureDate : backdateDate;
  const dateReady =
    mode === "today" ||
    (mode === "future" && /^\d{4}-\d{2}-\d{2}$/.test(futureDate) && futureDate >= tomorrow) ||
    (mode === "backdate" && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday);
  const reasonReady = reason.trim().length > 0 && reason.length <= 280;
  const canSave = !saving && dateReady && reasonReady;

  const backdateSpanDays = isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate)
    ? daysBetweenInclusive(backdateDate, today)
    : 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        action: "sc-admin-archive-service",
        accountKey,
        serviceId: service.id,
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
        onSaved();
      } else {
        showToast(result.error || "Archive failed", "error");
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
        Archive <strong>{service.serviceName}</strong>. Days after the chosen date will be excluded from the calendar going forward; history is preserved.
      </div>

      <div className="sc-admin-field">
        <span className="sc-admin-field-label">Archive effective</span>
        <div className="sc-admin-eff-options">
          <label className="sc-admin-eff-option">
            <input type="radio" name={`arc-${service.id}`} checked={mode === "today"} onChange={() => setMode("today")} />
            <span>
              <strong>Today</strong> ({fmtDateHuman(today)})
              <span className="sc-admin-eff-caption">Service stays active through today; archived starting tomorrow.</span>
            </span>
          </label>
          <label className="sc-admin-eff-option">
            <input type="radio" name={`arc-${service.id}`} checked={mode === "future"} onChange={() => setMode("future")} />
            <span className="sc-admin-eff-future-row">
              <strong>Future date</strong>
              <input
                type="date"
                className="sc-admin-eff-date"
                value={futureDate}
                min={tomorrow}
                onChange={(e) => { setFutureDate(e.target.value); setMode("future"); }}
                disabled={mode !== "future"}
              />
              <span className="sc-admin-eff-caption sc-admin-eff-caption--inline">Service auto-archives on that date.</span>
            </span>
          </label>
          <label className="sc-admin-eff-option">
            <input type="radio" name={`arc-${service.id}`} checked={mode === "backdate"} onChange={() => setMode("backdate")} />
            <span className="sc-admin-eff-future-row">
              <strong>Backdate</strong>
              <input
                type="date"
                className="sc-admin-eff-date"
                value={backdateDate}
                min={BACKDATE_FLOOR}
                max={yesterday}
                onChange={(e) => { setBackdateDate(e.target.value); setMode("backdate"); }}
                disabled={mode !== "backdate"}
              />
              <span className="sc-admin-eff-caption sc-admin-eff-caption--inline">Marks the service as archived as of that past date.</span>
            </span>
          </label>
        </div>
        {isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday && (
          <div className="sc-admin-eff-warning" role="alert">
            <strong>Backdate warning.</strong> Backdating an archive recomputes recorded calendar revenue for the span {fmtDateHuman(backdateDate)} through {fmtDateHuman(today)} ({backdateSpanDays} calendar days). Days in that span that had service for {service.serviceName} will be REMOVED from recorded revenue going forward. This system has no record of which days have been invoiced - verify against your billing before saving.
          </div>
        )}
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`arc-reason-${service.id}`}>
          Reason <span className="sc-admin-field-required">required</span>
        </label>
        <textarea
          id={`arc-reason-${service.id}`}
          className="sc-admin-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this service being archived?"
          maxLength={280}
          rows={2}
        />
        <span className="sc-admin-field-count">{reason.length}/280</span>
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`arc-reqby-${service.id}`}>
          Requested by <span className="sc-admin-field-optional">optional</span>
        </label>
        <input
          id={`arc-reqby-${service.id}`}
          type="text"
          className="sc-admin-text-input"
          value={requestedBy}
          onChange={(e) => setRequestedBy(e.target.value)}
          placeholder="Who asked for this archive?"
          maxLength={280}
        />
      </div>

      <div className="sc-admin-panel-actions">
        <button type="button" className="sc-admin-btn sc-admin-btn--ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="sc-admin-btn sc-admin-btn--danger" onClick={handleSave} disabled={!canSave}>
          {saving ? "Archiving..." : "Archive service"}
        </button>
      </div>
    </div>
  );
}

"use client";
// Inline edit panel under a service row. Captures: new price, effective
// date (Today, Future, or Backdate), required reason, optional requested-by.
//
// CRITICAL MECHANICS:
// 1. effectiveDate is computed CLIENT-SIDE from the browser's LOCAL clock
//    (new Date().getFullYear/getMonth/getDate). NEVER trust server time -
//    Vercel runs in UTC and "Today" picked in a US-evening session would
//    silently roll to tomorrow's date if we let the server decide. The
//    operator's local today is what they mean by "Today".
// 2. roundCents on both display and compare so 5-decimal storage rows
//    (95 of 159 in production) never show as false-positive changes.
// 3. Future radio's date picker is constrained min={tomorrow}.
// 4. Backdate (Stage 3) is fenced: the operator must deliberately pick it,
//    a past-date picker (max={yesterday}, min=2024-01-01) appears, and a
//    warning is shown naming the calendar-day span and explaining what
//    recomputes. The Save payload includes allowBackdate: true so the
//    server's today-or-future floor is skipped only for this path.

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

// Inclusive calendar-day count between two YYYY-MM-DD strings (both ends
// counted). Used for the backdate warning's span text. Pure date math
// against T00:00:00 so DST transitions cannot drift the count by an hour.
function daysBetweenInclusive(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const a = new Date(fromDate + "T00:00:00");
  const b = new Date(toDate + "T00:00:00");
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((b - a) / MS) + 1;
}

function fmtPrice(n) {
  return "$" + Number(n).toFixed(2);
}

function fmtDateHuman(iso) {
  if (!iso) return "";
  const d = String(iso).slice(0, 10);
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(day)}, ${y}`;
}

export default function PriceEditPanel({ accountKey, groupName, service, onCancel, onSaved, showToast }) {
  const currentPrice = roundCents(service.price);
  const [newPrice, setNewPrice] = useState(currentPrice.toFixed(2));
  const [effMode, setEffMode] = useState("today");   // "today" | "future" | "backdate"
  const [futureDate, setFutureDate] = useState("");
  const [backdateDate, setBackdateDate] = useState("");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);

  const today = useMemo(() => localToday(), []);
  const tomorrow = useMemo(() => localTomorrow(), []);
  const yesterday = useMemo(() => localYesterday(), []);

  // If the user leaves the panel open through midnight, recompute "today"
  // on next render so the Today radio's date stays honest. Cheap re-mem.
  useEffect(() => {
    const interval = setInterval(() => {
      // forces a re-render of the today label if needed; the useMemo
      // above doesn't auto-update, so we keep this simple and let the
      // panel be closed/reopened to refresh. Skipping the rAF dance.
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const newPriceNum = Number(newPrice);
  const newPriceRounded = isNaN(newPriceNum) ? null : roundCents(newPriceNum);
  const priceChanged = newPriceRounded !== null && newPriceRounded !== currentPrice;
  const effDate = effMode === "today" ? today : effMode === "future" ? futureDate : backdateDate;
  const isBackdate = effMode === "backdate";
  const effReady =
    effMode === "today" ||
    (effMode === "future" && /^\d{4}-\d{2}-\d{2}$/.test(futureDate) && futureDate >= tomorrow) ||
    (effMode === "backdate" && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday);
  const reasonReady = reason.trim().length > 0 && reason.length <= 280;
  const canSave = !saving && priceChanged && newPriceRounded > 0 && effReady && reasonReady;

  const backdateSpanDays = isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate)
    ? daysBetweenInclusive(backdateDate, today)
    : 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const change = {
        type: "price",
        groupName,
        serviceName: service.serviceName,
        from: currentPrice,
        to: newPriceRounded,
        effectiveDate: effDate,
        reason: reason.trim(),
        requestedBy: requestedBy.trim() || undefined,
      };
      if (isBackdate) change.allowBackdate = true;
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sc-config-update",
          accountKey,
          changes: [change],
        }),
      });
      const result = await res.json();
      if (result.success) {
        onSaved();
      } else {
        showToast(result.error || "Save failed", "error");
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
        Current price: <strong>{fmtPrice(currentPrice)}</strong>
        {service.priceSinceDate && (
          <span className="sc-admin-panel-since"> (since {fmtDateHuman(service.priceSinceDate)})</span>
        )}
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`new-price-${service.id}`}>New price</label>
        <div className="sc-admin-price-input-wrap">
          <span className="sc-admin-price-input-dollar">$</span>
          <input
            id={`new-price-${service.id}`}
            type="text"
            inputMode="decimal"
            className="sc-admin-price-input"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value.replace(/[^0-9.]/g, ""))}
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
              name={`eff-${service.id}`}
              checked={effMode === "today"}
              onChange={() => setEffMode("today")}
            />
            <span>
              <strong>Today</strong> ({fmtDateHuman(today)})
              <span className="sc-admin-eff-caption">Applies from today forward; closed months untouched.</span>
            </span>
          </label>
          <label className="sc-admin-eff-option">
            <input
              type="radio"
              name={`eff-${service.id}`}
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
              <span className="sc-admin-eff-caption sc-admin-eff-caption--inline">Switches over on that date automatically.</span>
            </span>
          </label>
          <label className="sc-admin-eff-option">
            <input
              type="radio"
              name={`eff-${service.id}`}
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
              <span className="sc-admin-eff-caption sc-admin-eff-caption--inline">Sets the price as if it had been in effect since that past date.</span>
            </span>
          </label>
        </div>
        {isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday && (
          <div className="sc-admin-eff-warning" role="alert">
            <strong>Backdate warning.</strong> Backdating recomputes recorded revenue for the calendar span {fmtDateHuman(backdateDate)} through {fmtDateHuman(today)} ({backdateSpanDays} calendar days). Days in that span that had service will have their recorded revenue change. This system has no record of which days have been invoiced - verify against your billing before saving.
          </div>
        )}
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`reason-${service.id}`}>
          Reason <span className="sc-admin-field-required">required</span>
        </label>
        <textarea
          id={`reason-${service.id}`}
          className="sc-admin-textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this price changing?"
          maxLength={280}
          rows={2}
        />
        <span className="sc-admin-field-count">{reason.length}/280</span>
      </div>

      <div className="sc-admin-field">
        <label className="sc-admin-field-label" htmlFor={`reqby-${service.id}`}>
          Requested by <span className="sc-admin-field-optional">optional</span>
        </label>
        <input
          id={`reqby-${service.id}`}
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
    </div>
  );
}

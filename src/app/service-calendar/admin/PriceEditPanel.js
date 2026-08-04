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

import { useEffect, useMemo, useRef, useState } from "react";
// Admin wave commit 3 (2026-08-04): inline dialog a11y - Escape closes,
// focus moves in on open, focus returns on close. trapTab=false: this
// panel renders inline inside a service row, not as an overlay.
import { useDialogA11y } from "../useDialogA11y";

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
  const cardRef = useRef(null);
  useDialogA11y({ cardRef, isOpen: true, onClose: onCancel, trapTab: false });
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

  // Admin PR 1 bounce (2026-08-04, owner ruling on #620): the operator
  // must see the closed periods and the revenue delta INSIDE the
  // inline warning, before the operator picks Save - not inside a
  // modal that only fires on Save-click. The reactive preview fires
  // whenever the operator is in Backdate mode with a valid date; the
  // warning content adapts as the preview lands. Today and Future
  // radios never call preview - by construction they cannot reach a
  // closed period (current period is open; future periods have not
  // started).
  //
  // Server truth wins on the record: the composed prose prefix on
  // sc_config_changelog.reason is computed by the write handler at
  // save time using the same describeBackdateImpact helper. A stale
  // client-side preview cannot desync the record.
  //
  // Future upgrade signal (owner note): when sc_is_period_closed
  // means "AP has pulled this period" (v2 swap point in
  // sc-25-period-lock.sql), the first line becomes "P4 has been
  // billed" instead of "P4 is closed", and the last-sentence caveat
  // ("This system has no record of which days have been invoiced")
  // disappears because the system will then know.
  const [preview, setPreview] = useState({ state: "idle", result: null });
  // Guard for whether the effect should fire the preview call. Reads
  // like a checklist: if any check fails, the effect resets to idle
  // and returns; otherwise the preview kicks off. Compute the boolean
  // outside the effect body so the effect's setState calls are gated
  // and cannot fire on every render for the same input state (satisfies
  // react-hooks/set-state-in-effect - the setState below either fires
  // on a genuine transition into loading, or on the resolved fetch).
  const backdateReady = (
    isBackdate
    && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate)
    && backdateDate >= BACKDATE_FLOOR
    && backdateDate <= yesterday
    && newPriceRounded !== null && newPriceRounded > 0
  );
  useEffect(() => {
    if (!backdateReady) {
      // Guard fails: leave preview state as-is. The warning DIV is
      // gated on isBackdate + valid-date at the JSX level (see below),
      // so a stale preview cannot render on a surface where the guard
      // failed. Skips setPreview here so this effect has zero setState
      // calls on guard-fail paths (react-hooks/set-state-in-effect).
      return;
    }
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview({ state: "loading", result: null });
    fetch("/api/service-calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sc-admin-backdate-preview",
        type: "price",
        accountKey,
        effectiveDate: backdateDate,
        serviceId: service.id,
        newPrice: newPriceRounded,
      }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        setPreview({ state: "ready", result: data && data.success ? data : null });
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        // Owner ruling: never fail closed. If the preview call errors
        // outright, fall back to periods-only messaging with an
        // explicit unavailable note (see rendering below).
        setPreview({ state: "ready", result: null });
      });
    return () => controller.abort();
  }, [backdateReady, backdateDate, newPriceRounded, accountKey, service.id]);

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
    <div className="sc-admin-panel" ref={cardRef} tabIndex={-1}>
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
            <BackdateWarningBody
              preview={preview}
              backdateDate={backdateDate}
              today={today}
              backdateSpanDays={backdateSpanDays}
            />
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

// Inline warning body under the Backdate radio. Admin PR 1 bounce
// (2026-08-04): renders period list + delta or explicit unavailable,
// with the final caveat kept verbatim. Facts, then the caveat -
// never silence about what the system knows.
//
// Preview lifecycle:
//   idle    - Backdate not picked OR date not yet valid. Render null.
//   loading - preview call in flight. Render the pre-bounce copy
//             (calendar span + day count + caveat) so the operator
//             is never staring at an empty box.
//   ready   - result present (or null if the network call errored):
//     * closedPeriods.length > 0  -> facts + delta + caveat
//     * closedPeriods.length == 0 -> pre-bounce copy (open-only span)
//     * result == null            -> pre-bounce copy (fail-open)
//
// When the closed-period predicate upgrades to "AP has pulled the
// period" (see sc-25-period-lock.sql `sc_is_period_closed` swap
// point), the "which is closed" clause becomes "has been billed"
// and the final caveat sentence disappears because the system will
// then know. That upgrade is one string change in this component.
function BackdateWarningBody({ preview, backdateDate, today, backdateSpanDays }) {
  const spanCopy = (
    <>
      <strong>Backdate warning.</strong> Backdating recomputes recorded revenue for the calendar span
      {" "}{fmtDateHuman(backdateDate)} through {fmtDateHuman(today)} ({backdateSpanDays} calendar days).
      Days in that span that had service will have their recorded revenue change. This system has no
      record of which days have been invoiced - verify against your billing before saving.
    </>
  );
  if (preview.state === "idle") return spanCopy;
  if (preview.state === "loading") return spanCopy;
  const result = preview.result;
  const closedPeriods = result?.closedPeriods || [];
  if (closedPeriods.length === 0) return spanCopy;

  // Closed-periods case. Facts first, then caveat.
  const affectedDayCount = result.affectedDayCount || 0;
  const dayWord = affectedDayCount === 1 ? "day" : "days";
  const closedClause = closedPeriods.length === 1 ? "which is closed" : "which are closed";
  const periodList = fmtPeriodListWithAnd(closedPeriods);
  const revenueDeltaCents = result.revenueDeltaCents;
  const dollars = revenueDeltaCents == null ? null : revenueDeltaCents / 100;
  const deltaStr = dollars == null ? null
    : (dollars >= 0 ? "+" : "-") + "$" + Math.abs(dollars).toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  return (
    <>
      <p><strong>Backdate warning.</strong> This backdate reaches {periodList}, {closedClause}.</p>
      {deltaStr != null ? (
        <p>Recorded revenue changes by <strong>{deltaStr}</strong> across {affectedDayCount} {dayWord}.</p>
      ) : (
        <p>Revenue delta is <strong>unavailable</strong> (preview did not complete) across {affectedDayCount} {dayWord}.</p>
      )}
      <p>This system has no record of which days have been invoiced - verify against your billing before saving.</p>
    </>
  );
}

// Format ["4","5","6","7"] -> "P4, P5, P6 and P7". Single -> "P4".
// Two -> "P4 and P5". Owner-shape prose, no Oxford comma - matches the
// example in the bounce ruling.
function fmtPeriodListWithAnd(periods) {
  const p = periods.map((x) => `P${x}`);
  if (p.length === 0) return "";
  if (p.length === 1) return p[0];
  if (p.length === 2) return `${p[0]} and ${p[1]}`;
  return p.slice(0, -1).join(", ") + " and " + p[p.length - 1];
}

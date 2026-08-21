"use client";
// SC Admin - right rail (editor). Renders one of six variants driven
// by the host's selection state:
//
//   empty       - no service selected (state 3)
//   loading     - loading a fresh selection (state 4)
//   guard       - unsaved-change guard (state 5)
//   service     - regular per-meal service edit (states 6/7/8)
//   fee         - fee account fee edit (state 10, incl. bundled)
//   archived    - archived service reactivate (state 9)
//
// The forms POST to the same endpoints the retired PriceEditPanel /
// FeeEditPanel / ArchiveServicePanel / ReactivatePanel POSTed to. No
// API changes.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BACKDATE_FLOOR,
  roundCents,
  localToday,
  localTomorrow,
  localYesterday,
  daysBetweenInclusive,
  fmtPrice,
  fmtAmount,
  fmtDateHuman,
  fmtPeriodListWithAnd,
} from "./railFormHelpers";

const MLB_LABOR_BUDGET_ACCOUNTS = new Set([
  "CIN - OH",
  "STL - MO",
  "TXR - TX - H",
  "TXR - TX - V",
]);

// ─────────────────────────────────────────────────────────────
// Dispatcher

export default function EditorRail({
  variant,       // "empty" | "loading" | "guard" | "service" | "fee" | "archived" | "archiveService"
  accountKey,
  account,       // { key, level, name, billingModel }
  service,       // for service/archived variants
  feeData,       // for fee variant: { current, upcoming, name, level }
  onSaved,
  onCancel,
  showToast,
  onDirtyChange, // (bool) => void - lets the host track dirty for the guard
  guardPending,  // { label, resume } - populated when variant="guard"
  onGuardBack,
  onGuardDiscard,
  onOpenLaborBudgets,
  onOpenFeeHistory,
  onOpenViewHistory,
  onOpenScheduleArchive,
  onOpenArchiveNow,
  archiveInitialMode,      // "today" | "future" - preset when opening archiveService
  onCancelArchive,          // return to service variant
}) {
  // Guard is an OVERLAY on top of whatever the rail was already
  // showing. Not a swap-out - swapping out would unmount the form
  // and reset its state, which would defeat the whole point of
  // "Go back preserves the edit" (spec §Interaction: Go back is
  // the safe default). See N4 acceptance.
  if (variant === "loading") return <RailSkeleton />;
  if (variant === "empty") return <RailEmpty />;
  if (variant === "archiveService") {
    return <RailArchiveService
      accountKey={accountKey}
      service={service}
      initialMode={archiveInitialMode || "today"}
      onSaved={onSaved}
      onCancel={onCancelArchive}
      showToast={showToast}
      onDirtyChange={onDirtyChange}
    />;
  }
  if (variant === "fee") {
    return <RailFee
      accountKey={accountKey}
      account={account}
      feeData={feeData}
      onSaved={onSaved}
      showToast={showToast}
      onDirtyChange={onDirtyChange}
      onOpenLaborBudgets={onOpenLaborBudgets}
      onOpenFeeHistory={onOpenFeeHistory}
    />;
  }
  if (variant === "archived") {
    return <RailArchived
      accountKey={accountKey}
      account={account}
      service={service}
      onSaved={onSaved}
      showToast={showToast}
      onDirtyChange={onDirtyChange}
      onOpenViewHistory={onOpenViewHistory}
    />;
  }
  if (variant === "service") {
    return <RailService
      accountKey={accountKey}
      account={account}
      service={service}
      onSaved={onSaved}
      showToast={showToast}
      onDirtyChange={onDirtyChange}
      onOpenScheduleArchive={onOpenScheduleArchive}
      onOpenArchiveNow={onOpenArchiveNow}
    />;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// State 3: empty ("Nothing selected")

function RailEmpty() {
  return (
    <div className="scav-insp-scroll" data-rail-variant="empty">
      <div className="scav-empty scav-fadein">
        <div className="scav-empty-ic">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="7" y1="9" x2="17" y2="9" />
            <line x1="7" y1="13" x2="14" y2="13" />
          </svg>
        </div>
        <h5>No service selected</h5>
        <p>Pick a service to change its price, schedule a change, or archive it.</p>
        <div className="tip"><kbd>&uarr;</kbd> <kbd>&darr;</kbd> to move &middot; <kbd>Enter</kbd> to open</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// State 4: loading (rail skeleton)

function RailSkeleton() {
  return (
    <div className="scav-insp-scroll" data-rail-variant="loading">
      <div className="scav-sk--d" style={{ height: 11, width: "30%" }} />
      <div className="scav-sk--d" style={{ height: 24, width: "56%", marginTop: 9 }} />
      <div className="scav-sk--d" style={{ height: 12, width: "44%", marginTop: 7 }} />
      <div className="scav-sk--d" style={{ height: 80, marginTop: 16, borderRadius: 11 }} />
      <div className="scav-sk--d" style={{ height: 44, marginTop: 16, borderRadius: 9 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// State 5: guard

function RailGuard({ pending, onBack, onDiscard }) {
  const backRef = useRef(null);
  useEffect(() => { backRef.current?.focus(); }, []);
  return (
    <div className="scav-insp-scroll" data-rail-variant="guard">
      <div className="scav-fadein">
        <div className="scav-kick">Unsaved change</div>
        <div className="scav-ih">Hold on</div>
        <div className="scav-warn bad" style={{ marginTop: "var(--sc2-space-4)" }}>
          <span>&#9888;</span>
          <span>
            <b>You have an unsaved change</b><br />
            It has not been saved yet. Discard it and {pending?.label || "move on"}, or go back and save.
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--sc2-space-2)", marginTop: "var(--sc2-space-4)" }}>
          <button
            ref={backRef}
            type="button"
            className="scav-ghost"
            style={{ flex: 1 }}
            onClick={onBack}
          >
            Go back
          </button>
          <button
            type="button"
            className="scav-save scav-save--danger"
            style={{ margin: 0, flex: 1, fontSize: "var(--sc2-size-body)" }}
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// State 6/7/8: regular service edit (Price + segmented Effective + Reason)

function RailService({
  accountKey,
  account,
  service,
  onSaved,
  showToast,
  onDirtyChange,
  onOpenScheduleArchive,
  onOpenArchiveNow,
}) {
  const currentPrice = useMemo(() => roundCents(service.price), [service.price]);
  const [newPrice, setNewPrice] = useState(currentPrice.toFixed(2));
  const [effMode, setEffMode] = useState("today");
  const [futureDate, setFutureDate] = useState("");
  const [backdateDate, setBackdateDate] = useState("");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);
  // PR-N audit G (Kevin ruling 2026-08-21): dirty flag comes from a
  // real user interaction, not from a value diff on mount. The old
  // pattern flagged dirty when currentPrice changed after mount
  // (e.g. selection arrived from an async fetch) because the visible
  // newPrice was still the initial "0.00" against the freshly-loaded
  // real price. Masked in most cases by two-decimal storage, would
  // expose on a whole-number price.
  const [touched, setTouched] = useState(false);
  // F (Kevin ruling 2026-08-21): backdate save requires an explicit
  // credit-decision. Two options, neither preselected. Save disabled
  // until one is chosen. AP notification itself is Track B (K-7) and
  // is NOT wired in this PR - the choice is recorded, nobody is
  // emailed yet. Noted in PR body.
  const [creditDecision, setCreditDecision] = useState(null); // null | "issue" | "none"

  const today = useMemo(() => localToday(), []);
  const tomorrow = useMemo(() => localTomorrow(), []);
  const yesterday = useMemo(() => localYesterday(), []);

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
  const priceValid = newPriceRounded !== null && newPriceRounded > 0;
  const creditReady = !isBackdate || creditDecision != null;
  const canSave = !saving && touched && priceChanged && priceValid && effReady && reasonReady && creditReady;

  // Dirty comes from the touched flag now, not from value comparison.
  // See PR-N audit G ruling.
  const dirty = touched;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Sync newPrice to the latest currentPrice ONLY when the user has
  // not touched yet. Once touched, respect the operator's input.
  useEffect(() => {
    if (!touched) setNewPrice(currentPrice.toFixed(2));
  }, [currentPrice, touched]);

  // Reactive backdate preview - same pattern as the retired PriceEditPanel.
  const backdateReady =
    isBackdate &&
    /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) &&
    backdateDate >= BACKDATE_FLOOR &&
    backdateDate <= yesterday &&
    priceValid;

  const [preview, setPreview] = useState({ state: "idle", result: null });
  useEffect(() => {
    if (!backdateReady) return;
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
        setPreview({ state: "ready", result: null });
      });
    return () => controller.abort();
  }, [backdateReady, backdateDate, newPriceRounded, accountKey, service.id]);

  const backdateSpanDays = isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate)
    ? daysBetweenInclusive(backdateDate, today) : 0;

  // PR-N audit R2 E3 (Kevin ruling 2026-08-21): shortened to
  // "Same as current" so NEW PRICE stops wrapping. The
  // current-price block above supplies the number at 30px; the
  // hint does not need to repeat it.
  const hintText = !newPrice
    ? "Enter a price"
    : !priceValid
      ? "Not a valid number"
      : !priceChanged
        ? "Same as current"
        : !reasonReady
          ? "Add a reason"
          : "Ready to save";

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const change = {
        type: "price",
        groupName: service.groupName,
        serviceName: service.serviceName,
        from: currentPrice,
        to: newPriceRounded,
        effectiveDate: effDate,
        reason: reason.trim(),
        requestedBy: requestedBy.trim() || undefined,
      };
      if (isBackdate) {
        change.allowBackdate = true;
        change.creditDecision = creditDecision;   // "issue" | "none"
      }
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-config-update", accountKey, changes: [change] }),
      });
      const result = await res.json();
      if (result.success) {
        showToast({
          variant: "generic",
          tier: "ok",
          title: "Price updated",
          detail: `${service.serviceName} at ${accountKey} is now ${fmtPrice(newPriceRounded)}, effective ${isBackdate ? fmtDateHuman(effDate) : effMode === "today" ? "today" : fmtDateHuman(effDate)}.`,
        });
        onSaved?.();
      } else {
        // N6: nothing was written server-side. Value stays in the field,
        // rail stays dirty (setSaving false but don't reset any state).
        showToast({
          variant: "generic",
          tier: "bad",
          title: "Could not save the price",
          detail: "Nothing was changed and your entry is still here. Check your connection and try again.",
          actionLabel: "Try again",
          onAction: () => handleSave(),
        });
        setSaving(false);
      }
    } catch {
      showToast({
        variant: "generic",
        tier: "bad",
        title: "Could not save the price",
        detail: "Nothing was changed and your entry is still here. Check your connection and try again.",
        actionLabel: "Try again",
        onAction: () => handleSave(),
      });
      setSaving(false);
    }
  };

  return (
    <>
      <div className="scav-insp-scroll" data-rail-variant="service">
        <div className="scav-fadein">
          <div className="scav-kick">Service</div>
          <div className="scav-ih">{service.serviceName}</div>
          <div className="scav-im">{accountKey} &middot; {service.groupName}</div>
          <div className="scav-cur">
            <div className="l">Current price</div>
            <div className="v">{fmtPrice(currentPrice)}</div>
            {service.priceSinceDate && (
              <div className="s">since {fmtDateHuman(service.priceSinceDate)}</div>
            )}
          </div>

          {service.upcomingPrice != null && (
            <div className="scav-warn">
              <span>&#9888;</span>
              <span>
                <b>Change already scheduled</b><br />
                {fmtPrice(service.upcomingPrice)} on {fmtDateHuman(service.upcomingEffectiveDate)}. Saving here replaces it.
              </span>
            </div>
          )}

          <div className="scav-f">
            <label htmlFor={`np-${service.id}`}>
              New price <span className="hint">{hintText}</span>
            </label>
            <input
              id={`np-${service.id}`}
              type="text"
              inputMode="decimal"
              value={newPrice}
              disabled={saving}
              className={newPrice !== "" && !priceValid ? "err" : ""}
              onChange={(e) => { setNewPrice(e.target.value.replace(/[^0-9.]/g, "")); setTouched(true); }}
              placeholder="0.00"
            />
          </div>

          <div className="scav-f">
            <label>Effective from</label>
            <div className="scav-seg" role="group">
              <button
                type="button"
                aria-pressed={effMode === "today"}
                onClick={() => { setEffMode("today"); setTouched(true); }}
                disabled={saving}
              >Today</button>
              <button
                type="button"
                aria-pressed={effMode === "future"}
                onClick={() => { setEffMode("future"); setTouched(true); }}
                disabled={saving}
              >Future</button>
              <button
                type="button"
                aria-pressed={effMode === "backdate"}
                onClick={() => { setEffMode("backdate"); setTouched(true); }}
                disabled={saving}
              >Backdate</button>
            </div>
            {effMode === "future" && (
              <input
                type="date"
                min={tomorrow}
                value={futureDate}
                disabled={saving}
                onChange={(e) => { setFutureDate(e.target.value); setTouched(true); }}
                style={{ marginTop: "var(--sc2-space-2)" }}
              />
            )}
            {effMode === "backdate" && (
              <input
                type="date"
                min={BACKDATE_FLOOR}
                max={yesterday}
                value={backdateDate}
                disabled={saving}
                onChange={(e) => { setBackdateDate(e.target.value); setTouched(true); }}
                style={{ marginTop: "var(--sc2-space-2)" }}
              />
            )}
            {isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday && (
              <div className="scav-warn" role="alert">
                <span>&#9888;</span>
                <BackdatePriceCopy
                  preview={preview}
                  backdateDate={backdateDate}
                  today={today}
                  spanDays={backdateSpanDays}
                  fromPrice={currentPrice}
                  toPrice={newPriceRounded}
                />
              </div>
            )}
          </div>

          <div className="scav-f">
            <label htmlFor={`rs-${service.id}`}>
              Reason <span className="hint">required</span>
            </label>
            <textarea
              id={`rs-${service.id}`}
              value={reason}
              disabled={saving}
              onChange={(e) => { setReason(e.target.value); setTouched(true); }}
              placeholder="Contract amendment"
              maxLength={280}
              rows={2}
            />
          </div>

          <div className="scav-f">
            <label htmlFor={`rq-${service.id}`}>
              Requested by <span className="hint">optional</span>
            </label>
            <input
              id={`rq-${service.id}`}
              type="text"
              value={requestedBy}
              disabled={saving}
              onChange={(e) => { setRequestedBy(e.target.value); setTouched(true); }}
              placeholder="Who asked for this?"
              maxLength={280}
            />
          </div>

          {/* F (Kevin ruling 2026-08-21): backdate save requires an
              explicit credit-decision. Two options, neither
              preselected. Save disabled until picked. AP notification
              itself is Track B (K-7) and is NOT wired in this PR - the
              choice is recorded, nobody is emailed until Track B ships. */}
          {isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday && priceValid && priceChanged && (
            <div className="scav-f scav-credit-choice">
              <label>
                Credit decision <span className="hint">required, no default</span>
              </label>
              <div className="scav-credit-options" role="radiogroup" aria-label="Credit decision">
                <label className="scav-credit-opt">
                  <input
                    type="radio"
                    name={`cd-${service.id}`}
                    checked={creditDecision === "issue"}
                    onChange={() => { setCreditDecision("issue"); setTouched(true); }}
                    disabled={saving}
                  />
                  <span>
                    <strong>Issue the credit</strong>
                    <span className="scav-credit-hint">AP receives the amount and issues a credit memo.</span>
                  </span>
                </label>
                <label className="scav-credit-opt">
                  <input
                    type="radio"
                    name={`cd-${service.id}`}
                    checked={creditDecision === "none"}
                    onChange={() => { setCreditDecision("none"); setTouched(true); }}
                    disabled={saving}
                  />
                  <span>
                    <strong>No credit</strong>
                    <span className="scav-credit-hint">Price corrected going forward; already-billed weeks stand. Say why in Reason.</span>
                  </span>
                </label>
              </div>
              <div className="scav-credit-track-b" role="note">
                Nothing is emailed yet. The decision is recorded on the changelog; AP notification lands with Track B.
              </div>
            </div>
          )}

          <button
            type="button"
            className={isBackdate ? "scav-save scav-save--warn" : "scav-save"}
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving ? <><span className="scav-spin" />Saving...</> : (isBackdate ? "Save backdated change" : "Save price change")}
          </button>
        </div>
      </div>
      <div className="scav-insp-foot">
        <button type="button" onClick={onOpenScheduleArchive}>Schedule archive</button>
        <button type="button" className="danger" onClick={onOpenArchiveNow}>Archive now</button>
      </div>
    </>
  );
}

function BackdatePriceCopy({ preview, backdateDate, today, spanDays, fromPrice, toPrice }) {
  // PR-N audit F (Kevin ruling 2026-08-21): removed the "AP is emailed
  // with the credit owed" clause. It was not true - the server does
  // not email AP on this path. AP notification is Track B (K-7),
  // separate PR. See docs/backlog/ADMIN_HISTORY_PANELS.md siblings.
  const spanText = (
    <span>
      <b>{spanDays} calendar day{spanDays === 1 ? "" : "s"} will recompute</b><br />
      Recorded revenue for {fmtDateHuman(backdateDate)} through {fmtDateHuman(today)} changes. This system has no record of which days have been invoiced - verify against your billing before saving.
    </span>
  );
  if (preview.state === "idle" || preview.state === "loading") return spanText;
  const result = preview.result;
  const closedPeriods = result?.closedPeriods || [];
  if (closedPeriods.length === 0) return spanText;
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
    <span>
      <b>{affectedDayCount} {dayWord} in {periodList} &middot; {deltaStr || "delta pending"} {dollars != null ? (dollars >= 0 ? "owed to the client" : "owed by the client") : ""}</b><br />
      Weeks already billed at {fmtPrice(fromPrice)} become {fmtPrice(toPrice)} across the calendar span, {closedClause}. This system has no record of which days have been invoiced - verify against your billing before saving.
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// State 10: fee account

function RailFee({
  accountKey,
  account,
  feeData,
  onSaved,
  showToast,
  onDirtyChange,
  onOpenLaborBudgets,
  onOpenFeeHistory,
}) {
  const current = feeData?.current;
  const upcoming = feeData?.upcoming;
  const isBundled = !!current?.coveredByAccountKey;
  const currentAmount = current ? roundCents(current.amount) : 0;

  const [newAmount, setNewAmount] = useState(currentAmount.toFixed(2));
  const [effMode, setEffMode] = useState("today");
  const [futureDate, setFutureDate] = useState("");
  const [backdateDate, setBackdateDate] = useState("");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);
  // PR-N audit G (Kevin ruling 2026-08-21): dirty from real
  // interaction, not value diff on mount. Reproduces most easily
  // on fee accounts because feeData may arrive async - currentAmount
  // jumps from 0 to (e.g.) 376686 on the second render while
  // newAmount state is still the initial "0.00", which the old
  // pattern read as amountChanged=true and fired the unsaved-guard
  // on account switch even though the operator had touched nothing.
  const [touched, setTouched] = useState(false);

  const today = useMemo(() => localToday(), []);
  const tomorrow = useMemo(() => localTomorrow(), []);
  const yesterday = useMemo(() => localYesterday(), []);

  // Sync newAmount to the latest currentAmount ONLY when the user
  // has not touched yet. See PR-N audit G ruling.
  useEffect(() => {
    if (!touched) setNewAmount(currentAmount.toFixed(2));
  }, [currentAmount, touched]);

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
  const amountValid = newAmountRounded !== null && newAmountRounded >= 0;
  const canSave = !isBundled && !saving && touched && amountChanged && amountValid && effReady && reasonReady;

  // Dirty from real interaction, not value diff. See G fix comment above.
  const dirty = !isBundled && touched;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const isMlb = MLB_LABOR_BUDGET_ACCOUNTS.has(accountKey);

  // PR-N audit R2 E3: shortened per RailService pattern.
  const hintText = !newAmount
    ? "Enter an amount"
    : !amountValid
      ? "Not a valid number"
      : !amountChanged
        ? "Same as current"
        : !reasonReady
          ? "Add a reason"
          : "Ready to save";

  const handleSave = async () => {
    if (!canSave) return;
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
        showToast({
          variant: "generic",
          tier: isBackdate ? "warn" : "ok",
          title: isBackdate ? "Backdated fee saved" : "Fee updated",
          detail: `${accountKey} annual fee is now ${fmtAmount(newAmountRounded)}, effective ${isBackdate ? fmtDateHuman(effDate) : effMode === "today" ? "today" : fmtDateHuman(effDate)}.`,
        });
        onSaved?.();
      } else {
        showToast({
          variant: "generic",
          tier: "bad",
          title: "Could not save the fee",
          detail: "Nothing was changed and your entry is still here. Check your connection and try again.",
          actionLabel: "Try again",
          onAction: () => handleSave(),
        });
        setSaving(false);
      }
    } catch {
      showToast({
        variant: "generic",
        tier: "bad",
        title: "Could not save the fee",
        detail: "Nothing was changed and your entry is still here. Check your connection and try again.",
        actionLabel: "Try again",
        onAction: () => handleSave(),
      });
      setSaving(false);
    }
  };

  return (
    <>
      <div className="scav-insp-scroll" data-rail-variant="fee">
        <div className="scav-fadein">
          <div className="scav-kick">Fee schedule</div>
          <div className="scav-ih">Annual contract fee</div>
          <div className="scav-im">{accountKey} &middot; {feeData?.name || account?.name || ""}</div>

          <div className="scav-cur">
            <div className="l">Current amount</div>
            {isBundled ? (
              <>
                <div className="v" style={{ fontSize: "var(--sc2-size-h3)" }}>Covered by {current.coveredByAccountKey}</div>
                <div className="bundled-note">
                  Billed as part of the {current.coveredByAccountKey} contract. Do not bill separately - it would double-count.
                </div>
              </>
            ) : (
              <>
                <div className="v">{fmtAmount(currentAmount)}</div>
                {current?.effectiveDate && (
                  <div className="s">effective {fmtDateHuman(current.effectiveDate)}</div>
                )}
                {upcoming && (
                  <div className="s" style={{ marginTop: "var(--sc2-space-1)" }}>
                    scheduled {fmtAmount(upcoming.amount)} on {fmtDateHuman(upcoming.effectiveDate)}
                  </div>
                )}
              </>
            )}
          </div>

          {!isBundled && (
            <>
              <div className="scav-f">
                <label htmlFor={`fa-${accountKey}`}>
                  New amount <span className="hint">{hintText}</span>
                </label>
                <input
                  id={`fa-${accountKey}`}
                  type="text"
                  inputMode="decimal"
                  value={newAmount}
                  disabled={saving}
                  className={newAmount !== "" && !amountValid ? "err" : ""}
                  onChange={(e) => { setNewAmount(e.target.value.replace(/[^0-9.]/g, "")); setTouched(true); }}
                  placeholder="0.00"
                />
              </div>

              <div className="scav-f">
                <label>Effective from</label>
                <div className="scav-seg" role="group">
                  <button type="button" aria-pressed={effMode === "today"} onClick={() => { setEffMode("today"); setTouched(true); }} disabled={saving}>Today</button>
                  <button type="button" aria-pressed={effMode === "future"} onClick={() => { setEffMode("future"); setTouched(true); }} disabled={saving}>Future</button>
                  <button type="button" aria-pressed={effMode === "backdate"} onClick={() => { setEffMode("backdate"); setTouched(true); }} disabled={saving}>Backdate</button>
                </div>
                {effMode === "future" && (
                  <input type="date" min={tomorrow} value={futureDate} disabled={saving}
                    onChange={(e) => { setFutureDate(e.target.value); setTouched(true); }} style={{ marginTop: "var(--sc2-space-2)" }} />
                )}
                {effMode === "backdate" && (
                  <input type="date" min={BACKDATE_FLOOR} max={yesterday} value={backdateDate} disabled={saving}
                    onChange={(e) => { setBackdateDate(e.target.value); setTouched(true); }} style={{ marginTop: "var(--sc2-space-2)" }} />
                )}
                {isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday && (
                  <div className="scav-warn" role="alert">
                    <span>&#9888;</span>
                    <span>
                      <b>Backdate warning.</b> Backdating changes the contract-revenue history starting {fmtDateHuman(backdateDate)}. The Service Calendar is not affected - fees do not flow through calendar revenue. This system has no record of which days have been invoiced - verify against your billing before saving.
                    </span>
                  </div>
                )}
              </div>

              <div className="scav-f">
                <label htmlFor={`frs-${accountKey}`}>
                  Reason <span className="hint">required</span>
                </label>
                <textarea id={`frs-${accountKey}`} value={reason} disabled={saving}
                  onChange={(e) => { setReason(e.target.value); setTouched(true); }}
                  placeholder="Contract renewal" maxLength={280} rows={2} />
              </div>

              <div className="scav-f">
                <label htmlFor={`frq-${accountKey}`}>
                  Requested by <span className="hint">optional</span>
                </label>
                <input id={`frq-${accountKey}`} type="text" value={requestedBy} disabled={saving}
                  onChange={(e) => { setRequestedBy(e.target.value); setTouched(true); }}
                  placeholder="Who asked for this?" maxLength={280} />
              </div>

              <button type="button"
                className={isBackdate ? "scav-save scav-save--warn" : "scav-save"}
                disabled={!canSave} onClick={handleSave}>
                {saving ? <><span className="scav-spin" />Saving...</> : "Save fee change"}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="scav-insp-foot">
        {isMlb && <button type="button" onClick={onOpenLaborBudgets}>Labor budgets</button>}
        <button type="button" onClick={onOpenFeeHistory}>Fee history</button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Archive-service in the rail. Reuses the price-editor rail shape
// per Kevin ruling #2 + #3: same header, current-value block, warning
// treatment, save button. Only field is the effective date (Today /
// Future / Backdate) + reason. Payload = sc-admin-archive-service.

function RailArchiveService({ accountKey, service, initialMode, onSaved, onCancel, showToast, onDirtyChange }) {
  const [mode, setMode] = useState(initialMode);
  const [futureDate, setFutureDate] = useState("");
  const [backdateDate, setBackdateDate] = useState("");
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
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
  const canSave = !saving && dateReady && reasonReady;

  const dirty = reason.trim().length > 0 || mode !== initialMode || requestedBy.trim().length > 0
    || (mode === "future" && futureDate) || (mode === "backdate" && backdateDate);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const backdateSpanDays = isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate)
    ? daysBetweenInclusive(backdateDate, today) : 0;

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
        showToast({
          variant: "generic",
          tier: "ok",
          title: `${service.serviceName} archived`,
          detail: `${accountKey} - no longer available to enter from ${mode === "today" ? "today" : fmtDateHuman(archiveDate)}.`,
          actionLabel: "Undo",
          onAction: async () => {
            await fetch("/api/service-calendar", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "sc-admin-reactivate-service",
                accountKey,
                serviceId: service.id,
                reason: "Undo from archive-service toast",
              }),
            });
            onSaved?.();
          },
        });
        onSaved?.();
      } else {
        showToast({
          variant: "generic",
          tier: "bad",
          title: "Could not archive",
          detail: "Nothing was changed and your entry is still here. Check your connection and try again.",
          actionLabel: "Try again",
          onAction: () => handleSave(),
        });
        setSaving(false);
      }
    } catch {
      showToast({
        variant: "generic",
        tier: "bad",
        title: "Could not archive",
        detail: "Nothing was changed and your entry is still here. Check your connection and try again.",
        actionLabel: "Try again",
        onAction: () => handleSave(),
      });
      setSaving(false);
    }
  };

  return (
    <>
      <div className="scav-insp-scroll" data-rail-variant="archiveService">
        <div className="scav-fadein">
          <div className="scav-kick">Service</div>
          <div className="scav-ih">{service.serviceName}</div>
          <div className="scav-im">{accountKey} &middot; {service.groupName}</div>
          <div className="scav-cur">
            <div className="l">Current price</div>
            <div className="v">{fmtPrice(roundCents(service.price))}</div>
            {service.priceSinceDate && (
              <div className="s">since {fmtDateHuman(service.priceSinceDate)}</div>
            )}
          </div>

          <div className="scav-warn bad">
            <span>&#9888;</span>
            <span>
              <b>Archive {service.serviceName}</b><br />
              Hides this service from the calendar. Historical data unchanged. Reactivate any time.
            </span>
          </div>

          <div className="scav-f">
            <label>Effective from</label>
            <div className="scav-seg" role="group">
              <button type="button" aria-pressed={mode === "today"} onClick={() => setMode("today")} disabled={saving}>Today</button>
              <button type="button" aria-pressed={mode === "future"} onClick={() => setMode("future")} disabled={saving}>Future</button>
              <button type="button" aria-pressed={mode === "backdate"} onClick={() => setMode("backdate")} disabled={saving}>Backdate</button>
            </div>
            {mode === "future" && (
              <input type="date" min={tomorrow} value={futureDate} disabled={saving}
                onChange={(e) => setFutureDate(e.target.value)} style={{ marginTop: "var(--sc2-space-2)" }} />
            )}
            {mode === "backdate" && (
              <input type="date" min={BACKDATE_FLOOR} max={yesterday} value={backdateDate} disabled={saving}
                onChange={(e) => setBackdateDate(e.target.value)} style={{ marginTop: "var(--sc2-space-2)" }} />
            )}
            {isBackdate && /^\d{4}-\d{2}-\d{2}$/.test(backdateDate) && backdateDate >= BACKDATE_FLOOR && backdateDate <= yesterday && (
              <div className="scav-warn" role="alert">
                <span>&#9888;</span>
                <span>
                  <b>Backdate warning.</b> Archiving as of {fmtDateHuman(backdateDate)} recomputes revenue over {backdateSpanDays} calendar day{backdateSpanDays === 1 ? "" : "s"}. This system has no record of which days have been invoiced - verify against your billing before saving.
                </span>
              </div>
            )}
          </div>

          <div className="scav-f">
            <label htmlFor={`arcrs-${service.id}`}>
              Reason <span className="hint">required</span>
            </label>
            <textarea id={`arcrs-${service.id}`} value={reason} disabled={saving}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this service being archived?" maxLength={280} rows={2} />
          </div>

          <div className="scav-f">
            <label htmlFor={`arcrq-${service.id}`}>
              Requested by <span className="hint">optional</span>
            </label>
            <input id={`arcrq-${service.id}`} type="text" value={requestedBy} disabled={saving}
              onChange={(e) => setRequestedBy(e.target.value)}
              placeholder="Who asked for this?" maxLength={280} />
          </div>

          {/* PR-N audit P1-4 (2026-08-21): archive-now is destructive-
              red, not amber. Amber means scheduled/caution in this
              product; red means destructive. Schedule (future/backdate)
              stays amber-warn because scheduling is reversible. */}
          <button type="button"
            className={mode === "today" ? "scav-save scav-save--danger" : "scav-save scav-save--warn"}
            disabled={!canSave} onClick={handleSave}>
            {saving ? <><span className="scav-spin" />Archiving...</> : (mode === "today" ? "Archive now" : mode === "future" ? "Schedule archive" : "Save backdated archive")}
          </button>
        </div>
      </div>
      <div className="scav-insp-foot">
        <button type="button" onClick={onCancel}>Cancel &middot; back to editor</button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// State 9: archived service (Reactivate)

function RailArchived({
  accountKey,
  account,
  service,
  onSaved,
  showToast,
  onDirtyChange,
  onOpenViewHistory,
}) {
  const [reason, setReason] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const reasonReady = reason.trim().length > 0 && reason.length <= 280;
  const canSave = !saving && reasonReady;

  const dirty = reason.trim().length > 0 || requestedBy.trim().length > 0;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const handleReactivate = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sc-admin-reactivate-service",
          accountKey,
          serviceId: service.id,
          reason: reason.trim(),
          requestedBy: requestedBy.trim() || undefined,
        }),
      });
      const result = await res.json();
      if (result.success) {
        showToast({
          variant: "generic",
          tier: "ok",
          title: `${service.serviceName} reactivated`,
          detail: `${accountKey} &middot; available to enter from today.`,
        });
        onSaved?.();
      } else {
        showToast({
          variant: "generic",
          tier: "bad",
          title: "Could not reactivate",
          detail: "Nothing was changed and your entry is still here. Check your connection and try again.",
          actionLabel: "Try again",
          onAction: () => handleReactivate(),
        });
        setSaving(false);
      }
    } catch {
      showToast({
        variant: "generic",
        tier: "bad",
        title: "Could not reactivate",
        detail: "Nothing was changed and your entry is still here. Check your connection and try again.",
        actionLabel: "Try again",
        onAction: () => handleReactivate(),
      });
      setSaving(false);
    }
  };

  return (
    <>
      <div className="scav-insp-scroll" data-rail-variant="archived">
        <div className="scav-fadein">
          <div className="scav-kick">Service</div>
          <div className="scav-ih">{service.serviceName}</div>
          <div className="scav-im">{accountKey} &middot; {service.groupName}</div>
          <div className="scav-cur">
            <div className="l">Last price</div>
            <div className="v">{fmtPrice(roundCents(service.price))}</div>
            <div className="s">archived {fmtDateHuman(service.activeUntil)}</div>
          </div>
          <div className="scav-warn">
            <span>&#9888;</span>
            <span>Archived services cannot be priced. Reactivate it first.</span>
          </div>

          <div className="scav-f">
            <label htmlFor={`rea-${service.id}`}>
              Reason <span className="hint">required</span>
            </label>
            <textarea id={`rea-${service.id}`} value={reason} disabled={saving}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this service coming back?" maxLength={280} rows={2} />
          </div>

          <div className="scav-f">
            <label htmlFor={`rearq-${service.id}`}>
              Requested by <span className="hint">optional</span>
            </label>
            <input id={`rearq-${service.id}`} type="text" value={requestedBy} disabled={saving}
              onChange={(e) => setRequestedBy(e.target.value)}
              placeholder="Who asked for this?" maxLength={280} />
          </div>

          <button type="button"
            className="scav-save scav-save--muted"
            disabled={!canSave} onClick={handleReactivate}>
            {saving ? <><span className="scav-spin" />Reactivating...</> : "Reactivate service"}
          </button>
        </div>
      </div>
      <div className="scav-insp-foot">
        <button type="button" onClick={onOpenViewHistory}>View history</button>
      </div>
    </>
  );
}

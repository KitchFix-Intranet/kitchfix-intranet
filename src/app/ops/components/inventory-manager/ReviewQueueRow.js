"use client";
// PR B commit 1: one row in the Review Queue dashboard.
// Routes by canonical action (canonicalActionFor):
//   INLINE_QTY    arithmetic_fail - inline qty input + Resolve (B-1, unchanged)
//   MATCH_CONFIRM has a suggested match - "Review match" button (commit 2 wires
//                 the ResolveModal; commit 1 ships the button disabled with a
//                 clear "ships next" affordance)
//   SKIP_ONLY     no actionable path - clear label + Skip button.
// No more "Unsupported reason" stub. Skip button is universal.

import { useState, useRef, useEffect } from "react";
import { canonicalActionFor, reasonLabelFor } from "./reviewQueueLogic";

const fmtNum = (n) => (n == null || isNaN(Number(n))) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtUsd = (n) => (n == null || isNaN(Number(n))) ? "—" : "$" + Number(n).toFixed(2);

export default function ReviewQueueRow({ item, onResolve, onSkip, onOpenMatchModal, busy }) {
  const [draftQty, setDraftQty] = useState(item.quantity ?? "");
  const [draftUnit, setDraftUnit] = useState(item.unit || "");
  const [softAlert, setSoftAlert] = useState(null); // { message, accept: () => fn }
  const qtyRef = useRef(null);

  // Keep local state in sync when the underlying item changes (e.g. after a
  // sibling resolve that re-orders the list).
  useEffect(() => {
    setDraftQty(item.quantity ?? "");
    setDraftUnit(item.unit || "");
    setSoftAlert(null);
  }, [item.queueId]);

  const action = canonicalActionFor(item);
  // Ambiguity flag from the server: 2+ ai_line_items rows share the same
  // (invoiceUuid, description). Resolve would silently overwrite the wrong
  // physical line - the server-side guard refuses, but we also disable the
  // button + flag visually so Kevin sees it before clicking.
  const isAmbiguous = !!item.ambiguous;

  async function handleResolve(acceptArithmeticMismatch = false) {
    if (draftQty === "" || isNaN(Number(draftQty))) {
      return;
    }
    const res = await onResolve({
      queueId: item.queueId,
      correctedQty: Number(draftQty),
      correctedUnit: draftUnit || item.unit || "",
      acceptArithmeticMismatch,
    });
    if (res && res.error === "arithmetic_mismatch") {
      setSoftAlert({
        message: res.softCheck?.message || "Math doesn't reconcile. Resolve anyway?",
        accept: () => handleResolve(true),
      });
      return;
    }
    setSoftAlert(null);
  }

  async function handleSkip() {
    await onSkip({ queueId: item.queueId });
  }

  // Math display for the inline-qty row (so Kevin sees the implied math
  // before he commits): correctedQty x unitPrice ?= amount.
  const liveCalc = (() => {
    const q = Number(draftQty);
    const u = Number(item.unitPrice);
    if (!Number.isFinite(q) || !Number.isFinite(u)) return null;
    return q * u;
  })();
  const amountNum = Number(item.amount);
  const liveDelta = (liveCalc != null && Number.isFinite(amountNum))
    ? Math.abs(liveCalc - amountNum)
    : null;
  const liveTol = (Number.isFinite(amountNum)) ? 0.02 * Math.abs(amountNum) + 0.01 : null;
  const liveOk  = liveDelta != null && liveTol != null && liveDelta <= liveTol;

  return (
    <div className="oh-rq-row" data-busy={busy ? "1" : "0"}>
      <div className="oh-rq-row-head">
        <div className="oh-rq-row-meta">
          <span className="oh-rq-pill oh-rq-pill-account">{item.account}</span>
          <span className="oh-rq-pill oh-rq-pill-vendor">{item.vendor || "—"}</span>
          <span className={`oh-rq-pill oh-rq-pill-reason oh-rq-pill-reason-${item.reason || "blank"}`}>{reasonLabelFor(item)}</span>
          {isAmbiguous ? <span className="oh-rq-pill oh-rq-pill-ambiguous" title="Two+ lines on this invoice share this description. Resolve disabled until B-2 adds lineNum to the queue row.">⚠ duplicate description — skip only</span> : null}
          {item.rawDriveUrl
            ? <a href={item.rawDriveUrl} target="_blank" rel="noopener noreferrer" className="oh-rq-link">📄 #{item.invoiceNumber || item.invoiceUuid.slice(0, 8)}</a>
            : <span className="oh-rq-pill-muted">#{item.invoiceNumber || item.invoiceUuid.slice(0, 8)}</span>
          }
        </div>
        <div className="oh-rq-row-desc">{item.description}</div>
        <div className="oh-rq-row-numbers">
          <span title="extracted qty">qty: <strong>{fmtNum(item.quantity)}</strong> {item.unit}</span>
          <span title="extracted unit price">× <strong>{fmtUsd(item.unitPrice)}</strong>/unit</span>
          <span title="extracted line amount">= <strong>{fmtUsd(item.amount)}</strong></span>
          {item.suggestedMatchName
            ? <span className="oh-rq-row-match">→ <em>{item.suggestedMatchName}</em> ({Math.round(item.confidence)}%)</span>
            : null
          }
        </div>
      </div>

      <div className="oh-rq-row-action">
        {action === "INLINE_QTY" ? (
          <>
            <div className="oh-rq-input-group">
              <label>Corrected qty</label>
              <input
                ref={qtyRef}
                type="number"
                step="any"
                value={draftQty}
                onChange={(e) => { setDraftQty(e.target.value); setSoftAlert(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !isAmbiguous) handleResolve(false); }}
                disabled={busy || isAmbiguous}
                className="oh-rq-input"
              />
              <input
                type="text"
                value={draftUnit}
                onChange={(e) => setDraftUnit(e.target.value)}
                placeholder="unit (lb, case, ea)"
                disabled={busy || isAmbiguous}
                className="oh-rq-input oh-rq-input-unit"
              />
            </div>
            <div className={`oh-rq-live-math ${liveCalc != null && !liveOk ? "oh-rq-live-math-warn" : ""}`}>
              {liveCalc != null
                ? <>{fmtNum(draftQty)} × {fmtUsd(item.unitPrice)} = <strong>{fmtUsd(liveCalc)}</strong>{liveOk ? " ✓" : ` ≠ ${fmtUsd(amountNum)}`}</>
                : <span className="oh-rq-live-math-muted">enter a quantity</span>
              }
            </div>
            <div className="oh-rq-buttons">
              <button onClick={() => handleResolve(false)} disabled={busy || isAmbiguous || draftQty === ""} className="oh-rq-btn oh-rq-btn-resolve" title={isAmbiguous ? "Disabled: ambiguous line - skip only until lineNum is in the queue row" : ""}>Resolve</button>
              <button onClick={handleSkip} disabled={busy} className="oh-rq-btn oh-rq-btn-skip">Skip</button>
            </div>
            {softAlert ? (
              <div className="oh-rq-soft-alert">
                <span>{softAlert.message}</span>
                <button onClick={softAlert.accept} className="oh-rq-btn oh-rq-btn-resolve-warn">Resolve anyway</button>
                <button onClick={() => setSoftAlert(null)} className="oh-rq-btn oh-rq-btn-cancel">Cancel</button>
              </div>
            ) : null}
          </>
        ) : action === "MATCH_CONFIRM" ? (
          <div className="oh-rq-low-match">
            <button onClick={() => onOpenMatchModal?.(item)} disabled={busy} className="oh-rq-btn oh-rq-btn-resolve">Review match</button>
            <button onClick={handleSkip} disabled={busy} className="oh-rq-btn oh-rq-btn-skip">Skip</button>
          </div>
        ) : (
          <div className="oh-rq-low-match">
            <span className="oh-rq-low-match-stub">No catalog match suggested - skip or wait for catalog search</span>
            <button onClick={handleSkip} disabled={busy} className="oh-rq-btn oh-rq-btn-skip">Skip</button>
          </div>
        )}
      </div>
    </div>
  );
}

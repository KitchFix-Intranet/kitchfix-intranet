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
import { canonicalActionFor, reasonLabelFor, detectSuspectedCatchWeight } from "./reviewQueueLogic";

const fmtNum = (n) => (n == null || isNaN(Number(n))) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtUsd = (n) => (n == null || isNaN(Number(n))) ? "—" : "$" + Number(n).toFixed(2);

export default function ReviewQueueRow({ item, onResolve, onSkip, onOpenMatchModal, onQuickAccept, onToggleSelect, selected, busy }) {
  const [draftQty, setDraftQty] = useState(item.quantity ?? "");
  const [draftUnit, setDraftUnit] = useState(item.unit || "");
  const [softAlert, setSoftAlert] = useState(null); // { message, accept: () => fn }
  // PR B commit 4.5: inline quick-accept loading flag. Row owns its own busy
  // state for the inline Accept button so the label can show "Accepting..."
  // while the request is in flight without coupling to the screen's
  // busyQueueId (which is also set by modal-fired actions).
  const [quickAccepting, setQuickAccepting] = useState(false);
  // PR B commit 5: catalog-detail peek state. Lazy-load on first expand.
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState(null);          // { item: {...} }
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);
  const qtyRef = useRef(null);

  // Keep local state in sync when the underlying item changes (e.g. after a
  // sibling resolve that re-orders the list). PR B commit 7: when the row
  // is a suspected catch-weight (back-calc), pre-fill the corrected qty +
  // unit with the implied weight as a SUGGESTION the operator verifies.
  // Nothing persists until they click Resolve - the existing reconcile write
  // path runs unchanged.
  useEffect(() => {
    const cw = detectSuspectedCatchWeight(item);
    if (cw) {
      setDraftQty(cw.impliedWeight.toFixed(2));
      setDraftUnit(cw.suggestedUnit);
    } else {
      setDraftQty(item.quantity ?? "");
      setDraftUnit(item.unit || "");
    }
    setSoftAlert(null);
  }, [item.queueId]);

  const action = canonicalActionFor(item);
  // PR B commit 7: suspected catch-weight flag for INLINE_QTY rows. Drives
  // the badge above the qty input + the inline "verify against invoice"
  // language. The qty pre-fill happened in the effect above.
  const suspectedCatchWeight = detectSuspectedCatchWeight(item);
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

  async function handleQuickAccept() {
    if (!item.suggestedMatchId || isAmbiguous) return;
    setQuickAccepting(true);
    try {
      await onQuickAccept?.(item);
    } finally {
      setQuickAccepting(false);
    }
  }

  async function toggleDetail() {
    if (detailOpen) { setDetailOpen(false); return; }
    setDetailOpen(true);
    if (detail || detailLoading || !item.suggestedMatchId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const qs = new URLSearchParams({ action: "catalog-item", itemId: item.suggestedMatchId, account: item.account || "" });
      const res = await fetch(`/api/ops/inventory?${qs.toString()}`);
      const json = await res.json();
      if (json.success) setDetail(json);
      else setDetailError(json.error || "Failed to load");
    } catch (e) {
      setDetailError(e.message);
    } finally {
      setDetailLoading(false);
    }
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
      {suspectedCatchWeight && action === "INLINE_QTY" ? (
        <div style={catchWeightBadgeStyle}>
          <strong>🔎 Suspected catch-weight</strong>
          <span> · priced per-lb, implied <strong>~{suspectedCatchWeight.impliedWeight.toFixed(2)} lb</strong> pre-filled. </span>
          <span style={{ color: "#92400e", fontWeight: 600 }}>Verify against the invoice</span>
          {item.rawDriveUrl ? <a href={item.rawDriveUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline", marginLeft: 4 }}>(open PDF)</a> : null}
          <span> - edit below if wrong, then Resolve.</span>
        </div>
      ) : null}
      <div className="oh-rq-row-head">
        <div className="oh-rq-row-meta">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect?.(item.queueId)}
            disabled={busy}
            title="Select for bulk skip"
            style={{ marginRight: 4, cursor: busy ? "default" : "pointer" }}
            aria-label={`Select line ${item.queueId} for bulk action`}
          />
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
          {item.catalogLastPrice && Number(item.catalogLastPrice) > 0 ? (() => {
            const lastPrice = Number(item.catalogLastPrice);
            const thisPrice = Number(item.unitPrice);
            const delta = thisPrice > 0 && lastPrice > 0 ? ((thisPrice - lastPrice) / lastPrice) * 100 : null;
            const color = delta == null ? "#64748b" : Math.abs(delta) < 1 ? "#64748b" : delta > 0 ? "#dc2626" : "#16a34a";
            const arrow = delta == null ? "" : Math.abs(delta) < 1 ? "" : delta > 0 ? "↑" : "↓";
            return (
              <span title={`Catalog last-price: ${fmtUsd(lastPrice)}/${item.catalogLastUnit || "unit"} on ${item.catalogLastDate || ""} via ${item.catalogLastVendor || ""}`} style={{ color, marginLeft: 6, fontSize: 12 }}>
                catalog {fmtUsd(lastPrice)}{item.catalogLastUnit ? `/${item.catalogLastUnit}` : ""} {arrow}{delta != null && Math.abs(delta) >= 1 ? ` ${Math.abs(delta).toFixed(0)}%` : ""}
              </span>
            );
          })() : null}
          {item.suggestedMatchName ? (
            item.suggestedMatchId ? (
              <button
                type="button"
                className="oh-rq-row-match"
                onClick={toggleDetail}
                style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit", textAlign: "left" }}
                title={detailOpen ? "Click to collapse" : "Click to inspect this catalog item before accepting"}
              >
                → <em>{item.suggestedMatchName}</em> ({Math.round(item.confidence)}%) <span style={{ color: "#94a3b8", fontSize: 11 }}>{detailOpen ? "▾" : "▸"}</span>
              </button>
            ) : (
              <span className="oh-rq-row-match">→ <em>{item.suggestedMatchName}</em> ({Math.round(item.confidence)}%)</span>
            )
          ) : null}
        </div>
        {detailOpen ? (
          <div style={detailPanelStyle}>
            {detailLoading ? <span style={{ color: "#64748b", fontSize: 12 }}>Loading catalog details…</span> : null}
            {detailError ? <span style={{ color: "#991b1b", fontSize: 12 }}>Error: {detailError}</span> : null}
            {detail?.item ? (
              <>
                <div style={detailGridStyle}>
                  <div><span style={detailLabelStyle}>Unit</span><strong style={detailValueStyle}>{detail.item.unit || "—"}</strong></div>
                  <div><span style={detailLabelStyle}>Category</span><strong style={detailValueStyle}>{detail.item.category || "—"}</strong></div>
                  <div><span style={detailLabelStyle}>Primary vendor</span><strong style={detailValueStyle}>{detail.item.primaryVendor || "—"}</strong></div>
                  <div><span style={detailLabelStyle}>Last price</span><strong style={detailValueStyle}>{detail.item.lastPrice ? `$${detail.item.lastPrice.toFixed(2)}` : "—"}{detail.item.lastPriceDate ? ` on ${detail.item.lastPriceDate}` : ""}</strong></div>
                  <div><span style={detailLabelStyle}>Last price vendor</span><strong style={detailValueStyle}>{detail.item.lastPriceVendor || "—"}</strong></div>
                  <div><span style={detailLabelStyle}>Purchase history</span><strong style={detailValueStyle}>{detail.item.purchaseCount} buys{detail.item.vendors?.length > 1 ? ` · ${detail.item.vendors.length} vendors` : ""}</strong></div>
                </div>
                {(item.unit && detail.item.unit && item.unit.toLowerCase() !== detail.item.unit.toLowerCase()) ? (
                  <div style={unitMismatchStyle}>
                    ⚠ Unit mismatch: this line is in <strong>{item.unit}</strong>, catalog item is tracked in <strong>{detail.item.unit}</strong>. Verify these are the same pack size before accepting.
                  </div>
                ) : null}
                {detail.item.recent && detail.item.recent.length > 1 ? (
                  <div style={recentPricesStyle}>
                    <span style={detailLabelStyle}>Recent prices</span>
                    {detail.item.recent.map((p, i) => (
                      <div key={i} style={recentRowStyle}>
                        <span style={{ color: "#64748b" }}>{p.date}</span>
                        <span>{p.vendor}</span>
                        <strong>${p.price.toFixed(2)}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
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
            {item.suggestedMatchId && !isAmbiguous ? (
              <button
                onClick={handleQuickAccept}
                disabled={busy || quickAccepting}
                className="oh-rq-btn oh-rq-btn-resolve"
                title={`Accept ${item.suggestedMatchName} (${Math.round(Number(item.confidence) || 0)}%)`}
              >
                {quickAccepting ? "Accepting..." : "Accept"}
              </button>
            ) : null}
            <button onClick={() => onOpenMatchModal?.(item)} disabled={busy || quickAccepting} className="oh-rq-btn oh-rq-btn-skip" title="Review match in modal (pick different / create new)">Review</button>
            <button onClick={handleSkip} disabled={busy || quickAccepting} className="oh-rq-btn oh-rq-btn-skip">Skip</button>
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

// PR B commit 5 - inline catalog detail peek styles (kept local to this
// component since the design is bespoke to the row and not reused elsewhere).
const detailPanelStyle = {
  marginTop: 8, padding: 10, background: "#f8fafc", border: "1px solid #e2e8f0",
  borderRadius: 6, fontSize: 12, color: "#1e293b",
};
const detailGridStyle = {
  display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px 16px",
};
const detailLabelStyle = {
  display: "block", color: "#64748b", fontSize: 11, marginBottom: 1,
};
const detailValueStyle = {
  display: "block", fontWeight: 600, fontSize: 13,
};
const unitMismatchStyle = {
  marginTop: 8, padding: "6px 10px", background: "#fef3c7", color: "#92400e",
  border: "1px solid #fde68a", borderRadius: 4, fontSize: 12,
};
const recentPricesStyle = {
  marginTop: 10, paddingTop: 8, borderTop: "1px solid #e2e8f0",
};
const recentRowStyle = {
  display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 12,
  padding: "2px 0", fontSize: 12,
};
const catchWeightBadgeStyle = {
  // Full-width strip at the top of the row. Spans the whole row width so it
  // doesn't push the action panel and break the flex layout below.
  background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a",
  borderRadius: 4, padding: "6px 10px", marginBottom: 8, fontSize: 12,
  lineHeight: 1.5, width: "100%", boxSizing: "border-box",
};

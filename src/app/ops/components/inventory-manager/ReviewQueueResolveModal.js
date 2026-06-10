"use client";
// PR B commit 2: Match-Confirm Modal.
//
// Opens from the row's "Review match" button. Operator confirms one of four
// outcomes for a held line that has (or might have) a catalog match:
//
//   Accept this match   - link to item.suggestedMatchId. Wired this commit.
//   Pick a different    - catalog search + pick. Stub (wired in commit 3).
//   Create as new       - new catalog entry. Stub (wired in commit 3).
//   Skip                - status=rejected, no writes. Reuses existing skip path.
//
// Ambiguity guard (carry from B-1): if item.ambiguous (2+ ai_line_items rows
// share invoiceUuid+description on this account), Accept is disabled because
// the resolve handler would refuse anyway - surface the guard at click-time
// so the operator sees it before the round-trip.

import { useState } from "react";

const fmtNum = (n) => (n == null || isNaN(Number(n))) ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtUsd = (n) => (n == null || isNaN(Number(n))) ? "-" : "$" + Number(n).toFixed(2);

export default function ReviewQueueResolveModal({ item, onClose, onResolveMatch, onSkip }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const hasSuggestion = !!item.suggestedMatchId;
  const isAmbiguous   = !!item.ambiguous;

  async function handleAccept() {
    if (!hasSuggestion || isAmbiguous) return;
    setBusy(true); setError(null);
    const res = await onResolveMatch({
      queueId: item.queueId,
      itemId:  item.suggestedMatchId,
      source:  "accept_suggested",
    });
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    onClose();
  }

  async function handleSkip() {
    setBusy(true); setError(null);
    const res = await onSkip({ queueId: item.queueId });
    setBusy(false);
    if (res?.error) { setError(res.error); return; }
    onClose();
  }

  return (
    <div style={backdropStyle} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={modalStyle} role="dialog" aria-modal="true" aria-labelledby="oh-rq-modal-title">
        <div style={headerStyle}>
          <h3 id="oh-rq-modal-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Review match</h3>
          <button onClick={onClose} disabled={busy} style={closeBtnStyle} aria-label="Close">x</button>
        </div>

        <div style={bodyStyle}>
          <div style={{ marginBottom: 10 }}>
            <div style={metaRowStyle}>
              <span style={pillStyle}>{item.account}</span>
              <span style={pillStyle}>{item.vendor || "-"}</span>
              {item.rawDriveUrl
                ? <a href={item.rawDriveUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>Invoice #{item.invoiceNumber || (item.invoiceUuid || "").slice(0, 8)}</a>
                : <span style={pillStyle}>#{item.invoiceNumber || (item.invoiceUuid || "").slice(0, 8)}</span>
              }
            </div>
            <div style={{ marginTop: 6, fontWeight: 600 }}>{item.description}</div>
            <div style={{ marginTop: 4, color: "#475569", fontSize: 13 }}>
              qty: <strong>{fmtNum(item.quantity)}</strong> {item.unit} x <strong>{fmtUsd(item.unitPrice)}</strong>/unit = <strong>{fmtUsd(item.amount)}</strong>
            </div>
          </div>

          <div style={suggestionBoxStyle}>
            <div style={{ color: "#475569", fontSize: 12, marginBottom: 4 }}>Suggested catalog match</div>
            {hasSuggestion
              ? <>
                  <div style={{ fontWeight: 600 }}>{item.suggestedMatchName}</div>
                  <div style={{ color: "#64748b", fontSize: 12 }}>confidence {Math.round(Number(item.confidence) || 0)}%</div>
                </>
              : <div style={{ color: "#94a3b8", fontStyle: "italic" }}>No catalog match suggested</div>
            }
          </div>

          {isAmbiguous ? (
            <div style={warningStyle}>
              Duplicate description: 2+ lines on this invoice share this text. Resolve is disabled because we cannot determine which physical line to price-tie without lineNum. Skip is the only safe action until the queue writer carries lineNum.
            </div>
          ) : null}

          {error ? <div style={errorStyle}>Error: {error}</div> : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            <button onClick={handleAccept} disabled={busy || !hasSuggestion || isAmbiguous} style={primaryBtnStyle} title={!hasSuggestion ? "No suggestion to accept" : isAmbiguous ? "Disabled: ambiguous line" : ""}>
              Accept this match
            </button>
            <button disabled title="Catalog search ships in commit 3" style={disabledBtnStyle}>
              Pick a different item (commit 3)
            </button>
            <button disabled title="Create-new ships in commit 3" style={disabledBtnStyle}>
              Create as new catalog item (commit 3)
            </button>
            <button onClick={handleSkip} disabled={busy} style={skipBtnStyle}>
              Skip
            </button>
            <button onClick={onClose} disabled={busy} style={cancelBtnStyle}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const backdropStyle = {
  position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 16,
};
const modalStyle = {
  background: "#fff", borderRadius: 8, width: "100%", maxWidth: 520,
  boxShadow: "0 20px 60px rgba(0,0,0,0.25)", overflow: "hidden",
  display: "flex", flexDirection: "column", maxHeight: "90vh",
};
const headerStyle = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "12px 16px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc",
};
const closeBtnStyle = {
  border: "none", background: "transparent", fontSize: 20, color: "#64748b",
  cursor: "pointer", padding: 0, lineHeight: 1,
};
const bodyStyle = { padding: 16, overflow: "auto" };
const metaRowStyle = { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" };
const pillStyle = {
  background: "#f1f5f9", color: "#475569", borderRadius: 4,
  padding: "2px 8px", fontSize: 12, fontWeight: 500,
};
const linkStyle = { color: "#2563eb", fontSize: 12, fontWeight: 500, textDecoration: "none" };
const suggestionBoxStyle = {
  background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6,
  padding: 12, marginTop: 10,
};
const warningStyle = {
  background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a",
  borderRadius: 6, padding: 10, marginTop: 10, fontSize: 13,
};
const errorStyle = {
  background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca",
  borderRadius: 6, padding: 10, marginTop: 10, fontSize: 13,
};
const primaryBtnStyle = {
  background: "#16a34a", color: "#fff", border: "none", borderRadius: 6,
  padding: "10px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer",
};
const disabledBtnStyle = {
  background: "#f1f5f9", color: "#94a3b8", border: "1px solid #e2e8f0",
  borderRadius: 6, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: "not-allowed",
};
const skipBtnStyle = {
  background: "#fff", color: "#475569", border: "1px solid #cbd5e1",
  borderRadius: 6, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const cancelBtnStyle = {
  background: "transparent", color: "#64748b", border: "none",
  padding: "6px 14px", fontSize: 13, cursor: "pointer",
};

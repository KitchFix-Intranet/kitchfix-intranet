"use client";
// PR B commit 2 + 3: Match-Confirm Modal.
//
// Three modes, all gated by the row's ambiguity flag (carry from B-1):
//
//   overview  default. Shows suggested match + four action buttons.
//   pick      catalog search inline. Operator picks a different item; resolves
//             via commit 2's resolve-queue-match handler with source="manual_pick".
//   create    new-catalog form. Resolves via commit 3's resolve-queue-create
//             handler; reuses createInventoryItem with skipPriceHistory=true so
//             the ONE price_history row tied to invoiceUuid is the only one
//             written (Q3 honored).
//
// Catalog fetch is lazy: when the operator clicks "Pick a different item",
// the modal fetches the catalog for THIS row's account via the existing
// /api/ops/inventory?action=catalog endpoint. No pre-fetch in the parent.

import { useState, useEffect } from "react";

const fmtNum = (n) => (n == null || isNaN(Number(n))) ? "-" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtUsd = (n) => (n == null || isNaN(Number(n))) ? "-" : "$" + Number(n).toFixed(2);

const CATS = ["Food", "Beverages", "Snacks", "Supplies", "Packaging"];
const UNITS = ["case", "each", "box", "pack", "gallon", "lb", "oz", "bag", "dozen", "count"];

export default function ReviewQueueResolveModal({ item, onClose, onResolveMatch, onResolveCreate, onSkip }) {
  const [mode, setMode] = useState("overview");   // "overview" | "pick" | "create"
  // PR B commit 4.5: busy is now an action enum so the active button can show
  // a "...ing" label while still disabling siblings. Truthy = something in
  // flight; exact value tells the UI which button to relabel.
  const [busy, setBusy] = useState(null);          // null | "accept" | "pick" | "create" | "skip"
  const [error, setError] = useState(null);

  const hasSuggestion = !!item.suggestedMatchId;
  const isAmbiguous   = !!item.ambiguous;

  // ── Pick-different state ──
  const [catalogItems, setCatalogItems] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [pickSearch, setPickSearch] = useState("");

  useEffect(() => {
    if (mode !== "pick" || catalogItems.length > 0 || catalogLoading) return;
    setCatalogLoading(true);
    fetch(`/api/ops/inventory?action=catalog&account=${encodeURIComponent(item.account)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setCatalogItems(json.items || []);
        else setError(json.error || "Catalog load failed");
      })
      .catch((e) => setError(e.message))
      .finally(() => setCatalogLoading(false));
  }, [mode, item.account, catalogItems.length, catalogLoading]);

  const q = pickSearch.toLowerCase().trim();
  const pickResults = q.length < 2 ? [] : catalogItems.filter((c) =>
    (c.name || "").toLowerCase().includes(q) ||
    (c.primaryVendor || "").toLowerCase().includes(q) ||
    (c.itemId || "").toLowerCase().includes(q)
  ).slice(0, 12);

  // ── Create-new state ──
  const [createName, setCreateName] = useState("");
  const [createCategory, setCreateCategory] = useState("Food");
  const [createUnit, setCreateUnit] = useState("");

  useEffect(() => {
    // Pre-fill name from the AI suggestion (if any) or fall back to the raw
    // line text; unit from the extracted ai_line_items unit. Operator can
    // edit both before submitting.
    if (mode === "create" && !createName) {
      setCreateName(item.suggestedMatchName || item.description || "");
      setCreateUnit(item.unit || "case");
    }
  }, [mode, item.suggestedMatchName, item.description, item.unit, createName]);

  // ── Actions ──
  async function handleAccept() {
    if (!hasSuggestion || isAmbiguous) return;
    setBusy("accept"); setError(null);
    const res = await onResolveMatch({
      queueId: item.queueId,
      itemId:  item.suggestedMatchId,
      source:  "accept_suggested",
    });
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    onClose();
  }

  async function handlePick(pickedItemId) {
    if (isAmbiguous) return;
    setBusy("pick"); setError(null);
    const res = await onResolveMatch({
      queueId: item.queueId,
      itemId:  pickedItemId,
      source:  "manual_pick",
    });
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    onClose();
  }

  async function handleCreate() {
    if (isAmbiguous) return;
    if (!createName.trim()) { setError("Name required"); return; }
    setBusy("create"); setError(null);
    const res = await onResolveCreate({
      queueId:  item.queueId,
      name:     createName.trim(),
      category: createCategory,
      unit:     createUnit || item.unit || "case",
    });
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    onClose();
  }

  async function handleSkip() {
    setBusy("skip"); setError(null);
    const res = await onSkip({ queueId: item.queueId });
    setBusy(null);
    if (res?.error) { setError(res.error); return; }
    onClose();
  }

  return (
    <div style={backdropStyle} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={modalStyle} role="dialog" aria-modal="true" aria-labelledby="oh-rq-modal-title">
        <div style={headerStyle}>
          <h3 id="oh-rq-modal-title" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
            {mode === "overview" ? "Review match" : mode === "pick" ? "Pick a different catalog item" : "Create as new catalog item"}
          </h3>
          <button onClick={onClose} disabled={!!busy} style={closeBtnStyle} aria-label="Close">x</button>
        </div>

        <div style={bodyStyle}>
          {/* Line metadata + math row (shown in all three modes for context) */}
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

          {isAmbiguous ? (
            <div style={warningStyle}>
              Duplicate description: 2+ lines on this invoice share this text. Resolve is disabled because we cannot determine which physical line to price-tie without lineNum. Skip is the only safe action.
            </div>
          ) : null}

          {error ? <div style={errorStyle}>Error: {error}</div> : null}

          {/* ── OVERVIEW MODE ── */}
          {mode === "overview" ? (
            <>
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

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                <button onClick={handleAccept} disabled={!!busy || !hasSuggestion || isAmbiguous} style={primaryBtnStyle} title={!hasSuggestion ? "No suggestion to accept" : isAmbiguous ? "Disabled: ambiguous line" : ""}>
                  {busy === "accept" ? "Accepting..." : "Accept this match"}
                </button>
                <button onClick={() => setMode("pick")} disabled={!!busy || isAmbiguous} style={secondaryBtnStyle}>
                  Pick a different item
                </button>
                <button onClick={() => setMode("create")} disabled={!!busy || isAmbiguous} style={secondaryBtnStyle}>
                  Create as new catalog item
                </button>
                <button onClick={handleSkip} disabled={!!busy} style={skipBtnStyle}>
                  {busy === "skip" ? "Skipping..." : "Skip"}
                </button>
                <button onClick={onClose} disabled={!!busy} style={cancelBtnStyle}>
                  Cancel
                </button>
              </div>
            </>
          ) : null}

          {/* ── PICK MODE ── */}
          {mode === "pick" ? (
            <>
              <div style={{ marginTop: 10 }}>
                <input
                  type="text"
                  value={pickSearch}
                  onChange={(e) => setPickSearch(e.target.value)}
                  placeholder="Search catalog by name, vendor, or item id..."
                  autoFocus
                  disabled={!!busy || catalogLoading}
                  style={searchInputStyle}
                />
                <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
                  {catalogLoading ? `Loading catalog for ${item.account}...` : `${catalogItems.length} catalog items available`}
                </div>
              </div>
              <div style={{ marginTop: 10, maxHeight: 280, overflowY: "auto" }}>
                {q.length < 2 ? (
                  <div style={{ color: "#94a3b8", fontStyle: "italic", padding: 12 }}>Type at least 2 characters to search</div>
                ) : pickResults.length === 0 ? (
                  <div style={{ color: "#94a3b8", fontStyle: "italic", padding: 12 }}>No items match &quot;{pickSearch}&quot;</div>
                ) : (
                  pickResults.map((c) => (
                    <button key={c.itemId} onClick={() => handlePick(c.itemId)} disabled={!!busy || isAmbiguous} style={pickResultStyle}>
                      <div style={{ fontWeight: 600 }}>{c.name} {busy === "pick" ? <span style={{ color: "#64748b", fontWeight: 400 }}>· linking...</span> : null}</div>
                      <div style={{ color: "#64748b", fontSize: 12 }}>
                        {c.primaryVendor || "-"}
                        {c.lastPrice ? ` · ${fmtUsd(c.lastPrice)}/${c.unit || "ea"}` : ""}
                        {c.category ? ` · ${c.category}` : ""}
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button onClick={() => { setMode("overview"); setError(null); }} disabled={!!busy} style={cancelBtnStyle}>Back</button>
              </div>
            </>
          ) : null}

          {/* ── CREATE MODE ── */}
          {mode === "create" ? (
            <>
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                <label style={labelStyle}>
                  <span>Name</span>
                  <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} disabled={!!busy} style={inputStyle} autoFocus />
                </label>
                <label style={labelStyle}>
                  <span>Category</span>
                  <select value={createCategory} onChange={(e) => setCreateCategory(e.target.value)} disabled={!!busy} style={inputStyle}>
                    {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label style={labelStyle}>
                  <span>Unit</span>
                  <select value={createUnit || "case"} onChange={(e) => setCreateUnit(e.target.value)} disabled={!!busy} style={inputStyle}>
                    {[...new Set([createUnit, ...UNITS].filter(Boolean))].map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
                <div style={readOnlyRowStyle}>
                  <div><span style={{ color: "#64748b" }}>Vendor:</span> <strong>{item.vendor || "-"}</strong> <span style={{ color: "#94a3b8", fontSize: 12 }}>(from invoice)</span></div>
                  <div><span style={{ color: "#64748b" }}>Initial price:</span> <strong>{fmtUsd(item.unitPrice)}</strong>/{createUnit || "case"} <span style={{ color: "#94a3b8", fontSize: 12 }}>(from invoice line)</span></div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button onClick={handleCreate} disabled={!!busy || isAmbiguous || !createName.trim()} style={primaryBtnStyle}>
                  {busy === "create" ? "Creating..." : "Create + resolve"}
                </button>
                <button onClick={() => { setMode("overview"); setError(null); }} disabled={!!busy} style={cancelBtnStyle}>Back</button>
              </div>
            </>
          ) : null}
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
  background: "#fff", borderRadius: 8, width: "100%", maxWidth: 560,
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
const secondaryBtnStyle = {
  background: "#fff", color: "#1e293b", border: "1px solid #cbd5e1",
  borderRadius: 6, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const skipBtnStyle = {
  background: "#fff", color: "#475569", border: "1px solid #cbd5e1",
  borderRadius: 6, padding: "10px 14px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const cancelBtnStyle = {
  background: "transparent", color: "#64748b", border: "none",
  padding: "6px 14px", fontSize: 13, cursor: "pointer",
};
const searchInputStyle = {
  width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1",
  borderRadius: 6, fontSize: 14,
};
const pickResultStyle = {
  display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
  border: "1px solid #e2e8f0", borderRadius: 6, marginBottom: 6,
  background: "#fff", cursor: "pointer",
};
const labelStyle = {
  display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#475569",
};
const inputStyle = {
  padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 6,
  fontSize: 14, background: "#fff",
};
const readOnlyRowStyle = {
  background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6,
  padding: 10, fontSize: 13, display: "flex", flexDirection: "column", gap: 4,
};

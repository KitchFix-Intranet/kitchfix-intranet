"use client";
// PR B commit 1: Review Queue dashboard. Top-level screen inside InventoryManager.
// Lists held lines, filters by account/reason/vendor, fires resolve + skip
// against /api/ops/inventory. Stats bar now buckets by CANONICAL ACTION
// (inline-qty / match-confirm / skip-only), not raw reason, so the count
// matches the actions available to Kevin.

import { useState, useEffect, useMemo, useCallback } from "react";
import ReviewQueueRow from "./ReviewQueueRow";
import ReviewQueueResolveModal from "./ReviewQueueResolveModal";
import { bucketCounts } from "./reviewQueueLogic";

export default function ReviewQueueScreen({ showToast, onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterAccount, setFilterAccount] = useState("");
  const [filterReason, setFilterReason]   = useState("");
  const [filterVendor, setFilterVendor]   = useState("");
  const [busyQueueId, setBusyQueueId]     = useState(null);
  const [matchModalItem, setMatchModalItem] = useState(null);
  // PR B commit 4: multi-select for bulk-skip. Set of queueId strings.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // PR B commit 5.5: sort order for the visible list.
  const [sortBy, setSortBy] = useState("default");      // "default" | "vendor" | "reason" | "confidence"
  // PR B commit 5.5: session counters (since component mount). Resets on
  // refresh or page reload - the goal is a single-session progress meter, not
  // an audit trail.
  const [sessionStats, setSessionStats] = useState({ resolved: 0, skipped: 0, created: 0 });
  // PR B commit 6: undo state. Single slot (last action only). undoToken is
  // an opaque blob the server returns; we pass it back to the undo endpoint.
  // undoLabel is the human-readable description shown in the banner.
  // undoItem stores the row data so we can restore it to the visible list
  // on a successful undo (avoiding a full reload).
  const [undoToken, setUndoToken] = useState(null);
  const [undoLabel, setUndoLabel] = useState("");
  const [undoItem, setUndoItem] = useState(null);
  const [undoBusy, setUndoBusy] = useState(false);

  // Auto-clear the undo offer after 30s (the convenience window; the real
  // safety is the fingerprint guard, which catches divergence regardless of
  // elapsed time).
  useEffect(() => {
    if (!undoToken) return;
    const t = setTimeout(() => { setUndoToken(null); setUndoLabel(""); setUndoItem(null); }, 30000);
    return () => clearTimeout(t);
  }, [undoToken]);

  // Helper used by every successful action handler to register the undo
  // offer. Stores token + label + the original row so undo can restore it.
  const offerUndo = useCallback((token, label, itemRow) => {
    setUndoToken(token);
    setUndoLabel(label);
    setUndoItem(itemRow);
  }, []);

  async function handleUndoClick() {
    if (!undoToken || undoBusy) return;
    setUndoBusy(true);
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo-action", token: undoToken }),
      });
      const json = await res.json();
      if (json.success) {
        if (undoItem) setItems((prev) => [undoItem, ...prev]);
        // Walk back session counters.
        if (undoToken.type === "skip") setSessionStats((s) => ({ ...s, skipped: Math.max(0, s.skipped - 1) }));
        else                            setSessionStats((s) => ({ ...s, resolved: Math.max(0, s.resolved - 1) }));
        showToast?.("Undone", "success");
        setUndoToken(null); setUndoLabel(""); setUndoItem(null);
      } else {
        showToast?.(json.error || "Undo failed", "error");
      }
    } catch (e) {
      showToast?.("Network error", "error");
    } finally {
      setUndoBusy(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ action: "review-queue" });
      if (filterAccount) qs.set("account", filterAccount);
      if (filterReason)  qs.set("reason",  filterReason);
      if (filterVendor)  qs.set("vendor",  filterVendor);
      const res = await fetch(`/api/ops/inventory?${qs.toString()}`);
      const json = await res.json();
      if (json.success) setItems(json.items || []);
      else { setError(json.error || "Load failed"); showToast?.(json.error || "Load failed", "error"); }
    } catch (e) {
      setError(e.message);
      showToast?.("Network error", "error");
    } finally {
      setLoading(false);
    }
  }, [filterAccount, filterReason, filterVendor, showToast]);

  useEffect(() => { load(); }, [load]);

  // Build filter dropdown options from the loaded set so the operator can
  // see only the values that actually appear.
  const accountOptions = useMemo(() => [...new Set(items.map((i) => i.account))].filter(Boolean).sort(), [items]);
  const reasonOptions  = useMemo(() => [...new Set(items.map((i) => i.reason))].filter(Boolean).sort(),  [items]);
  const vendorOptions  = useMemo(() => [...new Set(items.map((i) => i.vendor))].filter(Boolean).sort(),  [items]);

  // Server already filters; we re-filter client-side only when the user
  // changes the dropdown without re-fetching (snappier UX).
  const visibleItems = useMemo(() => {
    const filtered = items.filter((it) =>
      (!filterAccount || it.account === filterAccount) &&
      (!filterReason  || it.reason  === filterReason)  &&
      (!filterVendor  || it.vendor  === filterVendor)
    );
    if (sortBy === "default") return filtered;
    const REASON_RANK = { arithmetic_fail: 0, low_match_confidence: 1, possible_new: 2, "": 3, overcount_suspect_reextract: 4 };
    const cmp = (a, b) => {
      if (sortBy === "vendor")     return (a.vendor || "").localeCompare(b.vendor || "");
      if (sortBy === "reason")     return (REASON_RANK[a.reason] ?? 9) - (REASON_RANK[b.reason] ?? 9);
      if (sortBy === "confidence") return (Number(a.confidence) || 0) - (Number(b.confidence) || 0);  // lowest first = most attention
      return 0;
    };
    return [...filtered].sort(cmp);
  }, [items, filterAccount, filterReason, filterVendor, sortBy]);

  const totals = useMemo(() => {
    const b = bucketCounts(items);
    return {
      all:          items.length,
      inlineQty:    b.inlineQty,
      matchConfirm: b.matchConfirm,
      skipOnly:     b.skipOnly,
      filtered:     visibleItems.length,
    };
  }, [items, visibleItems]);

  async function handleResolve(input) {
    setBusyQueueId(input.queueId);
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve-queue", ...input }),
      });
      const json = await res.json();
      if (json.success) {
        const itemRow = items.find((i) => i.queueId === input.queueId) || null;
        setItems((prev) => prev.filter((i) => i.queueId !== input.queueId));
        setSessionStats((s) => ({ ...s, resolved: s.resolved + 1 }));
        if (json.undo) offerUndo(json.undo, `Reconciled qty=${input.correctedQty}`, itemRow);
        showToast?.(`Resolved: qty=${input.correctedQty}`, "success");
        return null;
      }
      // Soft-check mismatch is a "not-yet-resolved" state, NOT an error -
      // the row itself shows the confirm UI. Pass it back to the row.
      if (json.error === "arithmetic_mismatch") {
        return json;
      }
      showToast?.(json.error || "Resolve failed", "error");
      return json;
    } catch (e) {
      showToast?.("Network error", "error");
      return { error: e.message };
    } finally {
      setBusyQueueId(null);
    }
  }

  async function handleSkip(input) {
    setBusyQueueId(input.queueId);
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "skip-queue", ...input }),
      });
      const json = await res.json();
      if (json.success) {
        const itemRow = items.find((i) => i.queueId === input.queueId) || null;
        setItems((prev) => prev.filter((i) => i.queueId !== input.queueId));
        setSessionStats((s) => ({ ...s, skipped: s.skipped + 1 }));
        if (json.undo) offerUndo(json.undo, `Skipped`, itemRow);
        showToast?.("Skipped", "success");
        return null;
      }
      showToast?.(json.error || "Skip failed", "error");
      return json;
    } catch (e) {
      showToast?.("Network error", "error");
      return { error: e.message };
    } finally {
      setBusyQueueId(null);
    }
  }

  // PR B commit 2/3: Match-Confirm POST. Body shape:
  //   { queueId, itemId, source: "accept_suggested" | "manual_pick" }
  // The modal calls this with itemId set (either suggestedMatchId on Accept,
  // or operator's pick from the inline catalog search).
  async function handleResolveMatch(input) {
    setBusyQueueId(input.queueId);
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve-queue-match", ...input }),
      });
      const json = await res.json();
      if (json.success) {
        const itemRow = items.find((i) => i.queueId === input.queueId) || null;
        setItems((prev) => prev.filter((i) => i.queueId !== input.queueId));
        setSessionStats((s) => ({ ...s, resolved: s.resolved + 1 }));
        if (json.undo) offerUndo(json.undo, `Matched to catalog`, itemRow);
        showToast?.(`Matched to catalog`, "success");
        return null;
      }
      showToast?.(json.error || "Match failed", "error");
      return json;
    } catch (e) {
      showToast?.("Network error", "error");
      return { error: e.message };
    } finally {
      setBusyQueueId(null);
    }
  }

  // PR B commit 4: bulk-skip-by-filter. Operator selects rows (checkboxes
  // in each row + master "select all visible") then clicks "Skip N selected".
  // POSTs the queueId array; server loops the REAL skipReviewQueueLine per
  // row (so every guard fires) and returns per-row results. Partial success:
  // successful rows are removed from the list; failed rows stay visible and
  // the toast surfaces the count + first failure reason.
  function toggleSelect(queueId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(queueId)) next.delete(queueId); else next.add(queueId);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(visibleItems.map((i) => i.queueId)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleBulkSkip() {
    if (selectedIds.size === 0 || bulkBusy) return;
    const queueIds = [...selectedIds];
    setBulkBusy(true);
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk-skip-queue", queueIds }),
      });
      const json = await res.json();
      if (!json.success) {
        showToast?.(json.error || "Bulk skip failed", "error");
        return;
      }
      const succeededIds = new Set((json.results || []).filter((r) => r.success).map((r) => r.queueId));
      const failedRows   = (json.results || []).filter((r) => !r.success);
      setItems((prev) => prev.filter((i) => !succeededIds.has(i.queueId)));
      setSessionStats((s) => ({ ...s, skipped: s.skipped + succeededIds.size }));
      // Clear selection of succeeded rows; keep failed rows selected so the
      // operator sees what's still here.
      setSelectedIds((prev) => {
        const next = new Set();
        for (const id of prev) if (!succeededIds.has(id)) next.add(id);
        return next;
      });
      if (failedRows.length === 0) {
        showToast?.(`Skipped ${json.successCount} line(s)`, "success");
      } else {
        const firstReason = failedRows[0]?.error || "unknown";
        showToast?.(`Skipped ${json.successCount} of ${queueIds.length}. ${json.failCount} failed - first reason: ${firstReason}`, "warning");
      }
    } catch (e) {
      showToast?.(`Network error: ${e.message}`, "error");
    } finally {
      setBulkBusy(false);
    }
  }

  // PR B commit 3: Create-new-from-queue POST. Body shape:
  //   { queueId, name, category, unit }
  // Creates the catalog item (reusing the existing createInventoryItem with
  // skipPriceHistory=true to suppress the generic manual-add row) + appends
  // the ONE invoiceUuid-tied price_history row + alias + queue flip.
  async function handleResolveCreate(input) {
    setBusyQueueId(input.queueId);
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve-queue-create", ...input }),
      });
      const json = await res.json();
      if (json.success) {
        setItems((prev) => prev.filter((i) => i.queueId !== input.queueId));
        setSessionStats((s) => ({ ...s, resolved: s.resolved + 1, created: s.created + 1 }));
        // PR B commit 6: Create-new is EXCLUDED from undo (per design). The
        // new catalog row may already be referenced by other processes -
        // archive-via-Item-Catalog is the clean recovery path.
        showToast?.(`Catalog item created: ${json.name} (use Item Catalog to archive if needed - undo not supported)`, "success");
        return null;
      }
      showToast?.(json.error || "Create failed", "error");
      return json;
    } catch (e) {
      showToast?.("Network error", "error");
      return { error: e.message };
    } finally {
      setBusyQueueId(null);
    }
  }

  return (
    <div className="oh-rq-screen">
      <div className="oh-rq-header">
        <button className="oh-inv-mgmt-back" onClick={onBack}>← Back</button>
        <h2 className="oh-rq-title">Review Queue</h2>
        <button className="oh-rq-refresh" onClick={load} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      <div className="oh-rq-stats">
        <span><strong>{totals.all}</strong> pending</span>
        <span className="oh-rq-stats-sep">·</span>
        <span><strong>{totals.inlineQty}</strong> math fails</span>
        <span className="oh-rq-stats-sep">·</span>
        <span><strong>{totals.matchConfirm}</strong> match-confirm</span>
        <span className="oh-rq-stats-sep">·</span>
        <span><strong>{totals.skipOnly}</strong> skip-only</span>
        {totals.filtered !== totals.all
          ? <><span className="oh-rq-stats-sep">·</span><span>{totals.filtered} visible</span></>
          : null
        }
        {selectedIds.size === 0 && visibleItems.length > 0
          ? <><span className="oh-rq-stats-sep">·</span><button onClick={selectAllVisible} style={bulkLinkInlineStyle}>Select all visible</button></>
          : null
        }
        {(sessionStats.resolved + sessionStats.skipped) > 0 ? (
          <><span className="oh-rq-stats-sep">·</span>
            <span style={sessionPillStyle} title={`This session: ${sessionStats.resolved} resolved (${sessionStats.created} created new), ${sessionStats.skipped} skipped`}>
              session: <strong>{sessionStats.resolved}</strong> resolved · <strong>{sessionStats.skipped}</strong> skipped
            </span>
          </>
        ) : null}
      </div>

      {undoToken ? (
        <div style={undoBannerStyle}>
          <span>{undoLabel} - changed your mind?</span>
          <button onClick={handleUndoClick} disabled={undoBusy} style={undoBtnStyle}>
            {undoBusy ? "Undoing..." : "Undo"}
          </button>
          <span style={{ color: "#64748b", fontSize: 11 }}>(auto-clears in 30s)</span>
        </div>
      ) : null}

      {selectedIds.size > 0 ? (
        <div style={bulkBarStyle}>
          <span style={{ fontWeight: 600 }}>{selectedIds.size} selected</span>
          <button onClick={handleBulkSkip} disabled={bulkBusy} style={bulkSkipBtnStyle}>
            {bulkBusy ? "Skipping..." : `Skip ${selectedIds.size} selected`}
          </button>
          <button onClick={selectAllVisible} disabled={bulkBusy} style={bulkLinkStyle}>
            Select all visible ({visibleItems.length})
          </button>
          <button onClick={clearSelection} disabled={bulkBusy} style={bulkLinkStyle}>
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="oh-rq-filters">
        <label>
          Account
          <select value={filterAccount} onChange={(e) => setFilterAccount(e.target.value)}>
            <option value="">All ({accountOptions.length})</option>
            {accountOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>
          Reason
          <select value={filterReason} onChange={(e) => setFilterReason(e.target.value)}>
            <option value="">All</option>
            {reasonOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>
          Vendor
          <select value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)}>
            <option value="">All ({vendorOptions.length})</option>
            {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label>
          Sort
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="default">Default</option>
            <option value="vendor">Vendor (A-Z)</option>
            <option value="reason">Reason (math first)</option>
            <option value="confidence">Confidence (lowest first)</option>
          </select>
        </label>
        {filterAccount || filterReason || filterVendor || sortBy !== "default"
          ? <button className="oh-rq-clear" onClick={() => { setFilterAccount(""); setFilterReason(""); setFilterVendor(""); setSortBy("default"); }}>Clear filters</button>
          : null
        }
      </div>

      {error ? <div className="oh-rq-error">Error: {error}</div> : null}
      {loading ? <div className="oh-rq-loading">Loading review queue…</div> : null}

      {matchModalItem ? (
        <ReviewQueueResolveModal
          item={matchModalItem}
          onClose={() => setMatchModalItem(null)}
          onResolveMatch={handleResolveMatch}
          onResolveCreate={handleResolveCreate}
          onSkip={handleSkip}
        />
      ) : null}

      {!loading && visibleItems.length === 0
        ? <div className="oh-rq-empty">{items.length === 0 ? "No pending review_queue lines." : "No lines match the active filters."}</div>
        : (
          <div className="oh-rq-list">
            {visibleItems.map((it) => (
              <ReviewQueueRow
                key={it.queueId}
                item={it}
                onResolve={handleResolve}
                onSkip={handleSkip}
                onOpenMatchModal={setMatchModalItem}
                onQuickAccept={(item) => handleResolveMatch({ queueId: item.queueId, itemId: item.suggestedMatchId, source: "accept_suggested" })}
                onToggleSelect={toggleSelect}
                selected={selectedIds.has(it.queueId)}
                busy={busyQueueId === it.queueId || bulkBusy}
              />
            ))}
          </div>
        )
      }
    </div>
  );
}

const bulkBarStyle = {
  display: "flex", alignItems: "center", gap: 12,
  background: "#fef3c7", border: "1px solid #fde68a",
  borderRadius: 6, padding: "10px 14px", margin: "10px 0", fontSize: 14, color: "#92400e",
};
const bulkSkipBtnStyle = {
  background: "#dc2626", color: "#fff", border: "none", borderRadius: 6,
  padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const bulkLinkStyle = {
  background: "transparent", border: "none", color: "#92400e",
  textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 13,
};
const bulkLinkInlineStyle = {
  background: "transparent", border: "none", color: "#2563eb",
  textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: 13,
};
const sessionPillStyle = {
  background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0",
  borderRadius: 4, padding: "2px 8px", fontSize: 12,
};
const undoBannerStyle = {
  display: "flex", alignItems: "center", gap: 10,
  background: "#e0f2fe", color: "#0c4a6e", border: "1px solid #bae6fd",
  borderRadius: 6, padding: "8px 12px", margin: "8px 0", fontSize: 13,
};
const undoBtnStyle = {
  background: "#0284c7", color: "#fff", border: "none", borderRadius: 4,
  padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
};

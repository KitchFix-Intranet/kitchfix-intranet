"use client";
// PR B-1: Review Queue dashboard. Top-level screen inside InventoryManager.
// Lists held lines, filters by account/reason/vendor, fires resolve + skip
// against /api/ops/inventory. B-2 adds: low_match_confidence catalog match
// modal + Resolved tab/history view.

import { useState, useEffect, useMemo, useCallback } from "react";
import ReviewQueueRow from "./ReviewQueueRow";

export default function ReviewQueueScreen({ showToast, onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterAccount, setFilterAccount] = useState("");
  const [filterReason, setFilterReason]   = useState("");
  const [filterVendor, setFilterVendor]   = useState("");
  const [busyQueueId, setBusyQueueId]     = useState(null);

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
  const visibleItems = useMemo(() => items.filter((it) =>
    (!filterAccount || it.account === filterAccount) &&
    (!filterReason  || it.reason  === filterReason)  &&
    (!filterVendor  || it.vendor  === filterVendor)
  ), [items, filterAccount, filterReason, filterVendor]);

  const totals = useMemo(() => ({
    all:           items.length,
    arithmetic:    items.filter((i) => i.reason === "arithmetic_fail").length,
    lowMatch:      items.filter((i) => i.reason === "low_match_confidence").length,
    filtered:      visibleItems.length,
  }), [items, visibleItems]);

  async function handleResolve(input) {
    setBusyQueueId(input.queueId);
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve-queue", ...input }),
      });
      const json = await res.json();
      if (json.success) {
        // Remove the resolved item from the visible list. No reload - the
        // server side handles dedup; this is just UI continuity.
        setItems((prev) => prev.filter((i) => i.queueId !== input.queueId));
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
        setItems((prev) => prev.filter((i) => i.queueId !== input.queueId));
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
        <span><strong>{totals.arithmetic}</strong> arithmetic_fail</span>
        <span className="oh-rq-stats-sep">·</span>
        <span><strong>{totals.lowMatch}</strong> low_match_confidence</span>
        {totals.filtered !== totals.all
          ? <><span className="oh-rq-stats-sep">·</span><span>{totals.filtered} visible</span></>
          : null
        }
      </div>

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
        {filterAccount || filterReason || filterVendor
          ? <button className="oh-rq-clear" onClick={() => { setFilterAccount(""); setFilterReason(""); setFilterVendor(""); }}>Clear filters</button>
          : null
        }
      </div>

      {error ? <div className="oh-rq-error">Error: {error}</div> : null}
      {loading ? <div className="oh-rq-loading">Loading review queue…</div> : null}

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
                busy={busyQueueId === it.queueId}
              />
            ))}
          </div>
        )
      }
    </div>
  );
}

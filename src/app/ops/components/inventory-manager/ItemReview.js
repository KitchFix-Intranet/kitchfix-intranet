"use client";
import { useState, useMemo, useRef, useEffect } from "react";

const I = ({ d, size = 16, color = "#64748b", sw = 2, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display:"inline-block", verticalAlign:"middle", flexShrink:0, ...style }}>
    {Array.isArray(d) ? d.map((p,i) => <path key={i} d={p}/>) : <path d={d}/>}
  </svg>
);
const ico = {
  check:"M20 6L9 17l-5-5",
  sparkle:["M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z"],
  clock:["M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z","M12 6v6l4 2"],
  refresh:["M23 4v6h-6","M1 20v-6h6","M3.51 9a9 9 0 0114.85-3.36L23 10","M1 14l4.64 4.36A9 9 0 0020.49 15"],
  gear:["M12 15a3 3 0 100-6 3 3 0 000 6z","M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"],
};
const fmt = n => "$" + Number(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",");

// #1: Rotating tips
const TIPS = [
  "Tip: Count inventory at the same time each period for consistency.",
  "Items are auto-imported from invoices — no manual data entry needed.",
  "The AI learns from your merge decisions and gets smarter over time.",
  "Merging duplicates keeps your count sheets clean and accurate.",
  "Price history is preserved when items are merged — nothing is lost.",
  "After review, use Product Placement to organize items into zones.",
  "Your vendors may spell items differently — AI catches those patterns.",
  "Consistent item names help track price changes across vendors.",
];

export default function ItemReview({ catalogItems, locations, account, onComplete, onGoToPlacement, showToast }) {
  const [phase, setPhase] = useState("idle");
  const [groups, setGroups] = useState([]);
  const [resolvedGroups, setResolvedGroups] = useState(new Set());
  const [editingGroup, setEditingGroup] = useState(null); // groupId for merge preview
  const [separatingGroup, setSeparatingGroup] = useState(null); // groupId for keep-separate edit
  const [separateNames, setSeparateNames] = useState({}); // { itemId: editedName }
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [mergeLog, setMergeLog] = useState([]);
  const startCount = useRef(null);
  // #1: rotating tip
  const [tipIdx, setTipIdx] = useState(0);
  // #4: merge toast
  const [mergeToast, setMergeToast] = useState(null);
  // #5: bulk merge state
  const [bulkMerging, setBulkMerging] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, currentName: "" });

  const pendingItems = useMemo(() =>
    catalogItems.filter(i => !i.reviewStatus || i.reviewStatus === "pending_review"),
  [catalogItems]);

  if (startCount.current === null) startCount.current = catalogItems.length;

  // #1: Rotate tips during scanning
  useEffect(() => {
    if (phase !== "scanning") return;
    const interval = setInterval(() => setTipIdx(i => (i + 1) % TIPS.length), 3500);
    return () => clearInterval(interval);
  }, [phase]);

  // #4: Auto-clear merge toast
  useEffect(() => {
    if (!mergeToast) return;
    const t = setTimeout(() => setMergeToast(null), 2500);
    return () => clearTimeout(t);
  }, [mergeToast]);

  // ── Run AI scan ──
  const runScan = async () => {
    setPhase("scanning");
    setEditingGroup(null);
    setTipIdx(0);
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ai-similarity-check", account }),
      });
      const data = await res.json();
      if (data.success && data.groups?.length > 0) {
        setGroups(data.groups);
        setResolvedGroups(new Set());
        setPhase("flags");
      } else if (data.success) {
        setGroups([]);
        setPhase("done");
      } else {
        showToast?.(data.error || "Scan failed", "error");
        setPhase("idle");
      }
    } catch {
      showToast?.("Network error — try again in a moment", "error");
      setPhase("idle");
    }
  };

  // ── Enrich group items with catalog data ──
  const enrich = (group) => group.items.map(gi => {
    const cat = catalogItems.find(c => c.itemId === gi.itemId);
    return { ...gi, price: cat?.lastPrice || 0, unit: cat?.unit || "EA", category: cat?.category || "Food", locationId: cat?.locationId || "" };
  });
  const findKeeper = (enriched) => {
    const idx = enriched.findIndex(i => i.locationId);
    return idx >= 0 ? idx : 0;
  };

  // ── Merge a group ──
  const mergeGroup = async (group, name) => {
    const enriched = enrich(group);
    const keeperIdx = findKeeper(enriched);
    const keeperId = enriched[keeperIdx].itemId;
    const mergedIds = enriched.filter((_, i) => i !== keeperIdx).map(i => i.itemId);

    setSaving(true);
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge-items", account, keeperItemId: keeperId,
          mergedItemIds: mergedIds, canonicalName: name || group.suggestedName,
          category: group.suggestedCategory, unit: group.suggestedUnit,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResolvedGroups(prev => new Set(prev).add(group.groupId));
        setMergeLog(prev => [...prev, { name: name || group.suggestedName, count: group.items.length, time: new Date() }]);
        // #4: animated toast
        setMergeToast(`"${name || group.suggestedName}" — ${mergedIds.length} duplicate${mergedIds.length !== 1 ? "s" : ""} merged`);
      } else showToast?.(data.error || "Merge failed", "error");
    } catch { showToast?.("Network error", "error"); }
    finally { setSaving(false); setEditingGroup(null); }
  };

  // ── Keep separate (with optional name edits) ──
  const keepSeparate = async (group) => {
    setSaving(true);
    try {
      // Save any name edits first
      const nameEdits = Object.entries(separateNames).filter(([id, name]) => {
        const orig = group.items.find(i => i.itemId === id);
        return orig && name.trim() && name.trim() !== orig.name;
      });
      for (const [itemId, newName] of nameEdits) {
        await fetch("/api/ops/inventory", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "review-accept", account, itemId, name: newName.trim() }),
        });
      }
      // Log keep-separate decision with item names
      const itemNames = group.items.map(i => separateNames[i.itemId] || i.name);
      await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "keep-separate", account, itemIds: group.items.map(i => i.itemId), itemNames }),
      });
      setResolvedGroups(prev => new Set(prev).add(group.groupId));
      const renamed = nameEdits.length;
      showToast?.(renamed > 0 ? `Kept separate · ${renamed} item${renamed !== 1 ? "s" : ""} renamed` : "Marked as separate items", "info");
    } catch { showToast?.("Network error", "error"); }
    finally { setSaving(false); setSeparatingGroup(null); setSeparateNames({}); }
  };

  // #5: Bulk merge with progress
  const acceptAllHigh = async () => {
    const highGroups = activeGroups.filter(g => g.confidence >= 95);
    if (highGroups.length === 0) return;
    setBulkMerging(true);
    setBulkProgress({ current: 0, total: highGroups.length, currentName: "" });
    let merged = 0;
    for (let i = 0; i < highGroups.length; i++) {
      const group = highGroups[i];
      setBulkProgress({ current: i + 1, total: highGroups.length, currentName: group.suggestedName });
      try {
        const enriched = enrich(group);
        const keeperIdx = findKeeper(enriched);
        const keeperId = enriched[keeperIdx].itemId;
        const mergedIds = enriched.filter((_, j) => j !== keeperIdx).map(x => x.itemId);
        const res = await fetch("/api/ops/inventory", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "merge-items", account, keeperItemId: keeperId,
            mergedItemIds: mergedIds, canonicalName: group.suggestedName,
            category: group.suggestedCategory, unit: group.suggestedUnit,
          }),
        });
        const data = await res.json();
        if (data.success) {
          setResolvedGroups(prev => new Set(prev).add(group.groupId));
          setMergeLog(prev => [...prev, { name: group.suggestedName, count: group.items.length, time: new Date() }]);
          merged++;
        }
      } catch { /* continue */ }
    }
    setBulkMerging(false);
    setMergeToast(`${merged} group${merged !== 1 ? "s" : ""} auto-merged`);
  };

  const activeGroups = groups.filter(g => !resolvedGroups.has(g.groupId));
  const highConfCount = activeGroups.filter(g => g.confidence >= 95).length;
  const totalGroups = groups.length;
  const resolvedCount = resolvedGroups.size;
  const progressPct = totalGroups > 0 ? Math.round((resolvedCount / totalGroups) * 100) : 0;
  const totalItemsMerged = mergeLog.reduce((sum, m) => sum + (m.count - 1), 0);

  // ── Merge toast overlay (#4) ──
  const MergeToastEl = mergeToast ? (
    <div className="ir-merge-toast">
      <I d={ico.check} size={16} color="#fff" sw={3}/> {mergeToast}
    </div>
  ) : null;

  // ═══════════════════════════
  // IDLE
  // ═══════════════════════════
  if (phase === "idle") {
    return (
      <div className="ir-root">
        <div className="ir-card">
          <div className="ir-card-header">
            <I d={ico.sparkle} size={24} color="#d97706" sw={1.5}/>
            <div>
              <h3 className="ir-title">Item Review</h3>
              <p className="ir-sub">{catalogItems.length} items in catalog{pendingItems.length > 0 ? ` · ${pendingItems.length} pending review` : ""}</p>
            </div>
          </div>
          <div className="ir-landing-body">
            <p className="ir-landing-desc">AI will scan your catalog for duplicates and similar items that can be merged. Then you'll review any new imports.</p>
            <button className="ir-scan-btn" onClick={runScan}>
              <I d={ico.sparkle} size={16} color="#fff" sw={2}/> Start Review
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════
  // SCANNING (#1: rotating tips)
  // ═══════════════════════════
  if (phase === "scanning") {
    return (
      <div className="ir-root">
        <div className="ir-card">
          <div className="ir-scanning">
            <div className="ir-spinner"/>
            <h3>Scanning catalog...</h3>
            <p className="ir-scan-sub">AI is checking {catalogItems.length} items for duplicates</p>
            <div className="ir-tip-wrap">
              <p className="ir-tip" key={tipIdx}>{TIPS[tipIdx]}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════
  // FLAGS
  // ═══════════════════════════
  if (phase === "flags") {
    return (
      <div className="ir-root">
        {MergeToastEl}
        <div className="ir-card">
          {/* #2: header flush — no top border-radius on inner content */}
          <div className="ir-flags-header">
            <h3 className="ir-title">Similar Items Found</h3>
            <p className="ir-sub">{activeGroups.length} remaining · {resolvedCount} of {totalGroups} reviewed</p>
          </div>

          {/* Progress bar */}
          {totalGroups > 0 && (
            <div className="ir-progress"><div className="ir-progress-bar" style={{width:`${progressPct}%`}}/></div>
          )}

          {/* #5: Bulk merge bar with details */}
          {!bulkMerging && highConfCount >= 2 && (
            <div className="ir-bulk-bar">
              <span className="ir-bulk-text">{highConfCount} groups at 95%+ confidence</span>
              <button className="ir-bulk-btn" onClick={acceptAllHigh}>Accept All {highConfCount}</button>
            </div>
          )}
          {bulkMerging && (
            <div className="ir-bulk-bar ir-bulk-bar--active">
              <div className="ir-bulk-progress">
                <div className="ir-spinner-sm"/>
                <div className="ir-bulk-detail">
                  <span className="ir-bulk-text">Merging {bulkProgress.current} of {bulkProgress.total}...</span>
                  <span className="ir-bulk-current">{bulkProgress.currentName}</span>
                </div>
              </div>
              <button className="ir-bulk-cancel" onClick={() => setBulkMerging(false)}>Stop</button>
            </div>
          )}

          {activeGroups.length === 0 ? (
            <div className="ir-all-done">
              <div className="ir-check-anim"><I d={ico.check} size={32} color="#fff" sw={3}/></div>
              <h3>All groups reviewed!</h3>
              {totalItemsMerged > 0 && <p className="ir-done-stat">{totalItemsMerged} duplicate{totalItemsMerged !== 1 ? "s" : ""} merged</p>}
              <div className="ir-done-actions">
                <button className="ir-rescan-btn" onClick={() => onComplete?.()}>
                  <I d={ico.gear} size={14} color="#64748b"/> Back to Manage
                </button>
                <button className="ir-next-btn" onClick={() => onGoToPlacement?.()}>
                  Product Placement →
                </button>
              </div>
            </div>
          ) : (
            <div className="ir-groups">
              {activeGroups.map(group => {
                const isPreview = editingGroup === group.groupId;
                const isSeparating = separatingGroup === group.groupId;
                const enriched = enrich(group);
                const keeperIdx = findKeeper(enriched);
                const isExpanded = isPreview || isSeparating;

                return (
                  <div key={group.groupId} className={`ir-group${group.confidence >= 90 ? " ir-group--high" : " ir-group--med"}${isExpanded ? " ir-group--preview" : ""}`}>
                    <div className="ir-group-top">
                      <span className={`ir-group-conf${group.confidence >= 90 ? " high" : " med"}`}>{group.confidence}%</span>
                      <span className="ir-group-reason">{group.reason}</span>
                    </div>

                    {/* ── Collapsed view ── */}
                    {!isExpanded && (<>
                      <div className="ir-group-suggested"><span className="ir-group-name">{group.suggestedName}</span></div>
                      <div className="ir-group-items">
                        {enriched.map(item => (
                          <div key={item.itemId} className="ir-group-item">
                            <span className="ir-group-item-name">{item.name}</span>
                            <div className="ir-group-item-right">
                              {item.price > 0 && <span className="ir-group-item-price">{fmt(item.price)}</span>}
                              <span className="ir-group-item-vendor">{item.vendor}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="ir-group-actions">
                        <button className="ir-btn ir-btn--primary" onClick={() => { setEditingGroup(group.groupId); setSeparatingGroup(null); setEditName(group.suggestedName); }} disabled={saving}>
                          Review &amp; Merge
                        </button>
                        <button className="ir-btn ir-btn--ghost" onClick={() => {
                          setSeparatingGroup(group.groupId); setEditingGroup(null);
                          const names = {}; enriched.forEach(i => { names[i.itemId] = i.name; }); setSeparateNames(names);
                        }} disabled={saving}>Keep Separate</button>
                      </div>
                    </>)}

                    {/* ── Merge preview ── */}
                    {isPreview && (
                      <div className="ir-preview">
                        <div className="ir-preview-section">
                          <span className="ir-preview-label">Merged name</span>
                          <input className="ir-group-name-input" value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") mergeGroup(group, editName); }} autoFocus/>
                        </div>
                        <div className="ir-preview-section">
                          <span className="ir-preview-label">Items being merged</span>
                          <div className="ir-preview-items">
                            {enriched.map((item, idx) => (
                              <div key={item.itemId} className={`ir-preview-item${idx === keeperIdx ? " ir-preview-item--keeper" : ""}`}>
                                <div className="ir-preview-item-top">
                                  {idx === keeperIdx ? <span className="ir-preview-keeper-badge">keeping</span>
                                    : <span className="ir-preview-deactivate-badge">deactivating</span>}
                                </div>
                                <span className="ir-preview-item-name">{item.name}</span>
                                <div className="ir-preview-item-meta">
                                  <span>{item.vendor}</span>
                                  {item.price > 0 && <span>{fmt(item.price)} / {item.unit}</span>}
                                  <span>{item.category}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="ir-preview-summary">
                          These are the same item spelled differently. Merging keeps one clean entry and links all vendor names so future invoices match automatically.
                        </div>
                        <div className="ir-group-actions">
                          <button className="ir-btn ir-btn--primary" onClick={() => mergeGroup(group, editName)} disabled={saving}>
                            {saving ? "Merging..." : "Confirm Merge"}
                          </button>
                          <button className="ir-btn ir-btn--ghost" onClick={() => setEditingGroup(null)}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* ── Keep separate with rename ── */}
                    {isSeparating && (
                      <div className="ir-preview">
                        <div className="ir-preview-section">
                          <span className="ir-preview-label">These are different items — edit names if needed</span>
                          <div className="ir-preview-items">
                            {enriched.map(item => (
                              <div key={item.itemId} className="ir-preview-item ir-preview-item--separate">
                                <input className="ir-separate-name-input" value={separateNames[item.itemId] || item.name}
                                  onChange={e => setSeparateNames(prev => ({ ...prev, [item.itemId]: e.target.value }))}/>
                                <div className="ir-preview-item-meta">
                                  <span>{item.vendor}</span>
                                  {item.price > 0 && <span>{fmt(item.price)} / {item.unit}</span>}
                                  <span>{item.category}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="ir-preview-summary">
                          AI won't flag these as duplicates again. Any name changes will be saved to your catalog.
                        </div>
                        <div className="ir-group-actions">
                          <button className="ir-btn ir-btn--primary" onClick={() => keepSeparate(group)} disabled={saving}>
                            {saving ? "Saving..." : "Confirm Separate"}
                          </button>
                          <button className="ir-btn ir-btn--ghost" onClick={() => setSeparatingGroup(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeGroups.length > 0 && (
            <div className="ir-skip-row">
              <button className="ir-skip-btn" onClick={() => setPhase(pendingItems.length > 0 ? "queue" : "done")}>
                Skip remaining → {pendingItems.length > 0 ? "Review new items" : "Done"}
              </button>
            </div>
          )}

          {mergeLog.length > 0 && (
            <div className="ir-history-section">
              <button className="ir-history-toggle" onClick={() => setShowHistory(!showHistory)}>
                <I d={ico.clock} size={13} color="#94a3b8"/> {showHistory ? "Hide" : "View"} merge history ({mergeLog.length})
              </button>
              {showHistory && (
                <div className="ir-history-list">
                  {mergeLog.map((m, i) => (
                    <div key={i} className="ir-history-item">
                      <span className="ir-history-name">"{m.name}"</span>
                      <span className="ir-history-detail">{m.count} items merged · {m.time.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════
  // DONE
  // ═══════════════════════════
  if (phase === "done") {
    const delta = totalItemsMerged;
    return (
      <div className="ir-root">
        <div className="ir-card">
          <div className="ir-all-done">
            <div className="ir-check-anim"><I d={ico.check} size={32} color="#fff" sw={3}/></div>
            {delta > 0 ? (<>
              <h3>Review Complete</h3>
              <p className="ir-done-delta">
                Started with {startCount.current} items → now {startCount.current - delta} items.
                <br/><strong>{delta} duplicate{delta !== 1 ? "s" : ""} merged.</strong>
              </p>
            </>) : (<>
              <h3>Catalog is Clean</h3>
              <p className="ir-done-desc">No duplicates found. The system syncs your purchases nightly, so new items from invoices will appear here automatically. Check back weekly — or before you take inventory — to catch any duplicates early.</p>
            </>)}
            {resolvedCount > 0 && <p className="ir-done-stat">{resolvedCount} group{resolvedCount !== 1 ? "s" : ""} reviewed</p>}
            <div className="ir-done-actions">
              <button className="ir-rescan-btn" onClick={() => onComplete?.()}>
                <I d={ico.gear} size={14} color="#64748b"/> Back to Manage
              </button>
              <button className="ir-next-btn" onClick={() => onGoToPlacement?.()}>
                Product Placement →
              </button>
            </div>
            {mergeLog.length > 0 && (
              <div className="ir-history-section ir-history-section--done">
                <button className="ir-history-toggle" onClick={() => setShowHistory(!showHistory)}>
                  <I d={ico.clock} size={13} color="#94a3b8"/> {showHistory ? "Hide" : "View"} merge history ({mergeLog.length})
                </button>
                {showHistory && (
                  <div className="ir-history-list">
                    {mergeLog.map((m, i) => (
                      <div key={i} className="ir-history-item">
                        <span className="ir-history-name">"{m.name}"</span>
                        <span className="ir-history-detail">{m.count} items merged</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════
  // QUEUE
  // ═══════════════════════════
  return (
    <div className="ir-root">
      <div className="ir-card">
        <div className="ir-card-header">
          <div>
            <h3 className="ir-title">New Items</h3>
            <p className="ir-sub">{pendingItems.length} items imported — review and assign to zones</p>
          </div>
        </div>
        <div className="ir-all-done">
          <p>New item queue coming in the next build. For now, use Product Placement to assign items to zones.</p>
          <button className="ir-next-btn" onClick={() => setPhase("done")}>Continue</button>
        </div>
      </div>
    </div>
  );
}
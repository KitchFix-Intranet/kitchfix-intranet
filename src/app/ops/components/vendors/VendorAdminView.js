"use client";
import React, { useState, useEffect } from "react";

const CATEGORY_COLORS = {
  Produce:     "#16a34a", Protein:    "#dc2626", Dairy:      "#2563eb",
  "Dry Goods": "#d97706", Beverage:   "#7c3aed", Packaging:  "#0891b2",
  Cleaning:    "#0d9488", Supplies:   "#ca8a04", Equipment:  "#475569",
  Linen:       "#9d174d", Specialty:  "#db2777", Broadliner: "#9333ea",
  Other:       "#64748b",
};

const CATEGORIES = [
  "Produce","Protein","Dairy","Dry Goods","Beverage",
  "Packaging","Cleaning","Supplies","Equipment","Linen",
  "Specialty","Broadliner","Other",
];

// ── All Vendors Cross-Account Table ──────────────────────────────────────────
function AllVendorsTable({ showToast }) {
  const [vendors, setVendors]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [sortKey, setSortKey]     = useState("name");
  const [sortDir, setSortDir]     = useState("asc");
  const [editingId, setEditingId] = useState(null);  // vendorId being inline-edited
  const [editForm, setEditForm]   = useState({});
  const [saving, setSaving]       = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/ops?action=vendor-list&allAccounts=true&pageSize=500")
      .then((r) => r.json())
      .then((d) => { if (d.success) setVendors(d.vendors || []); })
      .catch(() => showToast("Failed to load vendors", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = vendors
    .filter((v) => {
      const q = search.toLowerCase();
      return !q || v.name?.toLowerCase().includes(q) || v.salesRepName?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const av = (a[sortKey] || "").toString().toLowerCase();
      const bv = (b[sortKey] || "").toString().toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span className="oh-vp-sort-neutral">⇅</span>;
    return <span className="oh-vp-sort-active">{sortDir === "asc" ? "↑" : "↓"}</span>;
  };

  const startEdit = (v) => {
    setEditingId(v.vendorId);
    setEditForm({ category: v.category || "", aliases: v.aliases || "" });
  };

  const cancelEdit = () => { setEditingId(null); setEditForm({}); };

  const saveEdit = async (v) => {
    setSaving(true);
    try {
      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:   "vendor-master-update",
          vendorId: v.vendorId,
          name:     v.name,
          category: editForm.category,
          website:  v.website || "",
          notes:    v.notes || "",
          aliases:  editForm.aliases,
        }),
      });
      const d = await res.json();
      if (d.success) {
        showToast(`${v.name} updated`, "success");
        setEditingId(null);
        load();
      } else {
        showToast(d.error || "Save failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="oh-vp-admin-loading"><span className="oh-spinner" /></div>;

  return (
    <div className="oh-vp-all-vendors">
      <div className="oh-vp-admin-header">
        <div className="oh-vp-admin-header-top">
          <span className="oh-vp-table-count">{vendors.length} vendors across all accounts</span>
        </div>
        <input
          type="text"
          className="oh-vp-table-search"
          placeholder="Search by name or rep…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && sorted.length !== vendors.length && (
          <p className="oh-vp-admin-results-hint">{sorted.length} result{sorted.length !== 1 ? "s" : ""} for "{search}"</p>
        )}
      </div>

      <div className="oh-vp-table-wrap">
        <table className="oh-vp-table">
          <thead>
            <tr>
              <th className="oh-vp-th oh-vp-th--sort" onClick={() => toggleSort("name")}>Name <SortIcon col="name" /></th>
              <th className="oh-vp-th oh-vp-th--sort" onClick={() => toggleSort("category")}>Category <SortIcon col="category" /></th>
              <th className="oh-vp-th">Aliases</th>
              <th className="oh-vp-th">Accounts</th>
              <th className="oh-vp-th oh-vp-th--sort" onClick={() => toggleSort("createdAt")}>Added <SortIcon col="createdAt" /></th>
              <th className="oh-vp-th" style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={6} className="oh-vp-td-empty">No vendors match your filters.</td></tr>
            )}
            {sorted.map((v) => {
              const color = CATEGORY_COLORS[v.category] || "#64748b";
              const isEditing = editingId === v.vendorId;
              return (
                <React.Fragment key={v.vendorId}>
                  <tr key={v.vendorId} className={`oh-vp-tr${!v.active ? " oh-vp-tr--inactive" : ""}${isEditing ? " oh-vp-tr--editing" : ""}`}>
                    <td className="oh-vp-td">
                      <span className="oh-vp-td-name">{v.name}</span>
                      {!v.active && <span className="oh-vp-chip oh-vp-chip--inactive">Inactive</span>}
                      <div className="oh-vp-td-id">ID: {v.vendorId}</div>
                    </td>
                    <td className="oh-vp-td">
                      {v.category ? (
                        <span className="oh-vp-td-cat">
                          <span className="oh-vp-td-cat-dot" style={{ background: color }} />
                          {v.category}
                        </span>
                      ) : <span className="oh-vp-td-missing">—</span>}
                    </td>
                    <td className="oh-vp-td oh-vp-td-aliases">
                      {v.aliases
                        ? <span className="oh-vp-td-aliases-text">{v.aliases}</span>
                        : <span className="oh-vp-td-missing">—</span>}
                    </td>
                    <td className="oh-vp-td">
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {(v.linkedAccounts || []).map((a) => (
                          <span key={a} className="oh-vp-chip oh-vp-chip--account">{a}</span>
                        ))}
                        {(!v.linkedAccounts || v.linkedAccounts.length === 0) && "—"}
                      </div>
                    </td>
                    <td className="oh-vp-td oh-vp-td-date">
                      {v.createdAt ? new Date(v.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="oh-vp-td">
                      {isEditing ? (
                        <button className="oh-vp-inline-edit-cancel" onClick={cancelEdit}>✕</button>
                      ) : (
                        <button className="oh-vp-inline-edit-btn" onClick={() => startEdit(v)}>Edit</button>
                      )}
                    </td>
                  </tr>

                  {/* Inline edit row */}
                  {isEditing && (
                    <tr key={`${v.vendorId}-edit`} className="oh-vp-tr-edit-panel">
                      <td colSpan={6} className="oh-vp-td-edit-panel">
                        <div className="oh-vp-edit-panel">
                          <div className="oh-vp-edit-panel-field">
                            <label className="oh-vp-edit-panel-label">Category</label>
                            <div className="oh-vp-cat-chip-row">
                              {CATEGORIES.map((c) => (
                                <button
                                  key={c}
                                  type="button"
                                  className={`oh-vp-cat-chip-sm${editForm.category === c ? " oh-vp-cat-chip-sm--active" : ""}`}
                                  style={editForm.category === c ? { background: (CATEGORY_COLORS[c] || "#64748b") + "20", borderColor: CATEGORY_COLORS[c] || "#64748b", color: CATEGORY_COLORS[c] || "#64748b" } : {}}
                                  onClick={() => setEditForm((f) => ({ ...f, category: c }))}
                                >
                                  {c}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="oh-vp-edit-panel-field">
                            <label className="oh-vp-edit-panel-label">
                              Aliases
                              <span className="oh-vp-edit-panel-hint">Pipe-separated alternate names used in invoice matching, e.g. "Freshpoint|FreshPoint Dallas"</span>
                            </label>
                            <input
                              type="text"
                              className="oh-input oh-vp-edit-panel-input"
                              value={editForm.aliases}
                              onChange={(e) => setEditForm((f) => ({ ...f, aliases: e.target.value }))}
                              placeholder="Alias One|Alias Two|Alias Three"
                            />
                          </div>
                          <div className="oh-vp-edit-panel-actions">
                            <button className="oh-btn oh-btn--ghost" onClick={cancelEdit}>Cancel</button>
                            <button
                              className="oh-btn oh-btn--mustard"
                              onClick={() => saveEdit(v)}
                              disabled={saving}
                            >
                              {saving ? "Saving…" : "Save Changes"}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── Duplicate Detector with Merge ─────────────────────────────────────────────
const dismissKey = (group) => group.map(v => v.vendorId).sort().join("|");
const DISMISS_STORAGE_KEY = "kf_vp_dismissed_dupes";
const getDismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISS_STORAGE_KEY) || "[]"); } catch { return []; } };
const saveDismissed = (list) => localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(list));

function DuplicateDetector({ showToast }) {
  const [vendors, setVendors]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [ran, setRan]               = useState(false);
  const [groups, setGroups]         = useState([]);
  const [dismissed, setDismissed]   = useState(() => getDismissed());
  const [merging, setMerging]       = useState(null);   // { groupIdx, keeperId }
  const [mergeWorking, setMergeWorking] = useState(false);

  const load = () => {
    fetch("/api/ops?action=vendor-list&allAccounts=true&pageSize=500")
      .then(r => r.json())
      .then(d => { if (d.success) setVendors(d.vendors || []); })
      .catch(() => showToast("Failed to load vendors", "error"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runScan = () => {
    const lev = (a, b) => {
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
            : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      return dp[m][n];
    };
    // Filter out soft-deleted vendors (blank name) before scanning
    const activeVendors = vendors.filter(v => v.name && v.name.trim().length > 0);
    const names = activeVendors.map(v => ({ ...v, norm: v.name.toLowerCase().replace(/[^a-z0-9]/g, "") }));
    const visited = new Set();
    const found = [];
    for (let i = 0; i < names.length; i++) {
      if (visited.has(names[i].vendorId)) continue;
      const cluster = [names[i]];
      for (let j = i + 1; j < names.length; j++) {
        if (visited.has(names[j].vendorId)) continue;
        const a = names[i].norm, b = names[j].norm;
        if (a === b || a.startsWith(b) || b.startsWith(a) || lev(a, b) <= 2) {
          cluster.push(names[j]); visited.add(names[j].vendorId);
        }
      }
      if (cluster.length > 1) { visited.add(names[i].vendorId); found.push(cluster); }
    }
    setGroups(found);
    setRan(true);
    setMerging(null);
  };

  const handleDismiss = (group) => {
    const key = dismissKey(group);
    const next = [...dismissed, key];
    setDismissed(next);
    saveDismissed(next);
    showToast("Group dismissed", "success");
  };

  const handleMerge = async (group) => {
    const keeper = group.find(v => v.vendorId === merging.keeperId);
    const dupes  = group.filter(v => v.vendorId !== merging.keeperId);
    if (!keeper || !dupes.length) return;

    setMergeWorking(true);
    try {
      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:   "vendor-merge",
          keeperId: keeper.vendorId,
          dupeIds:  dupes.map(d => d.vendorId),
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Merge failed");

      const aliasNote = data.aliasesAdded?.length
        ? ` · "${data.aliasesAdded.join(", ")}" added as alias`
        : "";
      showToast(`Merged into "${keeper.name}" · ${data.accountRowsReassigned} account link${data.accountRowsReassigned !== 1 ? "s" : ""} reassigned${aliasNote}`, "success");

      // Remove this group and refresh vendor list
      setGroups(g => g.filter((_, i) => i !== merging.groupIdx));
      setMerging(null);
      load();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setMergeWorking(false);
    }
  };

  const visibleGroups = groups.filter(g => !dismissed.includes(dismissKey(g)));

  if (loading) return <div className="oh-vp-admin-loading"><span className="oh-spinner" /></div>;

  return (
    <div className="oh-vp-dup-wrap">
      <div className="oh-vp-dup-intro">
        <div className="oh-vp-dup-intro-text">
          <strong>Duplicate Detector</strong>
          <span>Scans all vendor names for exact matches, partial overlaps, and close typos (within 2 characters).</span>
        </div>
        <button className="oh-btn oh-btn--mustard oh-vp-dup-scan-btn" onClick={runScan}>
          {ran ? "Re-scan" : "Run Scan"}
        </button>
      </div>

      {dismissed.length > 0 && (
        <p className="oh-vp-dup-dismissed-note">
          {dismissed.length} group{dismissed.length !== 1 ? "s" : ""} dismissed —{" "}
          <button className="oh-vp-dup-undo-link" onClick={() => { setDismissed([]); saveDismissed([]); }}>
            clear all dismissals
          </button>
        </p>
      )}

      {ran && visibleGroups.length === 0 && (
        <div className="oh-vp-dup-clean">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>No duplicates found across {vendors.length} vendors.</span>
        </div>
      )}

      {ran && visibleGroups.length > 0 && (
        <>
          <p className="oh-vp-dup-summary">{visibleGroups.length} potential duplicate group{visibleGroups.length !== 1 ? "s" : ""} found</p>
          <div className="oh-vp-dup-groups">
            {visibleGroups.map((group, gi) => {
              const realIdx      = groups.indexOf(group);
              const isMergingThis = merging?.groupIdx === realIdx;
              const keeperV      = isMergingThis ? group.find(v => v.vendorId === merging.keeperId) : null;
              const dupeVs       = isMergingThis ? group.filter(v => v.vendorId !== merging.keeperId) : [];
              const totalAcctLinks = isMergingThis
                ? dupeVs.reduce((sum, v) => sum + (v.linkedAccounts?.length || 0), 0)
                : 0;

              return (
                <div key={gi} className={`oh-vp-dup-group${isMergingThis ? " oh-vp-dup-group--merging" : ""}`}>
                  {/* Group header */}
                  <div className="oh-vp-dup-group-header">
                    <span className="oh-vp-dup-group-label">Group {gi + 1}</span>
                    <div className="oh-vp-dup-group-actions">
                      {!isMergingThis ? (
                        <>
                          <button
                            className="oh-vp-dup-action-btn oh-vp-dup-action-btn--merge"
                            onClick={() => setMerging({ groupIdx: realIdx, keeperId: group[0].vendorId })}
                          >
                            Merge…
                          </button>
                          <button
                            className="oh-vp-dup-action-btn oh-vp-dup-action-btn--dismiss"
                            onClick={() => handleDismiss(group)}
                          >
                            Not a duplicate
                          </button>
                        </>
                      ) : (
                        <button
                          className="oh-vp-dup-action-btn oh-vp-dup-action-btn--dismiss"
                          onClick={() => setMerging(null)}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Vendor rows — clickable to select keeper when merging */}
                  {group.map(v => {
                    const color     = CATEGORY_COLORS[v.category] || "#64748b";
                    const isKeeper  = isMergingThis && merging.keeperId === v.vendorId;
                    const isDupe    = isMergingThis && merging.keeperId !== v.vendorId;
                    return (
                      <div
                        key={v.vendorId}
                        className={`oh-vp-dup-row${isKeeper ? " oh-vp-dup-row--keeper" : ""}${isDupe ? " oh-vp-dup-row--dupe" : ""}`}
                        onClick={isMergingThis ? () => setMerging(m => ({ ...m, keeperId: v.vendorId })) : undefined}
                        style={isMergingThis ? { cursor: "pointer" } : undefined}
                      >
                        {/* Keeper/dupe indicator */}
                        {isMergingThis && (
                          <div className="oh-vp-dup-row-indicator">
                            {isKeeper
                              ? <span className="oh-vp-dup-badge oh-vp-dup-badge--keep">Keep</span>
                              : <span className="oh-vp-dup-badge oh-vp-dup-badge--remove">Remove</span>
                            }
                          </div>
                        )}
                        <div className="oh-vp-dup-row-name">{v.name}</div>
                        {v.category && (
                          <span className="oh-vp-td-cat" style={{ fontSize: "0.78rem" }}>
                            <span className="oh-vp-td-cat-dot" style={{ background: color }} />
                            {v.category}
                          </span>
                        )}
                        <div className="oh-vp-dup-row-accounts">
                          {(v.linkedAccounts || []).map(a => (
                            <span key={a} className="oh-vp-chip oh-vp-chip--account">{a}</span>
                          ))}
                        </div>
                        <span className="oh-vp-dup-id">ID: {v.vendorId}</span>
                      </div>
                    );
                  })}

                  {/* Merge confirmation footer */}
                  {isMergingThis && keeperV && (
                    <div className="oh-vp-dup-merge-footer">
                      <div className="oh-vp-dup-merge-summary">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <span>
                          {totalAcctLinks > 0
                            ? <>{totalAcctLinks} account link{totalAcctLinks !== 1 ? "s" : ""} will move to <strong>{keeperV.name}</strong>. Removed names auto-added as aliases.</>
                            : <>No account links to reassign. <strong>{dupeVs.map(d => d.name).join(", ")}</strong> will be soft-deleted and added as alias.</>
                          }
                        </span>
                      </div>
                      <button
                        className="oh-btn oh-btn--mustard"
                        onClick={() => handleMerge(group)}
                        disabled={mergeWorking}
                        style={{ fontSize: "0.82rem", padding: "7px 18px", flexShrink: 0 }}
                      >
                        {mergeWorking ? "Merging…" : "Confirm Merge"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {!ran && (
        <div className="oh-vp-dup-idle">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <span>Run a scan to check for duplicates across {vendors.length} vendors.</span>
        </div>
      )}
    </div>
  );
}

// ── Main Admin View ───────────────────────────────────────────────────────────
export default function VendorAdminView({ isAdmin, showToast, openConfirm }) {
  if (!isAdmin) {
    return (
      <div className="oh-vp-admin-empty">
        <p>Admin access required.</p>
      </div>
    );
  }

  const [adminTab, setAdminTab] = useState("directory");

  return (
    <div className="oh-vp-admin">
      <div className="oh-vp-admin-tabs">
        <button
          className={`oh-vp-admin-tab${adminTab === "directory" ? " oh-vp-admin-tab--active" : ""}`}
          onClick={() => setAdminTab("directory")}
        >
          All Vendors
        </button>
        <button
          className={`oh-vp-admin-tab${adminTab === "dupes" ? " oh-vp-admin-tab--active" : ""}`}
          onClick={() => setAdminTab("dupes")}
        >
          Duplicate Detector
        </button>
      </div>

      {adminTab === "directory" && <AllVendorsTable showToast={showToast} />}
      {adminTab === "dupes"     && <DuplicateDetector showToast={showToast} />}
    </div>
  );
}
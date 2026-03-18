"use client";
import { useState, useEffect } from "react";

const CATEGORY_COLORS = {
  Produce:     "#16a34a", Protein:    "#dc2626", Dairy:      "#2563eb",
  "Dry Goods": "#d97706", Beverage:   "#7c3aed", Packaging:  "#0891b2",
  Cleaning:    "#0d9488", Equipment:  "#475569", Specialty:  "#db2777",
  Broadliner:  "#9333ea", Other:      "#64748b",
};

// ── All Vendors Cross-Account Table ──────────────────────────────────────────
function AllVendorsTable({ showToast }) {
  const [vendors, setVendors]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [sortKey, setSortKey]   = useState("name");
  const [sortDir, setSortDir]   = useState("asc");

  useEffect(() => {
    setLoading(true);
    fetch("/api/ops?action=vendor-list&allAccounts=true&pageSize=500")
      .then((r) => r.json())
      .then((d) => { if (d.success) setVendors(d.vendors || []); })
      .catch(() => showToast("Failed to load vendors", "error"))
      .finally(() => setLoading(false));
  }, [showToast]);

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

  if (loading) return <div className="oh-vp-admin-loading"><span className="oh-spinner" /></div>;

  return (
    <div className="oh-vp-all-vendors">
      {/* Admin header zone — title row + search bar */}
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
              <th className="oh-vp-th oh-vp-th--sort" onClick={() => toggleSort("name")}>
                Name <SortIcon col="name" />
              </th>
              <th className="oh-vp-th oh-vp-th--sort" onClick={() => toggleSort("category")}>
                Category <SortIcon col="category" />
              </th>
              <th className="oh-vp-th">Accounts</th>
              {/* FIX #9 — Portal column removed: portalUrl is almost always "—"
                  and the data is accessible in the vendor card detail view     */}
              <th className="oh-vp-th oh-vp-th--sort" onClick={() => toggleSort("createdAt")}>
                Added <SortIcon col="createdAt" />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={4} className="oh-vp-td-empty">No vendors match your filters.</td></tr>
            )}
            {sorted.map((v) => {
              const color = CATEGORY_COLORS[v.category] || "#64748b";
              return (
                <tr key={v.vendorId} className={`oh-vp-tr${!v.active ? " oh-vp-tr--inactive" : ""}`}>
                  <td className="oh-vp-td">
                    <span className="oh-vp-td-name">{v.name}</span>
                    {!v.active && <span className="oh-vp-chip oh-vp-chip--inactive">Inactive</span>}
                  </td>
                  {/* FIX #16 — category dot uses CSS classes (oh-vp-td-cat / oh-vp-td-cat-dot)
                      for consistent 6px gap instead of inline gap: 5               */}
                  <td className="oh-vp-td">
                    {v.category ? (
                      <span className="oh-vp-td-cat">
                        <span className="oh-vp-td-cat-dot" style={{ background: color }} />
                        {v.category}
                      </span>
                    ) : "—"}
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── Duplicate Name Detector ───────────────────────────────────────────────────
// ── Dismiss key: stable sort of vendorIds joined ──
const dismissKey = (group) => group.map(v => v.vendorId).sort().join("|");
const DISMISS_STORAGE_KEY = "kf_vp_dismissed_dupes";
const getDismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISS_STORAGE_KEY) || "[]"); } catch { return []; } };
const saveDismissed = (list) => localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(list));

function DuplicateDetector({ showToast }) {
  const [vendors, setVendors]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [ran, setRan]           = useState(false);
  const [groups, setGroups]     = useState([]);
  const [dismissed, setDismissed] = useState(() => getDismissed());

  useEffect(() => {
    fetch("/api/ops?action=vendor-list&allAccounts=true&pageSize=500")
      .then(r => r.json())
      .then(d => { if (d.success) setVendors(d.vendors || []); })
      .catch(() => showToast("Failed to load vendors", "error"))
      .finally(() => setLoading(false));
  }, [showToast]);

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
    const names = vendors.map(v => ({ ...v, norm: v.name.toLowerCase().replace(/[^a-z0-9]/g, "") }));
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
  };

  // ── Dismiss group (persisted to localStorage) ──
  const handleDismiss = (group) => {
    const key = dismissKey(group);
    const next = [...dismissed, key];
    setDismissed(next);
    saveDismissed(next);
    showToast("Group dismissed — won\'t show on future scans", "success");
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
              return (
                <div key={gi} className="oh-vp-dup-group">
                  {/* Group header */}
                  <div className="oh-vp-dup-group-header">
                    <span className="oh-vp-dup-group-label">Group {gi + 1}</span>
                    <div className="oh-vp-dup-group-actions">
                      <button className="oh-vp-dup-action-btn oh-vp-dup-action-btn--dismiss"
                        onClick={() => handleDismiss(group)}>
                        Not a duplicate
                      </button>
                    </div>
                  </div>

                  {/* Rows */}
                  {group.map(v => {
                    const color = CATEGORY_COLORS[v.category] || "#64748b";
                    return (
                      <div key={v.vendorId} className="oh-vp-dup-row">
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
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import VendorCard from "./VendorCard";
import VendorEditModal from "./VendorEditModal";

const CATEGORIES = ["All", "Produce", "Protein", "Dairy", "Dry Goods", "Beverage", "Packaging", "Cleaning", "Equipment", "Specialty", "Broadliner", "Other"];
const PAGE_SIZE  = 12;

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#cbd5e1" }}>
      <path d="M3 9l1-5h16l1 5" />
      <path d="M3 9a1 1 0 0 0-1 1v1a2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2 2 2 0 0 0 2 2 2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H3z" />
      <path d="M5 13v7h14v-7" />
      <path d="M9 13v4h6v-4" />
    </svg>
  );
}

function NoResultsIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#cbd5e1" }}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

function formatDeliveryDays(days) {
  if (!days) return "";
  return days.split(",").map((d) => d.trim()).join(", ");
}

// ── Custom category dropdown (replaces native OS select) ──
function CategoryDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="oh-vp-cat-dropdown" ref={ref}>
      <button
        type="button"
        className="oh-vp-cat-dropdown-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{value}</span>
        <span className={`oh-vp-cat-dropdown-chevron${open ? " oh-vp-cat-dropdown-chevron--open" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div className="oh-vp-cat-dropdown-menu">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`oh-vp-cat-dropdown-item${value === c ? " oh-vp-cat-dropdown-item--active" : ""}`}
              onClick={() => { onChange(c); setOpen(false); }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VendorList({
  accountKey,
  accountName,
  isAdmin,
  userEmail,
  showToast,
  openConfirm,
  onAddVendor,
}) {
  const [vendors, setVendors]               = useState([]);
  const [loading, setLoading]               = useState(true);
  const [search, setSearch]                 = useState("");
  const [category, setCategory]             = useState("All");
  const [showInactive, setShowInactive]     = useState(false);
  const [page, setPage]                     = useState(1);
  const [hasMore, setHasMore]               = useState(false);
  const [total, setTotal]                   = useState(0);
  const [inactiveCount, setInactiveCount]   = useState(0);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [loadingDetail, setLoadingDetail]   = useState(false);
  const [editVendor, setEditVendor]         = useState(null);
  const debounceRef                         = useRef(null);

  // ── Core fetch: all params passed explicitly so no closure over state ──
  const fetchVendors = useCallback((pg, q, cat, inactive, append) => {
    if (pg === 1) setLoading(true);

    const params = new URLSearchParams({
      action:   "vendor-list",
      accountKey,
      page:     pg,
      pageSize: PAGE_SIZE,
      active:   inactive ? "false" : "true",
      ...(q   ? { search: q }        : {}),
      ...(cat !== "All" ? { category: cat } : {}),
    });

    fetch(`/api/ops?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) return;
        setVendors((prev) => append ? [...prev, ...d.vendors] : d.vendors);
        setHasMore(d.hasMore    || false);
        setTotal(d.total        || 0);
        setInactiveCount(d.inactiveCount || 0);
        setPage(pg);
      })
      .catch(() => showToast("Failed to load vendors", "error"))
      .finally(() => setLoading(false));
  }, [accountKey, showToast]);

  // ── Load when account or filters change ──
  useEffect(() => {
    setVendors([]);
    setSearch("");
    setSelectedVendor(null);
    fetchVendors(1, "", category, showInactive, false);
  }, [accountKey, category, showInactive, fetchVendors]);

  // ── Debounced search ──
  const handleSearch = useCallback((val) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setVendors([]);
      setSelectedVendor(null);
      fetchVendors(1, val, category, showInactive, false);
    }, 350);
  }, [category, showInactive, fetchVendors]);

  // ── Load more ──
  const handleLoadMore = useCallback(() => {
    fetchVendors(page + 1, search, category, showInactive, true);
  }, [page, search, category, showInactive, fetchVendors]);

  // ── Deactivate ──
  const handleDeactivate = useCallback((vendor) => {
    openConfirm(
      "Deactivate Vendor",
      `Remove ${vendor.name} from ${accountName}? They'll no longer appear in invoice lookups.`,
      "Deactivate",
      () => {
        fetch("/api/ops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action:    "vendor-deactivate",
            vendorId:  vendor.vendorId,
            accountKey,
          }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.success) {
              showToast(`${vendor.name} deactivated`);
              setSelectedVendor(null);
              fetchVendors(1, search, category, showInactive, false);
            } else {
              showToast(d.error || "Deactivate failed", "error");
            }
          })
          .catch(() => showToast("Network error", "error"));
      }
    );
  }, [accountKey, accountName, search, category, showInactive, fetchVendors, showToast, openConfirm]);

  // ── Reactivate ──
  const handleReactivate = useCallback((vendor) => {
    fetch("/api/ops", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:    "vendor-reactivate",
        vendorId:  vendor.vendorId,
        accountKey,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          showToast(`${vendor.name} reactivated`);
          setSelectedVendor(null);
          fetchVendors(1, search, category, showInactive, false);
        } else {
          showToast(d.error || "Reactivate failed", "error");
        }
      })
      .catch(() => showToast("Network error", "error"));
  }, [accountKey, search, category, showInactive, fetchVendors, showToast]);

  // ── Fetch full vendor detail on row click ──
  const fetchVendorDetail = useCallback((v) => {
    if (selectedVendor?.vendorId === v.vendorId) {
      setSelectedVendor(null);
      return;
    }
    setSelectedVendor(v);
    setLoadingDetail(true);
    fetch(`/api/ops?action=vendor-get&vendorId=${v.vendorId}&accountKey=${accountKey}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setSelectedVendor(d.vendor); })
      .catch(() => {})
      .finally(() => setLoadingDetail(false));
  }, [selectedVendor, accountKey]);

  const handleSaved = useCallback(() => {
    setEditVendor(null);
    showToast("Vendor updated successfully");
    fetchVendors(1, search, category, showInactive, false);
    if (selectedVendor) {
      fetch(`/api/ops?action=vendor-get&vendorId=${selectedVendor.vendorId}&accountKey=${accountKey}`)
        .then((r) => r.json())
        .then((d) => { if (d.success) setSelectedVendor(d.vendor); })
        .catch(() => {});
    }
  }, [accountKey, search, category, showInactive, fetchVendors, selectedVendor]);

  const categoryColor = (cat) => {
    const map = {
      Produce:     "#16a34a",
      Protein:     "#dc2626",
      Dairy:       "#2563eb",
      "Dry Goods": "#d97706",
      Beverage:    "#7c3aed",
      Packaging:   "#0891b2",
      Cleaning:    "#0d9488",
      Equipment:   "#475569",
      Specialty:   "#db2777",
      Broadliner:  "#9333ea",
      Other:       "#64748b",
    };
    return map[cat] || "#64748b";
  };

  if (loading && vendors.length === 0) {
    return (
      <div className="oh-vp-list-wrap">
        <div className="oh-vp-skeleton-list">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="oh-vp-skeleton-row" />)}
        </div>
      </div>
    );
  }

  // FIX #5 — only show count when there are actually vendors to count
  const isEmpty = vendors.length === 0 && !loading;

  return (
    <div className="oh-vp-list-wrap">
      {/* ── Filter bar ── */}
      <div className="oh-vp-filters">
        <div className="oh-vp-search-box">
          <SearchIcon />
          <input
            type="text"
            className="oh-vp-search-input"
            placeholder="Search vendors…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
          {search && (
            <button className="oh-vp-search-clear" onClick={() => handleSearch("")}>✕</button>
          )}
        </div>
        <CategoryDropdown value={category} onChange={(val) => setCategory(val)} />
        {inactiveCount > 0 && (
          <button
            className={`oh-vp-toggle-btn${showInactive ? " oh-vp-toggle-btn--on" : ""}`}
            onClick={() => setShowInactive((v) => !v)}
          >
            {showInactive ? "Hide Inactive" : `Inactive (${inactiveCount})`}
          </button>
        )}
      </div>

      {/* ── Results count — hidden when empty state will show ── */}
      {!isEmpty && (
        <div className="oh-vp-results-header">
          <span className="oh-vp-results-count">
            {total} vendor{total !== 1 ? "s" : ""}
            {search ? ` matching "${search}"` : ""}
          </span>
        </div>
      )}

      {/* ── Main layout: list + card panel ── */}
      <div className={`oh-vp-layout${selectedVendor ? " oh-vp-layout--split" : ""}`}>
        {/* Vendor list */}
        <div className="oh-vp-list">
          {/* FIX #5 + #13 — clean empty state, no duplicate text, SVG icons */}
          {isEmpty && (
            <div className="oh-vp-empty-state">
              {search ? (
                <>
                  <div className="oh-vp-empty-icon"><NoResultsIcon /></div>
                  <p className="oh-vp-empty-title">No vendors match &ldquo;{search}&rdquo;</p>
                  <p className="oh-vp-empty-hint">Try a different search term or clear the filter.</p>
                </>
              ) : (
                <>
                  <div className="oh-vp-empty-icon"><StoreIcon /></div>
                  <p className="oh-vp-empty-title">No vendors linked yet</p>
                  <p className="oh-vp-empty-hint">Add your first vendor to start tracking deliveries, contacts, and ordering portals.</p>
                  {onAddVendor && (
                    <button className="oh-btn oh-btn--mustard oh-vp-empty-cta" onClick={onAddVendor}>
                      + Add Your First Vendor
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {vendors.map((v) => (
            <button
              key={v.vendorId}
              className={`oh-vp-row${selectedVendor?.vendorId === v.vendorId ? " oh-vp-row--selected" : ""}${!v.active ? " oh-vp-row--inactive" : ""}`}
              onClick={() => fetchVendorDetail(v)}
            >
              <div className="oh-vp-row-main">
                <span className="oh-vp-row-name">{v.name}</span>
                {!v.active && <span className="oh-vp-chip oh-vp-chip--inactive">Inactive</span>}
              </div>
              <div className="oh-vp-row-meta">
                <span className="oh-vp-cat-dot" style={{ background: categoryColor(v.category) }} />
                <span className="oh-vp-row-cat">{v.category || "—"}</span>
                {/* FIX #7 — normalize comma-separated days to "Mon, Wed, Fri" */}
                {v.deliveryDays && (
                  <span className="oh-vp-row-delivery">{formatDeliveryDays(v.deliveryDays)}</span>
                )}

              </div>
            </button>
          ))}

          {hasMore && (
            <button
              className="oh-vp-load-more"
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading ? "Loading…" : `Load more (${total - vendors.length} remaining)`}
            </button>
          )}
        </div>

        {/* Detail panel */}
        {selectedVendor && (
          <VendorCard
            vendor={selectedVendor}
            accountKey={accountKey}
            isAdmin={isAdmin}
            userEmail={userEmail}
            showToast={showToast}
            openConfirm={openConfirm}
            loadingDetail={loadingDetail}
            onEdit={() => setEditVendor(selectedVendor)}
            onDeactivate={() => handleDeactivate(selectedVendor)}
            onReactivate={() => handleReactivate(selectedVendor)}
            onClose={() => setSelectedVendor(null)}
          />
        )}
      </div>

      {/* Edit modal */}
      {editVendor && (
        <VendorEditModal
          vendor={editVendor}
          accountKey={accountKey}
          isAdmin={isAdmin}
          userEmail={userEmail}
          showToast={showToast}
          onSaved={handleSaved}
          onClose={() => setEditVendor(null)}
        />
      )}
    </div>
  );
}
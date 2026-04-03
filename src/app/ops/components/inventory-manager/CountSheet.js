"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/**
 * CountSheet.js — Location Walk Count Flow
 * 
 * Props:
 *   catalogItems   — full catalog for account [{itemId, name, category, unit, locationId, lastPrice, lastPriceVendor}]
 *   locations      — storage locations [{locationId, name, icon}]
 *   lastCountItems — {[itemId]: {quantity, noneOnHand}} from previous count
 *   sessionId      — active count session ID
 *   account        — account label
 *   period         — period name
 *   onSaveLocation — (locationId, items) => Promise  — save per-location
 *   onFinish       — () => void — done counting, go to review
 *   onBack         — () => void — back to landing
 *   showToast      — (msg, type) => void
 */

// ── Icons ──
const I = ({ d, size = 16, color = "#64748b", sw = 2, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const ic = {
  check: "M20 6L9 17l-5-5",
  minus: "M5 12h14",
  plus: "M12 5v14M5 12h14",
  chevL: "M15 18l-6-6 6-6",
  chevR: "M9 18l6-6-6-6",
  search: ["M11 17.25a6.25 6.25 0 110-12.5 6.25 6.25 0 010 12.5z", "M16 16l4.5 4.5"],
  x: "M18 6L6 18M6 6l12 12",
};

const fmt = (n) => "$" + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const PriceDot = ({ lastPrice, priceAtLastCount }) => {
  if (!priceAtLastCount || priceAtLastCount === 0) {
    // First count — grey dot
    return <span className="oh-inv-mgmt-dot oh-inv-mgmt-dot--grey" />;
  }
  if (lastPrice > priceAtLastCount) return <span className="oh-inv-mgmt-dot oh-inv-mgmt-dot--amber" />;
  if (lastPrice < priceAtLastCount) return <span className="oh-inv-mgmt-dot oh-inv-mgmt-dot--green" />;
  return <span className="oh-inv-mgmt-dot oh-inv-mgmt-dot--grey" />;
};

export default function CountSheet({
  catalogItems = [], locations = [], lastCountItems = {},
  sessionId, account, period,
  onSaveLocation, onFinish, onBack, showToast,
}) {
  const [locIdx, setLocIdx] = useState(0);
  const [counts, setCounts] = useState({});    // {[itemId]: {qty: number, none: boolean}}
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRefs = useRef({});

  // ── Items grouped by location ──
  const itemsByLocation = useMemo(() => {
    const map = {};
    locations.forEach((loc) => { map[loc.locationId] = []; });
    // Also bucket for items with no assigned location
    map["_unassigned"] = [];
    catalogItems.forEach((item) => {
      if (map[item.locationId]) {
        map[item.locationId].push(item);
      } else {
        map["_unassigned"].push(item);
      }
    });
    return map;
  }, [catalogItems, locations]);

  // Active location
  const allLocs = useMemo(() => {
    const locs = [...locations];
    // Add unassigned if there are items there
    if ((itemsByLocation["_unassigned"] || []).length > 0) {
      locs.push({ locationId: "_unassigned", name: "Other Items", icon: "box" });
    }
    return locs;
  }, [locations, itemsByLocation]);

  const currentLoc = allLocs[locIdx] || allLocs[0];
  const currentItems = currentLoc ? (itemsByLocation[currentLoc.locationId] || []) : [];

  // ── Filtered by search ──
  const filteredItems = useMemo(() => {
    if (!search.trim()) return currentItems;
    const q = search.toLowerCase();
    return currentItems.filter((i) => i.name.toLowerCase().includes(q));
  }, [currentItems, search]);

  // ── Count state helpers ──
  const getCount = (itemId) => counts[itemId] || { qty: null, none: false };
  const isCounted = (itemId) => {
    const c = getCount(itemId);
    return c.qty !== null || c.none;
  };

  const setItemQty = (itemId, qty) => {
    setCounts((prev) => ({
      ...prev,
      [itemId]: { qty: Math.max(0, qty), none: false },
    }));
  };

  const setItemNone = (itemId) => {
    setCounts((prev) => ({
      ...prev,
      [itemId]: { qty: 0, none: true },
    }));
  };

  const applyLastCount = (itemId) => {
    const last = lastCountItems[itemId];
    if (!last) return;
    if (last.noneOnHand) {
      setItemNone(itemId);
    } else {
      setItemQty(itemId, last.quantity);
    }
  };

  // ── Progress ──
  const locItemsCounted = currentItems.filter((i) => isCounted(i.itemId)).length;
  const locTotal = currentItems.length;
  const locProgress = locTotal > 0 ? (locItemsCounted / locTotal) * 100 : 0;

  // Running total $ for current location
  const locDollarTotal = currentItems.reduce((sum, item) => {
    const c = getCount(item.itemId);
    if (c.none || c.qty === null) return sum;
    return sum + (c.qty * (item.lastPrice || 0));
  }, 0);

  // Overall progress
  const allItems = catalogItems;
  const totalCounted = allItems.filter((i) => isCounted(i.itemId)).length;
  const overallProgress = allItems.length > 0 ? `${locIdx + 1}/${allLocs.length}` : "0/0";

  // ── Save current location ──
  const saveCurrentLocation = useCallback(async () => {
    if (!currentLoc || !sessionId) return;
    const locationItems = currentItems.map((item) => {
      const c = getCount(item.itemId);
      return {
        itemId: item.itemId,
        quantity: c.none ? 0 : (c.qty ?? 0),
        unit: item.unit,
        priceAtCount: item.lastPrice || 0,
        priceVendor: item.lastPriceVendor || "",
        noneOnHand: c.none,
      };
    }).filter((i) => i.quantity > 0 || i.noneOnHand); // Only save items that have been touched

    if (locationItems.length === 0) return;

    setSaving(true);
    try {
      if (onSaveLocation) {
        await onSaveLocation(currentLoc.locationId, locationItems);
      }
    } catch (e) {
      showToast?.("Failed to save location", "error");
    } finally {
      setSaving(false);
    }
  }, [currentLoc, currentItems, counts, sessionId, onSaveLocation, showToast]);

  // ── Navigation ──
  const goToLocation = async (newIdx) => {
    // Save current location before navigating
    await saveCurrentLocation();
    setSearch("");
    setLocIdx(newIdx);
  };

  const goNext = () => {
    if (locIdx < allLocs.length - 1) {
      goToLocation(locIdx + 1);
    } else {
      // Last location — go to review
      saveCurrentLocation().then(() => onFinish?.());
    }
  };

  const goPrev = () => {
    if (locIdx > 0) goToLocation(locIdx - 1);
    else onBack?.();
  };

  // ── Handle input change ──
  const handleQtyChange = (itemId, value) => {
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (cleaned === "") {
      setCounts((prev) => ({ ...prev, [itemId]: { qty: null, none: false } }));
      return;
    }
    const num = parseFloat(cleaned);
    if (!isNaN(num)) setItemQty(itemId, num);
  };

  const handleQtyFocus = (e) => e.target.select();

  // ── Render ──
  if (allLocs.length === 0) {
    return (
      <div className="oh-inv-mgmt-count-empty">
        <p>No storage locations set up for this account.</p>
        <p className="oh-inv-mgmt-count-empty-sub">Add locations in Manage → Storage Locations before counting.</p>
        <button className="oh-inv-mgmt-cta-btn" onClick={onBack}>Back</button>
      </div>
    );
  }

  return (
    <div className="oh-inv-mgmt-count">
      {/* ── Sticky Progress Header ── */}
      <div className="oh-inv-mgmt-count-progress">
        <div className="oh-inv-mgmt-count-progress-top">
          <span className="oh-inv-mgmt-count-loc-name">{currentLoc?.name || "Unknown"}</span>
          <div className="oh-inv-mgmt-count-progress-right">
            <span className="oh-inv-mgmt-count-total-pill">{fmt(locDollarTotal)}</span>
            <span className="oh-inv-mgmt-count-overall">{overallProgress}</span>
          </div>
        </div>
        <div className="oh-inv-mgmt-count-progress-bar-row">
          <div className="oh-inv-mgmt-count-progress-bar">
            <div className="oh-inv-mgmt-count-progress-fill" style={{ width: `${locProgress}%` }} />
          </div>
          <span className="oh-inv-mgmt-count-progress-label">{locItemsCounted} of {locTotal} counted</span>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="oh-inv-mgmt-count-search-wrap">
        <I d={ic.search} size={14} color="#94a3b8" />
        <input
          className="oh-inv-mgmt-count-search"
          placeholder={`Search in ${currentLoc?.name || "location"}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="oh-inv-mgmt-count-search-clear" onClick={() => setSearch("")}>
            <I d={ic.x} size={12} color="#94a3b8" />
          </button>
        )}
      </div>

      {/* ── Item Cards ── */}
      <div className="oh-inv-mgmt-count-items">
        {filteredItems.map((item) => {
          const c = getCount(item.itemId);
          const counted = c.qty !== null && !c.none;
          const noneMarked = c.none;
          const last = lastCountItems[item.itemId];
          const isFirstCount = !last && (!item.priceAtLastCount || item.priceAtLastCount === 0);
          const extTotal = counted ? (c.qty * (item.lastPrice || 0)) : 0;

          return (
            <div
              key={item.itemId}
              className={`oh-inv-mgmt-count-item${counted ? " counted" : ""}${noneMarked ? " none-marked" : ""}`}
            >
              {/* Row 1: Name + extended total */}
              <div className="oh-inv-mgmt-count-item-top">
                {counted && <I d={ic.check} size={13} color="#16A34A" sw={2.5} />}
                {noneMarked && <span className="oh-inv-mgmt-none-badge">None</span>}
                <span className={`oh-inv-mgmt-count-item-name${noneMarked ? " struck" : ""}`}>{item.name}</span>
                {counted && extTotal > 0 && (
                  <span className="oh-inv-mgmt-count-item-ext">{fmt(extTotal)}</span>
                )}
              </div>

              {/* Row 2: Price · vendor · unit */}
              <div className="oh-inv-mgmt-count-item-price-row">
                <PriceDot lastPrice={item.lastPrice} priceAtLastCount={item.priceAtLastCount} />
                <span className="oh-inv-mgmt-count-item-price">
                  {fmt(item.lastPrice)} · {item.lastPriceVendor || item.primaryVendor || "–"} · {item.unit}
                </span>
                {isFirstCount && <span className="oh-inv-mgmt-count-item-first">first count</span>}
              </div>

              {/* Row 3: Stepper + chips (hide if none marked) */}
              {!noneMarked && (
                <div className="oh-inv-mgmt-count-item-controls">
                  <div className="oh-inv-mgmt-stepper">
                    <button
                      className="oh-inv-mgmt-stepper-btn"
                      onClick={() => setItemQty(item.itemId, Math.max(0, (c.qty || 0) - 1))}
                    >
                      <I d={ic.minus} size={16} color="#0f3057" />
                    </button>
                    <input
                      className="oh-inv-mgmt-stepper-input"
                      type="text"
                      inputMode="decimal"
                      value={c.qty !== null ? c.qty : ""}
                      placeholder="0"
                      onChange={(e) => handleQtyChange(item.itemId, e.target.value)}
                      onFocus={handleQtyFocus}
                      ref={(el) => { if (el) inputRefs.current[item.itemId] = el; }}
                    />
                    <button
                      className="oh-inv-mgmt-stepper-btn"
                      onClick={() => setItemQty(item.itemId, (c.qty || 0) + 1)}
                    >
                      <I d={ic.plus} size={16} color="#0f3057" />
                    </button>
                  </div>
                  <span className="oh-inv-mgmt-count-item-unit">{item.unit}</span>

                  <div className="oh-inv-mgmt-count-item-chips">
                    {/* "Last: X" chip */}
                    {last && !last.noneOnHand && last.quantity > 0 && (
                      <button
                        className="oh-inv-mgmt-chip-last"
                        onClick={() => applyLastCount(item.itemId)}
                      >
                        Last: {last.quantity}
                      </button>
                    )}
                    {/* "None" button */}
                    <button
                      className="oh-inv-mgmt-chip-none"
                      onClick={() => setItemNone(item.itemId)}
                    >
                      None
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredItems.length === 0 && search && (
          <div className="oh-inv-mgmt-count-no-results">
            No items matching "{search}"
          </div>
        )}

        {filteredItems.length === 0 && !search && (
          <div className="oh-inv-mgmt-count-no-results">
            No items in this location yet.
          </div>
        )}
      </div>

      {/* ── Fixed Bottom Navigation ── */}
      <div className="oh-inv-mgmt-count-nav">
        <button className="oh-inv-mgmt-count-nav-back" onClick={goPrev}>
          <I d={ic.chevL} size={14} color="#0f3057" />
          {locIdx > 0 ? allLocs[locIdx - 1]?.name : "Home"}
        </button>
        <button className="oh-inv-mgmt-count-nav-next" onClick={goNext} disabled={saving}>
          {saving ? "Saving..." : locIdx < allLocs.length - 1
            ? allLocs[locIdx + 1]?.name
            : "Review"}
          <I d={ic.chevR} size={14} color="#fff" />
        </button>
      </div>
    </div>
  );
}
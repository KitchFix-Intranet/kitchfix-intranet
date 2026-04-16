"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

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
  download: ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
};
const fmt = (n) => "$" + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\\d))/g, ",");

// Icon + color system (shared with ProductPlacement)
const IE = {
  snowflake:"❄️",ice:"🧊",thermometer:"🌡️",drumstick:"🍖",steak:"🥩",poultry:"🍗",bacon:"🥓",turkey:"🦃",
  fish:"🐟",shrimp:"🦐",lobster:"🦞",crab:"🦀",oyster:"🦪",squid:"🦑",octopus:"🐙",
  carrot:"🥕",leaf:"🍃",greens:"🥬",broccoli:"🥦",lettuce:"🥗",tomato:"🍅",pepper:"🌶️",corn:"🌽",mushroom:"🍄",onion:"🧅",garlic:"🧄",potato:"🥔",avocado:"🥑",
  apple:"🍎",lemon:"🍋",orange:"🍊",banana:"🍌",grape:"🍇",strawberry:"🍓",blueberry:"🫐",cherry:"🍒",peach:"🍑",watermelon:"🍉",pineapple:"🍍",mango:"🥭",
  egg:"🥚",cheese:"🧀",butter:"🧈",milk:"🥛",
  bread:"🍞",croissant:"🥐",bagel:"🥯",rice:"🍚",noodles:"🍜",
  flame:"🔥",plate:"🍽️",stew:"🍲",cookie:"🍪",cupcake:"🧁",donut:"🍩",pie:"🥧",chocolate:"🍫",candy:"🍬",icecream:"🍦",popcorn:"🍿",honey:"🍯",peanut:"🥜",
  cup:"☕",tea:"🍵",boba:"🧋",juice:"🧃",soda:"🥤",water:"💧",wine:"🍷",beer:"🍺",cocktail:"🍸",
  salt:"🧂",jar:"🫙",knife:"🔪",sponge:"🧽",bucket:"🪣",broom:"🧹",gloves:"🧤",wrench:"🔧",trash:"🗑️",
  box:"📦",paper:"📋",tag:"🏷️",cabinet:"🗄️",stadium:"🏟️",truck:"🚛",can:"🥫",
};
const ri = i => { if(!i) return "📦"; if(i.codePointAt(0)>127) return i; return IE[i]||"📦"; };
const ZC = {blue:{bg:"#dbeafe",fg:"#2563eb"},indigo:{bg:"#e0e7ff",fg:"#4f46e5"},amber:{bg:"#fef3c7",fg:"#d97706"},green:{bg:"#dcfce7",fg:"#16a34a"},red:{bg:"#fee2e2",fg:"#dc2626"},purple:{bg:"#f3e8ff",fg:"#9333ea"},slate:{bg:"#f1f5f9",fg:"#475569"},teal:{bg:"#ccfbf1",fg:"#0d9488"},orange:{bg:"#ffedd5",fg:"#ea580c"},gold:{bg:"#fef9c3",fg:"#ca8a04"},cyan:{bg:"#cffafe",fg:"#0891b2"},pink:{bg:"#fce7f3",fg:"#db2777"},emerald:{bg:"#d1fae5",fg:"#059669"},brown:{bg:"#f5e6d3",fg:"#92400e"}};
const zc = c => ZC[c]||ZC.blue;

export default function CountSheet({
  catalogItems = [], locations = [], lastCountItems = {},
  sessionId, account, period,
  onSaveLocation, onSubmit, onFinish, onBack, showToast,
}) {
  const [locIdx, setLocIdx] = useState(0);
  const [counts, setCounts] = useState({});
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const inputRefs = useRef({});

  const itemsByLocation = useMemo(() => {
    const map = {};
    locations.forEach((loc) => { map[loc.locationId] = []; });
    map["_unassigned"] = [];
    catalogItems.forEach((item) => {
      if (map[item.locationId]) map[item.locationId].push(item);
      else map["_unassigned"].push(item);
    });
    return map;
  }, [catalogItems, locations]);

  const allLocs = useMemo(() => {
    const locs = locations.filter(l => (itemsByLocation[l.locationId] || []).length > 0);
    if ((itemsByLocation["_unassigned"] || []).length > 0) {
      locs.push({ locationId: "_unassigned", name: "Other Items", icon: "box" });
    }
    return locs;
  }, [locations, itemsByLocation]);

  const locParent = useMemo(() => {
    const m = {};
    locations.forEach(l => { if (l.parentLocationId) { const p = locations.find(x => x.locationId === l.parentLocationId); if (p) m[l.locationId] = p; } });
    return m;
  }, [locations]);
  const locDisplayName = (loc) => locParent[loc?.locationId] ? `${locParent[loc.locationId].name} → ${loc.name}` : (loc?.name || "");

  const currentLoc = allLocs[locIdx] || allLocs[0];
  const currentItems = currentLoc ? (itemsByLocation[currentLoc.locationId] || []) : [];

  const filteredItems = useMemo(() => {
    if (!search.trim()) return currentItems;
    const q = search.toLowerCase();
    return currentItems.filter((i) => i.name.toLowerCase().includes(q));
  }, [currentItems, search]);

  const getCount = (itemId) => counts[itemId] || { qty: null, none: false };
  const isCounted = (itemId) => { const c = getCount(itemId); return c.qty !== null || c.none; };
  const setItemQty = (itemId, qty) => { setCounts(prev => ({ ...prev, [itemId]: { qty: Math.max(0, qty), none: false } })); };
  const setItemNone = (itemId) => { setCounts(prev => ({ ...prev, [itemId]: { qty: 0, none: true } })); setActiveItem(null); };
  const applyLastCount = (itemId) => { const last = lastCountItems[itemId]; if (!last) return; if (last.noneOnHand) setItemNone(itemId); else { setItemQty(itemId, last.quantity); setActiveItem(null); } };

  const locItemsCounted = currentItems.filter(i => isCounted(i.itemId)).length;
  const locTotal = currentItems.length;
  const locProgress = locTotal > 0 ? (locItemsCounted / locTotal) * 100 : 0;
  const locDollarTotal = currentItems.reduce((sum, item) => { const c = getCount(item.itemId); if (c.none || c.qty === null) return sum; return sum + (c.qty * (item.lastPrice || 0)); }, 0);

  const saveCurrentLocation = useCallback(async () => {
    if (!currentLoc || !sessionId) return;
    const locationItems = currentItems.map(item => {
      const c = getCount(item.itemId);
      return { itemId: item.itemId, quantity: c.none ? 0 : (c.qty ?? 0), unit: item.unit, priceAtCount: item.lastPrice || 0, priceVendor: item.lastPriceVendor || "", noneOnHand: c.none };
    }).filter(i => i.quantity > 0 || i.noneOnHand);
    if (locationItems.length === 0) return;
    setSaving(true);
    try { if (onSaveLocation) await onSaveLocation(currentLoc.locationId, locationItems); }
    catch { showToast?.("Failed to save location", "error"); }
    finally { setSaving(false); }
  }, [currentLoc, currentItems, counts, sessionId, onSaveLocation, showToast]);

  const goToLocation = async (newIdx) => { await saveCurrentLocation(); setSearch(""); setActiveItem(null); setLocIdx(newIdx); };
  const goNext = () => { if (locIdx < allLocs.length - 1) goToLocation(locIdx + 1); else saveCurrentLocation().then(() => setReviewing(true)); };
  const goPrev = () => { if (locIdx > 0) goToLocation(locIdx - 1); else onBack?.(); };

  const handleQtyChange = (itemId, value) => {
    const cleaned = value.replace(/[^0-9.]/g, "");
    if (cleaned === "") { setCounts(prev => ({ ...prev, [itemId]: { qty: null, none: false } })); return; }
    const num = parseFloat(cleaned);
    if (!isNaN(num)) setItemQty(itemId, num);
  };

  const confirmQty = (itemId) => { const c = getCount(itemId); if (c.qty !== null && c.qty >= 0) setActiveItem(null); };

  const exportCount = () => {
    const header = "Location,Item,Category,Vendor,Unit,Unit Price,Qty,Extended Total,None on Hand,Last Ordered\n";
    const rows = [];
    allLocs.forEach(loc => {
      const items = itemsByLocation[loc.locationId] || [];
      items.forEach(item => {
        const c = counts[item.itemId] || { qty: null, none: false };
        const qty = c.none ? 0 : (c.qty || 0);
        const ext = c.none ? 0 : (qty * (item.lastPrice || 0));
        const vendor = item.primaryVendor || item.lastPriceVendor || "";
        const lastDate = item.lastPriceDate || "";
        rows.push(`"${locDisplayName(loc)}","${(item.name||"").replace(/"/g,'""')}","${item.category||""}","${vendor.replace(/"/g,'""')}","${item.unit||"ea"}","${(item.lastPrice||0).toFixed(2)}","${qty}","${ext.toFixed(2)}","${c.none?"Yes":""}","${lastDate}"`);
      });
    });
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Count_${period}_${account}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast?.("Count exported", "success");
  };

  if (allLocs.length === 0) {
    return (<div className="cs-empty"><p>No storage locations set up.</p><p className="cs-empty-sub">Set up zones in Product Placement first.</p><button className="cs-back-btn" onClick={onBack}>Back</button></div>);
  }

  /* ═══ REVIEW SCREEN ═══ */
  if (reviewing) {
    const locSummary = allLocs.map(loc => {
      const items = itemsByLocation[loc.locationId] || [];
      let total = 0, counted = 0, noneCount = 0;
      items.forEach(item => { const c = counts[item.itemId]; if (c && (c.qty !== null || c.none)) { counted++; if (c.none) noneCount++; else total += (c.qty || 0) * (item.lastPrice || 0); } });
      return { name: locDisplayName(loc), items: items.length, counted, noneCount, total };
    });
    const catTotals = { Food: 0, Beverages: 0, Snacks: 0, Supplies: 0, Packaging: 0 };
    let grandTotal = 0, totalCounted = 0, totalNone = 0;
    catalogItems.forEach(item => {
      const c = counts[item.itemId];
      if (c && c.qty !== null && !c.none) { const ext = (c.qty || 0) * (item.lastPrice || 0); const cat = item.category || "Food"; if (catTotals[cat] !== undefined) catTotals[cat] += ext; else catTotals.Food += ext; grandTotal += ext; totalCounted++; }
      else if (c && c.none) { totalCounted++; totalNone++; }
    });
    const skipped = catalogItems.length - totalCounted;

    const doSubmit = async () => {
      setSubmitting(true);
      try { if (onSubmit) await onSubmit({ sessionId, account, period, grandTotal, catTotals }); onFinish?.(); }
      catch { showToast?.("Submit failed", "error"); }
      finally { setSubmitting(false); }
    };

    return (
      <div className="cs-root">
        <div className="cs-review">
          <div className="cs-review-hdr"><div><h3 className="cs-review-title">Count review</h3><p className="cs-review-sub">{period} · {account} · {totalCounted} items counted</p></div><button className="cs-export-btn" onClick={exportCount}><I d={ic.download} size={14} color="#2563eb" /> Export</button></div>
          <div className="cs-review-grand"><span className="cs-review-grand-label">Grand total</span><span className="cs-review-grand-value">{fmt(grandTotal)}</span></div>
          <div className="cs-review-cats">{Object.entries(catTotals).filter(([,v]) => v > 0).map(([cat, val]) => (<div key={cat} className="cs-review-cat-row"><span>{cat}</span><span>{fmt(val)}</span></div>))}</div>
          <div className="cs-review-section-label">By location</div>
          <div className="cs-review-locs">{locSummary.map((loc, i) => (
            <div key={i} className="cs-review-loc-row"><div className="cs-review-loc-left"><span className="cs-review-loc-name">{loc.name}</span><span className="cs-review-loc-sub">{loc.counted}/{loc.items} counted{loc.noneCount > 0 ? ` · ${loc.noneCount} none` : ""}</span></div><span className="cs-review-loc-total">{fmt(loc.total)}</span></div>
          ))}</div>
          {skipped > 0 && <div className="cs-review-warning">{skipped} item{skipped !== 1 ? "s" : ""} not counted — recorded as 0.</div>}
          {totalNone > 0 && <div className="cs-review-none">{totalNone} item{totalNone !== 1 ? "s" : ""} marked "none on hand"</div>}
          <div className="cs-review-actions">
            <button className="cs-review-back" onClick={() => setReviewing(false)}><I d={ic.chevL} size={14} color="#0f3057" /> Back to counting</button>
            <button className="cs-review-submit" onClick={doSubmit} disabled={submitting}>{submitting ? "Submitting..." : "Submit count"}{!submitting && <I d={ic.check} size={14} color="#fff" sw={2.5} />}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ═══ COUNT SCREEN ═══ */
  const parentZone = locParent[currentLoc?.locationId];
  const locColor = zc(currentLoc?.color || parentZone?.color || "blue");

  return (
    <div className="cs-root">
      {/* Zone header — PP style */}
      <div className="cs-zone-hdr">
        <div className="cs-zone-ico" style={{background: locColor.bg}}>{ri(currentLoc?.icon)}</div>
        <div className="cs-zone-body">
          <span className="cs-zone-name">{currentLoc?.name || "Unknown"}</span>
          <span className="cs-zone-sub">{parentZone ? parentZone.name + " · " : ""}{locTotal} items</span>
        </div>
        <div className="cs-zone-right">
          <span className="cs-zone-total">{fmt(locDollarTotal)}</span>
          <span className="cs-zone-progress">{locItemsCounted}/{locTotal} · {locIdx + 1}/{allLocs.length}</span>
        </div>
        <button className="cs-export-ico" onClick={exportCount} title="Export count"><I d={ic.download} size={15} color="#94a3b8" /></button>
      </div>
      <div className="cs-pbar"><div className="cs-pfill" style={{ width: `${locProgress}%`, background: locColor.fg }} /></div>

      {/* Search */}
      <div className="cs-search">
        <I d={ic.search} size={13} color="#94a3b8" />
        <input placeholder={`Search in ${currentLoc?.name || "location"}...`} value={search} onChange={e => setSearch(e.target.value)} />
        {search && <button className="cs-search-x" onClick={() => setSearch("")}><I d={ic.x} size={12} color="#94a3b8" /></button>}
      </div>

      {/* Items — stay in place, no reordering */}
      <div className="cs-items">
        {filteredItems.map(item => {
          const c = getCount(item.itemId);
          const counted = c.qty !== null && !c.none;
          const noneMarked = c.none;
          const isActive = activeItem === item.itemId;
          const last = lastCountItems[item.itemId];
          const extTotal = counted ? (c.qty * (item.lastPrice || 0)) : 0;

          /* Active — expanded stepper */
          if (isActive) {
            return (
              <div key={item.itemId} className="cs-row cs-row--active">
                <div className="cs-active-top">
                  <span className="cs-active-name">{item.name}</span>
                  <span className="cs-active-price">{fmt(item.lastPrice)}/{item.unit || "ea"}</span>
                </div>
                <div className="cs-active-controls">
                  <div className="cs-stepper">
                    <button className="cs-stepper-btn" onClick={() => setItemQty(item.itemId, Math.max(0, (c.qty || 0) - 1))}>
                      <I d={ic.minus} size={16} color="#0f3057" />
                    </button>
                    <input className="cs-stepper-input" type="text" inputMode="decimal"
                      value={c.qty !== null ? c.qty : ""} placeholder="0"
                      onChange={e => handleQtyChange(item.itemId, e.target.value)}
                      onFocus={e => e.target.select()}
                      ref={el => { if (el) { inputRefs.current[item.itemId] = el; } }}
                      autoFocus />
                    <button className="cs-stepper-btn" onClick={() => setItemQty(item.itemId, (c.qty || 0) + 1)}>
                      <I d={ic.plus} size={16} color="#0f3057" />
                    </button>
                  </div>
                  <span className="cs-stepper-unit">{item.unit || "ea"}</span>
                  <div className="cs-active-chips">
                    {last && !last.noneOnHand && last.quantity > 0 && (
                      <button className="cs-chip-last" onClick={() => applyLastCount(item.itemId)}>Last: {last.quantity}</button>
                    )}
                    <button className="cs-chip-none" onClick={() => setItemNone(item.itemId)}>None</button>
                    {c.qty !== null && c.qty >= 0 && (
                      <button className="cs-chip-done" onClick={() => confirmQty(item.itemId)}><I d={ic.check} size={14} color="#fff" sw={2.5} /></button>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          /* None on hand — compressed */
          if (noneMarked) {
            return (
              <div key={item.itemId} className="cs-row cs-row--none" onClick={() => { setCounts(prev => ({ ...prev, [item.itemId]: { qty: null, none: false } })); setActiveItem(item.itemId); }}>
                <span className="cs-none-badge">None</span>
                <span className="cs-row-name cs-row-name--struck">{item.name}</span>
              </div>
            );
          }

          /* Counted — compressed single line */
          if (counted) {
            return (
              <div key={item.itemId} className="cs-row cs-row--counted" onClick={() => setActiveItem(item.itemId)}>
                <div className="cs-check"><I d={ic.check} size={10} color="#fff" sw={3} /></div>
                <span className="cs-row-name">{item.name}</span>
                <span className="cs-row-qty">{c.qty} {item.unit || "ea"}</span>
                <span className="cs-row-ext">{fmt(extTotal)}</span>
              </div>
            );
          }

          /* Uncounted — compact, tap to expand */
          return (
            <div key={item.itemId} className="cs-row cs-row--uncounted" onClick={() => setActiveItem(item.itemId)}>
              <span className="cs-row-name">{item.name}</span>
              <span className="cs-row-price">{fmt(item.lastPrice)}/{item.unit || "ea"}</span>
            </div>
          );
        })}

        {filteredItems.length === 0 && (
          <div className="cs-no-results">{search ? `No items matching "${search}"` : "No items in this location."}</div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="cs-nav">
        <button className="cs-nav-back" onClick={goPrev}>
          <I d={ic.chevL} size={14} color="#0f3057" />
          {locIdx > 0 ? allLocs[locIdx - 1]?.name : "Home"}
        </button>
        <button className="cs-nav-next" onClick={goNext} disabled={saving}>
          {saving ? "Saving..." : locIdx < allLocs.length - 1 ? allLocs[locIdx + 1]?.name : "Review"}
          <I d={ic.chevR} size={14} color="#fff" />
        </button>
      </div>
    </div>
  );
}
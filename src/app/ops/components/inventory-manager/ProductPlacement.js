"use client";
import { useState, useMemo, useCallback, useEffect } from "react";

/* ── Inline SVG icon ── */
const I = ({ d, size = 16, color = "#64748b", sw = 2, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display:"inline-block", verticalAlign:"middle", flexShrink:0, ...style }}>
    {Array.isArray(d) ? d.map((p,i) => <path key={i} d={p}/>) : <path d={d}/>}
  </svg>
);
const ico = {
  chevDown:"M6 9l6 6 6-6", chevUp:"M18 15l-6-6-6 6",
  search:["M11 19a8 8 0 100-16 8 8 0 000 16z","M21 21l-4.35-4.35"],
  x:["M18 6L6 18","M6 6l12 12"],
  info:["M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z","M12 16v-4","M12 8h.01"],
  download:["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4","M7 10l5 5 5-5","M12 15V3"],
  dots:["M12 13a1 1 0 100-2 1 1 0 000 2z","M19 13a1 1 0 100-2 1 1 0 000 2z","M5 13a1 1 0 100-2 1 1 0 000 2z"],
  plus:["M12 5v14","M5 12h14"],
  trash:["M3 6h18","M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"],
  edit:["M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7","M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"],
};
const fmt = n => "$" + Number(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",");

/* ── Legacy icon fallback ── */
const IE = {snowflake:"❄️",ice:"🧊",thermometer:"🌡️",drumstick:"🍖",fish:"🐟",steak:"🥩",shrimp:"🦐",poultry:"🍗",egg:"🥚",bacon:"🥓",carrot:"🥕",leaf:"🍃",apple:"🍎",greens:"🥬",tomato:"🍅",lemon:"🍋",onion:"🧅",corn:"🌽",avocado:"🥑",pepper:"🌶️",cheese:"🧀",butter:"🧈",milk:"🥛",bread:"🍞",cup:"☕",juice:"🧃",water:"💧",wine:"🍷",flame:"🔥",plate:"🍽️",cookie:"🍪",sandwich:"🥪",box:"📦",paper:"📋",tag:"🏷️",wrench:"🔧",broom:"🧹",gloves:"🧤",star:"⭐",can:"🥫",salt:"🧂"};
const ri = ic => { if(!ic) return "📦"; if(ic.codePointAt(0)>127) return ic; return IE[ic]||"📦"; };

/* ── Colors ── */
const CC = {"FOOD":"#16A34A","Food":"#16A34A","BEVERAGES":"#8b5cf6","Beverages":"#8b5cf6","SNACKS":"#f59e0b","Snacks":"#f59e0b","PACKAGING":"#64748b","Packaging":"#64748b","SUPPLIES":"#94a3b8","Supplies":"#94a3b8","PROTEIN":"#dc2626","Protein":"#dc2626","PRODUCE":"#22c55e","Produce":"#22c55e","DAIRY":"#3b82f6","Dairy":"#3b82f6","DRY GOODS":"#d97706","Dry Goods":"#d97706","SEAFOOD":"#0891b2","Seafood":"#0891b2","BAKERY":"#ea580c","Bakery":"#ea580c","FROZEN":"#6366f1","Frozen":"#6366f1"};
const cc = c => CC[c]||"#64748b";
const ZC = {blue:{bg:"#dbeafe",fg:"#2563eb"},indigo:{bg:"#e0e7ff",fg:"#4f46e5"},amber:{bg:"#fef3c7",fg:"#d97706"},green:{bg:"#dcfce7",fg:"#16a34a"},red:{bg:"#fee2e2",fg:"#dc2626"},purple:{bg:"#f3e8ff",fg:"#9333ea"},slate:{bg:"#f1f5f9",fg:"#475569"},teal:{bg:"#ccfbf1",fg:"#0d9488"},orange:{bg:"#ffedd5",fg:"#ea580c"},gold:{bg:"#fef9c3",fg:"#ca8a04"},brown:{bg:"#f5e6d3",fg:"#92400e"},cyan:{bg:"#cffafe",fg:"#0891b2"},pink:{bg:"#fce7f3",fg:"#db2777"},emerald:{bg:"#d1fae5",fg:"#059669"}};
const zc = c => ZC[c]||ZC.blue;

/* ════════════════════════════════════ */
export default function ProductPlacement({ catalogItems, locations, onBatchMove, onDirtyChange, onSaveLocations, showToast }) {
  // Accordion
  const [openZone, setOpenZone] = useState(null);
  const [openSubs, setOpenSubs] = useState(new Set());
  const [uaOpen, setUaOpen] = useState(false);
  // Tray
  const [picked, setPicked] = useState(new Set());
  // Placed (pending save)
  const [moves, setMoves] = useState({});
  // UI
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [searchOn, setSearchOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dropped, setDropped] = useState(new Set());
  // Zone management
  const [menuLoc, setMenuLoc] = useState(null); // locationId of open menu
  const [addingShelf, setAddingShelf] = useState(null); // zoneId where adding shelf
  const [shelfName, setShelfName] = useState("");
  const [renamingLoc, setRenamingLoc] = useState(null);
  const [renameVal, setRenameVal] = useState("");

  const pendingCount = Object.keys(moves).length;
  const hasPicked = picked.size > 0;

  // Notify parent dirty state
  useEffect(() => { onDirtyChange?.(pendingCount > 0); }, [pendingCount]); // eslint-disable-line

  /* ── Memos ── */
  const locMap = useMemo(() => { const m = {}; locations.forEach(l => { m[l.locationId] = l; }); return m; }, [locations]);
  const topZones = useMemo(() => locations.filter(l => !l.parentLocationId), [locations]);
  const activeIds = useMemo(() => new Set(locations.map(l => l.locationId)), [locations]);

  // Items grouped by exact location (not rolled up to parent)
  const byLoc = useMemo(() => {
    const m = { __ua: [] };
    locations.forEach(l => { m[l.locationId] = []; });
    catalogItems.forEach(item => {
      const eLoc = moves[item.itemId] !== undefined ? moves[item.itemId] : item.locationId;
      if (!eLoc || !activeIds.has(eLoc)) m.__ua.push(item);
      else { if (!m[eLoc]) m[eLoc] = []; m[eLoc].push(item); }
    });
    Object.values(m).forEach(a => a.sort((x,y) => x.name.localeCompare(y.name)));
    return m;
  }, [catalogItems, locations, moves, activeIds]);

  // Total items in a zone (including sub-zones)
  const zoneCount = useCallback((zid) => {
    let n = (byLoc[zid]||[]).length;
    locations.filter(l => l.parentLocationId === zid).forEach(s => { n += (byLoc[s.locationId]||[]).length; });
    return n;
  }, [byLoc, locations]);

  const uaItems = byLoc.__ua || [];
  const uaCount = uaItems.length;

  // Search filter
  const matchSearch = useCallback((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q) || (item.primaryVendor||"").toLowerCase().includes(q);
  }, [search]);

  /* ── Actions ── */
  const toggleZone = (zid) => {
    setOpenZone(prev => prev === zid ? null : zid);
    setOpenSubs(new Set());
    setDetail(null);
  };
  const toggleSub = (sid) => {
    setOpenSubs(prev => { const s = new Set(prev); s.has(sid) ? s.delete(sid) : s.add(sid); return s; });
    setDetail(null);
  };
  const togglePick = (itemId) => {
    setPicked(prev => { const s = new Set(prev); s.has(itemId) ? s.delete(itemId) : s.add(itemId); return s; });
    setDetail(null);
  };

  const dropInto = (targetId) => {
    if (picked.size === 0) return;
    const newMoves = {};
    picked.forEach(id => {
      const orig = catalogItems.find(i => i.itemId === id);
      const origLoc = orig?.locationId || "";
      const target = targetId === "__ua" ? "" : targetId;
      if (target !== origLoc) newMoves[id] = target;
    });
    setMoves(prev => ({ ...prev, ...newMoves }));
    const ids = new Set(Object.keys(newMoves));
    setDropped(ids);
    setTimeout(() => setDropped(new Set()), 500);
    setPicked(new Set());
    const dest = targetId === "__ua" ? "Unassigned" : (locMap[targetId]?.name || "Unknown");
    const cnt = ids.size;
    if (cnt > 0) showToast?.(`${cnt} item${cnt!==1?"s":""} placed in ${dest}`, "success");
  };

  const handleSave = async () => {
    if (pendingCount === 0) return;
    setSaving(true);
    const items = Object.entries(moves).map(([itemId, loc]) => ({ itemId, newLocationId: loc }));
    try {
      await onBatchMove(items);
      setMoves({});
      showToast?.(`${items.length} item${items.length!==1?"s":""} saved`, "success");
    } catch { showToast?.("Save failed", "error"); }
    finally { setSaving(false); }
  };

  /* ── Item row ── */
  const renderItem = (item, showCat = false) => {
    const isPicked = picked.has(item.itemId);
    const isMoved = item.itemId in moves;
    const isJustDropped = dropped.has(item.itemId);
    const isDetail = detail === item.itemId;
    if (!matchSearch(item)) return null;

    return (
      <div key={item.itemId} className={`pp-item${isPicked?" picked":""}${isMoved?" moved":""}${isJustDropped?" just-dropped":""}`}>
        <div className="pp-item-row" onClick={() => togglePick(item.itemId)}>
          <div className="pp-item-left">
            <span className="pp-item-name">{item.name}</span>
            <span className="pp-item-meta">
              {showCat && <span className="pp-item-cat" style={{color:cc(item.category)}}>{item.category} · </span>}
              <span className="pp-item-vendor">{item.primaryVendor||""}</span>
              {isMoved && <span className="pp-item-badge">moved</span>}
            </span>
          </div>
          <div className="pp-item-right">
            {item.lastPrice > 0 && <span className="pp-item-price">{fmt(item.lastPrice)}</span>}
            <button className="pp-item-info" onClick={e => { e.stopPropagation(); setDetail(isDetail ? null : item.itemId); }}
              aria-label="Item details">
              <I d={ico.info} size={15} color={isDetail?"#2563eb":"#cbd5e1"} sw={1.5}/>
            </button>
          </div>
        </div>
        {isDetail && (
          <div className="pp-item-detail">
            <div className="pp-detail-card">
              <div className="pp-detail-row"><span>Category</span><span style={{color:cc(item.category)}}>{item.category}</span></div>
              <div className="pp-detail-row"><span>Unit</span><span>{item.unit}</span></div>
              {item.lastPrice > 0 && <div className="pp-detail-row"><span>Last Price</span><span>{fmt(item.lastPrice)}{item.lastPriceVendor?` · ${item.lastPriceVendor}`:""}</span></div>}
              {item.lastPriceDate && <div className="pp-detail-row"><span>Price Date</span><span>{item.lastPriceDate}</span></div>}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ── Drop target button ── */
  const DropBtn = ({ targetId, label }) => {
    if (!hasPicked) return null;
    return (
      <button className="pp-drop-btn" onClick={e => { e.stopPropagation(); dropInto(targetId); }}>
        <I d={ico.download} size={13} color="#2563eb" sw={2.5}/> Drop {picked.size} item{picked.size!==1?"s":""}
      </button>
    );
  };

  /* ── Zone management ── */
  const closeMenu = () => { setMenuLoc(null); };

  const startAddShelf = (zoneId) => {
    closeMenu();
    setAddingShelf(zoneId);
    setShelfName("");
    if (openZone !== zoneId) setOpenZone(zoneId);
  };

  const saveNewShelf = async (parentZoneId) => {
    const name = shelfName.trim();
    if (!name) { setAddingShelf(null); return; }
    const updated = locations.map(l => ({
      locationId: l.locationId, name: l.name, icon: l.icon,
      sortOrder: l.sortOrder, parentLocationId: l.parentLocationId || null, color: l.color || "",
    }));
    const parentSubs = locations.filter(l => l.parentLocationId === parentZoneId);
    updated.push({
      name, icon: "box", sortOrder: parentSubs.length,
      parentLocationId: parentZoneId, color: "",
    });
    const ok = await onSaveLocations?.(updated);
    if (ok !== false) showToast?.(`"${name}" shelf added`, "success");
    setAddingShelf(null); setShelfName("");
  };

  const startRename = (loc) => {
    closeMenu();
    setRenamingLoc(loc.locationId);
    setRenameVal(loc.name);
  };

  const saveRename = async (locId) => {
    const name = renameVal.trim();
    if (!name || name === locMap[locId]?.name) { setRenamingLoc(null); return; }
    const updated = locations.map(l => ({
      locationId: l.locationId, name: l.locationId === locId ? name : l.name,
      icon: l.icon, sortOrder: l.sortOrder,
      parentLocationId: l.parentLocationId || null, color: l.color || "",
    }));
    const ok = await onSaveLocations?.(updated);
    if (ok !== false) showToast?.(`Renamed to "${name}"`, "success");
    setRenamingLoc(null); setRenameVal("");
  };

  const removeSubZone = async (sub) => {
    const items = byLoc[sub.locationId] || [];
    if (items.length > 0) {
      showToast?.(`Move ${items.length} item${items.length!==1?"s":""} out first`, "error");
      return;
    }
    const updated = locations
      .filter(l => l.locationId !== sub.locationId)
      .map(l => ({
        locationId: l.locationId, name: l.name, icon: l.icon,
        sortOrder: l.sortOrder, parentLocationId: l.parentLocationId || null, color: l.color || "",
      }));
    const ok = await onSaveLocations?.(updated);
    if (ok !== false) showToast?.(`"${sub.name}" removed`, "success");
    closeMenu();
  };

  // Close menu on outside click
  useEffect(() => {
    if (!menuLoc) return;
    const handler = () => setMenuLoc(null);
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [menuLoc]);

  /* ── Three-dot menu ── */
  const ThreeDot = ({ loc, isSub = false }) => {
    const isOpen = menuLoc === loc.locationId;
    return (
      <div className="pp-dots-wrap">
        <button className="pp-dots-btn" onClick={e => { e.stopPropagation(); setMenuLoc(isOpen ? null : loc.locationId); }}>
          <I d={ico.dots} size={16} color="#94a3b8"/>
        </button>
        {isOpen && (
          <div className="pp-dots-menu" onClick={e => e.stopPropagation()}>
            {!isSub && <button onClick={() => startAddShelf(loc.locationId)}><I d={ico.plus} size={13} color="#64748b"/> Add shelf</button>}
            <button onClick={() => startRename(loc)}><I d={ico.edit} size={13} color="#64748b"/> Rename</button>
            {isSub && <button className="pp-dots-menu-danger" onClick={() => removeSubZone(loc)}><I d={ico.trash} size={13} color="#dc2626"/> Remove</button>}
          </div>
        )}
      </div>
    );
  };

  /* ── Sub-zone row ── */
  // Helper: did items just drop into this location?
  const isDrop = (locId) => {
    return [...dropped].some(id => {
      const eLoc = moves[id];
      return eLoc === locId;
    });
  };

  const renderSubZone = (sub) => {
    const items = byLoc[sub.locationId] || [];
    const isOpen = openSubs.has(sub.locationId);
    const sc = zc(sub.color || locMap[sub.parentLocationId]?.color);

    return (
      <div key={sub.locationId} className="pp-sub">
        <div className={`pp-sub-header${isOpen?" open":""}${hasPicked?" droppable":""}`}>
          <button className="pp-sub-toggle" onClick={() => toggleSub(sub.locationId)}>
            <span className="pp-sub-icon" style={{background:sc.bg}}>{ri(sub.icon)}</span>
            {renamingLoc === sub.locationId ? (
              <input className="pp-rename-input pp-rename-input--sm" value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if(e.key==="Enter") saveRename(sub.locationId); if(e.key==="Escape") setRenamingLoc(null); }}
                onBlur={() => saveRename(sub.locationId)} autoFocus
                onClick={e => e.stopPropagation()}/>
            ) : (
              <span className="pp-sub-name">{sub.name}</span>
            )}
            <span className={`pp-sub-count${isDrop(sub.locationId)?" bounce":""}`}>{items.length}</span>
            <I d={isOpen?ico.chevUp:ico.chevDown} size={14} color="#94a3b8"/>
          </button>
          {!hasPicked && <ThreeDot loc={sub} isSub/>}
          <DropBtn targetId={sub.locationId}/>
        </div>
        <div className={`pp-accordion${isOpen?" open":""}`}>
          <div className="pp-accordion-inner">
            {items.length === 0
              ? <div className="pp-empty-sub">No items on this shelf yet</div>
              : items.map(i => renderItem(i))}
          </div>
        </div>
      </div>
    );
  };

  /* ══════════════════════════════════ */
  /* RENDER                             */
  /* ══════════════════════════════════ */
  return (
    <div className="pp-root">
      <div className="pp-card">

        {/* ── Header ── */}
        <div className="pp-header">
          <div className="pp-header-left">
            <h3 className="pp-title">Product Placement</h3>
            <p className="pp-subtitle">{catalogItems.length} items · {topZones.length} locations</p>
          </div>
          <div className="pp-header-right">
            {searchOn ? (
              <div className="pp-search-bar">
                <input className="pp-search-input" placeholder="Search..." value={search}
                  onChange={e => setSearch(e.target.value)} autoFocus/>
                <button className="pp-search-x" onClick={() => { setSearchOn(false); setSearch(""); }}>
                  <I d={ico.x} size={14} color="#64748b"/>
                </button>
              </div>
            ) : (
              <button className="pp-search-btn" onClick={() => setSearchOn(true)}>
                <I d={ico.search} size={16} color="#64748b"/>
              </button>
            )}
          </div>
        </div>

        {/* ── Unassigned section ── */}
        {uaCount > 0 && (
          <div className={`pp-ua${uaOpen?" open":""}`}>
            <div className={`pp-ua-header${hasPicked?" droppable":""}`}>
              <button className="pp-ua-toggle" onClick={() => setUaOpen(!uaOpen)}>
                <span className="pp-ua-badge">{uaCount}</span>
                <span className="pp-ua-text">items waiting to be placed</span>
                <I d={uaOpen?ico.chevUp:ico.chevDown} size={16} color="#92400e"/>
              </button>
              {hasPicked && (
                <button className="pp-drop-btn pp-drop-btn--amber" onClick={e => { e.stopPropagation(); dropInto("__ua"); }}>
                  <I d={ico.download} size={13} color="#92400e" sw={2.5}/> Unassign {picked.size}
                </button>
              )}
            </div>
            <div className={`pp-accordion${uaOpen?" open":""}`}>
              <div className="pp-accordion-inner pp-ua-items">
                {(() => {
                  const groups = {};
                  uaItems.forEach(i => { const c = i.category||"Other"; if(!groups[c])groups[c]=[]; groups[c].push(i); });
                  return Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([cat, items]) => (
                    <div key={cat} className="pp-ua-group">
                      <div className="pp-ua-group-header">
                        <span className="pp-ua-dot" style={{background:cc(cat)}}/> {cat} <span className="pp-ua-group-ct">{items.length}</span>
                      </div>
                      {items.map(i => renderItem(i, true))}
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}

        {/* ── Zones ── */}
        <div className="pp-zones">
          {topZones.map(zone => {
            const isOpen = openZone === zone.locationId;
            const total = zoneCount(zone.locationId);
            const zoneItems = byLoc[zone.locationId] || []; // direct items (not in sub-zone)
            const subs = locations.filter(l => l.parentLocationId === zone.locationId);
            const zcol = zc(zone.color);

            return (
              <div key={zone.locationId} className={`pp-zone${isOpen?" open":""}`}>
                {/* Zone header */}
                <div className={`pp-zone-header${hasPicked?" droppable":""}`} style={{borderLeftColor:zcol.fg}}>
                  <button className="pp-zone-toggle" onClick={() => toggleZone(zone.locationId)}>
                    <div className="pp-zone-icon" style={{background:zcol.bg}}>{ri(zone.icon)}</div>
                    <div className="pp-zone-info">
                      {renamingLoc === zone.locationId ? (
                        <input className="pp-rename-input" value={renameVal} onChange={e => setRenameVal(e.target.value)}
                          onKeyDown={e => { if(e.key==="Enter") saveRename(zone.locationId); if(e.key==="Escape") setRenamingLoc(null); }}
                          onBlur={() => saveRename(zone.locationId)} autoFocus
                          onClick={e => e.stopPropagation()}/>
                      ) : (
                        <span className="pp-zone-name">{zone.name}</span>
                      )}
                      <span className="pp-zone-meta">
                        <span className={`pp-zone-ct${isDrop(zone.locationId)?" bounce":""}`}>{total} item{total!==1?"s":""}</span>
                        {subs.length > 0 && <span className="pp-zone-subs"> · {subs.length} shelf{subs.length!==1?"ves":""}</span>}
                      </span>
                    </div>
                    <I d={isOpen?ico.chevUp:ico.chevDown} size={16} color="#94a3b8"/>
                  </button>
                  {!hasPicked && <ThreeDot loc={zone}/>}
                  <DropBtn targetId={zone.locationId}/>
                </div>

                {/* Zone body (accordion) */}
                <div className={`pp-accordion${isOpen?" open":""}`}>
                  <div className="pp-accordion-inner">
                    {subs.length > 0 ? (<>
                      {/* Items directly in zone (not in a sub-zone) */}
                      {zoneItems.length > 0 && (
                        <div className="pp-general">
                          <div className="pp-general-label">General</div>
                          {zoneItems.map(i => renderItem(i))}
                        </div>
                      )}
                      {/* Sub-zones */}
                      {subs.map(renderSubZone)}
                      {/* Add shelf input */}
                      {addingShelf === zone.locationId ? (
                        <div className="pp-add-shelf">
                          <I d={ico.plus} size={14} color="#d97706"/>
                          <input className="pp-add-shelf-input" placeholder="Shelf name..." value={shelfName}
                            onChange={e => setShelfName(e.target.value)} autoFocus
                            onKeyDown={e => { if(e.key==="Enter") saveNewShelf(zone.locationId); if(e.key==="Escape") setAddingShelf(null); }}
                            onBlur={() => { if(shelfName.trim()) saveNewShelf(zone.locationId); else setAddingShelf(null); }}/>
                        </div>
                      ) : (
                        <button className="pp-add-shelf-btn" onClick={() => startAddShelf(zone.locationId)}>
                          <I d={ico.plus} size={13} color="#d97706"/> Add shelf
                        </button>
                      )}
                    </>) : (<>
                      {/* No sub-zones: items directly */}
                      {total === 0
                        ? <div className="pp-empty-zone">No items here yet. Pick up items and drop them in this zone.</div>
                        : zoneItems.map(i => renderItem(i))}
                    </>)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Pickup Tray / Save Bar ── */}
      {(hasPicked || pendingCount > 0) && (
        <div className={`pp-tray${hasPicked?" pp-tray--pickup":" pp-tray--save"}`}>
          <div className="pp-tray-inner">
            {hasPicked ? (<>
              <div className="pp-tray-left">
                <span className="pp-tray-count">{picked.size}</span>
                <span className="pp-tray-text">item{picked.size!==1?"s":""} picked up · tap a zone to place</span>
              </div>
              <div className="pp-tray-right">
                {pendingCount > 0 && <span className="pp-tray-badge">{pendingCount} unsaved</span>}
                <button className="pp-tray-clear" onClick={() => setPicked(new Set())}>Put back</button>
              </div>
            </>) : (<>
              <div className="pp-tray-left">
                <span className="pp-tray-count">{pendingCount}</span>
                <span className="pp-tray-text">change{pendingCount!==1?"s":""}</span>
                <button className="pp-tray-clear" onClick={() => { setMoves({}); showToast?.("Cleared","info"); }}>clear</button>
              </div>
              <button className="pp-tray-save" onClick={handleSave} disabled={saving}>{saving?"Saving...":"Save Changes"}</button>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}
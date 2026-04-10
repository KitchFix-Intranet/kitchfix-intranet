"use client";
import { useState, useMemo, useCallback, useEffect } from "react";

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

const IE = {
  snowflake:"❄️",ice:"🧊",thermometer:"🌡️",
  drumstick:"🍖",steak:"🥩",poultry:"🍗",bacon:"🥓",turkey:"🦃",
  fish:"🐟",shrimp:"🦐",lobster:"🦞",crab:"🦀",oyster:"🦪",squid:"🦑",octopus:"🐙",
  carrot:"🥕",leaf:"🍃",greens:"🥬",broccoli:"🥦",lettuce:"🥗",tomato:"🍅",pepper:"🌶️",bellpepper:"🫑",corn:"🌽",mushroom:"🍄",onion:"🧅",garlic:"🧄",potato:"🥔",avocado:"🥑",cucumber:"🥒",eggplant:"🍆",peas:"🫛",olive:"🫒",beans:"🫘",
  apple:"🍎",lemon:"🍋",orange:"🍊",banana:"🍌",grape:"🍇",strawberry:"🍓",blueberry:"🫐",cherry:"🍒",peach:"🍑",watermelon:"🍉",pineapple:"🍍",mango:"🥭",kiwi:"🥝",pear:"🍐",coconut:"🥥",
  egg:"🥚",cheese:"🧀",butter:"🧈",milk:"🥛",
  bread:"🍞",croissant:"🥐",bagel:"🥯",baguette:"🥖",flatbread:"🫓",pretzel:"🥨",pancakes:"🥞",waffle:"🧇",rice:"🍚",noodles:"🍜",
  flame:"🔥",plate:"🍽️",stew:"🍲",casserole:"🥘",curry:"🍛",fondue:"🫕",taco:"🌮",burrito:"🌯",pizza:"🍕",hotdog:"🌭",sandwich:"🥪",pita:"🥙",falafel:"🧆",dumpling:"🥟",sushi:"🍣",bento:"🍱",
  cookie:"🍪",cupcake:"🧁",donut:"🍩",pie:"🥧",chocolate:"🍫",candy:"🍬",icecream:"🍦",popcorn:"🍿",honey:"🍯",peanut:"🥜",chestnut:"🌰",
  cup:"☕",tea:"🍵",boba:"🧋",juice:"🧃",soda:"🥤",water:"💧",wine:"🍷",beer:"🍺",cocktail:"🍸",
  salt:"🧂",jar:"🫙",
  knife:"🔪",sponge:"🧽",bucket:"🪣",broom:"🧹",gloves:"🧤",wrench:"🔧",extinguisher:"🧯",trash:"🗑️",
  box:"📦",paper:"📋",tag:"🏷️",cabinet:"🗄️",
  stadium:"🏟️",truck:"🚛",chart:"📊",star:"⭐",can:"🥫"
};
const ri = ic => { if(!ic) return "📦"; if(ic.codePointAt(0)>127) return ic; return IE[ic]||"📦"; };

const CC = {"FOOD":"#16A34A","Food":"#16A34A","BEVERAGES":"#8b5cf6","Beverages":"#8b5cf6","SNACKS":"#f59e0b","Snacks":"#f59e0b","PACKAGING":"#64748b","Packaging":"#64748b","SUPPLIES":"#94a3b8","Supplies":"#94a3b8","PROTEIN":"#dc2626","Protein":"#dc2626","PRODUCE":"#22c55e","Produce":"#22c55e","DAIRY":"#3b82f6","Dairy":"#3b82f6","DRY GOODS":"#d97706","Dry Goods":"#d97706","SEAFOOD":"#0891b2","Seafood":"#0891b2","BAKERY":"#ea580c","Bakery":"#ea580c","FROZEN":"#6366f1","Frozen":"#6366f1"};
const cc = c => CC[c]||"#64748b";
const ZC = {blue:{bg:"#dbeafe",fg:"#2563eb"},indigo:{bg:"#e0e7ff",fg:"#4f46e5"},amber:{bg:"#fef3c7",fg:"#d97706"},green:{bg:"#dcfce7",fg:"#16a34a"},red:{bg:"#fee2e2",fg:"#dc2626"},purple:{bg:"#f3e8ff",fg:"#9333ea"},slate:{bg:"#f1f5f9",fg:"#475569"},teal:{bg:"#ccfbf1",fg:"#0d9488"},orange:{bg:"#ffedd5",fg:"#ea580c"},gold:{bg:"#fef9c3",fg:"#ca8a04"},brown:{bg:"#f5e6d3",fg:"#92400e"},cyan:{bg:"#cffafe",fg:"#0891b2"},pink:{bg:"#fce7f3",fg:"#db2777"},emerald:{bg:"#d1fae5",fg:"#059669"}};
const zc = c => ZC[c]||ZC.blue;

const ICON_KEYS = Object.keys(IE);
const ZONE_COLORS = [
  {key:"blue",bg:"#dbeafe",fg:"#2563eb"},{key:"indigo",bg:"#e0e7ff",fg:"#4f46e5"},
  {key:"amber",bg:"#fef3c7",fg:"#d97706"},{key:"teal",bg:"#ccfbf1",fg:"#0d9488"},
  {key:"slate",bg:"#e2e8f0",fg:"#475569"},{key:"green",bg:"#dcfce7",fg:"#16a34a"},
  {key:"orange",bg:"#fff7ed",fg:"#ea580c"},{key:"gold",bg:"#fefce8",fg:"#ca8a04"},
  {key:"brown",bg:"#fef3c7",fg:"#78350f"},{key:"cyan",bg:"#e0f2fe",fg:"#0891b2"},
  {key:"pink",bg:"#fce7f3",fg:"#db2777"},{key:"emerald",bg:"#d1fae5",fg:"#059669"},
  {key:"purple",bg:"#ede9fe",fg:"#7c3aed"},{key:"red",bg:"#fee2e2",fg:"#dc2626"},
  {key:"rose",bg:"#ffe4e6",fg:"#e11d48"},{key:"lime",bg:"#ecfccb",fg:"#65a30d"},
];

const AUTO_RULES = [
  { p:["cool","fridge","refrig","reach-in","walk-in c"], icon:"snowflake", color:"blue" },
  { p:["freez","frost"], icon:"ice", color:"indigo" },
  { p:["dry","pantry","shelf","storage room"], icon:"box", color:"amber" },
  { p:["bev","drink","bar","juice","soda"], icon:"cup", color:"cyan" },
  { p:["supply","suppli","clean","chem","sanit"], icon:"broom", color:"slate" },
  { p:["prep","line","hot","grill"], icon:"flame", color:"orange" },
  { p:["snack","chip","candy","cookie","foh s"], icon:"cookie", color:"purple" },
  { p:["protein","meat","butcher"], icon:"steak", color:"red" },
  { p:["produce","veg","fruit","fresh"], icon:"carrot", color:"emerald" },
  { p:["dairy","milk","cheese"], icon:"milk", color:"blue" },
  { p:["seafood","fish","shrimp"], icon:"shrimp", color:"teal" },
];
function autoIC(n) { const l = (n||"").toLowerCase(); for (const r of AUTO_RULES) { if (r.p.some(x => l.includes(x))) return { icon: r.icon, color: r.color }; } return { icon: "box", color: "slate" }; }
const SUGGESTED = ["Walk-in Cooler","Walk-in Freezer","Dry Storage","FOH Snacks","FOH Beverages","Supply Closet"];

export default function ProductPlacement({ catalogItems, locations, onBatchMove, onDirtyChange, onSaveLocations, onAddSubZone, onDeactivateLocation, onSaveSortOrder, onUpdateLocation, onExcludeItem, showToast }) {
      const [locs, setLocs] = useState(locations);
  useEffect(() => { setLocs(locations); }, [locations]);

  const [openZone, setOpenZone] = useState(null);
  const [openSubs, setOpenSubs] = useState(new Set());
  const [uaOpen, setUaOpen] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [moves, setMoves] = useState({});
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [searchOn, setSearchOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dropped, setDropped] = useState(new Set());
  const [menuLoc, setMenuLoc] = useState(null);
  const [addingSub, setAddingSub] = useState(null);
  const [subName, setSubName] = useState("");
  const [renamingLoc, setRenamingLoc] = useState(null);
  const [renameVal, setRenameVal] = useState("");
  const [pickerLoc, setPickerLoc] = useState(null);
  const [pickerIcon, setPickerIcon] = useState(null);
  const [pickerColor, setPickerColor] = useState(null);
  const [addingZone, setAddingZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmExclude, setConfirmExclude] = useState(null);
  const [excludedIds, setExcludedIds] = useState(new Set());

  const pendingCount = Object.keys(moves).length;
  const hasPicked = picked.size > 0;
  useEffect(() => { onDirtyChange?.(pendingCount > 0); }, [pendingCount]); // eslint-disable-line

  const visibleItems = useMemo(() => catalogItems.filter(i => !excludedIds.has(i.itemId)), [catalogItems, excludedIds]);
  const locMap = useMemo(() => { const m = {}; locs.forEach(l => { m[l.locationId] = l; }); return m; }, [locs]);
  const topZones = useMemo(() => locs.filter(l => !l.parentLocationId).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0)), [locs]);
  const activeIds = useMemo(() => new Set(locs.map(l => l.locationId)), [locs]);

  const byLoc = useMemo(() => {
    const m = { __ua: [] };
    locs.forEach(l => { m[l.locationId] = []; });
    visibleItems.forEach(item => {
      const eLoc = moves[item.itemId] !== undefined ? moves[item.itemId] : item.locationId;
      if (!eLoc || !activeIds.has(eLoc)) m.__ua.push(item);
      else { if (!m[eLoc]) m[eLoc] = []; m[eLoc].push(item); }
    });
    Object.values(m).forEach(a => a.sort((x,y) => x.name.localeCompare(y.name)));
    return m;
  }, [visibleItems, locs, moves, activeIds]);

  const zoneCount = useCallback((zid) => {
    let n = (byLoc[zid]||[]).length;
    locs.filter(l => l.parentLocationId === zid).forEach(s => { n += (byLoc[s.locationId]||[]).length; });
    return n;
  }, [byLoc, locs]);

  const uaItems = byLoc.__ua || [];
  const uaCount = uaItems.length;
  const matchSearch = useCallback((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q) || (item.primaryVendor||"").toLowerCase().includes(q);
  }, [search]);

  const toggleZone = (zid) => { setOpenZone(prev => prev === zid ? null : zid); setOpenSubs(new Set()); setDetail(null); };
  const toggleSub = (sid) => { setOpenSubs(prev => { const s = new Set(prev); s.has(sid) ? s.delete(sid) : s.add(sid); return s; }); setDetail(null); };
  const togglePick = (itemId) => { setPicked(prev => { const s = new Set(prev); s.has(itemId) ? s.delete(itemId) : s.add(itemId); return s; }); setDetail(null); };

  const dropInto = (targetId) => {
    if (picked.size === 0) return;
    const newMoves = {};
    picked.forEach(id => { const orig = visibleItems.find(i => i.itemId === id); const origLoc = orig?.locationId || ""; const target = targetId === "__ua" ? "" : targetId; if (target !== origLoc) newMoves[id] = target; });
    setMoves(prev => ({ ...prev, ...newMoves }));
    const ids = new Set(Object.keys(newMoves));
    setDropped(ids); setTimeout(() => setDropped(new Set()), 500); setPicked(new Set());
    const dest = targetId === "__ua" ? "Unassigned" : (locMap[targetId]?.name || "Unknown");
    if (ids.size > 0) showToast?.(`${ids.size} item${ids.size!==1?"s":""} placed in ${dest}`, "success");
  };

  const handleSave = async () => {
    if (pendingCount === 0) return;
    setSaving(true);
    const items = Object.entries(moves).map(([itemId, loc]) => ({ itemId, newLocationId: loc }));
    try { await onBatchMove(items); setMoves({}); showToast?.(`${items.length} item${items.length!==1?"s":""} saved`, "success"); }
    catch { showToast?.("Save failed", "error"); }
    finally { setSaving(false); }
  };

  const renderItem = (item, showCat = false) => {
    const isPicked = picked.has(item.itemId); const isMoved = item.itemId in moves;
    const isJustDropped = dropped.has(item.itemId); const isDetail = detail === item.itemId;
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
            <button className="pp-item-info" onClick={e => { e.stopPropagation(); setDetail(isDetail ? null : item.itemId); }} aria-label="Item details">
              <I d={ico.info} size={15} color={isDetail?"#2563eb":"#cbd5e1"} sw={1.5}/>
            </button>
          </div>
        </div>
        {isDetail && (<div className="pp-item-detail"><div className="pp-detail-card">
          <div className="pp-detail-row"><span>Category</span><span style={{color:cc(item.category)}}>{item.category}</span></div>
          <div className="pp-detail-row"><span>Unit</span><span>{item.unit}</span></div>
          {item.lastPrice > 0 && <div className="pp-detail-row"><span>Last Price</span><span>{fmt(item.lastPrice)}{item.lastPriceVendor?` · ${item.lastPriceVendor}`:""}</span></div>}
          {item.lastPriceDate && <div className="pp-detail-row"><span>Price Date</span><span>{item.lastPriceDate}</span></div>}
          <button className="pp-exclude-btn" onClick={e => { e.stopPropagation(); setConfirmExclude(item); }}>
            <I d={ico.trash} size={12} color="#dc2626" sw={2}/> Remove from inventory
          </button>
        </div></div>)}
      </div>
    );
  };

  const renderDropBtn = (targetId) => {
    if (!hasPicked) return null;
    return (<button className="pp-drop-btn" onClick={e => { e.stopPropagation(); dropInto(targetId); }}>
      <I d={ico.download} size={13} color="#2563eb" sw={2.5}/> Drop {picked.size} item{picked.size!==1?"s":""}
    </button>);
  };

  /* ═══════════════════════════════════
     OPTIMISTIC ZONE MANAGEMENT
     ═══════════════════════════════════ */
  const closeMenu = () => { setMenuLoc(null); };

  const addZone = (name) => {
    const n = (name || "").trim();
    if (!n) return;
    if (locs.some(l => !l.parentLocationId && l.name.toLowerCase() === n.toLowerCase())) { showToast?.("Zone already exists", "error"); return; }
    const { icon, color } = autoIC(n);
    const tempId = `loc_temp_${Date.now()}`;
    setLocs(prev => [...prev, { locationId: tempId, name: n, icon, color, sortOrder: topZones.length, parentLocationId: "" }]);
    setNewZoneName(""); setAddingZone(false);
    showToast?.(`"${n}" zone added`, "success");
onAddSubZone?.("", n, icon, color);
  };

  const startAddSub = (zoneId) => { closeMenu(); setAddingSub(zoneId); setSubName(""); if (openZone !== zoneId) setOpenZone(zoneId); };
  const saveNewSub = (parentZoneId) => {
    const name = subName.trim();
    if (!name) { setAddingSub(null); return; }
    const tempId = `loc_temp_${Date.now()}`;
    const parentSubs = locs.filter(l => l.parentLocationId === parentZoneId);
const { icon: subIcon, color: subColor } = autoIC(name);
    setLocs(prev => [...prev, { locationId: tempId, name, icon: subIcon, color: subColor, sortOrder: parentSubs.length, parentLocationId: parentZoneId }]);
        setAddingSub(null); setSubName("");
    showToast?.(`"${name}" added`, "success");
onAddSubZone?.(parentZoneId, name, subIcon);
  };

  const startRename = (loc) => { closeMenu(); setRenamingLoc(loc.locationId); setRenameVal(loc.name); };
const saveRename = (locId) => {
    const name = renameVal.trim();
    if (!name || name === locMap[locId]?.name) { setRenamingLoc(null); return; }
    setLocs(prev => prev.map(l => l.locationId === locId ? { ...l, name } : l));
    setRenamingLoc(null); setRenameVal("");
    showToast?.(`Renamed to "${name}"`, "success");
    onUpdateLocation?.(locId, { name });
  };
  
  const requestDelete = (loc) => {
    const total = zoneCount(loc.locationId);
    if (total > 0) { showToast?.(`Move ${total} item${total!==1?"s":""} out first`, "error"); return; }
    const subs = locs.filter(l => l.parentLocationId === loc.locationId);
    if (subs.length > 0 && subs.some(s => (byLoc[s.locationId]||[]).length > 0)) {
      showToast?.("Move items out of sub-zones first", "error"); return;
    }
    closeMenu();
    setConfirmDelete(loc);
  };
  const executeDelete = () => {
    if (!confirmDelete) return;
    const loc = confirmDelete;
    const subs = locs.filter(l => l.parentLocationId === loc.locationId);
    if (subs.length > 0) {
      setLocs(prev => prev.filter(l => l.locationId !== loc.locationId && l.parentLocationId !== loc.locationId));
      subs.forEach(s => onDeactivateLocation?.(s.locationId));
    } else {
      setLocs(prev => prev.filter(l => l.locationId !== loc.locationId));
    }
    showToast?.(`"${loc.name}" removed`, "success");
    onDeactivateLocation?.(loc.locationId);
    setConfirmDelete(null);
  };

  const openPicker = (loc) => { closeMenu(); setPickerLoc(loc.locationId); setPickerIcon(loc.icon || "box"); setPickerColor(loc.color || "blue"); };
const savePicker = () => {
    if (!pickerLoc) return;
    setLocs(prev => prev.map(l => l.locationId === pickerLoc ? { ...l, icon: pickerIcon, color: pickerColor } : l));
    showToast?.("Icon & color updated", "success");
    setPickerLoc(null);
    onUpdateLocation?.(pickerLoc, { icon: pickerIcon, color: pickerColor });
  };

  const moveLocation = (loc, direction) => {
    closeMenu();
    const siblings = loc.parentLocationId
      ? locs.filter(l => l.parentLocationId === loc.parentLocationId).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0))
      : topZones;
    const idx = siblings.findIndex(s => s.locationId === loc.locationId);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const a = siblings[idx], b = siblings[swapIdx];
    const updates = [{ locationId: a.locationId, sortOrder: b.sortOrder }, { locationId: b.locationId, sortOrder: a.sortOrder }];
    setLocs(prev => prev.map(l => { const u = updates.find(u => u.locationId === l.locationId); return u ? { ...l, sortOrder: u.sortOrder } : l; }));
    onSaveSortOrder?.(updates);
  };

  useEffect(() => {
    if (!menuLoc) return;
    const handler = () => setMenuLoc(null);
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [menuLoc]);

  const renderThreeDot = (loc, isSub = false) => {
    const isOpen = menuLoc === loc.locationId;
    const siblings = loc.parentLocationId
      ? locs.filter(l => l.parentLocationId === loc.parentLocationId).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0))
      : topZones;
    const idx = siblings.findIndex(s => s.locationId === loc.locationId);
    const canUp = idx > 0; const canDown = idx < siblings.length - 1;
    return (
      <div className="pp-dots-wrap">
        <button className="pp-dots-btn" onClick={e => { e.stopPropagation(); setMenuLoc(isOpen ? null : loc.locationId); }}><I d={ico.dots} size={16} color="#94a3b8"/></button>
        {isOpen && (
          <div className="pp-dots-menu" onClick={e => e.stopPropagation()}>
            {!isSub && <button onClick={() => startAddSub(loc.locationId)}><I d={ico.plus} size={13} color="#64748b"/> Add sub-zone</button>}
            <button onClick={() => startRename(loc)}><I d={ico.edit} size={13} color="#64748b"/> Rename</button>
            <button onClick={() => openPicker(loc)}><span style={{fontSize:13}}>🎨</span> Change icon</button>
            {canUp && <button onClick={() => moveLocation(loc, -1)}><I d={ico.chevUp} size={13} color="#64748b"/> Move up</button>}
            {canDown && <button onClick={() => moveLocation(loc, 1)}><I d={ico.chevDown} size={13} color="#64748b"/> Move down</button>}
            <button className="pp-dots-menu-danger" onClick={() => requestDelete(loc)}><I d={ico.trash} size={13} color="#dc2626"/> Delete</button>
          </div>
        )}
      </div>
    );
  };

  const isDrop = (locId) => [...dropped].some(id => moves[id] === locId);

  const renderSubZone = (sub) => {
const items = byLoc[sub.locationId] || []; const isOpen = openSubs.has(sub.locationId) || (search.trim().length > 0);
const sc = zc(sub.color || locMap[sub.parentLocationId]?.color);
    if (search.trim() && !items.some(i => matchSearch(i))) return null;
    return (
      <div key={sub.locationId} className="pp-sub">
        <div className={`pp-sub-header${isOpen?" open":""}${hasPicked?" droppable":""}`}>
          <button className="pp-sub-toggle" onClick={() => toggleSub(sub.locationId)}>
            <span className="pp-sub-icon" style={{background:sc.bg}}>{ri(sub.icon)}</span>
            {renamingLoc === sub.locationId ? (
              <input className="pp-rename-input pp-rename-input--sm" value={renameVal} onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if(e.key==="Enter") saveRename(sub.locationId); if(e.key==="Escape") setRenamingLoc(null); }}
                onBlur={() => saveRename(sub.locationId)} autoFocus onClick={e => e.stopPropagation()}/>
            ) : (<span className="pp-sub-name">{sub.name}</span>)}
            <span className={`pp-sub-count${isDrop(sub.locationId)?" bounce":""}`}>{items.length}</span>
            <I d={isOpen?ico.chevUp:ico.chevDown} size={14} color="#94a3b8"/>
          </button>
          {!hasPicked && renderThreeDot(sub, true)}
          {renderDropBtn(sub.locationId)}
        </div>
        <div className={`pp-accordion${isOpen?" open":""}`}>
          <div className="pp-accordion-inner">
            {items.length === 0 ? <div className="pp-empty-sub">No items on this shelf yet</div> : items.map(i => renderItem(i))}
          </div>
        </div>
      </div>
    );
  };

  const usedNames = new Set(topZones.map(z => z.name.toLowerCase()));
  const suggestions = SUGGESTED.filter(s => !usedNames.has(s.toLowerCase()));

  return (
    <div className="pp-root">
      <div className="pp-card">
        <div className="pp-header">
          <div className="pp-header-left">
            <h3 className="pp-title">Product Placement</h3>
            <p className="pp-subtitle">{visibleItems.length} items · {topZones.length} zone{topZones.length!==1?"s":""}</p>
          </div>
          <div className="pp-header-right">
            {searchOn ? (
              <div className="pp-search-bar">
                <input className="pp-search-input" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} autoFocus/>
                <button className="pp-search-x" onClick={() => { setSearchOn(false); setSearch(""); }}><I d={ico.x} size={14} color="#64748b"/></button>
              </div>
            ) : (
              <button className="pp-search-btn" onClick={() => setSearchOn(true)}><I d={ico.search} size={16} color="#64748b"/></button>
            )}
          </div>
        </div>

        {topZones.length === 0 && !addingZone && (
          <div className="pp-empty-state">
            <span style={{fontSize:32}}>📦</span>
            <h3 className="pp-empty-title">Set up your storage zones</h3>
            <p className="pp-empty-desc">Add zones for your walk-ins, dry storage, and other areas. Then organize items into each zone.</p>
            {suggestions.length > 0 && (
              <div className="pp-suggest">
                <span className="pp-suggest-label">Quick add:</span>
                <div className="pp-suggest-chips">
                  {suggestions.slice(0,4).map(s => (
                    <button key={s} className="pp-suggest-chip" onClick={() => addZone(s)}>+ {s}</button>
                  ))}
                </div>
              </div>
            )}
            <button className="pp-add-zone-btn" onClick={() => setAddingZone(true)}>
              <I d={ico.plus} size={14} color="#fff"/> Add Zone
            </button>
          </div>
        )}

        {uaCount > 0 && topZones.length > 0 && (!search.trim() || uaItems.some(i => matchSearch(i))) && (
          <div className={`pp-ua${uaOpen?" open":""}`}>
            <div className={`pp-ua-header${hasPicked?" droppable":""}`}>
              <button className="pp-ua-toggle" onClick={() => setUaOpen(!uaOpen)}>
                <span className="pp-ua-badge">{uaCount}</span>
                <span className="pp-ua-text">items waiting to be placed</span>
                <I d={uaOpen?ico.chevUp:ico.chevDown} size={16} color="#92400e"/>
              </button>
              {hasPicked && (<button className="pp-drop-btn pp-drop-btn--amber" onClick={e => { e.stopPropagation(); dropInto("__ua"); }}>
                <I d={ico.download} size={13} color="#92400e" sw={2.5}/> Unassign {picked.size}
              </button>)}
            </div>
            <div className={`pp-accordion${uaOpen || search.trim()?" open":""}`}>
              <div className="pp-accordion-inner pp-ua-items">
                {(() => {
                  const groups = {};
                  uaItems.forEach(i => { const c = i.category||"Other"; if(!groups[c])groups[c]=[]; groups[c].push(i); });
                  return Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([cat, items]) => (
                    <div key={cat} className="pp-ua-group">
{(() => { const filtered = items.filter(matchSearch); if (search.trim() && filtered.length === 0) return null; return (<>
                        <div className="pp-ua-group-header"><span className="pp-ua-dot" style={{background:cc(cat)}}/> {cat} <span className="pp-ua-group-ct">{search.trim() ? filtered.length : items.length}</span></div>
                        {items.map(i => renderItem(i, true))}
                      </>); })()}
                                          </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}

        <div className="pp-zones">
{topZones.map(zone => {
            const isOpen = openZone === zone.locationId || (search.trim().length > 0);
                        const total = zoneCount(zone.locationId);
            const zoneItems = byLoc[zone.locationId] || [];
            const subs = locs.filter(l => l.parentLocationId === zone.locationId).sort((a,b) => (a.sortOrder||0) - (b.sortOrder||0));
const zcol = zc(zone.color);
            // Hide zones with no matching items when searching
            if (search.trim()) {
              const allZoneItems = [...zoneItems, ...subs.flatMap(s => byLoc[s.locationId] || [])];
              if (!allZoneItems.some(i => matchSearch(i))) return null;
            }
            return (
                                              <div key={zone.locationId} className={`pp-zone${isOpen?" open":""}`}>
                <div className={`pp-zone-header${hasPicked?" droppable":""}`} style={{borderLeftColor:zcol.fg}}>
                  <button className="pp-zone-toggle" onClick={() => toggleZone(zone.locationId)}>
                    <div className="pp-zone-icon" style={{background:zcol.bg}}>{ri(zone.icon)}</div>
                    <div className="pp-zone-info">
                      {renamingLoc === zone.locationId ? (
                        <input className="pp-rename-input" value={renameVal} onChange={e => setRenameVal(e.target.value)}
                          onKeyDown={e => { if(e.key==="Enter") saveRename(zone.locationId); if(e.key==="Escape") setRenamingLoc(null); }}
                          onBlur={() => saveRename(zone.locationId)} autoFocus onClick={e => e.stopPropagation()}/>
                      ) : (<span className="pp-zone-name">{zone.name}</span>)}
                      <span className="pp-zone-meta">
                        <span className={`pp-zone-ct${isDrop(zone.locationId)?" bounce":""}`}>{total} item{total!==1?"s":""}</span>
                        {subs.length > 0 && <span className="pp-zone-subs"> · {subs.length} {subs.length !== 1 ? "sub-zones" : "sub-zone"}</span>}
                      </span>
                    </div>
                    <I d={isOpen?ico.chevUp:ico.chevDown} size={16} color="#94a3b8"/>
                  </button>
                  {!hasPicked && renderThreeDot(zone)}
                  {renderDropBtn(zone.locationId)}
                </div>
                <div className={`pp-accordion${isOpen?" open":""}`}>
                  <div className="pp-accordion-inner">
                    {subs.length > 0 ? (<>
                      {zoneItems.length > 0 && (<div className="pp-general"><div className="pp-general-label">General</div>{zoneItems.map(i => renderItem(i))}</div>)}
                      {subs.map(renderSubZone)}
                      {addingSub === zone.locationId ? (
                        <div className="pp-add-shelf">
                          <I d={ico.plus} size={14} color="#d97706"/>
                          <input className="pp-add-shelf-input" placeholder="Sub-zone name..." value={subName}
                            onChange={e => setSubName(e.target.value)} autoFocus
                            onKeyDown={e => { if(e.key==="Enter") saveNewSub(zone.locationId); if(e.key==="Escape") setAddingSub(null); }}
                            onBlur={() => { setTimeout(() => { if(subName.trim()) saveNewSub(zone.locationId); else setAddingSub(null); }, 150); }}/>
                        </div>
                      ) : (
                        <button className="pp-add-shelf-btn" onClick={() => startAddSub(zone.locationId)}>
                          <I d={ico.plus} size={13} color="#d97706"/> Add sub-zone
                        </button>
                      )}
                    </>) : (<>
                      {total === 0 && addingSub !== zone.locationId && <div className="pp-empty-zone">No items here yet. Pick up items and drop them in this zone.</div>}
                      {total > 0 && zoneItems.map(i => renderItem(i))}
                      {addingSub === zone.locationId ? (
                        <div className="pp-add-shelf">
                          <I d={ico.plus} size={14} color="#d97706"/>
                          <input className="pp-add-shelf-input" placeholder="Sub-zone name..." value={subName}
                            onChange={e => setSubName(e.target.value)} autoFocus
                            onKeyDown={e => { if(e.key==="Enter") saveNewSub(zone.locationId); if(e.key==="Escape") setAddingSub(null); }}
                            onBlur={() => { setTimeout(() => { if(subName.trim()) saveNewSub(zone.locationId); else setAddingSub(null); }, 150); }}/>
                        </div>
                      ) : (
                        <button className="pp-add-shelf-btn" onClick={() => startAddSub(zone.locationId)}>
                          <I d={ico.plus} size={13} color="#d97706"/> Add sub-zone
                        </button>
                      )}
                    </>)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {search.trim() && !uaItems.some(i => matchSearch(i)) && topZones.every(zone => {
          const zoneItems = byLoc[zone.locationId] || [];
          const subs = locs.filter(l => l.parentLocationId === zone.locationId);
          const allZoneItems = [...zoneItems, ...subs.flatMap(s => byLoc[s.locationId] || [])];
          return !allZoneItems.some(i => matchSearch(i));
        }) && (
          <div style={{textAlign:"center", padding:"32px 16px", color:"#94a3b8", fontSize:"13px"}}>
            No items match &ldquo;{search}&rdquo;
          </div>
        )}

        {topZones.length > 0 && (
          <div className="pp-add-zone-row">
            {addingZone ? (
              <div className="pp-add-zone-input-wrap">
                <input className="pp-add-zone-input" placeholder="Zone name..." value={newZoneName}
                  onChange={e => setNewZoneName(e.target.value)} autoFocus
                  onKeyDown={e => { if(e.key==="Enter") addZone(newZoneName); if(e.key==="Escape") { setAddingZone(false); setNewZoneName(""); } }}
                  onBlur={() => { if(newZoneName.trim()) addZone(newZoneName); else { setAddingZone(false); setNewZoneName(""); } }}/>
              </div>
            ) : (
              <button className="pp-add-zone-ghost" onClick={() => setAddingZone(true)}>
                <I d={ico.plus} size={13} color="#d97706"/> Add zone
              </button>
            )}
            {suggestions.length > 0 && topZones.length < 4 && !addingZone && (
              <div className="pp-suggest-inline">
                {suggestions.slice(0,3).map(s => (
                  <button key={s} className="pp-suggest-chip-sm" onClick={() => addZone(s)}>+ {s}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {(hasPicked || pendingCount > 0) && (
        <div className={`pp-tray${hasPicked?" pp-tray--pickup":" pp-tray--save"}`}>
          <div className="pp-tray-inner">
            {hasPicked ? (<>
              <div className="pp-tray-left"><span className="pp-tray-count">{picked.size}</span><span className="pp-tray-text">item{picked.size!==1?"s":""} picked up · tap a zone to place</span></div>
              <div className="pp-tray-right">{pendingCount > 0 && <span className="pp-tray-badge">{pendingCount} unsaved</span>}<button className="pp-tray-clear" onClick={() => setPicked(new Set())}>Put back</button></div>
            </>) : (<>
              <div className="pp-tray-left"><span className="pp-tray-count">{pendingCount}</span><span className="pp-tray-text">change{pendingCount!==1?"s":""}</span><button className="pp-tray-clear" onClick={() => { setMoves({}); showToast?.("Cleared","info"); }}>clear</button></div>
              <button className="pp-tray-save" onClick={handleSave} disabled={saving}>{saving?"Saving...":"Save Changes"}</button>
            </>)}
          </div>
        </div>
      )}

      {pickerLoc && (
        <div className="pp-save-overlay" onClick={() => setPickerLoc(null)}>
          <div className="pp-picker-card" onClick={e => e.stopPropagation()}>
            <div className="pp-picker-head">
              <span className="pp-picker-preview" style={{background: zc(pickerColor).bg}}>{ri(pickerIcon)}</span>
              <span className="pp-picker-label">Choose icon & color</span>
              <button className="pp-picker-done" onClick={savePicker}>Done</button>
            </div>
            <div className="pp-picker-icons">{ICON_KEYS.map(k => (
              <button key={k} className={`pp-picker-icon${pickerIcon===k?" active":""}`} onClick={() => setPickerIcon(k)}>{IE[k]}</button>
            ))}</div>
            <div className="pp-picker-colors">{ZONE_COLORS.map(c => (
              <button key={c.key} className={`pp-picker-color${pickerColor===c.key?" active":""}`} style={{background: c.fg}} onClick={() => setPickerColor(c.key)}/>
            ))}</div>
          </div>
        </div>
      )}

      {confirmExclude && (
        <div className="pp-save-overlay" onClick={() => setConfirmExclude(null)}>
          <div className="pp-confirm-card" onClick={e => e.stopPropagation()}>
            <div className="pp-confirm-icon"><I d={ico.x} size={22} color="#dc2626" sw={2.5}/></div>
            <h4 className="pp-confirm-title">Remove &quot;{confirmExclude.name}&quot;?</h4>
            <p className="pp-confirm-desc">This item will be removed from your catalog and won&apos;t be imported again from future invoices.</p>
            <div className="pp-confirm-btns">
              <button className="pp-confirm-cancel" onClick={() => setConfirmExclude(null)}>Cancel</button>
              <button className="pp-confirm-delete" onClick={() => {
                const item = confirmExclude;
                setExcludedIds(prev => new Set(prev).add(item.itemId));
                onExcludeItem?.(item.itemId);
                showToast?.(`"${item.name}" removed from inventory`, "success");
                setConfirmExclude(null);
                setDetail(null);
              }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="pp-save-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="pp-confirm-card" onClick={e => e.stopPropagation()}>
            <div className="pp-confirm-icon"><I d={ico.trash} size={22} color="#dc2626" sw={2}/></div>
            <h4 className="pp-confirm-title">Delete &quot;{confirmDelete.name}&quot;?</h4>
            <p className="pp-confirm-desc">This cannot be undone.{locs.filter(l => l.parentLocationId === confirmDelete.locationId).length > 0 ? " All empty sub-zones will also be removed." : ""}</p>
            <div className="pp-confirm-btns">
              <button className="pp-confirm-cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="pp-confirm-delete" onClick={executeDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {saving && (<div className="pp-save-overlay"><div className="pp-save-overlay-card"><div className="pp-save-spinner"/><p>Saving {pendingCount} change{pendingCount!==1?"s":""}…</p></div></div>)}
    </div>
  );
}
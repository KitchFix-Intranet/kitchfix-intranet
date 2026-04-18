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
  check: "M20 6L9 17l-5-5", minus: "M5 12h14", plus: "M12 5v14M5 12h14",
  chevL: "M15 18l-6-6 6-6", chevR: "M9 18l6-6-6-6", chevD: "M6 9l6 6 6-6", chevU: "M18 15l-6-6-6 6",
  search: ["M11 17.25a6.25 6.25 0 110-12.5 6.25 6.25 0 010 12.5z", "M16 16l4.5 4.5"],
  x: "M18 6L6 18M6 6l12 12",
  download: ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  clipboard: ["M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2","M15 2H9a1 1 0 00-1 1v2a1 1 0 001 1h6a1 1 0 001-1V3a1 1 0 00-1-1z"],
};
const fmt = n => "$" + Number(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fmtWhole = n => "$" + Math.round(Number(n||0)).toLocaleString();
const IE = {
  snowflake:"❄️",ice:"🧊",drumstick:"🍖",steak:"🥩",poultry:"🍗",bacon:"🥓",fish:"🐟",shrimp:"🦐",lobster:"🦞",crab:"🦀",oyster:"🦪",
  carrot:"🥕",leaf:"🍃",greens:"🥬",broccoli:"🥦",tomato:"🍅",pepper:"🌶️",corn:"🌽",mushroom:"🍄",onion:"🧅",garlic:"🧄",potato:"🥔",avocado:"🥑",
  apple:"🍎",lemon:"🍋",orange:"🍊",banana:"🍌",grape:"🍇",strawberry:"🍓",blueberry:"🫐",cherry:"🍒",peach:"🍑",watermelon:"🍉",pineapple:"🍍",mango:"🥭",
  egg:"🥚",cheese:"🧀",butter:"🧈",milk:"🥛",bread:"🍞",croissant:"🥐",bagel:"🥯",rice:"🍚",
  flame:"🔥",plate:"🍽️",stew:"🍲",cookie:"🍪",cupcake:"🧁",donut:"🍩",pie:"🥧",chocolate:"🍫",candy:"🍬",icecream:"🍦",popcorn:"🍿",honey:"🍯",peanut:"🥜",
  cup:"☕",tea:"🍵",boba:"🧋",juice:"🧃",soda:"🥤",water:"💧",wine:"🍷",beer:"🍺",cocktail:"🍸",
  salt:"🧂",jar:"🫙",knife:"🔪",sponge:"🧽",bucket:"🪣",broom:"🧹",gloves:"🧤",wrench:"🔧",trash:"🗑️",
  box:"📦",paper:"📋",tag:"🏷️",cabinet:"🗄️",stadium:"🏟️",truck:"🚛",can:"🥫",
};
const ri = i => { if(!i) return "📦"; if(i.codePointAt(0)>127) return i; return IE[i]||"📦"; };
const ZC = {blue:{bg:"#dbeafe",fg:"#2563eb",soft:"#eff6ff"},indigo:{bg:"#e0e7ff",fg:"#4f46e5",soft:"#eef2ff"},amber:{bg:"#fef3c7",fg:"#d97706",soft:"#fffbeb"},green:{bg:"#dcfce7",fg:"#16a34a",soft:"#f0fdf4"},red:{bg:"#fee2e2",fg:"#dc2626",soft:"#fef2f2"},purple:{bg:"#f3e8ff",fg:"#9333ea",soft:"#faf5ff"},slate:{bg:"#f1f5f9",fg:"#475569",soft:"#f8fafc"},teal:{bg:"#ccfbf1",fg:"#0d9488",soft:"#f0fdfa"},orange:{bg:"#ffedd5",fg:"#ea580c",soft:"#fff7ed"},gold:{bg:"#fef9c3",fg:"#ca8a04",soft:"#fefce8"},cyan:{bg:"#cffafe",fg:"#0891b2",soft:"#ecfeff"},pink:{bg:"#fce7f3",fg:"#db2777",soft:"#fdf2f8"},emerald:{bg:"#d1fae5",fg:"#059669",soft:"#ecfdf5"},brown:{bg:"#f5e6d3",fg:"#92400e",soft:"#fefbf6"}};
const zc = c => ZC[c]||ZC.blue;
const CC = {"Food":"#16A34A","Beverages":"#8b5cf6","Snacks":"#f59e0b","Packaging":"#64748b","Supplies":"#94a3b8"};
const cc = c => CC[c]||"#16A34A";

const shortDate = d => d ? new Date(d).toLocaleDateString("en-US", { month: "numeric", day: "numeric" }) : "";
const monthDay = d => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

const stepForUnit = (u) => {
  const unit = (u || "").toLowerCase();
  if (["lb", "lbs", "pound", "pounds", "kg", "oz", "gal", "qt", "pt", "fl oz", "l", "ml"].includes(unit)) return 0.25;
  return 1;
};
const shortUnit = (u) => {
  const unit = (u || "ea").toLowerCase();
  const map = { "pound": "lb", "pounds": "lb", "lbs": "lb", "cases": "case", "each": "ea" };
  return map[unit] || unit;
};
const daysAgo = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr); const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

export default function CountSheet({
  catalogItems = [], locations = [], lastCountItems = {},
  sessionId, account, period, periodDue, allPeriods = [], lastCount,
  onSaveLocation, onSubmit, onFinish, onBack, showToast,
}) {
  const [mode, setMode] = useState("overview");
  const [locIdx, setLocIdx] = useState(0);
  const [counts, setCounts] = useState({});
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const [ovSearchOpen, setOvSearchOpen] = useState(false);
  const [ovSearch, setOvSearch] = useState("");
  const [lastVisitedZone, setLastVisitedZone] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [hasExpandedOnce, setHasExpandedOnce] = useState(false);
  const [showCounted, setShowCounted] = useState(false);
  const [syncState, setSyncState] = useState("synced"); // "synced" | "saving" | "offline" | "unsaved"
  const [isOnline, setIsOnline] = useState(typeof window === "undefined" ? true : navigator.onLine);
  const [isPaused, setIsPaused] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [justConfirmedId, setJustConfirmedId] = useState(null);
  const [draftInputs, setDraftInputs] = useState({});
  const draftInputsRef = useRef({});
  useEffect(() => { draftInputsRef.current = draftInputs; }, [draftInputs]);
  const inputRefs = useRef({});
  const longPressTimer = useRef(null);
  const longPressInterval = useRef(null);

  // Online/offline detection
  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => { setIsOnline(true); setSyncState(s => s === "offline" ? "synced" : s); };
    const goOffline = () => { setIsOnline(false); setSyncState("offline"); };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  // Ref for keyboard shortcut access to current uncounted list
  const filteredUncountedRef = useRef([]);

  // Keyboard shortcuts (desktop power users)
  useEffect(() => {
    if (mode !== "counting") return;
    const handler = (e) => {
      // Ignore if typing in an input/textarea (except Enter/Escape on the focus card)
      const inInput = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";
      if (e.key === "Escape") { setActiveItem(null); return; }
      if (inInput) return;
      if (!activeItem) {
        // No focus card — arrow keys cycle through items
        if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); const list = filteredUncountedRef.current; if (list && list.length > 0) setActiveItem(list[0].itemId); }
        return;
      }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setItemNone(activeItem); }
      else if (e.key === "l" || e.key === "L") { e.preventDefault(); applyLastCount(activeItem); }
      else if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); advanceAfter(activeItem); }
      else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const list = filteredUncountedRef.current;
        if (!list) return;
        const idx = list.findIndex(i => i.itemId === activeItem);
        if (idx > 0) setActiveItem(list[idx - 1].itemId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, activeItem]);

  // Long-press accelerator for stepper
  const startLongPress = (itemId, delta, currentQty) => {
    let qty = currentQty;
    const tick = (step) => {
      qty = Math.max(0, Math.round((qty + step) * 100) / 100);
      setItemQty(itemId, qty);
    };
    longPressTimer.current = setTimeout(() => {
      try { navigator.vibrate?.(15); } catch {}
      // After 500ms, start rapid-fire at 10x the normal step
      const bigStep = delta * 10;
      tick(bigStep);
      longPressInterval.current = setInterval(() => tick(bigStep), 120);
    }, 500);
  };
  const endLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    if (longPressInterval.current) { clearInterval(longPressInterval.current); longPressInterval.current = null; }
  };

  useEffect(() => {
    try { if (typeof window !== "undefined" && localStorage.getItem("cs-has-expanded") === "1") setHasExpandedOnce(true); } catch {}
    try { if (typeof window !== "undefined" && sessionId && localStorage.getItem(`cs-paused-${sessionId}`) === "1") setIsPaused(true); } catch {}
  }, [sessionId]);

  useEffect(() => {
    try { if (typeof window !== "undefined" && sessionId) {
      if (isPaused) localStorage.setItem(`cs-paused-${sessionId}`, "1");
      else localStorage.removeItem(`cs-paused-${sessionId}`);
    }} catch {}
  }, [isPaused, sessionId]);

  const itemsByLocation = useMemo(() => {
    const map = {}; locations.forEach(loc => { map[loc.locationId] = []; }); map["_unassigned"] = [];
    catalogItems.forEach(item => { if (map[item.locationId]) map[item.locationId].push(item); else map["_unassigned"].push(item); });
    return map;
  }, [catalogItems, locations]);

  const allLocs = useMemo(() => {
    const locs = locations.filter(l => (itemsByLocation[l.locationId] || []).length > 0);
    if ((itemsByLocation["_unassigned"] || []).length > 0) locs.push({ locationId: "_unassigned", name: "Other Items", icon: "box" });
    return locs;
  }, [locations, itemsByLocation]);

  const locParent = useMemo(() => {
    const m = {}; locations.forEach(l => { if (l.parentLocationId) { const p = locations.find(x => x.locationId === l.parentLocationId); if (p) m[l.locationId] = p; } }); return m;
  }, [locations]);
  const locDisplayName = loc => locParent[loc?.locationId] ? `${locParent[loc.locationId].name} → ${loc.name}` : (loc?.name || "");

  const overviewGroups = useMemo(() => {
    const groups = {};
    allLocs.forEach((loc, idx) => {
      const parent = locParent[loc.locationId];
      const key = parent ? parent.locationId : loc.locationId;
      if (!groups[key]) groups[key] = { parent: parent || loc, subs: [] };
      groups[key].subs.push({ ...loc, _idx: idx });
    });
    return Object.values(groups);
  }, [allLocs, locParent]);

  const currentLoc = allLocs[locIdx] || allLocs[0];
  const currentItems = currentLoc ? (itemsByLocation[currentLoc.locationId] || []) : [];
  const filteredItems = useMemo(() => {
    if (!search.trim()) return currentItems;
    const q = search.toLowerCase(); return currentItems.filter(i => i.name.toLowerCase().includes(q));
  }, [currentItems, search]);

  const getCount = id => counts[id] || { qty: null, none: false };
  const isCounted = id => { const c = getCount(id); return (c.confirmed === true) || c.none; };
  const hasValue = id => { const c = getCount(id); return c.qty !== null || c.none; };
  const setItemQty = (id, qty) => { setCounts(p => ({ ...p, [id]: { qty: Math.max(0, qty), none: false, confirmed: false } })); setSyncState("unsaved"); };
  const setItemNone = id => {
    setCounts(p => ({ ...p, [id]: { qty: 0, none: true, confirmed: true } }));
    setDraftInputs(p => { const n = { ...p }; delete n[id]; return n; });
    setSyncState("unsaved");
    setJustConfirmedId(id);
    setTimeout(() => { setJustConfirmedId(null); advanceAfter(id); }, 280);
  };
  const applyLastCount = id => {
    const l = lastCountItems[id]; if (!l) return;
    if (l.noneOnHand) { setItemNone(id); return; }
    setCounts(p => ({ ...p, [id]: { qty: l.quantity, none: false, confirmed: true } }));
    setDraftInputs(p => { const n = { ...p }; delete n[id]; return n; });
    setSyncState("unsaved");
    setJustConfirmedId(id);
    setTimeout(() => { setJustConfirmedId(null); advanceAfter(id); }, 280);
  };

  const advanceAfter = useCallback(justId => {
    setActiveItem(null);
    setTimeout(() => {
      const idx = filteredItems.findIndex(i => i.itemId === justId);
      if (idx < 0) return;
      for (let i = idx + 1; i < filteredItems.length; i++) {
        const c = counts[filteredItems[i].itemId];
        if (!c || (c.qty === null && !c.none)) {
          setActiveItem(filteredItems[i].itemId);
          document.getElementById(`cs-row-${filteredItems[i].itemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
    }, 80);
  }, [filteredItems, counts]);

  const confirmQty = id => {
    // Commit any pending draft to the numeric state first
    const draft = draftInputsRef.current[id];
    let finalQty = null;
    if (draft !== undefined && draft !== "") {
      const parsed = parseFloat(draft);
      if (!isNaN(parsed)) finalQty = Math.max(0, parsed);
    } else {
      const c = getCount(id);
      if (c.qty !== null) finalQty = c.qty;
    }
    if (finalQty === null || finalQty < 0) return;
    setCounts(p => ({ ...p, [id]: { qty: finalQty, none: false, confirmed: true } }));
    setDraftInputs(p => { const n = { ...p }; delete n[id]; return n; });
    setSyncState("unsaved");
    try { navigator.vibrate?.(10); } catch {}
    setJustConfirmedId(id);
    setTimeout(() => { setJustConfirmedId(null); advanceAfter(id); }, 280);
  };

  const locItemsCounted = currentItems.filter(i => isCounted(i.itemId)).length;
  const locTotal = currentItems.length;
  const locProgress = locTotal > 0 ? (locItemsCounted / locTotal) * 100 : 0;
  const locRemaining = locTotal - locItemsCounted;
  const locDollarTotal = currentItems.reduce((s, i) => { const c = getCount(i.itemId); return (!isCounted(i.itemId) || c.none) ? s : s + (c.qty * (i.lastPrice || 0)); }, 0);

  const locCounts = useMemo(() => {
    const m = {};
    allLocs.forEach(loc => { const items = itemsByLocation[loc.locationId] || []; let ct = 0; items.forEach(i => { if (isCounted(i.itemId)) ct++; }); m[loc.locationId] = { counted: ct, total: items.length, done: ct === items.length && items.length > 0 }; });
    return m;
  }, [allLocs, itemsByLocation, counts]);

  const saveCurrentLocation = useCallback(async () => {
    if (!currentLoc || !sessionId) return;
    const li = currentItems
      .filter(i => isCounted(i.itemId))
      .map(i => { const c = getCount(i.itemId); return { itemId: i.itemId, quantity: c.none ? 0 : (c.qty ?? 0), unit: i.unit, priceAtCount: i.lastPrice || 0, priceVendor: i.lastPriceVendor || "", noneOnHand: c.none }; });
    if (li.length === 0) return; setSaving(true); setSyncState("saving");
    try { if (onSaveLocation) await onSaveLocation(currentLoc.locationId, li); setSyncState(isOnline ? "synced" : "offline"); } catch { showToast?.("Failed to save", "error"); setSyncState("unsaved"); } finally { setSaving(false); }
  }, [currentLoc, currentItems, counts, sessionId, onSaveLocation, showToast, isOnline]);

  const enterZone = idx => { setLastVisitedZone(idx); setLocIdx(idx); setSearch(""); setActiveItem(null); setMode("counting"); };
  const goToLocation = async idx => { await saveCurrentLocation(); setSearch(""); setActiveItem(null); setLocIdx(idx); };
  const goNext = () => { if (locIdx < allLocs.length - 1) goToLocation(locIdx + 1); else saveCurrentLocation().then(() => setMode("reviewing")); };
  const goPrev = () => { if (locIdx > 0) goToLocation(locIdx - 1); else { saveCurrentLocation(); setMode("overview"); } };
  const handleQtyChange = (id, v) => {
    // Allow only digits and a single decimal point
    let cl = v.replace(/[^0-9.]/g, "");
    const firstDot = cl.indexOf(".");
    if (firstDot !== -1) cl = cl.slice(0, firstDot + 1) + cl.slice(firstDot + 1).replace(/\./g, "");
    setDraftInputs(p => ({ ...p, [id]: cl }));
    // Mirror parsable state so liveExt + None button reflect input, but DON'T mark counted
    if (cl === "" || cl === ".") {
      setCounts(p => ({ ...p, [id]: { qty: null, none: false, confirmed: false } }));
    } else {
      const n = parseFloat(cl);
      if (!isNaN(n)) setCounts(p => ({ ...p, [id]: { qty: Math.max(0, n), none: false, confirmed: false } }));
    }
    setSyncState("unsaved");
  };

  const exportCount = () => {
    const h = "Location,Item,Category,Vendor,Unit,Unit Price,Qty,Extended Total,None on Hand,Last Ordered\n"; const rows = [];
    allLocs.forEach(loc => { (itemsByLocation[loc.locationId]||[]).forEach(item => { const c = counts[item.itemId]||{qty:null,none:false}; const q = c.none?0:(c.qty||0); const ext = c.none?0:(q*(item.lastPrice||0)); const v = item.primaryVendor||item.lastPriceVendor||""; rows.push(`"${locDisplayName(loc)}","${(item.name||"").replace(/"/g,'""')}","${item.category||""}","${v.replace(/"/g,'""')}","${item.unit||"ea"}","${(item.lastPrice||0).toFixed(2)}","${q}","${ext.toFixed(2)}","${c.none?"Yes":""}","${item.lastPriceDate||""}"`); }); });
    const b = new Blob([h+rows.join("\n")],{type:"text/csv"}); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href=u; a.download=`Count_${period}_${account}_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(u); showToast?.("Count exported","success");
  };

  if (allLocs.length === 0) return (<div className="cs-empty"><p>No storage locations set up.</p><p className="cs-empty-sub">Set up zones in Product Placement first.</p><button className="cs-back-btn" onClick={onBack}>Back</button></div>);

  /* ═══ ZONE OVERVIEW — Designer vision ═══ */
  if (mode === "overview") {
    const totalItems = catalogItems.length;
    const totalCounted = catalogItems.filter(i => isCounted(i.itemId)).length;
    const pctDone = totalItems > 0 ? Math.round((totalCounted / totalItems) * 100) : 0;
    const grandTotal = catalogItems.reduce((s, i) => { const c = getCount(i.itemId); return (!c||c.none||c.qty===null)?s:s+(c.qty*(i.lastPrice||0)); }, 0);

    const today = new Date(); today.setHours(0,0,0,0);
    const dueDate = periodDue ? new Date(periodDue) : null;
    const daysUntilDue = dueDate ? Math.ceil((dueDate - today) / 86400000) : null;
    const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
    const daysOverdue = isOverdue ? Math.abs(daysUntilDue) : 0;
    const allDone = totalCounted === totalItems && totalItems > 0;
    const isSingleChild = g => g.subs.length === 1;
    const toggleGroup = gId => {
      setExpandedGroups(prev => { const n = new Set(prev); n.has(gId) ? n.delete(gId) : n.add(gId); return n; });
      if (!hasExpandedOnce) {
        setHasExpandedOnce(true);
        try { if (typeof window !== "undefined") localStorage.setItem("cs-has-expanded", "1"); } catch {}
      }
    };

    // Partition: active zones (not fully done) vs completed zones
    const activeGroups = [], doneGroups = [];
    overviewGroups.forEach(g => {
      const gCt = g.subs.reduce((s, sub) => s + (locCounts[sub.locationId]?.counted||0), 0);
      const gTot = g.subs.reduce((s, sub) => s + (locCounts[sub.locationId]?.total||0), 0);
      const isDone = gCt === gTot && gTot > 0;
      if (isDone) doneGroups.push(g); else activeGroups.push(g);
    });

    // Recommended zone: last visited with remaining > first uncounted sub
    let recommended = null;
    if (lastVisitedZone !== null) {
      const l = allLocs[lastVisitedZone];
      if (l && !locCounts[l.locationId]?.done) recommended = { loc: l, idx: lastVisitedZone, kind: "resume" };
    }
    if (!recommended) {
      for (const g of overviewGroups) {
        for (const sub of g.subs) {
          if (!locCounts[sub.locationId]?.done) { recommended = { loc: sub, idx: sub._idx, kind: totalCounted === 0 ? "start" : "next", parent: locParent[sub.locationId] }; break; }
        }
        if (recommended) break;
      }
    }

    const ovSearchQ = ovSearch.trim().toLowerCase();
    const ovSearchResults = ovSearchQ ? catalogItems
      .filter(i => i.name.toLowerCase().includes(ovSearchQ))
      .slice(0, 20)
      .map(item => {
        const loc = allLocs.find(l => l.locationId === item.locationId);
        const parent = loc ? locParent[loc.locationId] : null;
        const locIdxForItem = allLocs.findIndex(l => l.locationId === item.locationId);
        return { item, loc, parent, idx: locIdxForItem };
      }).filter(r => r.loc) : [];

    const periodItems = (allPeriods || []).map(p => {
      const pDue = p.due ? new Date(p.due) : null;
      const isPast = pDue && pDue < today;
      const isCurrent = p.name === period;
      const isFuture = pDue && pDue > today && !isCurrent;
      return { ...p, isPast, isCurrent, isFuture };
    });

    const renderZoneCard = (g) => {
      const gc = zc(g.parent.color || "blue");
      const gCt = g.subs.reduce((s, sub) => s + (locCounts[sub.locationId]?.counted||0), 0);
      const gTot = g.subs.reduce((s, sub) => s + (locCounts[sub.locationId]?.total||0), 0);
      const gDone = gCt === gTot && gTot > 0;
      const gPct = gTot > 0 ? (gCt / gTot) * 100 : 0;
      const isExpanded = expandedGroups.has(g.parent.locationId);
      const single = isSingleChild(g);
      const gDollar = g.subs.reduce((s, sub) => s + (itemsByLocation[sub.locationId]||[]).reduce((ss, item) => { const c = getCount(item.itemId); return (!c||c.none||c.qty===null)?ss:ss+(c.qty*(item.lastPrice||0)); }, 0), 0);
      const isOther = g.parent.locationId === "_unassigned" || g.parent.name === "Other Items";

      return (
        <div key={g.parent.locationId} className={`cs-ov-card${isExpanded?" cs-ov-card--expanded":""}${gDone?" cs-ov-card--done":""}`} style={{"--z-fg": gc.fg, "--z-bg": gc.bg, "--z-soft": gc.soft}}>
          {single ? (
            <button className="cs-ov-parent" onClick={() => enterZone(g.subs[0]._idx)}>
              <div className="cs-ov-z-ico" style={{background:gc.bg}}>{ri(g.parent.icon)}</div>
              <div className="cs-ov-parent-body">
                <span className="cs-ov-parent-name">{g.parent.name}</span>
                <div className="cs-ov-parent-meta">
                  <span>{gTot} items</span>
                  {gCt > 0 && <><span>·</span><span>{gCt} counted</span></>}
                </div>
                {gPct >= 5 && <div className="cs-ov-parent-mini-pbar"><div className="cs-ov-parent-mini-fill" style={{width:`${gPct}%`, background:gc.fg}}/></div>}
              </div>
              <div className="cs-ov-parent-right">
                {gDollar > 0 && <span className="cs-ov-parent-dollar">{fmtWhole(gDollar)}</span>}
                <span className="cs-ov-parent-left-text">{gDone ? "Done" : gCt > 0 ? `${gTot - gCt} left` : "Not started"}</span>
              </div>
              <I d={ic.chevR} size={12} color={gc.fg} style={{opacity:0.5}}/>
            </button>
          ) : (<>
            <button className="cs-ov-parent" onClick={() => toggleGroup(g.parent.locationId)}>
              <div className="cs-ov-z-ico" style={{background:gc.bg}}>{ri(g.parent.icon)}</div>
              <div className="cs-ov-parent-body">
                <span className="cs-ov-parent-name">{g.parent.name}</span>
                <div className="cs-ov-parent-meta">
                  <span>{gTot} items</span>
                  <span>·</span>
                  <span>{g.subs.length} sub-zones</span>
                </div>
                {gPct >= 5 && <div className="cs-ov-parent-mini-pbar"><div className="cs-ov-parent-mini-fill" style={{width:`${gPct}%`, background:gc.fg}}/></div>}
              </div>
              <div className="cs-ov-parent-right">
                {gDollar > 0 && <span className="cs-ov-parent-dollar">{fmtWhole(gDollar)}</span>}
                <span className="cs-ov-parent-left-text">{gDone ? "Done" : gCt > 0 ? `${gTot - gCt} left` : "Not started"}</span>
              </div>
              <I d={isExpanded ? ic.chevU : ic.chevD} size={12} color={gc.fg} style={{opacity:0.5}}/>
            </button>

            <div className={`cs-ov-subs${isExpanded?" cs-ov-subs--open":""}`}>
              {g.subs.map(sub => {
                const sc = locCounts[sub.locationId]||{counted:0,total:0,done:false};
                const subC = zc(sub.color||g.parent.color||"blue");
                const subPct = sc.total > 0 ? (sc.counted / sc.total) * 100 : 0;
                const subActive = sc.counted > 0 && !sc.done;
                return (
                  <button key={sub.locationId} className="cs-ov-sub" onClick={() => enterZone(sub._idx)}>
                    <div className="cs-ov-sub-ico" style={{background:subC.bg}}>{ri(sub.icon)}</div>
                    <div className="cs-ov-sub-body">
                      <span className="cs-ov-sub-name">{sub.name}</span>
                      {subActive && subPct >= 5 && <div className="cs-ov-sub-mini-pbar"><div className="cs-ov-sub-mini-fill" style={{width:`${subPct}%`, background:subC.fg}}/></div>}
                    </div>
                    {sc.done ? <span className="cs-ov-sub-donepill">✓ {sc.counted} counted</span>
                      : subActive ? <span className="cs-ov-sub-right cs-ov-sub-right--active">{sc.total - sc.counted} left</span>
                      : <span className="cs-ov-sub-right">{sc.total}</span>}
                    <I d={ic.chevR} size={11} color={subC.fg} style={{opacity:0.4}}/>
                  </button>
                );
              })}
            </div>
          </>)}

          {isOther && gTot > 10 && <div className="cs-ov-nudge">Items not assigned to zones. Organize in Product Placement for faster counting.</div>}
          {!isOther && single && gTot >= 50 && <div className="cs-ov-nudge">{gTot} items in one zone — consider adding sub-zones in Product Placement.</div>}
        </div>
      );
    };

    return (
      <div className="cs-root cs-root--overview">

        {/* Hero header */}
        <div className="cs-ov-hero">
          <div className="cs-ov-hero-top">
            <button className="cs-ov-clip" onClick={() => setPeriodMenuOpen(v => !v)}>
              <I d={ic.clipboard} size={18} color="#d97706"/>
              <span className="cs-ov-clip-label">{period} <I d={ic.chevD} size={8} color="#d97706"/></span>
            </button>

            <div className="cs-ov-hero-center">
              <div className="cs-ov-pct-row">
                <span className="cs-ov-pct">{totalCounted === 0 ? "Ready" : `${pctDone}%`}</span>
                {grandTotal > 0 && <span className="cs-ov-dollar">· {fmtWhole(grandTotal)}</span>}
              </div>
              <div className="cs-ov-hero-sub">
                {totalCounted > 0 ? `${totalCounted} of ${totalItems} counted` : `${totalItems} items`}
                {lastCount?.submittedAt ? <> · last {monthDay(lastCount.submittedAt)}{lastCount?.grandTotal ? ` · ${fmtWhole(lastCount.grandTotal)}` : ""}</> : null}
              </div>
            </div>

            <div className="cs-ov-hero-right">
              {isOverdue ? <span className="cs-ov-badge cs-ov-badge--overdue">{daysOverdue}D OVERDUE</span>
                : daysUntilDue !== null && daysUntilDue <= 3 ? <span className="cs-ov-badge cs-ov-badge--urgent">{daysUntilDue} DAYS LEFT</span>
                : daysUntilDue !== null && daysUntilDue <= 7 ? <span className="cs-ov-badge cs-ov-badge--soon">{daysUntilDue} DAYS</span>
                : dueDate ? <span className="cs-ov-badge cs-ov-badge--neutral">Due {shortDate(periodDue)}</span>
                : null}
              <div className="cs-ov-hero-icons">
                <button className="cs-ov-ico" onClick={() => setOvSearchOpen(v => !v)} title="Search"><I d={ic.search} size={13} color="#94a3b8"/></button>
                <button className="cs-ov-ico" onClick={exportCount} title="Export"><I d={ic.download} size={13} color="#94a3b8"/></button>
              </div>
            </div>
          </div>

          {/* Segmented progress bar */}
          <div className="cs-ov-segments">
            {overviewGroups.map(g => {
              const gc = zc(g.parent.color || "blue");
              const gCt = g.subs.reduce((s, sub) => s + (locCounts[sub.locationId]?.counted||0), 0);
              const gTot = g.subs.reduce((s, sub) => s + (locCounts[sub.locationId]?.total||0), 0);
              const gPct = gTot > 0 ? (gCt / gTot) * 100 : 0;
              return (
                <div key={g.parent.locationId} className="cs-ov-seg" style={{flex: gTot, background: gc.bg}}>
                  <div className="cs-ov-seg-fill" style={{width: `${gPct}%`, background: gc.fg}}/>
                </div>
              );
            })}
          </div>
        </div>

        {/* Period dropdown */}
        {periodMenuOpen && (
          <div className="cs-ov-period-menu">
            <div className="cs-ov-period-menu-label">Select period</div>
            {periodItems.map(p => (
              <div key={p.name} className={`cs-ov-period-item${p.isCurrent?" cs-ov-period-item--current":""}${p.isPast?" cs-ov-period-item--past":""}${p.isFuture?" cs-ov-period-item--future":""}`}>
                <span className="cs-ov-period-name">{p.name}</span>
                <span className="cs-ov-period-status">
                  {p.isCurrent ? (isOverdue ? `${daysOverdue}D overdue` : `Due ${shortDate(p.due)}`)
                    : p.isPast ? "Past"
                    : `Due ${shortDate(p.due)}`}
                </span>
              </div>
            ))}
            <button className="cs-ov-period-menu-close" onClick={() => setPeriodMenuOpen(false)}>Close</button>
          </div>
        )}

        {/* Overview search */}
        {ovSearchOpen && (<>
          <div className="cs-ov-search">
            <I d={ic.search} size={13} color="#94a3b8"/>
            <input placeholder="Search items across all zones..." value={ovSearch} onChange={e => setOvSearch(e.target.value)} autoFocus/>
            <button className="cs-ov-search-close" onClick={() => { setOvSearchOpen(false); setOvSearch(""); }}><I d={ic.x} size={12} color="#94a3b8"/></button>
          </div>
          {ovSearchQ && (
            <div className="cs-ov-search-results">
              {ovSearchResults.length === 0 ? <div className="cs-ov-search-empty">No items matching "{ovSearch}"</div>
              : ovSearchResults.map(r => (
                <button key={r.item.itemId} className="cs-ov-search-result" onClick={() => { setOvSearchOpen(false); setOvSearch(""); setActiveItem(r.item.itemId); enterZone(r.idx); }}>
                  <span className="cs-cat-dot" style={{background:cc(r.item.category)}}/>
                  <div className="cs-ov-search-result-body">
                    <span className="cs-ov-search-result-name">{r.item.name}</span>
                    <span className="cs-ov-search-result-loc">{r.parent ? r.parent.name + " → " : ""}{r.loc.name}</span>
                  </div>
                  <span className="cs-ov-search-result-price">{fmt(r.item.lastPrice)}/{r.item.unit||"ea"}</span>
                </button>
              ))}
            </div>
          )}
        </>)}

        {/* Pick up where you left off */}
        {recommended && !allDone && !ovSearchOpen && (() => {
          const rc = zc(recommended.loc.color || "amber");
          const scRec = locCounts[recommended.loc.locationId] || {counted:0,total:0};
          const remainRec = scRec.total - scRec.counted;
          const estMin = Math.max(1, Math.round(remainRec / 10));
          const parentName = locParent[recommended.loc.locationId]?.name;
          return (
            <button className="cs-ov-resume" onClick={() => enterZone(recommended.idx)}>
              <div className="cs-ov-resume-ico">{ri(recommended.loc.icon)}</div>
              <div className="cs-ov-resume-body">
                <span className="cs-ov-resume-label">{recommended.kind === "resume" ? "PICK UP WHERE YOU LEFT OFF" : recommended.kind === "start" ? "READY TO START" : "CONTINUE WITH"}</span>
                <span className="cs-ov-resume-name">{recommended.loc.name}</span>
                <span className="cs-ov-resume-meta">{parentName ? `${parentName} · ` : ""}{scRec.counted === 0 ? `${scRec.total} items` : remainRec > 0 ? `${remainRec} of ${scRec.total} left` : "Done"}{estMin > 1 ? ` · ~${estMin} min` : ""}</span>
              </div>
              <div className="cs-ov-resume-cta"><I d={ic.chevR} size={14} color="#fff"/></div>
            </button>
          );
        })()}

        {/* All done celebration */}
        {allDone && (
          <div className="cs-ov-celebrate">
            <div className="cs-ov-celebrate-icon"><I d={ic.check} size={20} color="#fff" sw={3.5}/></div>
            <div className="cs-ov-celebrate-text">
              <span className="cs-ov-celebrate-title">All zones counted</span>
              <span className="cs-ov-celebrate-sub">Ready to submit · {fmtWhole(grandTotal)}</span>
            </div>
          </div>
        )}

        {/* Active zones */}
        {activeGroups.length > 0 && (
          <div className="cs-ov-section">
            <div className="cs-ov-section-hdr">
              <span>All zones</span>
              {activeGroups.length > 1 && !hasExpandedOnce && <span className="cs-ov-section-hdr-right">Tap to expand</span>}
            </div>
            {activeGroups.map(renderZoneCard)}
          </div>
        )}

        {/* Completed zones */}
        {doneGroups.length > 0 && (
          <div className="cs-ov-section">
            <button className="cs-ov-done-toggle" onClick={() => setShowCompleted(v => !v)}>
              <div className="cs-ov-done-check"><I d={ic.check} size={12} color="#fff" sw={3}/></div>
              <span className="cs-ov-done-label">Completed ({doneGroups.length})</span>
              <I d={showCompleted ? ic.chevU : ic.chevD} size={12} color="#94a3b8"/>
            </button>
            {showCompleted && doneGroups.map(renderZoneCard)}
          </div>
        )}

        {/* Footer — only shown once counting has started */}
        {totalCounted > 0 && (
          <div className="cs-ov-footer">
            <button className="cs-ov-back" onClick={onBack}><I d={ic.chevL} size={13} color="#0f3057"/> Home</button>
            <span className="cs-ov-footer-stat">{totalCounted}/{totalItems} · {fmtWhole(grandTotal)}</span>
            {allDone ? (
              <button className="cs-ov-submit" onClick={() => setMode("reviewing")}>Review & submit <I d={ic.chevR} size={13} color="#fff"/></button>
            ) : (
              <button className="cs-ov-submit cs-ov-submit--review" onClick={() => setMode("reviewing")}>Review <I d={ic.chevR} size={13} color="#fff"/></button>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ═══ REVIEW ═══ */
  if (mode === "reviewing") {
    const locSummary = allLocs.map((loc, idx) => { const items = itemsByLocation[loc.locationId]||[]; let total=0,counted=0,noneCount=0; items.forEach(i => { const c=counts[i.itemId]; if(c && isCounted(i.itemId)){counted++;if(c.none)noneCount++;else total+=(c.qty||0)*(i.lastPrice||0);}}); return{name:locDisplayName(loc),items:items.length,counted,noneCount,total,idx}; });
    const catTotals={Food:0,Beverages:0,Snacks:0,Supplies:0,Packaging:0}; let grandTotal=0,totalCounted=0,totalNone=0;
    catalogItems.forEach(i => { const c=counts[i.itemId]; if(c && isCounted(i.itemId)){if(c.none){totalCounted++;totalNone++;}else{const ext=(c.qty||0)*(i.lastPrice||0);const cat=i.category||"Food";if(catTotals[cat]!==undefined)catTotals[cat]+=ext;else catTotals.Food+=ext;grandTotal+=ext;totalCounted++;}} });
    const skipped = catalogItems.length - totalCounted;
    const doSubmit = async () => { setSubmitting(true); try{if(onSubmit)await onSubmit({sessionId,account,period,grandTotal,catTotals});onFinish?.();}catch{showToast?.("Submit failed","error");}finally{setSubmitting(false);} };
    return (
      <div className="cs-root">
        <div className="cs-review">
          <div className="cs-review-hdr"><div><h3 className="cs-review-title">Count review</h3><p className="cs-review-sub">{period} · {account} · {totalCounted} items counted</p></div><button className="cs-export-btn" onClick={exportCount}><I d={ic.download} size={14} color="#2563eb"/> Export</button></div>
          <div className="cs-review-grand"><span className="cs-review-grand-label">Grand total</span><span className="cs-review-grand-value">{fmt(grandTotal)}</span></div>
          <div className="cs-review-cats">{Object.entries(catTotals).filter(([,v])=>v>0).map(([cat,val])=>(<div key={cat} className="cs-review-cat-row"><span>{cat}</span><span>{fmt(val)}</span></div>))}</div>
          <div className="cs-review-section-label">By location</div>
          <div className="cs-review-locs">{locSummary.map((loc,i)=>(
            <button key={i} className="cs-review-loc-row" onClick={()=>{setLocIdx(loc.idx);setMode("counting");}}><div className="cs-review-loc-left"><span className="cs-review-loc-name">{loc.name}</span><span className="cs-review-loc-sub">{loc.counted}/{loc.items} counted{loc.noneCount>0?` · ${loc.noneCount} none`:""}</span></div><span className="cs-review-loc-total">{fmt(loc.total)}</span><I d={ic.chevR} size={12} color="#cbd5e1"/></button>
          ))}</div>
          {skipped>0&&<div className="cs-review-warning">{skipped} item{skipped!==1?"s":""} not counted — recorded as 0.</div>}
          {totalNone>0&&<div className="cs-review-none">{totalNone} item{totalNone!==1?"s":""} marked "none on hand"</div>}
          <div className="cs-review-actions">
            <button className="cs-review-back" onClick={()=>setMode("overview")}><I d={ic.chevL} size={14} color="#0f3057"/> Back</button>
            <button className="cs-review-submit" onClick={doSubmit} disabled={submitting}>{submitting?"Submitting...":"Submit count"}{!submitting&&<I d={ic.check} size={14} color="#fff" sw={2.5}/>}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ═══ COUNTING — v2 redesign ═══ */
  const parentZone = locParent[currentLoc?.locationId];
  const locColor = zc(currentLoc?.color || parentZone?.color || "blue");

  const countedItems = currentItems.filter(i => isCounted(i.itemId) && i.itemId !== activeItem);
  const uncountedItems = currentItems.filter(i => !isCounted(i.itemId) || i.itemId === activeItem);
  const q = search.trim().toLowerCase();
  const filteredUncounted = q ? uncountedItems.filter(i => i.name.toLowerCase().includes(q)) : uncountedItems;
  filteredUncountedRef.current = filteredUncounted;
  const filteredCounted = q ? countedItems.filter(i => i.name.toLowerCase().includes(q)) : countedItems;
  const zoneCategories = new Set(currentItems.map(i => i.category || "Food"));

  const handleRowTap = (itemId) => {
    const c = getCount(itemId);
    if (c.none) setCounts(p => ({ ...p, [itemId]: { qty: null, none: false, confirmed: false } }));
    setActiveItem(itemId);
  };

  const renderFocusCard = (item) => {
    const c = getCount(item.itemId);
    const last = lastCountItems[item.itemId];
    const vendor = item.primaryVendor || item.lastPriceVendor || "";
    const liveExt = c.qty !== null && c.qty > 0 ? c.qty * (item.lastPrice || 0) : 0;
    const step = stepForUnit(item.unit);
    const unitLabel = shortUnit(item.unit);
    const lastQty = last && !last.noneOnHand ? last.quantity : null;
    const variance = lastQty && lastQty > 0 && c.qty !== null && c.qty > 0 ? c.qty / lastQty : null;
    const highVariance = variance !== null && (variance >= 3 || variance <= 0.33);
    const recentlyOrdered = item.lastPriceDate && ((new Date() - new Date(item.lastPriceDate)) / 86400000) <= 7;

    const onPlus = () => setItemQty(item.itemId, Math.round(((c.qty || 0) + step) * 100) / 100);
    const onMinus = () => setItemQty(item.itemId, Math.max(0, Math.round(((c.qty || 0) - step) * 100) / 100));

    return (
      <div key={item.itemId} id={`cs-row-${item.itemId}`} className={`cs-focus${justConfirmedId === item.itemId ? " cs-focus--confirming" : ""}`}>
        <div className="cs-focus-top">
          <span className="cs-cat-dot" style={{ background: cc(item.category), marginTop: "6px" }} />
          <div className="cs-focus-info">
            <div className="cs-focus-name-row">
              <span className="cs-focus-name">{item.name}</span>
              {recentlyOrdered && <span className="cs-focus-new-dot" title={`Delivered ${daysAgo(item.lastPriceDate)}`}/>}
            </div>
            <div className="cs-focus-meta">
              {vendor && <span>{vendor}</span>}
              {vendor && item.lastPriceDate && <span>·</span>}
              {item.lastPriceDate && <span>Last ordered {shortDate(item.lastPriceDate)}{recentlyOrdered ? ` (${daysAgo(item.lastPriceDate)})` : ""}</span>}
            </div>
          </div>
          <div className="cs-focus-price-col">
            <span className="cs-focus-price">{fmt(item.lastPrice)}</span>
            <span className="cs-focus-unit">per {unitLabel}</span>
          </div>
        </div>

        {/* Last count reference — critical signal */}
        {last && (
          <div className="cs-focus-lastcount">
            <I d={ic.clipboard} size={11} color="#64748b" />
            <span>Last count: </span>
            {last.noneOnHand ? <span className="cs-focus-lastcount-val">none on hand</span>
              : <span className="cs-focus-lastcount-val">{last.quantity} {unitLabel}{last.quantity !== 1 ? "s" : ""}</span>}
            {lastCount?.submittedAt && <span className="cs-focus-lastcount-date">· {daysAgo(lastCount.submittedAt)}</span>}
            {lastCount?.submittedBy && <span className="cs-focus-lastcount-by">· by {lastCount.submittedBy.split(" ")[0] || lastCount.submittedBy}</span>}
          </div>
        )}

        <div className="cs-focus-stepper-row">
          <div className="cs-stepper">
            <button className="cs-stepper-btn"
              onClick={onMinus}
              onMouseDown={() => startLongPress(item.itemId, -step, c.qty || 0)}
              onMouseUp={endLongPress} onMouseLeave={endLongPress}
              onTouchStart={() => startLongPress(item.itemId, -step, c.qty || 0)}
              onTouchEnd={endLongPress}>
              <I d={ic.minus} size={16} color="#0f3057" />
            </button>
            <input
              className="cs-stepper-input"
              type="text"
              inputMode="decimal"
              value={draftInputs[item.itemId] !== undefined ? draftInputs[item.itemId] : (c.qty !== null ? c.qty : "")}
              placeholder="0"
              onChange={e => handleQtyChange(item.itemId, e.target.value)}
              onFocus={e => e.target.select()}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); confirmQty(item.itemId); } }}
              ref={el => { if (el) inputRefs.current[item.itemId] = el; }}
            />
            <button className="cs-stepper-btn"
              onClick={onPlus}
              onMouseDown={() => startLongPress(item.itemId, step, c.qty || 0)}
              onMouseUp={endLongPress} onMouseLeave={endLongPress}
              onTouchStart={() => startLongPress(item.itemId, step, c.qty || 0)}
              onTouchEnd={endLongPress}>
              <I d={ic.plus} size={16} color="#0f3057" />
            </button>
          </div>
          <span className="cs-stepper-unit">{unitLabel}{c.qty !== 1 ? "s" : ""}</span>
          {liveExt > 0 && <span className="cs-focus-ext">= {fmt(liveExt)}</span>}
        </div>

        {/* Variance warning */}
        {highVariance && (
          <div className="cs-focus-variance">
            <span className="cs-focus-variance-icon">!</span>
            <span>
              {variance >= 3 ? `This is ${variance.toFixed(1)}× last count` : `This is ${Math.round((1 - variance) * 100)}% less than last count`}
              {" — is that right?"}
            </span>
          </div>
        )}

        <div className="cs-focus-chips">
          {last && !last.noneOnHand && last.quantity > 0 && (
            <button className="cs-chip-last" onClick={() => applyLastCount(item.itemId)}>
              <span>Last: {last.quantity}</span>
              {lastCount?.submittedAt && <span className="cs-chip-last-date">· {shortDate(lastCount.submittedAt)}</span>}
            </button>
          )}
          <button className="cs-chip-none" onClick={() => setItemNone(item.itemId)}>None on hand</button>
          <button
            className="cs-chip-confirm"
            onClick={() => confirmQty(item.itemId)}
            disabled={(draftInputs[item.itemId] === undefined || draftInputs[item.itemId] === "" || draftInputs[item.itemId] === ".") && (c.qty === null || c.qty < 0)}
          >
            <I d={ic.check} size={16} color="#fff" sw={2.5} />
          </button>
        </div>
      </div>
    );
  };

  const renderUncountedRow = (item) => {
    const vendor = item.primaryVendor || item.lastPriceVendor || "";
    const recentlyOrdered = item.lastPriceDate && ((new Date() - new Date(item.lastPriceDate)) / 86400000) <= 7;
    return (
      <div key={item.itemId} id={`cs-row-${item.itemId}`} className="cs-row cs-row--uncounted" onClick={() => setActiveItem(item.itemId)}>
        <span className="cs-cat-dot" style={{ background: cc(item.category) }} />
        <div className="cs-row-info">
          <div className="cs-row-name-wrap">
            <span className="cs-row-name">{item.name}</span>
            {recentlyOrdered && <span className="cs-row-new-dot" title={`Delivered ${daysAgo(item.lastPriceDate)}`}/>}
          </div>
          {vendor && <span className="cs-row-vendor">{vendor}</span>}
        </div>
        <span className="cs-row-price">{fmt(item.lastPrice)}/{shortUnit(item.unit)}</span>
      </div>
    );
  };

  const renderCountedRow = (item) => {
    const c = getCount(item.itemId);
    const extTotal = c.qty * (item.lastPrice || 0);
    const last = lastCountItems[item.itemId];
    const lastQty = last && !last.noneOnHand ? last.quantity : null;
    const variance = lastQty && lastQty > 0 ? c.qty / lastQty : null;
    const showVariance = variance !== null && (variance >= 2 || variance <= 0.5);
    const unitLabel = shortUnit(item.unit);
    return (
      <div key={item.itemId} id={`cs-row-${item.itemId}`} className="cs-row-counted" onClick={() => handleRowTap(item.itemId)}>
        <div className="cs-counted-check"><I d={ic.check} size={11} color="#fff" sw={3} /></div>
        <div className="cs-counted-info">
          <span className="cs-counted-name">{item.name}</span>
          {showVariance && <span className={`cs-counted-variance ${variance >= 2 ? "cs-counted-variance--up" : "cs-counted-variance--down"}`}>
            {variance >= 2 ? `${variance.toFixed(1)}×` : `-${Math.round((1 - variance) * 100)}%`} vs last
          </span>}
        </div>
        <span className="cs-counted-qty"><strong>{c.qty}</strong> {unitLabel}{c.qty !== 1 ? "s" : ""}</span>
        <span className="cs-counted-ext">{fmt(extTotal)}</span>
      </div>
    );
  };

  const renderNoneRow = (item) => (
    <div key={item.itemId} id={`cs-row-${item.itemId}`} className="cs-row-none-v2" onClick={() => handleRowTap(item.itemId)}>
      <span className="cs-none-badge-v2">None</span>
      <span className="cs-none-name-v2">{item.name}</span>
    </div>
  );

  return (
    <div className="cs-root">
      {/* Paused banner */}
      {isPaused && (
        <div className="cs-paused-banner">
          <I d={ic.clipboard} size={14} color="#d97706" />
          <div className="cs-paused-text">
            <span className="cs-paused-title">Count paused</span>
            <span className="cs-paused-sub">Resume when you're ready — draft is saved</span>
          </div>
          <button className="cs-paused-resume" onClick={() => setIsPaused(false)}>Resume →</button>
        </div>
      )}

      {/* Hero header */}
      <div className="cs-hero">
        <div className="cs-hero-ico" style={{ background: locColor.bg }}>{ri(currentLoc?.icon)}</div>
        <div className="cs-hero-body">
          {parentZone && <div className="cs-hero-crumb">{parentZone.name}</div>}
          <span className="cs-hero-name">{currentLoc?.name || "Unknown"}</span>
          <div className="cs-hero-stats">
            <span className="cs-hero-pct">{Math.round(locProgress)}%</span>
            {locDollarTotal > 0 && <span className="cs-hero-dollar">· {fmt(locDollarTotal)}</span>}
            <span className="cs-hero-count">· {locItemsCounted} of {locTotal} counted</span>
          </div>
        </div>
        <div className="cs-hero-actions">
          {/* Sync status */}
          <div className={`cs-sync cs-sync--${syncState}`} title={
            syncState === "synced" ? "All changes saved" :
            syncState === "saving" ? "Saving..." :
            syncState === "offline" ? "Offline — changes queued" :
            "Unsaved changes"
          }>
            {syncState === "saving" ? <span className="cs-sync-spinner"/>
              : syncState === "synced" ? <I d={ic.check} size={10} color="#16a34a" sw={3}/>
              : syncState === "offline" ? <span className="cs-sync-dot"/>
              : <span className="cs-sync-dot"/>}
            <span className="cs-sync-label">
              {syncState === "synced" ? "Saved" : syncState === "saving" ? "Saving" : syncState === "offline" ? "Offline" : "Unsaved"}
            </span>
          </div>
          <button className="cs-hero-ico-btn" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (desktop)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2"/>
              <path d="M6 10h0M10 10h0M14 10h0M18 10h0M7 14h10"/>
            </svg>
          </button>
          <button className="cs-hero-ico-btn" onClick={() => setIsPaused(true)} title="Pause count">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="4" width="4" height="16" rx="1"/>
              <rect x="14" y="4" width="4" height="16" rx="1"/>
            </svg>
          </button>
          <button className="cs-hero-ico-btn" onClick={exportCount} title="Export">
            <I d={ic.download} size={14} color="#94a3b8" />
          </button>
        </div>
      </div>

      {/* Shortcuts overlay */}
      {shortcutsOpen && (
        <div className="cs-shortcuts-overlay" onClick={() => setShortcutsOpen(false)}>
          <div className="cs-shortcuts-panel" onClick={e => e.stopPropagation()}>
            <div className="cs-shortcuts-hdr">
              <span>Keyboard shortcuts</span>
              <button className="cs-shortcuts-close" onClick={() => setShortcutsOpen(false)}><I d={ic.x} size={14} color="#64748b"/></button>
            </div>
            <div className="cs-shortcuts-list">
              <div className="cs-shortcut-row"><kbd>Enter</kbd><span>Confirm count, move to next</span></div>
              <div className="cs-shortcut-row"><kbd>↓</kbd> <kbd>J</kbd><span>Next item</span></div>
              <div className="cs-shortcut-row"><kbd>↑</kbd> <kbd>K</kbd><span>Previous item</span></div>
              <div className="cs-shortcut-row"><kbd>N</kbd><span>Mark as none on hand</span></div>
              <div className="cs-shortcut-row"><kbd>L</kbd><span>Apply last count</span></div>
              <div className="cs-shortcut-row"><kbd>Esc</kbd><span>Close focus card</span></div>
              <div className="cs-shortcut-row"><kbd>Hold +/−</kbd><span>Rapid increment (×10)</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Zone progress bar */}
      <div className="cs-pbar"><div className="cs-pfill" style={{ width: `${locProgress}%`, background: locColor.fg }} /></div>

      {/* Counted summary pill */}
      {countedItems.length > 0 && (
        <button className="cs-counted-pill" onClick={() => setShowCounted(v => !v)}>
          <div className="cs-counted-pill-check"><I d={ic.check} size={12} color="#fff" sw={3} /></div>
          <span className="cs-counted-pill-text">{countedItems.length} counted</span>
          <span className="cs-counted-pill-stat">· {fmt(locDollarTotal)}</span>
          <span className="cs-counted-pill-toggle">{showCounted ? "Hide" : "Show"} <I d={showCounted ? ic.chevU : ic.chevD} size={10} color="#16a34a" /></span>
        </button>
      )}

      {/* Search */}
      <div className="cs-search">
        <I d={ic.search} size={13} color="#94a3b8" />
        <input placeholder={`Search in ${currentLoc?.name || "location"}...`} value={search} onChange={e => setSearch(e.target.value)} />
        {search && <button className="cs-search-x" onClick={() => setSearch("")}><I d={ic.x} size={12} color="#94a3b8" /></button>}
      </div>

      {/* Uncounted section */}
      {filteredUncounted.length > 0 && (<>
        <div className="cs-section-label">
          <span>Up next ({filteredUncounted.length})</span>
          {zoneCategories.size > 1 && <span className="cs-section-label-right">{zoneCategories.size} categories</span>}
        </div>
        <div className="cs-items">
          {filteredUncounted.map(item => activeItem === item.itemId ? renderFocusCard(item) : renderUncountedRow(item))}
        </div>
      </>)}

      {/* Counted section (expanded) */}
      {showCounted && (<>
        <div className="cs-section-label">
          <span>Just counted ({filteredCounted.length})</span>
          {filteredCounted.length > 0 && <span className="cs-section-label-right">tap to re-edit</span>}
        </div>
        {filteredCounted.length > 0 ? (
          <div className="cs-items">
            {filteredCounted.map(item => {
              if (activeItem === item.itemId) return renderFocusCard(item);
              const c = getCount(item.itemId);
              if (c.none) return renderNoneRow(item);
              return renderCountedRow(item);
            })}
          </div>
        ) : (
          <div className="cs-counted-empty">
            {search ? `No counted items match "${search}"` : "No items counted yet in this zone"}
          </div>
        )}
      </>)}

      {filteredUncounted.length === 0 && filteredCounted.length === 0 && (
        <div className="cs-no-results">{search ? `No items matching "${search}"` : "No items in this location."}</div>
      )}

      {/* Footer */}
      <div className="cs-nav">
        <button className="cs-nav-back" onClick={goPrev}>
          <I d={ic.chevL} size={13} color="#0f3057" /> Zones
        </button>
        <div className="cs-nav-stat">
          <span className="cs-nav-stat-top">{locItemsCounted}/{locTotal} · {fmt(locDollarTotal)}</span>
          <span className="cs-nav-stat-sub">{Math.round(locProgress)}% of {currentLoc?.name}</span>
        </div>
        <button className="cs-nav-next" onClick={goNext} disabled={saving}>
          {saving ? "Saving..." : locIdx < allLocs.length - 1 ? allLocs[locIdx + 1]?.name : "Review"} <I d={ic.chevR} size={13} color="#fff" />
        </button>
      </div>
    </div>
  );
}
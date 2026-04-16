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
  chevL: "M15 18l-6-6 6-6", chevR: "M9 18l6-6-6-6",
  search: ["M11 17.25a6.25 6.25 0 110-12.5 6.25 6.25 0 010 12.5z", "M16 16l4.5 4.5"],
  x: "M18 6L6 18M6 6l12 12",
  download: ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  clipboard: ["M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2","M15 2H9a1 1 0 00-1 1v2a1 1 0 001 1h6a1 1 0 001-1V3a1 1 0 00-1-1z"],
};
const fmt = (n) => "$" + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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
const ZC = {blue:{bg:"#dbeafe",fg:"#2563eb"},indigo:{bg:"#e0e7ff",fg:"#4f46e5"},amber:{bg:"#fef3c7",fg:"#d97706"},green:{bg:"#dcfce7",fg:"#16a34a"},red:{bg:"#fee2e2",fg:"#dc2626"},purple:{bg:"#f3e8ff",fg:"#9333ea"},slate:{bg:"#f1f5f9",fg:"#475569"},teal:{bg:"#ccfbf1",fg:"#0d9488"},orange:{bg:"#ffedd5",fg:"#ea580c"},gold:{bg:"#fef9c3",fg:"#ca8a04"},cyan:{bg:"#cffafe",fg:"#0891b2"},pink:{bg:"#fce7f3",fg:"#db2777"},emerald:{bg:"#d1fae5",fg:"#059669"},brown:{bg:"#f5e6d3",fg:"#92400e"}};
const zc = c => ZC[c]||ZC.blue;
const CC = {"Food":"#16A34A","Beverages":"#8b5cf6","Snacks":"#f59e0b","Packaging":"#64748b","Supplies":"#94a3b8"};
const cc = c => CC[c]||"#16A34A";

export default function CountSheet({
  catalogItems = [], locations = [], lastCountItems = {},
  sessionId, account, period,
  onSaveLocation, onSubmit, onFinish, onBack, showToast,
}) {
  const [mode, setMode] = useState("overview");
  const [locIdx, setLocIdx] = useState(0);
  const [counts, setCounts] = useState({});
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const inputRefs = useRef({});

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
  const isCounted = id => { const c = getCount(id); return c.qty !== null || c.none; };
  const setItemQty = (id, qty) => setCounts(p => ({ ...p, [id]: { qty: Math.max(0, qty), none: false } }));
  const setItemNone = id => { setCounts(p => ({ ...p, [id]: { qty: 0, none: true } })); advanceAfter(id); };
  const applyLastCount = id => { const l = lastCountItems[id]; if (!l) return; if (l.noneOnHand) setItemNone(id); else { setItemQty(id, l.quantity); advanceAfter(id); } };

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

  const confirmQty = id => { const c = getCount(id); if (c.qty !== null && c.qty >= 0) { try { navigator.vibrate?.(10); } catch {} advanceAfter(id); } };

  const locItemsCounted = currentItems.filter(i => isCounted(i.itemId)).length;
  const locTotal = currentItems.length;
  const locProgress = locTotal > 0 ? (locItemsCounted / locTotal) * 100 : 0;
  const locRemaining = locTotal - locItemsCounted;
  const locDollarTotal = currentItems.reduce((s, i) => { const c = getCount(i.itemId); return (c.none || c.qty === null) ? s : s + (c.qty * (i.lastPrice || 0)); }, 0);

  const locCounts = useMemo(() => {
    const m = {};
    allLocs.forEach(loc => { const items = itemsByLocation[loc.locationId] || []; let ct = 0; items.forEach(i => { if (isCounted(i.itemId)) ct++; }); m[loc.locationId] = { counted: ct, total: items.length, done: ct === items.length && items.length > 0 }; });
    return m;
  }, [allLocs, itemsByLocation, counts]);

  const saveCurrentLocation = useCallback(async () => {
    if (!currentLoc || !sessionId) return;
    const li = currentItems.map(i => { const c = getCount(i.itemId); return { itemId: i.itemId, quantity: c.none ? 0 : (c.qty ?? 0), unit: i.unit, priceAtCount: i.lastPrice || 0, priceVendor: i.lastPriceVendor || "", noneOnHand: c.none }; }).filter(i => i.quantity > 0 || i.noneOnHand);
    if (li.length === 0) return; setSaving(true);
    try { if (onSaveLocation) await onSaveLocation(currentLoc.locationId, li); } catch { showToast?.("Failed to save", "error"); } finally { setSaving(false); }
  }, [currentLoc, currentItems, counts, sessionId, onSaveLocation, showToast]);

  const enterZone = idx => { setLocIdx(idx); setSearch(""); setActiveItem(null); setMode("counting"); };
  const goToLocation = async idx => { await saveCurrentLocation(); setSearch(""); setActiveItem(null); setLocIdx(idx); };
  const goNext = () => { if (locIdx < allLocs.length - 1) goToLocation(locIdx + 1); else saveCurrentLocation().then(() => setMode("reviewing")); };
  const goPrev = () => { if (locIdx > 0) goToLocation(locIdx - 1); else { saveCurrentLocation(); setMode("overview"); } };
  const handleQtyChange = (id, v) => { const cl = v.replace(/[^0-9.]/g, ""); if (cl === "") { setCounts(p => ({ ...p, [id]: { qty: null, none: false } })); return; } const n = parseFloat(cl); if (!isNaN(n)) setItemQty(id, n); };

  const exportCount = () => {
    const h = "Location,Item,Category,Vendor,Unit,Unit Price,Qty,Extended Total,None on Hand,Last Ordered\n"; const rows = [];
    allLocs.forEach(loc => { (itemsByLocation[loc.locationId]||[]).forEach(item => { const c = counts[item.itemId]||{qty:null,none:false}; const q = c.none?0:(c.qty||0); const ext = c.none?0:(q*(item.lastPrice||0)); const v = item.primaryVendor||item.lastPriceVendor||""; rows.push(`"${locDisplayName(loc)}","${(item.name||"").replace(/"/g,'""')}","${item.category||""}","${v.replace(/"/g,'""')}","${item.unit||"ea"}","${(item.lastPrice||0).toFixed(2)}","${q}","${ext.toFixed(2)}","${c.none?"Yes":""}","${item.lastPriceDate||""}"`); }); });
    const b = new Blob([h+rows.join("\n")],{type:"text/csv"}); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href=u; a.download=`Count_${period}_${account}_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(u); showToast?.("Count exported","success");
  };

  if (allLocs.length === 0) return (<div className="cs-empty"><p>No storage locations set up.</p><p className="cs-empty-sub">Set up zones in Product Placement first.</p><button className="cs-back-btn" onClick={onBack}>Back</button></div>);

  /* ═══ ZONE OVERVIEW ═══ */
  if (mode === "overview") {
    const totalItems = catalogItems.length; const totalCounted = catalogItems.filter(i => isCounted(i.itemId)).length;
    const grandTotal = catalogItems.reduce((s, i) => { const c = getCount(i.itemId); return (!c||c.none||c.qty===null)?s:s+(c.qty*(i.lastPrice||0)); }, 0);
    return (
      <div className="cs-root cs-root--overview">
        <div className="cs-ov-hdr">
          <I d={ic.clipboard} size={18} color="#0f3057" />
          <div className="cs-ov-hdr-text"><span className="cs-ov-title">Inventory count</span><span className="cs-ov-sub">{period} · {totalCounted > 0 ? `${totalCounted}/${totalItems} counted` : `${totalItems} items`}</span></div>
          {totalCounted > 0 && <span className="cs-ov-grand">{fmt(grandTotal)}</span>}
        </div>
        <div className="cs-ov-zones">
          {overviewGroups.map(g => {
            const gc = zc(g.parent.color || "blue");
            const gCt = g.subs.reduce((s, sub) => s + (locCounts[sub.locationId]?.counted||0), 0);
            const gTot = g.subs.reduce((s, sub) => s + (locCounts[sub.locationId]?.total||0), 0);
            const gDone = gCt === gTot && gTot > 0;
            return (
              <div key={g.parent.locationId} className="cs-ov-group">
                <div className="cs-ov-parent">
                  <div className="cs-ov-ico" style={{background:gc.bg}}>{ri(g.parent.icon)}</div>
                  <div className="cs-ov-parent-body"><span className="cs-ov-parent-name">{g.parent.name}</span><span className="cs-ov-parent-sub">{gTot} items · {g.subs.length} zone{g.subs.length!==1?"s":""}</span></div>
                  {gDone?<div className="cs-ov-done"><I d={ic.check} size={12} color="#fff" sw={3}/></div>:gCt>0?<span className="cs-ov-frac">{gCt}/{gTot}</span>:null}
                </div>
                {g.subs.map(sub => {
                  const sc = locCounts[sub.locationId]||{counted:0,total:0,done:false}; const subC = zc(sub.color||g.parent.color||"blue");
                  return (<button key={sub.locationId} className={`cs-ov-sub${sc.done?" cs-ov-sub--done":""}`} onClick={() => enterZone(sub._idx)}>
                    <div className="cs-ov-sub-ico" style={{background:subC.bg}}>{ri(sub.icon)}</div>
                    <span className="cs-ov-sub-name">{sub.name}</span>
                    {sc.done?<div className="cs-ov-done-sm"><I d={ic.check} size={9} color="#fff" sw={3}/></div>:sc.counted>0?<span className="cs-ov-sub-frac">{sc.counted}/{sc.total}</span>:<span className="cs-ov-sub-ct">{sc.total}</span>}
                    <I d={ic.chevR} size={14} color="#cbd5e1"/>
                  </button>);
                })}
              </div>
            );
          })}
        </div>
        <div className="cs-ov-footer">
          <button className="cs-ov-back" onClick={onBack}><I d={ic.chevL} size={14} color="#0f3057"/> Home</button>
          {totalCounted > 0 && <button className="cs-ov-review" onClick={() => setMode("reviewing")}>Review & submit <I d={ic.chevR} size={14} color="#fff"/></button>}
        </div>
      </div>
    );
  }

  /* ═══ REVIEW ═══ */
  if (mode === "reviewing") {
    const locSummary = allLocs.map((loc, idx) => { const items = itemsByLocation[loc.locationId]||[]; let total=0,counted=0,noneCount=0; items.forEach(i => { const c=counts[i.itemId]; if(c&&(c.qty!==null||c.none)){counted++;if(c.none)noneCount++;else total+=(c.qty||0)*(i.lastPrice||0);}}); return{name:locDisplayName(loc),items:items.length,counted,noneCount,total,idx}; });
    const catTotals={Food:0,Beverages:0,Snacks:0,Supplies:0,Packaging:0}; let grandTotal=0,totalCounted=0,totalNone=0;
    catalogItems.forEach(i => { const c=counts[i.itemId]; if(c&&c.qty!==null&&!c.none){const ext=(c.qty||0)*(i.lastPrice||0);const cat=i.category||"Food";if(catTotals[cat]!==undefined)catTotals[cat]+=ext;else catTotals.Food+=ext;grandTotal+=ext;totalCounted++;}else if(c&&c.none){totalCounted++;totalNone++;} });
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

  /* ═══ COUNTING ═══ */
  const parentZone = locParent[currentLoc?.locationId]; const locColor = zc(currentLoc?.color || parentZone?.color || "blue");
  return (
    <div className="cs-root">
      <div className="cs-zone-hdr">
        <div className="cs-zone-ico" style={{background:locColor.bg}}>{ri(currentLoc?.icon)}</div>
        <div className="cs-zone-body"><span className="cs-zone-name">{currentLoc?.name||"Unknown"}</span><span className="cs-zone-sub">{parentZone?parentZone.name+" · ":""}{locTotal} items</span></div>
        <div className="cs-zone-right"><span className="cs-zone-total">{fmt(locDollarTotal)}</span><span className="cs-zone-progress">{locRemaining>0?`${locRemaining} left`:"Done"} · {locIdx+1}/{allLocs.length}</span></div>
        <button className="cs-export-ico" onClick={exportCount} title="Export"><I d={ic.download} size={15} color="#94a3b8"/></button>
      </div>
      <div className="cs-pbar"><div className="cs-pfill" style={{width:`${locProgress}%`,background:locColor.fg}}/></div>
      <div className="cs-search"><I d={ic.search} size={13} color="#94a3b8"/><input placeholder={`Search in ${currentLoc?.name||"location"}...`} value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button className="cs-search-x" onClick={()=>setSearch("")}><I d={ic.x} size={12} color="#94a3b8"/></button>}</div>
      <div className="cs-items">
        {filteredItems.map(item => {
          const c=getCount(item.itemId),counted=c.qty!==null&&!c.none,noneMarked=c.none,isActive=activeItem===item.itemId,last=lastCountItems[item.itemId],extTotal=counted?(c.qty*(item.lastPrice||0)):0,vendor=item.primaryVendor||item.lastPriceVendor||"";
          if(isActive) return (<div key={item.itemId} id={`cs-row-${item.itemId}`} className="cs-row cs-row--active">
            <div className="cs-active-top"><span className="cs-cat-dot" style={{background:cc(item.category)}}/><span className="cs-active-name">{item.name}</span><span className="cs-active-price">{fmt(item.lastPrice)}/{item.unit||"ea"}</span></div>
            {vendor&&<span className="cs-active-vendor">{vendor}</span>}
            <div className="cs-active-controls">
              <div className="cs-stepper"><button className="cs-stepper-btn" onClick={()=>setItemQty(item.itemId,Math.max(0,(c.qty||0)-1))}><I d={ic.minus} size={16} color="#0f3057"/></button><input className="cs-stepper-input" type="text" inputMode="decimal" value={c.qty!==null?c.qty:""} placeholder="0" onChange={e=>handleQtyChange(item.itemId,e.target.value)} onFocus={e=>e.target.select()} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();confirmQty(item.itemId);}}} ref={el=>{if(el)inputRefs.current[item.itemId]=el;}} autoFocus/><button className="cs-stepper-btn" onClick={()=>setItemQty(item.itemId,(c.qty||0)+1)}><I d={ic.plus} size={16} color="#0f3057"/></button></div>
              <span className="cs-stepper-unit">{item.unit||"ea"}</span>
              <div className="cs-active-chips">{last&&!last.noneOnHand&&last.quantity>0&&<button className="cs-chip-last" onClick={()=>applyLastCount(item.itemId)}>Last: {last.quantity}</button>}<button className="cs-chip-none" onClick={()=>setItemNone(item.itemId)}>None</button>{c.qty!==null&&c.qty>=0&&<button className="cs-chip-done" onClick={()=>confirmQty(item.itemId)}><I d={ic.check} size={14} color="#fff" sw={2.5}/></button>}</div>
            </div>
          </div>);
          if(noneMarked) return (<div key={item.itemId} id={`cs-row-${item.itemId}`} className="cs-row cs-row--none" onClick={()=>{setCounts(p=>({...p,[item.itemId]:{qty:null,none:false}}));setActiveItem(item.itemId);}}><span className="cs-none-badge">None</span><span className="cs-row-name cs-row-name--struck">{item.name}</span></div>);
          if(counted) return (<div key={item.itemId} id={`cs-row-${item.itemId}`} className="cs-row cs-row--counted" onClick={()=>setActiveItem(item.itemId)}><div className="cs-check"><I d={ic.check} size={10} color="#fff" sw={3}/></div><span className="cs-row-name">{item.name}</span><span className="cs-row-qty">{c.qty} {item.unit||"ea"}</span><span className="cs-row-ext">{fmt(extTotal)}</span></div>);
          return (<div key={item.itemId} id={`cs-row-${item.itemId}`} className="cs-row cs-row--uncounted" onClick={()=>setActiveItem(item.itemId)}><span className="cs-cat-dot" style={{background:cc(item.category)}}/><div className="cs-row-info"><span className="cs-row-name">{item.name}</span>{vendor&&<span className="cs-row-vendor">{vendor}</span>}</div><span className="cs-row-price">{fmt(item.lastPrice)}/{item.unit||"ea"}</span></div>);
        })}
        {filteredItems.length===0&&<div className="cs-no-results">{search?`No items matching "${search}"`:"No items in this location."}</div>}
      </div>
      <div className="cs-nav">
        <button className="cs-nav-back" onClick={goPrev}><I d={ic.chevL} size={14} color="#0f3057"/>{locIdx>0?allLocs[locIdx-1]?.name:"Zones"}</button>
        <button className="cs-nav-next" onClick={goNext} disabled={saving}>{saving?"Saving...":locIdx<allLocs.length-1?allLocs[locIdx+1]?.name:"Review"}<I d={ic.chevR} size={14} color="#fff"/></button>
      </div>
    </div>
  );
}
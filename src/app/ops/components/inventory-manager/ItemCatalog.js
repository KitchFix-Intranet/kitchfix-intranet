"use client";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";

const I = ({ d, size = 16, color = "#64748b", sw = 2, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display:"inline-block", verticalAlign:"middle", flexShrink:0, ...style }}>
    {Array.isArray(d) ? d.map((p,i) => <path key={i} d={p}/>) : <path d={d}/>}
  </svg>
);
const ico = {
  search:["M11 19a8 8 0 100-16 8 8 0 000 16z","M21 21l-4.35-4.35"],
  x:["M18 6L6 18","M6 6l12 12"],
  download:["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4","M7 10l5 5 5-5","M12 15V3"],
  chevDown:"M6 9l6 6 6-6", chevUp:"M18 15l-6-6-6 6",
  edit:["M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7","M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"],
  mapPin:["M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z","M12 13a3 3 0 100-6 3 3 0 000 6z"],
  printer:["M6 9V2h12v7","M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2","M6 14h12v8H6z"],
  filter:["M22 3H2l8 9.46V19l4 2v-8.54L22 3"],
  inbox:["M22 12h-6l-2 3H10l-2-3H2","M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"],
  cpu:["M18 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2z","M9 9h6v6H9z","M9 1v3","M15 1v3","M9 20v3","M15 20v3","M20 9h3","M20 14h3","M1 9h3","M1 14h3"],
  merge:["M18 8h-6a2 2 0 00-2 2v10","M15 5l3 3-3 3","M6 16h6a2 2 0 002-2V4","M9 19l-3-3 3-3"],
  archive:["M21 8v13H3V8","M1 3h22v5H1z","M10 12h4"],
  rotateCcw:["M1 4v6h6","M3.51 15a9 9 0 102.13-9.36L1 10"],
  swap:["M16 3l4 4-4 4","M20 7H4","M8 21l-4-4 4-4","M4 17h16"],
  plus:["M12 5v14","M5 12h14"],
  check:["M20 6L9 17l-5-5"],
};
const fmt = n => "$"+Number(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",");
const CC = {"Food":"#16A34A","Beverages":"#8b5cf6","Snacks":"#f59e0b","Packaging":"#64748b","Supplies":"#0891b2","Uncategorized":"#94a3b8"};
const cc = c => CC[c]||"#64748b";
const CATS = ["Food","Beverages","Snacks","Supplies","Packaging"];
const UNITS = ["each","case","box","pack","gallon","lb","oz","bag","dozen","count"];
const STALE_DAYS = 30;
const ARCHIVE_DAYS = 60;
const VERIFY_DAYS = 60;
const PAGE_SIZE = 50;

function fmtDate(d) { if (!d) return "\u2013"; try { const dt=new Date(d); return isNaN(dt)?d:dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); } catch { return d; } }
function fmtDateShort(d) { if (!d) return "\u2013"; try { const dt=new Date(d); return isNaN(dt)?d:dt.toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch { return d; } }
function normalizeUnitPrice(name, price, unit) {
  if (!price||price<=0) return null;
  const pm = name.match(/(\d+)\s*[\/x×]\s*(\d+\.?\d*)\s*(oz|lb|gal|ml|l|kg|g|ct)\b/i);
  if (pm) { const c=parseFloat(pm[1]),s=parseFloat(pm[2]),u=pm[3].toLowerCase(); if(u==="oz") return {value:(price/(c*s)).toFixed(3),unit:"/oz"}; if(u==="lb") return {value:(price/(c*s)).toFixed(3),unit:"/lb"}; if(u==="gal") return {value:(price/(c*s)).toFixed(2),unit:"/gal"}; if(u==="ct") return {value:(price/c).toFixed(3),unit:"/ct"}; }
  const sm = name.match(/(\d+\.?\d*)\s*(oz|lb|gal)\b/i);
  if (sm) { const s=parseFloat(sm[1]),u=sm[2].toLowerCase(); if(u==="oz"&&s>0) return {value:(price/s).toFixed(3),unit:"/oz"}; if(u==="lb"&&s>0) return {value:(price/s).toFixed(2),unit:"/lb"}; }
  return null;
}
function Sparkline({prices}) { if(!prices||prices.length<2) return null; const v=[...prices].reverse().map(p=>p.price); const mn=Math.min(...v),mx=Math.max(...v),r=mx-mn||1,w=56,h=22,pd=3; const pts=v.map((val,i)=>`${(i/(v.length-1))*(w-pd*2)+pd},${h-pd-((val-mn)/r)*(h-pd*2)}`).join(" "); const tr=v[v.length-1]>v[0]; const fl=Math.abs(v[v.length-1]-v[0])/(v[0]||1)<0.01; const cl=fl?"#94a3b8":tr?"#d97706":"#16A34A"; const pct=v[0]>0?(((v[v.length-1]-v[0])/v[0])*100).toFixed(1):"0"; const tip=`${fmt(v[0])} → ${fmt(v[v.length-1])} (${v.length} deliveries, ${pct>0?"+":""}${pct}%)`; return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{flexShrink:0,cursor:"help"}}><title>{tip}</title><polyline points={pts} fill="none" stroke={cl} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function priceChange(p) { if(!p||p.length<2) return null; const c=p[0].price,v=p[1].price; if(!v) return null; const pct=((c-v)/v*100).toFixed(1); if(Math.abs(pct)<0.5) return null; return {label:`${pct>0?"+":""}${pct}%`,color:pct>0?"#d97706":"#16A34A"}; }
function daysAgo(d) { if(!d) return null; try { const n=Math.floor((new Date()-new Date(d))/864e5); return n<=0?"Today":n===1?"1 day ago":`${n} days ago`; } catch { return null; } }
function daysAgoNum(d) { if(!d) return 999; try { return Math.floor((new Date()-new Date(d))/864e5); } catch { return 999; } }
function parsePackSize(n) { const m=n.match(/(\d+)\s*[\/x×]\s*(\d+\.?\d*)\s*(oz|lb|ct|pk|gal|ml|l|kg|g)\b/i); if(m) return `${m[1]}/${m[2]}${m[3]}`; const m2=n.match(/(\d+\.?\d*)\s*(oz|lb|gal|ct|pk|ml|l|kg|g)\b/i); if(m2) return `${m2[1]}${m2[2]}`; return null; }
function isManual(item) { return item.createdBy && item.createdBy !== "ai_cron"; }

export default function ItemCatalog({ catalogItems, locations, excludedItems, archivedItems, aliases, itemPrices, onUpdateCatalogItem, onArchiveItem, onReactivateItem, onMergeItems, onAddManualItem, onVerifyPrice, onGoToPlacement, showToast }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState(null);
  const [zoneFilter, setZoneFilter] = useState(null);
  const [sort, setSort] = useState("name");
  const [detail, setDetail] = useState(null);
  const [editingNotes, setEditingNotes] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingCat, setEditingCat] = useState(null);
  const [vendorOpen, setVendorOpen] = useState(false);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [mergeMode, setMergeMode] = useState(null);
  const [mergeSearch, setMergeSearch] = useState("");
  const [mergeTarget, setMergeTarget] = useState(null);
  const [mergeSwapped, setMergeSwapped] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(null);
  /* Add form */
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ name:"", vendor:"", category:"Food", unit:"case", price:"", locationId:"" });
  /* Verify price */
  const [verifyId, setVerifyId] = useState(null);
  const [verifyDraft, setVerifyDraft] = useState("");
  const listRef = useRef(null);

  useEffect(() => { setVisibleCount(PAGE_SIZE); setFocusIdx(-1); }, [filter, vendorFilter, zoneFilter, search, sort]);

  const locMap = useMemo(() => { const m={}; (locations||[]).forEach(l => { m[l.locationId]=l; }); return m; }, [locations]);
  const aliasMap = useMemo(() => { const m={}; (aliases||[]).forEach(a => { if(!m[a.itemId]) m[a.itemId]=[]; m[a.itemId].push(a); }); Object.keys(m).forEach(id => { const seen=new Set(); m[id]=m[id].filter(a => { const k=(a.aliasText||"").toLowerCase().trim(); if(seen.has(k)) return false; seen.add(k); return true; }); }); return m; }, [aliases]);
  const priceMap = itemPrices || {};
  const zonePath = useCallback((lid) => { if(!lid) return null; const l=locMap[lid]; if(!l) return null; if(l.parentLocationId) { const p=locMap[l.parentLocationId]; return p?`${p.name} → ${l.name}`:l.name; } return l.name; }, [locMap]);
  const categories = useMemo(() => { const c={}; catalogItems.forEach(i => { c[i.category]=(c[i.category]||0)+1; }); return c; }, [catalogItems]);
  const vendors = useMemo(() => { const v={}; catalogItems.forEach(i => { if(i.primaryVendor) v[i.primaryVendor]=(v[i.primaryVendor]||0)+1; }); return v; }, [catalogItems]);
  const zoneList = useMemo(() => { const top=(locations||[]).filter(l=>!l.parentLocationId).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)); const r=[]; top.forEach(z => { const ic=catalogItems.filter(i=>i.locationId===z.locationId||(locations||[]).some(s=>s.parentLocationId===z.locationId&&s.locationId===i.locationId)).length; r.push({id:z.locationId,name:z.name,count:ic,isSub:false}); (locations||[]).filter(s=>s.parentLocationId===z.locationId).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).forEach(s => { r.push({id:s.locationId,name:`${z.name} → ${s.name}`,count:catalogItems.filter(i=>i.locationId===s.locationId).length,isSub:true}); }); }); return r; }, [locations, catalogItems]);
  const unplacedCount = useMemo(() => { const ids=new Set((locations||[]).map(l=>l.locationId)); return catalogItems.filter(i=>!i.locationId||!ids.has(i.locationId)).length; }, [catalogItems, locations]);
  const healthStats = useMemo(() => { const ids=new Set((locations||[]).map(l=>l.locationId)); const placed=catalogItems.filter(i=>i.locationId&&ids.has(i.locationId)).length; const manualCount=catalogItems.filter(i=>isManual(i)).length; return { active:catalogItems.length, excluded:(excludedItems||[]).length, archived:(archivedItems||[]).length, placed, placedPct:catalogItems.length>0?Math.round((placed/catalogItems.length)*100):0, aliases:(aliases||[]).length, manual:manualCount }; }, [catalogItems, excludedItems, archivedItems, locations, aliases]);
  const itemFrequency = useCallback((id) => { const p=priceMap[id]; if(!p||!p.length) return {label:"No data",color:"#94a3b8",count:0}; if(p.length===1) return {label:"New",color:"#2563eb",count:1}; if(p.length>=4) return {label:"Weekly",color:"#16A34A",count:p.length}; if(p.length>=2) return {label:"Biweekly",color:"#d97706",count:p.length}; return {label:"Monthly+",color:"#94a3b8",count:p.length}; }, [priceMap]);
  const itemVendors = useCallback((id) => { const p=priceMap[id]; if(!p||!p.length) return []; const bv={}; p.forEach(x => { if(!bv[x.vendor]) bv[x.vendor]=x; else if(new Date(x.date)>new Date(bv[x.vendor].date)) bv[x.vendor]=x; }); return Object.values(bv).sort((a,b)=>a.price-b.price); }, [priceMap]);

  const items = useMemo(() => {
    let list = filter==="excluded" ? (excludedItems||[]) : filter==="archived" ? (archivedItems||[]) : catalogItems;
    if (filter!=="all"&&filter!=="excluded"&&filter!=="archived"&&filter!=="unplaced"&&filter!=="manual") list = list.filter(i=>i.category===filter);
    if (filter==="unplaced") { const ids=new Set((locations||[]).map(l=>l.locationId)); list=list.filter(i=>!i.locationId||!ids.has(i.locationId)); }
    if (filter==="manual") list = list.filter(i=>isManual(i));
    if (vendorFilter) list=list.filter(i=>i.primaryVendor===vendorFilter);
    if (zoneFilter) { const z=locMap[zoneFilter]; if(z) { if(z.parentLocationId) { list=list.filter(i=>i.locationId===zoneFilter); } else { const subs=new Set((locations||[]).filter(l=>l.parentLocationId===zoneFilter).map(l=>l.locationId)); list=list.filter(i=>i.locationId===zoneFilter||subs.has(i.locationId)); } } }
    if (search.trim()) { const q=search.toLowerCase(); list=list.filter(i=>i.name.toLowerCase().includes(q)||(i.primaryVendor||"").toLowerCase().includes(q)||(i.category||"").toLowerCase().includes(q)||(zonePath(i.locationId)||"").toLowerCase().includes(q)||(aliasMap[i.itemId]||[]).some(a=>(a.aliasText||"").toLowerCase().includes(q))); }
    const sorted=[...list];
    if(sort==="name") sorted.sort((a,b)=>a.name.localeCompare(b.name));
    else if(sort==="price") sorted.sort((a,b)=>(b.lastPrice||0)-(a.lastPrice||0));
    else if(sort==="vendor") sorted.sort((a,b)=>(a.primaryVendor||"").localeCompare(b.primaryVendor||""));
    else if(sort==="zone") sorted.sort((a,b)=>(zonePath(a.locationId)||"zzz").localeCompare(zonePath(b.locationId)||"zzz"));
    else if(sort==="category") sorted.sort((a,b)=>(a.category||"").localeCompare(b.category||"")||a.name.localeCompare(b.name));
    return sorted;
  }, [catalogItems, excludedItems, archivedItems, locations, filter, vendorFilter, zoneFilter, search, sort, locMap, aliasMap]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;
  const manualCount = useMemo(() => catalogItems.filter(i=>isManual(i)).length, [catalogItems]);
  const catFilterOptions = useMemo(() => {
    const opts=[{key:"all",label:"All items",count:catalogItems.length}];
    Object.entries(categories).sort((a,b)=>b[1]-a[1]).forEach(([cat,count])=>opts.push({key:cat,label:cat,count,color:cc(cat)}));
    if(unplacedCount>0) opts.push({key:"unplaced",label:"Unplaced",count:unplacedCount});
    if(manualCount>0) opts.push({key:"manual",label:"Manual",count:manualCount});
    if((archivedItems||[]).length>0) opts.push({key:"archived",label:"Archived",count:(archivedItems||[]).length});
    if((excludedItems||[]).length>0) opts.push({key:"excluded",label:"Excluded",count:(excludedItems||[]).length});
    return opts;
  }, [catalogItems, categories, unplacedCount, manualCount, archivedItems, excludedItems]);
  const activeFilterLabel = useMemo(() => { const o=catFilterOptions.find(x=>x.key===filter); return o?`${o.label} ${o.count}`:"All items"; }, [filter, catFilterOptions]);
  const sortOptions = [{key:"name",label:"Name"},{key:"price",label:"Price"},{key:"zone",label:"Zone"},{key:"vendor",label:"Vendor"},{key:"category",label:"Category"}];
  const getLetterKey = n => (n||"")[0]?.toUpperCase()||"#";
  const subtitle = vendorFilter?`${items.length} items from ${vendorFilter}`:zoneFilter?`${items.length} items in ${locMap[zoneFilter]?.name||"zone"}`:`${items.length} item${items.length!==1?"s":""}`;

  const exportCSV = () => { const h="Name,Category,Unit,Vendor,Price,Zone,Last Ordered,Frequency,Source\n"; const r=items.map(i=>{const f=itemFrequency(i.itemId); return `"${i.name}","${i.category}","${i.unit}","${i.primaryVendor||""}","${i.lastPrice||""}","${zonePath(i.locationId)||"Unassigned"}","${i.lastPriceDate||""}","${f.label}","${isManual(i)?"Manual":"Auto"}"`; }).join("\n"); const b=new Blob([h+r],{type:"text/csv"}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download=`catalog_${filter==="all"?"All":filter}_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(u); showToast?.(`${items.length} items exported`,"success"); };
  const printCatalog = () => { const r=items.map(i=>`<tr><td>${i.name}</td><td>${i.category}</td><td>${i.primaryVendor||""}</td><td>${i.lastPrice?fmt(i.lastPrice)+"/"+(i.unit||"ea"):""}</td><td>${zonePath(i.locationId)||""}</td></tr>`).join(""); const h=`<html><head><title>Item Catalog</title><style>body{font-family:-apple-system,sans-serif;font-size:12px;margin:20px}table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #eee;text-align:left}th{font-weight:600;border-bottom:2px solid #0f3057;font-size:11px;text-transform:uppercase;color:#64748b}h1{font-size:16px;color:#0f3057;margin:0 0 4px}p{font-size:12px;color:#94a3b8;margin:0 0 12px}</style></head><body><h1>Item Catalog</h1><p>${items.length} items</p><table><thead><tr><th>Item</th><th>Category</th><th>Vendor</th><th>Price</th><th>Zone</th></tr></thead><tbody>${r}</tbody></table></body></html>`; const w=window.open("","_blank"); w.document.write(h); w.document.close(); w.print(); };

  const saveNotes = id => { onUpdateCatalogItem?.(id,{notes:noteDraft}); setEditingNotes(null); showToast?.("Note saved","success"); };
  const saveCategory = (id,cat) => { onUpdateCatalogItem?.(id,{category:cat}); setEditingCat(null); showToast?.(`Category → ${cat}`,"success"); };
  const mergeResults = useMemo(() => { if(!mergeMode||mergeSearch.length<2) return []; const q=mergeSearch.toLowerCase(); return catalogItems.filter(i=>i.itemId!==mergeMode&&(i.name.toLowerCase().includes(q)||(i.primaryVendor||"").toLowerCase().includes(q)||(aliasMap[i.itemId]||[]).some(a=>(a.aliasText||"").toLowerCase().includes(q)))).slice(0,10); }, [mergeMode, mergeSearch, catalogItems, aliasMap]);
  const executeMerge = () => { if(!mergeMode||!mergeTarget) return; onMergeItems?.(mergeSwapped?mergeTarget:mergeMode,[mergeSwapped?mergeMode:mergeTarget]); setMergeMode(null); setMergeTarget(null); setMergeSearch(""); setMergeSwapped(false); setDetail(null); };
  const submitAddForm = () => { if(!addForm.name.trim()||!addForm.vendor.trim()) { showToast?.("Name and vendor are required","error"); return; } onAddManualItem?.(addForm); setShowAddForm(false); setAddForm({name:"",vendor:"",category:"Food",unit:"case",price:"",locationId:""}); };
  const submitVerify = (itemId) => { if(!verifyDraft.trim()) return; onVerifyPrice?.(itemId, verifyDraft); setVerifyId(null); setVerifyDraft(""); };

  useEffect(() => { if(!vendorOpen&&!zoneOpen&&!catOpen) return; const h=()=>{setVendorOpen(false);setZoneOpen(false);setCatOpen(false);}; setTimeout(()=>document.addEventListener("click",h),0); return ()=>document.removeEventListener("click",h); }, [vendorOpen, zoneOpen, catOpen]);
  const handleKeyDown = useCallback(e => { if(e.key==="ArrowDown"){e.preventDefault();setFocusIdx(p=>Math.min(p+1,visibleItems.length-1));} else if(e.key==="ArrowUp"){e.preventDefault();setFocusIdx(p=>Math.max(p-1,0));} else if(e.key==="Enter"&&focusIdx>=0){const it=visibleItems[focusIdx];setDetail(detail===it?.itemId?null:it?.itemId);} else if(e.key==="Escape"){setDetail(null);setFocusIdx(-1);setMergeMode(null);setConfirmArchive(null);setShowAddForm(false);} }, [focusIdx, visibleItems, detail]);

  if (!catalogItems||catalogItems.length===0) {
    return (<div className="ic-root"><div className="ic-header"><div className="ic-header-left"><h3 className="ic-title">Item catalog</h3><p className="ic-subtitle">0 items</p></div></div>
      <div className="ic-empty-state"><div className="ic-empty-state-icon"><I d={ico.inbox} size={32} color="#cbd5e1" sw={1.5}/></div><h4 className="ic-empty-state-title">No items yet</h4><p className="ic-empty-state-desc">Items appear here automatically as invoices are processed through Invoice Capture. You can also add items manually for credit card or non-ACH purchases.</p><button className="ic-add-btn-empty" onClick={()=>setShowAddForm(true)}><I d={ico.plus} size={13} color="#2563eb"/> Add item manually</button></div>
      {showAddForm && <AddForm addForm={addForm} setAddForm={setAddForm} onSubmit={submitAddForm} onCancel={()=>setShowAddForm(false)} zoneList={zoneList} vendorList={Object.keys(vendors)}/>}
    </div>);
  }

  return (
    <div className="ic-root" onKeyDown={handleKeyDown} tabIndex={0} ref={listRef}>
      <div className="ic-header"><div className="ic-header-left"><h3 className="ic-title">Item catalog</h3><p className="ic-subtitle">{catalogItems.length} items · {Object.keys(categories).length} categories</p></div>
        <div className="ic-header-actions"><div className="ic-search-wrap"><I d={ico.search} size={13} color="#94a3b8"/><input className="ic-search" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button className="ic-search-x" onClick={()=>setSearch("")}><I d={ico.x} size={12} color="#94a3b8"/></button>}</div><button className="ic-export-btn" onClick={exportCSV} title="Export CSV"><I d={ico.download} size={13} color="#64748b"/></button><button className="ic-export-btn" onClick={printCatalog} title="Print"><I d={ico.printer} size={13} color="#64748b"/></button></div>
      </div>

      <div className="ic-health"><span>{healthStats.active} active</span><span className="ic-health-sep">·</span><span>{healthStats.placedPct}% placed</span><span className="ic-health-sep">·</span><span>{healthStats.aliases} aliases</span>{healthStats.manual>0&&<><span className="ic-health-sep">·</span><span>{healthStats.manual} manual</span></>}{healthStats.archived>0&&<><span className="ic-health-sep">·</span><span>{healthStats.archived} archived</span></>}{healthStats.excluded>0&&<><span className="ic-health-sep">·</span><span>{healthStats.excluded} excluded</span></>}</div>

      {/* Add form overlay */}
      {showAddForm && <AddForm addForm={addForm} setAddForm={setAddForm} onSubmit={submitAddForm} onCancel={()=>setShowAddForm(false)} zoneList={zoneList} vendorList={Object.keys(vendors)}/>}

      <div className="ic-sticky">
        <div className="ic-filter-row">
          <div className="ic-dropdown-wrap" onClick={e=>e.stopPropagation()}>{filter!=="all"?(<span className="ic-filter-active">{catFilterOptions.find(o=>o.key===filter)?.color&&<span className="ic-filter-active-dot" style={{background:catFilterOptions.find(o=>o.key===filter)?.color}}/>}<span>{activeFilterLabel}</span><button onClick={()=>{setFilter("all");setDetail(null);}}>×</button></span>):(<button className="ic-dropdown-trigger" onClick={()=>{setCatOpen(!catOpen);setVendorOpen(false);setZoneOpen(false);}}><I d={ico.filter} size={11} color="#94a3b8"/> All {catalogItems.length} <I d={ico.chevDown} size={10} color="#94a3b8"/></button>)}{catOpen&&(<div className="ic-dropdown-menu">{catFilterOptions.map(opt=>(<button key={opt.key} className={filter===opt.key?"ic-dropdown-active":""} onClick={()=>{setFilter(opt.key);setCatOpen(false);setDetail(null);setVendorFilter(null);setZoneFilter(null);}}><span style={{display:"flex",alignItems:"center",gap:6}}>{opt.color&&<span className="ic-cat-dot" style={{background:opt.color}}/>}{opt.label}</span><span className="ic-dropdown-count">{opt.count}</span></button>))}</div>)}</div>
          <div className="ic-dropdown-wrap" onClick={e=>e.stopPropagation()}>{vendorFilter?(<span className="ic-filter-active"><span>{vendorFilter}</span><button onClick={()=>setVendorFilter(null)}>×</button></span>):(<button className="ic-dropdown-trigger" onClick={()=>{setVendorOpen(!vendorOpen);setZoneOpen(false);setCatOpen(false);}}><I d={ico.search} size={11} color="#94a3b8"/> Vendor <I d={ico.chevDown} size={10} color="#94a3b8"/></button>)}{vendorOpen&&(<div className="ic-dropdown-menu">{Object.entries(vendors).sort((a,b)=>b[1]-a[1]).map(([v,c])=>(<button key={v} onClick={()=>{setVendorFilter(v);setVendorOpen(false);}}>{v} <span className="ic-dropdown-count">{c}</span></button>))}</div>)}</div>
          <div className="ic-dropdown-wrap" onClick={e=>e.stopPropagation()}>{zoneFilter?(<span className="ic-filter-active"><span>{locMap[zoneFilter]?.name}</span><button onClick={()=>setZoneFilter(null)}>×</button></span>):(<button className="ic-dropdown-trigger" onClick={()=>{setZoneOpen(!zoneOpen);setVendorOpen(false);setCatOpen(false);}}><I d={ico.mapPin} size={11} color="#94a3b8"/> Zone <I d={ico.chevDown} size={10} color="#94a3b8"/></button>)}{zoneOpen&&(<div className="ic-dropdown-menu">{zoneList.map(z=>(<button key={z.id} className={z.isSub?"ic-dropdown-sub":""} onClick={()=>{setZoneFilter(z.id);setZoneOpen(false);}}>{z.name} <span className="ic-dropdown-count">{z.count}</span></button>))}</div>)}</div>
          <button className="ic-add-trigger" onClick={()=>setShowAddForm(true)}><I d={ico.plus} size={11} color="#2563eb"/> Add item</button>
        </div>
        <div className="ic-sort-bar"><span className="ic-sort-label">{subtitle}</span><div className="ic-sort-options">{sortOptions.map(s=>(<button key={s.key} className={`ic-sort-btn${sort===s.key?" ic-sort-btn--active":""}`} onClick={()=>setSort(s.key)}>{s.label}</button>))}</div></div>
        <div className="ic-legend"><span className="ic-legend-item"><span className="ic-freq-dot" style={{background:"#2563eb"}}/> New</span><span className="ic-legend-item"><span className="ic-freq-dot" style={{background:"#16A34A"}}/> Weekly</span><span className="ic-legend-item"><span className="ic-freq-dot" style={{background:"#d97706"}}/> Biweekly</span><span className="ic-legend-item"><span className="ic-freq-dot" style={{background:"#94a3b8"}}/> Monthly+</span><span className="ic-legend-sep">|</span><span className="ic-legend-item"><svg width="18" height="8" viewBox="0 0 18 8"><polyline points="0,7 9,3 18,1" fill="none" stroke="#d97706" strokeWidth="1.5" strokeLinecap="round"/></svg> Rising</span><span className="ic-legend-item"><svg width="18" height="8" viewBox="0 0 18 8"><polyline points="0,1 9,5 18,7" fill="none" stroke="#16A34A" strokeWidth="1.5" strokeLinecap="round"/></svg> Falling</span></div>
      </div>

      <div className="ic-items">
        {items.length===0&&<div className="ic-empty">{search.trim()?`No items match "${search}"`:filter==="excluded"?"No excluded items":filter==="archived"?"No archived items":filter==="manual"?"No manual items":filter==="unplaced"?"All items are placed":"No items"}</div>}
        {visibleItems.map((item, idx) => {
          const isExcluded=filter==="excluded", isArchived=filter==="archived", isInactive=isExcluded||isArchived;
          const isOpen=detail===item.itemId, isFocused=focusIdx===idx;
          const path=zonePath(item.locationId), prices=priceMap[item.itemId]||[], freq=itemFrequency(item.itemId);
          const lastOrdered=daysAgo(item.lastPriceDate), daysNum=daysAgoNum(item.lastPriceDate);
          const multiVendor=itemVendors(item.itemId), packSize=parsePackSize(item.name), change=priceChange(prices);
          const normPrice=normalizeUnitPrice(item.name,item.lastPrice,item.unit);
          const itemAliases=(aliasMap[item.itemId]||[]).filter(a=>(a.aliasText||"").toLowerCase().trim()!==(item.name||"").toLowerCase().trim());
          const manual=isManual(item);
          const verifyDate=item.lastVerified||item.lastPriceDate;
          const verifyDays=daysAgoNum(verifyDate);
          const staleLevel=!isInactive&&!manual&&daysNum>=ARCHIVE_DAYS?2:!isInactive&&!manual&&daysNum>=STALE_DAYS?1:0;
          const needsVerify=manual&&verifyDays>=VERIFY_DAYS&&!isInactive;

          let showLetter=false;
          if(sort==="name"&&!search.trim()&&!vendorFilter&&!zoneFilter){const l=getLetterKey(item.name);const pl=idx>0?getLetterKey(visibleItems[idx-1].name):null;if(l!==pl) showLetter=l;}

          return (<div key={item.itemId}>
            {showLetter&&<div className="ic-letter">{showLetter}</div>}
            <div className={`ic-item${isExcluded?" ic-item--excluded":""}${isArchived?" ic-item--archived":""}${isOpen?" ic-item--open":""}${isFocused?" ic-item--focused":""}${manual&&!isInactive?" ic-item--manual":""}`}
              onClick={()=>isExcluded?null:setDetail(isOpen?null:item.itemId)}
              style={!isInactive&&!isOpen?{borderLeftColor:cc(item.category)}:undefined}>
              <div className="ic-item-row">
                <span className="ic-item-dot" style={{background:cc(item.category)}} title={item.category}/>
                <div className="ic-item-body">
                  <div className="ic-item-top"><span className={`ic-item-name${isExcluded?" ic-item-name--struck":""}`}>{item.name}</span><div className="ic-item-price-wrap">{item.lastPrice>0&&<span className="ic-item-price">{fmt(item.lastPrice)}/{item.unit||"ea"}</span>}{change&&<span className="ic-item-change" style={{color:change.color}}>{change.label}</span>}</div></div>
                  <div className="ic-item-bottom">
                    {isExcluded?<span className="ic-item-excluded-label">Excluded</span>:isArchived?<span className="ic-item-archived-label">Archived</span>:(<>
                      <span className="ic-item-vendor">{item.primaryVendor||""}</span>
                      {path&&<><span className="ic-item-sep">·</span><span className="ic-item-zone">{path}</span></>}
                      {lastOrdered&&<><span className="ic-item-sep">·</span><span className={staleLevel>=1||needsVerify?"ic-item-ago--warn":""}>{lastOrdered}</span></>}
                      {!manual&&<span className="ic-freq-dot" style={{background:freq.color}} title={`${freq.label} (${freq.count} order${freq.count!==1?"s":""})`}/>}
                      {normPrice&&<span className="ic-badge ic-badge--norm">{fmt(Number(normPrice.value))}{normPrice.unit}</span>}
                      {manual&&<span className="ic-badge ic-badge--manual">Manual</span>}
                      {multiVendor.length>1&&<span className="ic-badge ic-badge--vendor">{multiVendor.length} vendors</span>}
                      {item.notes&&<span className="ic-badge ic-badge--note">Note</span>}
                      {needsVerify&&<span className="ic-badge ic-badge--verify">Verify price?</span>}
                      {staleLevel===1&&<span className="ic-badge ic-badge--stale">Check stock?</span>}
                      {staleLevel===2&&<span className="ic-badge ic-badge--archive-nudge">Archive?</span>}
                    </>)}
                  </div>
                </div>
                {!isInactive&&<Sparkline prices={prices}/>}
              </div>

              {isOpen&&isArchived&&(<div className="ic-detail" onClick={e=>e.stopPropagation()}>
                {item.lastPriceDate&&<div className="ic-detail-row"><span className="ic-detail-label">Last priced</span><span>{fmtDate(item.lastPriceDate)}{item.lastPriceVendor?` · ${item.lastPriceVendor}`:""}</span></div>}
                {path&&<div className="ic-detail-row"><span className="ic-detail-label">Zone (preserved)</span><span>{path}</span></div>}
                {item.notes&&<div className="ic-detail-section"><span className="ic-detail-section-label">Notes</span><div className="ic-note-card"><span>{item.notes}</span></div></div>}
                <button className="ic-reactivate-btn" onClick={()=>onReactivateItem?.(item.itemId)}><I d={ico.rotateCcw} size={13} color="#16A34A"/> Reactivate this item</button>
              </div>)}

              {isOpen&&!isInactive&&(<div className="ic-detail" onClick={e=>e.stopPropagation()}>
                {packSize&&<div className="ic-detail-row"><span className="ic-detail-label">Pack</span><span>{packSize}</span></div>}
                {item.lastPriceDate&&<div className="ic-detail-row"><span className="ic-detail-label">Last priced</span><span>{fmtDate(item.lastPriceDate)}{item.lastPriceVendor?` · ${item.lastPriceVendor}`:""}</span></div>}
                {!manual&&<div className="ic-detail-row"><span className="ic-detail-label">Frequency</span><span style={{display:"flex",alignItems:"center",gap:4}}><span className="ic-freq-dot" style={{background:freq.color}}/> {freq.label} ({freq.count} order{freq.count!==1?"s":""})</span></div>}
                {normPrice&&<div className="ic-detail-row"><span className="ic-detail-label">Unit cost</span><span>{fmt(Number(normPrice.value))}{normPrice.unit}</span></div>}
                <div className="ic-detail-row"><span className="ic-detail-label">Category</span>{editingCat===item.itemId?(<div className="ic-cat-dropdown">{CATS.map(c=><button key={c} className={c===item.category?"ic-cat-option--active":""} onClick={()=>saveCategory(item.itemId,c)}>{c}</button>)}</div>):(<button className="ic-cat-btn" onClick={()=>setEditingCat(item.itemId)} style={{color:cc(item.category)}}>{item.category} <I d={ico.chevDown} size={10} color={cc(item.category)}/></button>)}</div>
                <div className="ic-detail-row"><span className="ic-detail-label">Source</span>{manual?<span className="ic-manual-badge"><span className="ic-badge ic-badge--manual">Manual</span> {item.createdBy}</span>:<span className="ic-ai-badge"><I d={ico.cpu} size={10} color="#8b5cf6"/> AI-matched</span>}</div>
                {path&&onGoToPlacement&&<div className="ic-detail-row"><span className="ic-detail-label">Zone</span><button className="ic-zone-link" onClick={()=>onGoToPlacement?.()}>{path} →</button></div>}

                {/* Verify price (manual items) */}
                {manual&&(<div className="ic-detail-section"><span className="ic-detail-section-label">Verify price</span>
                  {verifyId===item.itemId?(<div className="ic-verify-form"><div className="ic-verify-row"><span className="ic-verify-dollar">$</span><input className="ic-verify-input" type="number" step="0.01" value={verifyDraft} onChange={e=>setVerifyDraft(e.target.value)} autoFocus placeholder="0.00"/><span className="ic-verify-unit">/{item.unit||"ea"}</span><button className="ic-verify-save" onClick={()=>submitVerify(item.itemId)}>Update</button></div>{item.lastPrice>0&&<span className="ic-verify-prev">Last: {fmt(item.lastPrice)} on {fmtDateShort(verifyDate)}</span>}</div>)
                  :(<button className="ic-verify-btn" onClick={()=>{setVerifyId(item.itemId);setVerifyDraft(item.lastPrice?String(item.lastPrice):"");}}><I d={ico.check} size={12} color="#185FA5"/> {item.lastPrice?"Verify current price":"Set price"}{item.lastVerified?` · Last verified ${fmtDateShort(item.lastVerified)}`:""}</button>)}
                </div>)}

                {/* Price history (auto-tracked items) */}
                {!manual&&prices.length>0&&(<div className="ic-detail-section"><span className="ic-detail-section-label">Price history</span><div className="ic-price-timeline">{prices.slice(0,6).map((p,pi)=>(<div key={pi} className="ic-price-row"><span className="ic-price-date">{fmtDateShort(p.date)}</span><span className="ic-price-vendor">{p.vendor}</span><span className="ic-price-amount">{fmt(p.price)}/{item.unit||"ea"}</span></div>))}</div></div>)}
                {/* Manual items with price history from verifications */}
                {manual&&prices.length>0&&(<div className="ic-detail-section"><span className="ic-detail-section-label">Price log</span><div className="ic-price-timeline">{prices.slice(0,6).map((p,pi)=>(<div key={pi} className="ic-price-row"><span className="ic-price-date">{fmtDateShort(p.date)}</span><span className="ic-price-vendor">{p.vendor}</span><span className="ic-price-amount">{fmt(p.price)}/{item.unit||"ea"}</span></div>))}</div></div>)}

                {multiVendor.length>1&&(<div className="ic-detail-section"><span className="ic-detail-section-label">{multiVendor.length} vendors</span>{multiVendor.map((v,vi)=>(<div key={v.vendor} className={`ic-vendor-row${vi===0?" ic-vendor-row--best":""}`}><span className="ic-vendor-row-name">{v.vendor}</span><div className="ic-vendor-row-right"><span>{fmt(v.price)}/{item.unit||"ea"}</span>{vi===0&&<span className="ic-best-badge">Best</span>}{vi>0&&<span className="ic-vendor-diff">+{((v.price-multiVendor[0].price)/multiVendor[0].price*100).toFixed(0)}%</span>}</div></div>))}</div>)}

                <div className="ic-detail-section"><span className="ic-detail-section-label">Notes</span>
                  {editingNotes===item.itemId?(<div className="ic-note-edit"><textarea className="ic-note-input" value={noteDraft} onChange={e=>{if(e.target.value.length<=200) setNoteDraft(e.target.value);}} placeholder="Add a note..." autoFocus rows={2} maxLength={200}/><div className="ic-note-footer"><span className="ic-note-count">{noteDraft.length}/200</span><div className="ic-note-actions"><button className="ic-note-cancel" onClick={()=>setEditingNotes(null)}>Cancel</button><button className="ic-note-save" onClick={()=>saveNotes(item.itemId)}>Save</button></div></div></div>):item.notes?(<div className="ic-note-card" onClick={()=>{setEditingNotes(item.itemId);setNoteDraft(item.notes);}}><span>{item.notes}</span><I d={ico.edit} size={11} color="#d97706"/></div>):(<button className="ic-note-add" onClick={()=>{setEditingNotes(item.itemId);setNoteDraft("");}}>+ Add note</button>)}
                </div>

                {itemAliases.length>0&&(<div className="ic-detail-section"><span className="ic-detail-section-label">Also known as</span>{itemAliases.slice(0,5).map((a,i)=><span key={i} className="ic-detail-alias">{a.aliasText}</span>)}{itemAliases.length>5&&<span className="ic-detail-alias ic-detail-alias--more">+{itemAliases.length-5} more</span>}</div>)}

                {/* Actions: merge + archive */}
                <div className="ic-detail-section ic-detail-actions">
                  {mergeMode===item.itemId?(<div className="ic-merge-flow">{!mergeTarget?(<><span className="ic-detail-section-label">Find item to merge into this one</span><div className="ic-merge-search-wrap"><I d={ico.search} size={12} color="#94a3b8"/><input className="ic-merge-search" placeholder="Search by name or vendor..." value={mergeSearch} onChange={e=>setMergeSearch(e.target.value)} autoFocus/>{mergeSearch&&<button className="ic-search-x" onClick={()=>setMergeSearch("")}><I d={ico.x} size={11} color="#94a3b8"/></button>}</div>{mergeSearch.length>=2&&mergeResults.length===0&&<p className="ic-merge-empty">No matching items</p>}{mergeResults.map(r=>(<button key={r.itemId} className="ic-merge-result" onClick={()=>setMergeTarget(r.itemId)}><span className="ic-item-dot" style={{background:cc(r.category)}}/><div className="ic-merge-result-body"><span className="ic-merge-result-name">{r.name}</span><span className="ic-merge-result-sub">{r.primaryVendor}{r.lastPrice?` · ${fmt(r.lastPrice)}/${r.unit||"ea"}`:""}</span></div></button>))}<button className="ic-merge-cancel" onClick={()=>setMergeMode(null)}>Cancel</button></>):(()=>{const ki=mergeSwapped?catalogItems.find(i=>i.itemId===mergeTarget):item;const mi=mergeSwapped?item:catalogItems.find(i=>i.itemId===mergeTarget);return(<><span className="ic-detail-section-label">Confirm merge</span><div className="ic-merge-confirm"><div className="ic-merge-confirm-item"><span className="ic-merge-confirm-label">Keep</span><span className="ic-merge-confirm-name">{ki?.name}</span><span className="ic-merge-confirm-sub">{ki?.primaryVendor}{ki?.lastPrice?` · ${fmt(ki.lastPrice)}/${ki.unit||"ea"}`:""}</span></div><div className="ic-merge-confirm-item ic-merge-confirm-item--merged"><span className="ic-merge-confirm-label">Merge into it</span><span className="ic-merge-confirm-name">{mi?.name}</span><span className="ic-merge-confirm-sub">{mi?.primaryVendor}{mi?.lastPrice?` · ${fmt(mi.lastPrice)}/${mi.unit||"ea"}`:""}{mi?.notes?" · Has notes":""}</span></div><button className="ic-merge-swap" onClick={()=>setMergeSwapped(!mergeSwapped)}><I d={ico.swap} size={12} color="#2563eb"/> Swap keeper</button><p className="ic-merge-explain">The merged item becomes an alias. Price history and zone assignment transfer.</p><div className="ic-merge-actions"><button className="ic-merge-cancel" onClick={()=>{setMergeTarget(null);setMergeSwapped(false);}}>Back</button><button className="ic-merge-execute" onClick={executeMerge}><I d={ico.merge} size={13} color="#fff"/> Merge items</button></div></div></>);})()}</div>):(<>
                    <button className="ic-action-btn ic-action-btn--merge" onClick={()=>{setMergeMode(item.itemId);setMergeSearch("");setMergeTarget(null);setMergeSwapped(false);}}><I d={ico.merge} size={13} color="#2563eb"/> Merge with another item...</button>
                    {confirmArchive===item.itemId?(<div className="ic-archive-confirm"><p>Archive <strong>{item.name}</strong>? It won't appear in count sheets but all data is preserved. You can reactivate anytime.</p><div className="ic-merge-actions"><button className="ic-merge-cancel" onClick={()=>setConfirmArchive(null)}>Cancel</button><button className="ic-archive-execute" onClick={()=>{onArchiveItem?.(item.itemId);setConfirmArchive(null);setDetail(null);}}><I d={ico.archive} size={13} color="#fff"/> Archive</button></div></div>):(<button className="ic-action-btn ic-action-btn--archive" onClick={()=>setConfirmArchive(item.itemId)}><I d={ico.archive} size={13} color="#94a3b8"/> Archive this item</button>)}
                  </>)}
                </div>
              </div>)}
            </div>
          </div>);
        })}
        {hasMore&&<button className="ic-show-more" onClick={()=>setVisibleCount(p=>p+PAGE_SIZE)}>Show {Math.min(PAGE_SIZE,items.length-visibleCount)} more ({items.length-visibleCount} remaining)</button>}
      </div>
    </div>
  );
}

/* ── Add Form (rendered as overlay inside ic-root) ── */
function AddForm({ addForm, setAddForm, onSubmit, onCancel, zoneList, vendorList }) {
  const [confirming, setConfirming] = useState(false);
  const [vendorFocus, setVendorFocus] = useState(false);
  const upd = (k,v) => setAddForm(prev => ({...prev, [k]:v}));
  const zoneName = zoneList.find(z=>z.id===addForm.locationId)?.name || "";
  const vendorSuggestions = vendorFocus && addForm.vendor.length >= 1
    ? (vendorList||[]).filter(v => v.toLowerCase().includes(addForm.vendor.toLowerCase())).slice(0, 6)
    : [];

  if (confirming) {
    return (
      <div className="ic-add-overlay">
        <div className="ic-add-card">
          <div className="ic-add-title"><I d={ico.check} size={15} color="#16A34A"/> Review before adding</div>
          <div className="ic-add-confirm-grid">
            <div className="ic-add-confirm-row"><span className="ic-add-confirm-label">Item</span><span className="ic-add-confirm-val">{addForm.name}</span></div>
            <div className="ic-add-confirm-row"><span className="ic-add-confirm-label">Vendor</span><span className="ic-add-confirm-val">{addForm.vendor}</span></div>
            <div className="ic-add-confirm-row"><span className="ic-add-confirm-label">Category</span><span className="ic-add-confirm-val">{addForm.category}</span></div>
            <div className="ic-add-confirm-row"><span className="ic-add-confirm-label">Unit</span><span className="ic-add-confirm-val">{addForm.unit}</span></div>
            {addForm.price && <div className="ic-add-confirm-row"><span className="ic-add-confirm-label">Price</span><span className="ic-add-confirm-val">${Number(addForm.price).toFixed(2)}/{addForm.unit}</span></div>}
            {zoneName && <div className="ic-add-confirm-row"><span className="ic-add-confirm-label">Zone</span><span className="ic-add-confirm-val">{zoneName}</span></div>}
          </div>
          <p className="ic-add-confirm-note">This item will be added as a manual entry. Prices are tracked through the verify flow, not invoices.</p>
          <button className="ic-add-submit" onClick={onSubmit}><I d={ico.check} size={14} color="#fff"/> Confirm and add</button>
          <button className="ic-add-cancel" onClick={()=>setConfirming(false)}>Back to edit</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ic-add-overlay">
      <div className="ic-add-card">
        <div className="ic-add-title"><I d={ico.plus} size={15} color="#0f3057"/> Add item manually</div>
        <p className="ic-add-hint">For credit card purchases, Amazon orders, or vendors not on ACH/Bill.com. These items appear in your catalog and count sheets but prices are tracked manually.</p>
        <div className="ic-add-field"><label className="ic-add-label">Item name *</label><input className="ic-add-input" value={addForm.name} onChange={e=>upd("name",e.target.value)} placeholder="Paper Towels - Bounty 8pk"/></div>
        <div className="ic-add-field ic-add-vendor-wrap"><label className="ic-add-label">Vendor / source *</label><input className="ic-add-input" value={addForm.vendor} onChange={e=>upd("vendor",e.target.value)} onFocus={()=>setVendorFocus(true)} onBlur={()=>setTimeout(()=>setVendorFocus(false),150)} placeholder="Costco, Amazon, Target..." autoComplete="off"/>{vendorSuggestions.length>0&&<div className="ic-vendor-suggest">{vendorSuggestions.map(v=><button key={v} onMouseDown={e=>{e.preventDefault();upd("vendor",v);setVendorFocus(false);}}>{v}</button>)}</div>}</div>
        <div className="ic-add-row">
          <div className="ic-add-field"><label className="ic-add-label">Category</label><select className="ic-add-input" value={addForm.category} onChange={e=>upd("category",e.target.value)}>{CATS.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
          <div className="ic-add-field"><label className="ic-add-label">Unit</label><select className="ic-add-input" value={addForm.unit} onChange={e=>upd("unit",e.target.value)}>{UNITS.map(u=><option key={u} value={u}>{u}</option>)}</select></div>
        </div>
        <div className="ic-add-row">
          <div className="ic-add-field"><label className="ic-add-label">Price (optional)</label><input className="ic-add-input" type="number" step="0.01" value={addForm.price} onChange={e=>upd("price",e.target.value)} placeholder="0.00"/></div>
          <div className="ic-add-field"><label className="ic-add-label">Zone (optional)</label><select className="ic-add-input" value={addForm.locationId} onChange={e=>upd("locationId",e.target.value)}><option value="">Select zone...</option>{zoneList.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></div>
        </div>
        <button className="ic-add-submit" onClick={()=>{ if(!addForm.name.trim()||!addForm.vendor.trim()) return; setConfirming(true); }}>Review item</button>
        <button className="ic-add-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
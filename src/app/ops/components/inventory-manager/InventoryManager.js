"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import CountSheet from "./CountSheet";
import LocationSetup from "./LocationSetup";
import ProductPlacement from "./ProductPlacement";
import ItemReview from "./ItemReview";

const Icon = ({ d, size = 16, color = "#64748b", sw = 2, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const icons = {
  box: ["M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z","M3.27 6.96L12 12.01l8.73-5.05","M12 22.08V12"],
  gear: ["M12 15a3 3 0 100-6 3 3 0 000 6z","M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"],
  chevDown: "M6 9l6 6 6-6", chevUp: "M18 15l-6-6-6 6", chevRight: "M9 18l6-6-6-6",
  arrowLeft: ["M19 12H5","M12 19l-7-7 7-7"],
  trendUp: ["M23 6l-9.5 9.5-5-5L1 18","M17 6h6v6"],
  trendDown: ["M23 18l-9.5-9.5-5 5L1 6","M17 18h6v-6"],
  alert: ["M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z","M12 9v4","M12 17h.01"],
  check: "M20 6L9 17l-5-5",
  clipboard: ["M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2","M8 2h8a1 1 0 011 1v2a1 1 0 01-1 1H8a1 1 0 01-1-1V3a1 1 0 011-1z"],
  play: "M5 3l14 9-14 9V3z",
  sparkle: ["M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z"],
  grid: ["M3 3h7v7H3z","M14 3h7v7h-7z","M14 14h7v7h-7z","M3 14h7v7H3z"],
  mapPin: ["M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z","M12 13a3 3 0 100-6 3 3 0 000 6z"],
  list: ["M8 6h13","M8 12h13","M8 18h13","M3 6h.01","M3 12h.01","M3 18h.01"],
  dollarSign: ["M12 1v22","M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"],
};

const fmt = (n) => "$" + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const daysUntil = (due) => { if (!due) return null; try { return Math.ceil((new Date(due) - new Date()) / 86400000); } catch { return null; } };
const dateShort = (v) => { if (!v) return "\u2013"; try { return new Date(v).toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch { return "\u2013"; } };
const dateFull = (v) => { if (!v) return "\u2013"; try { return new Date(v).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); } catch { return "\u2013"; } };

export default function InventoryManager({ config, showToast, openConfirm, onNavigate }) {
  const [screen, setScreen] = useState("landing");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const [manageView, setManageView] = useState(null);
  const [busy, setBusy] = useState(null);
  const didInit = useRef(false);
  const childDirty = useRef(false);

  const guardNav = (fn) => {
    if (childDirty.current) {
      openConfirm?.("Unsaved Changes", "You have unsaved changes to storage locations. Discard and leave?", "Discard", () => { childDirty.current = false; fn(); });
      return;
    }
    fn();
  };

  const loadBootstrap = useCallback(async (acct, fresh = false) => {
    setLoading(true);
    try {
      const params = acct ? `&account=${encodeURIComponent(acct)}` : "";
      const freshParam = fresh ? "&fresh=true" : "";
      const res = await fetch(`/api/ops/inventory?action=bootstrap${params}${freshParam}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
        if (!didInit.current && !acct && json.account) setAccount(json.account);
        didInit.current = true;
      } else { showToast?.(json.error || "Load failed", "error"); }
    } catch { showToast?.("Network error", "error"); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { if (!didInit.current) loadBootstrap(""); }, []); // eslint-disable-line

  const switchAccount = (label) => {
    setAccountOpen(false); setScreen("landing"); setSessionId(null); setManageView(null);
    setAccount(label);
    loadBootstrap(label);
  };

  const startCount = async () => {
    const cp = data?.currentPeriod;
    if (!cp?.name) { showToast("No active period", "error"); return; }
    if (data?.activeDraft?.sessionId) { setSessionId(data.activeDraft.sessionId); setScreen("counting"); return; }
    try {
      const res = await fetch("/api/ops/inventory", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-session", account, period: cp.name }) });
      const json = await res.json();
      if (json.success) { setSessionId(json.sessionId); setScreen("counting"); }
      else { showToast(json.error || "Failed", "error"); }
    } catch { showToast("Network error", "error"); }
  };

  const handleSaveLocation = async (locationId, items) => {
    if (!sessionId) return;
    try {
      const res = await fetch("/api/ops/inventory", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-count", sessionId, locationId, items }) });
      const json = await res.json();
      if (json.success) showToast(`Saved ${json.itemCount} items`, "success");
    } catch { showToast("Save failed", "error"); }
  };

  const handleSaveLocations = async (locationsList) => {
    setBusy({ title: "Setting up your kitchen...", sub: "Organizing items into locations \u2014 this takes about a minute" });
    try {
      const res = await fetch("/api/ops/inventory", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-locations", account, locations: locationsList }) });
      const json = await res.json();
      if (json.success) {
        showToast(json.assigned > 0 ? `${locationsList.length} locations saved \u00B7 ${json.assigned} items organized` : `${locationsList.length} locations saved`, "success");
        await new Promise((r) => setTimeout(r, 1000));
        await loadBootstrap(account, true);
      } else showToast(json.error || "Save failed", "error");
    } catch { showToast("Network error", "error"); }
    finally { setBusy(null); }
  };

  const handleBatchMoveItems = async (items) => {
    const res = await fetch("/api/ops/inventory", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "batch-move-items", account, items }) });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Save failed");
    await loadBootstrap(account, true);
  };

  if (loading && !data) return (
    <div className="oh-inv-mgmt-app">
      <div className="oh-inv-mgmt-loading"><div className="oh-spinner" /><p>Loading Inventory Manager...</p></div>
    </div>
  );

  const cp = data?.currentPeriod;
  const days = daysUntil(cp?.due);
  const stats = data?.catalogStats || { totalItems: 0, byCategory: {} };
  const movers = data?.priceMovers || [];
  const locations = data?.locations || [];
  const reviewCount = data?.reviewQueueCount || 0;
  const submitted = data?.currentPeriodSubmitted;
  const draft = data?.activeDraft;
  const lastCount = data?.lastCount;
  const accounts = data?.accounts || [];
  const catalogItems = data?.catalogItems || [];
  const lastCountItems = data?.lastCountItems || {};
  const showBack = screen !== "landing";

  let content = null;

  if (screen === "counting") {
    content = <CountSheet catalogItems={catalogItems} locations={locations} lastCountItems={lastCountItems}
      sessionId={sessionId} account={account} period={cp?.name} onSaveLocation={handleSaveLocation}
      onFinish={() => { showToast("Count Review \u2014 coming next session", "info"); setScreen("landing"); }}
      onBack={() => { setScreen("landing"); setSessionId(null); }} showToast={showToast} />;
  } else if (screen === "manage" && manageView === "locations") {
    content = <LocationSetup locations={locations} account={account} catalogItems={catalogItems}
      onSave={handleSaveLocations} onBack={() => guardNav(() => setManageView(null))} onDirtyChange={(d) => { childDirty.current = d; }} showToast={showToast} />;
  } else if (screen === "manage" && manageView === "placement") {
    content = <ProductPlacement catalogItems={catalogItems} locations={locations}
      onBatchMove={handleBatchMoveItems}
      onDirtyChange={(d) => { childDirty.current = d; }}
      onSaveLocations={(locs) => {
        fetch("/api/ops/inventory", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save-locations", account, locations: locs }) })
          .then(r => r.json()).then(j => { if (!j.success) showToast(j.error || "Save failed", "error"); })
          .catch(() => showToast("Network error", "error"));
      }}
onAddSubZone={(parentLocationId, name, icon) => {
        fetch("/api/ops/inventory", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add-subzone", account, parentLocationId, name, icon }) })
          .then(r => r.json()).then(j => { if (j.success) setTimeout(() => loadBootstrap(account, true), 1500); else showToast(j.error || "Add failed", "error"); })
          .catch(() => showToast("Network error", "error"));
      }}
            onDeactivateLocation={(locationId) => {
        fetch("/api/ops/inventory", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deactivate-location", account, locationId }) })
          .then(r => r.json()).then(j => { if (!j.success) showToast(j.error || "Remove failed", "error"); })
          .catch(() => showToast("Network error", "error"));
      }}
      onSaveSortOrder={(updates) => {
        fetch("/api/ops/inventory", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save-sort-order", account, updates }) })
          .then(r => r.json()).then(j => { if (!j.success) showToast(j.error || "Reorder failed", "error"); })
          .catch(() => showToast("Network error", "error"));
      }}
      showToast={showToast} />;
  } else if (screen === "manage" && manageView === "review") {
    content = <ItemReview catalogItems={catalogItems} locations={locations} account={account}
      onComplete={async () => { setManageView(null); await loadBootstrap(account, true); }}
      onGoToPlacement={async () => { await loadBootstrap(account, true); setManageView("placement"); }}
      showToast={showToast} />;
  } else if (screen === "manage") {
    const unassigned = catalogItems.filter((i) => {
      const locIds = new Set(locations.map((l) => l.locationId));
      return !i.locationId || !locIds.has(i.locationId);
    }).length;
    content = (
      <div className="oh-inv-mgmt-manage"><div className="oh-inv-mgmt-manage-grid">
        {[{ key:"review",label:"Item Review",desc:"Scan for duplicates and clean up your catalog",badge:reviewCount,icon:icons.sparkle,color:"#d97706" },
          { key:"placement",label:"Product Placement",desc:unassigned > 0 ? `${unassigned} items not yet assigned to a location` : "Manage zones, shelves, and organize items",badge:unassigned,icon:icons.grid,color:"#2563eb" },
          { key:"catalog",label:"Item Catalog",desc:`View all ${stats.totalItems} items tracked across your vendors`,icon:icons.list,color:"#8b5cf6" },
          { key:"history",label:"Count History",desc:"Review past counts and compare periods",icon:icons.clipboard,color:"#0891b2" },
          { key:"prices",label:"Price Dashboard",desc:"Track price changes across vendors over time",icon:icons.dollarSign,color:"#ea580c" },
        ].map((item) => (
          <button key={item.key} className="oh-inv-mgmt-manage-card"
            onClick={() => (item.key === "placement" || item.key === "review") ? setManageView(item.key) : showToast(`${item.label} \u2014 coming soon`, "info")}>
            <span className="oh-inv-mgmt-manage-card-icon" style={{background:item.color+"30",color:item.color}}><Icon d={item.icon} size={16} color={item.color} sw={2}/></span>
            <div className="oh-inv-mgmt-manage-card-body">
              <div className="oh-inv-mgmt-manage-card-top">
                <span className="oh-inv-mgmt-manage-card-label">{item.label}</span>
                {item.badge > 0 && <span className="oh-inv-mgmt-manage-badge">{item.badge}</span>}
              </div>
              <span className="oh-inv-mgmt-manage-card-desc">{item.desc}</span>
            </div>
            <Icon d={icons.chevRight} size={14} color="#cbd5e1" style={{flexShrink:0}} />
          </button>
        ))}
      </div></div>
    );
  } else {
    content = (
      <div className="oh-inv-mgmt-landing">
        <div className="oh-inv-mgmt-cta-card">
          {submitted ? (<>
            <div className="oh-inv-mgmt-cta-icon oh-inv-mgmt-cta-icon--success"><Icon d={icons.check} size={28} color="#16A34A" sw={3} /></div>
            <h2 className="oh-inv-mgmt-cta-title">{cp?.name || "P?"} Submitted</h2>
            <p className="oh-inv-mgmt-cta-sub">{lastCount?.submittedBy || ""}{lastCount?.submittedAt ? ` · ${dateFull(lastCount.submittedAt)}` : ""}</p>
            {lastCount && <div className="oh-inv-mgmt-cta-totals">
              {["Food","Packaging","Supplies","Snacks","Beverages"].map((cat) => { const v = lastCount[`total${cat}`] || 0; return v > 0 ? <div key={cat} className="oh-inv-mgmt-cta-total-row"><span>{cat}</span><span>{fmt(v)}</span></div> : null; })}
              <div className="oh-inv-mgmt-cta-total-row oh-inv-mgmt-cta-total-row--grand"><span>Total</span><span>{fmt(lastCount.grandTotal)}</span></div>
            </div>}
          </>) : draft ? (<>
            <div className="oh-inv-mgmt-cta-icon"><Icon d={icons.play} size={28} color="#d97706" sw={2.5} /></div>
            <h2 className="oh-inv-mgmt-cta-title">Resume Count</h2>
            <p className="oh-inv-mgmt-cta-sub">{cp?.name} draft · {dateShort(draft.startedAt)}</p>
            <button className="oh-inv-mgmt-cta-btn" onClick={startCount}>Resume Count</button>
          </>) : (<>
            <div className="oh-inv-mgmt-cta-icon"><Icon d={icons.clipboard} size={28} color="#d97706" sw={2} /></div>
            <h2 className="oh-inv-mgmt-cta-title">Start Inventory Count</h2>
            <p className="oh-inv-mgmt-cta-sub">Count your inventory for this period</p>
            <button className="oh-inv-mgmt-cta-btn" onClick={startCount}>Start Count</button>
          </>)}
        </div>

        {reviewCount > 0 && <div className="oh-inv-mgmt-warning"><Icon d={icons.alert} size={16} color="#d97706" /><span>{reviewCount} item{reviewCount !== 1 ? "s" : ""} need review \u2014 <button className="oh-inv-mgmt-link" onClick={() => setScreen("manage")}>review in Manage</button></span></div>}

        <div className="oh-inv-mgmt-stats">
          <div className="oh-inv-mgmt-stat-card"><span className="oh-inv-mgmt-stat-label">Current Period</span><span className="oh-inv-mgmt-stat-value">{cp?.name || "\u2013"}</span><span className="oh-inv-mgmt-stat-sub">{cp?.start && cp?.end ? `${dateShort(cp.start)} \u2014 ${dateShort(cp.end)}` : "\u2013"}</span></div>
          <div className="oh-inv-mgmt-stat-card"><span className="oh-inv-mgmt-stat-label">Days Until Due</span><span className={`oh-inv-mgmt-stat-value${days !== null && days <= 7 ? " oh-inv-mgmt-stat-value--urgent" : ""}`}>{days ?? "\u2013"}</span><span className="oh-inv-mgmt-stat-sub">Due {dateFull(cp?.due)}</span></div>
          <div className="oh-inv-mgmt-stat-card"><span className="oh-inv-mgmt-stat-label">Items in Catalog</span><span className="oh-inv-mgmt-stat-value">{stats.totalItems}</span><span className="oh-inv-mgmt-stat-sub">{locations.length} location{locations.length !== 1 ? "s" : ""}</span></div>
        </div>

        {stats.totalItems === 0 && (
          <div className="oh-inv-mgmt-empty-state">
            <Icon d={icons.box} size={32} color="#e2e8f0" sw={1.5} />
            <h3>No catalog items yet</h3>
            <p>Items will appear automatically as invoices are processed through Invoice Capture.</p>
          </div>
        )}

        {movers.length > 0 && <div className="oh-inv-mgmt-section">
          <button className="oh-inv-mgmt-section-header" onClick={() => setPriceOpen(!priceOpen)}><span className="oh-inv-mgmt-section-title">Price Movement</span><Icon d={priceOpen ? icons.chevUp : icons.chevDown} size={16} color="#64748b" /></button>
          {priceOpen && <div className="oh-inv-mgmt-movers">{movers.map((m, i) => (
            <div key={i} className="oh-inv-mgmt-mover-row"><div className="oh-inv-mgmt-mover-left"><Icon d={m.direction==="up"?icons.trendUp:icons.trendDown} size={14} color={m.direction==="up"?"#d97706":"#16A34A"} /><div className="oh-inv-mgmt-mover-info"><span className="oh-inv-mgmt-mover-name">{m.name}</span><span className="oh-inv-mgmt-mover-vendor">{m.vendor}</span></div></div><div className="oh-inv-mgmt-mover-right"><span className="oh-inv-mgmt-mover-price">{fmt(m.currentPrice)}</span><span className={`oh-inv-mgmt-mover-change${m.direction==="up"?" up":" down"}`}>{m.direction==="up"?"+":""}{m.pctChange}%</span></div></div>
          ))}</div>}
        </div>}
      </div>
    );
  }

  return (
    <div className="oh-inv-mgmt-app">
      <div className="oh-inv-mgmt-header">
        <div className="oh-inv-mgmt-header-left">
          {showBack ? (
            <button className="oh-inv-mgmt-back" onClick={() => guardNav(() => { setScreen("landing"); setSessionId(null); setManageView(null); })}>
              <Icon d={icons.arrowLeft} size={18} color="#fff" />
            </button>
          ) : <Icon d={icons.box} size={15} color="#fff" />}
          <span className="oh-inv-mgmt-header-title">Inventory Manager</span>
        </div>
        <div className="oh-inv-mgmt-header-right">
          <button className="oh-inv-mgmt-account-btn" onClick={() => setAccountOpen(!accountOpen)}>
            <span>{account || "Select"}</span>
            <Icon d={accountOpen ? icons.chevUp : icons.chevDown} size={12} color="#94a3b8" />
          </button>
          <span className="oh-inv-mgmt-header-sep">|</span>
          <button className="oh-inv-mgmt-gear-btn" onClick={() => guardNav(() => { setScreen(screen === "manage" ? "landing" : "manage"); setManageView(null); })}>
            <Icon d={icons.gear} size={16} color="#fff" />
            {reviewCount > 0 && <span className="oh-inv-mgmt-gear-badge">{reviewCount}</span>}
          </button>
        </div>
        {accountOpen && <div className="oh-inv-mgmt-account-dropdown">
          {accounts.map((a) => <button key={a.label} className={`oh-inv-mgmt-account-option${a.label === account ? " active" : ""}`} onClick={() => guardNav(() => switchAccount(a.label))}>{a.label}</button>)}
        </div>}
      </div>
      {content}
      {busy && <div className="oh-inv-mgmt-busy-overlay"><div className="oh-inv-mgmt-busy-card">
        <div className="oh-inv-mgmt-busy-spinner" /><h3 className="oh-inv-mgmt-busy-title">{busy.title}</h3><p className="oh-inv-mgmt-busy-sub">{busy.sub}</p>
      </div></div>}
    </div>
  );
}
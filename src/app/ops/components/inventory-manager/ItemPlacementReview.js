"use client";
import { useState, useEffect, useCallback } from "react";
import CountSheet from "./CountSheet";
import LocationSetup from "./LocationSetup";
import ItemPlacementReview from "./ItemPlacementReview";
import QuickTour from "./QuickTour";

// ── Icons ──
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
};

const fmt = (n) => "$" + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const daysUntil = (due) => { if (!due) return null; try { return Math.ceil((new Date(due) - new Date()) / 86400000); } catch { return null; } };
const dateShort = (v) => { if (!v) return "–"; try { return new Date(v).toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch { return "–"; } };
const dateFull = (v) => { if (!v) return "–"; try { return new Date(v).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); } catch { return "–"; } };

// ── Setup state localStorage ──
const SETUP_KEY_PREFIX = "kf_inv_setup_";
function getSetupState(account) {
  if (typeof window === "undefined") return { items: false, layout: false, tour: false };
  try {
    const raw = localStorage.getItem(SETUP_KEY_PREFIX + account);
    return raw ? JSON.parse(raw) : { items: false, layout: false, tour: false };
  } catch { return { items: false, layout: false, tour: false }; }
}
function saveSetupState(account, state) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SETUP_KEY_PREFIX + account, JSON.stringify(state));
}

export default function InventoryManager({ config, showToast, openConfirm, onNavigate }) {
  const [screen, setScreen] = useState("landing");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const [manageView, setManageView] = useState(null);
  const [setupStep, setSetupStep] = useState(null); // null | "layout" | "placement" | "tour"
  const [setupState, setSetupState] = useState({ items: false, layout: false, tour: false });

  // ── Bootstrap ──
  const loadBootstrap = useCallback(async (acct) => {
    setLoading(true);
    try {
      const params = acct ? `&account=${encodeURIComponent(acct)}` : "";
      const res = await fetch(`/api/ops/inventory?action=bootstrap${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
        if (!acct && json.account) setAccount(json.account);
      } else { showToast(json.error || "Failed to load", "error"); }
    } catch { showToast("Network error", "error"); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { loadBootstrap(account); }, [account]); // eslint-disable-line

  // Load setup state when account changes
  useEffect(() => {
    if (account) {
      const ss = getSetupState(account);
      setSetupState(ss);
    }
  }, [account]);

  // Auto-check items step if catalog has items
  useEffect(() => {
    if (data?.catalogStats?.totalItems > 0 && !setupState.items) {
      const next = { ...setupState, items: true };
      setSetupState(next);
      saveSetupState(account, next);
    }
  }, [data?.catalogStats?.totalItems]); // eslint-disable-line

  const switchAccount = (label) => {
    setAccount(label); setAccountOpen(false); setScreen("landing");
    setSessionId(null); setManageView(null); setSetupStep(null);
  };

  // ── Is setup complete? ──
  const isSetupDone = setupState.items && setupState.layout && setupState.tour;
  const isFirstTime = !isSetupDone;

  // ── Complete a setup step ──
  const completeSetupStep = (step) => {
    const next = { ...setupState, [step]: true };
    setSetupState(next);
    saveSetupState(account, next);
    setSetupStep(null);
  };

  // ── Start Count ──
  const startCount = async () => {
    const cp = data?.currentPeriod;
    if (!cp?.name) { showToast("No active period found", "error"); return; }
    if (data?.activeDraft?.sessionId) {
      setSessionId(data.activeDraft.sessionId); setScreen("counting"); return;
    }
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-session", account, period: cp.name }),
      });
      const json = await res.json();
      if (json.success) { setSessionId(json.sessionId); setScreen("counting"); }
      else { showToast(json.error || "Failed to start", "error"); }
    } catch { showToast("Network error", "error"); }
  };

  // ── Save handlers ──
  const handleSaveLocation = async (locationId, items) => {
    if (!sessionId) return;
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-count", sessionId, locationId, items }),
      });
      const json = await res.json();
      if (json.success) showToast(`Saved ${json.itemCount} items`, "success");
    } catch { showToast("Save failed", "error"); }
  };

  const handleSaveLocations = async (locationsList) => {
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-locations", account, locations: locationsList }),
      });
      const json = await res.json();
      if (json.success) await loadBootstrap(account);
      else showToast(json.error || "Save failed", "error");
    } catch { showToast("Network error", "error"); }
  };

  const handleBatchMoveItems = async (movedItems) => {
    if (movedItems.length === 0) {
      completeSetupStep("layout");
      return;
    }
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "batch-move-items", account, items: movedItems }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(`${movedItems.length} item${movedItems.length !== 1 ? "s" : ""} updated`, "success");
        await loadBootstrap(account);
      }
    } catch { showToast("Save failed", "error"); }
    completeSetupStep("layout");
  };

  // ── Loading ──
  if (loading && !data) {
    return (
      <div className="oh-inv-mgmt-app">
        <div className="oh-inv-mgmt-loading"><div className="oh-spinner" /><p>Loading Inventory Manager...</p></div>
      </div>
    );
  }

  // ── Derived ──
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

  // Count unique vendors
  const vendorCount = new Set(catalogItems.map((i) => i.primaryVendor || i.lastPriceVendor).filter(Boolean)).size;

  // ── Header ──
  const Header = () => (
    <div className="oh-inv-mgmt-header">
      <div className="oh-inv-mgmt-header-left">
        {screen !== "landing" || setupStep ? (
          <button className="oh-inv-mgmt-back" onClick={() => {
            if (setupStep) { setSetupStep(null); }
            else { setScreen("landing"); setSessionId(null); setManageView(null); }
          }}>
            <Icon d={icons.arrowLeft} size={18} color="#fff" />
          </button>
        ) : (
          <Icon d={icons.box} size={15} color="#fff" />
        )}
        <span className="oh-inv-mgmt-header-title">Inventory Manager</span>
      </div>
      <div className="oh-inv-mgmt-header-right">
        <button className="oh-inv-mgmt-account-btn" onClick={() => setAccountOpen(!accountOpen)}>
          <span>{account || "Select"}</span>
          <Icon d={accountOpen ? icons.chevUp : icons.chevDown} size={12} color="#94a3b8" />
        </button>
        <span className="oh-inv-mgmt-header-sep">|</span>
        <button className="oh-inv-mgmt-gear-btn" onClick={() => { setScreen(screen === "manage" ? "landing" : "manage"); setManageView(null); setSetupStep(null); }}>
          <Icon d={icons.gear} size={16} color="#fff" />
          {reviewCount > 0 && <span className="oh-inv-mgmt-gear-badge">{reviewCount}</span>}
        </button>
      </div>
      {accountOpen && (
        <div className="oh-inv-mgmt-account-dropdown">
          {accounts.map((a) => (
            <button key={a.label} className={`oh-inv-mgmt-account-option${a.label === account ? " active" : ""}`}
              onClick={() => switchAccount(a.label)}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );

  // ── Manage Screen ──
  const ManageScreen = () => {
    if (manageView === "locations") {
      return <LocationSetup locations={locations} account={account} catalogItems={catalogItems}
        onSave={handleSaveLocations} onBack={() => setManageView(null)} showToast={showToast} />;
    }
    return (
      <div className="oh-inv-mgmt-manage">
        <div className="oh-inv-mgmt-manage-grid">
          {[
            { key: "health", label: "Catalog Health", desc: `${reviewCount} items need review`, badge: reviewCount },
            { key: "history", label: "Count History", desc: "Past counts & drill-down" },
            { key: "catalog", label: "Item Catalog", desc: `${stats.totalItems} items` },
            { key: "print", label: "Print Count Sheets", desc: "PDF & Excel with QR codes" },
            { key: "locations", label: "Storage Locations", desc: `${locations.length} locations` },
            { key: "prices", label: "Price Dashboard", desc: "Trends & vendor comparison" },
          ].map((item) => (
            <button key={item.key} className="oh-inv-mgmt-manage-card"
              onClick={() => item.key === "locations" ? setManageView("locations") : showToast(`${item.label} — coming soon`, "info")}>
              <div className="oh-inv-mgmt-manage-card-top">
                <span className="oh-inv-mgmt-manage-card-label">{item.label}</span>
                {item.badge > 0 && <span className="oh-inv-mgmt-manage-badge">{item.badge}</span>}
              </div>
              <span className="oh-inv-mgmt-manage-card-desc">{item.desc}</span>
              <Icon d={icons.chevRight} size={14} color="#94a3b8" style={{ position:"absolute",right:12,top:"50%",transform:"translateY(-50%)" }} />
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════
  // FIRST-TIME CHECKLIST LANDING
  // ═══════════════════════════════════
  const FirstTimeLanding = () => {
    // If a setup step is active, show that screen
    if (setupStep === "placement") {
      return <ItemPlacementReview catalogItems={catalogItems} locations={locations}
        onComplete={handleBatchMoveItems} onBack={() => setSetupStep(null)} showToast={showToast} />;
    }
    if (setupStep === "tour") {
      return <QuickTour onComplete={() => completeSetupStep("tour")} />;
    }
    if (setupStep === "layout-setup") {
      return <LocationSetup locations={locations} account={account} catalogItems={catalogItems}
        onSave={async (locs) => {
          await handleSaveLocations(locs);
          completeSetupStep("layout");
          // If layout done but placement not reviewed, go to placement next
          if (!setupState.layout) setSetupStep("placement");
        }}
        onBack={() => setSetupStep(null)} showToast={showToast} />;
    }

    const stepsComplete = [setupState.items, setupState.layout, setupState.tour].filter(Boolean).length;

    return (
      <div className="oh-inv-mgmt-landing">
        {/* Hero */}
        <div className="oh-inv-mgmt-ftux-hero">
          <div className="oh-inv-mgmt-ftux-sparkle">
            <Icon d={icons.sparkle} size={32} color="#d97706" sw={1.5} />
          </div>
          <h2 className="oh-inv-mgmt-ftux-title">Your inventory just got smarter.</h2>
          <p className="oh-inv-mgmt-ftux-sub">
            We've already built your count sheet from your invoices — {stats.totalItems} items
            {vendorCount > 0 ? ` from ${vendorCount} vendors` : ""}, organized by where they live in your kitchen. 
            No spreadsheets. No data entry. Just walk, count, done.
          </p>
        </div>

        {/* Checklist */}
        <div className="oh-inv-mgmt-ftux-checklist">
          <p className="oh-inv-mgmt-ftux-checklist-label">
            Let's make sure everything looks right before your first count.
          </p>

          {/* Step 1: Items loaded (auto-complete) */}
          <div className={`oh-inv-mgmt-ftux-step${setupState.items ? " done" : ""}`}>
            <div className="oh-inv-mgmt-ftux-step-check">
              {setupState.items
                ? <Icon d={icons.check} size={14} color="#16A34A" sw={3} />
                : <span className="oh-inv-mgmt-ftux-step-circle" />
              }
            </div>
            <div className="oh-inv-mgmt-ftux-step-content">
              <span className="oh-inv-mgmt-ftux-step-title">Your items are loaded</span>
              <span className="oh-inv-mgmt-ftux-step-meta">
                {stats.totalItems} items{vendorCount > 0 ? ` from ${vendorCount} vendors` : ""} — pulled automatically from your invoices
              </span>
            </div>
          </div>

          {/* Step 2: Kitchen layout */}
          <button
            className={`oh-inv-mgmt-ftux-step${setupState.layout ? " done" : ""}`}
            onClick={() => {
              if (!setupState.layout) {
                // If no locations exist yet, go to location setup first
                if (locations.length === 0) setSetupStep("layout-setup");
                else setSetupStep("placement");
              }
            }}
            disabled={setupState.layout}
          >
            <div className="oh-inv-mgmt-ftux-step-check">
              {setupState.layout
                ? <Icon d={icons.check} size={14} color="#16A34A" sw={3} />
                : <span className="oh-inv-mgmt-ftux-step-circle" />
              }
            </div>
            <div className="oh-inv-mgmt-ftux-step-content">
              <span className="oh-inv-mgmt-ftux-step-title">Confirm your kitchen layout</span>
              <span className="oh-inv-mgmt-ftux-step-meta">
                {locations.length > 0
                  ? `${locations.length} locations set up — review where items are assigned`
                  : "set up your storage locations and review item placement"
                } · ~2 min
              </span>
            </div>
            {!setupState.layout && <Icon d={icons.chevRight} size={16} color="#d97706" />}
          </button>

          {/* Step 3: Quick tour */}
          <button
            className={`oh-inv-mgmt-ftux-step${setupState.tour ? " done" : ""}`}
            onClick={() => { if (!setupState.tour) setSetupStep("tour"); }}
            disabled={setupState.tour}
          >
            <div className="oh-inv-mgmt-ftux-step-check">
              {setupState.tour
                ? <Icon d={icons.check} size={14} color="#16A34A" sw={3} />
                : <span className="oh-inv-mgmt-ftux-step-circle" />
              }
            </div>
            <div className="oh-inv-mgmt-ftux-step-content">
              <span className="oh-inv-mgmt-ftux-step-title">Take a quick look</span>
              <span className="oh-inv-mgmt-ftux-step-meta">See how counting works before you start · ~30 sec</span>
            </div>
            {!setupState.tour && <Icon d={icons.chevRight} size={16} color="#d97706" />}
          </button>
        </div>

        {/* Skip link */}
        <button className="oh-inv-mgmt-ftux-skip" onClick={() => {
          const done = { items: true, layout: true, tour: true };
          setSetupState(done); saveSetupState(account, done);
        }}>
          Skip setup and count now →
        </button>
      </div>
    );
  };

  // ═══════════════════════════════════
  // NORMAL LANDING (after setup done)
  // ═══════════════════════════════════
  const NormalLanding = () => (
    <div className="oh-inv-mgmt-landing">
      <div className="oh-inv-mgmt-cta-card">
        {submitted ? (
          <>
            <div className="oh-inv-mgmt-cta-icon oh-inv-mgmt-cta-icon--success"><Icon d={icons.check} size={28} color="#16A34A" sw={3} /></div>
            <h2 className="oh-inv-mgmt-cta-title">{cp?.name || "P?"} Submitted</h2>
            <p className="oh-inv-mgmt-cta-sub">{lastCount?.submittedBy || ""}{lastCount?.submittedAt ? ` · ${dateFull(lastCount.submittedAt)}` : ""}</p>
            {lastCount && (
              <div className="oh-inv-mgmt-cta-totals">
                {["Food","Packaging","Supplies","Snacks","Beverages"].map((cat) => {
                  const val = lastCount[`total${cat}`] || 0;
                  return val > 0 ? <div key={cat} className="oh-inv-mgmt-cta-total-row"><span>{cat}</span><span>{fmt(val)}</span></div> : null;
                })}
                <div className="oh-inv-mgmt-cta-total-row oh-inv-mgmt-cta-total-row--grand"><span>Total</span><span>{fmt(lastCount.grandTotal)}</span></div>
              </div>
            )}
          </>
        ) : draft ? (
          <>
            <div className="oh-inv-mgmt-cta-icon"><Icon d={icons.play} size={28} color="#d97706" sw={2.5} /></div>
            <h2 className="oh-inv-mgmt-cta-title">Resume Count</h2>
            <p className="oh-inv-mgmt-cta-sub">{cp?.name} draft · {dateShort(draft.startedAt)}</p>
            <button className="oh-inv-mgmt-cta-btn" onClick={startCount}>Resume Count</button>
          </>
        ) : (
          <>
            <div className="oh-inv-mgmt-cta-icon"><Icon d={icons.clipboard} size={28} color="#d97706" sw={2} /></div>
            <h2 className="oh-inv-mgmt-cta-title">Start Inventory Count</h2>
            <p className="oh-inv-mgmt-cta-sub">Count your inventory for this period</p>
            <button className="oh-inv-mgmt-cta-btn" onClick={startCount}>Start Count</button>
          </>
        )}
      </div>

      {reviewCount > 0 && (
        <div className="oh-inv-mgmt-warning">
          <Icon d={icons.alert} size={16} color="#d97706" />
          <span>{reviewCount} item{reviewCount !== 1 ? "s" : ""} need review — <button className="oh-inv-mgmt-link" onClick={() => setScreen("manage")}>review in Manage</button></span>
        </div>
      )}

      <div className="oh-inv-mgmt-stats">
        <div className="oh-inv-mgmt-stat-card">
          <span className="oh-inv-mgmt-stat-label">Current Period</span>
          <span className="oh-inv-mgmt-stat-value">{cp?.name || "–"}</span>
          <span className="oh-inv-mgmt-stat-sub">{cp?.start && cp?.end ? `${dateShort(cp.start)} — ${dateShort(cp.end)}` : "–"}</span>
        </div>
        <div className="oh-inv-mgmt-stat-card">
          <span className="oh-inv-mgmt-stat-label">Days Until Due</span>
          <span className={`oh-inv-mgmt-stat-value${days !== null && days <= 7 ? " oh-inv-mgmt-stat-value--urgent" : ""}`}>{days ?? "–"}</span>
          <span className="oh-inv-mgmt-stat-sub">Due {dateFull(cp?.due)}</span>
        </div>
        <div className="oh-inv-mgmt-stat-card">
          <span className="oh-inv-mgmt-stat-label">Items in Catalog</span>
          <span className="oh-inv-mgmt-stat-value">{stats.totalItems}</span>
          <span className="oh-inv-mgmt-stat-sub">{locations.length} location{locations.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {movers.length > 0 && (
        <div className="oh-inv-mgmt-section">
          <button className="oh-inv-mgmt-section-header" onClick={() => setPriceOpen(!priceOpen)}>
            <span className="oh-inv-mgmt-section-title">Price Movement</span>
            <Icon d={priceOpen ? icons.chevUp : icons.chevDown} size={16} color="#64748b" />
          </button>
          {priceOpen && (
            <div className="oh-inv-mgmt-movers">
              {movers.map((m, i) => (
                <div key={i} className="oh-inv-mgmt-mover-row">
                  <div className="oh-inv-mgmt-mover-left">
                    <Icon d={m.direction === "up" ? icons.trendUp : icons.trendDown} size={14} color={m.direction === "up" ? "#d97706" : "#16A34A"} />
                    <div className="oh-inv-mgmt-mover-info">
                      <span className="oh-inv-mgmt-mover-name">{m.name}</span>
                      <span className="oh-inv-mgmt-mover-vendor">{m.vendor}</span>
                    </div>
                  </div>
                  <div className="oh-inv-mgmt-mover-right">
                    <span className="oh-inv-mgmt-mover-price">{fmt(m.currentPrice)}</span>
                    <span className={`oh-inv-mgmt-mover-change${m.direction === "up" ? " up" : " down"}`}>{m.direction === "up" ? "+" : ""}{m.pctChange}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Render ──
  return (
    <div className="oh-inv-mgmt-app">
      <Header />
      {screen === "landing" && !setupStep && (isFirstTime ? <FirstTimeLanding /> : <NormalLanding />)}
      {screen === "landing" && setupStep && <FirstTimeLanding />}
      {screen === "manage" && <ManageScreen />}
      {screen === "counting" && (
        <CountSheet catalogItems={catalogItems} locations={locations} lastCountItems={lastCountItems}
          sessionId={sessionId} account={account} period={cp?.name}
          onSaveLocation={handleSaveLocation}
          onFinish={() => { showToast("Count Review — coming next session", "info"); setScreen("landing"); }}
          onBack={() => { setScreen("landing"); setSessionId(null); }}
          showToast={showToast} />
      )}
    </div>
  );
}
"use client";
import { useState, useEffect, useCallback } from "react";
import CountSheet from "./CountSheet";
import LocationSetup from "./LocationSetup";

/**
 * InventoryManager.js — Main Wrapper (Two-Mode)
 */

// ── Icons ──
const Icon = ({ d, size = 16, color = "#64748b", sw = 2, style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const icons = {
  box: ["M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z", "M3.27 6.96L12 12.01l8.73-5.05", "M12 22.08V12"],
  gear: ["M12 15a3 3 0 100-6 3 3 0 000 6z", "M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"],
  chevDown: "M6 9l6 6 6-6",
  chevUp: "M18 15l-6-6-6 6",
  chevRight: "M9 18l6-6-6-6",
  arrowLeft: ["M19 12H5", "M12 19l-7-7 7-7"],
  trendUp: ["M23 6l-9.5 9.5-5-5L1 18", "M17 6h6v6"],
  trendDown: ["M23 18l-9.5-9.5-5 5L1 6", "M17 18h6v-6"],
  alert: ["M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z", "M12 9v4", "M12 17h.01"],
  check: "M20 6L9 17l-5-5",
  clipboard: ["M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2", "M8 2h8a1 1 0 011 1v2a1 1 0 01-1 1H8a1 1 0 01-1-1V3a1 1 0 011-1z"],
  play: "M5 3l14 9-14 9V3z",
};

const fmt = (n) => "$" + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const daysUntil = (due) => {
  if (!due) return null;
  try { const d = new Date(due); return isNaN(d) ? null : Math.ceil((d - new Date()) / 86400000); } catch { return null; }
};
const dateShort = (v) => {
  if (!v) return "–";
  try { const d = new Date(v); return isNaN(d) ? "–" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return "–"; }
};
const dateFull = (v) => {
  if (!v) return "–";
  try { const d = new Date(v); return isNaN(d) ? "–" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch { return "–"; }
};

export default function InventoryManager({ config, showToast, openConfirm, onNavigate }) {
  const [screen, setScreen] = useState("landing");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(true);
  const [sessionId, setSessionId] = useState(null);
  const [manageView, setManageView] = useState(null); // null | "locations" | "health" | etc.

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
      } else {
        showToast(json.error || "Failed to load", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadBootstrap(account); }, [account]); // eslint-disable-line

  const switchAccount = (label) => {
    setAccount(label);
    setAccountOpen(false);
    setScreen("landing");
    setSessionId(null);
  };

  // ── Start Count ──
  const startCount = async () => {
    const cp = data?.currentPeriod;
    if (!cp?.name) { showToast("No active period found", "error"); return; }
    
    // Resume existing draft
    if (data?.activeDraft?.sessionId) {
      setSessionId(data.activeDraft.sessionId);
      setScreen("counting");
      return;
    }

    // Create new session
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-session", account, period: cp.name }),
      });
      const json = await res.json();
      if (json.success) {
        setSessionId(json.sessionId);
        setScreen("counting");
      } else {
        showToast(json.error || "Failed to start session", "error");
      }
    } catch {
      showToast("Network error", "error");
    }
  };

  // ── Save Location (called from CountSheet) ──
  const handleSaveLocation = async (locationId, items) => {
    if (!sessionId) return;
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-count", sessionId, locationId, items }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(`Saved ${json.itemCount} items`, "success");
      }
    } catch {
      showToast("Save failed", "error");
    }
  };

  // ── Save Storage Locations (called from LocationSetup) ──
  const handleSaveLocations = async (locationsList) => {
    try {
      const res = await fetch("/api/ops/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-locations", account, locations: locationsList }),
      });
      const json = await res.json();
      if (json.success) {
        // Reload bootstrap to get updated locations
        await loadBootstrap(account);
      } else {
        showToast(json.error || "Save failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    }
  };

  // ── Loading ──
  if (loading && !data) {
    return (
      <div className="oh-inv-mgmt-app">
        <div className="oh-inv-mgmt-loading">
          <div className="oh-spinner" />
          <p>Loading Inventory Manager...</p>
        </div>
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

  // ── Header ──
  const Header = () => (
    <div className="oh-inv-mgmt-header">
      <div className="oh-inv-mgmt-header-left">
        {screen !== "landing" ? (
          <button className="oh-inv-mgmt-back" onClick={() => { setScreen("landing"); setSessionId(null); setManageView(null); }}>
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
        <button className="oh-inv-mgmt-gear-btn" onClick={() => { setScreen(screen === "manage" ? "landing" : "manage"); setManageView(null); }}>
          <Icon d={icons.gear} size={16} color="#fff" />
          {reviewCount > 0 && <span className="oh-inv-mgmt-gear-badge">{reviewCount}</span>}
        </button>
      </div>
      {accountOpen && (
        <div className="oh-inv-mgmt-account-dropdown">
          {accounts.map((a) => (
            <button key={a.label}
              className={`oh-inv-mgmt-account-option${a.label === account ? " active" : ""}`}
              onClick={() => switchAccount(a.label)}
            >{a.label}</button>
          ))}
        </div>
      )}
    </div>
  );

  // ── Manage Screen ──
  const ManageScreen = () => {
    // If a sub-view is selected, render it
    if (manageView === "locations") {
      return (
        <LocationSetup
          locations={locations}
          account={account}
          catalogItems={catalogItems}
          onSave={handleSaveLocations}
          onBack={() => setManageView(null)}
          showToast={showToast}
        />
      );
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
              onClick={() => {
                if (item.key === "locations") { setManageView("locations"); }
                else { showToast(`${item.label} — coming in Weeks 3-4`, "info"); }
              }}>
              <div className="oh-inv-mgmt-manage-card-top">
                <span className="oh-inv-mgmt-manage-card-label">{item.label}</span>
                {item.badge > 0 && <span className="oh-inv-mgmt-manage-badge">{item.badge}</span>}
              </div>
              <span className="oh-inv-mgmt-manage-card-desc">{item.desc}</span>
              <Icon d={icons.chevRight} size={14} color="#94a3b8" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }} />
            </button>
          ))}
        </div>
      </div>
    );
  };

  // ── Landing Screen ──
  const LandingScreen = () => (
    <div className="oh-inv-mgmt-landing">
      {/* CTA */}
      <div className="oh-inv-mgmt-cta-card">
        {submitted ? (
          <>
            <div className="oh-inv-mgmt-cta-icon oh-inv-mgmt-cta-icon--success">
              <Icon d={icons.check} size={28} color="#16A34A" sw={3} />
            </div>
            <h2 className="oh-inv-mgmt-cta-title">{cp?.name || "P?"} Submitted</h2>
            <p className="oh-inv-mgmt-cta-sub">
              {lastCount?.submittedBy ? `by ${lastCount.submittedBy}` : ""}
              {lastCount?.submittedAt ? ` · ${dateFull(lastCount.submittedAt)}` : ""}
            </p>
            {lastCount && (
              <div className="oh-inv-mgmt-cta-totals">
                {["Food", "Packaging", "Supplies", "Snacks", "Beverages"].map((cat) => {
                  const val = lastCount[`total${cat}`] || 0;
                  return val > 0 ? (
                    <div key={cat} className="oh-inv-mgmt-cta-total-row"><span>{cat}</span><span>{fmt(val)}</span></div>
                  ) : null;
                })}
                <div className="oh-inv-mgmt-cta-total-row oh-inv-mgmt-cta-total-row--grand">
                  <span>Total</span><span>{fmt(lastCount.grandTotal)}</span>
                </div>
              </div>
            )}
          </>
        ) : draft ? (
          <>
            <div className="oh-inv-mgmt-cta-icon"><Icon d={icons.play} size={28} color="#d97706" sw={2.5} /></div>
            <h2 className="oh-inv-mgmt-cta-title">Resume Count</h2>
            <p className="oh-inv-mgmt-cta-sub">{cp?.name || "P?"} draft started {dateShort(draft.startedAt)}</p>
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

      {/* Completeness warning */}
      {reviewCount > 0 && (
        <div className="oh-inv-mgmt-warning">
          <Icon d={icons.alert} size={16} color="#d97706" />
          <span>{reviewCount} item{reviewCount !== 1 ? "s" : ""} from recent invoices need review — <button className="oh-inv-mgmt-link" onClick={() => setScreen("manage")}>review in Manage</button></span>
        </div>
      )}

      {/* Stats */}
      <div className="oh-inv-mgmt-stats">
        <div className="oh-inv-mgmt-stat-card">
          <span className="oh-inv-mgmt-stat-label">Current Period</span>
          <span className="oh-inv-mgmt-stat-value">{cp?.name || "–"}</span>
          <span className="oh-inv-mgmt-stat-sub">{cp?.start && cp?.end ? `${dateShort(cp.start)} — ${dateShort(cp.end)}` : "–"}</span>
        </div>
        <div className="oh-inv-mgmt-stat-card">
          <span className="oh-inv-mgmt-stat-label">Days Until Due</span>
          <span className={`oh-inv-mgmt-stat-value${days !== null && days <= 7 ? " oh-inv-mgmt-stat-value--urgent" : ""}`}>
            {days !== null ? days : "–"}
          </span>
          <span className="oh-inv-mgmt-stat-sub">Due {dateFull(cp?.due)}</span>
        </div>
        <div className="oh-inv-mgmt-stat-card">
          <span className="oh-inv-mgmt-stat-label">Items in Catalog</span>
          <span className="oh-inv-mgmt-stat-value">{stats.totalItems}</span>
          <span className="oh-inv-mgmt-stat-sub">{locations.length} location{locations.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Price movers */}
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
                      <span className="oh-inv-mgmt-mover-vendor">{m.vendor || ""}</span>
                    </div>
                  </div>
                  <div className="oh-inv-mgmt-mover-right">
                    <span className="oh-inv-mgmt-mover-price">{fmt(m.currentPrice)}</span>
                    <span className={`oh-inv-mgmt-mover-change${m.direction === "up" ? " up" : " down"}`}>
                      {m.direction === "up" ? "+" : ""}{m.pctChange}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {stats.totalItems === 0 && !loading && (
        <div className="oh-inv-mgmt-empty">
          <Icon d={icons.box} size={40} color="#e2e8f0" sw={1.5} />
          <p className="oh-inv-mgmt-empty-title">No catalog items yet</p>
          <p className="oh-inv-mgmt-empty-desc">Items will appear automatically as invoices are processed through Invoice Capture.</p>
        </div>
      )}
    </div>
  );

  // ── Render ──
  return (
    <div className="oh-inv-mgmt-app">
      <Header />
      {screen === "landing" && <LandingScreen />}
      {screen === "manage" && <ManageScreen />}
      {screen === "counting" && (
        <CountSheet
          catalogItems={catalogItems}
          locations={locations}
          lastCountItems={lastCountItems}
          sessionId={sessionId}
          account={account}
          period={cp?.name}
          onSaveLocation={handleSaveLocation}
          onFinish={() => {
            showToast("Count Review — coming in Week 2 Session 7", "info");
            setScreen("landing");
          }}
          onBack={() => { setScreen("landing"); setSessionId(null); }}
          showToast={showToast}
        />
      )}
      {screen === "review" && (
        <div className="oh-inv-mgmt-placeholder">
          <p>Count Review — Week 2</p>
          <button className="oh-inv-mgmt-cta-btn" onClick={() => setScreen("landing")}>Back</button>
        </div>
      )}
    </div>
  );
}
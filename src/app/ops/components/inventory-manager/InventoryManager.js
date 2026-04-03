"use client";
import { useState, useEffect, useCallback } from "react";

/**
 * InventoryManager.js — Main Wrapper (Two-Mode)
 * 
 * Count Mode (default): Landing → Count → Review → Submit → Success
 * Manage Mode (gear icon): Catalog Health, History, Catalog, Print, Locations, Prices
 * 
 * Dev gate applied at page.js level — this component only renders for authorized users.
 */

// ── Icons (Lucide-compatible SVG) ──
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
  calendar: ["M3 4a2 2 0 012-2h14a2 2 0 012 2v16a2 2 0 01-2 2H5a2 2 0 01-2-2V4z", "M16 2v4", "M8 2v4", "M3 10h18"],
  clock: ["M12 2a10 10 0 100 20 10 10 0 000-20z", "M12 6v6l4 2"],
  layers: ["M12 2L2 7l10 5 10-5-10-5z", "M2 17l10 5 10-5", "M2 12l10 5 10-5"],
  check: "M20 6L9 17l-5-5",
  clipboard: ["M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2", "M8 2h8a1 1 0 011 1v2a1 1 0 01-1 1H8a1 1 0 01-1-1V3a1 1 0 011-1z"],
  play: "M5 3l14 9-14 9V3z",
};

// ── Helpers ──
const fmt = (n) => "$" + Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const daysUntil = (due) => {
  if (!due) return null;
  const d = new Date(due + "T00:00:00");
  return isNaN(d.getTime()) ? null : Math.ceil((d - new Date()) / 86400000);
};
const dateShort = (v) => {
  if (!v) return "–";
  try {
    const d = new Date(String(v).trim() + (/^\d{4}-\d{2}-\d{2}$/.test(v) ? "T00:00:00" : ""));
    return isNaN(d.getTime()) ? "–" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return "–"; }
};
const dateFull = (v) => {
  if (!v) return "–";
  try {
    const d = new Date(String(v).trim() + (/^\d{4}-\d{2}-\d{2}$/.test(v) ? "T00:00:00" : ""));
    return isNaN(d.getTime()) ? "–" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return "–"; }
};

export default function InventoryManager({ config, showToast, openConfirm, onNavigate }) {
  // ── State ──
  const [screen, setScreen] = useState("landing"); // landing | counting | review | success | manage
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [priceOpen, setPriceOpen] = useState(true);
  const [manageSheet, setManageSheet] = useState(null);

  // ── Bootstrap ──
  const loadBootstrap = useCallback(async (acct) => {
    setLoading(true);
    try {
      const params = acct ? `&account=${encodeURIComponent(acct)}` : "";
      const res = await fetch(`/api/ops/inventory?action=bootstrap${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
        if (!acct) setAccount(json.account);
      } else {
        showToast(json.error || "Failed to load inventory data", "error");
      }
    } catch (e) {
      showToast("Network error loading inventory", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { loadBootstrap(account); }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Switch account ──
  const switchAccount = (label) => {
    setAccount(label);
    setAccountOpen(false);
    setScreen("landing");
  };

  // ── Loading state ──
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

  // ── Derived data ──
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

  // ── Header ──
  const Header = () => (
    <div className="oh-inv-mgmt-header">
      <div className="oh-inv-mgmt-header-left">
        {screen !== "landing" ? (
          <button className="oh-inv-mgmt-back" onClick={() => setScreen("landing")}>
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
        <button className="oh-inv-mgmt-gear-btn" onClick={() => setScreen(screen === "manage" ? "landing" : "manage")}>
          <Icon d={icons.gear} size={16} color="#fff" />
          {reviewCount > 0 && <span className="oh-inv-mgmt-gear-badge">{reviewCount}</span>}
        </button>
      </div>
      {/* Account dropdown */}
      {accountOpen && (
        <div className="oh-inv-mgmt-account-dropdown">
          {accounts.map((a) => (
            <button
              key={a.label}
              className={`oh-inv-mgmt-account-option${a.label === account ? " active" : ""}`}
              onClick={() => switchAccount(a.label)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // ── Manage Mode (placeholder — built in Weeks 3-4) ──
  const ManageScreen = () => (
    <div className="oh-inv-mgmt-manage">
      <div className="oh-inv-mgmt-manage-grid">
        {[
          { key: "health", label: "Catalog Health", desc: "Unmatched items & duplicates", badge: reviewCount },
          { key: "history", label: "Count History", desc: "Past counts & drill-down", badge: 0 },
          { key: "catalog", label: "Item Catalog", desc: `${stats.totalItems} items`, badge: 0 },
          { key: "print", label: "Print Count Sheets", desc: "PDF & Excel with QR codes", badge: 0 },
          { key: "locations", label: "Storage Locations", desc: `${locations.length} locations set up`, badge: 0 },
          { key: "prices", label: "Price Dashboard", desc: "Trends & vendor comparison", badge: 0 },
        ].map((item) => (
          <button
            key={item.key}
            className="oh-inv-mgmt-manage-card"
            onClick={() => showToast(`${item.label} — coming in Weeks 3-4`, "info")}
          >
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

  // ── Landing Screen ──
  const LandingScreen = () => (
    <div className="oh-inv-mgmt-landing">
      {/* ── CTA ── */}
      <div className="oh-inv-mgmt-cta-card">
        {submitted ? (
          <>
            <div className="oh-inv-mgmt-cta-icon oh-inv-mgmt-cta-icon--success">
              <Icon d={icons.check} size={28} color="#16A34A" sw={3} />
            </div>
            <h2 className="oh-inv-mgmt-cta-title">{cp?.period || "P?"} Submitted</h2>
            <p className="oh-inv-mgmt-cta-sub">
              {lastCount?.submittedBy ? `by ${lastCount.submittedBy}` : ""} 
              {lastCount?.submittedAt ? ` · ${dateFull(lastCount.submittedAt)}` : ""}
            </p>
            {lastCount && (
              <div className="oh-inv-mgmt-cta-totals">
                {["Food", "Packaging", "Supplies", "Snacks", "Beverages"].map((cat) => {
                  const key = `total${cat}`;
                  const val = lastCount[key] || 0;
                  if (val === 0) return null;
                  return (
                    <div key={cat} className="oh-inv-mgmt-cta-total-row">
                      <span>{cat}</span>
                      <span>{fmt(val)}</span>
                    </div>
                  );
                })}
                <div className="oh-inv-mgmt-cta-total-row oh-inv-mgmt-cta-total-row--grand">
                  <span>Total</span>
                  <span>{fmt(lastCount.grandTotal)}</span>
                </div>
              </div>
            )}
          </>
        ) : draft ? (
          <>
            <div className="oh-inv-mgmt-cta-icon">
              <Icon d={icons.play} size={28} color="#d97706" sw={2.5} />
            </div>
            <h2 className="oh-inv-mgmt-cta-title">Resume Count</h2>
            <p className="oh-inv-mgmt-cta-sub">
              {cp?.period || "P?"} draft started {dateShort(draft.startedAt)}
            </p>
            <button
              className="oh-inv-mgmt-cta-btn"
              onClick={() => showToast("Count flow — coming in Week 2", "info")}
            >
              Resume Count
            </button>
          </>
        ) : (
          <>
            <div className="oh-inv-mgmt-cta-icon">
              <Icon d={icons.clipboard} size={28} color="#d97706" sw={2} />
            </div>
            <h2 className="oh-inv-mgmt-cta-title">Start Inventory Count</h2>
            <p className="oh-inv-mgmt-cta-sub">Count your inventory for this period</p>
            <button
              className="oh-inv-mgmt-cta-btn"
              onClick={() => showToast("Count flow — coming in Week 2", "info")}
            >
              Start Count
            </button>
          </>
        )}
      </div>

      {/* ── Completeness Warning ── */}
      {reviewCount > 0 && (
        <div className="oh-inv-mgmt-warning">
          <Icon d={icons.alert} size={16} color="#d97706" />
          <span>
            {reviewCount} item{reviewCount !== 1 ? "s" : ""} from recent invoices 
            {reviewCount !== 1 ? " aren't" : " isn't"} on your count sheet yet — 
            <button className="oh-inv-mgmt-link" onClick={() => setScreen("manage")}>review in Manage</button>
          </span>
        </div>
      )}

      {/* ── Stats Cards ── */}
      <div className="oh-inv-mgmt-stats">
        <div className="oh-inv-mgmt-stat-card">
          <span className="oh-inv-mgmt-stat-label">Current Period</span>
          <span className="oh-inv-mgmt-stat-value">{cp?.period || "–"}</span>
          <span className="oh-inv-mgmt-stat-sub">
            {cp?.start && cp?.end ? `${dateShort(cp.start)} — ${dateShort(cp.end)}` : "–"}
          </span>
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
          <span className="oh-inv-mgmt-stat-sub">
            {locations.length} location{locations.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* ── Price Movement ── */}
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
                    <Icon
                      d={m.direction === "up" ? icons.trendUp : icons.trendDown}
                      size={14}
                      color={m.direction === "up" ? "#d97706" : "#16A34A"}
                    />
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

      {/* ── Empty State (no catalog items yet) ── */}
      {stats.totalItems === 0 && !loading && (
        <div className="oh-inv-mgmt-empty">
          <Icon d={icons.box} size={40} color="#e2e8f0" sw={1.5} />
          <p className="oh-inv-mgmt-empty-title">No catalog items yet</p>
          <p className="oh-inv-mgmt-empty-desc">
            Items will appear automatically as invoices are processed through Invoice Capture. 
            The nightly AI job matches invoice line items to build your count sheet.
          </p>
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
        <div className="oh-inv-mgmt-placeholder">
          <p>Count Flow — Week 2 build</p>
          <button className="oh-inv-mgmt-cta-btn" onClick={() => setScreen("landing")}>Back to Landing</button>
        </div>
      )}
      {screen === "review" && (
        <div className="oh-inv-mgmt-placeholder">
          <p>Count Review — Week 2 build</p>
          <button className="oh-inv-mgmt-cta-btn" onClick={() => setScreen("landing")}>Back to Landing</button>
        </div>
      )}
      {screen === "success" && (
        <div className="oh-inv-mgmt-placeholder">
          <p>Submission Success — Week 2 build</p>
          <button className="oh-inv-mgmt-cta-btn" onClick={() => setScreen("landing")}>Done</button>
        </div>
      )}
    </div>
  );
}
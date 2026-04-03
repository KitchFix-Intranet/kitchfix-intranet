"use client";
import Link from "next/link";
import F from "@/app/ops/components/shared/F";
import {
  ClipboardIcon,
  UsersIcon,
  InvoiceIcon,
  DollarIcon,
  ChecklistIcon,
  ArrowRight,
} from "@/app/ops/components/shared/Icons";

const INV_MANAGER_DEV_USERS = ["k.fietek@kitchfix.com"];

// Box icon (Lucide) for Smart Inventory
const BoxIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <path d="M3.27 6.96L12 12.01l8.73-5.05" />
    <path d="M12 22.08V12" />
  </svg>
);

export default function OpsHome({ config, onNavigate, userEmail = "" }) {
  const isInvManagerEnabled = INV_MANAGER_DEV_USERS.includes(userEmail);
  const cp     = config?.currentPeriod;
  const ap     = cp?.name || "P1";
  const days   = F.daysUntil(cp?.due);
  const log    = config?.inventoryLog || [];
  const accts  = config?.accounts     || [];
  const done   = accts.filter(
    (a) => log.some((e) => e.account === a.label && e.period === ap)
  ).length;

  return (
    <div className="oh-view" style={{ animation: "oh-slideUp 0.4s ease" }}>
      <div className="oh-grid oh-grid--dashboard">

        {/* ── Smart Inventory Card (Dev-Gated) ── */}
        {isInvManagerEnabled && (
          <div
            className="oh-card oh-card--interactive"
            onClick={() => onNavigate("inv-manager")}
            style={{ borderLeft: "3px solid #d97706" }}
          >
            <div className="oh-card-header-row">
              <div className="oh-icon-box oh-icon-mustard"><BoxIcon /></div>
            </div>
            <h3 className="oh-card-title">Smart Inventory</h3>
            <p className="oh-card-desc">AI-powered count sheets from invoices.</p>
            <div className="oh-action-chips">
              <div
                className="oh-chip oh-chip-mustard"
                style={{ flex: 1, textAlign: "center" }}
              >
                {days !== null && days <= 7 ? "⚡" : "📦"} {days !== null ? F.daysLabel(days) : "DEV MODE"}
              </div>
            </div>
            <button
              className="oh-card-cta oh-card-cta--primary"
              onClick={(e) => { e.stopPropagation(); onNavigate("inv-manager"); }}
            >
              <span>Launch Tool</span>
              <ArrowRight />
            </button>
          </div>
        )}

        {/* ── Inventory Card ── */}
        <div
          className="oh-card oh-card--interactive"
          onClick={() => onNavigate("inventory")}
        >
          <div className="oh-card-header-row">
            <div className="oh-icon-box oh-icon-mustard"><ClipboardIcon /></div>
          </div>
          <h3 className="oh-card-title">Inventory</h3>
          <p className="oh-card-desc">Monthly inventory counts by location.</p>
          <div className="oh-action-chips">
            {days !== null && (
              <div
                className={`oh-chip ${
                  F.daysUrgency(days) === "safe" ? "oh-chip-mustard" : "oh-chip-danger"
                }`}
                style={{ flex: 1, textAlign: "center" }}
              >
                {days < 0 ? "⚠️" : "📋"} {F.daysLabel(days)}
              </div>
            )}
          </div>
          <button
            className="oh-card-cta oh-card-cta--primary"
            onClick={(e) => { e.stopPropagation(); onNavigate("inventory"); }}
          >
            <span>Launch Tool</span>
            <ArrowRight />
          </button>
        </div>

        {/* ── Season Tracker Card → LaborTool (Season Planner) ── */}
        <div
          className="oh-card oh-card--interactive"
          onClick={() => onNavigate("labor")}
        >
          <div className="oh-card-header-row">
            <div className="oh-icon-box oh-icon-mustard">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2"  x2="16" y2="6"  />
                <line x1="8"  y1="2"  x2="8"  y2="6"  />
                <line x1="3"  y1="10" x2="21" y2="10" />
                <line x1="8"  y1="14" x2="8"  y2="14" />
                <line x1="12" y1="14" x2="12" y2="14" />
                <line x1="16" y1="14" x2="16" y2="14" />
              </svg>
            </div>
          </div>
          <h3 className="oh-card-title">Season Tracker</h3>
          <p className="oh-card-desc">MLB homestand schedule &amp; staffing plans.</p>
          <div className="oh-action-chips">
            <div className="oh-chip oh-chip-mustard" style={{ width: "100%", textAlign: "center" }}>
              ⚾ Homestand Planner
            </div>
          </div>
          <button
            className="oh-card-cta oh-card-cta--primary"
            onClick={(e) => { e.stopPropagation(); onNavigate("labor"); }}
          >
            <span>View Schedule</span>
            <ArrowRight />
          </button>
        </div>

        {/* ── Invoice Capture Card ── */}
        <div
          className="oh-card oh-card--interactive"
          onClick={() => onNavigate("invoices")}
        >
          <div className="oh-card-header-row">
            <div className="oh-icon-box oh-icon-mustard"><InvoiceIcon /></div>
          </div>
          <h3 className="oh-card-title">Invoice Capture</h3>
          <p className="oh-card-desc">Scan, code &amp; submit invoices to AP.</p>
          <div className="oh-action-chips">
            <div className="oh-chip oh-chip-mustard" style={{ width: "100%", textAlign: "center" }}>
              📸 Snap &amp; Submit
            </div>
          </div>
          <button
            className="oh-card-cta oh-card-cta--primary"
            onClick={(e) => { e.stopPropagation(); onNavigate("invoices"); }}
          >
            <span>Launch Tool</span>
            <ArrowRight />
          </button>
        </div>

        {/* ── Vendor Portal Card ── */}
        <div
          className="oh-card oh-card--interactive"
          onClick={() => onNavigate("vendors")}
        >
          <div className="oh-card-header-row">
            <div className="oh-icon-box oh-icon-mustard">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
          </div>
          <h3 className="oh-card-title">Vendors</h3>
          <p className="oh-card-desc">Manage suppliers, reps &amp; portals.</p>
          <div className="oh-action-chips">
            <div className="oh-chip oh-chip-mustard" style={{ width: "100%", textAlign: "center" }}>
              🏪 Vendor Directory
            </div>
          </div>
<button
            className="oh-card-cta oh-card-cta--primary"
            onClick={(e) => { e.stopPropagation(); onNavigate("vendors"); }}
          >
            <span>Open Directory</span>
            <ArrowRight />
          </button>
        </div>

        {/* ── Service Calendar Card ── */}
        <Link href="/service-calendar" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="oh-card oh-card--interactive" style={{ height: "100%" }}>
            <div className="oh-card-header-row">
              <div className="oh-icon-box oh-icon-mustard">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20V10" />
                  <path d="M18 20V4" />
                  <path d="M6 20v-4" />
                </svg>
              </div>
            </div>
            <h3 className="oh-card-title">Service Calendar</h3>
            <p className="oh-card-desc">Track meal projections &amp; enter daily actuals.</p>
            <div className="oh-action-chips">
              <div className="oh-chip oh-chip-mustard" style={{ width: "100%", textAlign: "center" }}>
                🍽️ Covers &amp; Revenue
              </div>
            </div>
            <div className="oh-card-cta oh-card-cta--primary">
              <span>Open Calendar</span>
              <ArrowRight />
            </div>
          </div>
        </Link>

        {/* ── Current Period Info Card ── */}
        
        <div className="oh-card">
          <div className="oh-card-header-row">
            <div className="oh-icon-box oh-icon-navy">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8"  y1="2" x2="8"  y2="6" />
                <line x1="3"  y1="10" x2="21" y2="10" />
              </svg>
            </div>
          </div>
          <h3 className="oh-card-title">Current Period</h3>
          <p className="oh-card-desc">{ap} cycle details.</p>
          <div className="oh-period-details">
            {cp?.start && (
              <div className="oh-period-row">
                <span className="oh-period-label">Range</span>
                <span className="oh-period-val">
                  {F.dateShort(cp.start)} — {F.dateShort(cp.end)}
                </span>
              </div>
            )}
            {cp?.due && (
              <div className="oh-period-row">
                <span className="oh-period-label">Due</span>
                <span className="oh-period-val">{F.date(cp.due)}</span>
              </div>
            )}
            <div className="oh-period-row">
              <span className="oh-period-label">Status</span>
              <span className={`oh-urgency-badge oh-urgency-${F.daysUrgency(days)}`}>
                {F.daysLabel(days)}
              </span>
            </div>
          </div>
        </div>

        {/* ── Locked Q3 Cards ── */}
        {[
          { title: "Budget Tracker", desc: "Declining balances.",    icon: <DollarIcon />    },
          { title: "Pre-Service",    desc: "Checklists & 86 lists.", icon: <ChecklistIcon /> },
        ].map((c) => (
          <div key={c.title} className="oh-card oh-card--locked oh-card--locked-compact">
            <div className="oh-locked-row">
              <div className="oh-icon-box-sm oh-icon-grey">{c.icon}</div>
              <div className="oh-locked-text">
                <h3 className="oh-card-title" style={{ margin: 0, fontSize: 15 }}>{c.title}</h3>
                <p className="oh-card-desc"   style={{ margin: 0, fontSize: 12 }}>{c.desc}</p>
              </div>
              <span className="oh-badge-coming">Q3</span>
            </div>
          </div>
        ))}

      </div>
    </div>
  );
}
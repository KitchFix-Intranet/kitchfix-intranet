"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import OpsNav from "@/app/ops/components/OpsNav";
import OpsHome from "@/app/ops/components/OpsHome";
import InventoryTool from "@/app/ops/components/inventory/InventoryTool";
import InventoryManager from "@/app/ops/components/inventory-manager/InventoryManager";
import LaborTool from "@/app/ops/components/labor/LaborTool";
import InvoiceTool from "@/app/ops/components/invoice/InvoiceTool";
import VendorPortal from "@/app/ops/components/vendors/VendorPortal";
import './css/ops-shared.css';
import './css/ops-inventory.css';
import './css/ops-inv-mgmt.css';
import './css/ops-labor.css';
import './css/ops-invoice.css';
import './css/ops-vendor.css';
// import './css/ops-executive.css';  // PARKED
// 
// ops-executive.css — parked, will move to /executive page

// ── Inventory Manager Dev Gate ──
const INV_MANAGER_DEV_USERS = ["k.fietek@kitchfix.com"];

export default function OpsHub() {
  const { data: session, status } = useSession();
  const [view, setView] = useState("home");
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const userEmail = session?.user?.email || "";
  const isInvManagerEnabled = INV_MANAGER_DEV_USERS.includes(userEmail);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const openConfirm = useCallback((title, message, confirmLabel, onConfirm) => {
    setConfirm({ title, message, confirmLabel, onConfirm });
  }, []);

  const refreshConfig = useCallback(() => {
    fetch("/api/ops?action=bootstrap")
      .then((r) => r.json())
      .then((d) => { if (d.success) setConfig(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    setLoading(true);
    fetch("/api/ops?action=bootstrap")
      .then((r) => r.json())
      .then((d) => { if (d.success) setConfig(d); else showToast("Failed to load config", "error"); })
      .catch(() => showToast("Network error", "error"))
      .finally(() => setLoading(false));
  }, [status, showToast]);

  if (status === "loading" || loading) {
    return (
      <div className="oh-app">
        <div className="oh-bound" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
          <div className="oh-spinner" />
          <p style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600 }}>Loading Ops Hub...</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="oh-app">
        <div className="oh-bound" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
          <p style={{ color: "#64748b", fontSize: 14, fontWeight: 600 }}>Please sign in to access Ops Hub.</p>
        </div>
      </div>
    );
  }

  const firstName = session?.user?.name?.split(" ")[0] || "Chef";

  return (
    <div className="oh-app">
      <div className="oh-bound">
        <div className="oh-hero" style={config?.heroImage ? { backgroundImage: `url(${config.heroImage})` } : {}}>
          <div className="oh-hero-overlay" />
          <div className="oh-hero-content">
            <h1 className="oh-hero-title">Ops Hub</h1>
            <p className="oh-hero-subtitle">Welcome back, {firstName}.</p>
          </div>
        </div>
      </div>

      <div className="oh-bound">
        <OpsNav view={view} onNavigate={setView} userEmail={userEmail} />
      </div>

      <div className="oh-bound">
        {view === "home" && <OpsHome config={config} onNavigate={setView} userEmail={userEmail} />}
        {view === "inventory" && (
          <InventoryTool config={config} showToast={showToast} openConfirm={openConfirm} onNavigate={setView} refreshConfig={refreshConfig} />
        )}
        {view === "inv-manager" && isInvManagerEnabled && (
          <InventoryManager config={config} showToast={showToast} openConfirm={openConfirm} onNavigate={setView} />
        )}
        {view === "labor" && (
          <LaborTool config={config} showToast={showToast} openConfirm={openConfirm} onNavigate={setView} />
        )}
        {view === "invoices" && (
          <InvoiceTool config={config} showToast={showToast} openConfirm={openConfirm} onNavigate={setView} />
        )}
        {view === "vendors" && (
          <VendorPortal config={config} showToast={showToast} openConfirm={openConfirm} onNavigate={setView} />
        )}
      </div>

{confirm && (
        <div className="oh-modal-overlay" onClick={() => setConfirm(null)}>
          <div className="oh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="oh-modal-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="9 12 12 15 16 10" />
              </svg>
            </div>
            <h3 className="oh-modal-title">{confirm.title}</h3>
            <p className="oh-modal-subtitle">{confirm.message}</p>
            <div className="oh-modal-actions">
              <button className="oh-modal-cancel" onClick={() => setConfirm(null)}>Cancel</button>
              <button className="oh-modal-confirm" onClick={() => { confirm.onConfirm(); setConfirm(null); }}>
                {confirm.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
            
      {toast && (
        <div className="oh-toast-container">
          <div className={`oh-toast oh-toast--${toast.type}`}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
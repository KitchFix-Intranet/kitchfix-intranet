"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import FinancialTool from "./FinancialTool";
import "@/app/ops/ops.css"; // re-uses the full oh-* design system

export default function FinancialPage() {
  const [heroImage, setHeroImage] = useState("");
  const [userName, setUserName]   = useState("");
  const [toast, setToast]         = useState(null);
  const [confirm, setConfirm]     = useState(null);

  /* ── Bootstrap hero + user name ── */
  useEffect(() => {
    const email = typeof window !== "undefined"
      ? localStorage.getItem("kf_user_email") || ""
      : "";
    if (!email) return;
    fetch(`/api/people?action=bootstrap&email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setUserName(d.firstName || email.split("@")[0]);
          setHeroImage(d.heroImage || "");
        }
      })
      .catch(() => {});
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const openConfirm = (opts) => setConfirm(opts);

  return (
    <div className="oh-app">
      <div className="oh-bound">

        {/* ── Hero ── */}
        <div
          className="oh-hero"
          style={heroImage ? { backgroundImage: `url(${heroImage})` } : {}}
        >
          <div className="oh-hero-overlay" />
          <div className="oh-hero-content">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {/* Bar chart icon */}
              <svg
                width="22" height="22" viewBox="0 0 24 24"
                fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="2.5"
                strokeLinecap="round" style={{ flexShrink: 0 }}
              >
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4"  />
                <line x1="6"  y1="20" x2="6"  y2="14" />
              </svg>
              <h1 className="oh-hero-title">KPI Dashboard</h1>
            </div>
            <p className="oh-hero-subtitle">
              {userName ? `Welcome back, ${userName}.` : "Cost tracking & performance."}
            </p>
          </div>

          {/* Back link — top-right inside hero */}
          <Link
            href="/ops"
            style={{
              position: "absolute", top: 16, right: 20,
              color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 5,
              textDecoration: "none", zIndex: 3,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
            </svg>
            Ops Hub
          </Link>
        </div>

        {/* ── KPI Tool (tabs: Dashboard | Snapshot | Portfolio) ── */}
        <FinancialTool showToast={showToast} openConfirm={openConfirm} />

      </div>

      {/* ── Toast ── */}
      {toast && (
        <div className={`oh-toast oh-toast--${toast.type}`}>{toast.msg}</div>
      )}

      {/* ── Confirm Modal ── */}
      {confirm && (
        <div
          className="oh-modal-overlay"
          onClick={() => setConfirm(null)}
        >
          <div className="oh-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
              {confirm.title || "Are you sure?"}
            </h3>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#64748b" }}>
              {confirm.message}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                className="oh-btn oh-btn--ghost"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="oh-btn oh-btn--danger"
                onClick={() => { confirm.onConfirm?.(); setConfirm(null); }}
              >
                {confirm.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
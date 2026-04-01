"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import ServiceCalendar from "./ServiceCalendar";
import "@/app/ops/css/ops-shared.css";
import "./ops-sc.css";

// ── Dev Gate: only these emails see the live tool ──
const DEV_EMAILS = ["k.fietek@kitchfix.com", "joe@kitchfix.com"];
export default function ServiceCalendarPage() {
  const { data: session, status } = useSession();
  const [heroImage, setHeroImage] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/service-calendar?action=sc-hero")
      .then((r) => r.json())
      .then((d) => { if (d.heroImage) setHeroImage(d.heroImage); })
      .catch(() => {});
  }, [status]);

  if (status === "loading") {
    return (
      <div className="oh-app">
        <div className="oh-bound" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
          <div className="oh-spinner" />
          <p style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600 }}>Loading Service Calendar...</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className="oh-app">
        <div className="oh-bound" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
          <p style={{ color: "#64748b", fontSize: 14, fontWeight: 600 }}>Please sign in to access the Service Calendar.</p>
        </div>
      </div>
    );
  }

  const email = session?.user?.email?.toLowerCase().trim() || "";
  const firstName = session?.user?.name?.split(" ")[0] || "Chef";
  const isDev = DEV_EMAILS.includes(email);

  if (!isDev) {
    return (
      <div className="oh-app">
        <div className="oh-bound">
          <div className="oh-hero" style={heroImage ? { backgroundImage: `url(${heroImage})` } : {}}>
            <div className="oh-hero-overlay" />
            <div className="oh-hero-content">
              <h1 className="oh-hero-title">Service Calendar</h1>
              <p className="oh-hero-subtitle">Welcome, {firstName}.</p>
            </div>
          </div>
        </div>
        <div className="oh-bound">
          <div className="oh-sc-coming-soon">
            <div className="oh-sc-coming-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <path d="M8 14h.01" /><path d="M12 14h.01" /><path d="M16 14h.01" />
                <path d="M8 18h.01" /><path d="M12 18h.01" />
              </svg>
            </div>
            <h2 className="oh-sc-coming-title">Coming Soon</h2>
            <p className="oh-sc-coming-desc">The Service Calendar is currently under development. This tool will allow you to track daily meal projections, enter actual headcounts, and monitor revenue across all accounts.</p>
            <div className="oh-sc-coming-chips">
              <span className="oh-sc-coming-chip">Meal Projections</span>
              <span className="oh-sc-coming-chip">Daily Actuals</span>
              <span className="oh-sc-coming-chip">Revenue Tracking</span>
              <span className="oh-sc-coming-chip">All 12 Accounts</span>
            </div>
            <p className="oh-sc-coming-footer">Check back soon — we&apos;re building something great.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="oh-app">
      <div className="oh-bound">
        <div className="oh-hero" style={heroImage ? { backgroundImage: `url(${heroImage})` } : {}}>
          <div className="oh-hero-overlay" />
          <div className="oh-hero-content">
            <h1 className="oh-hero-title">Service Calendar</h1>
            <p className="oh-hero-subtitle">Welcome back, {firstName}. Track meal projections and actuals.</p>
          </div>
        </div>
      </div>
      <div className="oh-bound">
        <ServiceCalendar showToast={showToast} session={session} />
      </div>
      {toast && (
        <div className="oh-toast-container">
          <div className={`oh-toast oh-toast--${toast.type}`}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
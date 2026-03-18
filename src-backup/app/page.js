"use client";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect } from "react";

// Components
import PeopleWidget from "@/components/PeopleWidget";
import OpsWidget from "@/components/OpsWidget";
import KudosWidget from "@/components/KudosWidget";
import WasteWidget from "@/components/WasteWidget";
import TeamWidget from "@/components/TeamWidget";
import NewsFeed from "@/components/NewsFeed";
import KudosSpotlight from "@/components/KudosSpotlight";
import DailyPulse from "@/components/DailyPulse";
import CelebrationBar from "@/components/CelebrationBar";
import ToolsGrid from "@/components/ToolsGrid";
import WeatherBadge from "@/components/WeatherBadge";
import HelpFAB from "@/components/shared/HelpFAB";
import ProfileModal from "@/components/ProfileModal";

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [offline, setOffline] = useState(false);

  // Offline detection
  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setData(d);
        setLoading(false);
      })
      .catch((e) => {
        console.error("Dashboard load error:", e);
        setLoading(false);
      });
  }, [status]);

  if (status === "loading") return <LoadingScreen />;
  if (status === "unauthenticated") {
    return (
      <div className="min-h-screen bg-kf-bg flex items-center justify-center">
        <a href="/login" className="text-kf-blue font-semibold">Sign in to continue →</a>
      </div>
    );
  }

  // Greeting logic (matching Apps Script exactly)
  const hr = new Date().getHours();
  let greeting = "Late Night Prep";
  let timeOfDay = "night";
  if (hr >= 5 && hr < 11) { greeting = "Good Morning"; timeOfDay = "morning"; }
  else if (hr >= 11 && hr < 14) { greeting = "Lunch Rush!"; timeOfDay = "midday"; }
  else if (hr >= 14 && hr < 17) { greeting = "Good Afternoon"; timeOfDay = "afternoon"; }
  else if (hr >= 17 && hr < 22) { greeting = "Good Evening"; timeOfDay = "evening"; }

  const firstName = data?.user?.firstName || session?.user?.name?.split(" ")[0] || "Chef";
  const fullName = data?.user?.name || session?.user?.name || "Chef";
  const initials = data?.user?.initials || "KF";
  const role = data?.user?.role || "Team Member";
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="kf-desktop-wrapper">
      <div className="kf-main-column">

        {/* ═══════════════════════════════════
            OFFLINE BANNER
        ═══════════════════════════════════ */}
        {offline && (
          <div className="kf-offline-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Connection lost — data may be outdated
          </div>
        )}

        {/* ═══════════════════════════════════
            HERO BANNER
        ═══════════════════════════════════ */}
        <div className="kf-hero-container">
          <div
            className="kf-hero-bg"
            style={data?.heroImage ? { backgroundImage: `url('${data.heroImage}')` } : {}}
          />
          <div className={`kf-hero-overlay kf-tint-${timeOfDay}`} />
          <div className="kf-hero-content">
            <div className="kf-hero-top" />
            <div className="kf-hero-bottom">
              <div className="kf-hero-bottom-row">
                <div className="kf-hero-left">
                  <h1 className="kf-greeting-title">
                    {greeting}, {firstName}.
                  </h1>
                  <div className="kf-meta-row">
                    <span className="kf-meta-item">{dateStr}</span>
                    <span className="kf-meta-divider">•</span>
                    <WeatherBadge />
                  </div>
                </div>
                <button
                  className="kf-profile-pill"
                  onClick={() => setProfileOpen(true)}
                >
                  <div className="kf-pill-text">
                    <span className="kf-pill-name">{fullName}</span>
                    <span className="kf-pill-role">{role}</span>
                  </div>
                  <div className="kf-pill-avatar">
                    <span>{initials}</span>
                    <div className="kf-status-dot" />
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════
            BODY CARD
        ═══════════════════════════════════ */}
        <div className="kf-body-card">

          {/* SMART DOCK — 5 Widget Cards */}
          <div className="kf-smart-dock">
            <PeopleWidget metrics={data?.user?.peopleMetrics} />
            <OpsWidget ops={data?.ops} />
            <KudosWidget kudos={data?.kudos} />
            <WasteWidget waste={data?.wasteMetrics} />
            <TeamWidget mod={data?.mod} />
          </div>

          {/* DASHBOARD GRID — Two Columns */}
          <div className="kf-dashboard-grid">

            {/* LEFT COLUMN: News + Sub-grid */}
            <div className="kf-news-column">
              <NewsFeed news={data?.news} />

              {/* Sub-grid: Daily Pulse + Featured Culinary */}
              <div className="kf-sub-grid">
                <DailyPulse />
                <div className="kf-widget-card" style={{ opacity: 0.8 }}>
                  <div className="kf-card-header">
                    <div className="kf-card-title">
                      <svg className="kf-card-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      <span>Featured Culinary</span>
                    </div>
                  </div>
                  <div className="kf-featured-placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginBottom: "8px", opacity: 0.5 }}>
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                    </svg>
                    <span className="kf-placeholder-text">Coming in Q3</span>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Celebrations, Spotlight, Tools */}
            <div className="kf-metrics-column">
              <CelebrationBar
                celebrations={data?.celebrations}
                standard={data?.standard}
              />
              <KudosSpotlight />
              <ToolsGrid />

              {/* Sign Out */}
              <button
                className="kf-signout-btn"
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* FAB + Modal */}
      <HelpFAB />
      <ProfileModal
        user={data?.user}
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
      />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-kf-bg flex items-center justify-center">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-kf-navy rounded-2xl mb-4">
          <span className="text-white font-bold text-lg">KF</span>
        </div>
        <p className="text-gray-400 text-sm font-mulish">Loading Command Center...</p>
      </div>
    </div>
  );
}
"use client";
import { useSession } from "next-auth/react";
import { useState, useEffect } from "react";
import Link from "next/link";
import WeatherBadge from "@/components/WeatherBadge";
import CelebrationBar from "@/components/home/CelebrationBar";
import NewsFeed from "@/components/home/NewsFeed";
import ToolsGrid from "@/components/home/ToolsGrid";

/* ═══════════════════════════════════════════════════════════
   KITCHFIX HOME DASHBOARD — v1 Launchpad
   Layout: Hero → Launchpad Cards → Celebrations → News + Tools
   ═══════════════════════════════════════════════════════════ */

export default function Dashboard() {
  const { data: session, status } = useSession();
  const [data, setData] = useState(null);
  const [chips, setChips] = useState(null);
  const [offline, setOffline] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  /* ── Offline detection ── */
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);

  /* ── Dashboard API fetch (non-blocking) ── */
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setData(d);
          setChips({
            peopleAction: d.user?.peopleMetrics?.rejected || 0,
            peoplePending: d.user?.peopleMetrics?.pending || 0,
            peopleDone: d.user?.peopleMetrics?.completedTotal || 0,
            opsCountdown: d.ops?.daysUntilInv ?? null,
            opsPeriod: d.ops?.label && d.ops?.week ? `${d.ops.label} • WK ${d.ops.week}` : d.ops?.label || null,
          });
        }
      })
      .catch(() => {});
  }, [status]);

  /* ── Silent refresh — every 4 minutes ── */
  useEffect(() => {
    if (status !== "authenticated") return;

    const INTERVAL = 4 * 60 * 1000;

    const silentRefresh = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/dashboard");
        if (!res.ok) return;
        const d = await res.json();
        if (!d.success) return;

        setData(d);
        setChips({
          peopleAction: d.user?.peopleMetrics?.rejected || 0,
          peoplePending: d.user?.peopleMetrics?.pending || 0,
          peopleDone: d.user?.peopleMetrics?.completedTotal || 0,
          opsCountdown: d.ops?.daysUntilInv ?? null,
          opsPeriod: d.ops?.label && d.ops?.week ? `${d.ops.label} • WK ${d.ops.week}` : d.ops?.label || null,
        });
        setRefreshKey((k) => k + 1);
      } catch (err) {
        // Fail silently
      }
    };

    const interval = setInterval(silentRefresh, INTERVAL);

    const handleVisibility = () => {
      if (!document.hidden) silentRefresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status]);

  /* ── Cap news feed to right column height ── */
  useEffect(() => {
    const sync = () => {
      const grid = document.querySelector('.kf-home-bottom-grid');
      const right = document.querySelector('.kf-home-bottom-right');
      if (grid && right) {
        grid.style.setProperty('--kf-right-col-h', right.offsetHeight + 'px');
      }
    };
    const timer = setTimeout(sync, 100);
    window.addEventListener('resize', sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', sync);
    };
  }, [data]);

  /* ── Auth gates ── */
  if (status === "loading" || (status === "authenticated" && !data)) return <LoadingScreen />;
  if (status === "unauthenticated") {
    return (
      <div className="kf-desktop-wrapper kf-auth-gate">
        <a href="/login" className="kf-auth-link">Sign in to continue →</a>
      </div>
    );
  }

  /* ── Greeting logic ── */
  const hr = new Date().getHours();
  let greeting = "Late Night Prep";
  let timeOfDay = "night";
  if (hr >= 5 && hr < 11) { greeting = "Good Morning"; timeOfDay = "morning"; }
  else if (hr >= 11 && hr < 14) { greeting = "Lunch Rush!"; timeOfDay = "midday"; }
  else if (hr >= 14 && hr < 17) { greeting = "Good Afternoon"; timeOfDay = "afternoon"; }
  else if (hr >= 17 && hr < 22) { greeting = "Good Evening"; timeOfDay = "evening"; }

  const firstName = session?.user?.name?.split(" ")[0] || "Chef";
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });

  /* ── Build chip arrays ── */
  const directoryChips = [
    { label: "11 Accounts", color: "#2563eb", bg: "#eff6ff" },
  ];

  const opsChips = [];
  if (chips?.opsPeriod)
    opsChips.push({ label: chips.opsPeriod, color: "#92400e", bg: "#fffbeb" });
  if (chips?.opsCountdown != null)
    opsChips.push({
      label: `${chips.opsCountdown}d to Inventory`,
      color: chips.opsCountdown <= 5 ? "#dc2626" : "#92400e",
      bg: chips.opsCountdown <= 5 ? "#fef2f2" : "#fffbeb",
    });

  const peopleChips = [];
  if (chips?.peopleAction > 0)
    peopleChips.push({ label: `${chips.peopleAction} Needs Action`, color: "#dc2626", bg: "#fef2f2" });
  if (chips?.peoplePending > 0)
    peopleChips.push({ label: `${chips.peoplePending} Processing`, color: "#6366f1", bg: "#eef2ff" });

  /* ── Card definitions ── */
  const cards = [
    {
      key: "directory",
      title: "Team Directory",
      desc: "Browse accounts, access SLAs, WiFi info, and service calendars.",
      href: "/directory",
      accent: "#2563eb",
      iconBg: "rgba(37, 99, 235, 0.1)",
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
      chips: directoryChips,
      cta: "Open Directory",
    },
    {
      key: "ops",
      title: "Ops Hub",
      desc: "Inventory, invoices, vendors, and season planning tools.",
      href: "/ops",
      accent: "#d97706",
      iconBg: "rgba(217, 119, 6, 0.1)",
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>
      ),
      chips: opsChips,
      cta: "Launch Ops Hub",
    },
    {
      key: "people",
      title: "People Portal",
      desc: "New hires, personnel actions, and HR request tracking.",
      href: "/people",
      accent: "#6366f1",
      iconBg: "rgba(99, 102, 241, 0.1)",
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      ),
      chips: peopleChips,
      cta: "Open People Portal",
    },
  ];

  return (
    <div className="kf-desktop-wrapper">
      <div className="kf-main-column">
        {/* Offline Banner */}
        {offline && (
          <div className="kf-offline-banner">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Connection lost — data may be outdated
          </div>
        )}

        {/* Hero Banner */}
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
                  <h1 className="kf-greeting-title">{greeting}, {firstName}.</h1>
                  <div className="kf-meta-row">
                    <span className="kf-meta-item">{dateStr}</span>
                    <span className="kf-meta-divider">•</span>
                    <WeatherBadge />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ Launchpad Cards ═══ */}
        <div className="kf-launch-grid">
          {cards.map((card) => (
            <Link key={card.key} href={card.href} className="kf-launch-card">
              <div className="kf-launch-icon" style={{ background: card.iconBg, color: card.accent }}>
                {card.icon}
              </div>
              <h3 className="kf-launch-title">{card.title}</h3>
              <p className="kf-launch-desc">{card.desc}</p>
              {card.chips.length > 0 && (
                <div className="kf-launch-chips">
                  {card.chips.map((c, i) => (
                    <span key={i} className="kf-launch-chip" style={{ color: c.color, background: c.bg }}>{c.label}</span>
                  ))}
                </div>
              )}
              <div className="kf-launch-cta" style={{ background: card.accent }}>
                <span>{card.cta}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
            </Link>
          ))}
        </div>

        {/* ═══ News + Celebrations/Tools Row ═══ */}
        <div className="kf-home-bottom-grid">
          <div className="kf-home-bottom-left">
            <NewsFeed session={session} refreshKey={refreshKey} />
          </div>
          <div className="kf-home-bottom-right">
            <CelebrationBar celebrations={data?.celebrations} standard={data?.standard} />
            <ToolsGrid />
          </div>
        </div>
      </div>

    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="kf-desktop-wrapper">
      <div className="kf-main-column">
        {/* Hero skeleton */}
        <div className="kf-hero-container" style={{ background: '#e2e8f0' }}>
          <div className="kf-hero-content">
            <div className="kf-hero-top" />
            <div className="kf-hero-bottom">
              <div className="skeleton" style={{ width: 260, height: 28, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: 180, height: 14 }} />
            </div>
          </div>
        </div>

        {/* Launchpad card skeletons */}
        <div className="kf-launch-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="kf-launch-card" style={{ pointerEvents: 'none' }}>
              <div className="skeleton" style={{ width: 48, height: 48, borderRadius: 14, marginBottom: 16 }} />
              <div className="skeleton" style={{ width: '60%', height: 18, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: '90%', height: 13, marginBottom: 6 }} />
              <div className="skeleton" style={{ width: '70%', height: 13, marginBottom: 20 }} />
              <div className="skeleton" style={{ width: '100%', height: 44, borderRadius: 10 }} />
            </div>
          ))}
        </div>

        {/* Bottom grid skeletons */}
        <div className="kf-home-bottom-grid">
          <div className="kf-home-bottom-left">
            <div className="kf-home-section" style={{ minHeight: 300 }}>
              <div className="kf-home-section-header">
                <div className="skeleton" style={{ width: 140, height: 12 }} />
              </div>
              <div style={{ padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[1, 2, 3].map((i) => (
                  <div key={i}>
                    <div className="skeleton" style={{ width: '40%', height: 10, marginBottom: 6 }} />
                    <div className="skeleton" style={{ width: '80%', height: 14, marginBottom: 4 }} />
                    <div className="skeleton" style={{ width: '100%', height: 12 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="kf-home-bottom-right">
            <div className="kf-home-section" style={{ minHeight: 80 }}>
              <div className="kf-home-section-header">
                <div className="skeleton" style={{ width: 160, height: 12 }} />
              </div>
              <div style={{ padding: '0 20px 16px', display: 'flex', gap: 10 }}>
                <div className="skeleton" style={{ width: 180, height: 50, borderRadius: 12 }} />
                <div className="skeleton" style={{ width: 180, height: 50, borderRadius: 12 }} />
              </div>
            </div>
            <div className="kf-home-section" style={{ minHeight: 200 }}>
              <div className="kf-home-section-header">
                <div className="skeleton" style={{ width: 120, height: 12 }} />
              </div>
              <div style={{ padding: '0 16px 16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="skeleton" style={{ aspectRatio: '1', borderRadius: 14 }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
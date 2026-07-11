"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { SC_ADMINS } from "@/lib/admin";
import ServiceCalendar from "./ServiceCalendar";
import SubmissionToast from "./season/SubmissionToast";
import "@/app/ops/css/ops-shared.css";
import "./ops-sc.css";
import "./dayDetail.css";
import "./submissionToast.css";

// Page-level gate. Currently identical to SC_ADMINS - only the two
// listed emails see the live tool; everyone else gets the Coming Soon
// screen. When the site-lead rollout expands access, swap this for a
// dedicated SC_DEV_EMAILS list in admin.js.
export default function ServiceCalendarPage() {
  const { data: session, status } = useSession();
  const [heroImage, setHeroImage] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msgOrObj, type = "success") => {
    // Accept a string (plain oh-toast) OR an object payload. The rich
    // "recorded" variant renders <SubmissionToast />; SC-068 aligns its
    // auto-dismiss with the plain oh-toast timing (3.5s) so a toast
    // never lingers past the operator's next intent.
    if (msgOrObj && typeof msgOrObj === "object") {
      setToast(msgOrObj);
      setTimeout(() => setToast(null), 3500);
    } else {
      setToast({ msg: String(msgOrObj || ""), type });
      setTimeout(() => setToast(null), 3500);
    }
  }, []);

  // SC-068: outside-click dismiss for the recorded toast. Attach a
  // document-level mousedown while a recorded toast is mounted; any
  // click whose target is NOT inside the toast card clears the toast.
  // No preventDefault / stopPropagation - the click still lands on
  // whatever was under it (opening a tile also dismisses; that's the
  // intended behavior). Cleanup on unmount + on toast change so we
  // never stack listeners. Non-recorded toasts skip this path (they
  // aren't the "sits over the grid for 4.5s and blocks flow" case).
  const toastCardRef = useRef(null);
  useEffect(() => {
    if (!toast || toast.variant !== "recorded") return;
    const handler = (e) => {
      if (toastCardRef.current && !toastCardRef.current.contains(e.target)) {
        setToast(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [toast]);

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
  const isDev = SC_ADMINS.includes(email);

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
            <p className="oh-sc-coming-footer">Check back soon - we&apos;re building something great.</p>
          </div>
        </div>
      </div>
    );
  }

  // Mobile Overhaul: hero is now the shared compact oh-hero rendered
  // ABOVE the SC content, matching how People Portal and Home work.
  // The Batch-2 HeroCollapse + scroll-listener is retired - at 84px
  // there's nothing to collapse. ChromeBar floats above the content
  // (not boxed inside an outer card) as its own row.
  //
  // Redesign PR 1A: the hero is now rendered by ServiceCalendar itself
  // so the in-hero admin lock button can wire directly to the existing
  // handleAdminToggle without state lifting. heroImage + firstName
  // pass through as props.
  return (
    <div className="oh-app">
      <div className="oh-bound">
        {/* Rendering ServiceCalendar directly (pre-#330 shape) - see
            layout.js segment config (`export const dynamic = "force-dynamic"`)
            for the cold-deep-load fix that landed with this change. */}
        <ServiceCalendar
          showToast={showToast}
          session={session}
          heroImage={heroImage}
          firstName={firstName}
          isDev={isDev}
        />
      </div>
      {toast && (
        <div className="oh-toast-container oh-toast-container--sc-center">
          {toast.variant === "recorded" ? (
            // SC-060: click-to-dismiss on the toast card. Auto-dismiss
            // aligned to 3.5s in SC-068 above. toastCardRef wraps the
            // toast so the outside-click mousedown listener above can
            // scope "outside" correctly.
            <div ref={toastCardRef}>
              <SubmissionToast {...toast} onDismiss={() => setToast(null)} />
            </div>
          ) : (
            <div className={`oh-toast oh-toast--${toast.type}`}>{toast.msg}</div>
          )}
        </div>
      )}
    </div>
  );
}
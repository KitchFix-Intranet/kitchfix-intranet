"use client";
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { SC_ADMINS } from "@/lib/admin";
import ServiceCalendar from "./ServiceCalendar";
// PR-K (2026-08-18): one SC-scoped toast supersedes SubmissionToast +
// SaveConfirmation + ResetToast + the cream "No service recorded"
// block. oh-toast remains the primitive on Financial + Ops per Kevin
// ruling (see GOTCHAS "SC toast is the reference implementation").
import Toast from "./toast/Toast";
// P3-A (2026-07-25): note-posted chip uses the accent-rail primitive.
// Import the CSS at the page level so the chip renders with correct
// styles regardless of which SC subtree fires the toast.
import "@/app/ops/css/ops-shared.css";
import "./ops-sc.css";
import "./dayDetail.css";
import "./toast/toast.css";
import "./v2/accentRail.css";

// Page-level gate. Currently identical to SC_ADMINS - only the two
// listed emails see the live tool; everyone else gets the Coming Soon
// screen. When the site-lead rollout expands access, swap this for a
// dedicated SC_DEV_EMAILS list in admin.js.
export default function ServiceCalendarPage() {
  const { data: session, status } = useSession();
  const [heroImage, setHeroImage] = useState("");
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msgOrObj, type = "success") => {
    // PR-K (2026-08-18): the SC toast lifetime + pause-on-hover live
    // inside the Toast component. This function just sets the payload;
    // dismissal timers are the component's concern.
    //
    // Payload shapes accepted:
    //   string, type -> generic toast (tier from type: error -> "bad")
    //   { variant: "recorded", ... } -> Toast (day / bulk / no-service)
    //   { variant: "note-posted" | "offline-chip", ... } -> accent-rail chip
    //   { dismiss: true } -> clear current toast (persistent-chip driver)
    //
    // Persistent variants (offline-chip) skip the Toast lifetime and
    // stay mounted until an explicit `{ dismiss: true }` fires.
    if (msgOrObj && typeof msgOrObj === "object") {
      if (msgOrObj.dismiss) {
        setToast(null);
        return;
      }
      setToast(msgOrObj);
    } else {
      // Type "error" -> bad tier; anything else -> ok. Copy stays as
      // authored (Kevin fence: this PR migrates the shape, not the
      // error strings).
      setToast({ variant: "generic", tier: type === "error" ? "bad" : "ok", title: String(msgOrObj || "") });
    }
  }, []);

  // PR-K (2026-08-18): outside-click dismiss retired. The new Toast
  // component owns auto-dismiss (5s), pause-on-hover, and explicit
  // close via its own x button. An outside-click dismisser on the
  // page was a workaround for the old SubmissionToast covering the
  // grid; the new dark-bottom-centre shape does not need it.

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
      {/* PR-K (2026-08-18): note-posted + offline-chip stay on the
          accent-rail primitive because they are notification chips,
          not confirmations. The three post-action confirmation
          patterns (day-saved, bulk-saved, no-service / week-finalized
          / day-cleared / failed) all render through <Toast /> below. */}
      {toast && (toast.variant === "note-posted" || toast.variant === "offline-chip") && (
        <div className="oh-toast-container oh-toast-container--sc-center">
          {toast.variant === "note-posted" ? (
            <div
              className="sc-ar sc-ar--success"
              role="status"
              aria-live="polite"
              onClick={() => setToast(null)}
              style={{ cursor: "pointer" }}
            >
              <span className="sc-ar-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              <div className="sc-ar-content">
                <div className="sc-ar-title">{toast.title}</div>
                <div className="sc-ar-body">{toast.body}</div>
              </div>
            </div>
          ) : (
            <div
              className="sc-ar sc-ar--warning"
              role="status"
              aria-live="polite"
              style={{ minWidth: 260 }}
            >
              <span className="sc-ar-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 1l22 22" />
                  <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                  <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                  <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
                  <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                  <line x1="12" y1="20" x2="12.01" y2="20" />
                </svg>
              </span>
              <div className="sc-ar-content">
                <div className="sc-ar-title">{toast.title}</div>
                <div className="sc-ar-body">{toast.body}</div>
              </div>
            </div>
          )}
        </div>
      )}
      {toast && toast.variant !== "note-posted" && toast.variant !== "offline-chip" && (
        <div className="sc-toast-container">
          <Toast
            tier={toast.tier || "ok"}
            title={toast.title}
            detail={toast.detail}
            progress={toast.progress}
            actionLabel={toast.actionLabel}
            onAction={toast.onAction}
            onDismiss={() => setToast(null)}
          />
        </div>
      )}
    </div>
  );
}
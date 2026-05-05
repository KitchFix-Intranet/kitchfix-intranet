"use client";
import { useState, useEffect, useMemo } from "react";
import { Pin, ShieldCheck, ClipboardList, BookmarkCheck, MapPin, GraduationCap } from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// INCIDENT LIBRARY - Direction B (Reference Cards)
// Reads from library_manifest tab in HUB sheet via /api/people?action=library-list.
// Stub mode: when the manifest is empty (sheet exists but no rows),
// renders 3 hardcoded demo cards so the layout doesn't look broken.
// When Mariela populates the manifest, demo cards disappear automatically.
// ═══════════════════════════════════════════════════════════════

// Hardcoded demo cards — shown only when manifest is empty.
// These are visual placeholders until real Drive content is wired up.
const DEMO_DOCS = [
  {
    id: "demo-sop",
    category: "pinned",
    title: "Safety & Incident Management SOP",
    version: "v2.1",
    updated_at: "2026-04-28",
    description: "The full SOP that powers this tool",
    pinned: true,
    critical: false,
    view_url: null,
    thumbnail_url: null,
    is_demo: true,
  },
  {
    id: "demo-appendix-c",
    category: "forms",
    title: "Appendix C — Refusal of Medical Treatment",
    version: "v1.0",
    updated_at: "2026-03-15",
    description: "Required if injured employee declines care",
    pinned: true,
    critical: false,
    view_url: null,
    thumbnail_url: null,
    is_demo: true,
  },
  {
    id: "demo-s1-card",
    category: "reference_cards",
    title: "S1 Phone Tree — Wallet Card",
    version: "v3",
    updated_at: "2026-04-01",
    description: "Print, fold, carry",
    pinned: true,
    critical: true,
    view_url: null,
    thumbnail_url: null,
    is_demo: true,
  },
];

// P1 — Phase 2: emoji-prefixed labels (★ 📋 📌 🎓) replaced with Lucide icons
// per the documented iconography standard. Icons rendered as a separate React
// element in the section head so they can be styled independently.
const CATEGORIES = [
  { id: "pinned",          label: "Pinned by HR",     Icon: Pin },
  { id: "policies",        label: "Policies",         Icon: ShieldCheck },
  { id: "forms",           label: "Forms",            Icon: ClipboardList },
  { id: "reference_cards", label: "Reference Cards",  Icon: BookmarkCheck },
  { id: "postings",        label: "Postings",         Icon: MapPin },
  { id: "training",        label: "Training",         Icon: GraduationCap },
];

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "policies", label: "Policies" },
  { id: "forms", label: "Forms" },
  { id: "reference_cards", label: "Reference Cards" },
  { id: "postings", label: "Postings" },
  { id: "training", label: "Training" },
];

export default function IncidentLibrary({ bootstrapData, showToast }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState("all");
  const [isStub, setIsStub] = useState(false);

  // ─── Load manifest ───
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/people?action=library-list")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.success) {
          const real = data.documents || [];
          if (real.length === 0) {
            setDocs(DEMO_DOCS);
            setIsStub(true);
          } else {
            setDocs(real);
            setIsStub(false);
          }
        } else {
          // Tab doesn't exist or read failed — fall back to demo so the page still works
          setDocs(DEMO_DOCS);
          setIsStub(true);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("[Library] Load failed:", e);
        setError(e.message);
        setDocs(DEMO_DOCS);
        setIsStub(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ─── Visible filter tabs ───
  // Only show tabs for categories that actually have at least one active doc.
  // "All" always shows when there are any docs at all. Empty categories are
  // hidden so users don't tap a pill and see "No documents in this category."
  const visibleTabs = useMemo(() => {
    if (docs.length === 0) return [];
    const categoriesWithDocs = new Set(docs.map((d) => d.category));
    return FILTER_TABS.filter((tab) => tab.id === "all" || categoriesWithDocs.has(tab.id));
  }, [docs]);

  // ─── Reset filter if the active category no longer has docs ───
  // Edge case: user is filtered on "Forms," then a doc gets deactivated and
  // the docs list refreshes with no Forms left. Snap back to "all" so the
  // user isn't staring at an empty view with their selected pill highlighted.
  useEffect(() => {
    if (activeFilter !== "all" && docs.length > 0) {
      const stillHasCategory = docs.some((d) => d.category === activeFilter);
      if (!stillHasCategory) setActiveFilter("all");
    }
  }, [docs, activeFilter]);

  // ─── Filter logic ───
  // In "All" view: pinned docs surface in the Pinned section only (not duplicated
  // in their category section). In a specific category view: pinned docs DO surface
  // in that category, since the Pinned section is hidden anyway.
  const filteredDocs = activeFilter === "all"
    ? docs
    : docs.filter((d) => d.category === activeFilter);

  // ─── Group by category for "All" view ───
  // The Pinned section only renders when filter === "all" — in single-category view,
  // the user has explicitly asked to see that category, so pinned docs join the
  // category bucket rather than appearing in a separate Pinned section.
  const grouped = CATEGORIES.map((cat) => {
    let bucket;
    if (cat.id === "pinned") {
      bucket = activeFilter === "all" ? filteredDocs.filter((d) => d.pinned) : [];
    } else if (activeFilter === "all") {
      bucket = filteredDocs.filter((d) => d.category === cat.id && !d.pinned);
    } else {
      bucket = filteredDocs.filter((d) => d.category === cat.id);
    }
    return { ...cat, docs: bucket };
  }).filter((g) => g.docs.length > 0);

  return (
    <div>
      {/* S1 Emergency Hero - always-on, non-dismissable */}
      <div className="pp-inc-lib-hero">
        <div className="pp-inc-lib-hero-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
        </div>
        <div className="pp-inc-lib-hero-text">
          <h3>S1 Emergency? Call HR first.</h3>
          <p>The form does not replace the phone call. Voicemail counts only with a callback number AND a Slack message.</p>
        </div>
        <a href="tel:+13125481420" className="pp-inc-lib-hero-phone">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          (312) 548-1420
        </a>
      </div>

      {/* Filter tabs - only categories with real docs, hidden if 0/1 visible */}
      {visibleTabs.length > 1 && (
        <div className="pp-inc-lib-tabs">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              className={`pp-inc-lib-tab${activeFilter === tab.id ? " pp-inc-lib-tab--active" : ""}`}
              onClick={() => setActiveFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Stub-mode hint */}
      {isStub && !loading && (
        <div className="pp-inc-lib-stub-banner">
          <strong>Library not yet populated.</strong> The cards below are placeholders. Once HR uploads documents to the Drive folder and fills the <code>library_manifest</code> tab, real documents appear here automatically.
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="pp-inc-lib-loading">
          <div className="pp-inc-lib-skeleton-grid">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="pp-inc-lib-skeleton-tile" />
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {!loading && error && !isStub && (
        <div className="pp-inc-lib-error">
          <strong>Couldn't load library.</strong> {error}
        </div>
      )}

      {/* Empty (no demo, no real, no filter match) */}
      {!loading && !isStub && docs.length === 0 && !error && (
        <div className="pp-inc-lib-empty">
          <div style={{ fontSize: 36, marginBottom: 8 }}>📚</div>
          <p>No documents yet. HR will add documents here.</p>
        </div>
      )}

      {/* Filter active but no matches in selected category */}
      {!loading && docs.length > 0 && grouped.length === 0 && (
        <div className="pp-inc-lib-empty">
          <p>No documents in this category yet.</p>
        </div>
      )}

      {/* Sections - hide section header when a specific filter is active
          (the filter pill already says what category we're viewing) */}
{!loading && grouped.map((section) => {
        const hideHeader = activeFilter !== "all" && grouped.length === 1;
        // P1 — Phase 2: pull the Lucide Icon component for this category
        const cat = CATEGORIES.find((c) => c.id === section.id);
        const Icon = cat?.Icon;
        return (
          <div key={section.id} className="pp-inc-lib-section">
            {!hideHeader && (
              <div className="pp-inc-lib-section-head">
                <h3 style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
                  {section.label}
                </h3>
                <span className="pp-inc-lib-section-count">
                  {section.docs.length} doc{section.docs.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
            <div className="pp-inc-lib-grid">
              {section.docs.map((doc) => <Tile key={doc.id} doc={doc} showToast={showToast} />)}
            </div>
          </div>
        );
      })}
          </div>
  );
}

// ─────────────────────────────────────────────
// TILE
// View opens Drive viewer in new tab; Print opens same Drive
// viewer in new tab so user can hit Cmd+P from there
// ─────────────────────────────────────────────
function Tile({ doc, showToast }) {
  const handleOpen = (mode) => {
    if (!doc.view_url) {
      // Stub mode — no real URL
      if (showToast) showToast("Demo card — real document not yet uploaded", "info");
      return;
    }
    window.open(doc.view_url, "_blank", "noopener,noreferrer");
  };

  const tileClass = [
    "pp-inc-lib-tile",
    doc.pinned ? "pp-inc-lib-tile--pinned" : "",
    doc.critical ? "pp-inc-lib-tile--critical" : "",
    doc.is_demo ? "pp-inc-lib-tile--demo" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={tileClass}>
      {doc.pinned && (
        <div
          className="pp-inc-lib-tile-pin"
          style={doc.critical ? { background: "#E53530" } : {}}
          aria-label="Pinned"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="17" x2="12" y2="22"/>
            <path d="M5 17h14V5l-2 2H7L5 5v12z"/>
          </svg>
        </div>
      )}

      {/* Thumbnail area: real img if URL provided, else PDF icon placeholder */}
      <div className="pp-inc-lib-tile-thumb">
        {doc.thumbnail_url ? (
          <img
            src={doc.thumbnail_url}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        ) : (
          <div className="pp-inc-lib-tile-thumb-fallback">
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>PDF</span>
          </div>
        )}
        <span className="pp-inc-lib-tile-typebadge">
          {doc.is_demo ? "DEMO" : "PDF"}
        </span>
      </div>

      <h4 className="pp-inc-lib-tile-title">{doc.title}</h4>

      <div className="pp-inc-lib-tile-meta">
        {doc.version && <span>{doc.version}</span>}
        {doc.version && doc.description && <span className="dot" />}
        {doc.description && <span>{doc.description}</span>}
      </div>

      <div className="pp-inc-lib-tile-actions">
        <button
          className={`pp-inc-lib-btn pp-inc-lib-btn--primary${doc.critical ? " pp-inc-lib-btn--critical" : ""}`}
          onClick={() => handleOpen("view")}
          disabled={doc.is_demo}
          title={doc.is_demo ? "Demo placeholder" : "Open in new tab"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          View
        </button>
        <button
          className="pp-inc-lib-btn"
          onClick={() => handleOpen("print")}
          disabled={doc.is_demo}
          title={doc.is_demo ? "Demo placeholder" : "Open in new tab — use your browser's print menu (⌘+P / Ctrl+P)"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print
        </button>
      </div>
    </div>
  );
}
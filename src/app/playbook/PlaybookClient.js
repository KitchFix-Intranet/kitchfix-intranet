"use client";

// ════════════════════════════════════════════════════════════════════════════
// PlaybookClient · Project OPD · The Playbook
// ════════════════════════════════════════════════════════════════════════════
// One-shot bootstrap → render hero + ask bar + filter chips + 6 shelves +
// cards or list rows. Card/row click opens the slide-over reader (imported
// from ./SlideOverReader — same component the admin dashboard uses).
// Shared data maps live in ./_shared. CSS prefix pb-.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import "./playbook.css";
import { CLASS_LABELS, CLASS_FAMILY, STATUS_COLORS } from "./_shared";
import SlideOverReader from "./SlideOverReader";

// Operator-facing catalog filters. The previous "Needs Drive link" owner-only
// chip was removed once /playbook/admin shipped (the dashboard's worklist
// covers it). The "Critical" chip was also dropped here once the critical
// visual treatment came off cards — the chip filtered to docs that look
// identical to non-critical ones, so it had no signal-to-action ratio in
// the operator view. The `critical` column stays in the data model intact.
// Status chips (Ready, Draft, Pending, Placeholder, etc.) are appended
// dynamically at render time from whatever distinct statuses exist in the
// visible documents — they aren't hardcoded here.
const FILTER_CHIPS = [
  { id: "all",    label: "All" },
  { id: "pinned", label: "Pinned" },
];

// Operator-readable status labels. Only "Live" → "Ready" right now — the
// floor reads "ready to use" more naturally than the workflow term "Live".
// All other status values stay canonical (Draft, Pending, Placeholder,
// In Build, Blocked) so the chip row + cards still reflect the granular
// build state. The data + admin dashboard always carry the raw status.
const OPERATOR_STATUS_LABEL = {
  Live: "Ready",
};
function operatorStatusLabel(s) {
  return OPERATOR_STATUS_LABEL[s] || s;
}

// Canonical workflow order — used to render status filter chips in a stable
// order regardless of which subset actually appears in the data. Mirrors
// _shared.ALL_STATUSES but defined locally to keep the chip-row import
// surface tight.
const STATUS_CHIP_ORDER = [
  "Live",
  "In Build",
  "Draft",
  "Pending",
  "Placeholder",
  "Blocked",
];

// ════════════════════════════════════════════════════════════════════════════
// Top-level orchestrator
// ════════════════════════════════════════════════════════════════════════════
export default function PlaybookClient() {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [boot, setBoot]         = useState(null);
  const [query, setQuery]       = useState("");
  const [filter, setFilter]     = useState("all");
  const [openDocId, setOpenDocId] = useState(null);

  useEffect(() => {
    fetch("/api/playbook?action=bootstrap")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setBoot(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading)        return <LoadingState />;
  if (error)          return <ErrorState message={error} />;
  if (!boot)          return <ErrorState message="No data returned from bootstrap." />;
  if (!boot.isOwner)  return <ComingSoonStub email={boot.email} />;

  return (
    <Playbook
      bootstrap={boot}
      query={query}
      setQuery={setQuery}
      filter={filter}
      setFilter={setFilter}
      openDocId={openDocId}
      setOpenDocId={setOpenDocId}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// State variants
// ════════════════════════════════════════════════════════════════════════════
function LoadingState() {
  return (
    <div className="pb-loading">
      <div className="pb-loading-pulse" />
      <div className="pb-loading-text">Loading The Playbook…</div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="pb-error">
      <div style={{ fontSize: 24, marginBottom: 8 }}>⚠</div>
      <div style={{ fontWeight: 700, color: "#0f3057" }}>Couldn&apos;t load The Playbook</div>
      <div>{message}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="pb-empty-state">
      <div className="pb-empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
          <path d="M4 19.5V22h16" />
        </svg>
      </div>
      <h2>The catalog is empty.</h2>
      <p>
        No documents have been seeded yet. Check back once the first batch lands,
        or contact the playbook owner to populate the shelves.
      </p>
    </div>
  );
}

function ComingSoonStub({ email }) {
  return (
    <div className="pb-stub-wrap">
      <div className="pb-stub-card">
        <div className="pb-stub-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
            <path d="M4 19.5V22h16" />
          </svg>
        </div>
        <h1>The Playbook is coming soon.</h1>
        <p>
          We&apos;re putting the finishing touches on the operational document library.
          Check back in once it&apos;s open to the team.
        </p>
        <p className="pb-stub-email">
          Signed in as <strong>{email}</strong>
        </p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Per-user UI hooks: collapse-state + scroll-spy (PR 7.3 Batch A items 1, 2)
// ════════════════════════════════════════════════════════════════════════════
const COLLAPSED_STORAGE_KEY = "kf_playbook_collapsed";

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Persist which shelves are collapsed across page loads. Default: all expanded.
// Wider app pattern (TopNav.js stores kf_user_email in localStorage) — casual
// browser-level UI state. No server roundtrip; OK to lose on browser-clear.
function useCollapsedShelves() {
  const [collapsed, setCollapsed] = useState(() => new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) setCollapsed(new Set(arr));
    } catch { /* ignore parse / quota errors — fall back to all-expanded */ }
  }, []);
  const toggle = useCallback((name) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
      } catch { /* ignore quota errors */ }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

// Scroll-spy: which shelf is currently active in the viewport.
//
// PR 7.3 Batch A finish (bug 3): swapped from IntersectionObserver to a direct
// scroll-position scan. IO's "entry/exit" semantics left gaps — during the
// transition from one shelf to the next, neither was reported as intersecting,
// so `active` stuck on the previous value. The scan approach reads each
// shelf's `rect.top` directly on every scroll (rAF-throttled) and picks the
// topmost shelf that's at or above the active line (~100px from viewport top,
// just under TopNav). Robust against collapse/expand layout shifts too.
//
// Returns [active, setActive] so rail clicks can set the value immediately
// (bug 3a) without waiting for scroll to catch up.
function useActiveShelf(shelves) {
  const [active, setActive] = useState(shelves[0] || null);
  const key = shelves.join("|");
  useEffect(() => {
    let rafId = null;
    const ACTIVE_LINE = 100; // px from viewport top — under TopNav (56px)

    const update = () => {
      rafId = null;
      const sections = document.querySelectorAll("[data-pb-shelf]");
      if (sections.length === 0) return;
      // Pick the shelf whose top is closest to (but at or above) the active line.
      let candidate = null;
      let candidateTop = -Infinity;
      sections.forEach((s) => {
        const top = s.getBoundingClientRect().top;
        if (top <= ACTIVE_LINE && top > candidateTop) {
          candidate = s.dataset.pbShelf;
          candidateTop = top;
        }
      });
      // No shelf has scrolled past the line yet → page is above all shelves,
      // default active to the first one.
      if (!candidate) candidate = sections[0].dataset.pbShelf;
      setActive(candidate);
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(update);
    };

    update(); // initial pass
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [key]);
  return [active, setActive];
}

// Persist whether the left rail is collapsed across page loads. Mirrors
// useCollapsedShelves's pattern but holds a single boolean (item 5).
const RAIL_COLLAPSED_KEY = "kf_playbook_rail_collapsed";
function useRailCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RAIL_COLLAPSED_KEY);
      if (raw === "1") setCollapsed(true);
    } catch { /* ignore */ }
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(RAIL_COLLAPSED_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }, []);
  return [collapsed, toggle];
}

// Sticky search visibility - true once the hero has scrolled out of view.
// Used by the StickySearch slim bar that slides in from above when the user
// scrolls past the hero, so search stays reachable for a director hitting
// /playbook 10x/day. Uses IntersectionObserver on a sentinel placed right
// after the hero (with a -56px rootMargin to account for the TopNav) - it
// flips state precisely when the hero's bottom crosses below the TopNav,
// without per-frame scroll math.
function useStickyHero() {
  const sentinelRef = useRef(null);
  const [showSticky, setShowSticky] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setShowSticky(!entry.isIntersecting),
      { rootMargin: "-56px 0px 0px 0px" }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, []);
  return [showSticky, sentinelRef];
}

// Persist card vs list view choice. Same casual-browser-state pattern as
// rail/shelf collapse — display preference, not server-persisted.
const VIEW_STORAGE_KEY = "kf_playbook_view";
function useViewMode() {
  const [view, setView] = useState("cards");
  useEffect(() => {
    try {
      const raw = localStorage.getItem(VIEW_STORAGE_KEY);
      if (raw === "list" || raw === "cards") setView(raw);
    } catch { /* ignore */ }
  }, []);
  const set = useCallback((mode) => {
    setView(mode);
    try { localStorage.setItem(VIEW_STORAGE_KEY, mode); } catch { /* ignore */ }
  }, []);
  return [view, set];
}

// ════════════════════════════════════════════════════════════════════════════
// Sticky left rail (PR 7.3 Batch A items 2 + 5 + 6)
// ════════════════════════════════════════════════════════════════════════════
function ShelfRail({ shelves, counts, active, onJump, collapsed, onToggleCollapse }) {
  // Single chevron icon — CSS rotates 180° via .pb-rail--collapsed so the
  // open/close animation is one smooth control, not two swapped points.
  return (
    <nav
      className={`pb-rail${collapsed ? " pb-rail--collapsed" : ""}`}
      aria-label="Shelf navigation"
    >
      <button
        type="button"
        className="pb-rail-toggle"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Expand shelf navigation" : "Collapse shelf navigation"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand navigation" : "Collapse navigation"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      {!collapsed && (
        <div className="pb-rail-links">
          {shelves.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onJump(s)}
              className={`pb-rail-link${active === s ? " pb-rail-link--active" : ""}`}
              aria-current={active === s ? "true" : undefined}
            >
              <span className="pb-rail-name">{s}</span>
              <span className="pb-rail-count">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Playbook page (owner view)
// ════════════════════════════════════════════════════════════════════════════
function Playbook({ bootstrap, query, setQuery, filter, setFilter, openDocId, setOpenDocId }) {
  const { documents, shelves, isOwner } = bootstrap;
  const isSearching = !!query.trim() || filter !== "all";

  // Search + filter. Status filters use the prefix "status:Live", "status:Draft",
  // etc. (added dynamically based on availableStatuses) so they don't collide
  // with the static "all" / "pinned" filter ids.
  const filteredDocs = useMemo(() => {
    let out = documents;
    if (filter === "pinned") out = out.filter((d) => d.pinned);
    else if (filter.startsWith("status:")) {
      const target = filter.slice(7);
      out = out.filter((d) => d.status === target);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter((d) => {
        const inTitle    = (d.title || "").toLowerCase().includes(q);
        const inCardLine = (d.card_line || "").toLowerCase().includes(q);
        const inKeywords = Array.isArray(d.keywords) &&
          d.keywords.some((kw) => String(kw || "").toLowerCase().includes(q));
        return inTitle || inCardLine || inKeywords;
      });
    }
    return out;
  }, [documents, filter, query]);

  // Distinct statuses present in the visible document set, in canonical
  // workflow order. The status filter chip row is built from this; statuses
  // with zero docs aren't rendered as chips (no use clicking a filter that
  // returns nothing).
  const availableStatuses = useMemo(() => {
    const present = new Set(documents.map((d) => d.status));
    return STATUS_CHIP_ORDER.filter((s) => present.has(s));
  }, [documents]);

  // Permanently-empty shelves (zero docs in the UNFILTERED set) are hidden
  // from the operator view — Finance is currently a dead room in the rail.
  // Shelves emptied by an active filter still render with the "no matches"
  // inline marker so the user can see the filter actually applied. Admin
  // dashboard keeps all shelves so its Gaps callout can flag the empties.
  const visibleShelves = useMemo(() => {
    const hasAny = new Set();
    for (const d of documents) {
      if (d.shelf) hasAny.add(d.shelf);
    }
    return shelves.filter((s) => hasAny.has(s));
  }, [shelves, documents]);

  // Group by shelf, then re-sort WITHIN each shelf by readiness so openable
  // docs lead. Group order (lower index = earlier on the shelf):
  //
  //   0. pinned + ready  (Live AND has a Drive file AND pinned)
  //   1. ready           (Live AND has a Drive file)
  //   2. pinned          (pinned, not yet ready)
  //   3. not-ready       (everything else)
  //
  // Within each group: tie-break by sort_order ASC, then title ASC, which
  // mirrors the API's authored ordering (opd.listDocuments orders by
  // pinned DESC, sort_order ASC, title ASC). Result: each shelf leads with
  // its openable docs in their authored order, then the not-yet-ready docs
  // follow in their authored order. Shelves themselves are NOT reordered -
  // Safety still contains exactly its Safety docs, etc.
  //
  // Only visibleShelves get an entry; permanently-empty shelves (Finance)
  // aren't in the rendered set at all.
  const docsByShelf = useMemo(() => {
    const map = Object.fromEntries(visibleShelves.map((s) => [s, []]));
    for (const d of filteredDocs) {
      if (d.shelf && map[d.shelf]) map[d.shelf].push(d);
    }
    const groupKey = (d) => {
      const ready = !!d.source_drive_id && d.status === "Live";
      if (ready && d.pinned) return 0;
      if (ready)             return 1;
      if (d.pinned)          return 2;
      return 3;
    };
    for (const s of visibleShelves) {
      map[s].sort((a, b) => {
        const ga = groupKey(a), gb = groupKey(b);
        if (ga !== gb) return ga - gb;
        const so = (a.sort_order ?? 100) - (b.sort_order ?? 100);
        if (so !== 0)  return so;
        return (a.title || "").localeCompare(b.title || "");
      });
    }
    return map;
  }, [filteredDocs, visibleShelves]);

  // Per-shelf visible counts (post-filter, post-search) — rail + header chip read this.
  const counts = useMemo(() => {
    const c = {};
    for (const s of visibleShelves) c[s] = (docsByShelf[s] || []).length;
    return c;
  }, [docsByShelf, visibleShelves]);

  const [collapsed, toggleCollapsed] = useCollapsedShelves();
  const [activeShelf, setActiveShelf] = useActiveShelf(visibleShelves);
  const [railCollapsed, toggleRailCollapsed] = useRailCollapsed();
  const [viewMode, setViewMode] = useViewMode();
  const [stickyShown, sentinelRef] = useStickyHero();

  // jumpToShelf needs to: (a) immediately mark the target active so the rail
  // highlight responds at click-time (bug 3a), (b) force-expand the target if
  // currently collapsed (bug 2), then (c) scroll to it AFTER React has flushed
  // the expand to the DOM (otherwise scrollIntoView measures against the
  // still-collapsed layout). We queue (c) via a "pendingJump" state that
  // triggers a useEffect post-render — by then DOM has the new layout.
  const [pendingJump, setPendingJump] = useState(null);

  const jumpToShelf = useCallback(
    (name) => {
      setActiveShelf(name); // (a) immediate visual feedback
      if (collapsed.has(name)) {
        toggleCollapsed(name); // (b) expand the target shelf
      }
      setPendingJump(name); // (c) queue scroll for next render
    },
    [collapsed, toggleCollapsed, setActiveShelf]
  );

  useEffect(() => {
    if (!pendingJump) return;
    const el = document.getElementById(`shelf-${slugify(pendingJump)}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingJump(null);
  }, [pendingJump]);

  return (
    <div className="pb-wrap">
      <Hero query={query} setQuery={setQuery} isOwner={isOwner} />
      {/* Sentinel just below the hero - IntersectionObserver in useStickyHero
          flips state when its bounds cross above the TopNav line, triggering
          the slim sticky search bar's slide-in. Zero size, negative margin
          so it sits inside the hero's bottom boundary in flow. */}
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 0, marginTop: -1 }} />
      <StickySearch query={query} setQuery={setQuery} visible={stickyShown} />
      <div className="pb-controls-row">
        <FilterChipsBar filter={filter} setFilter={setFilter} availableStatuses={availableStatuses} />
        <ViewToggle view={viewMode} setView={setViewMode} />
      </div>
      {documents.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          className="pb-layout"
          data-rail-collapsed={railCollapsed ? "true" : "false"}
        >
          <ShelfRail
            shelves={visibleShelves}
            counts={counts}
            active={activeShelf}
            onJump={jumpToShelf}
            collapsed={railCollapsed}
            onToggleCollapse={toggleRailCollapsed}
          />
          <div className="pb-shelves">
            {visibleShelves.map((shelfName) => (
              <Shelf
                key={shelfName}
                name={shelfName}
                docs={docsByShelf[shelfName]}
                view={viewMode}
                staggerKey={`${filter}|${query}`}
                onOpen={(id) => setOpenDocId(id)}
                isSearching={isSearching}
                isCollapsed={collapsed.has(shelfName)}
                onToggle={toggleCollapsed}
              />
            ))}
          </div>
        </div>
      )}

      {openDocId && (
        <SlideOverReader
          docId={openDocId}
          onClose={() => setOpenDocId(null)}
          isOwner={isOwner}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Hero band + ask bar
// ════════════════════════════════════════════════════════════════════════════
function Hero({ query, setQuery, isOwner }) {
  return (
    <div className="pb-hero">
      {/* Owner-only link to the build dashboard. Operators never see this.
          Gated on the bootstrap's isOwner (which the API computed from the
          actual signed-in email, not anything client-supplied). */}
      {isOwner && (
        <Link href="/playbook/admin" className="pb-admin-link" prefetch={false}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3h7v7H3z" />
            <path d="M14 3h7v7h-7z" />
            <path d="M14 14h7v7h-7z" />
            <path d="M3 14h7v7H3z" />
          </svg>
          Build dashboard
        </Link>
      )}
      <div className="pb-hero-content">
        <h1 className="pb-hero-tag">The Playbook</h1>
        <p className="pb-hero-sub">
          Operational documents — every shelf, every site, one place.
        </p>
        <div className="pb-ask-bar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            placeholder="Ask SousAI, or search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pb-ask-input"
            aria-label="Search the playbook"
          />
          {query && (
            <button
              className="pb-ask-clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sticky search — slim navy bar that slides in from above when the hero has
// scrolled out of view. Keeps search reachable for a director hitting the
// playbook 10x/day without leaving the navy hero parked on every scroll.
// Always rendered; transform: translateY(-100%) hides it until the sentinel
// flips. House timing 200ms ease-out; collapses to instant under
// prefers-reduced-motion.
// ════════════════════════════════════════════════════════════════════════════
function StickySearch({ query, setQuery, visible }) {
  return (
    <div
      className={`pb-sticky-search${visible ? " pb-sticky-search--show" : ""}`}
      aria-hidden={!visible}
    >
      <div className="pb-sticky-search-inner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          placeholder="Ask SousAI, or search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pb-sticky-search-input"
          aria-label="Search the playbook"
          tabIndex={visible ? 0 : -1}
        />
        {query && (
          <button
            className="pb-sticky-search-clear"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            tabIndex={visible ? 0 : -1}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Filter chips — static (All / Pinned) + dynamic status chips (Ready, Draft,
// Pending, ...). Status chips are appended from availableStatuses (computed
// upstream from the visible document set) so the row only ever shows filters
// that would return results. The Live status renders as "Ready" via
// operatorStatusLabel; all other statuses keep their canonical workflow names.
// ════════════════════════════════════════════════════════════════════════════
function FilterChipsBar({ filter, setFilter, availableStatuses }) {
  return (
    <div className="pb-chip-row" role="tablist" aria-label="Document filters">
      {FILTER_CHIPS.map((c) => (
        <button
          key={c.id}
          role="tab"
          aria-selected={filter === c.id}
          onClick={() => setFilter(c.id)}
          className={`pb-chip${filter === c.id ? " pb-chip--on" : ""}`}
        >
          {c.label}
        </button>
      ))}
      {availableStatuses && availableStatuses.length > 0 && (
        <span className="pb-chip-sep" aria-hidden="true" />
      )}
      {(availableStatuses || []).map((s) => {
        const id = `status:${s}`;
        const active = filter === id;
        return (
          <button
            key={id}
            role="tab"
            aria-selected={active}
            onClick={() => setFilter(id)}
            className={`pb-chip pb-chip--status${active ? " pb-chip--on" : ""}`}
            title={`Show only ${s} documents`}
          >
            {operatorStatusLabel(s)}
          </button>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// View-mode toggle — segmented Cards / List control
// ════════════════════════════════════════════════════════════════════════════
function ViewToggle({ view, setView }) {
  return (
    <div className="pb-view-toggle" role="group" aria-label="View mode">
      <button
        type="button"
        className={`pb-view-btn${view === "cards" ? " pb-view-btn--on" : ""}`}
        onClick={() => setView("cards")}
        aria-pressed={view === "cards"}
        title="Card view"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
        <span>Cards</span>
      </button>
      <button
        type="button"
        className={`pb-view-btn${view === "list" ? " pb-view-btn--on" : ""}`}
        onClick={() => setView("list")}
        aria-pressed={view === "list"}
        title="List view"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
        <span>List</span>
      </button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Shelves + cards
// ════════════════════════════════════════════════════════════════════════════
function Shelf({ name, docs, onOpen, isSearching, isCollapsed, onToggle, view, staggerKey }) {
  const empty = docs.length === 0;
  const count = docs.length;
  return (
    <section
      className="pb-shelf"
      data-pb-shelf={name}
      id={`shelf-${slugify(name)}`}
    >
      <button
        type="button"
        className="pb-shelf-title"
        onClick={() => onToggle(name)}
        aria-expanded={!isCollapsed}
      >
        <span className="pb-shelf-name">{name}</span>
        <span className="pb-shelf-count" aria-label={`${count} documents`}>{count}</span>
        {empty && (
          <span className="pb-shelf-empty-inline">
            — {isSearching ? "no matches" : "no documents yet"}
          </span>
        )}
        <span className="pb-shelf-rule" aria-hidden="true" />
        <span className="pb-shelf-chevron" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {/* Body wrapper always renders so the collapse can transition smoothly
          via max-height + opacity (display:none can't transition). The inner
          grid is keyed on `${staggerKey}|${view}` so changing filter/search
          (or toggling view mode) remounts the grid and replays the
          per-card fade-in stagger (.pb-card animation in CSS). */}
      <div className={`pb-shelf-body${isCollapsed ? " pb-shelf-body--collapsed" : ""}`}>
        {!empty && (
          view === "list" ? (
            <div className="pb-list-grid" key={`${staggerKey}|list`}>
              {docs.map((d, i) => (
                <DocumentListRow key={d.id} doc={d} idx={i} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <div className="pb-card-grid" key={`${staggerKey}|cards`}>
              {docs.map((d, i) => (
                <DocumentCard key={d.id} doc={d} idx={i} onOpen={onOpen} />
              ))}
            </div>
          )
        )}
      </div>
    </section>
  );
}

function DocumentCard({ doc, onOpen, idx = 0 }) {
  const status = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
  const classLabel = CLASS_LABELS[doc.doc_class] || doc.doc_class;
  const classFamily = CLASS_FAMILY[doc.doc_class] || "ref";
  // ALIVE = has a Drive file AND is Live. That's the operator's "this card is
  // a door" test. Anything else gets the recessed treatment so the eye can
  // skip past it - the recessed state replaces the previous combination of
  // "no file yet" text marker + status pill colors as the openability signal.
  const isAlive = !!doc.source_drive_id && doc.status === "Live";
  return (
    <button
      className={`pb-card pb-card--${isAlive ? "alive" : "recessed"}`}
      onClick={() => onOpen(doc.id)}
      aria-label={`Open ${doc.title}`}
      style={{ "--idx": idx }}
    >
      <div className="pb-card-head">
        <span className={`pb-class-chip pb-class-chip--${classFamily}`}>
          {classLabel}
        </span>
        <span className="pb-card-icons">
          {doc.pinned && (
            <span className="pb-pin" aria-label="Pinned" title="Pinned">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M14 4v5l2 3v2h-5v7l-1 1-1-1v-7H4v-2l2-3V4c0-.55.45-1 1-1h6c.55 0 1 .45 1 1z" />
              </svg>
            </span>
          )}
          {doc.print_required && (
            <span className="pb-poster-mark" title="Wall poster — print and post" aria-label="Wall poster — print and post">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </span>
          )}
        </span>
      </div>
      <h3 className="pb-card-title">{doc.title}</h3>
      {doc.card_line && <p className="pb-card-line">{doc.card_line}</p>}
      <div className="pb-card-foot">
        <span
          className={`pb-status-pill${status.ghost ? " pb-status-pill--ghost" : ""}`}
          style={{ background: status.bg, color: status.color }}
        >
          {operatorStatusLabel(doc.status)}
        </span>
        {doc.version && <span className="pb-version">{doc.version}</span>}
      </div>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// List-view row — denser rendering of the same grouped/filtered docs as
// DocumentCard. Toggled via ViewToggle; clicking a row opens the same
// slide-over reader. Same data wiring, different presentation.
// ════════════════════════════════════════════════════════════════════════════
function DocumentListRow({ doc, onOpen, idx = 0 }) {
  const status = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
  const classLabel = CLASS_LABELS[doc.doc_class] || doc.doc_class;
  const classFamily = CLASS_FAMILY[doc.doc_class] || "ref";
  const isAlive = !!doc.source_drive_id && doc.status === "Live";
  return (
    <button
      className={`pb-list-row pb-list-row--${isAlive ? "alive" : "recessed"}`}
      onClick={() => onOpen(doc.id)}
      aria-label={`Open ${doc.title}`}
      style={{ "--idx": idx }}
    >
      <span className={`pb-class-chip pb-class-chip--${classFamily}`}>
        {classLabel}
      </span>
      <span className="pb-list-title">{doc.title}</span>
      <span className="pb-list-meta">
        {doc.pinned && (
          <span className="pb-pin" aria-label="Pinned" title="Pinned">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M14 4v5l2 3v2h-5v7l-1 1-1-1v-7H4v-2l2-3V4c0-.55.45-1 1-1h6c.55 0 1 .45 1 1z" />
            </svg>
          </span>
        )}
        {doc.print_required && (
          <span className="pb-poster-mark" title="Wall poster — print and post" aria-label="Wall poster — print and post">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
          </span>
        )}
        <span
          className={`pb-status-pill${status.ghost ? " pb-status-pill--ghost" : ""}`}
          style={{ background: status.bg, color: status.color }}
        >
          {operatorStatusLabel(doc.status)}
        </span>
        {doc.version && <span className="pb-version">{doc.version}</span>}
      </span>
    </button>
  );
}

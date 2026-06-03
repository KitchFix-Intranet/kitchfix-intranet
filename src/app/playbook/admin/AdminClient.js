"use client";

// ════════════════════════════════════════════════════════════════════════════
// AdminClient · Project OPD · Build Dashboard
// ════════════════════════════════════════════════════════════════════════════
//
// One-shot bootstrap of /api/playbook?action=bootstrap. Same gate the catalog
// uses (canViewPlaybook on the actual signed-in email, never impersonated);
// non-owner sees an identical coming-soon stub so the route's existence
// isn't disclosed.
//
// Owner sees three zones:
//   1. Metrics row    - totals, linked count, % Live progress bar, status rollup
//   2. Gaps callout   - empty shelves + PB-006 priority flag
//   3. Worklist table - all 41 docs, sortable, click-to-open the slide-over
//
// Strictly read-only. The slide-over reader is reused from ../SlideOverReader,
// so clicking a worklist row opens the same UI as the catalog. Writes will
// come later via a separate upload process.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import "../playbook.css";
import "./admin.css";
import {
  CLASS_LABELS,
  CLASS_FAMILY,
  STATUS_COLORS,
  ALL_STATUSES,
} from "../_shared";
import SlideOverReader from "../SlideOverReader";

export default function AdminClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [boot, setBoot]       = useState(null);
  const [openDocId, setOpenDocId] = useState(null);
  // Default sort: by status (so the most-actionable items - Live/In Build at
  // top with asc - cluster together). Toggle direction with re-click.
  const [sortBy, setSortBy]   = useState("status");
  const [sortDir, setSortDir] = useState("asc");

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

  if (loading)       return <LoadingState />;
  if (error)         return <ErrorState message={error} />;
  if (!boot)         return <ErrorState message="No data returned from bootstrap." />;
  if (!boot.isOwner) return <ComingSoonStub email={boot.email} />;

  return (
    <AdminDashboard
      boot={boot}
      openDocId={openDocId}
      setOpenDocId={setOpenDocId}
      sortBy={sortBy}
      setSortBy={setSortBy}
      sortDir={sortDir}
      setSortDir={setSortDir}
    />
  );
}

// ════════════════════════════════════════════════════════════════════════════
// State variants (mirrors PlaybookClient's pattern - same stubs for
// non-owner so the route's existence isn't disclosed)
// ════════════════════════════════════════════════════════════════════════════
function LoadingState() {
  return (
    <div className="pb-loading">
      <div className="pb-loading-pulse" />
      <div className="pb-loading-text">Loading dashboard…</div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="pb-error">
      <div style={{ fontSize: 24, marginBottom: 8 }}>⚠</div>
      <div style={{ fontWeight: 700, color: "#0f3057" }}>
        Couldn&apos;t load the dashboard
      </div>
      <div>{message}</div>
    </div>
  );
}

function ComingSoonStub({ email }) {
  // Verbatim copy of PlaybookClient's stub - non-owner shouldn't be able
  // to tell whether /playbook/admin exists from the visible response.
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
// Dashboard (owner view)
// ════════════════════════════════════════════════════════════════════════════
function AdminDashboard({
  boot,
  openDocId,
  setOpenDocId,
  sortBy,
  setSortBy,
  sortDir,
  setSortDir,
}) {
  const { documents, shelves, email } = boot;
  const total = documents.length;

  // Metrics ────────────────────────────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const c = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
    for (const d of documents) {
      if (c[d.status] !== undefined) c[d.status]++;
    }
    return c;
  }, [documents]);

  const linkedCount = useMemo(
    () => documents.filter((d) => d.source_drive_id).length,
    [documents]
  );
  // Headline progress = % of active catalog with a Drive file attached.
  // Linking is the active build-out work right now; %Live would sit at 0 for
  // a long time and not move during the current phase. Live count is still
  // shown as one of the metric cards above.
  const linkedPct = total > 0 ? Math.round((linkedCount / total) * 100) : 0;

  // Gaps & blockers ────────────────────────────────────────────────────────
  const docsByShelf = useMemo(() => {
    const map = Object.fromEntries(shelves.map((s) => [s, []]));
    for (const d of documents) {
      if (d.shelf && map[d.shelf]) map[d.shelf].push(d);
    }
    return map;
  }, [documents, shelves]);
  const emptyShelves = shelves.filter((s) => docsByShelf[s].length === 0);

  // PB-006 (Culinary OS Handbook) is the named priority gap - it gates SLA
  // rebuilds, so its build state is called out separately when not Live yet.
  const pb006 = documents.find((d) => d.id === "PB-006");
  const pb006Pending = pb006 && pb006.status !== "Live";

  // Worklist sort ──────────────────────────────────────────────────────────
  const sortedDocs = useMemo(() => {
    const cmp = (a, b) => {
      let av, bv;
      switch (sortBy) {
        case "id":      av = a.id;          bv = b.id; break;
        case "title":   av = a.title;       bv = b.title; break;
        case "shelf":   av = a.shelf;       bv = b.shelf; break;
        case "class":   av = a.doc_class;   bv = b.doc_class; break;
        // status sorted by ALL_STATUSES index so the natural workflow order
        // (Live first, Blocked last) is preserved instead of alphabetical.
        case "status":  av = ALL_STATUSES.indexOf(a.status); bv = ALL_STATUSES.indexOf(b.status); break;
        case "version": av = a.version;     bv = b.version; break;
        case "linked":  av = !!a.source_drive_id; bv = !!b.source_drive_id; break;
        default:        av = a.id;          bv = b.id;
      }
      av = av == null ? "" : av;
      bv = bv == null ? "" : bv;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      // Stable tie-break by id so re-renders don't re-order equal-key rows.
      return a.id < b.id ? -1 : 1;
    };
    return [...documents].sort(cmp);
  }, [documents, sortBy, sortDir]);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  return (
    <div className="pb-wrap pb-admin">
      {/* Header ──────────────────────────────────────────────────────────── */}
      <header className="pb-admin-head">
        <Link href="/playbook" className="pb-admin-back" prefetch={false}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to catalog
        </Link>
        <h1 className="pb-admin-title">Build Dashboard</h1>
        <p className="pb-admin-sub">
          Read-only · Active documents only · {email}
        </p>
      </header>

      {/* Metrics row ─────────────────────────────────────────────────────── */}
      <section className="pb-admin-metrics" aria-label="Catalog metrics">
        <div className="pb-metric">
          <div className="pb-metric-value">{total}</div>
          <div className="pb-metric-label">Active docs</div>
        </div>
        <div className="pb-metric">
          <div className="pb-metric-value">
            {linkedCount} <span className="pb-metric-of">/ {total}</span>
          </div>
          <div className="pb-metric-label">Linked to Drive</div>
        </div>
        <div className="pb-metric">
          <div className="pb-metric-value">{statusCounts.Live}</div>
          <div className="pb-metric-label">Live</div>
        </div>
        <div className="pb-metric pb-metric--wide">
          <div className="pb-metric-progress" aria-hidden="true">
            <div
              className="pb-metric-progress-bar"
              style={{ width: `${linkedPct}%` }}
            />
          </div>
          <div className="pb-metric-progress-label">
            <span className="pb-metric-value-inline">{linkedPct}%</span>
            <span className="pb-metric-progress-text">Linked to Drive</span>
          </div>
        </div>
      </section>

      {/* Status rollup chips ─────────────────────────────────────────────── */}
      <section className="pb-admin-status-row" aria-label="Status rollup">
        {ALL_STATUSES.map((s) => {
          const sc = STATUS_COLORS[s];
          return (
            <span
              key={s}
              className={`pb-status-pill pb-admin-status-chip${sc.ghost ? " pb-status-pill--ghost" : ""}`}
              style={{ background: sc.bg, color: sc.color }}
            >
              {s} <strong>{statusCounts[s]}</strong>
            </span>
          );
        })}
      </section>

      {/* Gaps & blockers ─────────────────────────────────────────────────── */}
      <section className="pb-admin-gaps" aria-label="Gaps and blockers">
        <h2>Gaps &amp; blockers</h2>
        <ul className="pb-admin-gap-list">
          {pb006Pending && (
            <li className="pb-admin-gap pb-admin-gap--priority">
              <span className="pb-admin-gap-label">Priority</span>
              <button
                type="button"
                className="pb-admin-gap-link"
                onClick={() => setOpenDocId(pb006.id)}
              >
                {pb006.id} · {pb006.title}
              </button>
              <span className="pb-admin-gap-note">
                gates SLA rebuilds — currently {pb006.status}
              </span>
            </li>
          )}
          {emptyShelves.map((shelf) => (
            <li key={shelf} className="pb-admin-gap">
              <span className="pb-admin-gap-label">Empty shelf</span>
              <span className="pb-admin-gap-link pb-admin-gap-link--plain">
                {shelf}
              </span>
              <span className="pb-admin-gap-note">no documents yet</span>
            </li>
          ))}
          {!pb006Pending && emptyShelves.length === 0 && (
            <li className="pb-admin-gap pb-admin-gap--ok">
              No gaps or blockers — every shelf has content and PB-006 is Live.
            </li>
          )}
        </ul>
      </section>

      {/* Worklist table ──────────────────────────────────────────────────── */}
      <section className="pb-admin-worklist" aria-label="Worklist">
        <div className="pb-admin-worklist-head">
          <h2>
            Worklist <span className="pb-admin-worklist-count">{total} active docs</span>
          </h2>
          <span className="pb-admin-worklist-hint">
            Click a row to open the reader.
          </span>
        </div>
        <div className="pb-admin-table-wrap">
          <table className="pb-admin-table">
            <thead>
              <tr>
                <SortHeader col="id"      label="ID"      {...{ sortBy, sortDir, onSort: handleSort }} />
                <SortHeader col="title"   label="Title"   {...{ sortBy, sortDir, onSort: handleSort }} />
                <SortHeader col="shelf"   label="Shelf"   {...{ sortBy, sortDir, onSort: handleSort }} />
                <SortHeader col="class"   label="Class"   {...{ sortBy, sortDir, onSort: handleSort }} />
                <SortHeader col="status"  label="Status"  {...{ sortBy, sortDir, onSort: handleSort }} />
                <SortHeader col="version" label="Version" {...{ sortBy, sortDir, onSort: handleSort }} />
                <SortHeader col="linked"  label="Linked"  {...{ sortBy, sortDir, onSort: handleSort }} />
              </tr>
            </thead>
            <tbody>
              {sortedDocs.map((doc) => {
                const sc = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
                const cl = CLASS_LABELS[doc.doc_class] || doc.doc_class;
                const cf = CLASS_FAMILY[doc.doc_class] || "ref";
                const linked = !!doc.source_drive_id;
                return (
                  <tr
                    key={doc.id}
                    className="pb-admin-row"
                    onClick={() => setOpenDocId(doc.id)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenDocId(doc.id);
                      }
                    }}
                    aria-label={`Open ${doc.title}`}
                  >
                    <td className="pb-admin-cell pb-admin-cell-id">{doc.id}</td>
                    <td className="pb-admin-cell pb-admin-cell-title">{doc.title}</td>
                    <td className="pb-admin-cell">{doc.shelf || "—"}</td>
                    <td className="pb-admin-cell">
                      <span className={`pb-class-chip pb-class-chip--${cf}`}>{cl}</span>
                    </td>
                    <td className="pb-admin-cell">
                      <span
                        className={`pb-status-pill${sc.ghost ? " pb-status-pill--ghost" : ""}`}
                        style={{ background: sc.bg, color: sc.color }}
                      >
                        {doc.status}
                      </span>
                    </td>
                    <td className="pb-admin-cell pb-admin-cell-version">
                      {doc.version || "—"}
                    </td>
                    <td className={`pb-admin-cell pb-admin-cell-linked${linked ? " pb-admin-cell-linked--yes" : ""}`}>
                      {linked ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : "—"}
                      <span className="pb-admin-sr-only">{linked ? "yes" : "no"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Slide-over reader (same one the catalog uses) ───────────────────── */}
      {openDocId && (
        <SlideOverReader docId={openDocId} onClose={() => setOpenDocId(null)} isOwner={true} />
      )}
    </div>
  );
}

function SortHeader({ col, label, sortBy, sortDir, onSort }) {
  const active = sortBy === col;
  return (
    <th
      className={`pb-admin-th${active ? " pb-admin-th--active" : ""}`}
      onClick={() => onSort(col)}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSort(col);
        }
      }}
    >
      <span>{label}</span>
      <span className="pb-admin-th-arrow" aria-hidden="true">
        {active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </span>
    </th>
  );
}

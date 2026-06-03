"use client";

// ════════════════════════════════════════════════════════════════════════════
// AdminClient · Project OPD · Build Dashboard (owner editing cockpit)
// ════════════════════════════════════════════════════════════════════════════
//
// Same bootstrap as /playbook (canViewPlaybook gate on the actual signed-in
// email, never impersonated); non-owner gets an identical coming-soon stub.
//
// Owner sees:
//   1. Metrics row    - active docs, linked count, Live count, % Linked bar
//   2. Status rollup  - colored chip row with counts per status
//   3. Gaps callout   - empty shelves + PB-006 priority flag
//   4. Worklist table - all active docs, sortable, INLINE EDITABLE
//
// Editing model (Part A):
//   - LOW-RISK fields (title, shelf, doc_class, status, version, pinned) are
//     edited inline with OPTIMISTIC writes - UI updates immediately, the
//     write fires in the background, a quiet 1.5s saved flash confirms, and
//     any failure reverts the cell + shows an inline error.
//   - HIGH-RISK fields (source_drive_id, source_drive_id_es) land in Part B
//     with a confirmed-write path and a render-check, NOT optimistic.
//   - documents.id is NEVER editable here - it's the FK-bearing primary key.
//     The ID column is the "open reader" affordance.
//
// Writes go to /api/playbook?action=update-document. That action re-validates
// the session email server-side via canViewPlaybook on every request and
// hard-rejects anything outside the WRITABLE_FIELDS_A allowlist. A non-owner
// hitting the endpoint directly gets 403 with no DB change, even if they
// forge the client.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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

// Status options for the in-row dropdown - same canonical workflow values
// the API allows. Includes Retired (the only status not in ALL_STATUSES) so
// the owner can retire docs from the worklist. Retired docs disappear from
// the next bootstrap (filterDocuments excludes them); current worklist still
// shows the retired row until refresh - that asymmetry is fine for the
// power-user surface.
const STATUS_EDIT_OPTIONS = [
  "Live", "In Build", "Draft", "Pending", "Placeholder", "Blocked", "Retired",
];

// Class options - ordered by usage frequency in the seed catalog (rough).
const CLASS_EDIT_OPTIONS = [
  "PB", "SOP", "STD", "POL", "AGR", "TPL", "FORM", "CHK", "POST", "REF",
];

export default function AdminClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [boot, setBoot]       = useState(null);
  const [openDocId, setOpenDocId] = useState(null);
  // Default sort: by status so the most-actionable items (Live/In Build at
  // top with asc) cluster together. Re-click a header to flip direction.
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
// State variants - same stubs as PlaybookClient so the route's existence
// isn't disclosed to non-owners.
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
// Dashboard (owner view) - now an editing cockpit
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
  const { shelves, email } = boot;

  // Local editable copy of the bootstrap documents. Edits mutate this; all
  // derived data (metrics, gaps, sorted worklist) reads from here so the
  // dashboard stays consistent during/after writes.
  const [docs, setDocs] = useState(boot.documents);
  // { rowId, field } of the currently-editing cell, or null. Only one cell
  // can be in edit mode at a time so the UX stays predictable.
  const [editing, setEditing] = useState(null);
  // Set of "rowId:field" keys recently saved - drives the green flash.
  // Keys auto-clear after 1500ms.
  const [justSaved, setJustSaved] = useState(() => new Set());
  // Map of "rowId:field" -> error message string for failed writes. The
  // cell renders an inline error indicator until the user retries or
  // dismisses.
  const [errors, setErrors] = useState({});
  // ID of the worklist row whose Drive-link panel is currently expanded.
  // Only one row can be expanded at a time so the panel doesn't visually
  // race with other expansions; clicking another row's Linked cell collapses
  // the current and opens the new one.
  const [expandedRowId, setExpandedRowId] = useState(null);

  const total = docs.length;

  // ── updateField: optimistic + API + reconcile/revert ──────────────────────
  const updateField = useCallback(async (doc, field, newValue) => {
    const key = `${doc.id}:${field}`;
    const oldValue = doc[field];

    // Soft warning: status -> Live on a doc with no Drive file. We're
    // intercepting BEFORE the optimistic update because window.confirm is
    // synchronous and a "cancel" should leave the doc unchanged. The
    // worklist row's status select doesn't get visually committed until
    // this passes.
    if (field === "status" && newValue === "Live" && !doc.source_drive_id) {
      const ok = window.confirm(
        `${doc.id} has no Drive file linked. Operators would see a Ready ` +
        `card that opens nothing.\n\nSet Live anyway? You can link the ` +
        `Drive file later from this dashboard.`
      );
      if (!ok) return; // The select already snapped back via its own state
    }

    // Optimistic update - the local doc gets the new value immediately.
    setDocs((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, [field]: newValue } : d))
    );
    // Clear any prior error on this cell.
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _omit, ...rest } = prev;
      return rest;
    });

    try {
      const r = await fetch("/api/playbook?action=update-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.id, patch: { [field]: newValue } }),
      });
      const data = await r.json();
      if (!r.ok || data.error) {
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      // Reconcile with server's row state (handles any server-side
      // canonicalization like trimmed whitespace).
      setDocs((prev) =>
        prev.map((d) => (d.id === doc.id ? data.document : d))
      );
      // Hold the "just saved" signal long enough to read (~2s). For the
      // Drive-ID Save button this drives an explicit "Saved ✓" morph; for
      // the Part A cell edits it drives the brief background flash. Both
      // settle back to a neutral resting state when this key clears.
      setJustSaved((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      setTimeout(() => {
        setJustSaved((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 2000);
    } catch (e) {
      // Revert the optimistic update.
      setDocs((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, [field]: oldValue } : d))
      );
      setErrors((prev) => ({ ...prev, [key]: e.message || "Save failed" }));
    }
  }, []);

  // Dismisses an inline error (user clicks the × in the error chip).
  const dismissError = useCallback((key) => {
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _omit, ...rest } = prev;
      return rest;
    });
  }, []);

  // Metrics ────────────────────────────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const c = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
    for (const d of docs) {
      if (c[d.status] !== undefined) c[d.status]++;
    }
    return c;
  }, [docs]);

  const linkedCount = useMemo(
    () => docs.filter((d) => d.source_drive_id).length,
    [docs]
  );
  const linkedPct = total > 0 ? Math.round((linkedCount / total) * 100) : 0;

  // Gaps & blockers ────────────────────────────────────────────────────────
  const docsByShelf = useMemo(() => {
    const map = Object.fromEntries(shelves.map((s) => [s, []]));
    for (const d of docs) {
      if (d.shelf && map[d.shelf]) map[d.shelf].push(d);
    }
    return map;
  }, [docs, shelves]);
  const emptyShelves = shelves.filter((s) => docsByShelf[s].length === 0);

  const pb006 = docs.find((d) => d.id === "PB-006");
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
        // status sorted by workflow order (Live first, Blocked last,
        // Retired beyond Blocked).
        case "status":  av = STATUS_EDIT_OPTIONS.indexOf(a.status); bv = STATUS_EDIT_OPTIONS.indexOf(b.status); break;
        case "version": av = a.version;     bv = b.version; break;
        case "linked":  av = !!a.source_drive_id; bv = !!b.source_drive_id; break;
        case "pinned":  av = !!a.pinned;    bv = !!b.pinned; break;
        default:        av = a.id;          bv = b.id;
      }
      av = av == null ? "" : av;
      bv = bv == null ? "" : bv;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    };
    return [...docs].sort(cmp);
  }, [docs, sortBy, sortDir]);

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
          Owner editing · Active documents only · {email}
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
            Click a cell to edit · click the ID to open the reader
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
                <SortHeader col="pinned"  label="Pin"     {...{ sortBy, sortDir, onSort: handleSort }} />
              </tr>
            </thead>
            <tbody>
              {sortedDocs.map((doc) => (
                <WorklistRow
                  key={doc.id}
                  doc={doc}
                  shelves={shelves}
                  editing={editing}
                  setEditing={setEditing}
                  justSaved={justSaved}
                  errors={errors}
                  onUpdate={updateField}
                  onDismissError={dismissError}
                  onOpenReader={setOpenDocId}
                  isExpanded={expandedRowId === doc.id}
                  onToggleExpand={() =>
                    setExpandedRowId((prev) => (prev === doc.id ? null : doc.id))
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {openDocId && (
        <SlideOverReader docId={openDocId} onClose={() => setOpenDocId(null)} isOwner={true} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WorklistRow - one editable row in the worklist.
//
// Each editable cell stays in display mode (text + cellKey-tagged span) until
// the user clicks it, at which point a controlled input/select renders in
// place. Commit semantics:
//   - Text inputs (title, version): Enter or blur commits, Esc cancels
//   - Selects (shelf, class, status): change commits immediately (native
//     change event)
//   - Pin: toggle button calls onUpdate directly (no input intermediate)
// The ID cell is a plain button styled as a code chip - opens the reader.
// The Linked cell is read-only display in Part A (Drive-ID editing is Part B).
// ════════════════════════════════════════════════════════════════════════════
function WorklistRow({
  doc,
  shelves,
  editing,
  setEditing,
  justSaved,
  errors,
  onUpdate,
  onDismissError,
  onOpenReader,
  isExpanded,
  onToggleExpand,
}) {
  const sc = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
  const cl = CLASS_LABELS[doc.doc_class] || doc.doc_class;
  const cf = CLASS_FAMILY[doc.doc_class] || "ref";
  const linked = !!doc.source_drive_id;

  const cellState = (field) => ({
    isEditing: editing && editing.rowId === doc.id && editing.field === field,
    isSaved:   justSaved.has(`${doc.id}:${field}`),
    error:     errors[`${doc.id}:${field}`],
  });

  const startEdit = (field) => setEditing({ rowId: doc.id, field });
  const cancelEdit = () => setEditing(null);

  const handleTextCommit = (field, raw) => {
    const next = raw == null ? "" : String(raw);
    setEditing(null);
    if (next === (doc[field] || "")) return; // no-op
    onUpdate(doc, field, next === "" ? null : next);
  };
  const handleSelectCommit = (field, value) => {
    setEditing(null);
    if (value === doc[field]) return;
    onUpdate(doc, field, value);
  };
  const handlePinToggle = () => {
    onUpdate(doc, "pinned", !doc.pinned);
  };

  return (
    <>
    <tr className="pb-admin-row">
      {/* ID - read-only, opens the reader */}
      <td className="pb-admin-cell pb-admin-cell-id">
        <button
          type="button"
          className="pb-admin-id-btn"
          onClick={() => onOpenReader(doc.id)}
          title={`Open ${doc.id} in reader`}
        >
          {doc.id}
        </button>
      </td>

      {/* Title - text input */}
      <td className="pb-admin-cell pb-admin-cell-title">
        <EditableTextCell
          value={doc.title}
          {...cellState("title")}
          onStartEdit={() => startEdit("title")}
          onCommit={(v) => handleTextCommit("title", v)}
          onCancel={cancelEdit}
          onDismissError={() => onDismissError(`${doc.id}:title`)}
        />
      </td>

      {/* Shelf - dropdown */}
      <td className="pb-admin-cell">
        <EditableSelectCell
          value={doc.shelf}
          options={shelves}
          renderValue={(v) => v || "—"}
          {...cellState("shelf")}
          onStartEdit={() => startEdit("shelf")}
          onCommit={(v) => handleSelectCommit("shelf", v)}
          onCancel={cancelEdit}
          onDismissError={() => onDismissError(`${doc.id}:shelf`)}
        />
      </td>

      {/* Class - dropdown */}
      <td className="pb-admin-cell">
        <EditableSelectCell
          value={doc.doc_class}
          options={CLASS_EDIT_OPTIONS}
          renderValue={(v) => (
            <span className={`pb-class-chip pb-class-chip--${cf}`}>
              {CLASS_LABELS[v] || v}
            </span>
          )}
          {...cellState("doc_class")}
          onStartEdit={() => startEdit("doc_class")}
          onCommit={(v) => handleSelectCommit("doc_class", v)}
          onCancel={cancelEdit}
          onDismissError={() => onDismissError(`${doc.id}:doc_class`)}
        />
      </td>

      {/* Status - dropdown */}
      <td className="pb-admin-cell">
        <EditableSelectCell
          value={doc.status}
          options={STATUS_EDIT_OPTIONS}
          renderValue={(v) => {
            const s = STATUS_COLORS[v] || STATUS_COLORS.Pending;
            return (
              <span
                className={`pb-status-pill${s.ghost ? " pb-status-pill--ghost" : ""}`}
                style={{ background: s.bg, color: s.color }}
              >
                {v}
              </span>
            );
          }}
          {...cellState("status")}
          onStartEdit={() => startEdit("status")}
          onCommit={(v) => handleSelectCommit("status", v)}
          onCancel={cancelEdit}
          onDismissError={() => onDismissError(`${doc.id}:status`)}
        />
      </td>

      {/* Version - text input */}
      <td className="pb-admin-cell pb-admin-cell-version">
        <EditableTextCell
          value={doc.version}
          placeholder="—"
          {...cellState("version")}
          onStartEdit={() => startEdit("version")}
          onCommit={(v) => handleTextCommit("version", v)}
          onCancel={cancelEdit}
          onDismissError={() => onDismissError(`${doc.id}:version`)}
        />
      </td>

      {/* Linked - clickable, toggles the inline Drive-ID panel below. The
          ✓/— indicator stays live (re-renders from doc.source_drive_id),
          so a Drive-ID save flips this cell automatically (Part B4). */}
      <td className="pb-admin-cell pb-admin-cell-linked">
        <button
          type="button"
          className={`pb-admin-link-btn${linked ? " pb-admin-link-btn--yes" : ""}${isExpanded ? " pb-admin-link-btn--open" : ""}`}
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          title={isExpanded ? "Close link panel" : (linked ? "View / edit Drive link" : "Add Drive link")}
        >
          {linked ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <span className="pb-admin-link-btn-dash" aria-hidden="true">—</span>
          )}
          <svg
            className="pb-admin-link-btn-chevron"
            width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="pb-admin-sr-only">{linked ? "linked" : "not linked"}</span>
        </button>
      </td>

      {/* Pin - toggle */}
      <td className="pb-admin-cell pb-admin-cell-pin">
        <PinToggle
          pinned={doc.pinned}
          onToggle={handlePinToggle}
          isSaved={justSaved.has(`${doc.id}:pinned`)}
          error={errors[`${doc.id}:pinned`]}
          onDismissError={() => onDismissError(`${doc.id}:pinned`)}
        />
      </td>
    </tr>
    {isExpanded && (
      <tr className="pb-admin-drive-row">
        <td colSpan={8}>
          <DriveLinkPanel
            doc={doc}
            onUpdate={onUpdate}
            justSaved={justSaved}
            errors={errors}
            onDismissError={onDismissError}
          />
        </td>
      </tr>
    )}
  </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DriveLinkPanel - inline EN/ES Drive-ID editor (Part B).
//
// Confirmed-write surface: each field has an explicit Save button (no auto-
// commit-on-blur). The Save still flows through the same optimistic
// updateField path the low-risk fields use - the "confirmed" part is UX
// (deliberate save action), not API semantics. Drive IDs are high-risk
// because the silent-failure mode (wrong ID or unshared file -> blank
// iframe) makes them invisible to the operator until someone tries to open
// the doc; the explicit save + test-render link below makes that failure
// catchable BEFORE going Live.
//
// Test-render approach (B3 decision):
//   Cross-origin iframe success can't be reliably detected from JS - iframe
//   .onload fires the same way whether Drive served the document or 302'd
//   to a login page, and the same-origin policy blocks reading the iframe's
//   document. The user's explicit floor is "test ↗ link that opens preview
//   in a new tab"; we adopted that. The owner pastes an ID, clicks test ↗
//   to verify visually that the doc renders + is shared correctly, THEN
//   clicks Save. An inline checkmark would be a lie - we don't pretend.
//
// Sharing prerequisite is surfaced as a hint at the bottom of the panel
// since it's the #1 reason a "saved" Drive ID renders blank for operators.
// ════════════════════════════════════════════════════════════════════════════
function DriveLinkPanel({ doc, onUpdate, justSaved, errors, onDismissError }) {
  const [enInput, setEnInput] = useState(doc.source_drive_id || "");
  const [esInput, setEsInput] = useState(doc.source_drive_id_es || "");

  // Sync the panel inputs FROM the canonical doc state. Fires after a save
  // reconciles (the server might trim whitespace etc.), and also if any
  // other code path updates the row. Doesn't reset the input while the user
  // is mid-typing because doc.source_drive_id only changes on save.
  useEffect(() => { setEnInput(doc.source_drive_id || ""); }, [doc.source_drive_id]);
  useEffect(() => { setEsInput(doc.source_drive_id_es || ""); }, [doc.source_drive_id_es]);

  // Normalize for compare: trimmed empty string == null. So clearing the
  // input is recognized as a real change (an "unlink") rather than a no-op
  // when the saved value was null.
  const enNormalized = enInput.trim() === "" ? null : enInput.trim();
  const esNormalized = esInput.trim() === "" ? null : esInput.trim();
  const enDirty = enNormalized !== (doc.source_drive_id || null);
  const esDirty = esNormalized !== (doc.source_drive_id_es || null);

  const previewUrl = (id) => `https://drive.google.com/file/d/${id}/preview`;
  const enKey = `${doc.id}:source_drive_id`;
  const esKey = `${doc.id}:source_drive_id_es`;
  const enSaved = justSaved.has(enKey);
  const esSaved = justSaved.has(esKey);
  const enError = errors[enKey];
  const esError = errors[esKey];

  const saveEn = () => { onUpdate(doc, "source_drive_id", enNormalized); };
  const saveEs = () => { onUpdate(doc, "source_drive_id_es", esNormalized); };

  return (
    <div className="pb-admin-drive-panel">
      <div className="pb-admin-drive-panel-title">
        Drive link · <code>{doc.id}</code>
      </div>

      <div className={`pb-admin-drive-field${enSaved ? " pb-admin-drive-field--saved" : ""}${enError ? " pb-admin-drive-field--error" : ""}`}>
        <label className="pb-admin-drive-label">EN</label>
        <input
          type="text"
          className="pb-admin-drive-input"
          value={enInput}
          onChange={(e) => setEnInput(e.target.value)}
          placeholder="Paste Drive file ID"
          spellCheck={false}
        />
        <button
          type="button"
          className={`pb-admin-drive-save${enSaved ? " pb-admin-drive-save--saved" : ""}`}
          onClick={saveEn}
          disabled={!enDirty}
          title={enSaved ? "Saved" : (enDirty ? "Save the Drive ID" : "No changes to save")}
        >
          {enSaved ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Saved
            </>
          ) : "Save"}
        </button>
        {enNormalized && (
          <a
            href={previewUrl(enNormalized)}
            target="_blank"
            rel="noopener noreferrer"
            className="pb-admin-drive-test"
            title="Open Drive preview in a new tab to verify the file renders and is shared"
          >
            test ↗
          </a>
        )}
        {enError && (
          <button
            type="button"
            className="pb-admin-drive-error-msg"
            onClick={() => onDismissError(enKey)}
            title="Click to dismiss"
          >
            {enError} <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      <div className={`pb-admin-drive-field${esSaved ? " pb-admin-drive-field--saved" : ""}${esError ? " pb-admin-drive-field--error" : ""}`}>
        <label className="pb-admin-drive-label">ES</label>
        <input
          type="text"
          className="pb-admin-drive-input"
          value={esInput}
          onChange={(e) => setEsInput(e.target.value)}
          placeholder="Optional - Spanish-variant Drive file ID"
          spellCheck={false}
        />
        <button
          type="button"
          className={`pb-admin-drive-save${esSaved ? " pb-admin-drive-save--saved" : ""}`}
          onClick={saveEs}
          disabled={!esDirty}
          title={esSaved ? "Saved" : (esDirty ? "Save the ES Drive ID" : "No changes to save")}
        >
          {esSaved ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Saved
            </>
          ) : "Save"}
        </button>
        {esNormalized && (
          <a
            href={previewUrl(esNormalized)}
            target="_blank"
            rel="noopener noreferrer"
            className="pb-admin-drive-test"
            title="Open Drive preview in a new tab to verify the file renders and is shared"
          >
            test ↗
          </a>
        )}
        {esError && (
          <button
            type="button"
            className="pb-admin-drive-error-msg"
            onClick={() => onDismissError(esKey)}
            title="Click to dismiss"
          >
            {esError} <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      <div className="pb-admin-drive-hint">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        File must be shared <strong>kitchfix.com → Viewer</strong> in Drive to render. Test ↗ opens the preview in a new tab so you can verify both the right file AND the sharing before going Live.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EditableTextCell - inline text editor for title and version.
// ════════════════════════════════════════════════════════════════════════════
function EditableTextCell({
  value,
  placeholder = "—",
  isEditing,
  isSaved,
  error,
  onStartEdit,
  onCommit,
  onCancel,
  onDismissError,
}) {
  if (isEditing) {
    return (
      <input
        type="text"
        className="pb-admin-edit-input"
        defaultValue={value || ""}
        autoFocus
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
    );
  }
  return (
    <DisplayCell
      isSaved={isSaved}
      error={error}
      onClick={onStartEdit}
      onDismissError={onDismissError}
    >
      {value || <span className="pb-admin-cell-empty">{placeholder}</span>}
    </DisplayCell>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EditableSelectCell - dropdown editor for shelf, class, status.
// Changes commit immediately on the native change event so there's no need
// for an explicit Enter. Blur without change cancels.
// ════════════════════════════════════════════════════════════════════════════
function EditableSelectCell({
  value,
  options,
  renderValue,
  isEditing,
  isSaved,
  error,
  onStartEdit,
  onCommit,
  onCancel,
  onDismissError,
}) {
  const selectRef = useRef(null);
  // Open the native dropdown immediately on mount so the user doesn't have
  // to click twice (showPicker is widely supported in 2025+).
  useEffect(() => {
    if (isEditing && selectRef.current && typeof selectRef.current.showPicker === "function") {
      try { selectRef.current.showPicker(); } catch { /* not all browsers */ }
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <select
        ref={selectRef}
        className="pb-admin-edit-select"
        defaultValue={value || ""}
        autoFocus
        onChange={(e) => onCommit(e.target.value)}
        onBlur={() => onCancel()}
        onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
      >
        {!value && <option value="" disabled>—</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }
  return (
    <DisplayCell
      isSaved={isSaved}
      error={error}
      onClick={onStartEdit}
      onDismissError={onDismissError}
    >
      {renderValue(value)}
    </DisplayCell>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PinToggle - one-click pinned ↔ unpinned. Optimistic via the same updateField
// path; no edit-mode intermediate (a toggle has only two states, no input).
// Filled gold pin when pinned, muted outline when not.
// ════════════════════════════════════════════════════════════════════════════
function PinToggle({ pinned, onToggle, isSaved, error, onDismissError }) {
  return (
    <div className="pb-admin-pin-wrap">
      <button
        type="button"
        className={`pb-admin-pin-btn${pinned ? " pb-admin-pin-btn--on" : ""}${isSaved ? " pb-admin-cell--saved" : ""}${error ? " pb-admin-cell--error" : ""}`}
        onClick={onToggle}
        aria-pressed={pinned}
        title={pinned ? "Unpin (floats to top of shelf)" : "Pin to top of shelf"}
      >
        {pinned ? (
          // Filled pushpin - same SVG path as the catalog card's pin so the
          // icon language stays consistent across the dashboard and operator UI.
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 4v5l2 3v2h-5v7l-1 1-1-1v-7H4v-2l2-3V4c0-.55.45-1 1-1h6c.55 0 1 .45 1 1z" />
          </svg>
        ) : (
          // Outline pin - same shape, stroked only, lower opacity.
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 4v5l2 3v2h-5v7l-1 1-1-1v-7H4v-2l2-3V4c0-.55.45-1 1-1h6c.55 0 1 .45 1 1z" />
          </svg>
        )}
      </button>
      {error && (
        <button
          type="button"
          className="pb-admin-error-dismiss"
          onClick={onDismissError}
          title={error}
          aria-label={`Pin save failed: ${error}. Click to dismiss.`}
        >
          !
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DisplayCell - shared wrapper for non-editing cell display. Carries the
// click-to-edit handler, the saved-flash class, and the error indicator.
// ════════════════════════════════════════════════════════════════════════════
function DisplayCell({ children, isSaved, error, onClick, onDismissError }) {
  return (
    <span className="pb-admin-cell-wrap">
      <button
        type="button"
        className={`pb-admin-cell-display${isSaved ? " pb-admin-cell--saved" : ""}${error ? " pb-admin-cell--error" : ""}`}
        onClick={onClick}
      >
        {children}
      </button>
      {error && (
        <button
          type="button"
          className="pb-admin-error-dismiss"
          onClick={(e) => { e.stopPropagation(); onDismissError(); }}
          title={error}
          aria-label={`Save failed: ${error}. Click to dismiss.`}
        >
          !
        </button>
      )}
    </span>
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

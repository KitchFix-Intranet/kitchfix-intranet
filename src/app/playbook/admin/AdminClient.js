"use client";

// ════════════════════════════════════════════════════════════════════════════
// AdminClient · Project OPD · OPD Command (owner cockpit)
// ════════════════════════════════════════════════════════════════════════════
//
// Same bootstrap as /playbook (canViewPlaybook gate on the actual signed-in
// email, never impersonated); non-owner gets an identical coming-soon stub.
//
// Owner sees three tabs:
//   - Attention (default landing) - triage buckets driven by overlay state
//     and content presence. Priority, Ready-to-ship, Empty shells, Stale,
//     Recent activity. Validation + Issues stubbed for PR D.
//   - Worklist - searchable, status-filterable table. Source-of-truth
//     boundary is visible at the cell level:
//       MDX-authored (read-only, edit-in-MDX affordance):
//         title, shelf, doc_class, version
//       Overlay (inline-editable, optimistic):
//         status, access_level, pinned
//   - Archive - dependency-aware archive/restore.
//
// Inline-edit semantics for overlay cells: optimistic write -> brief
// "saved" flash -> reconcile with server. Failures revert + show error.
//
// Writes go to /api/playbook?action=update-document. The server re-checks
// the owner gate on every request and rejects anything outside
// WRITABLE_FIELDS_A.
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
//
// pr-7-8 dropped 'Draft' from the schema (10 prod Draft rows migrated to
// In Build). Status options now reflect the 6-set (5 active + Retired for
// the retire-from-worklist affordance).
const STATUS_EDIT_OPTIONS = [
  "Live", "In Build", "Pending", "Placeholder", "Blocked", "Retired",
];

// Class options - ordered by usage frequency in the seed catalog (rough).
const CLASS_EDIT_OPTIONS = [
  "PB", "SOP", "STD", "POL", "AGR", "TPL", "FORM", "CHK", "POST", "REF", "REC",
];

// Access tier options (pr-7-11 hierarchical gate). Ordered widest -> narrowest
// so a sort ASC on the column groups public docs first and restricted/SLT at
// the bottom (where they're easier to spot).
const ACCESS_EDIT_OPTIONS = ["unrestricted", "restricted", "slt"];
const ACCESS_LABELS = {
  unrestricted: "Unrestricted",
  restricted:   "Restricted",
  slt:          "SLT only",
};

export default function AdminClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [boot, setBoot]       = useState(null);
  const [openDocId, setOpenDocId] = useState(null);
  const [openEditorDocId, setOpenEditorDocId] = useState(null);
  // Default sort: by status so the most-actionable items (Live/In Build at
  // top with asc) cluster together. Re-click a header to flip direction.
  const [sortBy, setSortBy]   = useState("status");
  const [sortDir, setSortDir] = useState("asc");

  useEffect(() => {
    // include_retired=true makes the bootstrap return Retired-status docs
    // alongside the Live / In Build / etc. set. The operator reader
    // (PlaybookClient) omits the flag so Retired stays hidden there. Without
    // this, the owner who retires a doc loses sight of it on the next refresh.
    fetch("/api/playbook?action=bootstrap&include_retired=true")
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
      openEditorDocId={openEditorDocId}
      setOpenEditorDocId={setOpenEditorDocId}
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
  openEditorDocId,
  setOpenEditorDocId,
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

  // Pending publish PRs (opd-edit/* branches with an open PR). Refreshed on
  // mount and after each successful submit. A stuck PR (failed required
  // check) stays open and remains here until Kevin sees it - this is how
  // a silently-failing edit becomes visible.
  const [pendingEdits, setPendingEdits] = useState([]);
  const refreshPendingEdits = useCallback(() => {
    fetch("/api/playbook?action=pending-edits", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.pending)) setPendingEdits(d.pending);
      })
      .catch(() => {
        // Non-fatal: the indicator just stays at its prior state.
      });
  }, []);
  useEffect(() => {
    refreshPendingEdits();
  }, [refreshPendingEdits]);

  // Reported issues queue (PR D). The full list is fetched once and the
  // panel filters client-side (Active vs All). After any status change we
  // refetch so the panel reflects the new state without optimistic mutation.
  const [issues, setIssues] = useState([]);
  const refreshIssues = useCallback(() => {
    fetch("/api/playbook?action=issues", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.issues)) setIssues(d.issues);
      })
      .catch(() => {
        // Non-fatal: the panel keeps its prior state.
      });
  }, []);
  useEffect(() => {
    refreshIssues();
  }, [refreshIssues]);

  // Tab state. Attention is the landing tab (the cockpit's reason for
  // existing); Worklist + Archive remain. Switching is purely client-side;
  // the worklist data is from bootstrap, archive is lazy-loaded on first
  // tab click and cached in archivedDocs.
  const [activeTab, setActiveTab] = useState("attention");
  // null = not yet loaded; array (even empty) = loaded. Stays null until the
  // user clicks Archive for the first time so the bootstrap stays lean.
  const [archivedDocs, setArchivedDocs] = useState(null);
  // Doc currently being archived/restored (shows confirmation dialog).
  const [archiveDialogDoc, setArchiveDialogDoc] = useState(null);
  const [restoreDialogDoc, setRestoreDialogDoc] = useState(null);

  // Worklist filters. Search is substring (case-insensitive) over id + title.
  // statusFilter is a Set of selected status values - empty means "show all".
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(() => new Set());

  const total = docs.length;

  // ── updateField: optimistic + API + reconcile/revert ──────────────────────
  const updateField = useCallback(async (doc, field, newValue) => {
    const key = `${doc.id}:${field}`;
    const oldValue = doc[field];

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

  // Attention buckets - the cockpit's reason for existing.
  const attention = useMemo(() => {
    const STALE_THRESHOLD_MS = 365 * 24 * 60 * 60 * 1000; // 12 months
    const now = Date.now();
    const priority = [];
    const pb006 = docs.find((d) => d.id === "PB-006");
    if (pb006 && pb006.status !== "Live") priority.push(pb006);

    const ready = docs
      .filter((d) => d.status === "In Build" && d.has_content)
      .sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100));

    const shells = docs
      .filter((d) => d.status !== "Retired" && !d.has_content)
      .sort((a, b) => a.id.localeCompare(b.id));

    const placeholders = docs
      .filter((d) => d.status === "Placeholder")
      .sort((a, b) => a.id.localeCompare(b.id));

    const stale = docs
      .filter((d) => {
        if (d.status !== "Live" || !d.last_reviewed) return false;
        const t = new Date(d.last_reviewed).getTime();
        return Number.isFinite(t) && now - t > STALE_THRESHOLD_MS;
      })
      .sort((a, b) => {
        const ta = new Date(a.last_reviewed).getTime();
        const tb = new Date(b.last_reviewed).getTime();
        return ta - tb; // oldest first
      });

    const recent = [...docs]
      .filter((d) => d.updated_at)
      .sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )
      .slice(0, 5);

    return { priority, ready, shells, placeholders, stale, recent };
  }, [docs]);

  // Worklist filtered + sorted ─────────────────────────────────────────────
  const visibleDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (statusFilter.size > 0 && !statusFilter.has(d.status)) return false;
      if (q === "") return true;
      const id = (d.id || "").toLowerCase();
      const title = (d.title || "").toLowerCase();
      return id.includes(q) || title.includes(q);
    });
  }, [docs, search, statusFilter]);

  const sortedDocs = useMemo(() => {
    const cmp = (a, b) => {
      let av, bv;
      switch (sortBy) {
        case "id":      av = a.id;          bv = b.id; break;
        case "title":   av = a.title;       bv = b.title; break;
        case "shelf":   av = a.shelf;       bv = b.shelf; break;
        case "class":   av = a.doc_class;   bv = b.doc_class; break;
        // status sorted by workflow order (Live first, Retired last).
        case "status":  av = STATUS_EDIT_OPTIONS.indexOf(a.status); bv = STATUS_EDIT_OPTIONS.indexOf(b.status); break;
        case "version": av = a.version;     bv = b.version; break;
        case "access":  av = ACCESS_EDIT_OPTIONS.indexOf(a.access_level); bv = ACCESS_EDIT_OPTIONS.indexOf(b.access_level); break;
        case "content": av = !!a.has_content; bv = !!b.has_content; break;
        case "pinned":  av = !!a.pinned;    bv = !!b.pinned; break;
        default:        av = a.id;          bv = b.id;
      }
      av = av == null ? "" : av;
      bv = bv == null ? "" : bv;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    };
    return [...visibleDocs].sort(cmp);
  }, [visibleDocs, sortBy, sortDir]);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("asc"); }
  };

  const toggleStatusFilter = (s) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };
  const clearFilters = () => {
    setSearch("");
    setStatusFilter(new Set());
  };

  return (
    <div className="pb-wrap pb-admin">
      {/* Header with persistent corpus vitals (visible on every tab) ────── */}
      <header className="pb-admin-head">
        <Link href="/playbook" className="pb-admin-back" prefetch={false}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to catalog
        </Link>
        <div className="pb-admin-head-row">
          <h1 className="pb-admin-title">OPD Command</h1>
          <div className="pb-admin-vitals" aria-label="Corpus vitals">
            <span className="pb-admin-vitals-count">{total} active</span>
            {ALL_STATUSES.filter((s) => statusCounts[s] > 0).map((s) => {
              const sc = STATUS_COLORS[s];
              return (
                <span
                  key={s}
                  className="pb-admin-vitals-chip"
                  style={{ background: sc.bg, color: sc.color }}
                >
                  {s} <strong>{statusCounts[s]}</strong>
                </span>
              );
            })}
          </div>
        </div>
        <p className="pb-admin-sub">
          Owner cockpit · {email}
        </p>
        {pendingEdits.length > 0 && (
          <div
            className="pb-admin-pending-edits"
            aria-label="Pending publish"
          >
            <span className="pb-admin-pending-edits-count">
              {pendingEdits.length} edit{pendingEdits.length === 1 ? "" : "s"} pending publish
            </span>
            <span className="pb-admin-pending-edits-list">
              {pendingEdits.map((p, i) => (
                <span key={p.number}>
                  {i > 0 && ", "}
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pb-admin-pending-edits-link"
                  >
                    {p.doc_id} (PR #{p.number})
                  </a>
                </span>
              ))}
            </span>
          </div>
        )}
      </header>

      {/* Tab nav ─ Attention / Worklist / Archive */}
      <TabNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeCount={total}
        archivedCount={archivedDocs?.length ?? null}
      />

      {activeTab === "attention" && (
        <AttentionPanel
          attention={attention}
          onOpenReader={setOpenDocId}
          onDrillToWorklist={(statuses) => {
            setStatusFilter(new Set(statuses));
            setSearch("");
            setActiveTab("worklist");
            if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          }}
          issues={issues}
          onIssuesRefresh={refreshIssues}
        />
      )}

      {activeTab === "worklist" && (
        <>
      {/* Worklist filters ──────────────────────────────────────────────── */}
      <section className="pb-admin-filters" aria-label="Worklist filters">
        <div className="pb-admin-search-wrap">
          <svg className="pb-admin-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            className="pb-admin-search-input"
            placeholder="Search id or title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search documents"
          />
        </div>
        <div className="pb-admin-filter-chips" role="group" aria-label="Filter by status">
          {ALL_STATUSES.map((s) => {
            const sc = STATUS_COLORS[s];
            const active = statusFilter.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatusFilter(s)}
                aria-pressed={active}
                className={`pb-status-pill pb-admin-filter-chip${active ? " pb-admin-filter-chip--on" : ""}${sc.ghost ? " pb-status-pill--ghost" : ""}`}
                style={active ? { background: sc.bg, color: sc.color } : undefined}
              >
                {s} <strong>{statusCounts[s]}</strong>
              </button>
            );
          })}
          {(search || statusFilter.size > 0) && (
            <button
              type="button"
              className="pb-admin-filter-clear"
              onClick={clearFilters}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      {/* Worklist table ──────────────────────────────────────────────────── */}
      <section className="pb-admin-worklist" aria-label="Worklist">
        <div className="pb-admin-worklist-head">
          <h2>
            Worklist{" "}
            <span className="pb-admin-worklist-count">
              {sortedDocs.length === total
                ? `${total} active docs`
                : `${sortedDocs.length} of ${total}`}
            </span>
          </h2>
          <span className="pb-admin-worklist-hint">
            Status, access, and pin are editable · title / shelf / class / version are MDX-authored (read-only)
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
                <SortHeader col="access"  label="Access"  {...{ sortBy, sortDir, onSort: handleSort }} />
                <SortHeader col="version" label="Version" {...{ sortBy, sortDir, onSort: handleSort }} />
                <SortHeader col="content" label="Has Content" {...{ sortBy, sortDir, onSort: handleSort }} />
                <SortHeader col="pinned"  label="Pin"     {...{ sortBy, sortDir, onSort: handleSort }} />
                <th className="pb-admin-th pb-admin-th--action" scope="col">Archive</th>
              </tr>
            </thead>
            <tbody>
              {sortedDocs.length === 0 ? (
                <tr>
                  <td className="pb-admin-empty-row" colSpan={10}>
                    No documents match the current filters.
                  </td>
                </tr>
              ) : sortedDocs.map((doc) => (
                <WorklistRow
                  key={doc.id}
                  doc={doc}
                  editing={editing}
                  setEditing={setEditing}
                  justSaved={justSaved}
                  errors={errors}
                  onUpdate={updateField}
                  onDismissError={dismissError}
                  onOpenReader={setOpenDocId}
                  onArchiveClick={() => setArchiveDialogDoc(doc)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
        </>
      )}

      {activeTab === "archive" && (
        <ArchiveTab
          docs={archivedDocs}
          onLoaded={setArchivedDocs}
          onRestoreClick={(doc) => setRestoreDialogDoc(doc)}
        />
      )}

      {archiveDialogDoc && (
        <ArchiveDialog
          doc={archiveDialogDoc}
          onCancel={() => setArchiveDialogDoc(null)}
          onConfirmed={(updatedDoc) => {
            // Move from active worklist to archived list. archivedDocs stays
            // null if the user hasn't opened the Archive tab yet (so the
            // first tab open will lazy-fetch from scratch); if non-null,
            // we prepend so the just-archived doc shows at the top.
            setDocs((prev) => prev.filter((d) => d.id !== updatedDoc.id));
            setArchivedDocs((prev) => (prev === null ? null : [updatedDoc, ...prev]));
            setArchiveDialogDoc(null);
          }}
        />
      )}

      {restoreDialogDoc && (
        <RestoreDialog
          doc={restoreDialogDoc}
          onCancel={() => setRestoreDialogDoc(null)}
          onConfirmed={(updatedDoc) => {
            // Move from archived back to active worklist.
            setArchivedDocs((prev) =>
              prev === null ? null : prev.filter((d) => d.id !== updatedDoc.id)
            );
            setDocs((prev) => [updatedDoc, ...prev]);
            setRestoreDialogDoc(null);
          }}
        />
      )}

      {openDocId && (
        <SlideOverReader
          docId={openDocId}
          onClose={() => setOpenDocId(null)}
          isOwner={true}
          onEdit={(id) => {
            setOpenDocId(null);
            setOpenEditorDocId(id);
          }}
        />
      )}

      {openEditorDocId && (
        <MdxEditorSlideOver
          docId={openEditorDocId}
          onClose={() => setOpenEditorDocId(null)}
          onSubmitted={refreshPendingEdits}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AttentionPanel - the cockpit's triage view, structured in three zones
// plus a slim "coming next" strip:
//
//   NEEDS ACTION (alerts; short full lists, always visible)
//     Priority · Empty shells (true-empty only) · Stale
//
//   QUEUE & ACTIVITY (capped queue + tracked work + recent activity)
//     Ready to ship (cap 5 + drill to Worklist) · Placeholders · Recent
//
//   REPORTED ISSUES (PR D - LIVE)
//     IssuesPanel - the triage queue for document_issues rows. Each row
//     has a status control (open / triaged / in_progress / closed) and
//     a clickable doc-title link that opens the reader.
//
//   COMING NEXT (slim, no bucket chrome)
//     Validation - projection errors surface in the cockpit (next PR)
//
// Each bucket clicks open into the slide-over reader. The drill on Ready
// to ship switches to the Worklist with the status filter pre-applied.
// ════════════════════════════════════════════════════════════════════════════
function AttentionPanel({ attention, onOpenReader, onDrillToWorklist, issues, onIssuesRefresh }) {
  return (
    <div className="pb-admin-attention-zones">
      <section className="pb-admin-zone" aria-label="Needs action">
        <h2 className="pb-admin-zone-label">Needs action</h2>
        <div className="pb-admin-zone-grid pb-admin-zone-grid--alerts">
          <AttentionBucket
            tone="priority"
            title="Priority"
            docs={attention.priority}
            emptyText="No priority items flagged."
            renderNote={(d) => `gates SLA rebuilds - currently ${d.status}`}
            onOpenReader={onOpenReader}
          />
          <AttentionBucket
            tone="shells"
            title="Empty shells"
            docs={attention.shells}
            emptyText="All clear - every active doc has content."
            renderNote={(d) => `${d.status} - no content row`}
            onOpenReader={onOpenReader}
          />
          <AttentionBucket
            tone="stale"
            title="Stale"
            docs={attention.stale}
            emptyText="All clear - no Live doc past its 12-month review window."
            renderNote={(d) =>
              d.last_reviewed ? `last reviewed ${d.last_reviewed}` : "no review on record"
            }
            onOpenReader={onOpenReader}
          />
        </div>
      </section>

      <section className="pb-admin-zone" aria-label="Queue and activity">
        <h2 className="pb-admin-zone-label">Queue &amp; activity</h2>
        <div className="pb-admin-zone-grid pb-admin-zone-grid--queue">
          <AttentionBucket
            tone="ready"
            title="Ready to ship"
            docs={attention.ready}
            cap={5}
            onDrill={() => onDrillToWorklist(["In Build"])}
            emptyText="No In Build docs with content waiting on a Live flip."
            renderNote={(d) => (d.version ? `v${d.version}` : null)}
            onOpenReader={onOpenReader}
          />
          <AttentionBucket
            tone="placeholder"
            title="Placeholders"
            docs={attention.placeholders}
            emptyText="No placeholders - nothing awaiting authoring."
            renderNote={() => "awaiting authoring"}
            onOpenReader={onOpenReader}
          />
          <AttentionBucket
            tone="recent"
            title="Recent activity"
            docs={attention.recent}
            emptyText="No recent overlay activity."
            renderNote={(d) =>
              d.updated_at
                ? `updated ${new Date(d.updated_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : ""
            }
            onOpenReader={onOpenReader}
          />
        </div>
      </section>

      <section className="pb-admin-zone" aria-label="Reported issues">
        <h2 className="pb-admin-zone-label">Reported issues</h2>
        <IssuesPanel
          issues={issues || []}
          onOpenReader={onOpenReader}
          onRefresh={onIssuesRefresh}
        />
      </section>

      <section className="pb-admin-zone pb-admin-zone--prd" aria-label="Coming next">
        <h2 className="pb-admin-zone-label">Coming next</h2>
        <ul className="pb-admin-prd-strip">
          <li className="pb-admin-prd-item">
            <span className="pb-admin-prd-name">Validation</span>
            <span className="pb-admin-prd-note">projection errors surface in the cockpit</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// IssuesPanel - PR D - the reported-issues triage queue.
//
// Source: document_issues table, fetched via GET /api/playbook?action=issues.
// Each issue carries doc_id, doc_title (decorated server-side), reporter_email,
// issue_text, status, created_at. The panel lets the owner walk an issue
// through the four-state workflow (open -> triaged -> in_progress -> closed)
// and reopen if needed.
//
// View filter: "Active" (default, hides closed) vs "All". The full issues
// array is fetched once; filtering is client-side.
// ════════════════════════════════════════════════════════════════════════════
const ISSUE_STATUS_VALUES = ["open", "triaged", "in_progress", "closed"];
const ISSUE_STATUS_LABEL = {
  open: "Open",
  triaged: "Triaged",
  in_progress: "In progress",
  closed: "Closed",
};

function IssuesPanel({ issues, onOpenReader, onRefresh }) {
  const [filter, setFilter] = useState("active"); // "active" | "all"
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const activeCount = issues.filter((i) => i.status !== "closed").length;
  const shown = filter === "active"
    ? issues.filter((i) => i.status !== "closed")
    : issues;

  const setIssueStatus = async (issueId, nextStatus) => {
    setBusyId(issueId);
    setError(null);
    try {
      const res = await fetch("/api/playbook?action=update-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_id: issueId, status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || `HTTP ${res.status}`);
      } else if (typeof onRefresh === "function") {
        onRefresh();
      }
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="pb-admin-issues">
      <div className="pb-admin-issues-head">
        <span className="pb-admin-issues-count">
          {activeCount} active{activeCount === issues.length ? "" : ` of ${issues.length}`}
        </span>
        <div className="pb-admin-issues-filter" role="group" aria-label="Filter issues">
          <button
            type="button"
            onClick={() => setFilter("active")}
            aria-pressed={filter === "active"}
            className={`pb-admin-issues-chip${filter === "active" ? " pb-admin-issues-chip--on" : ""}`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setFilter("all")}
            aria-pressed={filter === "all"}
            className={`pb-admin-issues-chip${filter === "all" ? " pb-admin-issues-chip--on" : ""}`}
          >
            All
          </button>
        </div>
      </div>

      {error && (
        <div className="pb-admin-issues-error" role="status">
          Update failed: {error}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="pb-admin-issues-empty">
          {filter === "active"
            ? "No active issues. Closed issues remain visible in All."
            : "No issues reported."}
        </p>
      ) : (
        <ul className="pb-admin-issues-list">
          {shown.map((it) => (
            <li
              key={it.id}
              className={`pb-admin-issues-item pb-admin-issues-item--${it.status}`}
            >
              <div className="pb-admin-issues-item-head">
                <button
                  type="button"
                  className="pb-admin-issues-doclink"
                  onClick={() => onOpenReader && onOpenReader(it.doc_id)}
                  title={`Open ${it.doc_id}`}
                >
                  <code className="pb-admin-issues-docid">{it.doc_id}</code>
                  <span className="pb-admin-issues-doctitle">{it.doc_title}</span>
                </button>
                <span className="pb-admin-issues-meta">
                  <span className="pb-admin-issues-reporter">{it.reporter_email}</span>
                  <span className="pb-admin-issues-date">
                    {it.created_at
                      ? new Date(it.created_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : ""}
                  </span>
                </span>
              </div>
              <p className="pb-admin-issues-text">{it.issue_text}</p>
              <div className="pb-admin-issues-controls">
                <label className="pb-admin-issues-status-label">
                  Status
                  <select
                    className="pb-admin-issues-status-select"
                    value={it.status}
                    disabled={busyId === it.id}
                    onChange={(e) => setIssueStatus(it.id, e.target.value)}
                  >
                    {ISSUE_STATUS_VALUES.map((s) => (
                      <option key={s} value={s}>
                        {ISSUE_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                {busyId === it.id && (
                  <span className="pb-admin-issues-busy">Updating…</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttentionBucket({ tone, title, docs, emptyText, renderNote, onOpenReader, cap, onDrill, drillLabel }) {
  const shown = cap && docs.length > cap ? docs.slice(0, cap) : docs;
  const hiddenCount = cap && docs.length > cap ? docs.length - cap : 0;
  return (
    <div className={`pb-admin-bucket pb-admin-bucket--${tone}`}>
      <div className="pb-admin-bucket-head">
        <h3 className="pb-admin-bucket-title">{title}</h3>
        <span className="pb-admin-bucket-count">{docs.length}</span>
      </div>
      {docs.length === 0 ? (
        <p className="pb-admin-bucket-empty">{emptyText}</p>
      ) : (
        <>
          <ul className="pb-admin-bucket-list">
            {shown.map((d) => (
              <li key={d.id} className="pb-admin-bucket-item">
                <button
                  type="button"
                  className="pb-admin-bucket-link"
                  onClick={() => onOpenReader(d.id)}
                >
                  <code className="pb-admin-bucket-id">{d.id}</code>
                  <span className="pb-admin-bucket-doc-title">{d.title}</span>
                </button>
                {renderNote && (
                  <span className="pb-admin-bucket-note">{renderNote(d)}</span>
                )}
              </li>
            ))}
          </ul>
          {hiddenCount > 0 && onDrill && (
            <button type="button" className="pb-admin-bucket-drill" onClick={onDrill}>
              {drillLabel ?? `View all ${docs.length} in Worklist`}
              <span aria-hidden="true"> &rarr;</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// WorklistRow - one row in the cockpit's Worklist.
//
// Source-of-truth boundary made visible at the cell level:
//   - MDX-authored cells (title, shelf, class, version) render as read-only
//     display with a small MDX badge. Hover-title surfaces the MDX file path.
//   - Overlay cells (status, access, pin) keep the optimistic click-to-edit
//     pattern. Status uses the status pill, access uses a tiered shield.
//
// The ID cell is a plain button styled as a code chip - opens the reader.
// Content + Archive are read-only / action cells.
// ════════════════════════════════════════════════════════════════════════════
function WorklistRow({
  doc,
  editing,
  setEditing,
  justSaved,
  errors,
  onUpdate,
  onDismissError,
  onOpenReader,
  onArchiveClick,
}) {
  const cf = CLASS_FAMILY[doc.doc_class] || "ref";
  const mdxPath = `content/documents/${doc.id}.mdx`;

  const cellState = (field) => ({
    isEditing: editing && editing.rowId === doc.id && editing.field === field,
    isSaved:   justSaved.has(`${doc.id}:${field}`),
    error:     errors[`${doc.id}:${field}`],
  });

  const startEdit = (field) => setEditing({ rowId: doc.id, field });
  const cancelEdit = () => setEditing(null);

  const handleSelectCommit = (field, value) => {
    setEditing(null);
    if (value === doc[field]) return;
    onUpdate(doc, field, value);
  };
  const handlePinToggle = () => {
    onUpdate(doc, "pinned", !doc.pinned);
  };

  return (
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

      {/* Title - MDX-authored, read-only */}
      <td className="pb-admin-cell pb-admin-cell-title">
        <MdxCell value={doc.title} mdxPath={mdxPath} />
      </td>

      {/* Shelf - MDX-authored, read-only */}
      <td className="pb-admin-cell">
        <MdxCell value={doc.shelf || "—"} mdxPath={mdxPath} muted={!doc.shelf} />
      </td>

      {/* Class - MDX-authored, read-only (rendered as chip) */}
      <td className="pb-admin-cell">
        <MdxCell
          mdxPath={mdxPath}
          rendered={
            <span className={`pb-class-chip pb-class-chip--${cf}`}>
              {CLASS_LABELS[doc.doc_class] || doc.doc_class}
            </span>
          }
        />
      </td>

      {/* Status - overlay-editable */}
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

      {/* Access tier - overlay-editable, shield affordance */}
      <td className="pb-admin-cell">
        <EditableSelectCell
          value={doc.access_level || "unrestricted"}
          options={ACCESS_EDIT_OPTIONS}
          renderValue={(v) => <AccessShield level={v} />}
          {...cellState("access_level")}
          onStartEdit={() => startEdit("access_level")}
          onCommit={(v) => handleSelectCommit("access_level", v)}
          onCancel={cancelEdit}
          onDismissError={() => onDismissError(`${doc.id}:access_level`)}
        />
      </td>

      {/* Version - MDX-authored, read-only */}
      <td className="pb-admin-cell pb-admin-cell-version">
        <MdxCell value={doc.version || "—"} mdxPath={mdxPath} muted={!doc.version} />
      </td>

      {/* Content state - read-only (sourced from has_content decoration) */}
      <td className="pb-admin-cell pb-admin-cell-content">
        <ContentStateChip hasContent={!!doc.has_content} />
      </td>

      {/* Pin - overlay-editable */}
      <td className="pb-admin-cell pb-admin-cell-pin">
        <PinToggle
          pinned={doc.pinned}
          onToggle={handlePinToggle}
          isSaved={justSaved.has(`${doc.id}:pinned`)}
          error={errors[`${doc.id}:pinned`]}
          onDismissError={() => onDismissError(`${doc.id}:pinned`)}
        />
      </td>

      {/* Archive - opens confirmation dialog */}
      <td className="pb-admin-cell pb-admin-cell-archive">
        <button
          type="button"
          className="pb-admin-archive-btn"
          onClick={onArchiveClick}
          title="Archive this document"
          aria-label={`Archive ${doc.id}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 8v13h18V8" />
            <path d="M1 3h22v5H1z" />
            <path d="M10 12h4" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AccessShield - tiered visual for the 3-tier access gate.
//   unrestricted: no shield (text only)
//   restricted:   navy shield
//   slt:          gold shield
// Inline SVG; no new icon dependency.
// ════════════════════════════════════════════════════════════════════════════
function AccessShield({ level }) {
  const tier = level || "unrestricted";
  const label = ACCESS_LABELS[tier] || tier;
  if (tier === "unrestricted") {
    return <span className="pb-admin-access pb-admin-access--unrestricted">{label}</span>;
  }
  return (
    <span className={`pb-admin-access pb-admin-access--${tier}`}>
      <svg
        width="12" height="12" viewBox="0 0 24 24" fill="currentColor"
        aria-hidden="true"
      >
        <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3z" />
      </svg>
      {label}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ContentStateChip - read-only signal for whether document_content has a row
// for this doc. Sourced from has_content (decorated server-side in opd.js).
// ════════════════════════════════════════════════════════════════════════════
function ContentStateChip({ hasContent }) {
  return (
    <span
      className={`pb-admin-content-chip pb-admin-content-chip--${hasContent ? "ok" : "empty"}`}
    >
      {hasContent ? "Yes" : "Empty"}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MdxCell - read-only display for MDX-authored fields. Hover-title reveals
// the file path so the owner knows where to edit. Visually muted vs the
// overlay-editable cells so the boundary is obvious at a glance.
// ════════════════════════════════════════════════════════════════════════════
function MdxCell({ value, rendered, mdxPath, muted = false }) {
  return (
    <span
      className={`pb-admin-mdx-cell${muted ? " pb-admin-mdx-cell--muted" : ""}`}
      title={`MDX-authored · edit in ${mdxPath}`}
    >
      {rendered ?? value}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EditableSelectCell - dropdown editor for overlay-editable fields (status,
// access_level). Changes commit immediately on the native change event so
// there's no need for an explicit Enter. Blur without change cancels.
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

// ════════════════════════════════════════════════════════════════════════════
// Tab nav, Archive view, Archive/Restore dialogs
// ════════════════════════════════════════════════════════════════════════════

// TabNav: switches between Attention / Worklist / Archive views. Attention
// is the landing tab and carries no count badge (it's a triage view, not a
// list). Archive count is null until first open (lazy-fetch); the badge is
// hidden during that gap so it doesn't show "0" misleadingly.
function TabNav({ activeTab, onTabChange, activeCount, archivedCount }) {
  return (
    <div className="pb-admin-tabnav" role="tablist" aria-label="Cockpit views">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "attention"}
        className={`pb-admin-tab${activeTab === "attention" ? " pb-admin-tab--active" : ""}`}
        onClick={() => onTabChange("attention")}
      >
        Attention
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "worklist"}
        className={`pb-admin-tab${activeTab === "worklist" ? " pb-admin-tab--active" : ""}`}
        onClick={() => onTabChange("worklist")}
      >
        Worklist
        <span className="pb-admin-tab-count">{activeCount}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === "archive"}
        className={`pb-admin-tab${activeTab === "archive" ? " pb-admin-tab--active" : ""}`}
        onClick={() => onTabChange("archive")}
      >
        Archive
        {archivedCount !== null && (
          <span className="pb-admin-tab-count">{archivedCount}</span>
        )}
      </button>
    </div>
  );
}

// ArchiveTab: lazy-fetches the archived docs list on first mount when
// `docs` is null. Renders a read-only listing with a Restore button per row.
function ArchiveTab({ docs, onLoaded, onRestoreClick }) {
  useEffect(() => {
    if (docs !== null) return;
    let cancelled = false;
    fetch("/api/playbook?action=list-archived")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          console.error("list-archived failed:", data.error);
          onLoaded([]);
        } else {
          onLoaded(data.documents || []);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("list-archived fetch failed:", e.message);
        onLoaded([]);
      });
    return () => { cancelled = true; };
  }, [docs, onLoaded]);

  if (docs === null) {
    return <div className="pb-admin-archive-loading">Loading archived documents…</div>;
  }
  if (docs.length === 0) {
    return (
      <div className="pb-admin-archive-empty">
        <h2>Archive</h2>
        <p>No archived documents.</p>
        <p className="pb-admin-archive-empty-hint">
          When you archive a document it disappears from the operator catalog and Sous and lands here. You can restore it from this view.
        </p>
      </div>
    );
  }

  return (
    <section className="pb-admin-archive" aria-label="Archived documents">
      <div className="pb-admin-archive-head">
        <h2>
          Archive <span className="pb-admin-worklist-count">{docs.length} archived</span>
        </h2>
        <span className="pb-admin-archive-hint">
          Archived docs are hidden from /playbook and removed from Sous. Restore re-embeds the doc.
        </span>
      </div>
      <div className="pb-admin-table-wrap">
        <table className="pb-admin-table">
          <thead>
            <tr>
              <th className="pb-admin-th pb-admin-th--static">ID</th>
              <th className="pb-admin-th pb-admin-th--static">Title</th>
              <th className="pb-admin-th pb-admin-th--static">Shelf</th>
              <th className="pb-admin-th pb-admin-th--static">Class</th>
              <th className="pb-admin-th pb-admin-th--static">Status</th>
              <th className="pb-admin-th pb-admin-th--static">Archived</th>
              <th className="pb-admin-th pb-admin-th--action">Restore</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => {
              const sc = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
              const cf = CLASS_FAMILY[doc.doc_class] || "ref";
              return (
                <tr key={doc.id} className="pb-admin-row pb-admin-row--archived">
                  <td className="pb-admin-cell pb-admin-cell-id"><code>{doc.id}</code></td>
                  <td className="pb-admin-cell pb-admin-cell-title">{doc.title}</td>
                  <td className="pb-admin-cell">{doc.shelf || "—"}</td>
                  <td className="pb-admin-cell">
                    <span className={`pb-class-chip pb-class-chip--${cf}`}>
                      {CLASS_LABELS[doc.doc_class] || doc.doc_class}
                    </span>
                  </td>
                  <td className="pb-admin-cell">
                    <span
                      className={`pb-status-pill${sc.ghost ? " pb-status-pill--ghost" : ""}`}
                      style={{ background: sc.bg, color: sc.color }}
                    >
                      {doc.status}
                    </span>
                  </td>
                  <td className="pb-admin-cell pb-admin-archived-at">
                    {doc.archived_at ? new Date(doc.archived_at).toLocaleString() : "—"}
                  </td>
                  <td className="pb-admin-cell pb-admin-cell-restore">
                    <button
                      type="button"
                      className="pb-admin-restore-btn"
                      onClick={() => onRestoreClick(doc)}
                      title={`Restore ${doc.id}`}
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ArchiveDialog: pre-fetches the impact (incoming relationships + chunk
// count), shows it in a confirmation overlay, fires the archive POST on
// confirm. Stays open and shows the error if the action fails; the parent
// only removes the doc from the worklist on success.
function ArchiveDialog({ doc, onCancel, onConfirmed }) {
  const [impact, setImpact] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/playbook?action=archive-impact&id=${encodeURIComponent(doc.id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) setError(data.error);
        else setImpact(data);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [doc.id]);

  const handleArchive = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/playbook?action=archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.id }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
      onConfirmed(data.document, data.chunks_deleted);
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  return (
    <ModalOverlay onClose={submitting ? () => {} : onCancel}>
      <div className="pb-admin-modal-header">
        <h2>Archive <code>{doc.id}</code>?</h2>
        <p className="pb-admin-modal-subtitle">{doc.title}</p>
      </div>

      <div className="pb-admin-modal-body">
        {loading ? (
          <p>Loading archive impact…</p>
        ) : impact ? (
          <>
            <p className="pb-admin-modal-lead">This will:</p>
            <ul className="pb-admin-modal-list">
              <li>Hide <code>{doc.id}</code> from <code>/playbook</code> (operators won&apos;t see it)</li>
              <li>
                Remove <strong>{impact.chunks_count} chunk{impact.chunks_count !== 1 ? "s" : ""}</strong> from Sous (the doc stops being searchable)
              </li>
            </ul>

            {impact.incoming_relationships.length > 0 ? (
              <>
                <p className="pb-admin-modal-lead">
                  <strong>{impact.incoming_relationships.length} doc{impact.incoming_relationships.length !== 1 ? "s" : ""}</strong> reference{impact.incoming_relationships.length === 1 ? "s" : ""} this one. The references stay intact - the doc row remains in the catalog, just hidden:
                </p>
                <ul className="pb-admin-modal-list pb-admin-modal-rels">
                  {impact.incoming_relationships.map((r, i) => (
                    <li key={`${r.from_doc}-${r.rel_type}-${i}`}>
                      <code>{r.from_doc}</code> · {r.from_title}{" "}
                      <span className="pb-admin-modal-rel-type">({r.rel_type})</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="pb-admin-modal-lead">No other docs reference this one.</p>
            )}
          </>
        ) : null}

        {error && <div className="pb-admin-modal-error">{error}</div>}
      </div>

      <div className="pb-admin-modal-actions">
        <button
          type="button"
          className="pb-admin-modal-btn"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="pb-admin-modal-btn pb-admin-modal-btn--danger"
          onClick={handleArchive}
          disabled={loading || submitting}
        >
          {submitting ? "Archiving…" : "Archive"}
        </button>
      </div>
    </ModalOverlay>
  );
}

// RestoreDialog: simpler than ArchiveDialog - no pre-fetch needed. The
// restore-time note hints at what the re-embed will do (stub, full extract,
// or no rebuild) so the owner knows roughly how long it will take.
function RestoreDialog({ doc, onCancel, onConfirmed }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const restoreNote =
    doc.doc_class === "POST"
      ? "Sous will rebuild the poster stub chunk (~1s)."
      : doc.source_drive_id
      ? "Sous will re-embed this doc (~3-5s for a typical doc)."
      : "The doc returns to the catalog; Sous chunks rebuild on its next ingestion.";

  const handleRestore = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/playbook?action=restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: doc.id }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);
      onConfirmed(data.document, data.restore_path, data.chunks_inserted);
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  };

  return (
    <ModalOverlay onClose={submitting ? () => {} : onCancel}>
      <div className="pb-admin-modal-header">
        <h2>Restore <code>{doc.id}</code>?</h2>
        <p className="pb-admin-modal-subtitle">{doc.title}</p>
      </div>

      <div className="pb-admin-modal-body">
        <p className="pb-admin-modal-lead">
          The doc will return to <code>/playbook</code> at its current status
          (<strong>{doc.status}</strong>).
        </p>
        <p>{restoreNote}</p>

        {error && <div className="pb-admin-modal-error">{error}</div>}
      </div>

      <div className="pb-admin-modal-actions">
        <button
          type="button"
          className="pb-admin-modal-btn"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="pb-admin-modal-btn pb-admin-modal-btn--primary"
          onClick={handleRestore}
          disabled={submitting}
        >
          {submitting ? "Restoring…" : "Restore"}
        </button>
      </div>
    </ModalOverlay>
  );
}

// ModalOverlay: shared backdrop + dialog frame. Closes on Escape and on
// backdrop click. Submitting dialogs pass a no-op onClose to prevent
// accidental dismissal mid-action.
function ModalOverlay({ children, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="pb-admin-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="pb-admin-modal"
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
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

// ════════════════════════════════════════════════════════════════════════════
// OPD Authoring A1 - MDX editor surface
//
// Loads a doc's raw MDX from GitHub via /api/playbook?action=mdx-source and
// surfaces frontmatter (as a scalar-field form) + body (as a plain textarea)
// for in-memory editing. NO save in A1 - the Save button is rendered
// disabled with explanatory copy. A2 wires the commit path.
//
// `sha` is kept in component state even though A1 does not use it; A2 needs
// it as the staleness guard on commit.
// ════════════════════════════════════════════════════════════════════════════

// Schema-driven enums (mirror content/schema/frontmatter.schema.json). Kept
// here so the form does not need a runtime schema fetch. If the schema
// changes, mirror it here.
const FM_DOC_CLASSES = ["PB", "SOP", "TPL", "REF", "STD", "POL", "AGR", "FORM", "POST", "CHK", "REC"];
const FM_STATUSES = ["Live", "In Build", "Pending", "Placeholder", "Blocked", "Retired"];
const FM_SHELVES = [
  "Safety, Health & Incident",
  "Operations & Leadership",
  "Service Delivery & Client Accounts",
  "People & Conduct",
  "Culinary & Kitchen Operations",
  "Brand & Documentation Standards",
];
const FM_SUBSHELVES = ["HR-A", "HR-B", "HR-C", "HR-D", "HR-E", "HR-F"];
const FM_AUDIENCES = ["operator", "corporate", "internal"];
const FM_ACCESS_LEVELS = ["unrestricted", "restricted", "slt"];
const FM_LANGS = ["en", "es"];

function MdxEditorSlideOver({ docId, onClose, onSubmitted }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // sha is the staleness guard against MAIN. The publish flow now writes to
  // opd-edit/<docId> via a PR; the editor's sha stays anchored to main and
  // does not rotate on submit (main hasn't changed). It only rotates after
  // the PR auto-merges, at which point the next save naturally 409s and the
  // Reload button picks up the new main sha.
  const [sha, setSha] = useState(null);
  const [fm, setFm] = useState(null); // frontmatter state (object)
  const [body, setBody] = useState(""); // body MDX state

  // Save flow state.
  // saveStatus values:
  //   "idle" | "submitting" | "submitted" | "unchanged"
  //   | "validation" | "compile" | "stale" | "error"
  const [saveStatus, setSaveStatus] = useState("idle");
  const [saveMessage, setSaveMessage] = useState(null);
  const [validationErrors, setValidationErrors] = useState(null);
  // Submitted-state details (PR link, branch). Set on a successful submit.
  const [submittedPr, setSubmittedPr] = useState(null);

  const loadDoc = (refreshOnly = false) => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    if (!refreshOnly) {
      setFm(null);
      setBody("");
      setSha(null);
    }
    setSaveStatus("idle");
    setSaveMessage(null);
    setValidationErrors(null);
    setSubmittedPr(null);
    // cache: "no-store" is the client-side companion to the route's
    // Cache-Control: no-store + force-dynamic. The 2026-06-19 stale-sha
    // incident proved the editor must never read this from any HTTP cache:
    // mdx-source returns the live GitHub blob sha, commit-mdx compares it
    // live, and any cached entry produces a 409 on every save.
    fetch(`/api/playbook?action=mdx-source&id=${encodeURIComponent(docId)}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) {
          setError(d.error);
        } else {
          setSha(d.sha);
          setFm(d.frontmatter || {});
          setBody(d.body || "");
        }
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  };

  useEffect(() => loadDoc(), [docId]);

  const handleSave = async () => {
    if (!fm || !sha) return;
    setSaveStatus("submitting");
    setSaveMessage(null);
    setValidationErrors(null);
    setSubmittedPr(null);
    try {
      const res = await fetch("/api/playbook?action=commit-mdx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: docId, frontmatter: fm, body, sha }),
      });
      const data = await res.json();
      if (res.status === 422 && data?.error === "validation") {
        setSaveStatus("validation");
        setValidationErrors(data.details || []);
        return;
      }
      if (res.status === 422 && data?.error === "mdx-compile") {
        setSaveStatus("compile");
        setSaveMessage(data.message || "MDX failed to compile.");
        return;
      }
      if (res.status === 409 && data?.error === "stale") {
        setSaveStatus("stale");
        setSaveMessage(
          data.message ||
            "This document changed since you opened it. Reload before saving."
        );
        return;
      }
      if (data?.error === "github_write_failed") {
        // Honest surfacing of a GitHub-side rejection. Do NOT mislabel as
        // stale - the user sees the real status + message.
        setSaveStatus("error");
        const step = data.step ? ` [${data.step}]` : "";
        setSaveMessage(
          `GitHub ${data.github_status}${step}: ${data.github_message || "(no message)"}`
        );
        return;
      }
      if (!res.ok || data.error) {
        setSaveStatus("error");
        setSaveMessage(data.error || `HTTP ${res.status}`);
        return;
      }
      if (data.unchanged) {
        setSaveStatus("unchanged");
        setSaveMessage("No changes to submit.");
        return;
      }
      if (data.status === "submitted") {
        // Asynchronous publish. The PR will auto-merge when the required
        // Playwright check passes; B2 then projects + re-embeds. The
        // editor's sha STAYS anchored to main (it has not moved); a second
        // submit in this session will update the same PR.
        setSubmittedPr({
          number: data.pr_number,
          url: data.pr_url,
          branch: data.branch,
          autoMergeEnabled: !!data.auto_merge_enabled,
          autoMergeWarning: data.auto_merge_warning || null,
        });
        setSaveStatus("submitted");
        if (typeof onSubmitted === "function") onSubmitted();
        return;
      }
      // Unknown shape - shouldn't happen, but be honest.
      setSaveStatus("error");
      setSaveMessage("Unexpected response from save endpoint.");
    } catch (e) {
      setSaveStatus("error");
      setSaveMessage(e.message || "Network error");
    }
  };

  // ESC closes.
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Body scroll lock.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const setField = (key, value) =>
    setFm((prev) => (prev ? { ...prev, [key]: value } : prev));
  const setApprovalField = (key, value) =>
    setFm((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      next.approval = { ...(prev.approval || {}), [key]: value };
      return next;
    });

  return (
    <>
      <div className="pb-slide-backdrop" onClick={onClose} />
      <aside
        className="pb-slide pb-admin-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Edit document source"
      >
        <div className="pb-slide-head">
          <div className="pb-admin-editor-head-text">
            <div className="pb-admin-editor-eyebrow">Edit MDX source</div>
            <div className="pb-admin-editor-docid">{docId}</div>
          </div>
          <button className="pb-slide-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading ? (
          <div className="pb-slide-loading">Loading MDX source…</div>
        ) : error ? (
          <div className="pb-slide-error">Error: {error}</div>
        ) : fm ? (
          <div className="pb-admin-editor-body">
            <p className="pb-admin-editor-note">
              Save opens a PR to main on GitHub. The PR auto-merges once the
              required Playwright check passes (usually a few minutes); the
              dashboard + reader then update automatically.
            </p>

            {saveStatus !== "idle" && (
              <div
                className={`pb-admin-editor-status pb-admin-editor-status--${saveStatus}`}
                role="status"
              >
                {saveStatus === "submitting" && "Submitting…"}
                {saveStatus === "submitted" && submittedPr && (
                  <>
                    <strong>Submitted for publish.</strong>{" "}
                    <a
                      href={submittedPr.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      PR #{submittedPr.number}
                    </a>{" "}
                    opened. It will publish automatically when checks pass
                    (usually a few minutes).
                    {submittedPr.autoMergeWarning && (
                      <div className="pb-admin-editor-submitted-warning">
                        Auto-merge note: {submittedPr.autoMergeWarning}
                      </div>
                    )}
                  </>
                )}
                {saveStatus === "unchanged" && saveMessage}
                {saveStatus === "compile" && (
                  <>
                    <strong>MDX compile error.</strong> {saveMessage}
                  </>
                )}
                {saveStatus === "validation" && (
                  <>
                    <strong>Frontmatter validation failed.</strong>
                    <ul className="pb-admin-editor-validation-list">
                      {(validationErrors || []).map((err, i) => (
                        <li key={i}>
                          <code>{err.path || "/"}</code>: {err.msg}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {saveStatus === "stale" && (
                  <>
                    {saveMessage}
                    <button
                      type="button"
                      className="pb-admin-modal-btn"
                      style={{ marginLeft: 8 }}
                      onClick={() => loadDoc()}
                    >
                      Reload
                    </button>
                  </>
                )}
                {saveStatus === "error" && (
                  <>
                    <strong>Submit failed.</strong> {saveMessage}
                  </>
                )}
              </div>
            )}

            <fieldset className="pb-admin-editor-fieldset">
              <legend>Identity</legend>
              <EditorTextField label="id" value={fm.id ?? ""} onChange={(v) => setField("id", v)} disabled />
              <EditorTextField label="title" required value={fm.title ?? ""} onChange={(v) => setField("title", v)} />
              <EditorSelectField label="doc_class" required value={fm.doc_class ?? ""} options={FM_DOC_CLASSES} onChange={(v) => setField("doc_class", v)} />
              <EditorTextField label="version" value={fm.version ?? ""} onChange={(v) => setField("version", v || null)} />
              <EditorSelectField label="lang" value={fm.lang ?? "en"} options={FM_LANGS} onChange={(v) => setField("lang", v)} />
            </fieldset>

            <fieldset className="pb-admin-editor-fieldset">
              <legend>Status &amp; access</legend>
              <EditorSelectField label="status" required value={fm.status ?? ""} options={FM_STATUSES} onChange={(v) => setField("status", v)} />
              <EditorSelectField label="access_level" value={fm.access_level ?? "unrestricted"} options={FM_ACCESS_LEVELS} onChange={(v) => setField("access_level", v)} />
              <EditorSelectField label="audience" value={fm.audience ?? ""} options={FM_AUDIENCES} allowEmpty onChange={(v) => setField("audience", v || null)} />
              <EditorTextField label="classification" value={fm.classification ?? ""} onChange={(v) => setField("classification", v)} />
            </fieldset>

            <fieldset className="pb-admin-editor-fieldset">
              <legend>Catalog placement</legend>
              <EditorSelectField label="shelf" value={fm.shelf ?? ""} options={FM_SHELVES} allowEmpty onChange={(v) => setField("shelf", v || null)} />
              <EditorSelectField label="subshelf" value={fm.subshelf ?? ""} options={FM_SUBSHELVES} allowEmpty onChange={(v) => setField("subshelf", v || null)} />
              <EditorNumberField label="sort_order" value={fm.sort_order ?? 100} onChange={(v) => setField("sort_order", v)} />
            </fieldset>

            <fieldset className="pb-admin-editor-fieldset">
              <legend>Display</legend>
              <EditorTextField label="card_line" value={fm.card_line ?? ""} onChange={(v) => setField("card_line", v || null)} />
              <EditorTextareaField label="summary" rows={3} value={fm.summary ?? ""} onChange={(v) => setField("summary", v || null)} />
              <EditorTextField label="keywords (comma-separated)" value={Array.isArray(fm.keywords) ? fm.keywords.join(", ") : ""} onChange={(v) => setField("keywords", v.split(",").map((s) => s.trim()).filter(Boolean))} />
              <EditorTextField label="surfaces (comma-separated)" value={Array.isArray(fm.surfaces) ? fm.surfaces.join(", ") : ""} onChange={(v) => setField("surfaces", v.split(",").map((s) => s.trim()).filter(Boolean))} />
            </fieldset>

            <fieldset className="pb-admin-editor-fieldset">
              <legend>Ownership</legend>
              <EditorTextField label="owner" value={fm.owner ?? ""} onChange={(v) => setField("owner", v || null)} />
              <EditorTextField label="approver" value={fm.approver ?? ""} onChange={(v) => setField("approver", v || null)} />
            </fieldset>

            <fieldset className="pb-admin-editor-fieldset">
              <legend>Flags</legend>
              <EditorBoolField label="print_required" value={!!fm.print_required} onChange={(v) => setField("print_required", v)} />
              <EditorBoolField label="critical" value={!!fm.critical} onChange={(v) => setField("critical", v)} />
              <EditorBoolField label="pinned" value={!!fm.pinned} onChange={(v) => setField("pinned", v)} />
              <EditorBoolField label="in_corpus" value={fm.in_corpus !== false} onChange={(v) => setField("in_corpus", v)} />
            </fieldset>

            <fieldset className="pb-admin-editor-fieldset">
              <legend>Dates</legend>
              <EditorDateField label="last_reviewed" value={fm.last_reviewed ?? ""} onChange={(v) => setField("last_reviewed", v || null)} />
              <EditorDateField label="effective_date" value={fm.effective_date ?? ""} onChange={(v) => setField("effective_date", v || null)} />
              <EditorNumberField label="review_interval_months" value={fm.review_interval_months ?? 12} onChange={(v) => setField("review_interval_months", v)} />
            </fieldset>

            <fieldset className="pb-admin-editor-fieldset">
              <legend>Approval</legend>
              <EditorTextField label="approved_version" value={fm.approval?.approved_version ?? ""} onChange={(v) => setApprovalField("approved_version", v)} />
              <EditorTextField label="approved_by" value={fm.approval?.approved_by ?? ""} onChange={(v) => setApprovalField("approved_by", v)} />
              <EditorDateField label="approved_date" value={fm.approval?.approved_date ?? ""} onChange={(v) => setApprovalField("approved_date", v)} />
              <EditorSelectField label="method" value={fm.approval?.method ?? ""} options={["recorded sign-off", "counsel-cleared", "SLT-approved", "owner-acknowledged"]} allowEmpty onChange={(v) => setApprovalField("method", v)} />
            </fieldset>

            <fieldset className="pb-admin-editor-fieldset">
              <legend>Body MDX</legend>
              <textarea
                className="pb-admin-editor-body-textarea"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                spellCheck={false}
                rows={24}
              />
              <p className="pb-admin-editor-hint">
                Relationships, obligations, and applies_to scopes live in MDX
                frontmatter (above the body); for A1 they are not surfaced in
                the form. Edit them in the body via a future structured panel.
              </p>
            </fieldset>

            <div className="pb-admin-editor-actions">
              <button
                type="button"
                className="pb-admin-modal-btn"
                onClick={onClose}
                disabled={saveStatus === "submitting"}
              >
                Close
              </button>
              <button
                type="button"
                className="pb-admin-modal-btn pb-admin-modal-btn--primary"
                onClick={handleSave}
                disabled={saveStatus === "submitting" || saveStatus === "stale"}
              >
                {saveStatus === "submitting" ? "Submitting…" : "Submit for publish"}
              </button>
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function EditorTextField({ label, value, onChange, required, disabled }) {
  return (
    <label className="pb-admin-editor-field">
      <span className="pb-admin-editor-label">
        {label}
        {required && <span className="pb-admin-editor-required" aria-hidden="true"> *</span>}
      </span>
      <input
        type="text"
        className="pb-admin-editor-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function EditorTextareaField({ label, value, onChange, rows = 2 }) {
  return (
    <label className="pb-admin-editor-field">
      <span className="pb-admin-editor-label">{label}</span>
      <textarea
        className="pb-admin-editor-input pb-admin-editor-input--textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
      />
    </label>
  );
}

function EditorSelectField({ label, value, options, onChange, required, allowEmpty }) {
  return (
    <label className="pb-admin-editor-field">
      <span className="pb-admin-editor-label">
        {label}
        {required && <span className="pb-admin-editor-required" aria-hidden="true"> *</span>}
      </span>
      <select
        className="pb-admin-editor-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {(allowEmpty || !value) && <option value="">—</option>}
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function EditorNumberField({ label, value, onChange }) {
  return (
    <label className="pb-admin-editor-field">
      <span className="pb-admin-editor-label">{label}</span>
      <input
        type="number"
        className="pb-admin-editor-input"
        value={value}
        onChange={(e) => {
          const n = e.target.value === "" ? null : Number(e.target.value);
          onChange(Number.isFinite(n) ? n : null);
        }}
      />
    </label>
  );
}

function EditorDateField({ label, value, onChange }) {
  return (
    <label className="pb-admin-editor-field">
      <span className="pb-admin-editor-label">{label}</span>
      <input
        type="date"
        className="pb-admin-editor-input"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function EditorBoolField({ label, value, onChange }) {
  return (
    <label className="pb-admin-editor-field pb-admin-editor-field--inline">
      <input
        type="checkbox"
        className="pb-admin-editor-checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="pb-admin-editor-label">{label}</span>
    </label>
  );
}

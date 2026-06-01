"use client";

// ════════════════════════════════════════════════════════════════════════════
// PlaybookClient · Project OPD · The Playbook
// ════════════════════════════════════════════════════════════════════════════
// One-shot bootstrap → render hero + ask bar + filter chips + 6 shelves + cards.
// Card click opens slide-over reader (metadata always, Drive iframe when
// source_drive_id present, "No file yet" state otherwise). Slide-over carries
// the report-issue form. CSS prefix pb-. See OPD_PLAN.md §5 (gating) + the
// OPD_CC_HANDOFF.md design notes.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from "react";
import "./playbook.css";

// ─── Locked maps ────────────────────────────────────────────────────────────
const CLASS_LABELS = {
  PB:   "Playbook",
  SOP:  "SOP",
  TPL:  "Template",
  REF:  "Reference",
  STD:  "Standard",
  POL:  "Policy",
  AGR:  "Agreement",
  FORM: "Form",
  POST: "Poster",
  CHK:  "Checklist",
};

const STATUS_COLORS = {
  "Live":        { bg: "#d1fae5", color: "#065f46" },
  "In Build":    { bg: "#dbeafe", color: "#1e40af" },
  "Draft":       { bg: "#fef3c7", color: "#92400e" },
  "Pending":     { bg: "#f1f5f9", color: "#475569" },
  "Placeholder": { bg: "#fafafa", color: "#94a3b8" },
  "Blocked":     { bg: "#fee2e2", color: "#991b1b" },
};

const RELATIONSHIP_LABELS_OUT = {
  references:    "References",
  implements:    "Implements",
  supersedes:    "Supersedes",
  superseded_by: "Superseded by",
  derived_from:  "Derived from",
  related:       "Related to",
};
const RELATIONSHIP_LABELS_IN = {
  references:    "Referenced by",
  implements:    "Implemented by",
  supersedes:    "Replaces (older)",
  superseded_by: "Replacement for",
  derived_from:  "Source for",
  related:       "Related to",
};

const FILTER_CHIPS = [
  { id: "all",      label: "All" },
  { id: "critical", label: "Critical" },
  { id: "pinned",   label: "Pinned" },
  // Owner-only filter (hidden when page widens to operators — exposes internal
  // plumbing about catalog completeness).
  { id: "no-file",  label: "Needs Drive link", ownerOnly: true },
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
// Playbook page (owner view)
// ════════════════════════════════════════════════════════════════════════════
function Playbook({ bootstrap, query, setQuery, filter, setFilter, openDocId, setOpenDocId }) {
  const { documents, shelves } = bootstrap;
  const isSearching = !!query.trim() || filter !== "all";

  // Search + filter
  const filteredDocs = useMemo(() => {
    let out = documents;
    if (filter === "critical") out = out.filter((d) => d.critical);
    if (filter === "pinned")   out = out.filter((d) => d.pinned);
    if (filter === "no-file")  out = out.filter((d) => !d.source_drive_id);

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

  // Group by shelf
  const docsByShelf = useMemo(() => {
    const map = Object.fromEntries(shelves.map((s) => [s, []]));
    for (const d of filteredDocs) {
      if (d.shelf && map[d.shelf]) map[d.shelf].push(d);
    }
    return map;
  }, [filteredDocs, shelves]);

  return (
    <div className="pb-wrap">
      <Hero query={query} setQuery={setQuery} />
      <FilterChipsBar filter={filter} setFilter={setFilter} />
      <div className="pb-shelves">
        {shelves.map((shelfName) => (
          <Shelf
            key={shelfName}
            name={shelfName}
            docs={docsByShelf[shelfName]}
            onOpen={(id) => setOpenDocId(id)}
            isSearching={isSearching}
          />
        ))}
      </div>

      {openDocId && (
        <SlideOverReader
          docId={openDocId}
          onClose={() => setOpenDocId(null)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Hero band + ask bar
// ════════════════════════════════════════════════════════════════════════════
function Hero({ query, setQuery }) {
  return (
    <div className="pb-hero">
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
// Filter chips
// ════════════════════════════════════════════════════════════════════════════
function FilterChipsBar({ filter, setFilter }) {
  return (
    <div className="pb-chip-row" role="tablist" aria-label="Document filters">
      {FILTER_CHIPS.map((c) => (
        <button
          key={c.id}
          role="tab"
          aria-selected={filter === c.id}
          onClick={() => setFilter(c.id)}
          className={`pb-chip${filter === c.id ? " pb-chip--on" : ""}${c.ownerOnly ? " pb-chip--owner-only" : ""}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Shelves + cards
// ════════════════════════════════════════════════════════════════════════════
function Shelf({ name, docs, onOpen, isSearching }) {
  const empty = docs.length === 0;
  return (
    <section className="pb-shelf">
      <h2 className="pb-shelf-title">
        {name}
        {empty && (
          <span className="pb-shelf-empty-inline">
            — {isSearching ? "no matches" : "no documents yet"}
          </span>
        )}
      </h2>
      {!empty && (
        <div className="pb-card-grid">
          {docs.map((d) => (
            <DocumentCard key={d.id} doc={d} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function DocumentCard({ doc, onOpen }) {
  const status = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
  const classLabel = CLASS_LABELS[doc.doc_class] || doc.doc_class;
  const noFile = !doc.source_drive_id;
  return (
    <button
      className={`pb-card${doc.critical ? " pb-card--critical" : ""}`}
      onClick={() => onOpen(doc.id)}
      aria-label={`Open ${doc.title}`}
    >
      <div className="pb-card-head">
        <span className="pb-class-chip">{classLabel}</span>
        {/* Critical: red left-edge stripe (pb-card--critical) is sufficient on card.
            The "⚠ Critical" text chip is surfaced in the slide-over reader instead. */}
        {/* No-file: dropped from the card head — moved to a quiet inline marker in
            the card foot below, so it doesn't compete with the class chip. */}
        <span className="pb-card-icons">
          {doc.pinned && (
            <span className="pb-pin" aria-label="Pinned" title="Pinned">★</span>
          )}
          {doc.print_required && (
            <span className="pb-print" aria-label="Print required" title="Print required">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          className="pb-status-pill"
          style={{ background: status.bg, color: status.color }}
        >
          {doc.status}
        </span>
        {doc.version && <span className="pb-version">{doc.version}</span>}
        {noFile && (
          <span className="pb-nofile-marker" title="No Drive file attached yet">
            no file yet
          </span>
        )}
      </div>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Slide-over reader
// ════════════════════════════════════════════════════════════════════════════
function SlideOverReader({ docId, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/playbook?action=document&id=${encodeURIComponent(docId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [docId]);

  // ESC closes the slide-over.
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Body scroll lock while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <>
      <div className="pb-slide-backdrop" onClick={onClose} />
      <aside className="pb-slide" role="dialog" aria-modal="true" aria-label="Document reader">
        <div className="pb-slide-head">
          <button className="pb-slide-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {loading ? (
          <div className="pb-slide-loading">Loading document…</div>
        ) : error ? (
          <div className="pb-slide-error">Error: {error}</div>
        ) : data ? (
          <SlideOverContent
            data={data}
            reportOpen={reportOpen}
            setReportOpen={setReportOpen}
          />
        ) : null}
      </aside>
    </>
  );
}

function SlideOverContent({ data, reportOpen, setReportOpen }) {
  const {
    document: doc,
    relationships,
    surfaces,
    drive_view_url,
    drive_preview_url,
  } = data;
  const status = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
  const classLabel = CLASS_LABELS[doc.doc_class] || doc.doc_class;
  const hasFile = !!drive_preview_url;

  return (
    <div className="pb-slide-body">
      {/* Header block */}
      <div className="pb-slide-head-block">
        <div className="pb-slide-class-row">
          <span className="pb-class-chip pb-class-chip--lg">{classLabel}</span>
          {doc.critical && <span className="pb-critical-chip">⚠ Critical</span>}
          {!hasFile && <span className="pb-nofile-chip">No file yet</span>}
        </div>
        <h2 className="pb-slide-title">{doc.title}</h2>
        {doc.card_line && <p className="pb-slide-cardline">{doc.card_line}</p>}
        <div className="pb-slide-meta">
          <span
            className="pb-status-pill"
            style={{ background: status.bg, color: status.color }}
          >
            {doc.status}
          </span>
          {doc.version && <span>· {doc.version}</span>}
          {doc.owner && <span>· {doc.owner}</span>}
          <span className="pb-slide-id">· {doc.id}</span>
        </div>
      </div>

      {/* Reader frame */}
      <div className="pb-reader-frame">
        {hasFile ? (
          <iframe
            src={drive_preview_url}
            className="pb-reader-iframe"
            title={`PDF preview: ${doc.title}`}
            allow="autoplay"
          />
        ) : (
          <div className="pb-no-file">
            <div className="pb-no-file-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            </div>
            <h3>No file attached yet</h3>
            <p>This document is catalogued, but no Drive PDF has been linked.</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="pb-slide-actions">
        <a
          className={`pb-action pb-action--primary${hasFile ? "" : " pb-action--disabled"}`}
          href={drive_view_url || "#"}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!hasFile}
          onClick={(e) => { if (!hasFile) e.preventDefault(); }}
        >
          Open in Drive
        </a>
        <a
          className={`pb-action${hasFile ? "" : " pb-action--disabled"}`}
          href={drive_view_url || "#"}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!hasFile}
          onClick={(e) => { if (!hasFile) e.preventDefault(); }}
          title="Open in Drive to print"
        >
          Print
        </a>
        <button
          className="pb-action pb-action--ghost"
          onClick={() => setReportOpen((r) => !r)}
        >
          🚩 Report issue
        </button>
      </div>

      {reportOpen && (
        <ReportIssueForm
          docId={doc.id}
          onCancel={() => setReportOpen(false)}
          onSuccess={() => setReportOpen(false)}
        />
      )}

      {/* Summary */}
      {doc.summary && (
        <div className="pb-slide-section">
          <h3 className="pb-slide-section-title">Summary</h3>
          <p className="pb-slide-text">{doc.summary}</p>
        </div>
      )}

      {/* Keywords */}
      {Array.isArray(doc.keywords) && doc.keywords.length > 0 && (
        <div className="pb-slide-section">
          <h3 className="pb-slide-section-title">Keywords</h3>
          <div className="pb-tag-row">
            {doc.keywords.map((kw) => (
              <span key={kw} className="pb-tag">{kw}</span>
            ))}
          </div>
        </div>
      )}

      {/* Surfaces */}
      {Array.isArray(surfaces) && surfaces.length > 0 && (
        <div className="pb-slide-section">
          <h3 className="pb-slide-section-title">Surfaces</h3>
          <div className="pb-tag-row">
            {surfaces.map((s) => (
              <span key={s} className="pb-tag pb-tag--surface">#{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Relationships */}
      {Array.isArray(relationships) && relationships.length > 0 && (
        <div className="pb-slide-section">
          <h3 className="pb-slide-section-title">Relationships</h3>
          <ul className="pb-rel-list">
            {relationships.map((r, i) => {
              const label =
                r.direction === "out"
                  ? RELATIONSHIP_LABELS_OUT[r.rel_type] || r.rel_type
                  : RELATIONSHIP_LABELS_IN[r.rel_type] || r.rel_type;
              return (
                <li key={`${r.rel_type}-${r.other_id}-${i}`} className="pb-rel-item">
                  <span className="pb-rel-type">
                    {r.direction === "out" ? `${label} →` : `← ${label}`}
                  </span>
                  <span className="pb-rel-other">
                    <code className="pb-rel-id">{r.other_id}</code>{" "}
                    {r.other_title}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Footer meta */}
      <div className="pb-slide-section">
        <h3 className="pb-slide-section-title">Catalog details</h3>
        <div className="pb-footer-meta-row"><span>Owner</span><strong>{doc.owner || "—"}</strong></div>
        <div className="pb-footer-meta-row"><span>Approver</span><strong>{doc.approver || "—"}</strong></div>
        <div className="pb-footer-meta-row"><span>Audience</span><strong>{doc.audience || "—"}</strong></div>
        <div className="pb-footer-meta-row"><span>Classification</span><strong>{doc.classification || "—"}</strong></div>
        <div className="pb-footer-meta-row"><span>Effective</span><strong>{doc.effective_date || "—"}</strong></div>
        <div className="pb-footer-meta-row"><span>Last reviewed</span><strong>{doc.last_reviewed || "—"}</strong></div>
        <div className="pb-footer-meta-row"><span>Next review</span><strong>{doc.next_review || "—"}</strong></div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Report-issue inline form
// ════════════════════════════════════════════════════════════════════════════
function ReportIssueForm({ docId, onCancel, onSuccess }) {
  const [text, setText]       = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState(null);
  const [done, setDone]       = useState(false);

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await fetch("/api/playbook?action=report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: docId, issue_text: text }),
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.error || "Submit failed");
      setDone(true);
      setTimeout(onSuccess, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return <div className="pb-report-success">Filed — thanks. Slack ping sent.</div>;
  }

  return (
    <div className="pb-report-form">
      <textarea
        className="pb-report-textarea"
        placeholder="Describe the issue — typo, outdated info, broken link, missing context, etc."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        autoFocus
      />
      {error && <div className="pb-report-error">{error}</div>}
      <div className="pb-report-actions">
        <button
          type="button"
          className="pb-action pb-action--ghost"
          onClick={onCancel}
          disabled={sending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="pb-action pb-action--primary"
          onClick={submit}
          disabled={sending || !text.trim()}
        >
          {sending ? "Filing…" : "File issue"}
        </button>
      </div>
    </div>
  );
}

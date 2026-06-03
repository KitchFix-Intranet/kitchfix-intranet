"use client";

// ════════════════════════════════════════════════════════════════════════════
// SlideOverReader · Project OPD · The Playbook
// ════════════════════════════════════════════════════════════════════════════
//
// Reusable slide-over document reader. Imported by both the catalog client
// (PlaybookClient.js) and the owner admin dashboard (admin/AdminClient.js)
// so a doc opens the same UI from either entry point.
//
// Self-contained: takes a docId and an onClose handler. Internally fetches
// /api/playbook?action=document&id=... for the row's metadata, relationships,
// surfaces, and Drive URLs.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import {
  CLASS_LABELS,
  CLASS_FAMILY,
  STATUS_COLORS,
  RELATIONSHIP_LABELS_OUT,
  RELATIONSHIP_LABELS_IN,
} from "./_shared";

export default function SlideOverReader({ docId, onClose, isOwner = false }) {
  // Nav stack supports relationship click-through: clicking a related doc
  // pushes its id onto the stack; back pops. The fetch effect keys off the
  // top of the stack so the panel swaps docs in place. Stack initialized
  // with the prop docId so back doesn't unmount the panel - it just stops
  // navigating when there's nothing left to pop.
  const [navStack, setNavStack] = useState([docId]);
  const currentDocId = navStack[navStack.length - 1];
  const canGoBack = navStack.length > 1;

  const navigateTo = (nextId) => {
    if (!nextId || nextId === currentDocId) return;
    setNavStack((s) => [...s, nextId]);
  };
  const goBack = () => {
    setNavStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  };

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [reportOpen, setReportOpen] = useState(false);

  // Refetch on currentDocId change. Resets per-doc transient state (loading,
  // data, error, report form) so a navigation never carries over the previous
  // doc's payload while the new one is in flight.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setReportOpen(false);
    fetch(`/api/playbook?action=document&id=${encodeURIComponent(currentDocId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentDocId]);

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
          {canGoBack && (
            <button
              type="button"
              className="pb-slide-back"
              onClick={goBack}
              aria-label="Back to previous document"
              title="Back"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>
          )}
          <button className="pb-slide-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {loading ? (
          <div className="pb-slide-loading">Loading document…</div>
        ) : error ? (
          <div className="pb-slide-error">Error: {error}</div>
        ) : data ? (
          // Key on currentDocId so React unmounts/remounts SlideOverContent
          // on doc-swap (relationship click). The CSS animation on the body
          // root fires fresh on each remount, giving the swap a 180ms fade
          // + slight upward slide instead of a hard cut.
          <SlideOverContent
            key={currentDocId}
            data={data}
            reportOpen={reportOpen}
            setReportOpen={setReportOpen}
            navigateTo={navigateTo}
            isOwner={isOwner}
          />
        ) : null}
      </aside>
    </>
  );
}

function SlideOverContent({ data, reportOpen, setReportOpen, navigateTo, isOwner }) {
  const {
    document: doc,
    relationships,
    surfaces,
    drive_view_url,
    drive_preview_url,
    drive_view_url_es,
    drive_preview_url_es,
  } = data;
  const status = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
  const classLabel = CLASS_LABELS[doc.doc_class] || doc.doc_class;
  const classFamily = CLASS_FAMILY[doc.doc_class] || "ref";

  // EN/ES language selection - only meaningful when BOTH URLs are present.
  // Default is "en"; reset back to "en" whenever the reader navigates to a
  // different doc (the back/forward via relationship clicks rebinds doc.id,
  // and we don't want a previous doc's language preference to leak forward).
  const [lang, setLang] = useState("en");
  useEffect(() => { setLang("en"); }, [doc.id]);

  const hasEn = !!drive_preview_url;
  const hasEs = !!drive_preview_url_es;
  const showLangToggle = hasEn && hasEs;
  // Active language. If only one of the two is present, the toggle is hidden
  // and we just render whichever exists; we never show an empty iframe.
  const activeLang = showLangToggle
    ? lang
    : (hasEn ? "en" : (hasEs ? "es" : "en"));
  const activeViewUrl    = activeLang === "es" ? drive_view_url_es    : drive_view_url;
  const activePreviewUrl = activeLang === "es" ? drive_preview_url_es : drive_preview_url;
  const hasFile = !!activePreviewUrl;

  return (
    <div className="pb-slide-body">
      {/* Header block — status sits in the top class-row alongside the class
          chip so it's the second thing the eye lands on, not buried in the
          small meta line. */}
      <div className="pb-slide-head-block">
        <div className="pb-slide-class-row">
          <span className={`pb-class-chip pb-class-chip--lg pb-class-chip--${classFamily}`}>
            {classLabel}
          </span>
          <span
            className={`pb-status-pill pb-status-pill--lg${status.ghost ? " pb-status-pill--ghost" : ""}`}
            style={{ background: status.bg, color: status.color }}
          >
            {doc.status}
          </span>
          {doc.critical && <span className="pb-critical-chip">⚠ Critical</span>}
          {!hasFile && <span className="pb-nofile-chip">No file yet</span>}
        </div>
        <h2 className="pb-slide-title">{doc.title}</h2>
        {doc.card_line && <p className="pb-slide-cardline">{doc.card_line}</p>}
        {/* Doc ID leads the meta line per STD-001 (it's the canonical
            cross-reference handle - "STD-001" not "Documentation Format
            Standard, v1.0"). Bolder + monospaced so it reads as the row's
            anchor; version + owner trail as supporting chrome. */}
        <div className="pb-slide-meta">
          <span className="pb-slide-id">{doc.id}</span>
          {doc.version && <span>· {doc.version}</span>}
          {doc.owner && <span>· {doc.owner}</span>}
        </div>
      </div>

      {/* Language toggle — only when the doc has both EN and ES Drive files
          (currently just POSTER-001). The iframe + Open in Drive + Print all
          act on the active language; navigating to a different doc resets
          this back to EN via the useEffect above. */}
      {showLangToggle && (
        <div className="pb-lang-toggle" role="group" aria-label="Document language">
          <button
            type="button"
            className={`pb-lang-btn${activeLang === "en" ? " pb-lang-btn--on" : ""}`}
            onClick={() => setLang("en")}
            aria-pressed={activeLang === "en"}
            title="English"
          >
            EN
          </button>
          <button
            type="button"
            className={`pb-lang-btn${activeLang === "es" ? " pb-lang-btn--on" : ""}`}
            onClick={() => setLang("es")}
            aria-pressed={activeLang === "es"}
            title="Español"
          >
            ES
          </button>
        </div>
      )}

      {/* Reader frame
          - Keyed on `${doc.id}-${activeLang}` so EN/ES language swaps trigger
            a CSS opacity dip on the wrapper (the existing iframe-reload was
            a hard cut otherwise; the brief fade signals "different file").
          - Skeleton (pb-iframe-skeleton) shows until iframe onLoad fires;
            covers Drive's own loading state with a quiet shimmer.
          - Pop-out button (top-right corner of frame) is the visible "open
            full-size in Drive" escape hatch that doesn't require finding the
            actions row. */}
      <div
        className="pb-reader-frame"
        key={`${doc.id}-${activeLang}`}
      >
        {hasFile && (
          <a
            className="pb-reader-popout"
            href={activeViewUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Drive (full size)"
            aria-label="Open in Drive (full size)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </a>
        )}
        {hasFile ? (
          <>
            <div className="pb-iframe-skeleton" aria-hidden="true" />
            <iframe
              src={activePreviewUrl}
              className="pb-reader-iframe"
              title={`PDF preview: ${doc.title}${showLangToggle ? ` (${activeLang.toUpperCase()})` : ""}`}
              allow="autoplay"
              onLoad={(e) => { e.currentTarget.dataset.loaded = "true"; }}
            />
          </>
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

      {/* Actions - single primary "Open in Drive" + Report issue. The
          previous Print button just opened the same Drive URL, so it was
          redundant chrome. Pop-out icon on the iframe (above) covers the
          discoverability case. */}
      <div className="pb-slide-actions">
        <a
          className={`pb-action pb-action--primary${hasFile ? "" : " pb-action--disabled"}`}
          href={activeViewUrl || "#"}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!hasFile}
          onClick={(e) => { if (!hasFile) e.preventDefault(); }}
        >
          Open in Drive
        </a>
        <button
          className="pb-action pb-action--ghost"
          onClick={() => setReportOpen((r) => !r)}
        >
          🚩 Report issue
        </button>
      </div>

      {/* SousAI doc-scoped affordance — UI placeholder, NOT wired yet.
          Rendered as a dashed-border aspirational tile so it reads as
          designed-but-coming, not a broken button. The hero's global ask-bar
          is separate; this one is scoped to the open doc. Wire-up lands in
          a future change. */}
      <div
        className="pb-sousai"
        role="button"
        aria-disabled="true"
        tabIndex={-1}
        title="SousAI is coming soon — this doc-scoped chat isn't wired yet"
      >
        <span className="pb-sousai-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.39 4.84L20 8l-4 3.9.94 5.49L12 14.77 7.06 17.39 8 11.9 4 8l5.61-1.16z" />
          </svg>
        </span>
        <span className="pb-sousai-text">Ask SousAI about this doc…</span>
        <span className="pb-sousai-tag">Coming soon</span>
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

      {/* Surfaces — owner-only build/ops intel. Operators don't see this
          section at all (it's curator vocabulary for a feature nothing
          consumes yet; an onboarding page will use surfaces to auto-pull
          tagged docs later). Same gate as /playbook/admin: bootstrap.isOwner
          (server-computed from the actual signed-in email, never client-
          supplied). The document_surfaces table + data stay intact - this
          is presentation-only suppression, not a data model change. */}
      {isOwner && Array.isArray(surfaces) && surfaces.length > 0 && (
        <div className="pb-slide-section">
          <h3 className="pb-slide-section-title">Surfaces</h3>
          <div className="pb-tag-row">
            {surfaces.map((s) => (
              <span key={s} className="pb-tag pb-tag--surface">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Relationships — each row is a button that swaps the reader to the
          related doc in place (navigateTo pushes onto the reader's nav stack
          and the parent's fetch effect re-runs). The other doc may have no
          source_drive_id; the reader's "No file attached yet" state handles
          that gracefully, so click-through never produces an error or blank
          iframe even on stub docs. */}
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
                  <button
                    type="button"
                    className="pb-rel-link"
                    onClick={() => navigateTo(r.other_id)}
                    aria-label={`Open ${r.other_id} ${r.other_title}`}
                  >
                    <span className="pb-rel-type">{label}:</span>
                    <span className="pb-rel-other">
                      <code className="pb-rel-id">{r.other_id}</code>{" "}
                      {r.other_title}
                    </span>
                    <span className="pb-rel-chevron" aria-hidden="true">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Catalog details — fields with no value are hidden entirely (no wall
          of em-dashes). If every field is empty the whole section is omitted.
          Real values appear automatically as docs get filled in. */}
      {(() => {
        const details = [
          { label: "Owner",          value: doc.owner },
          { label: "Approver",       value: doc.approver },
          { label: "Audience",       value: doc.audience },
          { label: "Classification", value: doc.classification },
          { label: "Effective",      value: doc.effective_date },
          { label: "Last reviewed",  value: doc.last_reviewed },
          { label: "Next review",    value: doc.next_review },
        ].filter((d) => d.value);
        if (details.length === 0) return null;
        return (
          <div className="pb-slide-section">
            <h3 className="pb-slide-section-title">Catalog details</h3>
            {details.map((d) => (
              <div key={d.label} className="pb-footer-meta-row">
                <span>{d.label}</span>
                <strong>{d.value}</strong>
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

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

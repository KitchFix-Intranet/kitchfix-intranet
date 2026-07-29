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
import Link from "next/link";
import {
  CLASS_LABELS,
  CLASS_FAMILY,
  STATUS_COLORS,
  RELATIONSHIP_LABELS_OUT,
  RELATIONSHIP_LABELS_IN,
} from "./_shared";

export default function SlideOverReader({ docId, onClose, isOwner = false, onEdit }) {
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
            onEdit={onEdit}
          />
        ) : null}
      </aside>
    </>
  );
}

function SlideOverContent({ data, reportOpen, setReportOpen, navigateTo, isOwner, onEdit }) {
  const {
    document: doc,
    relationships,
    surfaces,
    content_html,
    content_html_es,
    drive_view_url,
    drive_preview_url,
    drive_view_url_es,
    drive_preview_url_es,
  } = data;
  const status = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
  const classLabel = CLASS_LABELS[doc.doc_class] || doc.doc_class;
  const classFamily = CLASS_FAMILY[doc.doc_class] || "ref";

  // EN/ES language selection - only meaningful when SOMETHING (html OR drive)
  // exists for both languages. Default is "en"; reset back to "en" whenever
  // the reader navigates to a different doc (the back/forward via relationship
  // clicks rebinds doc.id, and we don't want a previous doc's language
  // preference to leak forward).
  const [lang, setLang] = useState("en");
  useEffect(() => { setLang("en"); }, [doc.id]);

  // Phase A3: per-language source resolution. Prefer rendered HTML from
  // document_content (populated by the A4 projection); fall back to the
  // Drive iframe per-language when content_html is missing. The fallback
  // is throwaway code, removed in A7 once every Live doc has a content row.
  const hasEn = !!content_html || !!drive_preview_url;
  const hasEs = !!content_html_es || !!drive_preview_url_es;
  const showLangToggle = hasEn && hasEs;
  const activeLang = showLangToggle
    ? lang
    : (hasEn ? "en" : (hasEs ? "es" : "en"));
  const activeHtml       = activeLang === "es" ? content_html_es      : content_html;
  const activeViewUrl    = activeLang === "es" ? drive_view_url_es    : drive_view_url;
  const activePreviewUrl = activeLang === "es" ? drive_preview_url_es : drive_preview_url;
  const hasContent = !!activeHtml;
  const hasFile = !!activePreviewUrl;
  const hasAny = hasContent || hasFile;

  // A6: the in-place "fullView" expand was a placeholder. The slide-over now
  // hands off to a dedicated full-page route /playbook/d/[docId] for the
  // real reading surface (wider column, full hierarchy, Print/Save PDF).
  // The Drive iframe fallback path keeps "Open in Drive" as its escape
  // hatch; the html-rendered path gets the full-page link.

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
          {!hasAny && <span className="pb-nofile-chip">No file yet</span>}
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

      {/* Reader frame - Phase A3 dual-path:
            - If content_html is present (A4-populated): render the HTML body
              directly. dangerouslySetInnerHTML is OK here because the HTML is
              owner-authored output from our own projection pipeline
              (scripts/content/project-catalog.mjs + lib/md_to_html.mjs), not
              user input. The renderer also escapes user-content at HTML emit
              time. NOT to be used with externally-sourced HTML.
            - Else if drive_preview_url is present: render the Drive iframe
              fallback as before. This branch is removed in A7 once every
              Live doc has a content row.
            - Else: the "No file attached yet" empty state.
          - Keyed on `${doc.id}-${activeLang}-${hasContent}` so swaps between
            html-render and iframe-render also trigger the swap animation. */}
      <div
        className="pb-reader-frame"
        key={`${doc.id}-${activeLang}-${hasContent ? "html" : "drive"}`}
      >
        {hasFile && !hasContent && (
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
        {hasContent ? (
          <div
            className="pb-reader-html"
            dangerouslySetInnerHTML={{ __html: activeHtml }}
          />
        ) : hasFile ? (
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

      {/* Actions - A6:
            - html-rendered path: primary action is "Open full page" - hands
              off to /playbook/d/[docId] for the real reading surface (wider
              column, full hierarchy, Print/Save PDF).
            - Drive iframe path: primary action stays "Open in Drive" pointing
              at the Drive view URL (same as pre-A6).
            - No-file path: disabled "Open in Drive" placeholder. */}
      <div className="pb-slide-actions">
        {hasContent ? (
          // A6 polish-2 #7: open in a new tab so the operator keeps the
          // catalog open while reading (matches the external-link icon's
          // promise, and gives a sane "back to where I was" without losing
          // the slide-over's nav stack). target=_blank + rel=noopener for
          // basic safety.
          <Link
            href={`/playbook/d/${encodeURIComponent(doc.id)}${activeLang === "es" ? "?lang=es" : ""}`}
            className="pb-action pb-action--primary"
            aria-label={`Read full document: ${doc.title} (opens in a new tab)`}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
          >
            Read full document
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 6 }}>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </Link>
        ) : (
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
        )}
        <button
          className="pb-action pb-action--ghost"
          onClick={() => setReportOpen((r) => !r)}
        >
          Report issue
        </button>
        {isOwner && typeof onEdit === "function" && (
          <button
            className="pb-action pb-action--ghost"
            onClick={() => onEdit(doc.id)}
            title="Edit this doc's MDX source"
          >
            Edit MDX
          </button>
        )}
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
        title="SousAI is coming soon - this doc-scoped chat isn't wired yet"
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

      {/* Summary - kept ALWAYS open. The reader opens to content first;
          summary is the closest thing to the body when the iframe / HTML
          renderer has loaded. The collapsible metadata below it is the
          on-demand context. */}
      {doc.summary && (
        <div className="pb-slide-section pb-slide-section--summary">
          <h3 className="pb-slide-section-title">Summary</h3>
          <p className="pb-slide-text">{doc.summary}</p>
        </div>
      )}

      {/* Metadata sections - collapsed by default via native <details>.
          Keyboard-accessible without JS. Operators reading the doc do not
          need the metadata wall; the curator/director who wants it opens it. */}

      {/* Keywords */}
      {Array.isArray(doc.keywords) && doc.keywords.length > 0 && (
        <details className="pb-slide-section pb-slide-section--collapsible">
          <summary className="pb-slide-section-title pb-slide-section-summary">
            Keywords <span className="pb-slide-section-count">{doc.keywords.length}</span>
          </summary>
          <div className="pb-tag-row">
            {doc.keywords.map((kw) => (
              <span key={kw} className="pb-tag">{kw}</span>
            ))}
          </div>
        </details>
      )}

      {/* Surfaces - owner-only build/ops intel. Same gate as /playbook/admin. */}
      {isOwner && Array.isArray(surfaces) && surfaces.length > 0 && (
        <details className="pb-slide-section pb-slide-section--collapsible">
          <summary className="pb-slide-section-title pb-slide-section-summary">
            Surfaces <span className="pb-slide-section-count">{surfaces.length}</span>
          </summary>
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
        </details>
      )}

      {/* Relationships - clicking a row swaps the reader to the related doc
          via navigateTo. The other doc may have no content; the "No file
          attached" state handles that gracefully. */}
      {Array.isArray(relationships) && relationships.length > 0 && (
        <details className="pb-slide-section pb-slide-section--collapsible">
          <summary className="pb-slide-section-title pb-slide-section-summary">
            Relationships <span className="pb-slide-section-count">{relationships.length}</span>
          </summary>
          <ul className="pb-rel-list">
            {relationships.map((r, i) => {
              const label =
                r.direction === "out"
                  ? RELATIONSHIP_LABELS_OUT[r.rel_type] || r.rel_type
                  : RELATIONSHIP_LABELS_IN[r.rel_type] || r.rel_type;
              // TRAIN 2: retired-link degradation. When the target doc's
              // status is Retired, render a non-interactive strikethrough
              // row with a RETIRED outlined pill. Non-navigating on purpose
              // (a Retired doc has nothing useful to open).
              if (r.other_status === "Retired") {
                return (
                  <li key={`${r.rel_type}-${r.other_id}-${i}`} className="pb-rel-item">
                    <span
                      className="pb-rel-retired"
                      aria-label={`${r.other_id} ${r.other_title} - Retired, not navigable`}
                    >
                      <span className="pb-rel-type">{label}:</span>
                      <span className="pb-rel-other">
                        <code className="pb-rel-id">{r.other_id}</code>{" "}
                        {r.other_title}
                      </span>
                      <span className="pb-rel-retired-pill" aria-hidden="true">Retired</span>
                    </span>
                  </li>
                );
              }
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
        </details>
      )}

      {/* Catalog details - fields with no value are hidden entirely. If every
          field is empty the whole section is omitted. */}
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
          <details className="pb-slide-section pb-slide-section--collapsible">
            <summary className="pb-slide-section-title pb-slide-section-summary">
              Catalog details <span className="pb-slide-section-count">{details.length}</span>
            </summary>
            {details.map((d) => (
              <div key={d.label} className="pb-footer-meta-row">
                <span>{d.label}</span>
                <strong>{d.value}</strong>
              </div>
            ))}
          </details>
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

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

export default function SlideOverReader({ docId, onClose }) {
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
  const classFamily = CLASS_FAMILY[doc.doc_class] || "ref";
  const hasFile = !!drive_preview_url;

  return (
    <div className="pb-slide-body">
      {/* Header block */}
      <div className="pb-slide-head-block">
        <div className="pb-slide-class-row">
          <span className={`pb-class-chip pb-class-chip--lg pb-class-chip--${classFamily}`}>
            {classLabel}
          </span>
          {doc.critical && <span className="pb-critical-chip">⚠ Critical</span>}
          {!hasFile && <span className="pb-nofile-chip">No file yet</span>}
        </div>
        <h2 className="pb-slide-title">{doc.title}</h2>
        {doc.card_line && <p className="pb-slide-cardline">{doc.card_line}</p>}
        <div className="pb-slide-meta">
          <span
            className={`pb-status-pill${status.ghost ? " pb-status-pill--ghost" : ""}`}
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

"use client";

// ════════════════════════════════════════════════════════════════════════════
// DocumentFullPageClient · Project OPD · Full-page reader (A6)
// ════════════════════════════════════════════════════════════════════════════
//
// Hands off from SlideOverReader's "Open full page" action. The slide-over
// stays the quick preview; this is the actual reading surface:
//   - Wide centered reading column (~720-840px)
//   - Full doc hierarchy rendered from document_content HTML
//   - Print / Save PDF action (browser print dialog + @media print stylesheet)
//   - Same access gate as the slide-over (the API enforces it server-side;
//     this client only renders whatever the API returns, with a not-found
//     state for 403/404)
//
// Same data fetch as the slide-over: /api/playbook?action=document&id=...
// EN/ES language toggle when both variants are present.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";
import Link from "next/link";
import "../../playbook.css";
import { CLASS_LABELS, CLASS_FAMILY, STATUS_COLORS } from "../../_shared";

const OPERATOR_STATUS_LABEL = { Live: "Ready" };
function operatorStatusLabel(s) {
  return OPERATOR_STATUS_LABEL[s] || s;
}

export default function DocumentFullPageClient({ docId, initialLang = "en" }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lang, setLang] = useState(initialLang);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/playbook?action=document&id=${encodeURIComponent(docId)}`)
      .then((r) => r.json().then((d) => ({ status: r.status, body: d })))
      .then(({ status, body }) => {
        if (cancelled) return;
        if (status === 404 || body.error === "Not found") {
          setError("Not found");
        } else if (body.error) {
          setError(body.error);
        } else {
          setData(body);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  if (loading) {
    return (
      <div className="pb-fullpage-wrap">
        <div className="pb-fullpage-loading">Loading document...</div>
      </div>
    );
  }

  if (error === "Not found") {
    return (
      <div className="pb-fullpage-wrap">
        <div className="pb-fullpage-notfound">
          <h1>Document not found</h1>
          <p>
            <code>{docId}</code> isn't in the catalog, or your account doesn't have access to it.
          </p>
          <Link href="/playbook" className="pb-fullpage-back" prefetch={false}>
            Back to The Playbook
          </Link>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="pb-fullpage-wrap">
        <div className="pb-fullpage-error">
          <h1>Couldn't load this document</h1>
          <p>{error || "No data returned."}</p>
          <Link href="/playbook" className="pb-fullpage-back" prefetch={false}>
            Back to The Playbook
          </Link>
        </div>
      </div>
    );
  }

  const { document: doc, content_html, content_html_es, drive_view_url, drive_view_url_es } = data;
  const hasEn = !!content_html;
  const hasEs = !!content_html_es;
  const showLangToggle = hasEn && hasEs;
  const activeLang = showLangToggle ? lang : hasEn ? "en" : "es";
  const activeHtml = activeLang === "es" ? content_html_es : content_html;
  const activeDriveUrl = activeLang === "es" ? drive_view_url_es : drive_view_url;
  const status = STATUS_COLORS[doc.status] || STATUS_COLORS.Pending;
  const classLabel = CLASS_LABELS[doc.doc_class] || doc.doc_class;
  const classFamily = CLASS_FAMILY[doc.doc_class] || "ref";

  return (
    <div className="pb-fullpage-wrap">
      {/* Top toolbar - hidden in print. Back, lang toggle, print action. */}
      <div className="pb-fullpage-toolbar pb-fullpage-no-print">
        <Link href="/playbook" className="pb-fullpage-back" prefetch={false}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to The Playbook
        </Link>
        <div className="pb-fullpage-actions">
          {showLangToggle && (
            <div className="pb-lang-toggle" role="group" aria-label="Document language">
              <button
                type="button"
                className={`pb-lang-btn${activeLang === "en" ? " pb-lang-btn--on" : ""}`}
                onClick={() => setLang("en")}
                aria-pressed={activeLang === "en"}
              >EN</button>
              <button
                type="button"
                className={`pb-lang-btn${activeLang === "es" ? " pb-lang-btn--on" : ""}`}
                onClick={() => setLang("es")}
                aria-pressed={activeLang === "es"}
              >ES</button>
            </div>
          )}
          <button
            type="button"
            className="pb-fullpage-print"
            onClick={() => window.print()}
            title="Open the browser print dialog. Use 'Save as PDF' to download."
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* Reading column - the body. */}
      <article className="pb-fullpage-article">
        <header className="pb-fullpage-head">
          <div className="pb-fullpage-class-row">
            <span className={`pb-class-chip pb-class-chip--lg pb-class-chip--${classFamily}`}>
              {classLabel}
            </span>
            <span
              className={`pb-status-pill pb-status-pill--lg${status.ghost ? " pb-status-pill--ghost" : ""}`}
              style={{ background: status.bg, color: status.color }}
            >
              {operatorStatusLabel(doc.status)}
            </span>
          </div>
          <h1 className="pb-fullpage-title">{doc.title}</h1>
          {doc.card_line && <p className="pb-fullpage-cardline">{doc.card_line}</p>}
          <div className="pb-fullpage-meta">
            <span className="pb-fullpage-id">{doc.id}</span>
            {doc.version && <span> · v{doc.version}</span>}
            {doc.owner && <span> · {doc.owner}</span>}
            {doc.effective_date && <span> · Effective {doc.effective_date}</span>}
          </div>
        </header>

        {activeHtml ? (
          <div
            className="pb-fullpage-body"
            dangerouslySetInnerHTML={{ __html: activeHtml }}
          />
        ) : activeDriveUrl ? (
          // Drive fallback - on the full-page surface we just link out rather
          // than embed an iframe (the iframe quality is poor at this width and
          // the operator who wants to read the PDF wants the actual viewer).
          <div className="pb-fullpage-drive-fallback pb-fullpage-no-print">
            <p>This document hasn't been re-projected from MDX yet. Open the Drive PDF for the published artifact:</p>
            <a
              href={activeDriveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pb-action pb-action--primary"
            >
              Open in Drive
            </a>
          </div>
        ) : (
          <div className="pb-fullpage-empty">
            <p>This document is catalogued but no body content has been published yet.</p>
          </div>
        )}
      </article>
    </div>
  );
}

"use client";

// ════════════════════════════════════════════════════════════════════════════
// DocumentFullPageClient · Project OPD · Full-page reader
// ════════════════════════════════════════════════════════════════════════════
//
// Hands off from SlideOverReader's "Read full document" action. The slide-over
// stays the quick preview; this is the actual reading surface:
//   - Wide centered reading column (~720-840px) on screen
//   - Full doc hierarchy rendered from document_content HTML
//   - Print / Save PDF action -> browser print dialog + @media print stylesheet
//   - Same access gate as the slide-over (the API enforces it server-side;
//     this client only renders whatever the API returns, with a not-found
//     state for 403/404)
//
// STD-001 v1.2 phase 2 (PR 1/3 - visual core) adds:
//   - A print-only cover page (logo + title + metadata block from frontmatter)
//     that appears as page 1 of the PDF, hidden on screen
//   - SECTION 01-style eyebrow above each H1 in the rendered body
//   - Oswald + Inter type system across both screen and print
//   - The screen header block stays as the screen-equivalent of the cover
//
// Same data fetch as the slide-over: /api/playbook?action=document&id=...
// EN/ES language toggle when both variants are present.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "../../playbook.css";
import { CLASS_LABELS, CLASS_FAMILY, STATUS_COLORS } from "../../_shared";

const OPERATOR_STATUS_LABEL = { Live: "Ready" };
function operatorStatusLabel(s) {
  return OPERATOR_STATUS_LABEL[s] || s;
}

// STD-001 v1.2 §10: any blank or missing metadata field renders an em-dash
// on the cover so docs in build don't gate on backfill.
function orDash(value) {
  if (value === null || value === undefined) return "—";
  const s = String(value).trim();
  return s.length === 0 ? "—" : s;
}

// Compose "Version + effective date" per §10. If only one is present, show
// what we have. If neither, em-dash.
function versionLine(version, effectiveDate) {
  const v = version ? `v${version}` : "";
  const d = effectiveDate ? `Effective ${effectiveDate}` : "";
  if (v && d) return `${v} · ${d}`;
  return orDash(v || d);
}

// Next Review - PG's `next_review` column is projected from MDX
// (last_reviewed + review_interval_months). When null, fall back to
// em-dash; we don't recompute on the client.
function nextReviewLine(nextReview) {
  return orDash(nextReview);
}

// Approval line: approver + approval date. The MDX `approval.approved_date`
// is NOT in PG today (the projection doesn't extract it from the approval
// block). So the approval-date side renders an em-dash for now; once the
// projection extracts approval block fields, this fills in automatically.
function approvalLine(approver, approvedDate) {
  const a = orDash(approver);
  const d = orDash(approvedDate);
  return `${a} · ${d}`;
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

  // PR 1 bridge for the H1 leading-number prefix.
  //
  // Current MDX corpus authors `# 01 Purpose and Scope` as H1s. The CSS
  // counter approach for the SECTION 01 eyebrow would otherwise double-
  // number (SECTION 01 + 01 Purpose and Scope). Strip the leading numeric
  // prefix from each H1's text content after the HTML mounts. PR 2 will
  // strip these prefixes from the MDX source corpus-wide, at which point
  // this strip becomes a no-op and the CSS counter still produces the
  // correct eyebrow numbering.
  const bodyRef = useRef(null);
  const htmlSig =
    lang + (data?.content_html?.length || 0) + (data?.content_html_es?.length || 0);
  useEffect(() => {
    if (!bodyRef.current) return;
    const h1s = bodyRef.current.querySelectorAll("h1");
    const LEADING_NUM_RE = /^\s*\d{1,3}(\.\d+)?\s+/;
    h1s.forEach((h1) => {
      const original = h1.textContent || "";
      const stripped = original.replace(LEADING_NUM_RE, "");
      if (stripped !== original) {
        h1.textContent = stripped;
      }
    });
  }, [htmlSig]);

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
            title="Open the browser print dialog. Use 'Save as PDF' to download. For accurate page numbers, keep print margins set to Default."
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

      {/* Print-only cover page. STD-001 v1.2 §10: metadata is read from
          frontmatter; blanks render as em-dashes. Becomes page 1 of the
          PDF; the body article that follows starts on page 2 (cover has
          page-break-after: always in CSS).
          Hidden on screen via .pb-print-only - the screen keeps its
          existing header block below. */}
      <section className="pb-print-cover pb-print-only" aria-hidden="true">
        <img
          className="pb-print-cover-logo"
          src="/PFS_PrimaryLogo_Navy_Circle.png"
          alt="KitchFix"
        />
        <h1 className="pb-print-cover-title">{orDash(doc.title)}</h1>
        {doc.card_line && <p className="pb-print-cover-sub">{doc.card_line}</p>}
        <div className="pb-print-cover-rule" aria-hidden="true" />
        <dl className="pb-print-cover-meta">
          <div className="pb-print-cover-row">
            <dt>Document ID</dt>
            <dd className="pb-print-cover-id">{orDash(doc.id)}</dd>
          </div>
          <div className="pb-print-cover-row">
            <dt>Title</dt>
            <dd>{orDash(doc.title)}</dd>
          </div>
          <div className="pb-print-cover-row">
            <dt>Version</dt>
            <dd>{versionLine(doc.version, doc.effective_date)}</dd>
          </div>
          <div className="pb-print-cover-row">
            <dt>Owner</dt>
            <dd>{orDash(doc.owner)}</dd>
          </div>
          <div className="pb-print-cover-row">
            <dt>Approved By</dt>
            <dd>{approvalLine(doc.approver, null /* approval.approved_date not projected to PG yet - see follow-up */)}</dd>
          </div>
          <div className="pb-print-cover-row">
            <dt>Next Review</dt>
            <dd>{nextReviewLine(doc.next_review)}</dd>
          </div>
          <div className="pb-print-cover-row">
            <dt>Classification</dt>
            <dd className="pb-print-cover-class">{orDash(doc.classification)}</dd>
          </div>
        </dl>
      </section>

      {/* Reading column - the body. The body article IS what prints starting
          on page 2 after the cover's page-break-after. */}
      <article className="pb-fullpage-article">
        {/* Screen-only header block - the screen equivalent of the cover.
            On print the cover above replaces it. */}
        <header className="pb-fullpage-head pb-fullpage-no-print">
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
            ref={bodyRef}
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

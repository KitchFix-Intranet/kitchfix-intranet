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

import { useEffect, useMemo, useRef, useState } from "react";
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
// block). pr-7-14 projects approval.approved_date to a new documents column;
// once the migration applies + projection runs, the cover renders the real
// date for docs whose MDX carries an approval block.
function approvalLine(approver, approvedDate) {
  const a = orDash(approver);
  const d = orDash(approvedDate);
  return `${a} · ${d}`;
}

// STD-001 v1.2 §12: TOC is generated from H1 section titles only. CHK and
// REF classes get NO TOC regardless of length. Other classes get a TOC
// when the doc carries enough H1 sections to warrant it.
//
// "Over 10 pages" intent is hard to enforce at render time (we don't know
// page count before paint). The pragmatic proxy is H1 count: a doc with 4
// or more H1 sections likely spans enough pages to benefit from a TOC.
// Short docs (FORM, single-section REF, 1-3 H1s) skip it cleanly.
const TOC_MIN_H1 = 4;
const TOC_EXCLUDED_CLASSES = new Set(["CHK", "REF"]);

function shouldShowToc(docClass, h1Count) {
  if (TOC_EXCLUDED_CLASSES.has(docClass)) return false;
  return h1Count >= TOC_MIN_H1;
}

// Slugify H1 text for stable ids (used as TOC anchor targets).
function slugifyHeading(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
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

  // TOC + body H1 wiring.
  //
  // PR 2 used a post-paint useEffect to populate tocEntries from the live
  // DOM, but that meant the TOC <section> wasn't in JSX on the same render
  // the body mounted - it took an extra render after setTocEntries fired.
  // Kevin's print test caught a case where the TOC was missing on PB-002,
  // which the race window explains.
  //
  // PR 3 fix: parse H1s from activeHtml SYNCHRONOUSLY via useMemo so
  // tocEntries is available on the SAME render the body mounts. No race
  // window; the TOC reliably appears for qualifying docs.
  //
  // The useEffect below still runs - it applies the SAME ids derived in
  // the memo to the live DOM H1s so the TOC anchor hrefs match the H1 ids
  // that target-counter() looks up. One source of truth (the memo); two
  // consumers (TOC JSX + live DOM).
  const bodyRef = useRef(null);
  // Resolve activeHtml here so the memo can parse it; the same value gets
  // recomputed below for the body render (the cost is trivial).
  const previewActiveLang = data
    ? data.content_html && data.content_html_es
      ? lang
      : data.content_html
        ? "en"
        : "es"
    : "en";
  const previewActiveHtml = data
    ? previewActiveLang === "es"
      ? data.content_html_es
      : data.content_html
    : null;
  const tocEntries = useMemo(() => {
    if (!previewActiveHtml) return [];
    // Parse every <h1>...</h1> from the rendered HTML. The renderer
    // (md_to_html.mjs) emits clean <h1>text</h1> with no attributes,
    // so a non-greedy match across newlines is reliable.
    const H1_RE = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi;
    const LEADING_NUM_RE = /^\s*\d{1,3}(\.\d+)?\s+/;
    const usedIds = new Set();
    const entries = [];
    let match;
    let idx = 0;
    while ((match = H1_RE.exec(previewActiveHtml)) !== null) {
      // Strip any inner HTML tags (the renderer can emit <em>/<strong>
      // inside h1 if the markdown source has them) and HTML entities.
      const raw = match[1]
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      const stripped = raw.replace(LEADING_NUM_RE, "").trim();
      if (!stripped) {
        idx++;
        continue;
      }
      let id = slugifyHeading(stripped) || `section-${idx + 1}`;
      let dedupId = id;
      let n = 2;
      while (usedIds.has(dedupId)) {
        dedupId = `${id}-${n++}`;
      }
      id = dedupId;
      usedIds.add(id);
      entries.push({ id, title: stripped });
      idx++;
    }
    return entries;
  }, [previewActiveHtml]);

  useEffect(() => {
    if (!bodyRef.current || tocEntries.length === 0) return;
    const h1s = bodyRef.current.querySelectorAll("h1");
    const LEADING_NUM_RE = /^\s*\d{1,3}(\.\d+)?\s+/;
    h1s.forEach((h1, idx) => {
      // Strip a leading numeric prefix if any (defense-in-depth no-op
      // post PR-2 corpus cleanup; catches any new doc that re-introduces
      // a "01 " prefix).
      const original = h1.textContent || "";
      const stripped = original.replace(LEADING_NUM_RE, "");
      if (stripped !== original) {
        h1.textContent = stripped;
      }
      // Apply the SAME id from the memo so the TOC anchors hit them.
      // tocEntries is parsed from the SAME HTML this DOM was set to, so
      // indices align.
      if (tocEntries[idx]) {
        h1.id = tocEntries[idx].id;
      }
    });
  }, [previewActiveHtml, tocEntries]);

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
          src="/PFS_PrimaryLogo_Navy_Vertical.png"
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
            <dd>{approvalLine(doc.approver, doc.approved_date)}</dd>
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

      {/* Print-only Table of Contents. STD-001 v1.2 §12: H1 section titles
          only, with page numbers via CSS target-counter(). Renders only when:
          (a) the doc has at least TOC_MIN_H1 H1 sections AND
          (b) the doc class isn't CHK or REF (those don't get a TOC).
          Hidden on screen via .pb-print-only (same mechanism as the cover).
          The TOC appears between cover (page 1) and body (page 3+).
          Page numbers come from target-counter(attr(href url), page) in CSS
          (see playbook.css). Chrome's print-to-PDF supports this since ~Chrome
          95 (2021). If a future browser regression breaks the numbers, the
          fallback is to drop the .pb-print-toc-page span and ship a plain
          TOC - one CSS edit. */}
      {shouldShowToc(doc.doc_class, tocEntries.length) && (
        <section className="pb-print-toc pb-print-only" aria-hidden="true">
          <h2 className="pb-print-toc-title">Contents</h2>
          <ol className="pb-print-toc-list">
            {tocEntries.map((entry, i) => (
              <li key={entry.id} className="pb-print-toc-row">
                <span className="pb-print-toc-num">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <a className="pb-print-toc-link" href={`#${entry.id}`}>
                  <span className="pb-print-toc-text">{entry.title}</span>
                  <span className="pb-print-toc-dots" aria-hidden="true" />
                  <span className="pb-print-toc-page" />
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Reading column - the body. The body article IS what prints starting
          after the cover (page 1) and TOC (page 2 if present). */}
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

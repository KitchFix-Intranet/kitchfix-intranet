"use client";

// Academy Focus view. Opens INSIDE the shell against a specific
// requirement: paper on the left (document body from
// document_content.html), rail on the right (requirement context +
// About card). Breadcrumb returns to the queue.
//
// Discipline (spec, non-negotiable in PR 8):
//   - Document body via dangerouslySetInnerHTML from
//     document_content.html. Same path the Playbook reader uses.
//     No MDX re-rendering here.
//   - The three requirement steps render with step 3 (Sign) dimmed
//     and NO click handler. That is the approved treatment for
//     not-yet-available; the spec calls it out as "not a dead door."
//   - source_section on the obligation names which sections apply.
//     If present, we name it in the rail; we do NOT attempt to slice
//     the HTML. Naming is enough for this PR.
//   - No sign / attest / certificate / sigrow / sigbtn anywhere.
//   - No completion action. No success screen. No comprehension check
//     UI (that lands with the signature layer).
//   - Skeleton, empty, error states on every list. Error = dashed
//     brick, never blank.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function formatDay(iso) {
  if (!iso) return null;
  try {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return null; }
}
function formatDayShort(iso) {
  if (!iso) return null;
  try {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return null; }
}
function formatUpdated(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return null; }
}

function ContentSkeleton() {
  return (
    <div className="opd-focus-paper opd-focus-paper--skel" aria-busy="true">
      <span className="opd-skel opd-skel--bar opd-skel--w40" />
      <span className="opd-skel opd-skel--bar opd-skel--w60" style={{ marginTop: 10 }} />
      <span className="opd-skel opd-skel--bar opd-skel--w20" style={{ marginTop: 10 }} />
      {[0,1,2,3,4].map((i) => (
        <span key={i} className="opd-skel opd-skel--bar opd-skel--w60" style={{ marginTop: 22 }} />
      ))}
    </div>
  );
}

function DashedBrick({ scope, message, onRetry }) {
  return (
    <div className="opd-brick" role="alert">
      <div className="opd-brick-title">Could not load {scope}</div>
      <p className="opd-brick-body">{message || "Refresh the page or try again in a moment."}</p>
      {onRetry ? (
        <button type="button" className="opd-brick-retry" onClick={onRetry}>Retry</button>
      ) : null}
    </div>
  );
}

export default function AcademyFocus({ requirementId, docId, docTitle, docShelf, onBack }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const isFirstLoadRef = useRef(true);

  const load = useCallback(async function load() {
    if (!isFirstLoadRef.current) {
      setState({ status: "loading", data: null, error: null });
    }
    isFirstLoadRef.current = false;
    try {
      const res = await fetch(
        `/api/academy/document?req=${encodeURIComponent(requirementId)}`,
        { method: "GET", credentials: "same-origin", cache: "no-store" }
      );
      if (!res.ok) {
        let bodyText = "";
        try {
          const b = await res.json();
          bodyText = b?.detail || b?.error || "";
        } catch {}
        setState({
          status: "error",
          data: null,
          error: `HTTP ${res.status}${bodyText ? ` - ${bodyText}` : ""}`,
        });
        return;
      }
      const data = await res.json();
      if (!data || !data.ok) {
        setState({ status: "error", data: null, error: data?.error || "unknown response" });
        return;
      }
      setState({ status: "ready", data, error: null });
    } catch (err) {
      setState({ status: "error", data: null, error: err?.message || String(err) });
    }
  }, [requirementId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) load(); });
    return () => { cancelled = true; };
  }, [load]);

  const doc = state.data?.doc || null;
  const content = state.data?.content_html || null;
  const req = state.data?.requirement || null;
  const ob = state.data?.obligation || null;
  const cyc = state.data?.cycle || null;

  const version = doc?.version || req?.doc_version || null;

  // Section list: split source_section on "; " into a small chip list.
  // Rendered in the rail so the reader knows which sections drive the
  // obligation without needing to guess.
  const sections = useMemo(() => {
    if (!ob?.source_section) return null;
    return String(ob.source_section)
      .split(/;\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }, [ob?.source_section]);

  return (
    <div className="opd-focus" data-room="focus">
      {/* Breadcrumb returns to the queue. Same shell, no route
          change (the shell already owns tab + focus state). */}
      <nav className="opd-crumb" aria-label="Breadcrumb">
        <button type="button" className="opd-crumb-link" onClick={onBack}>Academy</button>
        <span className="opd-crumb-sep" aria-hidden="true">/</span>
        <button type="button" className="opd-crumb-link" onClick={onBack}>Queue</button>
        {docShelf ? (
          <>
            <span className="opd-crumb-sep" aria-hidden="true">/</span>
            <span className="opd-crumb-scope">{docShelf}</span>
          </>
        ) : null}
        <span className="opd-crumb-sep" aria-hidden="true">/</span>
        <span className="opd-crumb-current">{docId}</span>
      </nav>

      <div className="opd-focus-grid">
        {/* ── Left column: paper ──────────────────────────────────── */}
        <article className="opd-card opd-focus-paper" aria-busy={state.status === "loading"}>
          {state.status === "loading" ? (
            <ContentSkeleton />
          ) : state.status === "error" ? (
            <DashedBrick
              scope={`document ${docId || ""}`.trim()}
              message={state.error}
              onRetry={() => load()}
            />
          ) : (
            <>
              <div className="opd-focus-meta">
                <span className="opd-doc-chip">{doc?.id || docId}</span>
                {version ? <span className="opd-focus-meta-item">v{version}</span> : null}
                {doc?.doc_class ? <span className="opd-focus-meta-item">{doc.doc_class}</span> : null}
                {doc?.owner ? <span className="opd-focus-meta-item">Owner: {doc.owner}</span> : null}
                {doc?.status ? (
                  <span className={"opd-focus-meta-status opd-focus-meta-status--" + String(doc.status).toLowerCase()}>
                    {doc.status}
                  </span>
                ) : null}
              </div>
              <h1 className="opd-focus-h1">{doc?.title || docTitle || docId}</h1>
              {doc?.card_line ? <p className="opd-focus-lede">{doc.card_line}</p> : null}
              {content ? (
                // Pre-rendered HTML from document_content, same path the
                // Playbook reader uses. No MDX resolution here.
                <div
                  className="opd-focus-body"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              ) : (
                // Dashed brick inside the paper column - never blank,
                // never a hollow reading pane.
                <div className="opd-brick opd-brick--inline">
                  <div className="opd-brick-title">No rendered content for this document</div>
                  <p className="opd-brick-body">
                    document_content has no English row for <b>{doc?.id || docId}</b>. This
                    document is authored in MDX; the projection has not yet
                    published a rendered copy.
                  </p>
                </div>
              )}
            </>
          )}
        </article>

        {/* ── Right column: rail ──────────────────────────────────── */}
        <aside className="opd-focus-rail" aria-label="Requirement context">
          <div className="opd-card opd-focus-req">
            <span className="opd-k">
              Your requirement{req?.due_date ? ` · due ${formatDayShort(req.due_date)}` : ""}
            </span>
            <ol className="opd-focus-steps" aria-label="Requirement steps">
              <li className="opd-focus-step opd-focus-step--now">
                <span className="opd-focus-step-num" aria-hidden="true">1</span>
                <div>
                  <b className="opd-focus-step-title">Read the sections</b>
                  <span className="opd-focus-step-help">
                    {sections && sections.length > 0
                      ? `${sections.length} section${sections.length === 1 ? "" : "s"} apply to this obligation`
                      : "Read the document end-to-end"}
                  </span>
                </div>
              </li>
              {/* Step 2 dimmed - comprehension checks land with the
                  signature layer, not built in PR 8. Approved treatment
                  per spec: dimmed with copy explaining it, no button. */}
              <li className="opd-focus-step opd-focus-step--dim" aria-disabled="true">
                <span className="opd-focus-step-num" aria-hidden="true">2</span>
                <div>
                  <b className="opd-focus-step-title">Comprehension check</b>
                  <span className="opd-focus-step-help">Not yet available</span>
                </div>
              </li>
              {/* Step 3 dimmed - the signature layer does not exist and
                  academy_attestations has not been created; no button,
                  no signal that clicking here would do anything. */}
              <li className="opd-focus-step opd-focus-step--dim" aria-disabled="true">
                <span className="opd-focus-step-num" aria-hidden="true">3</span>
                <div>
                  <b className="opd-focus-step-title">Sign v{version || "?"}</b>
                  <span className="opd-focus-step-help">Not yet available</span>
                </div>
              </li>
            </ol>
            {sections && sections.length > 0 ? (
              <div className="opd-focus-sections">
                <span className="opd-focus-sections-label">Sections that apply</span>
                <ul className="opd-focus-sections-list">
                  {sections.map((s) => (
                    <li key={s}>&sect; {s}</li>
                  ))}
                </ul>
                <p className="opd-focus-sections-note">
                  The obligation scopes to these sections. The whole document is
                  shown; sections are named here, not sliced.
                </p>
              </div>
            ) : (
              <p className="opd-focus-sections-note">
                The obligation applies to the whole document.
              </p>
            )}
            {cyc ? (
              <div className="opd-focus-cyclechip">
                <span className="opd-k opd-k--tight">Cycle</span>
                <div className="opd-focus-cyclechip-body">
                  <b>{cyc.label}</b>
                  <span>{formatDayShort(cyc.period_start)} - {formatDayShort(cyc.period_end)}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="opd-card opd-focus-about">
            <span className="opd-k">About this document</span>
            <dl className="opd-focus-kv">
              <dt>Version</dt><dd className="opd-focus-kv-mono">{version || "-"}</dd>
              <dt>Updated</dt><dd className="opd-focus-kv-mono">{formatUpdated(doc?.updated_at) || "-"}</dd>
              <dt>Owner</dt><dd>{doc?.owner || "-"}</dd>
              {doc?.approver ? (<><dt>Approver</dt><dd>{doc.approver}</dd></>) : null}
              <dt>Effective</dt><dd className="opd-focus-kv-mono">{formatUpdated(doc?.effective_date) || "-"}</dd>
              <dt>Next review</dt><dd className="opd-focus-kv-mono">{formatUpdated(doc?.next_review) || "-"}</dd>
              {ob?.cadence ? (<><dt>Cadence</dt><dd>{ob.cadence}</dd></>) : null}
              {ob?.type ? (<><dt>Type</dt><dd>{ob.type}</dd></>) : null}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

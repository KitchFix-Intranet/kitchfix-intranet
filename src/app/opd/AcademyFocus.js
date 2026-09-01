"use client";

// Academy Focus view. Read-check-sign flow, inside the shell.
//
// Discipline (spec Section 18, non-negotiable):
//   - Section-at-a-time reveal (18.5). Progress advances on check
//     completion only. NO scroll tracking, NO scroll gating, NO
//     progress bar that fills on scroll.
//   - One check per section, inline at the boundary (18.6). Multiple
//     questions on the same section stack in order. "Quick check" in
//     operator copy - never "assessment", "test", "quiz".
//   - Wrong answer = amber, never red (18.7). Explanation names the
//     line. Back-to-section button scrolls + flashes the section.
//     Attempts recorded honestly, unlimited.
//   - Right answer (18.8) = brief, warm, one button forward. NO
//     celebration; correct is expected.
//   - Signing (18.9) = serif attestation. Button disabled until name
//     matches. Hint states the expected name after a few characters.
//     What will be earned is stated before commit.
//   - Idempotency by client-supplied UUID (spec 7.2). NO optimistic
//     UI - the completion screen only renders after the server
//     confirms the row persisted.
//   - correct_option_id never reaches the client. Grading is
//     server-side, /api/academy/check returns { correct, explanation }
//     for the SELECTED option only.
//   - Zero approved questions is a legitimate state (7 of Kevin's 8
//     modules). Renders 2-step rail (read + sign), no check step.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function formatSignedAt(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return null; }
}

// UUID v4 generator - client-side, for the attestation_id
// idempotency key. Uses crypto.randomUUID when available; falls
// back to a Math.random-based v4 for older browsers. The client
// generates this BEFORE submitting so a retry after a dropped
// connection cannot double-sign (spec 7.2).
function newAttestationId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

// Parse the rendered document_content HTML into a list of sections
// keyed by their H1/H2 heading text. Sections that carry no heading
// (a leading intro block) become an untitled leading section with
// anchor=null. Splits on <h1>...</h1> AND <h2>...</h2> because the
// question anchors mix both tiers (e.g. "Hospitality: What We Mean"
// is an H1, "Mission: Why We Exist" is an H2 under H1 "Our North
// Stars"). Anchor text is decoded from common HTML entities so a
// title like `Best Food, Best Service, Best Hospitality` matches
// its DB-stored counterpart verbatim.
function parseSections(html) {
  if (!html || typeof html !== "string") return [];
  // Match either H1 or H2 with optional attributes. Capture the
  // inner text (may contain HTML entities but not tags in our
  // corpus). Sections split at the OPENING tag; heading text +
  // section body live together in the same chunk so the check card
  // renders after the section content, not after the title.
  const HEADING_RE = /<h[12][^>]*>([^<]*)<\/h[12]>/gi;
  const sections = [];
  let lastIdx = 0;
  let match;
  const boundaries = [];
  while ((match = HEADING_RE.exec(html)) !== null) {
    boundaries.push({ start: match.index, anchor: decodeEntities(match[1] || "").trim() });
  }
  // Leading chunk before the first heading (if any content there).
  if (boundaries.length === 0) {
    return [{ anchor: null, html }];
  }
  if (boundaries[0].start > 0) {
    const lead = html.slice(0, boundaries[0].start).trim();
    if (lead.length > 0) sections.push({ anchor: null, html: lead });
  }
  for (let i = 0; i < boundaries.length; i += 1) {
    const start = boundaries[i].start;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].start : html.length;
    sections.push({ anchor: boundaries[i].anchor, html: html.slice(start, end) });
  }
  return sections;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ─── CheckCard ─────────────────────────────────────────────────────
// One check, inline at the end of its section. Options are shuffled
// server-side per request; the client renders them in the order it
// received. Selecting an option POSTs to /api/academy/check and
// re-reads the server's { correct, explanation }. Wrong answer =
// amber card, explanation, "Show me that line again" button that
// scrolls + flashes the section. Correct = green card, one-line
// affirm, "Continue" button that reveals the next section.
function CheckCard({
  requirementId,
  question,
  sectionAnchor,
  onAnswered,
  onBackToSection,
  onContinue,
  serverCorrect,
}) {
  const [state, setState] = useState({
    status: "idle",         // idle | submitting | wrong | right | error
    selectedId: null,
    explanation: null,
    error: null,
  });
  const wasAlreadyCorrect = !!serverCorrect;

  async function submit(optionId) {
    setState((s) => ({ ...s, status: "submitting", selectedId: optionId, error: null }));
    try {
      const res = await fetch("/api/academy/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ requirementId, questionId: question.question_id, selectedOptionId: optionId }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setState({ status: "error", selectedId: optionId, explanation: null, error: body?.detail || body?.error || `HTTP ${res.status}` });
        return;
      }
      setState({
        status: body.correct ? "right" : "wrong",
        selectedId: optionId,
        explanation: body.explanation || "",
        error: null,
      });
      // Notify parent so it can bump progress + advance reveal on correct.
      if (body.correct && onAnswered) onAnswered(question.question_id);
    } catch (err) {
      setState({ status: "error", selectedId: optionId, explanation: null, error: err?.message || String(err) });
    }
  }

  // A question that was correct on load renders as passed-through
  // rather than a fresh interactive card. Keeps the flow legible on
  // a reload (server-tracked correctness carries).
  if (wasAlreadyCorrect && state.status !== "wrong" && state.status !== "right") {
    return (
      <div className="opd-check opd-check--done" role="status">
        <span className="opd-k">Quick check &middot; passed</span>
        <p className="opd-check-passed-line">{question.prompt}</p>
      </div>
    );
  }

  return (
    <div className="opd-check" data-section={sectionAnchor || ""}>
      <span className="opd-k">Quick check{sectionAnchor ? ` · from ${sectionAnchor}` : ""}</span>
      <h4 className="opd-check-prompt">{question.prompt}</h4>
      <div className="opd-check-options" role="radiogroup" aria-label={question.prompt}>
        {question.options.map((opt) => {
          const isSelected = state.selectedId === opt.id;
          const tone = state.status === "wrong" && isSelected
            ? " opd-check-opt--miss"
            : state.status === "right" && isSelected
              ? " opd-check-opt--right"
              : state.status === "right" && !isSelected
                ? " opd-check-opt--dim"
                : "";
          const disabled = state.status === "submitting" || state.status === "right";
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              className={"opd-check-opt" + tone}
              onClick={() => submit(opt.id)}
            >
              <span className="opd-check-opt-key">{String(opt.id).toUpperCase()}</span>
              <span className="opd-check-opt-text">{opt.text}</span>
            </button>
          );
        })}
      </div>
      {state.status === "wrong" ? (
        <div className="opd-check-fb opd-check-fb--amber" role="alert">
          <b>Not quite - let's look again.</b>
          <p className="opd-check-fb-body">{state.explanation}</p>
          <button
            type="button"
            className="opd-check-back"
            onClick={() => onBackToSection && onBackToSection(sectionAnchor)}
          >
            &uarr; Show me that line again
          </button>
        </div>
      ) : null}
      {state.status === "right" ? (
        <div className="opd-check-fb opd-check-fb--green">
          <b>That is it.</b>
          <p className="opd-check-fb-body">{state.explanation}</p>
          <button
            type="button"
            className="opd-check-cont"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      ) : null}
      {state.status === "error" ? (
        <div className="opd-brick opd-brick--inline" role="alert">
          <div className="opd-brick-title">Could not record your answer</div>
          <p className="opd-brick-body">{state.error}. Your answer was not lost - pick it again to retry.</p>
        </div>
      ) : null}
    </div>
  );
}

// ─── SignBlock ─────────────────────────────────────────────────────
// Serif attestation. Type-name-to-match. Button disabled until match.
// Hint updates on input. What will be earned shown before commit.
// Client-supplied attestation_id for idempotency; no optimistic UI.
function SignBlock({
  requirementId,
  doc,
  version,
  displayName,
  timeSpentSeconds,
  onSigned,
}) {
  const attestationText = useMemo(() => (
    `I, ${displayName}, have read and understood ${doc?.title || doc?.id || "this document"}, version ${version || "?"}, and I will hold this standard at my sites.`
  ), [displayName, doc?.title, doc?.id, version]);

  const attestationIdRef = useRef(newAttestationId());
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState({ state: "idle", error: null });

  const normExpected = String(displayName || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normTyped = String(typed || "").trim().replace(/\s+/g, " ").toLowerCase();
  const matches = normExpected.length > 0 && normTyped === normExpected;

  async function submit() {
    if (!matches) return;
    setStatus({ state: "submitting", error: null });
    try {
      const res = await fetch("/api/academy/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          requirementId,
          attestationId: attestationIdRef.current,
          typedName: typed,
          attestationText,
          timeSpentSeconds,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setStatus({ state: "error", error: body?.detail || body?.error || `HTTP ${res.status}` });
        return;
      }
      // Only surface success once the row is persisted. Same UUID
      // resubmit lands in the idempotent branch and returns the same
      // attestation - onSigned handles either.
      if (onSigned) onSigned(body.attestation);
    } catch (err) {
      setStatus({ state: "error", error: err?.message || String(err) });
    }
  }

  const hint = matches
    ? "Ready."
    : typed.trim().length >= 3
      ? <>Type it exactly as it appears on your account: <b>{displayName}</b></>
      : "Your typed name must match your account.";

  return (
    <div className="opd-sign">
      <span className="opd-k">Attestation</span>
      <p className="opd-sign-text">{attestationText}</p>
      <div className="opd-sign-row">
        <input
          type="text"
          className="opd-sign-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Type your full name"
          autoComplete="off"
          spellCheck="false"
          disabled={status.state === "submitting"}
          aria-label="Type your full name to sign"
        />
        <button
          type="button"
          className={"opd-sign-btn" + (matches ? " opd-sign-btn--ready" : "")}
          disabled={!matches || status.state === "submitting"}
          onClick={submit}
        >
          {status.state === "submitting" ? "Signing" : "Sign"}
        </button>
      </div>
      <p className="opd-sign-hint">{hint}</p>
      <div className="opd-sign-earn">
        <div className="opd-sign-earn-glyph" aria-hidden="true">&#127942;</div>
        <div>
          <b>You will earn: {doc?.title || doc?.id}</b>
          <span>Certificate issued on signing.</span>
        </div>
      </div>
      {status.state === "error" ? (
        <div className="opd-brick opd-brick--inline" role="alert" style={{ marginTop: 14 }}>
          <div className="opd-brick-title">Could not record your signature</div>
          <p className="opd-brick-body">{status.error}. Nothing was recorded - try again.</p>
        </div>
      ) : null}
    </div>
  );
}

// ─── CompletionScreen ──────────────────────────────────────────────
// Shown after successful sign OR when the module was already signed
// on load. Real certificate serial, honest attempt count + time,
// credential lit, next-module offered. NO celebration animation
// beyond a single entrance transition on the seal.
function CompletionScreen({ doc, version, attestation, onBack }) {
  const cert = attestation?.certificate_serial || "";
  const attempts = attestation?.attempts_count ?? 0;
  const timeSec = attestation?.time_spent_seconds ?? 0;
  const minutes = timeSec > 0 ? Math.max(1, Math.round(timeSec / 60)) : null;

  return (
    <div className="opd-focus-done">
      <div className="opd-cert">
        <div className="opd-cert-top">
          <div className="opd-cert-seal" aria-hidden="true">&#127942;</div>
          <h2 className="opd-cert-title">{doc?.title || doc?.id}</h2>
          <div className="opd-cert-sub">
            {doc?.doc_class ? `${doc.doc_class} · ` : ""}v{version || "?"} · signed
          </div>
          <div className="opd-cert-serial">CERTIFICATE {cert}</div>
        </div>
        <div className="opd-cert-body">
          <div className="opd-cert-line">
            <span className="opd-cert-line-k">Signed by</span>
            <span className="opd-cert-line-v">{attestation?.typed_name || ""}</span>
          </div>
          <div className="opd-cert-line">
            <span className="opd-cert-line-k">Signed at</span>
            <span className="opd-cert-line-v num">{formatSignedAt(attestation?.signed_at) || ""}</span>
          </div>
          <div className="opd-cert-line">
            <span className="opd-cert-line-k">Version</span>
            <span className="opd-cert-line-v num">{version || "?"}</span>
          </div>
          <div className="opd-cert-line">
            <span className="opd-cert-line-k">Check</span>
            <span className="opd-cert-line-v num">
              passed &middot; {attempts} attempt{attempts === 1 ? "" : "s"}
            </span>
          </div>
          {minutes != null ? (
            <div className="opd-cert-line">
              <span className="opd-cert-line-k">Time</span>
              <span className="opd-cert-line-v num">{minutes} min</span>
            </div>
          ) : null}
        </div>
      </div>
      <button type="button" className="opd-focus-done-back" onClick={onBack}>
        Back to Academy &rsaquo;
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════
export default function AcademyFocus({ requirementId, docId, docTitle, docShelf, onBack, onSigned }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const isFirstLoadRef = useRef(true);
  const startTimeRef = useRef(Date.now());

  const load = useCallback(async function load() {
    if (!isFirstLoadRef.current) {
      setState({ status: "loading", data: null, error: null });
    }
    isFirstLoadRef.current = false;
    startTimeRef.current = Date.now();
    try {
      const res = await fetch(`/api/academy/module/${encodeURIComponent(requirementId)}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        let bodyText = "";
        try {
          const b = await res.json();
          bodyText = b?.detail || b?.error || "";
        } catch {}
        setState({ status: "error", data: null, error: `HTTP ${res.status}${bodyText ? ` - ${bodyText}` : ""}` });
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
  const questions = state.data?.questions || [];
  const progress = state.data?.progress || null;
  const attestation = state.data?.attestation || null;
  const viewer = state.data?.viewer || null;

  const version = doc?.version || req?.doc_version || null;

  // Parse HTML into sections keyed by heading text.
  const parsedSections = useMemo(() => parseSections(content), [content]);

  // Group approved questions by section_anchor.
  const questionsByAnchor = useMemo(() => {
    const m = new Map();
    for (const q of questions) {
      const key = String(q.section_anchor || "").trim();
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(q);
    }
    return m;
  }, [questions]);

  // ── Reveal state (spec 18.5: section-at-a-time; progress advances
  //    on check completion only). Starts at 1 (only first section
  //    visible). On correct check completion for a section's LAST
  //    question, revealedCount bumps by 1. Sections with no questions
  //    auto-advance via a Continue button.
  //
  // Initial value: if the module was already signed (attestation
  // present on load), reveal everything so the operator can review.
  // If there are prior correct attempts, reveal enough sections to
  // cover those checks so the reader lands where they left off.
  const initialReveal = useMemo(() => {
    if (attestation) return parsedSections.length;
    const correct = new Set(progress?.all_correct_ids || []);
    let n = 1;
    for (let i = 0; i < parsedSections.length; i += 1) {
      const anchor = parsedSections[i].anchor || "";
      const qs = questionsByAnchor.get(anchor) || [];
      // Section i is "cleared" if all its questions have >=1 correct.
      const cleared = qs.length === 0 || qs.every((q) => correct.has(q.question_id));
      if (cleared) n = Math.max(n, i + 2); else break;
    }
    return Math.min(n, parsedSections.length);
  }, [attestation, parsedSections, progress, questionsByAnchor]);

  const [revealCount, setRevealCount] = useState(initialReveal);
  const [signedAttestation, setSignedAttestation] = useState(attestation);

  // Sync reveal when data loads.
  useEffect(() => {
    setRevealCount(initialReveal);
    setSignedAttestation(attestation);
  }, [initialReveal, attestation]);

  // Correct-question set, mutable as the user answers.
  const [correctIds, setCorrectIds] = useState(() => new Set(progress?.all_correct_ids || []));
  useEffect(() => {
    setCorrectIds(new Set(progress?.all_correct_ids || []));
  }, [progress]);

  // ── Sign-ready gate. Server tracked this via progress.ready_to_
  //    sign at load, but we also compute it locally so the sign block
  //    appears immediately after the last correct answer without
  //    re-fetching. Both must be true; server-side is the authoritative
  //    gate on POST /api/academy/sign.
  const questionIds = questions.map((q) => q.question_id);
  const localReadyToSign = questionIds.length === 0 || questionIds.every((id) => correctIds.has(id));

  const flashRef = useRef(null);
  const scrollToSection = useCallback((anchor) => {
    if (!anchor) return;
    const el = document.querySelector(`[data-section-anchor="${CSS.escape(String(anchor))}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Re-trigger the flash animation.
    el.classList.remove("opd-focus-section--flash");
    // Force reflow so the animation restarts.
    void el.offsetWidth;
    el.classList.add("opd-focus-section--flash");
  }, []);

  const onCheckAnswered = useCallback((questionId) => {
    setCorrectIds((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });
  }, []);

  const onContinueToNextSection = useCallback(() => {
    setRevealCount((n) => Math.min(n + 1, parsedSections.length));
    // Scroll the newly revealed section into view after paint.
    setTimeout(() => {
      const els = document.querySelectorAll(".opd-focus-section");
      const last = els[els.length - 1];
      if (last) last.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, [parsedSections.length]);

  const onSignedInternal = useCallback((att) => {
    setSignedAttestation(att);
    // Bubble up so the room can invalidate its cache + re-render
    // standing / queue / credential wall.
    if (onSigned) onSigned(att);
    // Scroll to the top of the completion screen.
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 60);
  }, [onSigned]);

  // Time spent, client-side. Reset on load. Sent on sign as a
  // fallback signal alongside the server's progress accumulator.
  const timeSpentSeconds = () => Math.round((Date.now() - startTimeRef.current) / 1000);

  // ── COMPLETION SCREEN ──────────────────────────────────────────
  if (signedAttestation) {
    return (
      <div className="opd-focus" data-room="focus-done">
        <nav className="opd-crumb" aria-label="Breadcrumb">
          <button type="button" className="opd-crumb-link" onClick={onBack}>Academy</button>
          <span className="opd-crumb-sep" aria-hidden="true">/</span>
          <button type="button" className="opd-crumb-link" onClick={onBack}>Queue</button>
          <span className="opd-crumb-sep" aria-hidden="true">/</span>
          <span className="opd-crumb-current">{docId}</span>
        </nav>
        <CompletionScreen
          doc={doc}
          version={version}
          attestation={signedAttestation}
          onBack={onBack}
        />
      </div>
    );
  }

  // ── READ + CHECK + SIGN ────────────────────────────────────────
  // Time-remaining estimate for the rail: est_minutes minus a rough
  // proportion for revealed sections. Kept honest with a "~" prefix.
  const totalSections = parsedSections.length;
  const estMinutes = req?.est_minutes || ob?.est_minutes || 0;
  const proportionRead = totalSections > 0 ? Math.min(1, (revealCount - 1) / Math.max(1, totalSections - 1)) : 0;
  const minutesLeft = Math.max(0, Math.round(estMinutes * (1 - proportionRead)));

  const stepsCount = questions.length === 0 ? 2 : 3;
  const stepNow = signedAttestation
    ? stepsCount
    : localReadyToSign
      ? stepsCount
      : questions.length === 0
        ? 1
        : correctIds.size > 0 ? 2 : 1;

  return (
    <div className="opd-focus" data-room="focus">
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
        <article className="opd-card opd-focus-paper" aria-busy={state.status === "loading"}>
          {state.status === "loading" ? (
            <div className="opd-focus-paper" aria-busy="true">
              <span className="opd-skel opd-skel--bar opd-skel--w40" />
              <span className="opd-skel opd-skel--bar opd-skel--w60" style={{ marginTop: 10 }} />
              {[0,1,2,3].map((i) => (
                <span key={i} className="opd-skel opd-skel--bar opd-skel--w60" style={{ marginTop: 22 }} />
              ))}
            </div>
          ) : state.status === "error" ? (
            <DashedBrick scope={`module ${docId || ""}`.trim()} message={state.error} onRetry={() => load()} />
          ) : (
            <>
              <div className="opd-focus-meta">
                <span className="opd-doc-chip">{doc?.id || docId}</span>
                {version ? <span className="opd-focus-meta-item">v{version}</span> : null}
                {ob?.cadence ? <span className="opd-focus-meta-item">{ob.cadence}</span> : null}
                {doc?.owner ? <span className="opd-focus-meta-item">Owner: {doc.owner}</span> : null}
              </div>
              <h1 className="opd-focus-h1">{doc?.title || docTitle || docId}</h1>
              {doc?.card_line ? <p className="opd-focus-lede">{doc.card_line}</p> : null}

              {parsedSections.length === 0 ? (
                <div className="opd-brick opd-brick--inline">
                  <div className="opd-brick-title">No rendered content for this document</div>
                  <p className="opd-brick-body">
                    document_content has no English row for <b>{doc?.id || docId}</b>.
                  </p>
                </div>
              ) : (
                parsedSections.slice(0, revealCount).map((sec, i) => {
                  const anchor = sec.anchor || "";
                  const qs = questionsByAnchor.get(anchor) || [];
                  const isLastRevealed = i === revealCount - 1;
                  const sectionCleared = qs.length === 0 || qs.every((q) => correctIds.has(q.question_id));
                  const hasNextSection = i + 1 < parsedSections.length;
                  return (
                    <section
                      key={`${anchor}-${i}`}
                      className="opd-focus-section"
                      data-section-anchor={anchor}
                    >
                      <div
                        className="opd-focus-body"
                        dangerouslySetInnerHTML={{ __html: sec.html }}
                      />
                      {/* Check cards inline at the end of each section
                          that carries approved questions. Sequential:
                          first uncleared question renders as
                          interactive; already-correct earlier ones
                          render as done. Later ones do not render
                          until the previous is cleared. */}
                      {qs.length > 0 ? (
                        (() => {
                          // Show all cleared questions as done, plus the
                          // first uncleared question as active.
                          const rendered = [];
                          let sawActive = false;
                          for (const q of qs) {
                            const done = correctIds.has(q.question_id);
                            if (done) {
                              rendered.push(
                                <CheckCard
                                  key={q.question_id}
                                  requirementId={requirementId}
                                  question={q}
                                  sectionAnchor={anchor}
                                  serverCorrect={true}
                                  onAnswered={onCheckAnswered}
                                  onBackToSection={scrollToSection}
                                  onContinue={() => {}}
                                />
                              );
                              continue;
                            }
                            if (!sawActive) {
                              sawActive = true;
                              const isLastQuestionInSection =
                                qs.filter((qq) => !correctIds.has(qq.question_id)).length === 1;
                              rendered.push(
                                <CheckCard
                                  key={q.question_id}
                                  requirementId={requirementId}
                                  question={q}
                                  sectionAnchor={anchor}
                                  serverCorrect={false}
                                  onAnswered={onCheckAnswered}
                                  onBackToSection={scrollToSection}
                                  onContinue={
                                    isLastQuestionInSection && hasNextSection
                                      ? onContinueToNextSection
                                      : () => { /* stays on this section for the next check */ }
                                  }
                                />
                              );
                            }
                          }
                          return rendered;
                        })()
                      ) : null}
                      {/* Sections without a check auto-advance: show a
                          small Continue button if this is the last
                          revealed section and it is cleared, and there
                          are more sections to reveal. */}
                      {isLastRevealed && qs.length === 0 && sectionCleared && hasNextSection ? (
                        <div className="opd-focus-continue">
                          <button
                            type="button"
                            className="opd-focus-continue-btn"
                            onClick={onContinueToNextSection}
                          >
                            Continue &rsaquo;
                          </button>
                        </div>
                      ) : null}
                    </section>
                  );
                })
              )}

              {/* Sign block: appears when all sections are revealed AND
                  all approved questions are correct (or the module has
                  zero questions). */}
              {parsedSections.length > 0
                && revealCount >= parsedSections.length
                && localReadyToSign
                && viewer?.displayName ? (
                <SignBlock
                  requirementId={requirementId}
                  doc={doc}
                  version={version}
                  displayName={viewer.displayName}
                  timeSpentSeconds={timeSpentSeconds()}
                  onSigned={onSignedInternal}
                />
              ) : null}
            </>
          )}
        </article>

        {/* ── Rail ────────────────────────────────────────────────── */}
        <aside className="opd-focus-rail" aria-label="Requirement context">
          <div className="opd-card opd-focus-timeleft" aria-live="polite">
            <b className="num">~{minutesLeft}</b>
            <span>{minutesLeft === 1 ? "minute left in this one" : "minutes left in this one"}</span>
          </div>
          <div className="opd-card opd-focus-req">
            <span className="opd-k">Your steps</span>
            <ol className="opd-focus-steps" aria-label="Requirement steps">
              <li className={"opd-focus-step" + (stepNow > 1 ? " opd-focus-step--done" : " opd-focus-step--now")}>
                <span className="opd-focus-step-num" aria-hidden="true">{stepNow > 1 ? "✓" : "1"}</span>
                <div>
                  <b className="opd-focus-step-title">Read {parsedSections.length === 1 ? "the document" : `${parsedSections.length} sections`}</b>
                  <span className="opd-focus-step-help">{estMinutes ? `About ${estMinutes} min in all` : "Take your time"}</span>
                </div>
              </li>
              {questions.length > 0 ? (
                <li className={"opd-focus-step" + (stepNow > 2 ? " opd-focus-step--done" : stepNow === 2 ? " opd-focus-step--now" : " opd-focus-step--dim")}>
                  <span className="opd-focus-step-num" aria-hidden="true">{stepNow > 2 ? "✓" : "2"}</span>
                  <div>
                    <b className="opd-focus-step-title">Quick check{questions.length > 1 ? "s" : ""}</b>
                    <span className="opd-focus-step-help">{correctIds.size} of {questions.length} passed</span>
                  </div>
                </li>
              ) : null}
              <li className={"opd-focus-step" + (stepNow >= stepsCount ? " opd-focus-step--now" : " opd-focus-step--dim")}>
                <span className="opd-focus-step-num" aria-hidden="true">{stepsCount}</span>
                <div>
                  <b className="opd-focus-step-title">Sign v{version || "?"}</b>
                  <span className="opd-focus-step-help">Type your name, done</span>
                </div>
              </li>
            </ol>
          </div>
          <div className="opd-card opd-focus-norush">
            <span className="opd-k">No rush</span>
            <p className="opd-focus-norush-body">Your place is saved. Nothing is submitted until you sign.</p>
          </div>
          {cyc ? (
            <div className="opd-card opd-focus-cyclechip">
              <span className="opd-k opd-k--tight">Cycle</span>
              <div className="opd-focus-cyclechip-body">
                <b>{cyc.label}</b>
                <span>{formatDayShort(cyc.period_start)} - {formatDayShort(cyc.period_end)}</span>
              </div>
            </div>
          ) : null}
          <div className="opd-card opd-focus-about">
            <span className="opd-k">About this document</span>
            <dl className="opd-focus-kv">
              <dt>Version</dt><dd className="opd-focus-kv-mono">{version || "-"}</dd>
              <dt>Updated</dt><dd className="opd-focus-kv-mono">{formatUpdated(doc?.updated_at) || "-"}</dd>
              <dt>Owner</dt><dd>{doc?.owner || "-"}</dd>
              {doc?.next_review ? (<><dt>Next review</dt><dd className="opd-focus-kv-mono">{formatUpdated(doc?.next_review)}</dd></>) : null}
              {ob?.cadence ? (<><dt>Cadence</dt><dd>{ob.cadence}</dd></>) : null}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

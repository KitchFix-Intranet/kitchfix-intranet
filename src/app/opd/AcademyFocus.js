"use client";

// Academy Focus view - stepper.
//
// Spec 18.5 (amended by the module-stepper PR): a module is a
// sequence of steps, not a document with checks appended. ONE
// section is on screen at a time and the page does not grow as
// the person progresses. The server-side step-boundary algorithm
// (WORDS_PER_STEP = 600 = 3 min at 200 wpm) determines the step
// list; the client renders one step card at a time.
//
// Discipline
// ──────────
//   - Step-at-a-time reveal. The page NEVER grows.
//   - Checks live inside their step, at the section boundary.
//     Continue is disabled until the check is passed. Two checks
//     in a step come one at a time; button reads "Next check"
//     between them.
//   - Wrong answer = amber (never red). "Show me that line"
//     flashes the anchor WITHIN the current step - no scrolling
//     through a document.
//   - Right answer = brief warm confirmation, options LOCKED,
//     Continue enabled. No celebration on individual correct.
//   - Save & exit persists progress; resume mounts at the
//     furthest step reached (spec A1).
//   - Keyboard: Enter/Right advances, Left goes back, 1/2 select
//     option. Ignored inside text inputs (signature field
//     unaffected).
//   - Below 900px the rail collapses to a single line + toggle.
//   - Sign step: recap + serif attestation + type-to-match name.
//   - Accessibility: focus moves to step heading on advance;
//     feedback panels are aria-live=polite; options are real
//     buttons with aria-pressed; step rail is a list with
//     aria-current on the active step.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Constants + helpers ──────────────────────────────────────────
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

// ─── CheckCard ────────────────────────────────────────────────────
// One question, inline at the end of its step's section content.
// D3: options render with a POSITIONAL letter (A/B by index), not
//     the option id. Grading is by id server-side.
// D4: only the ACTIVE question in a step renders as interactive;
//     later ones do not appear until the active one is passed.
// D5: once passed, options LOCK - no further selection.
function CheckCard({
  requirementId,
  question,
  qIndex,
  qCount,
  alreadyCorrect,
  onCorrect,
  onBackToSection,
}) {
  const [state, setState] = useState({
    status: alreadyCorrect ? "right" : "idle",
    selectedId: null,
    explanation: null,
    error: null,
  });
  const [autoLocked] = useState(alreadyCorrect);

  const disabled = state.status === "submitting" || state.status === "right" || autoLocked;
  const feedbackRef = useRef(null);

  async function submit(optionId) {
    if (disabled) return;
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
      if (body.correct && onCorrect) onCorrect(question.question_id);
    } catch (err) {
      setState({ status: "error", selectedId: optionId, explanation: null, error: err?.message || String(err) });
    }
  }

  // If already-correct on mount (resume scenario), show the passed
  // treatment without re-fetching. The client had this info from
  // /module.progress.all_correct_ids.
  if (autoLocked && state.status === "right" && !state.explanation) {
    return (
      <div className="opd-check opd-check--done" role="status">
        <span className="opd-k">Quick check {qIndex + 1} of {qCount} · passed</span>
        <p className="opd-check-passed-line">{question.prompt}</p>
      </div>
    );
  }

  return (
    <div className="opd-check" data-question-key={question.question_key}>
      <span className="opd-k">Quick check {qIndex + 1} of {qCount}</span>
      <h4 className="opd-check-prompt">{question.prompt}</h4>
      <div className="opd-check-options" role="group" aria-label={question.prompt}>
        {question.options.map((opt, idx) => {
          const isSelected = state.selectedId === opt.id;
          // D3: display letter is POSITIONAL (A/B by index).
          const letter = String.fromCharCode(65 + idx);
          const tone = state.status === "wrong" && isSelected
            ? " opd-check-opt--miss"
            : state.status === "right" && isSelected
              ? " opd-check-opt--right"
              : state.status === "right" && !isSelected
                ? " opd-check-opt--dim opd-check-opt--locked"
                : "";
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              className={"opd-check-opt" + tone}
              onClick={() => submit(opt.id)}
              data-position={letter}
              data-option-id={opt.id}
            >
              <span className="opd-check-opt-key">{letter}</span>
              <span className="opd-check-opt-text">{opt.text}</span>
            </button>
          );
        })}
      </div>
      <div ref={feedbackRef} aria-live="polite" aria-atomic="true">
        {state.status === "wrong" ? (
          <div className="opd-check-fb opd-check-fb--amber" role="alert">
            <span className="opd-check-fb-verdict">Not quite - let us look again.</span>
            <p className="opd-check-fb-body">{state.explanation}</p>
            <button
              type="button"
              className="opd-check-back"
              onClick={() => onBackToSection && onBackToSection()}
            >
              &uarr; Show me that line
            </button>
          </div>
        ) : null}
        {state.status === "right" ? (
          <div className="opd-check-fb opd-check-fb--green">
            <span className="opd-check-fb-verdict">That is it.</span>
            <p className="opd-check-fb-body">{state.explanation}</p>
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className="opd-brick opd-brick--inline" role="alert">
            <div className="opd-brick-title">Could not record your answer</div>
            <p className="opd-brick-body">{state.error}. Your answer was not lost - pick it again to retry.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── SignBlock ────────────────────────────────────────────────────
// Serif attestation with type-to-match name. Unchanged behavior
// from the signature-flow PR; the sign step is the LAST step in the
// stepper. Recap + earn block sit above.
function SignBlock({
  requirementId,
  doc,
  version,
  displayName,
  timeSpentSeconds,
  stepsCount,
  totalQuestionsPassed,
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

  const minutes = timeSpentSeconds > 0 ? Math.max(1, Math.round(timeSpentSeconds / 60)) : null;

  return (
    <>
      <div className="opd-step-recap">
        <div className="opd-step-recap-tile">
          <b className="num">{stepsCount}</b>
          <span>SECTIONS READ</span>
        </div>
        <div className="opd-step-recap-tile">
          <b className="num">{totalQuestionsPassed}</b>
          <span>CHECK{totalQuestionsPassed === 1 ? "" : "S"} PASSED</span>
        </div>
        {minutes != null ? (
          <div className="opd-step-recap-tile">
            <b className="num">{minutes}</b>
            <span>MINUTE{minutes === 1 ? "" : "S"}</span>
          </div>
        ) : null}
      </div>
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
    </>
  );
}

// ─── Completion cert (post-sign) ──────────────────────────────────
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
// Main component - the stepper
// ═══════════════════════════════════════════════════════════════════
export default function AcademyFocus({ requirementId, docId, docTitle, docShelf, partNumber, totalParts, onBack, onSigned }) {
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
        try { const b = await res.json(); bodyText = b?.detail || b?.error || ""; } catch {}
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
  const req = state.data?.requirement || null;
  const ob = state.data?.obligation || null;
  const cyc = state.data?.cycle || null;
  const steps = state.data?.steps || [];
  const questions = state.data?.questions || [];
  const progress = state.data?.progress || null;
  const initialAttestation = state.data?.attestation || null;
  const viewer = state.data?.viewer || null;

  const version = doc?.version || req?.doc_version || null;

  // Map question_id -> question object (for step lookup).
  const questionsById = useMemo(() => {
    const m = new Map();
    for (const q of questions) m.set(q.question_id, q);
    return m;
  }, [questions]);

  // ─── Local step state ────────────────────────────────────────────
  // currentStepIdx: which step is on screen. Sign step is at
  // steps.length (one past the last content step). Signed
  // completion cert shows when signedAttestation is set.
  const initialStepIdx = progress?.furthest_step_index ?? 0;
  const [currentStepIdx, setCurrentStepIdx] = useState(initialStepIdx);
  const [signedAttestation, setSignedAttestation] = useState(initialAttestation);

  // Correct-answer set (mutable as user progresses). Seeded from
  // server-tracked all_correct_ids.
  const [correctIds, setCorrectIds] = useState(() => new Set(progress?.all_correct_ids || []));

  // Sync when data loads (resume mounts at furthest).
  useEffect(() => {
    setCurrentStepIdx(progress?.furthest_step_index ?? 0);
    setCorrectIds(new Set(progress?.all_correct_ids || []));
    setSignedAttestation(initialAttestation);
  }, [progress?.furthest_step_index, progress?.all_correct_ids, initialAttestation]);

  // Sections seen: the union of everything we have visited. Seeded
  // from server, extended as the user advances. POSTed to /progress
  // on step advance + save-and-exit.
  const [sectionsSeen, setSectionsSeen] = useState(() => new Set(progress?.sections_seen || []));
  useEffect(() => {
    setSectionsSeen(new Set(progress?.sections_seen || []));
  }, [progress?.sections_seen]);

  // ─── Save & Exit + progress push ───────────────────────────────
  const timeSpentSeconds = () => {
    const clientDelta = Math.round((Date.now() - startTimeRef.current) / 1000);
    return Math.max(progress?.time_spent_seconds ?? 0, clientDelta);
  };
  const pushProgress = useCallback(async (extraKey) => {
    const merged = new Set(sectionsSeen);
    if (extraKey) merged.add(extraKey);
    try {
      await fetch("/api/academy/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          requirementId,
          sectionsSeen: [...merged],
          timeSpentSeconds: timeSpentSeconds(),
        }),
      });
    } catch {
      // Best-effort. Failure does not block the user; the next
      // /module fetch reflects whatever landed.
    }
    if (extraKey) setSectionsSeen(merged);
  }, [requirementId, sectionsSeen, progress?.time_spent_seconds]);

  // ─── Per-step derived state ────────────────────────────────────
  const isSignStep = currentStepIdx >= steps.length;
  const currentStep = isSignStep ? null : steps[currentStepIdx];
  const currentQuestions = useMemo(() => {
    if (!currentStep) return [];
    return (currentStep.questionIds || []).map((id) => questionsById.get(id)).filter(Boolean);
  }, [currentStep, questionsById]);
  // The first uncleared question in this step (only one visible at
  // a time, D4). If all cleared or no questions, activeQIndex = -1
  // and the "Continue" button is enabled.
  const activeQIndex = currentQuestions.findIndex((q) => !correctIds.has(q.question_id));
  const stepCleared = activeQIndex === -1;

  // ─── Anchor flash within the current step ─────────────────────
  // D-flash: the wrong-answer "Show me that line" scrolls + flashes
  // an anchor WITHIN the current step card (not the whole doc).
  const stepHeadingRef = useRef(null);
  const stepBodyRef = useRef(null);
  const flashAnchor = useCallback(() => {
    const body = stepBodyRef.current;
    if (!body) return;
    // Prefer explicit <div class="anchor">; fall back to the
    // step's first blockquote or the step body itself.
    const anchor = body.querySelector(".anchor, blockquote, [data-anchor]") || body;
    anchor.scrollIntoView({ behavior: "smooth", block: "center" });
    anchor.classList.remove("opd-step-anchor-flash");
    // Reflow so the animation restarts.
    void anchor.offsetWidth;
    anchor.classList.add("opd-step-anchor-flash");
  }, []);

  // ─── Advance / back ────────────────────────────────────────────
  const goToStep = useCallback((i) => {
    if (i < 0 || i > steps.length) return;
    setCurrentStepIdx(i);
    // Focus the step heading on advance (accessibility A4).
    setTimeout(() => {
      const h = document.querySelector("[data-step-heading]");
      if (h && typeof h.focus === "function") h.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 60);
  }, [steps.length]);

  const advanceStep = useCallback(async () => {
    // Mark the current step's key as seen and push progress.
    if (currentStep) {
      await pushProgress(currentStep.key);
    }
    goToStep(currentStepIdx + 1);
  }, [currentStep, currentStepIdx, pushProgress, goToStep]);

  const onCorrect = useCallback((questionId) => {
    setCorrectIds((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });
  }, []);

  const onSignedInternal = useCallback((att) => {
    setSignedAttestation(att);
    if (onSigned) onSigned(att);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 60);
  }, [onSigned]);

  const saveAndExit = useCallback(async () => {
    // Push whatever we have; do not mark a new key seen (user is
    // leaving on a step they may not yet have passed).
    await pushProgress(null);
    if (onBack) onBack();
  }, [pushProgress, onBack]);

  // ─── Mobile rail collapse ─────────────────────────────────────
  const [mobileRailOpen, setMobileRailOpen] = useState(false);

  // ─── Keyboard navigation (A2) ─────────────────────────────────
  const advanceRef = useRef({ advance: null, back: null, submitOpt: null });
  useEffect(() => {
    advanceRef.current = {
      advance: async () => {
        if (isSignStep) return;
        if (!stepCleared) return;
        await advanceStep();
      },
      back: () => {
        if (currentStepIdx > 0) goToStep(currentStepIdx - 1);
      },
      submitOpt: (idx) => {
        if (isSignStep) return;
        const opts = document.querySelectorAll(".opd-check-opt");
        const target = opts[idx];
        if (target && !target.disabled) target.click();
      },
    };
  }, [isSignStep, stepCleared, currentStepIdx, advanceStep, goToStep]);
  useEffect(() => {
    function onKey(e) {
      // Skip while focus is in a text input - signature field must
      // accept space, backspace, Enter without triggering advance.
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      const a = advanceRef.current;
      if (e.key === "Enter" || e.key === "ArrowRight") {
        a.advance?.();
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        a.back?.();
        e.preventDefault();
      } else if (e.key === "1" || e.key === "2") {
        a.submitOpt?.(Number(e.key) - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ─── Rail data ────────────────────────────────────────────────
  const totalChecks = steps.reduce((acc, s) => acc + (s.questionIds?.length || 0), 0);
  const passedChecks = correctIds.size;
  // Minutes-remaining: sum estMinutes of steps ahead + this one.
  const minutesLeft = steps.slice(currentStepIdx).reduce((acc, s) => acc + (s.estMinutes || 0), 0);
  const totalMinutes = steps.reduce((acc, s) => acc + (s.estMinutes || 0), 0);
  const progressPct = steps.length === 0 ? 0 : Math.round(((isSignStep ? steps.length : currentStepIdx) / (steps.length + 1)) * 100);

  // Part number for the header subtitle (comes from the queue via
  // parent, not the module route - we don't want to double-fetch).
  // For now the docTitle carries it if the caller passed it; leaving
  // as-is unless expanded.

  // ─── Completion screen when signed ────────────────────────────
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

  // ─── Loading / error ─────────────────────────────────────────
  if (state.status === "loading") {
    return (
      <div className="opd-focus" data-room="focus">
        <div className="opd-focus-mhead" aria-busy="true">
          <span className="opd-skel opd-skel--bar opd-skel--w40" />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="opd-focus" data-room="focus">
        <nav className="opd-crumb" aria-label="Breadcrumb">
          <button type="button" className="opd-crumb-link" onClick={onBack}>Academy</button>
          <span className="opd-crumb-sep" aria-hidden="true">/</span>
          <span className="opd-crumb-current">{docId}</span>
        </nav>
        <DashedBrick scope={`module ${docId || ""}`.trim()} message={state.error} onRetry={() => load()} />
      </div>
    );
  }

  // ─── Main render ─────────────────────────────────────────────
  return (
    <div className="opd-focus opd-focus--stepper" data-room="focus">
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

      {/* Module header - doc chip, title, part-of chip, minutes
          remaining as the largest number, progress bar. Subtitle
          shows "part N of M" only when the doc has multiple
          obligations (parent passes totalParts > 1 from the queue).
          Never derive subtitle from obligation_key - spec 18.3
          forbids obligation keys in operator copy. */}
      <div className="opd-focus-mhead">
        <span className="opd-doc-chip">{doc?.id || docId}</span>
        <div className="opd-focus-mhead-title">
          <h1>{doc?.title || docTitle || docId}</h1>
          {totalParts > 1 ? (
            <div className="opd-focus-mhead-sub">
              Part {partNumber} of {totalParts}
            </div>
          ) : null}
        </div>
        <div className="opd-focus-mhead-time">
          <b className="num">{isSignStep ? 1 : Math.max(1, minutesLeft)}</b>
          <span>min left</span>
        </div>
      </div>
      <div className="opd-focus-mbar" aria-hidden="true">
        <i style={{ width: `${progressPct}%` }} />
      </div>

      {/* Mobile rail - single line + toggle, below 900px. */}
      <div className={"opd-focus-mrail" + (mobileRailOpen ? " opd-focus-mrail--open" : "")}>
        <div className="opd-focus-mrail-row">
          <span className="opd-focus-mrail-label">
            {isSignStep ? "Sign" : `Section ${currentStepIdx + 1} of ${steps.length}`}
          </span>
          <span className="opd-focus-mrail-bar">
            <i style={{ width: `${progressPct}%` }} />
          </span>
          <button
            type="button"
            className="opd-focus-mrail-toggle"
            onClick={() => setMobileRailOpen((v) => !v)}
            aria-expanded={mobileRailOpen}
          >
            {mobileRailOpen ? "Hide" : "All sections"}
          </button>
        </div>
        {mobileRailOpen ? (
          <ol className="opd-focus-mrail-list" aria-label="Module sections">
            {steps.map((s, i) => renderRailItem(s, i, currentStepIdx, sectionsSeen, goToStep, setMobileRailOpen))}
            {renderSignRailItem(steps.length, isSignStep, () => setMobileRailOpen(false), goToStep)}
          </ol>
        ) : null}
      </div>

      {/* Two-column grid: rail on left, step card on right */}
      <div className="opd-focus-grid opd-focus-grid--stepper">
        <aside className="opd-focus-rail opd-focus-rail--stepper" aria-label="Module sections">
          <div className="opd-focus-rail-header">
            <span className="opd-k">
              {ob?.description ? "In this module" : (doc?.title || "Sections")}
            </span>
          </div>
          <ol className="opd-focus-rail-steps">
            {steps.map((s, i) => renderRailItem(s, i, currentStepIdx, sectionsSeen, goToStep))}
            {renderSignRailItem(steps.length, isSignStep, null, goToStep)}
          </ol>
          <div className="opd-focus-rail-footer">
            Your place is saved. Nothing is submitted until you sign.
          </div>
        </aside>

        <article className="opd-card opd-focus-step" aria-live="polite" aria-busy={state.status === "loading"}>
          {isSignStep ? (
            <>
              <header className="opd-focus-step-head">
                <span className="opd-focus-step-kk">Last step</span>
                <h2 className="opd-focus-step-h2" data-step-heading tabIndex={-1} ref={stepHeadingRef}>Sign</h2>
                <p className="opd-focus-step-est">
                  You have read all {steps.length} section{steps.length === 1 ? "" : "s"}
                  {totalChecks > 0 ? ` and passed ${passedChecks} check${passedChecks === 1 ? "" : "s"}` : ""}.
                </p>
              </header>
              <div className="opd-focus-step-body">
                {viewer?.displayName ? (
                  <SignBlock
                    requirementId={requirementId}
                    doc={doc}
                    version={version}
                    displayName={viewer.displayName}
                    timeSpentSeconds={timeSpentSeconds()}
                    stepsCount={steps.length}
                    totalQuestionsPassed={passedChecks}
                    onSigned={onSignedInternal}
                  />
                ) : null}
              </div>
              <footer className="opd-focus-step-foot">
                <button
                  type="button"
                  className="opd-focus-step-back"
                  onClick={() => goToStep(steps.length - 1)}
                >
                  Back
                </button>
                <button type="button" className="opd-focus-step-exit" onClick={saveAndExit}>
                  Save &amp; exit
                </button>
                <span className="opd-focus-step-hint">Your typed name must match your account.</span>
              </footer>
            </>
          ) : currentStep ? (
            <>
              <header className="opd-focus-step-head">
                <span className="opd-focus-step-kk">Section {currentStepIdx + 1} of {steps.length}</span>
                <h2 className="opd-focus-step-h2" data-step-heading tabIndex={-1} ref={stepHeadingRef}>
                  {currentStep.anchor}
                </h2>
                <p className="opd-focus-step-est">
                  About {currentStep.estMinutes} minute{currentStep.estMinutes === 1 ? "" : "s"}
                  {currentQuestions.length > 0
                    ? ` · ${currentQuestions.length} quick check${currentQuestions.length === 1 ? "" : "s"}`
                    : " · no check"}
                </p>
              </header>
              <div
                className="opd-focus-step-body opd-focus-body"
                ref={stepBodyRef}
                dangerouslySetInnerHTML={{ __html: currentStep.html }}
              />
              {currentQuestions.length > 0 && activeQIndex >= 0 ? (
                <div className="opd-focus-step-check">
                  <CheckCard
                    key={currentQuestions[activeQIndex].question_id}
                    requirementId={requirementId}
                    question={currentQuestions[activeQIndex]}
                    qIndex={activeQIndex}
                    qCount={currentQuestions.length}
                    alreadyCorrect={false}
                    onCorrect={onCorrect}
                    onBackToSection={flashAnchor}
                  />
                </div>
              ) : null}
              {/* Show already-passed checks quietly above the active one */}
              {currentQuestions.length > 1 && currentQuestions.slice(0, activeQIndex >= 0 ? activeQIndex : currentQuestions.length).length > 0 ? (
                <div className="opd-focus-step-past-checks">
                  {currentQuestions.slice(0, activeQIndex >= 0 ? activeQIndex : currentQuestions.length).map((q, i) => (
                    <CheckCard
                      key={q.question_id}
                      requirementId={requirementId}
                      question={q}
                      qIndex={i}
                      qCount={currentQuestions.length}
                      alreadyCorrect={true}
                      onCorrect={onCorrect}
                      onBackToSection={flashAnchor}
                    />
                  ))}
                </div>
              ) : null}
              <footer className="opd-focus-step-foot">
                {currentStepIdx > 0 ? (
                  <button
                    type="button"
                    className="opd-focus-step-back"
                    onClick={() => goToStep(currentStepIdx - 1)}
                  >
                    Back
                  </button>
                ) : null}
                <button type="button" className="opd-focus-step-exit" onClick={saveAndExit}>
                  Save &amp; exit
                </button>
                <span className="opd-focus-step-hint" aria-live="polite">
                  {stepCleared
                    ? ""
                    : "Answer the check to continue"}
                </span>
                <button
                  type="button"
                  className={"opd-focus-step-next" + (stepCleared ? "" : " opd-focus-step-next--disabled")}
                  disabled={!stepCleared}
                  onClick={advanceStep}
                >
                  {currentStepIdx === steps.length - 1
                    ? "Continue to sign"
                    : (currentQuestions.length > 1 && activeQIndex >= 0 && activeQIndex < currentQuestions.length - 1)
                      ? "Next check"
                      : "Continue"}
                </button>
              </footer>
            </>
          ) : (
            <DashedBrick scope="this module" message="No sections found in this document." />
          )}
        </article>
      </div>
    </div>
  );
}

// ─── Rail item helpers (kept out of the main render for clarity) ──
function renderRailItem(step, i, currentStepIdx, sectionsSeen, goToStep, closeMobile) {
  const done = sectionsSeen.has(step.key) && i < currentStepIdx;
  const now = i === currentStepIdx;
  const locked = i > currentStepIdx && !sectionsSeen.has(step.key);
  const clickable = !locked;
  const cls = "opd-focus-rail-step"
    + (done ? " opd-focus-rail-step--done" : "")
    + (now ? " opd-focus-rail-step--now" : "")
    + (locked ? " opd-focus-rail-step--locked" : "");
  // Merged step: rail title stays the first anchor, but a +N chip
  // signals the additional merged sections. Spec 18.5: never invent a
  // synthesised title, never show section-number ranges in operator
  // copy - the +N chip is the honest signal. Sub-headings render as
  // inline sub-headings inside the step body when the step opens.
  const extraSections = Math.max(0, (step.anchors?.length || 1) - 1);
  return (
    <li
      key={step.key + i}
      className={cls}
      aria-current={now ? "step" : undefined}
    >
      <button
        type="button"
        disabled={!clickable}
        onClick={() => { if (clickable) { goToStep(i); if (closeMobile) closeMobile(); } }}
        className="opd-focus-rail-step-btn"
      >
        <span className="opd-focus-rail-step-num" aria-hidden="true">
          {done ? "✓" : i + 1}
        </span>
        <span className="opd-focus-rail-step-tx">
          <b>
            {step.anchor}
            {extraSections > 0 ? (
              <span
                className="opd-focus-rail-step-plus"
                aria-label={`plus ${extraSections} more section${extraSections === 1 ? "" : "s"}`}
              >
                +{extraSections}
              </span>
            ) : null}
          </b>
          <span className="opd-focus-rail-step-meta">
            <span>{step.estMinutes} min</span>
            {step.questionIds?.length ? (
              <span className="opd-focus-rail-step-chk">
                &middot; {step.questionIds.length} check{step.questionIds.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function renderSignRailItem(stepsCount, isSignStep, closeMobile, goToStep) {
  const now = isSignStep;
  return (
    <li
      key="sign"
      className={"opd-focus-rail-step opd-focus-rail-step--sign" + (now ? " opd-focus-rail-step--now" : " opd-focus-rail-step--locked")}
      aria-current={now ? "step" : undefined}
    >
      <button
        type="button"
        disabled={!now}
        onClick={() => { if (now) { goToStep(stepsCount); if (closeMobile) closeMobile(); } }}
        className="opd-focus-rail-step-btn"
      >
        <span className="opd-focus-rail-step-num" aria-hidden="true">&#9998;</span>
        <span className="opd-focus-rail-step-tx">
          <b>Sign</b>
          <span className="opd-focus-rail-step-meta"><span>1 min</span></span>
        </span>
      </button>
    </li>
  );
}

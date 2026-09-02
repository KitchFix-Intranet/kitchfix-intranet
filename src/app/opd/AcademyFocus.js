"use client";

// Academy Focus - the module surface.
//
// Spec 18.4/18.5 (amended by the module-composition PR):
//   - A module is ONE bordered card. Header, step rail, and reading
//     column are regions of a single surface divided by hairlines,
//     not separate cards on a background.
//   - The reading column is centred within its own space so the
//     640px measure reads as a deliberate column.
//   - The reading pane is CAPPED, not fixed. Short content sits at
//     natural height with no scrollbar. Long content caps at
//     min(620px, calc(100vh - 360px)) and scrolls, with a fade at
//     the edge as the only signal.
//   - Below 900px the cap is removed and the page scrolls naturally.
//   - A passed check persists across navigation - Back does not
//     wipe the answered state.
//   - After answering, the feedback scrolls into view within the
//     pane (D1) - not to top, the minimum scroll that reveals it.
//
// The visual contract lives at docs/opd/OPD_Module_Final.html.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── helpers ─────────────────────────────────────────────────────
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
// One question, inline at the section boundary inside the pane.
//   D3: options render with a POSITIONAL letter (A/B by index), not
//       the option id. Grading is by id server-side.
//   D5: once passed, options LOCK - no further selection.
//   D2: pickedOptionId prop restores the answered state when the
//       user navigates back to a passed check. Session-scoped;
//       cross-session fallback is the compact "passed" summary.
function CheckCard({
  requirementId,
  question,
  qIndex,
  qCount,
  pickedOptionId,           // if set, mount as answered with this option locked
  onCorrect,                // (questionId, selectedOptionId) -> void
  onFeedbackShown,          // () -> void, called after a feedback panel becomes visible
  onBackToSection,
}) {
  // Look up the pre-picked option's explanation from the question
  // payload (safe to expose to a user who has already passed it;
  // both explanations are already on the wire per academy-12).
  const pickedExplanation = useMemo(() => {
    if (!pickedOptionId) return null;
    const opt = (question.options || []).find((o) => o.id === pickedOptionId);
    return opt?.explanation || "";
  }, [pickedOptionId, question]);

  const [state, setState] = useState({
    status: pickedOptionId ? "right" : "idle",
    selectedId: pickedOptionId || null,
    explanation: pickedExplanation,
    error: null,
  });

  const disabled = state.status === "submitting" || state.status === "right";
  const feedbackRef = useRef(null);
  const cardRef = useRef(null);

  // Mark chk as "seen" (animates in) shortly after mount.
  useEffect(() => {
    const t = setTimeout(() => {
      const el = cardRef.current;
      if (el && !el.classList.contains("opd-chk--seen")) el.classList.add("opd-chk--seen");
    }, 30);
    return () => clearTimeout(t);
  }, []);

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
      if (body.correct && onCorrect) onCorrect(question.question_id, optionId);
      // D1: scroll the pane so the feedback panel is visible. Runs
      // after render so the panel has laid out.
      requestAnimationFrame(() => onFeedbackShown && onFeedbackShown(feedbackRef.current));
    } catch (err) {
      setState({ status: "error", selectedId: optionId, explanation: null, error: err?.message || String(err) });
    }
  }

  return (
    <div className="opd-chk" ref={cardRef} data-question-key={question.question_key}>
      <span className="opd-chk-k">Quick check {qIndex + 1} of {qCount}</span>
      <h4>{question.prompt}</h4>
      <div role="group" aria-label={question.prompt}>
        {question.options.map((opt, idx) => {
          const isSelected = state.selectedId === opt.id;
          const letter = String.fromCharCode(65 + idx);
          let mod = "";
          if (state.status === "wrong" && isSelected) mod = " opd-opt--miss";
          else if (state.status === "right" && isSelected) mod = " opd-opt--rt opd-opt--lock";
          else if (state.status === "right" && !isSelected) mod = " opd-opt--dim opd-opt--lock";
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              className={"opd-opt" + mod}
              onClick={() => submit(opt.id)}
              data-position={letter}
              data-option-id={opt.id}
            >
              <span className="opd-opt-lt">{letter}</span>
              <span>{opt.text}</span>
            </button>
          );
        })}
      </div>
      <div ref={feedbackRef} aria-live="polite" aria-atomic="true">
        {state.status === "wrong" ? (
          <div className="opd-fb opd-fb--a" role="alert">
            <span className="opd-fb-vd">Not quite - let us look again.</span>
            {state.explanation}
            <br />
            <button
              type="button"
              className="opd-fb-bk"
              onClick={() => onBackToSection && onBackToSection()}
            >
              &uarr; Show me that line
            </button>
          </div>
        ) : null}
        {state.status === "right" ? (
          <div className="opd-fb opd-fb--g">
            <span className="opd-fb-vd">That is it.</span>
            {state.explanation}
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className="opd-brick opd-brick--inline" role="alert" style={{ marginTop: 12 }}>
            <div className="opd-brick-title">Could not record your answer</div>
            <p className="opd-brick-body">{state.error}. Your answer was not lost - pick it again to retry.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── SignBlock ────────────────────────────────────────────────────
// Recap + attestation + typed-name input + earn card. The signature
// SUBMIT lives in SignFooter (footer belongs to .opd-ufoot, not the
// scrolled pane). SignFooter observes .opd-sgi via DOM query, keeping
// the two visually adjacent regions decoupled without lifting typed
// state through the whole tree. This is fine because only one
// .opd-sgi is ever on screen (the sign step is a terminal state).
function SignBlock({
  doc,
  version,
  displayName,
  timeSpentSeconds,
  stepsCount,
  totalQuestionsPassed,
}) {
  const attestationText = useMemo(() => (
    `I, ${displayName}, have read and understood ${doc?.title || doc?.id || "this document"}, version ${version || "?"}, and I will hold this standard at my sites.`
  ), [displayName, doc?.title, doc?.id, version]);

  const minutes = timeSpentSeconds > 0 ? Math.max(1, Math.round(timeSpentSeconds / 60)) : null;

  return (
    <>
      <div className="opd-recap">
        <div className="opd-rc"><b>{stepsCount}</b><span className="opd-lb">SECTIONS</span></div>
        <div className="opd-rc"><b>{totalQuestionsPassed}</b><span className="opd-lb">CHECK{totalQuestionsPassed === 1 ? "" : "S"}</span></div>
        {minutes != null ? (
          <div className="opd-rc"><b>{minutes}</b><span className="opd-lb">MINUTE{minutes === 1 ? "" : "S"}</span></div>
        ) : null}
      </div>
      <p className="opd-att">{attestationText}</p>
      <div className="opd-sgr">
        <input
          type="text"
          className="opd-sgi"
          placeholder="Type your full name"
          autoComplete="off"
          spellCheck="false"
          aria-label="Type your full name to sign"
        />
      </div>
      <div className="opd-earn">
        <div className="opd-earn-g" aria-hidden="true">&#127942;</div>
        <div>
          <b>You will earn: {doc?.title || doc?.id}</b>
          <span className="opd-lb">Certificate issued on signing.</span>
        </div>
      </div>
    </>
  );
}

// ─── Completion cert ─────────────────────────────────────────────
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
      <div className="opd-focus-done-actions">
        {attestation?.attestation_id ? (
          // Plain <a href download> - the server sets Content-Disposition
          // and supplies the filename (serial + safe title).
          <a
            className="opd-focus-done-dl"
            href={`/api/academy/certificate/${encodeURIComponent(attestation.attestation_id)}`}
            download
          >
            Download PDF
          </a>
        ) : null}
        <button type="button" className="opd-focus-done-back" onClick={onBack}>
          Back to Academy &rsaquo;
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main - the one-card module surface
// ═══════════════════════════════════════════════════════════════════
export default function AcademyFocus({
  requirementId,
  docId,
  docTitle,
  docShelf,
  partNumber,
  totalParts,
  onBack,
  onSigned,
}) {
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
  const steps = state.data?.steps || [];
  const questions = state.data?.questions || [];
  const progress = state.data?.progress || null;
  const initialAttestation = state.data?.attestation || null;
  const viewer = state.data?.viewer || null;

  const version = doc?.version || req?.doc_version || null;

  const questionsById = useMemo(() => {
    const m = new Map();
    for (const q of questions) m.set(q.question_id, q);
    return m;
  }, [questions]);

  // ─── State ────────────────────────────────────────────────────
  const initialStepIdx = progress?.furthest_step_index ?? 0;
  const [currentStepIdx, setCurrentStepIdx] = useState(initialStepIdx);
  const [signedAttestation, setSignedAttestation] = useState(initialAttestation);
  const [correctIds, setCorrectIds] = useState(() => new Set(progress?.all_correct_ids || []));
  const [sectionsSeen, setSectionsSeen] = useState(() => new Set(progress?.sections_seen || []));
  // D2: session-scoped map of question_id -> option_id the user picked
  // when they got it right. Rebuilt on each session; server tracks the
  // "passed" flag but not which option, so cross-session Back falls
  // back to the compact "passed" summary. Within-session Back restores
  // the full answered view.
  const [pickedByQuestion, setPickedByQuestion] = useState(() => ({}));
  const [savedTag, setSavedTag] = useState(false);
  const [justDoneIdx, setJustDoneIdx] = useState(-1);

  useEffect(() => {
    setCurrentStepIdx(progress?.furthest_step_index ?? 0);
    setCorrectIds(new Set(progress?.all_correct_ids || []));
    setSectionsSeen(new Set(progress?.sections_seen || []));
    setSignedAttestation(initialAttestation);
  }, [progress?.furthest_step_index, progress?.all_correct_ids, progress?.sections_seen, initialAttestation]);

  // ─── Progress push ────────────────────────────────────────────
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
    } catch { /* best-effort */ }
    if (extraKey) setSectionsSeen(merged);
  }, [requirementId, sectionsSeen, progress?.time_spent_seconds]);

  // ─── Per-step derived state ───────────────────────────────────
  const isSignStep = currentStepIdx >= steps.length;
  const currentStep = isSignStep ? null : steps[currentStepIdx];
  const currentQuestions = useMemo(() => {
    if (!currentStep) return [];
    return (currentStep.questionIds || []).map((id) => questionsById.get(id)).filter(Boolean);
  }, [currentStep, questionsById]);
  // Two checks in a step come one at a time: the first unanswered one
  // is active. If all answered, activeQIndex = -1 and Continue enables.
  const activeQIndex = currentQuestions.findIndex((q) => !correctIds.has(q.question_id));
  const stepCleared = activeQIndex === -1;

  // ─── Refs for the pane + anchor flash ─────────────────────────
  const paneRef = useRef(null);
  const uscRef = useRef(null);
  const cwRef = useRef(null);

  const flashAnchor = useCallback(() => {
    const body = cwRef.current;
    if (!body) return;
    const anchor = body.querySelector(".anchor, .anch, blockquote, [data-anchor]") || body;
    if (typeof anchor.scrollIntoView === "function") {
      anchor.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    anchor.classList.remove("opd-anchor-flash");
    void anchor.offsetWidth;
    anchor.classList.add("opd-anchor-flash");
  }, []);

  // Fade-cue: toggle .opd-usc--more when there is more below to
  // scroll to. Runs on scroll + on step change.
  const cueMore = useCallback(() => {
    const usc = uscRef.current;
    const pane = paneRef.current;
    if (!usc || !pane) return;
    const more = pane.scrollHeight > pane.clientHeight + 8
      && (pane.scrollHeight - pane.clientHeight - pane.scrollTop) > 26;
    usc.classList.toggle("opd-usc--more", more);
  }, []);

  // ─── D1: reveal feedback within the pane ──────────────────────
  const revealInPane = useCallback((el) => {
    const pane = paneRef.current;
    if (!pane || !el) return;
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const pr = pane.getBoundingClientRect();
      const over = r.bottom - (pr.bottom - 18);
      if (over > 0) {
        pane.scrollTo({ top: pane.scrollTop + over, behavior: "smooth" });
      }
      setTimeout(cueMore, 400);
    });
  }, [cueMore]);

  // ─── Advance / back ───────────────────────────────────────────
  const goToStep = useCallback((i) => {
    if (i < 0 || i > steps.length) return;
    setCurrentStepIdx(i);
    setTimeout(() => {
      const h = document.querySelector("[data-step-heading]");
      if (h && typeof h.focus === "function") h.focus();
      const pane = paneRef.current;
      if (pane) pane.scrollTop = 0;
      cueMore();
    }, 60);
  }, [steps.length, cueMore]);

  const advanceStep = useCallback(async () => {
    if (currentStep) {
      // Fire-and-forget with a brief "Saved" tag.
      pushProgress(currentStep.key).then(() => {
        setSavedTag(true);
        setTimeout(() => setSavedTag(false), 1300);
      });
      setJustDoneIdx(currentStepIdx);
      setTimeout(() => setJustDoneIdx(-1), 550);
    }
    goToStep(currentStepIdx + 1);
  }, [currentStep, currentStepIdx, pushProgress, goToStep]);

  const onCorrect = useCallback((questionId, optionId) => {
    setCorrectIds((prev) => {
      const next = new Set(prev);
      next.add(questionId);
      return next;
    });
    setPickedByQuestion((prev) => ({ ...prev, [questionId]: optionId }));
  }, []);

  const onSignedInternal = useCallback((att) => {
    setSignedAttestation(att);
    if (onSigned) onSigned(att);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 60);
  }, [onSigned]);

  const saveAndExit = useCallback(async () => {
    await pushProgress(null);
    if (onBack) onBack();
  }, [pushProgress, onBack]);

  // ─── Keyboard nav ─────────────────────────────────────────────
  const advanceRef = useRef({ advance: null, back: null, submitOpt: null });
  useEffect(() => {
    advanceRef.current = {
      advance: async () => {
        if (isSignStep) {
          const b = document.getElementById("opd-sign-btn");
          if (b && !b.disabled) b.click();
          return;
        }
        if (!stepCleared) return;
        await advanceStep();
      },
      back: () => {
        if (currentStepIdx > 0) goToStep(currentStepIdx - 1);
      },
      submitOpt: (idx) => {
        if (isSignStep) return;
        const opts = document.querySelectorAll(".opd-opt");
        const target = opts[idx];
        if (target && !target.disabled) target.click();
      },
    };
  }, [isSignStep, stepCleared, currentStepIdx, advanceStep, goToStep]);
  useEffect(() => {
    function onKey(e) {
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

  // Recompute fade cue after each paint (when current step changes).
  useEffect(() => {
    cueMore();
  }, [currentStepIdx, cueMore]);

  // ─── Rail data ───────────────────────────────────────────────
  const totalChecks = steps.reduce((acc, s) => acc + (s.questionIds?.length || 0), 0);
  const passedChecks = correctIds.size;
  const minutesLeft = isSignStep
    ? 1
    : Math.max(1, steps.slice(currentStepIdx).reduce((acc, s) => acc + (s.estMinutes || 0), 0) + 1); // +1 for sign
  const progressPct = steps.length === 0
    ? 0
    : Math.round(((isSignStep ? steps.length : currentStepIdx) / (steps.length + 1)) * 100);
  const doneCount = Object.keys(
    Array.from({ length: steps.length }).reduce((acc, _, i) => {
      if (sectionsSeen.has(steps[i]?.key)) acc[i] = true;
      return acc;
    }, {})
  ).length;

  // ─── Completion screen ───────────────────────────────────────
  // Breadcrumb removed (density pass, spec 18.4 amended). The
  // Academy button in the footer replaces the crumb as the route
  // home - a better path than a trail nobody clicks.
  if (signedAttestation) {
    return (
      <div className="opd-focus" data-room="focus-done">
        <CompletionScreen
          doc={doc}
          version={version}
          attestation={signedAttestation}
          onBack={onBack}
        />
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="opd-focus" data-room="focus">
        <div className="opd-uni" aria-busy="true" style={{ padding: 24 }}>
          <span className="opd-skel opd-skel--bar opd-skel--w40" />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="opd-focus" data-room="focus">
        <DashedBrick scope={`module ${docId || ""}`.trim()} message={state.error} onRetry={() => load()} />
      </div>
    );
  }

  // ─── Main render ─────────────────────────────────────────────
  return (
    <div className="opd-focus opd-focus--uni" data-room="focus">
      {/* The one card. Header + progress rule + body all inside .opd-uni. */}
      <div className="opd-uni">

        <header className="opd-uhead">
          <span className="opd-doc-chip">{doc?.id || docId}</span>
          <div className="opd-uhead-title">
            <h1>{doc?.title || docTitle || docId}</h1>
            {totalParts > 1 ? (
              <div className="opd-uhead-sub">Part {partNumber} of {totalParts}</div>
            ) : null}
          </div>
          <div className="opd-uhead-rt">
            <b>{minutesLeft}</b>
            <span className="opd-lb">MIN LEFT</span>
          </div>
        </header>

        <div className="opd-ubar" aria-hidden="true">
          <i style={{ width: `${progressPct}%` }} />
        </div>

        <div className="opd-ubody">
          {/* Step rail */}
          <aside className="opd-urail" aria-label="Module sections">
            <div className="opd-urail-head">
              <span className="opd-urail-head-k">In this module</span>
              <em className="opd-urail-head-count">
                {doneCount} of {steps.length}
              </em>
            </div>
            <ol className="opd-urail-list">
              {steps.map((s, i) => (
                <RailItem
                  key={s.key + i}
                  step={s}
                  index={i}
                  currentStepIdx={currentStepIdx}
                  sectionsSeen={sectionsSeen}
                  justDoneIdx={justDoneIdx}
                  goToStep={goToStep}
                />
              ))}
              <SignRailItem
                stepsCount={steps.length}
                isSignStep={isSignStep}
                goToStep={goToStep}
              />
            </ol>
            <div className="opd-urail-foot">
              Your place is saved. Nothing is submitted until you sign.
            </div>
          </aside>

          {/* Content column: usc > pane > cw + fade */}
          <div className="opd-ucont">
            <div className="opd-usc" ref={uscRef}>
              <div
                className="opd-upane"
                ref={paneRef}
                tabIndex={0}
                role="region"
                aria-label={
                  isSignStep
                    ? "Sign this module"
                    : (currentStep ? `Reading pane - ${currentStep.anchor}` : "Reading pane")
                }
                onScroll={cueMore}
              >
                <article className="opd-ucw" ref={cwRef}>
                  {isSignStep ? (
                    <SignPane
                      steps={steps}
                      totalChecks={totalChecks}
                      passedChecks={passedChecks}
                      doc={doc}
                      version={version}
                      viewer={viewer}
                      timeSpentSeconds={timeSpentSeconds}
                    />
                  ) : currentStep ? (
                    <ReadPane
                      step={currentStep}
                      stepIndex={currentStepIdx}
                      stepsTotal={steps.length}
                      isDone={sectionsSeen.has(currentStep.key) && currentStepIdx < steps.length}
                      currentQuestions={currentQuestions}
                      activeQIndex={activeQIndex}
                      pickedByQuestion={pickedByQuestion}
                      correctIds={correctIds}
                      requirementId={requirementId}
                      onCorrect={onCorrect}
                      onFeedbackShown={revealInPane}
                      onBackToSection={flashAnchor}
                    />
                  ) : (
                    <DashedBrick scope="this module" message="No sections found in this document." />
                  )}
                </article>
              </div>
              <div className="opd-usc-fade" aria-hidden="true" />
            </div>

            {/* Footer */}
            <footer className="opd-ufoot">
              {isSignStep ? (
                <SignFooter
                  requirementId={requirementId}
                  onAcademy={onBack}
                  onBack={() => goToStep(steps.length - 1)}
                  onSignedInternal={onSignedInternal}
                  displayName={viewer?.displayName || ""}
                  doc={doc}
                  version={version}
                  stepsCount={steps.length}
                  totalQuestionsPassed={passedChecks}
                  timeSpentSeconds={timeSpentSeconds}
                  onSaveExit={saveAndExit}
                />
              ) : (
                <ReadFooter
                  currentStepIdx={currentStepIdx}
                  stepsTotal={steps.length}
                  currentQuestions={currentQuestions}
                  activeQIndex={activeQIndex}
                  stepCleared={stepCleared}
                  savedTag={savedTag}
                  onAcademy={onBack}
                  onBack={() => goToStep(currentStepIdx - 1)}
                  onSaveExit={saveAndExit}
                  onNext={advanceStep}
                />
              )}
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ReadPane (content + optional check inside the pane) ─────────
function ReadPane({
  step,
  stepIndex,
  stepsTotal,
  isDone,
  currentQuestions,
  activeQIndex,
  pickedByQuestion,
  correctIds,
  requirementId,
  onCorrect,
  onFeedbackShown,
  onBackToSection,
}) {
  const activeQuestion = activeQIndex >= 0 ? currentQuestions[activeQIndex] : null;
  return (
    <>
      <div className="opd-ucw-sk">Section {stepIndex + 1} of {stepsTotal}</div>
      <h2 data-step-heading tabIndex={-1}>{step.anchor}</h2>
      <div className="opd-ucw-est">
        About {step.estMinutes} minute{step.estMinutes === 1 ? "" : "s"}
        {currentQuestions.length > 0
          ? ` · ${currentQuestions.length} quick check${currentQuestions.length === 1 ? "" : "s"}`
          : " · no check"}
      </div>
      <div dangerouslySetInnerHTML={{ __html: step.html }} />
      {isDone && currentQuestions.length === 0 ? (
        <div className="opd-done-tag">&#10003; Read</div>
      ) : null}
      {activeQuestion ? (
        <CheckCard
          key={activeQuestion.question_id}
          requirementId={requirementId}
          question={activeQuestion}
          qIndex={activeQIndex}
          qCount={currentQuestions.length}
          pickedOptionId={pickedByQuestion[activeQuestion.question_id]}
          onCorrect={onCorrect}
          onFeedbackShown={onFeedbackShown}
          onBackToSection={onBackToSection}
        />
      ) : null}
      {/* Passed checks in this step, above the active one, are
          collapsed into compact summary rows (cross-section: same
          layout for session or cross-session). */}
      {currentQuestions.length > 1 && currentQuestions.slice(0, activeQIndex >= 0 ? activeQIndex : currentQuestions.length).length > 0 ? (
        <div className="opd-focus-step-past-checks" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14, opacity: 0.7 }}>
          {currentQuestions.slice(0, activeQIndex >= 0 ? activeQIndex : currentQuestions.length).map((q, i) => (
            <div key={q.question_id} className="opd-chk opd-chk--seen" role="status" style={{ padding: "10px 14px" }}>
              <span className="opd-chk-k">Quick check {i + 1} of {currentQuestions.length} · passed</span>
              <div style={{ marginTop: 4, fontSize: 13, color: "var(--opd-n700)" }}>{q.prompt}</div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

// ─── SignPane (recap + attestation, inside the pane) ─────────────
function SignPane({
  steps,
  totalChecks,
  passedChecks,
  doc,
  version,
  viewer,
  timeSpentSeconds,
}) {
  return (
    <>
      <div className="opd-ucw-sk">Last step</div>
      <h2 data-step-heading tabIndex={-1}>Sign</h2>
      <div className="opd-ucw-est">
        All {steps.length} sections read
        {totalChecks > 0 ? ` · ${passedChecks} check${passedChecks === 1 ? "" : "s"} passed` : ""}
      </div>
      {viewer?.displayName ? (
        <SignBlock
          doc={doc}
          version={version}
          displayName={viewer.displayName}
          timeSpentSeconds={timeSpentSeconds()}
          stepsCount={steps.length}
          totalQuestionsPassed={passedChecks}
        />
      ) : null}
    </>
  );
}

// ─── Footers ─────────────────────────────────────────────────────
function ReadFooter({
  currentStepIdx,
  stepsTotal,
  currentQuestions,
  activeQIndex,
  stepCleared,
  savedTag,
  onAcademy,
  onBack,
  onSaveExit,
  onNext,
}) {
  const last = currentStepIdx === stepsTotal - 1
    && (!currentQuestions.length || activeQIndex === currentQuestions.length - 1 || stepCleared);
  const nextLabel = !stepCleared
    ? (activeQIndex < currentQuestions.length - 1 ? "Next check" : "Continue")
    : (last ? "Continue to sign" : "Continue");
  return (
    <>
      {/* Academy button (density pass 2026-09-01): the route home,
          replacing the breadcrumb. Same click target as the removed
          crumb link. Home glyph is the leading &larr; character. */}
      <button
        type="button"
        className="opd-bt opd-bt--gh opd-bt--home"
        onClick={onAcademy}
        aria-label="Back to Academy"
      >
        &larr; Academy
      </button>
      {currentStepIdx > 0 ? (
        <button type="button" className="opd-bt opd-bt--gh" onClick={onBack}>Back</button>
      ) : null}
      <button type="button" className="opd-bt opd-bt--gh" onClick={onSaveExit}>
        Save &amp; exit
      </button>
      {stepCleared && savedTag ? (
        <span className="opd-ufoot-saved opd-ufoot-saved--on" role="status">&#10003; Saved</span>
      ) : (
        <span className="opd-ufoot-hint" aria-live="polite">
          {stepCleared ? "" : "Answer the check to continue"}
        </span>
      )}
      <button
        type="button"
        className="opd-bt"
        disabled={!stepCleared}
        onClick={onNext}
      >
        {nextLabel}
      </button>
      <span className="opd-kbd"><i>&#8629;</i></span>
    </>
  );
}

function SignFooter({
  requirementId,
  onAcademy,
  onBack,
  onSignedInternal,
  displayName,
  doc,
  version,
  stepsCount,
  totalQuestionsPassed,
  timeSpentSeconds,
  onSaveExit,
}) {
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Poll the input in SignPane. We can't easily share state with
  // SignBlock without a lift, so the footer subscribes to the input.
  useEffect(() => {
    const el = document.querySelector(".opd-sgi");
    if (!el) return;
    const onInput = () => setTyped(el.value);
    el.addEventListener("input", onInput);
    setTyped(el.value || "");
    return () => el.removeEventListener("input", onInput);
  }, []);

  const normExpected = String(displayName || "").trim().replace(/\s+/g, " ").toLowerCase();
  const normTyped = String(typed || "").trim().replace(/\s+/g, " ").toLowerCase();
  const matches = normExpected.length > 0 && normTyped === normExpected;

  const attestationIdRef = useRef(newAttestationId());
  const attestationText = useMemo(() => (
    `I, ${displayName}, have read and understood ${doc?.title || doc?.id || "this document"}, version ${version || "?"}, and I will hold this standard at my sites.`
  ), [displayName, doc?.title, doc?.id, version]);

  async function sign() {
    if (!matches || submitting) return;
    setSubmitting(true);
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
          timeSpentSeconds: timeSpentSeconds(),
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setSubmitting(false);
        return;
      }
      onSignedInternal(body.attestation);
    } catch {
      setSubmitting(false);
    }
  }

  const hint = matches
    ? "Ready to sign."
    : (typed.trim().length >= 3
        ? `Type it exactly as it appears on your account: ${displayName}`
        : "Your typed name must match your account.");

  return (
    <>
      <button
        type="button"
        className="opd-bt opd-bt--gh opd-bt--home"
        onClick={onAcademy}
        aria-label="Back to Academy"
      >
        &larr; Academy
      </button>
      <button type="button" className="opd-bt opd-bt--gh" onClick={onBack}>Back</button>
      <button type="button" className="opd-bt opd-bt--gh" onClick={onSaveExit}>Save &amp; exit</button>
      <span className="opd-ufoot-hint">{hint}</span>
      <button
        type="button"
        id="opd-sign-btn"
        className="opd-bt"
        disabled={!matches || submitting}
        onClick={sign}
      >
        {submitting ? "Signing" : "Sign & record"}
      </button>
    </>
  );
}

// ─── Rail item components ─────────────────────────────────────────
function RailItem({ step, index, currentStepIdx, sectionsSeen, justDoneIdx, goToStep }) {
  const done = sectionsSeen.has(step.key) && index < currentStepIdx;
  const now = index === currentStepIdx;
  const locked = index > currentStepIdx && !sectionsSeen.has(step.key);
  const clickable = !locked;
  const cls = "opd-sr"
    + (done ? " opd-sr--dn" : "")
    + (now ? " opd-sr--nw" : "")
    + (locked ? " opd-sr--lk" : "")
    + (index === justDoneIdx ? " opd-sr--tick" : "");
  const extraSections = Math.max(0, (step.anchors?.length || 1) - 1);
  return (
    <li
      className={cls}
      aria-current={now ? "step" : undefined}
    >
      <button
        type="button"
        className="opd-sr-btn"
        disabled={!clickable}
        onClick={() => { if (clickable) goToStep(index); }}
      >
        <span className="opd-sr-b" aria-hidden="true">{done ? "✓" : index + 1}</span>
        <span className="opd-sr-tx">
          <span className="opd-sr-t">
            {step.anchor}
            {extraSections > 0 ? (
              <span
                className="opd-sr-plus"
                aria-label={`plus ${extraSections} more section${extraSections === 1 ? "" : "s"}`}
              >
                +{extraSections}
              </span>
            ) : null}
          </span>
          <span className="opd-sr-m">
            {step.estMinutes} min
            {step.questionIds?.length ? (
              <> &middot; <em>{step.questionIds.length} check{step.questionIds.length === 1 ? "" : "s"}</em></>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function SignRailItem({ stepsCount, isSignStep, goToStep }) {
  const now = isSignStep;
  const cls = "opd-sr" + (now ? " opd-sr--nw" : " opd-sr--lk");
  return (
    <li className={cls} aria-current={now ? "step" : undefined}>
      <button
        type="button"
        className="opd-sr-btn"
        disabled={!now}
        onClick={() => { if (now) goToStep(stepsCount); }}
      >
        <span className="opd-sr-b" aria-hidden="true">&#9998;</span>
        <span className="opd-sr-tx">
          <span className="opd-sr-t">Sign</span>
          <span className="opd-sr-m">1 min</span>
        </span>
      </button>
    </li>
  );
}

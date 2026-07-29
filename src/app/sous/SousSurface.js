"use client";

// ════════════════════════════════════════════════════════════════════════════
// SousSurface - the live Sous ask + answer UI (Train 3)
// ════════════════════════════════════════════════════════════════════════════
//
// Shared between /sous page and the .pb-sous-panel overlay. Neither host
// changes the wire contract; the surface talks to /api/sousai (action=ask
// stream + action=feedback) as it stands today. No agent, prompt, or
// route-logic changes.
//
// Motion fence: tool-progress line + live stream + rail/badge settle.
// Nothing flies, nothing celebrates.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderMdLite } from "./mdLite";

const FIRST_RUN_INTRO = {
  eyebrow: "First time here",
  title: "What Sous can help with",
  body: [
    "Sous is the Ops Hub's operator brain - it reads every Live Playbook doc and answers in the language you use on the floor.",
    "It answers only what the Playbook covers. Refusals are the system working - they mean the corpus does not carry the answer yet. Log a doc gap and Kevin will fill it.",
    "Money figures are Price-Book-verified. Sous will not derive a number that is not written in a source doc.",
  ],
};

// The static fallback trio for when the digest chips route returns empty.
// Anchored to real Playbook content so first-run has something to click.
const STATIC_FALLBACK_CHIPS = [
  { label: "TBJ-FL 2026 service fee", question: "What is the TBJ-FL 2026 service fee?" },
  { label: "Allergic reaction protocol", question: "What is the allergic reaction protocol?" },
  { label: "Which accounts are flat-fee?", question: "Which accounts are on the flat-fee billing model?" },
];

// Parses an SSE stream from fetch() ReadableStream. Yields { event, data }
// where data is JSON-parsed (or raw text on parse failure). Advances until
// the stream ends.
async function* parseSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Split on double newline - one SSE frame per split.
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (!frame.trim()) continue;
      let eventName = "message";
      let dataLine = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      let data = dataLine;
      try { data = JSON.parse(dataLine); } catch { /* leave as raw string */ }
      yield { event: eventName, data };
    }
  }
}

export default function SousSurface({
  chips = null,
  variant = "page", // "page" or "overlay"
  initialQuestion = "",
  autoFocus = false,
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [phase, setPhase] = useState("idle"); // idle | streaming | done | error
  const [answerText, setAnswerText] = useState("");
  const [toolTrail, setToolTrail] = useState([]); // { tool, summary, ms? }[]
  const [doneEnv, setDoneEnv] = useState(null); // { question_id, status, sources, ... }
  const [errorInfo, setErrorInfo] = useState(null); // { kind, message }
  const [askedQuestion, setAskedQuestion] = useState(""); // echo
  const [feedbackSent, setFeedbackSent] = useState(null); // null | 1 | -1
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const startedAtRef = useRef(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  // If the parent passes a new initialQuestion (e.g. per-doc prefill), sync
  // the input and focus without submitting.
  useEffect(() => {
    if (initialQuestion) {
      setQuestion(initialQuestion);
      if (inputRef.current) {
        inputRef.current.focus();
        // Move caret to end so the operator can just type from there.
        const len = initialQuestion.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }
  }, [initialQuestion]);

  const submitting = phase === "streaming";
  const hasAnswer = phase === "done" || phase === "error" || phase === "streaming";
  const answered = phase === "done" || phase === "error";

  const submitAsk = useCallback(async (rawQuestion) => {
    const q = String(rawQuestion || "").trim();
    if (!q || submitting) return;
    // Reset state; then open stream.
    setAskedQuestion(q);
    setAnswerText("");
    setToolTrail([]);
    setDoneEnv(null);
    setErrorInfo(null);
    setFeedbackSent(null);
    setPhase("streaming");
    startedAtRef.current = Date.now();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/sousai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ask", question: q }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        setErrorInfo({ kind: "http", message: `Request failed (${resp.status}).` });
        setPhase("error");
        return;
      }
      for await (const { event, data } of parseSse(resp)) {
        if (event === "tool_start") {
          setToolTrail((prev) => [...prev, { tool: data.tool, summary: data.summary }]);
        } else if (event === "tool_end") {
          setToolTrail((prev) => {
            const next = [...prev];
            // Attach ms to the last matching entry that hasn't got one yet.
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].tool === data.tool && next[i].ms == null) {
                next[i] = { ...next[i], ms: data.ms };
                break;
              }
            }
            return next;
          });
        } else if (event === "token") {
          setAnswerText((prev) => prev + (data?.t || ""));
        } else if (event === "error") {
          setErrorInfo({ kind: data?.kind || "unknown", message: data?.message || "Sous failed." });
          setPhase("error");
        } else if (event === "done") {
          setDoneEnv(data || {});
          setPhase("done");
        }
      }
      // If the stream ended without a done event, treat as error.
      setPhase((p) => (p === "streaming" ? "error" : p));
      setErrorInfo((e) => e || { kind: "stream_closed", message: "Sous closed the connection unexpectedly." });
    } catch (err) {
      if (controller.signal.aborted) {
        // User navigated away or retried; leave state as-is.
        return;
      }
      setErrorInfo({ kind: "network", message: err?.message || "Network error." });
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }, [submitting]);

  const onFormSubmit = (e) => {
    e.preventDefault();
    submitAsk(question);
  };

  const onChipClick = (chipQuestion) => {
    setQuestion(chipQuestion);
    submitAsk(chipQuestion);
  };

  const onRetry = () => {
    // Question is preserved in the input per the wire-contract error kind.
    if (question.trim()) submitAsk(question);
  };

  const onFeedback = useCallback(async (value) => {
    if (!doneEnv?.question_id || feedbackSent != null) return;
    try {
      const resp = await fetch("/api/sousai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "feedback", question_id: doneEnv.question_id, value }),
      });
      if (resp.ok) setFeedbackSent(value);
    } catch {
      // Silent - thumbs are best-effort.
    }
  }, [doneEnv, feedbackSent]);

  const status = doneEnv?.status || (phase === "error" ? "error" : phase === "streaming" ? "streaming" : "grounded");
  const railClass = `sa-answer--${status}`;
  const badgeLabel = BADGE_LABEL[status] || "Answer";

  // Provenance line: during streaming, the last tool summary + a live dot.
  // After done, a settled line: N tools · totalMs · sources.
  const provenance = useMemo(() => {
    if (phase === "streaming") {
      const last = toolTrail[toolTrail.length - 1];
      return last?.summary ? `${last.summary}...` : "Thinking...";
    }
    if (phase === "done") {
      const total = startedAtRef.current ? Date.now() - startedAtRef.current : null;
      const nTools = toolTrail.length;
      const sources = Array.isArray(doneEnv?.sources) ? doneEnv.sources : [];
      const parts = [];
      if (nTools) parts.push(`${nTools} tool${nTools === 1 ? "" : "s"}`);
      if (total != null) parts.push(`${(total / 1000).toFixed(1)}s`);
      if (sources.length) parts.push(`sources: ${sources.join(", ")}`);
      return parts.join(" · ");
    }
    return null;
  }, [phase, toolTrail, doneEnv]);

  const activeChips = Array.isArray(chips) && chips.length > 0 ? chips : STATIC_FALLBACK_CHIPS;

  const isOverlay = variant === "overlay";
  const formEl = (
    <form className="sa-ask-form" onSubmit={onFormSubmit}>
      <input
        ref={inputRef}
        type="text"
        className="sa-ask-input"
        placeholder="Ask Sous a question..."
        aria-label="Ask Sous a question"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        disabled={submitting}
        maxLength={2000}
        autoComplete="off"
      />
      <button
        type="submit"
        className="sa-ask-send"
        disabled={submitting || !question.trim()}
        aria-label="Send question"
      >
        <span>{submitting ? "..." : "Send"}</span>
      </button>
    </form>
  );

  const bodyEl = (
    <>
      {/* First-run intro shows until the operator asks their first question. */}
      {!hasAnswer && (
        <div className="sa-firstrun">
          <p className="sa-firstrun-eyebrow">{FIRST_RUN_INTRO.eyebrow}</p>
          <h2 className="sa-firstrun-title">{FIRST_RUN_INTRO.title}</h2>
          {FIRST_RUN_INTRO.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}

      {/* Answer card (streaming AND done AND error). */}
      {hasAnswer && (
        <article className={`sa-answer ${railClass}`} aria-live="polite">
          <div className="sa-answer-head">
            <span className={`sa-badge sa-badge--${status}`}>{badgeLabel}</span>
          </div>
          {askedQuestion && (
            <p className="sa-question-echo">
              <span aria-hidden="true">Q: </span>{askedQuestion}
            </p>
          )}
          {phase === "error" ? (
            <>
              <div className="sa-answer-body">
                <p>{errorInfo?.message || "Sous did not answer."}</p>
              </div>
              <button type="button" className="sa-retry" onClick={onRetry}>
                Retry
              </button>
            </>
          ) : (
            <div
              className="sa-answer-body"
              dangerouslySetInnerHTML={{ __html: renderMdLite(answerText) }}
            />
          )}
          {/* Sources */}
          {Array.isArray(doneEnv?.sources) && doneEnv.sources.length > 0 && (
            <div className="sa-sources">
              {doneEnv.sources.map((docId) => (
                <a
                  key={docId}
                  className="sa-source-chip"
                  href={`/playbook/d/${encodeURIComponent(docId)}`}
                  target="_blank"
                  rel="noopener"
                >
                  {docId}
                </a>
              ))}
            </div>
          )}
          {/* Provenance */}
          {provenance && (
            <p className={`sa-provenance${phase === "done" ? " sa-provenance--done" : ""}`}>
              <span className="sa-provenance-dot" aria-hidden="true" />
              <span>{provenance}</span>
            </p>
          )}
          {/* Thumbs (only after done + when a question_id landed) */}
          {phase === "done" && doneEnv?.question_id && (
            <div className="sa-thumbs">
              {feedbackSent == null ? (
                <>
                  <button
                    type="button"
                    className="sa-thumb-btn"
                    onClick={() => onFeedback(1)}
                    aria-label="Answer was helpful"
                  >
                    <span aria-hidden="true">▲</span> helpful
                  </button>
                  <button
                    type="button"
                    className="sa-thumb-btn"
                    onClick={() => onFeedback(-1)}
                    aria-label="Answer was not helpful"
                  >
                    <span aria-hidden="true">▼</span> not helpful
                  </button>
                </>
              ) : (
                <span className="sa-thumbs-thanks">Thanks - logged.</span>
              )}
            </div>
          )}
        </article>
      )}

      {/* Chips row (below the answer card so it does not compete with an
          in-flight response). Only shown when idle - once the operator is
          engaged, we get out of the way. */}
      {!hasAnswer && (
        <div className={variant === "overlay" ? "sa-overlay-chips sa-chips-wrap" : "sa-chips-wrap"}>
          <p className="sa-chips-caption">From this week&#39;s digest</p>
          <div className="sa-chips" role="list">
            {activeChips.map((chip, i) => (
              <button
                key={i}
                type="button"
                className="sa-chip"
                onClick={() => onChipClick(chip.question)}
                role="listitem"
                disabled={submitting}
              >
                <span className="sa-chip-icon" aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <span className="sa-chip-label">{chip.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

    </>
  );

  // Overlay variant: two-region flex column. Body scrolls; form pinned bottom
  // via .sa-overlay-foot. Page variant: single column, form last (mobile CSS
  // fixes it to the bottom of the viewport per Design Scope).
  if (isOverlay) {
    return (
      <div className="sa-overlay-wrap">
        <div className="sa-overlay-body-scroll">{bodyEl}</div>
        <div className="sa-overlay-foot">{formEl}</div>
      </div>
    );
  }
  return (
    <div className="sa-column">
      {bodyEl}
      {formEl}
    </div>
  );
}

const BADGE_LABEL = {
  grounded: "Grounded",
  partial: "Partial",
  declined: "Declined",
  error: "Error",
  streaming: "Thinking",
};

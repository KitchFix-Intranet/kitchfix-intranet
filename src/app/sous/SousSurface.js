"use client";

// ════════════════════════════════════════════════════════════════════════════
// SousSurface - Redesign PR A
// ════════════════════════════════════════════════════════════════════════════
//
// Serves both surfaces via the `variant` prop:
//   - "page"    (from /sous/page.js:pages)   - full shell with session rail,
//                                              hero (via heroSlot prop),
//                                              first-run domain cards,
//                                              answer pane, composer
//   - "overlay" (from PlaybookClient panel)  - answer pane + composer only;
//                                              no rail, no hero, no first-run
//
// Wire contract unchanged: talks to /api/sousai (action=ask stream +
// action=feedback). No agent/prompt/route logic touched. Presentation
// only, plus feedback tags on the existing feedback POST (backend column
// added via sousai-2-feedback-tags migration).
//
// Session rail: client-held, in-memory only. Session-only per D8 (rail
// footer says so). The In-context marker at top-3 is PRESENTATION only
// in PR A - memory arrives in PR B; the marker becomes truthful then.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy, Download, ThumbsUp, ThumbsDown, Plus, ArrowUp, ExternalLink,
  BookOpen, Users, Calendar, Receipt,
} from "lucide-react";
import { renderMdLite } from "./mdLite";
import SousMark from "./SousMark";

const IN_CONTEXT_WINDOW = 3;   // Matches PR B's memory window.

const FEEDBACK_TAGS = [
  { id: "wrong_number",         label: "Wrong number" },
  { id: "missing_information",  label: "Missing information" },
  { id: "wrong_document",       label: "Wrong document" },
  { id: "out_of_date",          label: "Out of date" },
  { id: "hard_to_follow",       label: "Hard to follow" },
  { id: "should_have_declined", label: "Should have declined" },
];

const STATUS_LABEL = {
  grounded: "Grounded",
  partial: "Partial",
  declined: "Declined",
  error: "Error",
  streaming: "Thinking",
};

async function* parseSse(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
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
      try { data = JSON.parse(dataLine); } catch { /* raw string */ }
      yield { event: eventName, data };
    }
  }
}

function formatTime(d) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Shared duration formatter for the tool trail + provenance meta row.
// ≥1000ms renders as "N.Ns" (one decimal); <1000ms stays as "Nms". I3.
function formatMs(ms) {
  if (ms == null) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function truncate(s, n) {
  const t = String(s || "").trim();
  return t.length <= n ? t : t.slice(0, n - 1) + "…";
}

export default function SousSurface({
  chips = null,
  variant = "page",
  initialQuestion = "",
  autoFocus = false,
  heroSlot = null,
  domainCounts = {},
  domainExamples = {},
}) {
  const isOverlay = variant === "overlay";
  const [question, setQuestion] = useState(initialQuestion);
  const [phase, setPhase] = useState("idle");
  const [answerText, setAnswerText] = useState("");
  const [toolTrail, setToolTrail] = useState([]);
  const [doneEnv, setDoneEnv] = useState(null);
  const [errorInfo, setErrorInfo] = useState(null);
  const [askedQuestion, setAskedQuestion] = useState("");
  // Session rail entries. Client-held only. Presentation only in PR A.
  const [sessionTurns, setSessionTurns] = useState([]); // { id, at, question }
  // Feedback state - null | 1 | -1 | 'panel' (showing tag picker) | 'sent'
  const [feedbackState, setFeedbackState] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [feedbackText, setFeedbackText] = useState("");
  const [copyOk, setCopyOk] = useState(false);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const startedAtRef = useRef(null);

  useEffect(() => { if (autoFocus && inputRef.current) inputRef.current.focus(); }, [autoFocus]);

  useEffect(() => {
    if (initialQuestion) {
      setQuestion(initialQuestion);
      if (inputRef.current) {
        inputRef.current.focus();
        const len = initialQuestion.length;
        inputRef.current.setSelectionRange(len, len);
      }
    }
  }, [initialQuestion]);

  const submitting = phase === "streaming";
  const hasAnswer = phase === "done" || phase === "error" || phase === "streaming";

  const submitAsk = useCallback(async (rawQuestion) => {
    const q = String(rawQuestion || "").trim();
    if (!q || submitting) return;
    setAskedQuestion(q);
    setAnswerText("");
    setToolTrail([]);
    setDoneEnv(null);
    setErrorInfo(null);
    setFeedbackState(null);
    setSelectedTags([]);
    setFeedbackText("");
    setCopyOk(false);
    setPhase("streaming");
    startedAtRef.current = Date.now();
    // Prepend to session rail.
    const turnId = `t${Date.now()}`;
    setSessionTurns((prev) => [{ id: turnId, at: new Date(), question: q }, ...prev]);

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
      // Clear the composer now that the request is en route (CODE-04). On
      // error the field is left alone (see catch + error event) so the user
      // can retry with the same text without retyping.
      setQuestion("");
      for await (const { event, data } of parseSse(resp)) {
        if (event === "tool_start") {
          setToolTrail((prev) => [...prev, { tool: data.tool, summary: data.summary, input: data.input }]);
        } else if (event === "tool_end") {
          setToolTrail((prev) => {
            const next = [...prev];
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
      setPhase((p) => (p === "streaming" ? "error" : p));
      setErrorInfo((e) => e || { kind: "stream_closed", message: "Sous closed the connection unexpectedly." });
    } catch (err) {
      if (controller.signal.aborted) return;
      setErrorInfo({ kind: "network", message: err?.message || "Network error." });
      setPhase("error");
    } finally {
      abortRef.current = null;
    }
  }, [submitting]);

  const onFormSubmit = (e) => { e.preventDefault(); submitAsk(question); };
  const onExampleClick = (q) => { setQuestion(q); submitAsk(q); };
  const onRetry = () => { if (question.trim()) submitAsk(question); };
  const onNewQuestion = () => {
    setQuestion("");
    setPhase("idle");
    setAnswerText("");
    setDoneEnv(null);
    setErrorInfo(null);
    setToolTrail([]);
    setAskedQuestion("");
    setFeedbackState(null);
    if (inputRef.current) inputRef.current.focus();
  };

  const onFeedbackClick = useCallback((value) => {
    if (!doneEnv?.question_id) return;
    if (value === 1) {
      // Thumbs up: single POST, no panel.
      fetch("/api/sousai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "feedback", question_id: doneEnv.question_id, value: 1 }),
      }).catch(() => { /* silent */ });
      setFeedbackState("sent-pos");
    } else {
      setFeedbackState("panel");
    }
  }, [doneEnv]);

  const onToggleTag = (tagId) => {
    setSelectedTags((prev) => prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]);
  };

  const onSendFeedback = useCallback(async () => {
    if (!doneEnv?.question_id) return;
    try {
      await fetch("/api/sousai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "feedback",
          question_id: doneEnv.question_id,
          value: -1,
          tags: selectedTags,
          comment: feedbackText.trim() || null,
        }),
      });
    } catch { /* silent */ }
    setFeedbackState("sent-neg");
  }, [doneEnv, selectedTags, feedbackText]);

  const onSkipFeedback = () => { setFeedbackState("skipped"); };

  const onCopyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(answerText);
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1600);
    } catch { /* silent */ }
  };

  // CSV export from any table in the answer body. Extracts the FIRST
  // rendered table via DOMParser (no dep) - answerText is markdown, mdLite
  // renders pipe tables to <table>.
  const onDownloadCsv = () => {
    if (typeof window === "undefined") return;
    const html = renderMdLite(answerText);
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
    const table = doc.querySelector("table");
    if (!table) return;
    const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
      Array.from(tr.querySelectorAll("th,td")).map((c) => {
        const t = (c.textContent || "").replace(/"/g, '""').trim();
        return /[",\n]/.test(t) ? `"${t}"` : t;
      })
    );
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sous-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const status = doneEnv?.status || (phase === "error" ? "error" : phase === "streaming" ? "streaming" : "grounded");
  const statusLabel = STATUS_LABEL[status] || "Answer";

  // Status-companion mark state (spec §8). Turn while tools run; on done it
  // settles/holds/declines to match the pill. Error re-uses the "off" hollow
  // treatment since the spec has no error frame.
  const markState = phase === "streaming"
    ? "turn"
    : status === "grounded"
      ? "settled"
      : status === "partial"
        ? "part"
        : status === "declined" || status === "error"
          ? "off"
          : "rest";

  const provenance = useMemo(() => {
    if (phase === "streaming") {
      const last = toolTrail[toolTrail.length - 1];
      return { streaming: true, text: last?.summary ? `${last.summary}...` : "Thinking..." };
    }
    if (phase === "done") {
      const total = startedAtRef.current ? Date.now() - startedAtRef.current : null;
      const nTools = toolTrail.length;
      const sources = Array.isArray(doneEnv?.sources) ? doneEnv.sources : [];
      const parts = [];
      if (nTools) parts.push(`${nTools} tool${nTools === 1 ? "" : "s"}`);
      if (total != null) parts.push(formatMs(total));
      if (sources.length) parts.push(`sources: ${sources.join(", ")}`);
      return { streaming: false, text: parts.join(" · ") };
    }
    return null;
  }, [phase, toolTrail, doneEnv]);

  const hasTable = /\|.+\|/.test(answerText);   // pipe-table heuristic

  // ── Rail (page variant only) ─────────────────────────────────────────────
  const railEl = !isOverlay && (
    <aside className="sa-rail" aria-label="Session history">
      <div className="sa-rail-head">
        <button type="button" className="sa-rail-newbtn" onClick={onNewQuestion}>
          <span className="sa-rail-newbtn-lead">
            <Plus size={14} strokeWidth={2.4} />
            <span>New question</span>
          </span>
          <span className="sa-rail-newbtn-kbd" aria-hidden="true">⌘K</span>
        </button>
      </div>
      <div className="sa-rail-scroll">
        <p className="sa-rail-heading">This session</p>
        {sessionTurns.length === 0 ? (
          <div className="sa-rail-empty">
            <b>Nothing yet</b>
            Questions you ask will collect here.
          </div>
        ) : (
          <>
            <ul className="sa-rail-list">
              {sessionTurns.slice(0, IN_CONTEXT_WINDOW).map((t, i) => (
                <li key={t.id}>
                  {i === 0 && (
                    <span
                      className="sa-rail-incontext-marker"
                      title="Sous can refer back to these three (presentation only in PR A - true after PR B ships memory)."
                    >
                      In context
                    </span>
                  )}
                  <button
                    type="button"
                    className={`sa-rail-item sa-rail-item--incontext${askedQuestion === t.question ? " sa-rail-item--selected" : ""}`}
                    onClick={() => { setQuestion(t.question); }}
                  >
                    <span className="sa-rail-item-time">{formatTime(t.at)}</span>
                    <span className="sa-rail-item-q">{truncate(t.question, 40)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {sessionTurns.length > IN_CONTEXT_WINDOW && (
              <>
                <div className="sa-rail-context-boundary" />
                <ul className="sa-rail-list">
                  {sessionTurns.slice(IN_CONTEXT_WINDOW).map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={`sa-rail-item sa-rail-item--outside-context${askedQuestion === t.question ? " sa-rail-item--selected" : ""}`}
                        onClick={() => { setQuestion(t.question); }}
                      >
                        <span className="sa-rail-item-time">{formatTime(t.at)}</span>
                        <span className="sa-rail-item-q">{truncate(t.question, 40)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
      <p className="sa-rail-footer">Session only - clears when you reload.</p>
    </aside>
  );

  // ── First-run block V2 (simplified briefing, ratified U1) ────────────────
  // One elevated card, four domain rows, limits copy in the card's footer.
  // Icons: book/users/calendar/receipt in each module's own accent. Counts
  // fall back to a "live" / "on file" label if the read failed. Example chip
  // right-aligned per row - reuses the wired onExampleClick path.
  const firstRunEl = !isOverlay && !hasAnswer && (
    <div className="sa-firstrun">
      <p className="sa-firstrun-lead">What can I look up for you?</p>
      <p className="sa-firstrun-tag">Every answer names its source. Sous declines rather than guessing.</p>
      <div className="sa-brief">
        <BriefRow
          modifier="pb"
          icon={<BookOpen size={14} strokeWidth={2} aria-hidden="true" />}
          title="Playbook"
          count={domainCounts.playbook != null ? `${domainCounts.playbook} live` : "live"}
          example={(domainExamples.playbook || [])[0]}
          onExampleClick={onExampleClick}
        />
        <BriefRow
          modifier="pp"
          icon={<Users size={14} strokeWidth={2} aria-hidden="true" />}
          title="People"
          count={domainCounts.people != null ? `${domainCounts.people} on file` : "on file"}
          example={(domainExamples.people || [])[0]}
          onExampleClick={onExampleClick}
        />
        <BriefRow
          modifier="sc"
          icon={<Calendar size={14} strokeWidth={2} aria-hidden="true" />}
          title="Service Calendar"
          count={domainCounts.sc != null ? `${domainCounts.sc} accounts` : "live"}
          example={(domainExamples.sc || [])[0]}
          onExampleClick={onExampleClick}
        />
        <BriefRow
          modifier="ops"
          icon={<Receipt size={14} strokeWidth={2} aria-hidden="true" />}
          title="Spend"
          count={domainCounts.spend != null ? `${domainCounts.spend} vendors` : "live"}
          example={(domainExamples.spend || [])[0]}
          onExampleClick={onExampleClick}
        />
        <p className="sa-brief-limits">
          <strong>Not yet:</strong> no wages, no reimbursements, no P&amp;L yet - all coming. Current season only: ask about 2024 and the number will look right and be wrong.
        </p>
      </div>
    </div>
  );

  // ── Turn (answer card) ───────────────────────────────────────────────────
  const turnEl = hasAnswer && (
    <article className="sa-turn" aria-live="polite">
      {askedQuestion && <p className="sa-question">{askedQuestion}</p>}
      <div className={`sa-answer sa-answer--${status}`}>
        <div className="sa-answer-head">
          <SousMark variant="small" state={markState} size={19} />
          <span className={`sa-status-pill sa-status-pill--${status}`}>{statusLabel}</span>
        </div>
        {phase === "streaming" && toolTrail.length > 0 && (
          <div className="sa-tooltrail">
            {toolTrail.map((t, i) => (
              <div key={i} className="sa-tooltrail-item">
                <span className="sa-tooltrail-tool">{t.tool}</span>
                <span className="sa-tooltrail-summary">{typeof t.summary === "string" ? t.summary : ""}</span>
                {t.ms != null && <span className="sa-tooltrail-ms">{formatMs(t.ms)}</span>}
              </div>
            ))}
          </div>
        )}
        {phase === "error" ? (
          <div className="sa-answer-body">
            <p>{errorInfo?.message || "Sous did not answer."}</p>
            <button type="button" className="sa-action-btn" onClick={onRetry}>Retry</button>
          </div>
        ) : (
          <div className="sa-answer-body" dangerouslySetInnerHTML={{ __html: renderMdLite(answerText) }} />
        )}

        {Array.isArray(doneEnv?.sources) && doneEnv.sources.length > 0 && (
          <div className="sa-sources">
            {doneEnv.sources.map((docId) => (
              <a
                key={docId}
                className="sa-source-card"
                href={`/playbook/d/${encodeURIComponent(docId)}`}
                target="_blank"
                rel="noopener"
              >
                <span className="sa-source-idchip">{docId}</span>
                <span className="sa-source-title">{docId}</span>
                <ExternalLink size={13} className="sa-source-go" aria-hidden="true" />
              </a>
            ))}
          </div>
        )}

        {provenance && (
          <p className={`sa-provenance${provenance.streaming ? " sa-provenance--streaming" : ""}`}>
            <span className="sa-provenance-dot" aria-hidden="true" />
            <span>{provenance.text}</span>
          </p>
        )}

        {phase === "done" && doneEnv?.question_id && feedbackState !== "panel" && (
          <div className="sa-actions">
            <button type="button" className="sa-action-btn" onClick={onCopyAnswer} aria-label="Copy answer">
              <Copy size={13} aria-hidden="true" /> {copyOk ? "Copied" : "Copy"}
            </button>
            {hasTable && (
              <button type="button" className="sa-action-btn" onClick={onDownloadCsv} aria-label="Download table as CSV">
                <Download size={13} aria-hidden="true" /> CSV
              </button>
            )}
            <button
              type="button"
              className={`sa-action-btn${feedbackState === "sent-pos" ? " sa-action-btn--pressed" : ""}`}
              onClick={() => onFeedbackClick(1)}
              disabled={feedbackState != null}
              aria-label="Helpful"
            >
              <ThumbsUp size={13} aria-hidden="true" /> Helpful
            </button>
            <button
              type="button"
              className={`sa-action-btn${feedbackState === "sent-neg" ? " sa-action-btn--pressed" : ""}`}
              onClick={() => onFeedbackClick(-1)}
              disabled={feedbackState != null && feedbackState !== -1}
              aria-label="Not helpful"
            >
              <ThumbsDown size={13} aria-hidden="true" /> Not helpful
            </button>
            {feedbackState === "sent-pos" && <span className="sa-feedback-note">Thanks - logged.</span>}
            {feedbackState === "sent-neg" && <span className="sa-feedback-note">Feedback sent.</span>}
            {feedbackState === "skipped" && <span className="sa-feedback-note">Skipped.</span>}
          </div>
        )}

        {feedbackState === "panel" && (
          <div className="sa-feedback-panel">
            <p className="sa-feedback-title">What went wrong?</p>
            <div className="sa-feedback-tags" role="group" aria-label="Failure tags">
              {FEEDBACK_TAGS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`sa-feedback-tag${selectedTags.includes(t.id) ? " sa-feedback-tag--on" : ""}`}
                  aria-pressed={selectedTags.includes(t.id)}
                  onClick={() => onToggleTag(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              className="sa-feedback-text"
              placeholder="Any detail that would help - optional"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              maxLength={2000}
            />
            <p className="sa-feedback-note">Logged with the question + tools + sources.</p>
            <div className="sa-feedback-actions">
              <button
                type="button"
                className="sa-feedback-send"
                onClick={onSendFeedback}
                disabled={selectedTags.length === 0 && !feedbackText.trim()}
              >
                Send feedback
              </button>
              <button type="button" className="sa-feedback-skip" onClick={onSkipFeedback}>Skip</button>
            </div>
          </div>
        )}
      </div>
    </article>
  );

  // ── Composer ─────────────────────────────────────────────────────────────
  const composerEl = (
    <div className="sa-composer">
      <form className="sa-ask-form" onSubmit={onFormSubmit}>
        <div className="sa-ask-row">
          <input
            ref={inputRef}
            type="text"
            className="sa-ask-input"
            placeholder="Ask about a policy, a person, an account, a number..."
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
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>
      </form>
    </div>
  );

  if (isOverlay) {
    return (
      <div className="sa-overlay-wrap">
        <div className="sa-overlay-body-scroll">
          {turnEl}
        </div>
        <div className="sa-overlay-foot">{composerEl}</div>
      </div>
    );
  }

  return (
    <>
      {heroSlot}
      <div className="sa-workspace">
        {railEl}
        <main className="sa-main">
          <div className="sa-pane-scroll">
            <div className="sa-pane">
              {firstRunEl}
              {turnEl}
            </div>
          </div>
          {composerEl}
        </main>
      </div>
    </>
  );
}

function BriefRow({ modifier, icon, title, count, example, onExampleClick }) {
  return (
    <div className={`sa-brow sa-brow--${modifier}`}>
      <span className="sa-brow-icon">{icon}</span>
      <span className="sa-brow-title">{title}</span>
      <span className="sa-brow-count">{count}</span>
      {example && (
        <button type="button" className="sa-brow-example" onClick={() => onExampleClick(example)}>
          {example}
        </button>
      )}
    </div>
  );
}

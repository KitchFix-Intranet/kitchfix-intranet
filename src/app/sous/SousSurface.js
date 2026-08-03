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

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  Copy, Download, ThumbsUp, ThumbsDown, Plus, ArrowUp, ExternalLink,
  BookOpen, Users, Calendar, Receipt, RotateCcw,
} from "lucide-react";
import { renderMdLite } from "./mdLite";
import SousMark from "./SousMark";
import SousLockup from "./SousLockup";

const IN_CONTEXT_WINDOW = 3;   // Matches PR B's memory window.

const FEEDBACK_TAGS = [
  { id: "wrong_number",         label: "Wrong number" },
  { id: "missing_information",  label: "Missing information" },
  { id: "wrong_document",       label: "Wrong document" },
  { id: "out_of_date",          label: "Out of date" },
  { id: "hard_to_follow",       label: "Hard to follow" },
  { id: "should_have_declined", label: "Should have declined" },
  // R3-10 (Kevin ruling) - seventh tag added after should_have_declined
  // so the taxonomy covers the calibration case ("the status label is
  // wrong") without a detail-only path. Payload plumbing identical.
  { id: "wrong_status_label",   label: "Wrong status label" },
];

const STATUS_LABEL = {
  grounded: "Grounded",
  partial: "Partial",
  declined: "Declined",
  error: "Error",
  streaming: "Thinking",
};

// Reason chip mapping for PARTIAL answers. The route.js done envelope now
// carries `flags` + `truncated` from the agent's downgrade computation;
// the UI translates the first one that fires into a human-readable
// sentence. Priority: truncated > phantom_citation > grounded_without_
// sources > U9 fallback ("some sections could not be verified").
function partialReason(doneEnv) {
  if (!doneEnv) return null;
  if (doneEnv.truncated) return "Answer was cut short";
  const flags = Array.isArray(doneEnv.flags) ? doneEnv.flags : [];
  for (const f of flags) {
    if (f?.phantom_citation) return "A citation could not be verified";
    if (f?.grounded_without_sources) return "Sources could not be confirmed";
  }
  return "Some sections could not be verified";
}

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
  // R3-CODE-14: timezone abbrev now shows on the rail so a distant reader
  // (or a copy-pasted debug transcript) doesn't guess UTC vs local.
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
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

const SousSurface = forwardRef(function SousSurface({
  chips = null,
  variant = "page",
  initialQuestion = "",
  autoFocus = false,
  heroSlot = null,
  domainCounts = {},
  domainExamples = {},
  onFirstAsk = null,
}, ref) {
  const isOverlay = variant === "overlay";
  // Fires once per mount when the first ask (chip, imperative, or typed)
  // goes out. Panel uses it to hide its starter block per R3-08.
  const firstAskFiredRef = useRef(false);
  const [question, setQuestion] = useState(initialQuestion);
  const [phase, setPhase] = useState("idle");
  const [answerText, setAnswerText] = useState("");
  const [toolTrail, setToolTrail] = useState([]);
  const [doneEnv, setDoneEnv] = useState(null);
  const [errorInfo, setErrorInfo] = useState(null);
  const [askedQuestion, setAskedQuestion] = useState("");
  // Session rail entries. Client-held only. Session-only per D8 / rail
  // footer contract. Entry shape:
  //   { id, at, question, answer?, status? }
  // answer + status are added when the ask completes (done event).
  const [sessionTurns, setSessionTurns] = useState([]);
  // PR B memory: last-3 Q&A pairs to send as prior turns on the NEXT ask.
  // Chronological order (oldest first) so the agent prepends cleanly as
  // user/assistant alternation. New Question / ⌘K clears; on done, append
  // and cap at 3. Rail IN CONTEXT marker binds to turns whose id is in
  // memoryPairs.
  const [memoryPairs, setMemoryPairs] = useState([]);
  const memoryIds = useMemo(() => new Set(memoryPairs.map((p) => p._turnId)), [memoryPairs]);
  // Feedback state - null | 1 | -1 | 'panel' (showing tag picker) | 'sent'
  const [feedbackState, setFeedbackState] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [feedbackText, setFeedbackText] = useState("");
  const [copyOk, setCopyOk] = useState(false);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const startedAtRef = useRef(null);
  // 2026-08-02: pane-scroll region owns the only scroll container on the
  // page variant. paneScrollRef targets it for (a) on-submit scroll-to-top
  // (new turn's question header lands at the top so long answers read
  // top-down) and (b) the .sa-fab-scroll-top button below.
  const paneScrollRef = useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => { if (autoFocus && inputRef.current) inputRef.current.focus(); }, [autoFocus]);

  // Toggle the scroll-top FAB when the pane region scrolls past 200px.
  // Only active on the page variant - the panel has its own scroll shell
  // (.sa-overlay-body-scroll) and doesn't need a FAB at its size.
  useEffect(() => {
    const el = paneScrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 200);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [variant]);

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
    if (!firstAskFiredRef.current && typeof onFirstAsk === "function") {
      firstAskFiredRef.current = true;
      onFirstAsk();
    }
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
    // 2026-08-02: scroll the pane region to the top so the question
    // header (which renders inside .sa-turn at the top of .sa-pane) is
    // top-anchored. Long answers then read top-down, and follow-up asks
    // reset the reading position rather than leaving the user mid-scroll
    // from the previous turn. No-op on the panel variant (paneScrollRef
    // stays null there).
    if (paneScrollRef.current) paneScrollRef.current.scrollTop = 0;
    // Prepend to session rail. turnId is captured here so the done handler
    // can attach the answer back to the correct entry (setSessionTurns runs
    // async; using a ref-like capture keeps the append targeted).
    const turnId = `t${Date.now()}`;
    setSessionTurns((prev) => [{ id: turnId, at: new Date(), question: q }, ...prev]);

    // PR B memory: snapshot of prior turns to send with this ask.
    // memoryPairs already excludes anything from before the last New Question
    // / ⌘K clear. Ships Q&A text only; no meta, no trajectories, no sources.
    const priorTurnsForSend = memoryPairs.map((p) => ({ question: p.question, answer: p.answer }));
    // Local accumulator so the done handler can capture the final answer
    // without relying on React's async answerText state at that moment.
    let accumulatedAnswer = "";

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/sousai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ask", question: q, priorTurns: priorTurnsForSend }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        setErrorInfo({ kind: "http", message: `Request failed (${resp.status}).` });
        setPhase("error");
        // 2026-08-03 (Kevin ruling, #598 depth v2): transport-error paths
        // preserve the typed text AND return focus so the user can retry
        // with the same text without a second click. Success path (below)
        // clears then re-focuses naturally when phase moves to "done".
        inputRef.current?.focus();
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
          const t = data?.t || "";
          accumulatedAnswer += t;
          setAnswerText((prev) => prev + t);
        } else if (event === "error") {
          setErrorInfo({ kind: data?.kind || "unknown", message: data?.message || "Sous failed." });
          setPhase("error");
        } else if (event === "done") {
          const env = data || {};
          setDoneEnv(env);
          setPhase("done");
          // Attach answer + status back to the rail entry so the rail can
          // render the status dot next to the timestamp. accumulatedAnswer
          // is the final streamed content captured in local scope (avoids
          // React state async).
          setSessionTurns((prev) => prev.map((t) => (
            t.id === turnId ? { ...t, answer: accumulatedAnswer, status: env.status || "grounded" } : t
          )));
          // Append to memoryPairs (chronological order, cap at 3). Only
          // grounded / partial / declined answers count; errors don't
          // become context (the error state stays out of history).
          if (env.status) {
            setMemoryPairs((prev) => {
              const next = [...prev, { _turnId: turnId, question: q, answer: accumulatedAnswer }];
              return next.slice(-3);
            });
          }
        }
      }
      setPhase((p) => (p === "streaming" ? "error" : p));
      setErrorInfo((e) => e || { kind: "stream_closed", message: "Sous closed the connection unexpectedly." });
    } catch (err) {
      if (controller.signal.aborted) return;
      setErrorInfo({ kind: "network", message: err?.message || "Network error." });
      setPhase("error");
      // 2026-08-03 (Kevin ruling, #598 depth v2): transport failure -
      // preserve text + return focus so the user can retry-with-same.
      inputRef.current?.focus();
    } finally {
      abortRef.current = null;
    }
  }, [submitting]);

  // Imperative API for parents that need to fire an ask from an external
  // control (panel starter chips, R3-02). Fires the same submit path a
  // typed submission uses; onFirstAsk fires exactly once per mount.
  useImperativeHandle(ref, () => ({
    askQuestion: (q) => submitAsk(q),
  }), [submitAsk]);

  const onFormSubmit = (e) => { e.preventDefault(); submitAsk(question); };
  // 2026-08-03 (Kevin depth-v2 diagnosis): chip submit MUST NOT pre-populate
  // the composer. The prior form was `{ setQuestion(q); submitAsk(q); }` -
  // pre-set + later `setQuestion("")` on success were racing and the reset
  // failed to stick (live evidence: chip text persisted after settle).
  // Panel chips have always matched this pattern via
  // sousRef.current?.askQuestion(q) -> submitAsk(q) with no pre-set, and
  // they never showed the bug. Page path now matches panel path exactly.
  const onExampleClick = (q) => { submitAsk(q); };
  const onRetry = () => { if (question.trim()) submitAsk(question); };
  const onNewQuestion = () => {
    setQuestion("");
    setPhase("idle");
    setAnswerText("");
    setDoneEnv(null);
    setErrorInfo(null);
    setToolTrail([]);
    // PR B memory: New Question / ⌘K clears the memory window. Rail entries
    // stay visible (session history is nice-to-have), but IN CONTEXT
    // markers all disappear on the next render because memoryPairs is empty.
    setMemoryPairs([]);
    setAskedQuestion("");
    setFeedbackState(null);
    if (inputRef.current) inputRef.current.focus();
  };

  // R3-07 - window-level ⌘K / Ctrl+K listener. The rail's + New question
  // button carries a ⌘K badge that was previously decorative (no listener);
  // now it works regardless of focus location. Modal guard: if a dialog
  // with aria-modal="true" is open, only the SousSurface INSIDE that
  // dialog responds (so the panel's ⌘K doesn't also fire the page's).
  const newQuestionRef = useRef(onNewQuestion);
  newQuestionRef.current = onNewQuestion;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const myInput = inputRef.current;
      if (!myInput) return;
      const modalOpen = typeof document !== "undefined" && document.querySelector('[aria-modal="true"]');
      if (modalOpen && !modalOpen.contains(myInput)) return;
      e.preventDefault();
      if (isOverlay) {
        myInput.focus();
        myInput.select?.();
      } else {
        // Page: mirror the + New question rail button (reset + focus).
        newQuestionRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOverlay]);

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
  // Status-companion mark removed for r2 hotfix - the 19px mark rendered at
  // .sa-answer-head's top-left overlapped the status rail and got clipped by
  // the card's border-radius. Correct placement (inside the tool-trail well)
  // ships with the design round.

  const provenance = useMemo(() => {
    if (phase === "streaming") {
      // Generic stage indicator - the per-tool detail lives in the trail
      // above, so the companion never repeats "list_contacts_by_role" from
      // the last tool_start event.
      return { streaming: true, text: "Working..." };
    }
    if (phase === "done") {
      const total = startedAtRef.current ? Date.now() - startedAtRef.current : null;
      const nTools = toolTrail.length;
      const sources = Array.isArray(doneEnv?.sources) ? doneEnv.sources : [];
      const parts = [];
      if (nTools) parts.push(`${nTools} tool${nTools === 1 ? "" : "s"}`);
      if (total != null) parts.push(formatMs(total));
      // I2 hydrated sources to {docId, title}; normalise back to id strings
      // for the meta row before joining so we never render "[object Object]".
      const ids = sources.map((s) => typeof s === "string" ? s : s?.docId).filter(Boolean);
      if (ids.length) parts.push(`sources: ${ids.join(", ")}`);
      return { streaming: false, text: parts.join(" · ") };
    }
    return null;
  }, [phase, toolTrail, doneEnv]);

  const hasTable = /\|.+\|/.test(answerText);   // pipe-table heuristic

  // ── Rail (page variant only) ─────────────────────────────────────────────
  const railEl = !isOverlay && (
    <aside className="sa-rail" aria-label="Session history">
      <div className="sa-rail-head">
        <button type="button" className="sa-rail-newbtn" onClick={onNewQuestion} aria-label="New question">
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
        ) : (() => {
          // PR B rail truthfulness: IN CONTEXT marker binds to turns whose
          // id is in memoryPairs (the actual context window). New Question /
          // ⌘K clears memoryPairs, so all markers disappear until fresh
          // asks land. Status dots per item render on completion.
          const inContext = sessionTurns.filter((t) => memoryIds.has(t.id));
          const outsideContext = sessionTurns.filter((t) => !memoryIds.has(t.id));
          const renderRow = (t, extraClass) => (
            <li key={t.id}>
              {/* 2026-08-03 (Kevin rail-honesty ruling, #598): rail item's
                  primary click does nothing - the item is a session log
                  entry, not a re-ask shortcut. Ask-again lives on a
                  dedicated icon button (revealed on hover, always present
                  for keyboard focus). The turn-stack scroll-to-card
                  behaviour lands in its own follow-up PR. */}
              <div
                className={`sa-rail-item ${extraClass}${askedQuestion === t.question ? " sa-rail-item--selected" : ""}`}
              >
                <span className="sa-rail-item-meta">
                  {t.status && (
                    <span
                      className={`sa-rail-status-dot sa-rail-status-dot--${t.status}`}
                      aria-label={`status ${t.status}`}
                    />
                  )}
                  <span className="sa-rail-item-time">{formatTime(t.at)}</span>
                </span>
                <span className="sa-rail-item-q">{truncate(t.question, 40)}</span>
                <button
                  type="button"
                  className="sa-rail-item-askagain"
                  aria-label="Ask this again"
                  onClick={() => {
                    setQuestion(t.question);
                    inputRef.current?.focus();
                  }}
                >
                  <RotateCcw size={12} aria-hidden="true" />
                </button>
              </div>
            </li>
          );
          return (
            <>
              {inContext.length > 0 && (
                <ul className="sa-rail-list">
                  {inContext.map((t, i) => (
                    <React.Fragment key={t.id}>
                      {i === 0 && (
                        <li aria-hidden="true">
                          <span
                            className="sa-rail-incontext-marker"
                            title="Sous can refer back to these turns (memory window - clears on New question or ⌘K)."
                          >
                            In context
                          </span>
                          {/* 2026-08-03 (Kevin rail-honesty ruling, #598):
                              one-line explanation of what IN CONTEXT means,
                              rendered in the rail's mono/label scale in
                              #475569 to sit quietly under the marker. */}
                          <span className="sa-rail-incontext-hint">Sous remembers these three.</span>
                        </li>
                      )}
                      {renderRow(t, "sa-rail-item--incontext")}
                    </React.Fragment>
                  ))}
                </ul>
              )}
              {inContext.length > 0 && outsideContext.length > 0 && (
                <div className="sa-rail-context-boundary" />
              )}
              {outsideContext.length > 0 && (
                <ul className="sa-rail-list">
                  {outsideContext.map((t) => renderRow(t, "sa-rail-item--outside-context"))}
                </ul>
              )}
            </>
          );
        })()}
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
      <SousLockup>
        <p className="sa-firstrun-lead">What can I look up for you?</p>
        <p className="sa-firstrun-tag">Every answer names its source. Sous declines rather than guessing. Sous can make mistakes - always verify against the sources.</p>
      </SousLockup>
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
          No wages, no reimbursements, no HR or Legal sensitive information. P&amp;L + KPIs coming soon. Current 2026 season only. Past data pending.
        </p>
      </div>
    </div>
  );

  // ── Turn (answer card) - QA-2 docked header ──────────────────────────────
  // Round 2 restructure: the question line moves INTO the card as a tinted
  // header (teal micro-bar + question + status pill on one row). Reason chip
  // sits directly below the header when PARTIAL. Streaming brings the status
  // companion back - 19px mark inside the tool-trail well, beside the
  // trajectory lines (never touching the rail this time). Provenance and
  // sources both live in interior-depth containers (.sa-well, .sa-source-row).
  const reasonText = status === "partial" ? partialReason(doneEnv) : null;
  const turnEl = hasAnswer && (
    <article className="sa-turn">
      <div className={`sa-answer sa-answer--${status}`}>
        {askedQuestion && (
          <div className="sa-answer-header">
            <span className="sa-question-bar" aria-hidden="true" />
            <span className="sa-question-text">{askedQuestion}</span>
            <span className={`sa-status-pill sa-status-pill--${status}`}>{statusLabel}</span>
          </div>
        )}
        {reasonText && (
          <div className="sa-reason-row">
            <span className="sa-reason-chip">{reasonText}</span>
          </div>
        )}
        {phase === "streaming" && toolTrail.length > 0 && (
          <div className="sa-well sa-tooltrail-well" role="status" aria-live="polite">
            <SousMark variant="small" state="turn" size={19} />
            <div className="sa-tooltrail">
              {toolTrail.map((t, i) => (
                <div key={i} className="sa-tooltrail-item">
                  <span className="sa-tooltrail-tool">{t.tool}</span>
                  <span className="sa-tooltrail-summary">{typeof t.summary === "string" ? t.summary : ""}</span>
                  {t.ms != null && <span className="sa-tooltrail-ms">{formatMs(t.ms)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {phase === "error" ? (
          <div className="sa-answer-body sa-answer-body--error" role="alert">
            <p className="sa-error-msg">{errorInfo?.message || "Sous did not answer."}</p>
            <button type="button" className="sa-action-btn sa-action-btn--tryagain" onClick={onRetry}>Try again</button>
          </div>
        ) : (
          <div className="sa-answer-body" aria-live="polite" dangerouslySetInnerHTML={{ __html: renderMdLite(answerText) }} />
        )}

        {Array.isArray(doneEnv?.sources) && doneEnv.sources.length > 0 && (
          <div className="sa-sources">
            {doneEnv.sources.map((s) => {
              // I2 - route.js hydrates sources to {docId, title}. Legacy
              // string shape still renders because we normalise here; when
              // title is missing or equals the id, render the chip alone.
              const docId = typeof s === "string" ? s : s?.docId;
              const rawTitle = typeof s === "string" ? null : s?.title;
              const showTitle = rawTitle && rawTitle !== docId;
              return (
                <a
                  key={docId}
                  className="sa-source-row"
                  href={`/playbook/d/${encodeURIComponent(docId)}`}
                  target="_blank"
                  rel="noopener"
                >
                  <span className="sa-source-idchip">{docId}</span>
                  {showTitle && <span className="sa-source-title">{rawTitle}</span>}
                  <ExternalLink size={13} className="sa-source-go" aria-hidden="true" />
                </a>
              );
            })}
          </div>
        )}

        {provenance && (
          <div className={`sa-well sa-provenance-well${provenance.streaming ? " sa-provenance-well--streaming" : ""}`}>
            <p className="sa-provenance">
              <span className="sa-provenance-dot" aria-hidden="true" />
              <span>{provenance.text}</span>
            </p>
          </div>
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
              aria-pressed={feedbackState === "sent-pos"}
            >
              <ThumbsUp size={13} aria-hidden="true" /> Helpful
            </button>
            <button
              type="button"
              className={`sa-action-btn${feedbackState === "sent-neg" ? " sa-action-btn--pressed" : ""}`}
              onClick={() => onFeedbackClick(-1)}
              disabled={feedbackState != null && feedbackState !== -1}
              aria-label="Not helpful"
              aria-pressed={feedbackState === "sent-neg"}
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
          <div className="sa-pane-scroll" ref={paneScrollRef}>
            <div className="sa-pane">
              {firstRunEl}
              {turnEl}
            </div>
          </div>
          <button
            type="button"
            className={`sa-fab-scroll-top${showScrollTop ? " sa-fab-scroll-top--visible" : ""}`}
            onClick={() => { if (paneScrollRef.current) paneScrollRef.current.scrollTo({ top: 0, behavior: "smooth" }); }}
            aria-label="Scroll to top of answer"
            tabIndex={showScrollTop ? 0 : -1}
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
          {composerEl}
        </main>
      </div>
    </>
  );
});
SousSurface.displayName = "SousSurface";
export default SousSurface;

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

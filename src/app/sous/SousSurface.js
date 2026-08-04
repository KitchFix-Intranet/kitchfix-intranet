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
  // 2026-08-04 (calibration round 2): zero_tool_no_check reads first
  // because it is the most specific description of what happened -
  // grounded_without_sources will also fire when tools=0 (they are
  // strict subsets), but "answered without checking a source" tells
  // the user WHY sources are missing.
  // 2026-08-04 (architecture ruling): receipt_miss for numeric figures
  // that didn't trace to the payload even after the runtime retry.
  // Reads before grounded_without_sources because it's the more
  // specific reason: the sources are fine, the FIGURES are the drift.
  for (const f of flags) {
    if (f?.zero_tool_no_check) return "Answered without checking a source this turn.";
    if (f?.receipt_miss) return "Some figures could not be verified against the data.";
    // 2026-08-04 (round 0b Part 5): multi-part completeness. Reads before
    // the generic phantom/grounded fallbacks because it's the most
    // specific description of what happened when only some sub-questions
    // were addressed.
    if (f?.incomplete_multipart) return "Part of your question could not be answered.";
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
  // Turn stack (2026-08-03): each entry now carries the FULL per-turn
  // state - the surface no longer holds a singleton "current" turn.
  // Turns are appended (oldest first, newest last) so the stack renders
  // chronologically. The last entry is the in-flight turn while it
  // streams; earlier entries render their stored settled state.
  //
  // Entry shape:
  //   {
  //     id, at, question, phase, status,
  //     answerText, toolTrail, doneEnv, errorInfo,
  //     feedbackState, selectedTags, feedbackText, copyOk,
  //     startedAt, durationMs,
  //   }
  //
  // Rail iterates the same array in reverse for the "newest first"
  // reading order it always had.
  const [sessionTurns, setSessionTurns] = useState([]);
  const currentTurn = sessionTurns.length > 0 ? sessionTurns[sessionTurns.length - 1] : null;
  const phase = currentTurn?.phase ?? "idle";
  const submitting = phase === "streaming";
  const hasAnswer = sessionTurns.length > 0;
  // Update a specific turn by id. Accepts either a patch object or a
  // (turn -> patch) function - the function form is needed for
  // token/tool_end events that read previous state.
  const updateTurn = useCallback((id, patchOrFn) => {
    setSessionTurns((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const patch = typeof patchOrFn === "function" ? patchOrFn(t) : patchOrFn;
      return { ...t, ...patch };
    }));
  }, []);
  // PR B memory: last-3 Q&A pairs to send as prior turns on the NEXT ask.
  // Chronological order (oldest first) so the agent prepends cleanly as
  // user/assistant alternation. New Question / ⌘K clears; on done, append
  // and cap at 3. Rail IN CONTEXT marker binds to turns whose id is in
  // memoryPairs. Memory window unchanged by the turn stack - the stack
  // may show more turns than memory holds.
  const [memoryPairs, setMemoryPairs] = useState([]);
  const memoryIds = useMemo(() => new Set(memoryPairs.map((p) => p._turnId)), [memoryPairs]);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  // 2026-08-02: pane-scroll region owns the only scroll container on the
  // page variant. paneScrollRef targets it for (a) on-submit scroll-to-
  // the-new-turn's-header and (b) the .sa-fab-scroll-top button below.
  const paneScrollRef = useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  // Pending scroll target - set by submitAsk (new turn) or by rail click
  // (jump-to-turn). Consumed by an effect that fires after the DOM has
  // rendered the target card so scrollIntoView actually finds it.
  const pendingScrollRef = useRef(null);

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

  // Turn-stack (2026-08-04): after sessionTurns commits, honour any
  // pending scroll target - either a freshly-submitted turn (via
  // submitAsk) or a rail-click jump (via onRailItemClick). We scroll the
  // pane region so the target card's question header is top-anchored,
  // and add a brief highlight class the CSS animates. `prefers-reduced-
  // motion` disables both the smooth-scroll and the flash (the scroll
  // still happens, just instantly and without the ring).
  useEffect(() => {
    if (!pendingScrollRef.current) return;
    const targetId = pendingScrollRef.current;
    pendingScrollRef.current = null;
    const el = typeof document !== "undefined" ? document.getElementById(`sa-turn-${targetId}`) : null;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    if (!reduce) {
      el.classList.add("sa-turn--just-navigated");
      window.setTimeout(() => { el.classList.remove("sa-turn--just-navigated"); }, 1200);
    }
  }, [sessionTurns]);

  // Rail-click navigation (Part 2). Primary click on a rail item scrolls
  // the region to that turn's card. The pending-scroll effect above
  // consumes the request on the next render tick - useState no-op forces
  // a re-render so the effect fires even when sessionTurns is unchanged.
  const [navTick, setNavTick] = useState(0);
  const onRailItemClick = useCallback((turnId) => {
    pendingScrollRef.current = turnId;
    setNavTick((n) => n + 1);
  }, []);
  useEffect(() => {
    if (navTick === 0) return;
    if (!pendingScrollRef.current) return;
    const targetId = pendingScrollRef.current;
    pendingScrollRef.current = null;
    const el = typeof document !== "undefined" ? document.getElementById(`sa-turn-${targetId}`) : null;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    if (!reduce) {
      el.classList.add("sa-turn--just-navigated");
      window.setTimeout(() => { el.classList.remove("sa-turn--just-navigated"); }, 1200);
    }
  }, [navTick]);

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

  const submitAsk = useCallback(async (rawQuestion) => {
    const q = String(rawQuestion || "").trim();
    if (!q || submitting) return;
    if (!firstAskFiredRef.current && typeof onFirstAsk === "function") {
      firstAskFiredRef.current = true;
      onFirstAsk();
    }
    // Turn-stack (2026-08-04): append a brand-new turn object to
    // sessionTurns. The stack renders chronologically; the new turn
    // lands at the bottom. Every field starts empty and gets populated
    // by the stream events below.
    const turnId = `t${Date.now()}`;
    const startedAt = Date.now();
    setSessionTurns((prev) => [...prev, {
      id: turnId,
      at: new Date(),
      question: q,
      phase: "streaming",
      status: null,
      answerText: "",
      toolTrail: [],
      doneEnv: null,
      errorInfo: null,
      feedbackState: null,
      selectedTags: [],
      feedbackText: "",
      copyOk: false,
      startedAt,
      durationMs: null,
    }]);
    // Ask the scroll effect (below) to bring the new card's question
    // header to the top of the pane region once React commits the new
    // <article>. Replaces the pre-turn-stack `scrollTop = 0` reset.
    pendingScrollRef.current = turnId;

    // PR B memory: snapshot of prior turns to send with this ask.
    // memoryPairs already excludes anything from before the last New
    // Question / ⌘K clear. Ships Q&A text only; no meta, no trajectories,
    // no sources. Memory window is still capped at 3 - the visible stack
    // can hold more.
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
        updateTurn(turnId, {
          phase: "error",
          errorInfo: { kind: "http", message: `Request failed (${resp.status}).` },
          durationMs: Date.now() - startedAt,
        });
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
          updateTurn(turnId, (t) => ({
            toolTrail: [...t.toolTrail, { tool: data.tool, summary: data.summary, input: data.input }],
          }));
        } else if (event === "tool_end") {
          updateTurn(turnId, (t) => {
            const next = [...t.toolTrail];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].tool === data.tool && next[i].ms == null) {
                next[i] = { ...next[i], ms: data.ms };
                break;
              }
            }
            return { toolTrail: next };
          });
        } else if (event === "token") {
          const t = data?.t || "";
          accumulatedAnswer += t;
          updateTurn(turnId, (tt) => ({ answerText: tt.answerText + t }));
        } else if (event === "retry_reset") {
          // 2026-08-04 (calibration round 2): agent-loop rejected a
          // zero-tool citation-bearing first attempt and is retrying
          // with a tool-nudge. Wipe what streamed so far - the retry's
          // text is the shipped answer, not concatenated to the
          // rejected attempt.
          //
          // 2026-08-04 (round 0b Part 1.3): PRESERVE toolTrail. The
          // wire event fires for both retry classes:
          //   - zero-tool citation retry - first attempt had 0 tools,
          //     wiping toolTrail leaves toolTrail=[] and the retry's
          //     tool events repopulate it correctly. No-op change.
          //   - numeric-receipt retry - first attempt had N tools that
          //     grounded the retry answer (the model reads the previous
          //     tool_result content from the message log). Wiping meant
          //     the shipped meta showed "0 tools" for an answer that
          //     used N. Preserving keeps the count truthful.
          accumulatedAnswer = "";
          updateTurn(turnId, { answerText: "" });
        } else if (event === "error") {
          updateTurn(turnId, {
            phase: "error",
            errorInfo: { kind: data?.kind || "unknown", message: data?.message || "Sous failed." },
            durationMs: Date.now() - startedAt,
          });
        } else if (event === "done") {
          const env = data || {};
          updateTurn(turnId, {
            phase: "done",
            status: env.status || "grounded",
            doneEnv: env,
            durationMs: Date.now() - startedAt,
          });
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
      // Stream ended without a done event - mark this turn as an error
      // (only if it's still streaming; done/error already terminal).
      updateTurn(turnId, (t) => {
        if (t.phase !== "streaming") return {};
        return {
          phase: "error",
          errorInfo: { kind: "stream_closed", message: "Sous closed the connection unexpectedly." },
          durationMs: Date.now() - startedAt,
        };
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      updateTurn(turnId, {
        phase: "error",
        errorInfo: { kind: "network", message: err?.message || "Network error." },
        durationMs: Date.now() - startedAt,
      });
      // 2026-08-03 (Kevin ruling, #598 depth v2): transport failure -
      // preserve text + return focus so the user can retry-with-same.
      inputRef.current?.focus();
    } finally {
      abortRef.current = null;
    }
  }, [submitting, memoryPairs, onFirstAsk, updateTurn]);

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
  // Retry the failed turn's question - fires a fresh ask, which appends a
  // new turn to the stack (the failed turn stays as history above).
  const onRetry = (turn) => { if (turn?.question) submitAsk(turn.question); };
  const onNewQuestion = () => {
    setQuestion("");
    // Turn-stack: New Question / ⌘K wipes the visible session log AND
    // the memory window. Every card unmounts, the rail is empty, and the
    // first-run landing renders again. Session is client-only so this is
    // reversible only by reload.
    setSessionTurns([]);
    setMemoryPairs([]);
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

  // Per-turn handlers (turn-stack, 2026-08-04). Every user action against
  // an older card carries THAT turn's ids and text; the surface never
  // reaches for singleton state. The feedback POST is the load-bearing
  // one - stack means older turns are still on screen and clickable, so
  // a payload mixup would credit feedback to the wrong question_id.
  const onFeedbackClick = useCallback((turn, value) => {
    if (!turn?.doneEnv?.question_id) return;
    if (value === 1) {
      // Thumbs up: single POST, no panel.
      fetch("/api/sousai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "feedback", question_id: turn.doneEnv.question_id, value: 1 }),
      }).catch(() => { /* silent */ });
      updateTurn(turn.id, { feedbackState: "sent-pos" });
    } else {
      updateTurn(turn.id, { feedbackState: "panel", selectedTags: [], feedbackText: "" });
    }
  }, [updateTurn]);

  const onToggleTag = useCallback((turn, tagId) => {
    updateTurn(turn.id, (t) => ({
      selectedTags: t.selectedTags.includes(tagId)
        ? t.selectedTags.filter((x) => x !== tagId)
        : [...t.selectedTags, tagId],
    }));
  }, [updateTurn]);

  const onSetFeedbackText = useCallback((turn, text) => {
    updateTurn(turn.id, { feedbackText: text });
  }, [updateTurn]);

  const onSendFeedback = useCallback(async (turn) => {
    if (!turn?.doneEnv?.question_id) return;
    try {
      await fetch("/api/sousai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "feedback",
          question_id: turn.doneEnv.question_id,
          value: -1,
          tags: turn.selectedTags,
          comment: turn.feedbackText.trim() || null,
        }),
      });
    } catch { /* silent */ }
    updateTurn(turn.id, { feedbackState: "sent-neg" });
  }, [updateTurn]);

  const onSkipFeedback = useCallback((turn) => {
    updateTurn(turn.id, { feedbackState: "skipped" });
  }, [updateTurn]);

  const onCopyAnswer = useCallback(async (turn) => {
    try {
      await navigator.clipboard.writeText(turn.answerText);
      updateTurn(turn.id, { copyOk: true });
      setTimeout(() => updateTurn(turn.id, { copyOk: false }), 1600);
    } catch { /* silent */ }
  }, [updateTurn]);

  // CSV export from any table in that turn's answer body. Extracts the
  // FIRST rendered table via DOMParser (no dep) - answerText is markdown,
  // mdLite renders pipe tables to <table>.
  const onDownloadCsv = useCallback((turn) => {
    if (typeof window === "undefined") return;
    const html = renderMdLite(turn.answerText);
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
  }, []);

  // Per-turn derivations moved from singleton into computeTurnDerived below.
  // Status-companion mark removed for r2 hotfix - the 19px mark rendered at
  // .sa-answer-head's top-left overlapped the status rail and got clipped by
  // the card's border-radius. Correct placement (inside the tool-trail well)
  // ships with the design round.

  // Given a turn state, derive the render-time bits (status label, provenance
  // meta row, table flag). Kept inline (not memoised) - the stack is small,
  // each call is a few field reads and a couple of loops.
  const computeTurnDerived = (turn) => {
    const turnStatus = turn.status || (turn.phase === "error" ? "error" : turn.phase === "streaming" ? "streaming" : "grounded");
    const turnStatusLabel = STATUS_LABEL[turnStatus] || "Answer";
    let turnProvenance = null;
    if (turn.phase === "streaming") {
      turnProvenance = { streaming: true, text: "Working..." };
    } else if (turn.phase === "done") {
      // Duration is captured at settle (turn.durationMs); fall back to the
      // live elapsed if durationMs is missing so the stat never reads "null".
      const total = turn.durationMs != null ? turn.durationMs : (turn.startedAt ? Date.now() - turn.startedAt : null);
      const nTools = turn.toolTrail.length;
      const sources = Array.isArray(turn.doneEnv?.sources) ? turn.doneEnv.sources : [];
      const parts = [];
      if (nTools) parts.push(`${nTools} tool${nTools === 1 ? "" : "s"}`);
      if (total != null) parts.push(formatMs(total));
      // I2 hydrated sources to {docId, title}; normalise back to id strings
      // for the meta row before joining so we never render "[object Object]".
      const ids = sources.map((s) => typeof s === "string" ? s : s?.docId).filter(Boolean);
      if (ids.length) parts.push(`sources: ${ids.join(", ")}`);
      turnProvenance = { streaming: false, text: parts.join(" · ") };
    }
    return {
      status: turnStatus,
      statusLabel: turnStatusLabel,
      provenance: turnProvenance,
      reasonText: turnStatus === "partial" ? partialReason(turn.doneEnv) : null,
      hasTable: /\|.+\|/.test(turn.answerText),
    };
  };

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
          //
          // 2026-08-04 (turn stack): sessionTurns is chronological (oldest
          // first, newest last) to match the stack render order. Rail
          // reads newest-first, so we .slice().reverse() before filtering.
          const railTurns = sessionTurns.slice().reverse();
          const inContext = railTurns.filter((t) => memoryIds.has(t.id));
          const outsideContext = railTurns.filter((t) => !memoryIds.has(t.id));
          // 2026-08-04 (turn stack Part 2): rail item's primary click now
          // jumps to that turn's card via onRailItemClick - the <button>
          // + cursor:pointer restored from #598's rail-honesty scope
          // (which correctly demoted them when there was no card to jump
          // to). Ask-again icon button retained exactly as shipped in
          // #598 - loads composer + focuses, no submit.
          const renderRow = (t, extraClass) => (
            // 2026-08-04 (turn stack): the ask-again <button> is a SIBLING
            // of the rail-item <button>, not nested inside it - <button>
            // in <button> is invalid HTML. The <li> becomes the position:
            // relative anchor so ask-again can float top-right of the row
            // exactly as shipped in #598.
            <li key={t.id} className="sa-rail-row">
              <button
                type="button"
                className={`sa-rail-item ${extraClass}`}
                onClick={() => onRailItemClick(t.id)}
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
              </button>
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
  // Turn-stack (2026-08-04): every entry in sessionTurns renders through
  // this helper. Shipped composition is identical to the pre-stack
  // singleton turnEl - question header + status pill, reason row (if
  // partial), streaming tool trail, body / error, source rows, provenance
  // well, actions row, feedback panel. Additions for the stack:
  //   - id={`sa-turn-${turn.id}`} for rail-click scroll targeting.
  //   - `.sa-turn--outside-context` when turn.id is not in memoryIds -
  //     muted status border + question header text (Part 3, chosen over
  //     the "not in context" label per the lighter-touch call).
  //   - All feedback / copy / csv handlers bind to THIS turn's data.
  const renderTurn = (turn) => {
    const d = computeTurnDerived(turn);
    const inContext = memoryIds.has(turn.id);
    const showActions = turn.phase === "done" && turn.doneEnv?.question_id && turn.feedbackState !== "panel";
    return (
      <article
        key={turn.id}
        id={`sa-turn-${turn.id}`}
        className={`sa-turn${inContext ? "" : " sa-turn--outside-context"}`}
      >
        <div className={`sa-answer sa-answer--${d.status}`}>
          <div className="sa-answer-header">
            <span className="sa-question-bar" aria-hidden="true" />
            <span className="sa-question-text">{turn.question}</span>
            <span className={`sa-status-pill sa-status-pill--${d.status}`}>{d.statusLabel}</span>
          </div>
          {d.reasonText && (
            <div className="sa-reason-row">
              <span className="sa-reason-chip">{d.reasonText}</span>
            </div>
          )}
          {turn.phase === "streaming" && turn.toolTrail.length > 0 && (
            <div className="sa-well sa-tooltrail-well" role="status" aria-live="polite">
              <SousMark variant="small" state="turn" size={19} />
              <div className="sa-tooltrail">
                {turn.toolTrail.map((tt, i) => (
                  <div key={i} className="sa-tooltrail-item">
                    <span className="sa-tooltrail-tool">{tt.tool}</span>
                    <span className="sa-tooltrail-summary">{typeof tt.summary === "string" ? tt.summary : ""}</span>
                    {tt.ms != null && <span className="sa-tooltrail-ms">{formatMs(tt.ms)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {turn.phase === "error" ? (
            <div className="sa-answer-body sa-answer-body--error" role="alert">
              <p className="sa-error-msg">{turn.errorInfo?.message || "Sous did not answer."}</p>
              <button type="button" className="sa-action-btn sa-action-btn--tryagain" onClick={() => onRetry(turn)}>Try again</button>
            </div>
          ) : (
            <div className="sa-answer-body" aria-live="polite" dangerouslySetInnerHTML={{ __html: renderMdLite(turn.answerText) }} />
          )}

          {Array.isArray(turn.doneEnv?.sources) && turn.doneEnv.sources.length > 0 && (
            <div className="sa-sources">
              {turn.doneEnv.sources.map((s) => {
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

          {d.provenance && (
            <div className={`sa-well sa-provenance-well${d.provenance.streaming ? " sa-provenance-well--streaming" : ""}`}>
              <p className="sa-provenance">
                <span className="sa-provenance-dot" aria-hidden="true" />
                <span>{d.provenance.text}</span>
              </p>
            </div>
          )}

          {showActions && (
            <div className="sa-actions">
              <button type="button" className="sa-action-btn" onClick={() => onCopyAnswer(turn)} aria-label="Copy answer">
                <Copy size={13} aria-hidden="true" /> {turn.copyOk ? "Copied" : "Copy"}
              </button>
              {d.hasTable && (
                <button type="button" className="sa-action-btn" onClick={() => onDownloadCsv(turn)} aria-label="Download table as CSV">
                  <Download size={13} aria-hidden="true" /> CSV
                </button>
              )}
              <button
                type="button"
                className={`sa-action-btn${turn.feedbackState === "sent-pos" ? " sa-action-btn--pressed" : ""}`}
                onClick={() => onFeedbackClick(turn, 1)}
                disabled={turn.feedbackState != null}
                aria-label="Helpful"
                aria-pressed={turn.feedbackState === "sent-pos"}
              >
                <ThumbsUp size={13} aria-hidden="true" /> Helpful
              </button>
              <button
                type="button"
                className={`sa-action-btn${turn.feedbackState === "sent-neg" ? " sa-action-btn--pressed" : ""}`}
                onClick={() => onFeedbackClick(turn, -1)}
                disabled={turn.feedbackState != null && turn.feedbackState !== -1}
                aria-label="Not helpful"
                aria-pressed={turn.feedbackState === "sent-neg"}
              >
                <ThumbsDown size={13} aria-hidden="true" /> Not helpful
              </button>
              {turn.feedbackState === "sent-pos" && <span className="sa-feedback-note">Thanks - logged.</span>}
              {turn.feedbackState === "sent-neg" && <span className="sa-feedback-note">Feedback sent.</span>}
              {turn.feedbackState === "skipped" && <span className="sa-feedback-note">Skipped.</span>}
            </div>
          )}

          {turn.feedbackState === "panel" && (
            <div className="sa-feedback-panel">
              <p className="sa-feedback-title">What went wrong?</p>
              <div className="sa-feedback-tags" role="group" aria-label="Failure tags">
                {FEEDBACK_TAGS.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={`sa-feedback-tag${turn.selectedTags.includes(tag.id) ? " sa-feedback-tag--on" : ""}`}
                    aria-pressed={turn.selectedTags.includes(tag.id)}
                    onClick={() => onToggleTag(turn, tag.id)}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
              <textarea
                className="sa-feedback-text"
                placeholder="Any detail that would help - optional"
                value={turn.feedbackText}
                onChange={(e) => onSetFeedbackText(turn, e.target.value)}
                maxLength={2000}
              />
              <p className="sa-feedback-note">Logged with the question + tools + sources.</p>
              <div className="sa-feedback-actions">
                <button
                  type="button"
                  className="sa-feedback-send"
                  onClick={() => onSendFeedback(turn)}
                  disabled={turn.selectedTags.length === 0 && !turn.feedbackText.trim()}
                >
                  Send feedback
                </button>
                <button type="button" className="sa-feedback-skip" onClick={() => onSkipFeedback(turn)}>Skip</button>
              </div>
            </div>
          )}
        </div>
      </article>
    );
  };

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
        <div className="sa-overlay-body-scroll" ref={paneScrollRef}>
          {sessionTurns.map(renderTurn)}
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
              {sessionTurns.map(renderTurn)}
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

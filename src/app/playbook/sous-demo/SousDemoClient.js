"use client";

// ════════════════════════════════════════════════════════════════════════════
// SousDemoClient · /playbook/sous-demo
// ════════════════════════════════════════════════════════════════════════════
//
// The chat demo surface. Streams answers from /api/playbook/sous-demo as
// NDJSON events: meta (sources + declined flag), text (chunk), done (usage),
// error. Renders Sous's voice progressively as the text events arrive.
//
// Markdown: Sous uses light bold (**...**) and italics (*...*). A small
// inline renderer below handles those + paragraph breaks. No external
// markdown lib pulled in for the demo.
//
// Auth: same pattern as AdminClient - GET /api/playbook?action=bootstrap on
// mount, check isOwner, render coming-soon stub for non-owners.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import "./sous-demo.css";

const SCRIPTED_QUESTIONS = [
  "What do I do if someone has an allergic reaction?",
  "What are the top 9 allergens?",
  "What's the procedure for a safety incident?",
  "What are the big rules?",
  "What form do I use when someone refuses medical treatment?",
];

export default function SousDemoClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [boot, setBoot] = useState(null);

  useEffect(() => {
    fetch("/api/playbook?action=bootstrap")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setBoot(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} />;
  if (!boot) return <ErrorState message="No data returned from bootstrap." />;
  if (!boot.isOwner) return <ComingSoonStub email={boot.email} />;

  return <SousChat email={boot.email} />;
}

// ─── State variants ─────────────────────────────────────────────────────────
function LoadingState() {
  return (
    <div className="pb-sous-loading">
      <div className="pb-sous-loading-dot" />
      <div className="pb-sous-loading-text">Loading Sous…</div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="pb-sous-error">
      <div className="pb-sous-error-title">Couldn&apos;t reach Sous</div>
      <div className="pb-sous-error-msg">{message}</div>
    </div>
  );
}

function ComingSoonStub({ email }) {
  return (
    <div className="pb-sous-stub">
      <div className="pb-sous-stub-card">
        <h1>Sous is in preview.</h1>
        <p>This surface is currently owner-only. Check back when SousAI ships to the team.</p>
        <p className="pb-sous-stub-email">Signed in as <strong>{email}</strong></p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SousChat - the actual demo surface
// ════════════════════════════════════════════════════════════════════════════
function SousChat({ email }) {
  // transcript: array of turns. Each turn is either { role:"user", question }
  // or { role:"sous", answer, sources, declined, usage }.
  const [transcript, setTranscript] = useState([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  // Streaming buffer for the in-flight Sous turn (before it lands in transcript).
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingMeta, setStreamingMeta] = useState(null);
  // Track whether the meta event has arrived yet (controls thinking vs streaming UI).
  const [streamingActive, setStreamingActive] = useState(false);
  const transcriptRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll the transcript to bottom on new content.
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript, streamingAnswer]);

  const handleSend = useCallback(
    async (questionOverride) => {
      const question = (questionOverride ?? input).trim();
      if (!question || thinking) return;
      setInput("");
      setThinking(true);
      setStreamingActive(false);
      setStreamingAnswer("");
      setStreamingMeta(null);
      setTranscript((prev) => [...prev, { role: "user", question }]);

      let bufferedAnswer = "";
      let capturedMeta = null;
      let capturedUsage = null;
      let captureErr = null;

      try {
        const response = await fetch("/api/playbook/sous-demo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          captureErr = errBody.error || `HTTP ${response.status}`;
        } else if (!response.body) {
          captureErr = "no response body";
        } else {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              let event;
              try {
                event = JSON.parse(trimmed);
              } catch {
                continue;
              }

              if (event.type === "meta") {
                capturedMeta = event;
                setStreamingMeta(event);
                setStreamingActive(true);
                setThinking(false);
              } else if (event.type === "text") {
                bufferedAnswer += event.chunk || "";
                setStreamingAnswer(bufferedAnswer);
              } else if (event.type === "done") {
                capturedUsage = event.usage || null;
              } else if (event.type === "error") {
                captureErr = event.message || "stream error";
              }
            }
          }
        }
      } catch (e) {
        captureErr = e?.message || "request failed";
      }

      // Commit the Sous turn to the transcript and clear the streaming state.
      setTranscript((prev) => [
        ...prev,
        {
          role: "sous",
          answer: bufferedAnswer,
          sources: capturedMeta?.sources_in_context || [],
          declined: capturedMeta?.declined || false,
          decline_reason: capturedMeta?.decline_reason || null,
          usage: capturedUsage,
          error: captureErr,
        },
      ]);
      setStreamingAnswer("");
      setStreamingMeta(null);
      setStreamingActive(false);
      setThinking(false);
      // Refocus input for the next question.
      setTimeout(() => inputRef.current?.focus(), 0);
    },
    [input, thinking]
  );

  return (
    <div className="pb-sous-wrap">
      {/* ── Top bar: back to admin ────────────────────────────────────────── */}
      <div className="pb-sous-topbar">
        <Link href="/playbook/admin" className="pb-sous-back" prefetch={false}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Build Dashboard
        </Link>
        <span className="pb-sous-preview-tag">Preview</span>
      </div>

      {/* ── Sous identity header ─────────────────────────────────────────── */}
      <header className="pb-sous-identity">
        <div className="pb-sous-mark" aria-hidden="true">
          <span className="pb-sous-mark-letter">S</span>
        </div>
        <div className="pb-sous-identity-text">
          <h1 className="pb-sous-name">Sous</h1>
          <p className="pb-sous-tag">
            KitchFix&apos;s internal expert. Knows the Playbook. Kitchen-floor English, source on every answer.
          </p>
        </div>
      </header>

      {/* ── Transcript ──────────────────────────────────────────────────── */}
      <div className="pb-sous-transcript-wrap" ref={transcriptRef}>
        <div className="pb-sous-transcript">
          {transcript.length === 0 && !thinking && !streamingActive && (
            <EmptyState onPickScripted={(q) => handleSend(q)} />
          )}

          {transcript.map((turn, i) =>
            turn.role === "user" ? (
              <UserTurn key={i} question={turn.question} />
            ) : (
              <SousTurn key={i} turn={turn} />
            )
          )}

          {/* In-flight Sous turn while streaming */}
          {(thinking || streamingActive) && (
            <SousTurnStreaming
              thinking={thinking}
              meta={streamingMeta}
              answer={streamingAnswer}
            />
          )}
        </div>
      </div>

      {/* ── Input ───────────────────────────────────────────────────────── */}
      <div className="pb-sous-input-wrap">
        <form
          className="pb-sous-input-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <input
            ref={inputRef}
            className="pb-sous-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Sous…"
            disabled={thinking || streamingActive}
            autoFocus
          />
          <button
            type="submit"
            className="pb-sous-send"
            disabled={thinking || streamingActive || !input.trim()}
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="13 6 19 12 13 18" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Empty state with scripted demo questions ───────────────────────────────
function EmptyState({ onPickScripted }) {
  return (
    <div className="pb-sous-empty">
      <p className="pb-sous-empty-line">Ask Sous anything documented in the Playbook.</p>
      <p className="pb-sous-empty-hint">Or pick a question to start:</p>
      <div className="pb-sous-suggested">
        {SCRIPTED_QUESTIONS.map((q) => (
          <button
            key={q}
            type="button"
            className="pb-sous-suggested-pill"
            onClick={() => onPickScripted(q)}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── User turn ──────────────────────────────────────────────────────────────
function UserTurn({ question }) {
  return (
    <div className="pb-sous-turn pb-sous-turn--user">
      <div className="pb-sous-user-bubble">{question}</div>
    </div>
  );
}

// ─── Sous turn (committed) ──────────────────────────────────────────────────
function SousTurn({ turn }) {
  return (
    <div className={`pb-sous-turn pb-sous-turn--sous${turn.declined ? " pb-sous-turn--declined" : ""}`}>
      <div className="pb-sous-mark pb-sous-mark--small" aria-hidden="true">
        <span className="pb-sous-mark-letter">S</span>
      </div>
      <div className="pb-sous-bubble">
        {turn.error ? (
          <div className="pb-sous-stream-error">Sous couldn&apos;t respond: {turn.error}</div>
        ) : (
          <>
            <SousMarkdown text={turn.answer} />
            {turn.declined ? (
              <div className="pb-sous-decline-tag" title={turn.decline_reason || "Not in the Playbook"}>
                Not in the Playbook
              </div>
            ) : turn.sources && turn.sources.length > 0 ? (
              <SourceChips sources={turn.sources} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Sous turn (streaming / thinking) ───────────────────────────────────────
function SousTurnStreaming({ thinking, meta, answer }) {
  return (
    <div className={`pb-sous-turn pb-sous-turn--sous pb-sous-turn--streaming${meta?.declined ? " pb-sous-turn--declined" : ""}`}>
      <div className="pb-sous-mark pb-sous-mark--small" aria-hidden="true">
        <span className="pb-sous-mark-letter">S</span>
      </div>
      <div className="pb-sous-bubble">
        {thinking ? (
          <ThinkingIndicator />
        ) : (
          <>
            <SousMarkdown text={answer} streaming />
            {/* While streaming, surface the chips/decline tag preemptively so they
                appear with the first words rather than popping in at the end. */}
            {meta?.declined ? (
              <div className="pb-sous-decline-tag">Not in the Playbook</div>
            ) : meta?.sources_in_context && meta.sources_in_context.length > 0 ? (
              <SourceChips sources={meta.sources_in_context} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Thinking indicator (in Sous's voice, not a generic spinner) ────────────
function ThinkingIndicator() {
  return (
    <div className="pb-sous-thinking" role="status" aria-live="polite">
      <span>Checking the Playbook</span>
      <span className="pb-sous-thinking-dots" aria-hidden="true">
        <span /><span /><span />
      </span>
    </div>
  );
}

// ─── Source chips ───────────────────────────────────────────────────────────
function SourceChips({ sources }) {
  // De-dup by doc_id - the same doc may surface multiple times via different
  // sections; show one chip per doc.
  const seen = new Set();
  const unique = [];
  for (const s of sources) {
    if (seen.has(s.doc_id)) continue;
    seen.add(s.doc_id);
    unique.push(s);
  }
  return (
    <div className="pb-sous-chips">
      {unique.map((s) => (
        <span key={s.doc_id} className="pb-sous-chip" title={s.section || ""}>
          <span className="pb-sous-chip-id">{s.doc_id}</span>
          <span className="pb-sous-chip-sep">·</span>
          <span className="pb-sous-chip-title">{s.title}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Minimal markdown renderer for Sous's voice ────────────────────────────
// Handles: paragraph breaks (double newlines), bold (**...**), italic (*...*).
// While `streaming` is true, an end-of-text caret renders for the typing
// effect. Other markdown shapes are passed through as plain text.
function SousMarkdown({ text, streaming = false }) {
  if (!text) {
    return streaming ? <span className="pb-sous-cursor" aria-hidden="true" /> : null;
  }
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className="pb-sous-md">
      {paragraphs.map((para, i) => {
        const isLast = i === paragraphs.length - 1;
        return (
          <p key={i} className="pb-sous-md-p">
            {renderInline(para)}
            {streaming && isLast && <span className="pb-sous-cursor" aria-hidden="true" />}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text) {
  // Walk through text, peeling off **bold** or *italic* spans as we go.
  const out = [];
  let remaining = text;
  let key = 0;
  // Single-line breaks inside a paragraph become <br />.
  while (remaining.length > 0) {
    const bold = remaining.match(/\*\*([^*\n]+)\*\*/);
    const italic = remaining.match(/(?<!\*)\*([^*\n]+)\*(?!\*)/);
    let next = null;
    if (bold && (!italic || bold.index <= italic.index)) {
      next = { kind: "bold", match: bold };
    } else if (italic) {
      next = { kind: "italic", match: italic };
    }
    if (!next) {
      pushWithBreaks(out, remaining, key++);
      break;
    }
    if (next.match.index > 0) {
      pushWithBreaks(out, remaining.slice(0, next.match.index), key++);
    }
    if (next.kind === "bold") {
      out.push(<strong key={`b-${key++}`}>{next.match[1]}</strong>);
    } else {
      out.push(<em key={`i-${key++}`}>{next.match[1]}</em>);
    }
    remaining = remaining.slice(next.match.index + next.match[0].length);
  }
  return out;
}

// Push a plain-text segment to the rendered output, converting single \n
// to <br /> within the segment so an answer with hard newlines reads right.
function pushWithBreaks(out, segment, keyBase) {
  const parts = segment.split("\n");
  parts.forEach((part, idx) => {
    if (part) out.push(<span key={`t-${keyBase}-${idx}`}>{part}</span>);
    if (idx < parts.length - 1) out.push(<br key={`br-${keyBase}-${idx}`} />);
  });
}

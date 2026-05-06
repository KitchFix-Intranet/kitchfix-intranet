"use client";

// ════════════════════════════════════════════════════════════════════════════
// NarrativeField — autosaving textarea with cell-size warnings
//
// Module: People Portal · Leadership Dugout
// Sprint: 2
// CSS prefix: pp-ldug-
//
// Mitigates the 50KB Google Sheets cell ceiling — soft-warns at 80%, blocks
// at 95%. Debounced autosave at 800ms.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";

const HARD_CEILING = 50000;

export default function NarrativeField({
  value = "",
  onSave,
  placeholder = "",
  minHeight = 80,
  warnPct = 80,
  blockPct = 95,
  maxChars = HARD_CEILING * 0.8,
  disabled = false,
}) {
  const [draft, setDraft] = useState(value);
  const [saveState, setSaveState] = useState("idle");
  const debounceRef = useRef(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const charCount = draft.length;
  const pctOfMax = (charCount / maxChars) * 100;
  const warning = pctOfMax >= warnPct;
  const block = pctOfMax >= blockPct;

  const handleChange = (e) => {
    let next = e.target.value;
    if (next.length > maxChars) next = next.slice(0, maxChars);
    setDraft(next);
    setSaveState("idle");

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!onSave) return;
      setSaveState("saving");
      try {
        await onSave(next);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1500);
      } catch (err) {
        console.error("[NarrativeField] save failed:", err);
        setSaveState("error");
      }
    }, 800);
  };

  return (
    <div className={`pp-ldug-narrative${block ? " pp-ldug-narrative--block" : warning ? " pp-ldug-narrative--warn" : ""}`}>
      <textarea
        value={draft}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className="pp-ldug-narrative-textarea"
        style={{ minHeight: `${minHeight}px` }}
      />
      <div className="pp-ldug-narrative-meta">
        <span className="pp-ldug-narrative-count">
          {charCount.toLocaleString()} chars
          {warning && !block && " · approaching limit"}
          {block && " · at hard limit"}
        </span>
        <span className={`pp-ldug-narrative-status pp-ldug-narrative-status--${saveState}`}>
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "● Saved"}
          {saveState === "error" && "● Save failed — retry"}
        </span>
      </div>
    </div>
  );
}
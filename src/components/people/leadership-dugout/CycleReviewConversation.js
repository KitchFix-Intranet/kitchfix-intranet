"use client";

// ════════════════════════════════════════════════════════════════════════════
// CycleReviewConversation — Reviewer marks conversation held + notes + Top 3
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 5)
// CSS prefix: pp-ldug-
//
// After calibration approval, Reviewer holds the conversation with Reviewed
// Party. This screen captures: date, location, observations, and the Top 3
// priorities for next cycle (built jointly per SOP-001 §5.6).
// Marking conversation held opens 7-day Response window.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import NarrativeField from "@/components/people/leadership-dugout/NarrativeField";

export default function CycleReviewConversation({ review, currentUserEmail, onSubmit, showToast }) {
  const header = review?.header || {};
  const body = review?.body || {};
  const existing = body.conversation_notes || {};

  const [date, setDate] = useState(existing.date || "");
  const [location, setLocation] = useState(existing.location || "in-person");
  const [observations, setObservations] = useState(existing.observations || "");
  const [priorities, setPriorities] = useState(() => {
    const arr = Array.isArray(body.top3_priorities) ? body.top3_priorities : [];
    return [
      arr[0] || { goal: "", outcome: "", path: "" },
      arr[1] || { goal: "", outcome: "", path: "" },
      arr[2] || { goal: "", outcome: "", path: "" },
    ];
  });
  const [submitting, setSubmitting] = useState(false);

  const savePriorities = async (next) => {
    setPriorities(next);
    await fetch("/api/people/leadership-dugout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-cycle-review-section",
        email: currentUserEmail,
        review_id: header.id,
        section_key: "top3_priorities",
        value: next,
      }),
    });
  };

  const updatePriority = (idx, field, val) => {
    const next = priorities.map((p, i) => (i === idx ? { ...p, [field]: val } : p));
    return savePriorities(next);
  };

  const handleMarkHeld = async () => {
    if (!date) {
      showToast?.({ msg: "Set the conversation date.", type: "error" });
      return;
    }
    if (!observations.trim()) {
      showToast?.({ msg: "Add observation notes from the conversation.", type: "error" });
      return;
    }
    const filled = priorities.filter((p) => p.goal?.trim()).length;
    if (filled < 3) {
      showToast?.({ msg: "Lock all 3 priorities before marking conversation held.", type: "error" });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/people/leadership-dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark-conversation-held",
          email: currentUserEmail,
          review_id: header.id,
          conversation_notes: { date, location, observations },
        }),
      }).then((r) => r.json());

      if (res?.ok) {
        showToast?.({ msg: "Conversation marked held. Response window is open for 7 days.", type: "success" });
        onSubmit?.();
      } else {
        showToast?.({ msg: res?.error || "Submit failed", type: "error" });
      }
    } catch (e) {
      showToast?.({ msg: e.message, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pp-ldug-cr-conversation">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">Conversation</h3>
        <p className="pp-ldug-section-desc">
          Hold the conversation with {header.leader_name}. Walk the calibrated review
          together. Lock the Top 3 priorities for the next cycle. Marking held opens the
          7-day Response window per SOP-001 §5.7.
        </p>
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Conversation date</label>
        <input
          type="date"
          className="pp-ldug-form-input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Format</label>
        <div className="pp-ldug-form-radios">
          {["in-person", "video", "phone"].map((opt) => (
            <label key={opt} className="pp-ldug-form-radio">
              <input
                type="radio"
                name="location"
                checked={location === opt}
                onChange={() => setLocation(opt)}
              />
              <span style={{ textTransform: "capitalize" }}>{opt}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Observations</label>
        <NarrativeField
          value={observations}
          onSave={async (v) => setObservations(v)}
          placeholder="What came up. How they reacted. Areas of agreement / disagreement. What was committed to."
          minHeight={110}
        />
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Top 3 priorities for next cycle (joint)</label>
        {priorities.map((p, idx) => (
          <div key={idx} className="pp-ldug-goal-row">
            <div className="pp-ldug-goal-num">{idx + 1}</div>
            <div className="pp-ldug-goal-fields">
              <input
                type="text"
                className="pp-ldug-form-input"
                placeholder="Priority"
                value={p.goal || ""}
                onChange={(e) => updatePriority(idx, "goal", e.target.value)}
              />
              <input
                type="text"
                className="pp-ldug-form-input"
                placeholder="Outcome — what does done look like?"
                value={p.outcome || ""}
                onChange={(e) => updatePriority(idx, "outcome", e.target.value)}
              />
              <input
                type="text"
                className="pp-ldug-form-input"
                placeholder="Path — how to get there"
                value={p.path || ""}
                onChange={(e) => updatePriority(idx, "path", e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="pp-ldug-form-actions">
        <button
          className="pp-card-cta pp-card-cta--primary"
          onClick={handleMarkHeld}
          disabled={submitting}
        >
          {submitting ? "Marking…" : "Mark conversation held · open Response window"}
        </button>
      </div>
    </div>
  );
}
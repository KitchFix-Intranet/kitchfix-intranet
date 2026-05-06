"use client";

// ════════════════════════════════════════════════════════════════════════════
// CycleReviewResponse — Reviewed Party 1-week Response window
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 5)
// CSS prefix: pp-ldug-
//
// Per SOP-001 §5.7. Reviewed Party may submit a written response to the
// review. Response is appended to the record. Optional — empty submission
// is allowed and just advances state to SignOffPending.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import NarrativeField from "@/components/people/leadership-dugout/NarrativeField";

export default function CycleReviewResponse({ review, currentUserEmail, onSubmit, showToast }) {
  const header = review?.header || {};
  const body = review?.body || {};
  const existing = body.response || {};

  const [text, setText] = useState(existing.text || "");
  const [submitting, setSubmitting] = useState(false);

  const saveText = async (v) => {
    setText(v);
    await fetch("/api/people/leadership-dugout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-cycle-review-section",
        email: currentUserEmail,
        review_id: header.id,
        section_key: "response",
        value: { ...existing, text: v },
      }),
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Final save then submit
      await saveText(text);
      const res = await fetch("/api/people/leadership-dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-response",
          email: currentUserEmail,
          review_id: header.id,
        }),
      }).then((r) => r.json());

      if (res?.ok) {
        showToast?.({ msg: "Response submitted. Sign-off is up.", type: "success" });
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

  // Compute response window deadline (7 days after conversation_at)
  let deadlineLabel = null;
  if (header.conversation_at) {
    const d = new Date(header.conversation_at);
    d.setDate(d.getDate() + 7);
    deadlineLabel = d.toLocaleDateString();
  }

  return (
    <div className="pp-ldug-cr-response">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">Your response</h3>
        <p className="pp-ldug-section-desc">
          You held the conversation with {header.reviewer_name}. The Response window is
          open for 7 days. Add a written response if you want to — it goes on the record.
          {deadlineLabel && <> Deadline: <strong>{deadlineLabel}</strong>.</>} Or skip
          straight to sign-off.
        </p>
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Written response (optional)</label>
        <NarrativeField
          value={text}
          onSave={saveText}
          placeholder="Anything you want on the record. Agreement, pushback, additional context, commitments going forward."
          minHeight={140}
        />
      </div>

      <div className="pp-ldug-form-actions">
        <button
          className="pp-card-cta pp-card-cta--primary"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Submitting…" : "Submit response · advance to sign-off"}
        </button>
      </div>
    </div>
  );
}
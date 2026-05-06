"use client";

// ════════════════════════════════════════════════════════════════════════════
// WowPlanPreDay1 — leader pre-Day 1 prep (3 questions)
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 + Chunk 7 (ldugFetch)
// CSS prefix: pp-ldug-
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import NarrativeField from "@/components/people/leadership-dugout/NarrativeField";
import { ldugFetch } from "@/components/people/leadership-dugout/ldugFetch";

const QUESTIONS = [
  {
    id: "success_30d",
    label: "What does success look like for you in the first 30 days?",
    placeholder: "Concrete signals — what would tell you you've landed?",
  },
  {
    id: "biggest_unknown",
    label: "What's the biggest unknown going into this role?",
    placeholder: "Things you don't yet know that could trip you up.",
  },
  {
    id: "support_needed",
    label: "What support do you need from your Reviewer to land well?",
    placeholder: "Be specific. Time, intros, coaching, decisions.",
  },
];

export default function WowPlanPreDay1({ plan, currentUserEmail, onSubmit, showToast }) {
  const initial = plan?.body?.pre_work_responses || {};
  const [answers, setAnswers] = useState({
    success_30d: initial.success_30d || "",
    biggest_unknown: initial.biggest_unknown || "",
    support_needed: initial.support_needed || "",
  });
  const [submitting, setSubmitting] = useState(false);

  const isLeader =
    plan?.header?.leader_email?.toLowerCase() === (currentUserEmail || "").toLowerCase();

  useEffect(() => {
    if (initial) {
      setAnswers({
        success_30d: initial.success_30d || "",
        biggest_unknown: initial.biggest_unknown || "",
        support_needed: initial.support_needed || "",
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.header?.id]);

  const saveSection = async (next) => {
    await ldugFetch("/api/people/leadership-dugout", {
      method: "POST",
      body: JSON.stringify({
        action: "save-wow-section",
        email: currentUserEmail,
        plan_id: plan.header.id,
        column: "C",
        value: { ...next, trigger_type: initial.trigger_type },
      }),
    });
  };

  const handleAnswerChange = (id, val) => {
    const next = { ...answers, [id]: val };
    setAnswers(next);
    return saveSection(next);
  };

  const allAnswered =
    answers.success_30d.trim() &&
    answers.biggest_unknown.trim() &&
    answers.support_needed.trim();

  const handleMarkComplete = async () => {
    if (!allAnswered) {
      showToast?.({ msg: "Answer all three questions before marking complete.", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await saveSection(answers);
      await ldugFetch("/api/people/leadership-dugout", {
        method: "POST",
        body: JSON.stringify({
          action: "submit-wow-section-complete",
          email: currentUserEmail,
          plan_id: plan.header.id,
          section: "pre_work_responses",
        }),
      });
      showToast?.({ msg: "Pre-Day 1 prep saved. See you Day 1.", type: "success" });
      onSubmit?.();
    } catch (e) {
      showToast?.({ msg: e.message, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!isLeader) {
    return (
      <div className="pp-ldug-empty-state">
        <h3 className="pp-ldug-empty-title">Pre-Day 1 prep is the leader's view</h3>
        <p className="pp-ldug-empty-desc">
          {plan.header.leader_name} fills this section before Day 1.
          As Reviewer, you'll see their answers when they're submitted, and you'll fill
          your own preparation on Day 1 itself.
        </p>
      </div>
    );
  }

  return (
    <div className="pp-ldug-wow-form">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">Pre-Day 1 prep</h3>
        <p className="pp-ldug-section-desc">
          Three questions. Saved automatically. You and your Reviewer will walk through
          these together at the Day 1 kickoff.
        </p>
      </div>

      {QUESTIONS.map((q, i) => (
        <div key={q.id} className="pp-ldug-form-row">
          <label className="pp-ldug-form-label">{i + 1}. {q.label}</label>
          <NarrativeField
            value={answers[q.id]}
            onSave={(v) => handleAnswerChange(q.id, v)}
            placeholder={q.placeholder}
            minHeight={90}
          />
        </div>
      ))}

      <div className="pp-ldug-form-actions">
        <button
          className="pp-card-cta pp-card-cta--primary"
          onClick={handleMarkComplete}
          disabled={submitting || !allAnswered}
        >
          {submitting ? "Saving…" : "Mark Pre-Day 1 complete"}
        </button>
      </div>
    </div>
  );
}
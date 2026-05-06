"use client";

// ════════════════════════════════════════════════════════════════════════════
// WowPlanCheckpoint — Day 30 / Day 60 checkpoint screen (variant by `day`)
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 + Chunk 7 (ldugFetch)
// CSS prefix: pp-ldug-
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import NarrativeField from "@/components/people/leadership-dugout/NarrativeField";
import SignOffBlock from "@/components/people/leadership-dugout/SignOffBlock";
import { ldugFetch } from "@/components/people/leadership-dugout/ldugFetch";

const PROMPTS = {
  30: {
    title: "Day 30 — Landed",
    intro: "30 days in. How are the goals tracking? What's the relationship like? What needs to change for the next 30?",
    column: "J",
    fields: [
      { id: "goal_progress", label: "Goal progress", placeholder: "Where are each of the Top 3 goals tracking?" },
      { id: "relationship_status", label: "Relationship status", placeholder: "Reviewer–Leader trust, alignment, candor." },
      { id: "adjustments", label: "Adjustments for next 30", placeholder: "What changes for the path to Day 60?" },
    ],
  },
  60: {
    title: "Day 60 — Mid-arc",
    intro: "60 days in. Goals on path? What obstacles are real? What support would change the trajectory?",
    column: "K",
    fields: [
      { id: "goal_progress", label: "Goal progress", placeholder: "Where are each of the Top 3 goals tracking?" },
      { id: "obstacles", label: "Obstacles", placeholder: "What's actually getting in the way." },
      { id: "support_actions", label: "Support actions", placeholder: "Specific asks of the Reviewer for the next 30." },
    ],
  },
};

export default function WowPlanCheckpoint({ day, plan, currentUserEmail, onAdvance, showToast }) {
  const config = PROMPTS[day];
  const header = plan?.header || {};
  const body = plan?.body || {};

  const initial = day === 30 ? body.day30_data : body.day60_data;
  const [data, setData] = useState({
    goal_progress: initial?.goal_progress || "",
    relationship_status: initial?.relationship_status || "",
    adjustments: initial?.adjustments || "",
    obstacles: initial?.obstacles || "",
    support_actions: initial?.support_actions || "",
  });
  const [submitting, setSubmitting] = useState(false);

  const isReviewer = header.reviewer_email?.toLowerCase() === (currentUserEmail || "").toLowerCase();
  const signedAt = day === 30 ? header.day30_signed_at : header.day60_signed_at;

  const save = (next) => {
    setData(next);
    return ldugFetch("/api/people/leadership-dugout", {
      method: "POST",
      body: JSON.stringify({
        action: "save-wow-section",
        email: currentUserEmail,
        plan_id: header.id,
        column: config.column,
        value: next,
      }),
    });
  };

  const handleSign = async () => {
    setSubmitting(true);
    try {
      await ldugFetch("/api/people/leadership-dugout", {
        method: "POST",
        body: JSON.stringify({
          action: "submit-wow-checkpoint",
          email: currentUserEmail,
          plan_id: header.id,
          day,
        }),
      });
      showToast?.({ msg: `Day ${day} signed.`, type: "success" });
      onAdvance?.();
    } catch (e) {
      showToast?.({ msg: e.message, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pp-ldug-wow-form">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">{config.title}</h3>
        <p className="pp-ldug-section-desc">{config.intro}</p>
      </div>

      {config.fields.map((f) => (
        <div key={f.id} className="pp-ldug-form-row">
          <label className="pp-ldug-form-label">{f.label}</label>
          <NarrativeField
            value={data[f.id]}
            onSave={(v) => save({ ...data, [f.id]: v })}
            placeholder={f.placeholder}
            minHeight={90}
            disabled={!!signedAt}
          />
        </div>
      ))}

      <div className="pp-ldug-signoff-row">
        <SignOffBlock
          role={`Day ${day} sign-off`}
          signerName={isReviewer ? "Reviewer" : "Leader"}
          signedAt={signedAt || null}
          onSign={handleSign}
          acknowledgmentText={`We've held the Day ${day} conversation and aligned on the path forward.`}
        />
        {submitting && <div className="pp-ldug-form-hint">Signing…</div>}
      </div>
    </div>
  );
}
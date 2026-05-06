"use client";

// ════════════════════════════════════════════════════════════════════════════
// WowPlanDay1 — joint kickoff working session
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 + Chunk 7 (ldugFetch)
// CSS prefix: pp-ldug-
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import NarrativeField from "@/components/people/leadership-dugout/NarrativeField";
import SignOffBlock from "@/components/people/leadership-dugout/SignOffBlock";
import { ldugFetch } from "@/components/people/leadership-dugout/ldugFetch";

export default function WowPlanDay1({ plan, currentUserEmail, onAdvance, showToast }) {
  const body = plan?.body || {};
  const header = plan?.header || {};

  const [hlq, setHlq] = useState(body.day1_high_leverage_question?.text || "");
  const [goals, setGoals] = useState(() => {
    const arr = Array.isArray(body.day1_top3_goals) ? body.day1_top3_goals : [];
    return [
      arr[0] || { goal: "", outcome: "", path: "" },
      arr[1] || { goal: "", outcome: "", path: "" },
      arr[2] || { goal: "", outcome: "", path: "" },
    ];
  });
  const [brandExp, setBrandExp] = useState(body.manager_brand_expectations || {});
  const [stylePrefs, setStylePrefs] = useState(body.leader_style_preferences || {});
  const [submitting, setSubmitting] = useState(false);

  const isLeader = header.leader_email?.toLowerCase() === (currentUserEmail || "").toLowerCase();
  const isReviewer = header.reviewer_email?.toLowerCase() === (currentUserEmail || "").toLowerCase();

  const save = (column, value) =>
    ldugFetch("/api/people/leadership-dugout", {
      method: "POST",
      body: JSON.stringify({
        action: "save-wow-section",
        email: currentUserEmail,
        plan_id: header.id,
        column,
        value,
      }),
    });

  const saveHlq = (v) => {
    setHlq(v);
    return save("D", { text: v });
  };

  const saveGoal = (idx, field, v) => {
    const next = goals.map((g, i) => (i === idx ? { ...g, [field]: v } : g));
    setGoals(next);
    return save("E", next);
  };

  const saveBrand = (field, v) => {
    const next = { ...brandExp, [field]: v };
    setBrandExp(next);
    return save("F", next);
  };

  const saveStyle = (field, v) => {
    const next = { ...stylePrefs, [field]: v };
    setStylePrefs(next);
    return save("G", next);
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
          day: 1,
        }),
      });
      showToast?.({ msg: "Day 1 signed. Plan is active.", type: "success" });
      onAdvance?.();
    } catch (e) {
      showToast?.({ msg: e.message, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const day1Signed = !!header.day1_signed_at;

  return (
    <div className="pp-ldug-wow-form">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">Day 1 — Kickoff</h3>
        <p className="pp-ldug-section-desc">
          Reviewer + Leader fill this together. Lock the 90-day arc, set Top 3 goals,
          align on style and expectations. Either party can sign once aligned.
        </p>
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">
          Reviewer's high-leverage question
          {!isReviewer && <span className="pp-ldug-form-hint-inline"> (Reviewer fills)</span>}
        </label>
        <NarrativeField
          value={hlq}
          onSave={saveHlq}
          placeholder="3-5 things this leader needs to focus on to land well in this role."
          minHeight={90}
          disabled={day1Signed || !isReviewer}
        />
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Top 3 goals for the 90 days</label>
        {goals.map((g, idx) => (
          <div key={idx} className="pp-ldug-goal-row">
            <div className="pp-ldug-goal-num">{idx + 1}</div>
            <div className="pp-ldug-goal-fields">
              <input
                type="text"
                className="pp-ldug-form-input"
                placeholder="Goal"
                value={g.goal}
                onChange={(e) => saveGoal(idx, "goal", e.target.value)}
                disabled={day1Signed}
              />
              <input
                type="text"
                className="pp-ldug-form-input"
                placeholder="Outcome — what does done look like?"
                value={g.outcome}
                onChange={(e) => saveGoal(idx, "outcome", e.target.value)}
                disabled={day1Signed}
              />
              <input
                type="text"
                className="pp-ldug-form-input"
                placeholder="Path — how will you get there?"
                value={g.path}
                onChange={(e) => saveGoal(idx, "path", e.target.value)}
                disabled={day1Signed}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">
          Manager brand & expectations
          {!isReviewer && <span className="pp-ldug-form-hint-inline"> (Reviewer fills)</span>}
        </label>
        <div className="pp-ldug-form-stack">
          <NarrativeField
            value={brandExp.expectations || ""}
            onSave={(v) => saveBrand("expectations", v)}
            placeholder="What does success look like to me as your manager?"
            minHeight={70}
            disabled={day1Signed || !isReviewer}
          />
          <NarrativeField
            value={brandExp.comm_prefs || ""}
            onSave={(v) => saveBrand("comm_prefs", v)}
            placeholder="How I prefer to communicate (cadence, channels, urgency)."
            minHeight={70}
            disabled={day1Signed || !isReviewer}
          />
        </div>
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">
          Leader style preferences
          {!isLeader && <span className="pp-ldug-form-hint-inline"> (Leader fills)</span>}
        </label>
        <div className="pp-ldug-form-stack">
          <NarrativeField
            value={stylePrefs.comm_learn || ""}
            onSave={(v) => saveStyle("comm_learn", v)}
            placeholder="How I learn best and prefer to be communicated with."
            minHeight={70}
            disabled={day1Signed || !isLeader}
          />
          <NarrativeField
            value={stylePrefs.recognition || ""}
            onSave={(v) => saveStyle("recognition", v)}
            placeholder="How I like to be recognized when something goes well."
            minHeight={70}
            disabled={day1Signed || !isLeader}
          />
        </div>
      </div>

      <div className="pp-ldug-signoff-row">
        <SignOffBlock
          role="Day 1 sign-off"
          signerName={isReviewer ? "Reviewer" : isLeader ? "Leader" : "Observer"}
          signedAt={day1Signed ? header.day1_signed_at : null}
          onSign={handleSign}
          acknowledgmentText="We've walked through the kickoff together. Plan is locked for the 90-day arc."
        />
        {submitting && <div className="pp-ldug-form-hint">Signing…</div>}
      </div>
    </div>
  );
}
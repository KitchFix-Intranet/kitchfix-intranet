"use client";

// ════════════════════════════════════════════════════════════════════════════
// WowPlanCloseOut — Day 90 close-out + 3 sigs + PDF trigger
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 + Chunk 7 (ldugFetch)
// CSS prefix: pp-ldug-
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import NarrativeField from "@/components/people/leadership-dugout/NarrativeField";
import SignOffBlock from "@/components/people/leadership-dugout/SignOffBlock";
import { ldugFetch } from "@/components/people/leadership-dugout/ldugFetch";

export default function WowPlanCloseOut({ plan, currentUserEmail, onClose, showToast }) {
  const header = plan?.header || {};
  const body = plan?.body || {};
  const initial = body.day90_data || {};

  const [outcomesReview, setOutcomesReview] = useState(initial.outcomes_review || "");
  const [day1Validated, setDay1Validated] = useState(initial.day1_validated || "");
  const [next3Priorities, setNext3Priorities] = useState(() => {
    const arr = Array.isArray(initial.top3_priorities_next) ? initial.top3_priorities_next : [];
    return [
      arr[0] || { priority: "" },
      arr[1] || { priority: "" },
      arr[2] || { priority: "" },
    ];
  });
  const [acknowledged, setAcknowledged] = useState(initial.acknowledgments || {});
  const [submitting, setSubmitting] = useState(false);

  const norm = (currentUserEmail || "").toLowerCase();
  const isLeader = header.leader_email?.toLowerCase() === norm;
  const isReviewer = header.reviewer_email?.toLowerCase() === norm;
  const isOversight = header.oversight_email?.toLowerCase() === norm;

  const closed = header.status === "Closed" || !!header.day90_signed_at;

  const save = (next) =>
    ldugFetch("/api/people/leadership-dugout", {
      method: "POST",
      body: JSON.stringify({
        action: "save-wow-section",
        email: currentUserEmail,
        plan_id: header.id,
        column: "L",
        value: next,
      }),
    });

  const saveOutcomes = (v) => {
    setOutcomesReview(v);
    return save({
      outcomes_review: v,
      day1_validated: day1Validated,
      top3_priorities_next: next3Priorities,
      acknowledgments: acknowledged,
    });
  };

  const saveDay1Validated = (v) => {
    setDay1Validated(v);
    return save({
      outcomes_review: outcomesReview,
      day1_validated: v,
      top3_priorities_next: next3Priorities,
      acknowledgments: acknowledged,
    });
  };

  const saveNext3 = (idx, v) => {
    const next = next3Priorities.map((p, i) => (i === idx ? { priority: v } : p));
    setNext3Priorities(next);
    return save({
      outcomes_review: outcomesReview,
      day1_validated: day1Validated,
      top3_priorities_next: next,
      acknowledgments: acknowledged,
    });
  };

  const handleAcknowledge = async (role) => {
    const next = { ...acknowledged, [role]: new Date().toISOString() };
    setAcknowledged(next);
    await save({
      outcomes_review: outcomesReview,
      day1_validated: day1Validated,
      top3_priorities_next: next3Priorities,
      acknowledgments: next,
    });

    if (next.leader && next.reviewer && next.oversight && isOversight) {
      setSubmitting(true);
      try {
        await ldugFetch("/api/people/leadership-dugout", {
          method: "POST",
          body: JSON.stringify({
            action: "close-wow-plan",
            email: currentUserEmail,
            plan_id: header.id,
          }),
        });
        showToast?.({ msg: "Plan closed. Leader transitions to next Cycle Review.", type: "success" });
        onClose?.();
      } catch (e) {
        showToast?.({ msg: e.message, type: "error" });
      } finally {
        setSubmitting(false);
      }
    }
  };

  return (
    <div className="pp-ldug-wow-form">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">Day 90 — Close-out</h3>
        <p className="pp-ldug-section-desc">
          90 days in. Walk the outcomes. Validate the Day 1 plan. Set the Top 3 priorities
          for the next half. Three sigs close the plan and transition to Cycle Review.
        </p>
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Outcomes review</label>
        <NarrativeField
          value={outcomesReview}
          onSave={saveOutcomes}
          placeholder="What got done? What didn't? What surprised you (positive or negative)?"
          minHeight={110}
          disabled={closed}
        />
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Day 1 plan validation</label>
        <NarrativeField
          value={day1Validated}
          onSave={saveDay1Validated}
          placeholder="Did the Day 1 Top 3 goals hold up? What would you change in hindsight?"
          minHeight={90}
          disabled={closed}
        />
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Top 3 priorities for next half</label>
        {next3Priorities.map((p, idx) => (
          <input
            key={idx}
            type="text"
            className="pp-ldug-form-input"
            style={{ marginBottom: 6 }}
            placeholder={`Priority ${idx + 1}`}
            value={p.priority}
            onChange={(e) => saveNext3(idx, e.target.value)}
            disabled={closed}
          />
        ))}
      </div>

      <div className="pp-ldug-signoff-grid">
        <SignOffBlock
          role="Leader"
          signerName={header.leader_name}
          signedAt={acknowledged.leader || null}
          onSign={() => handleAcknowledge("leader")}
          acknowledgmentText="I acknowledge the Day 90 review and accept the next-half priorities."
        />
        <SignOffBlock
          role="Reviewer"
          signerName={header.reviewer_email}
          signedAt={acknowledged.reviewer || null}
          onSign={() => handleAcknowledge("reviewer")}
          acknowledgmentText="I've reviewed the close-out and endorse the next-half priorities."
        />
        <SignOffBlock
          role="Oversight"
          signerName={header.oversight_email}
          signedAt={acknowledged.oversight || null}
          onSign={() => handleAcknowledge("oversight")}
          acknowledgmentText="I've calibrated the close-out and approve the transition to Cycle Review."
        />
      </div>

      {!isLeader && !isReviewer && !isOversight && (
        <p className="pp-ldug-form-hint" style={{ marginTop: 12 }}>
          You can view this close-out as a system viewer but cannot sign on behalf of the chain.
        </p>
      )}

      {submitting && <div className="pp-ldug-form-hint" style={{ marginTop: 8 }}>Closing plan…</div>}

      {closed && (
        <div className="pp-ldug-empty-state" style={{ marginTop: 16 }}>
          <h3 className="pp-ldug-empty-title">Plan closed</h3>
          <p className="pp-ldug-empty-desc">
            This leader has transitioned to the regular Cycle Performance Review on
            their contract-type cadence. PDF archive will appear once the render runs.
          </p>
        </div>
      )}
    </div>
  );
}
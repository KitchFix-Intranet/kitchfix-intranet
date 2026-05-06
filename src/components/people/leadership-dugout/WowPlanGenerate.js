"use client";

// ════════════════════════════════════════════════════════════════════════════
// WowPlanGenerate — system viewer surface to create a new WOW Plan
//
// Module: People Portal · Leadership Dugout
// Sprint: 2
// CSS prefix: pp-ldug-
//
// Used in Admin tab. System viewer picks a leader (must already be in
// Performance_Chain), a Day 1 date, and a trigger type. Server validates,
// creates the plan, fires Slack, returns the plan ID.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { WOW_PLAN_TRIGGERS } from "@/lib/performanceSchema";

export default function WowPlanGenerate({ chainPreview = [], currentUserEmail, onCreated, showToast }) {
  const [leaderEmail, setLeaderEmail] = useState("");
  const [day1Date, setDay1Date] = useState("");
  const [triggerType, setTriggerType] = useState("new_hire");
  const [submitting, setSubmitting] = useState(false);

  const eligibleLeaders = chainPreview.filter((c) => {
    // Skip "not_required" — those leaders go straight to Cycle Review
    return c.role && c.leader_email && c.chain_status === "Active";
  });

  const handleSubmit = async () => {
    if (!leaderEmail || !day1Date) {
      showToast?.({ msg: "Pick a leader and a Day 1 date", type: "error" });
      return;
    }
    if (triggerType === "not_required") {
      showToast?.({ msg: "If WOW Plan isn't required, the leader goes to next Cycle Review automatically. No plan to create.", type: "info" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/people/leadership-dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-wow-plan",
          email: currentUserEmail,
          leader_email: leaderEmail,
          day1_date: day1Date,
          trigger_type: triggerType,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        showToast?.({ msg: `WOW Plan created. Day 90 lands ${data.day90_date}.`, type: "success" });
        onCreated?.(data.plan_id);
      } else {
        showToast?.({ msg: data?.error || "Failed to create plan", type: "error" });
      }
    } catch (e) {
      showToast?.({ msg: e.message, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pp-ldug-wow-generate">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">Generate a WOW Plan</h3>
        <p className="pp-ldug-section-desc">
          Used when a leader enters a new role: new hire, internal promotion, or lateral
          move into a new account. Not required for routine continuation, return from
          leave, or same-account same-level reassignment.
        </p>
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Leader (must already be in Performance_Chain)</label>
        <select
          className="pp-ldug-form-select"
          value={leaderEmail}
          onChange={(e) => setLeaderEmail(e.target.value)}
        >
          <option value="">Select a leader…</option>
          {eligibleLeaders.map((c) => (
            <option key={c.leader_email} value={c.leader_email}>
              {c.leader_name} — {c.role} · {c.account} ({c.contract_type})
            </option>
          ))}
        </select>
        {eligibleLeaders.length === 0 && (
          <p className="pp-ldug-form-hint">
            No leaders in chain yet. Add rows to HUB__Performance_Chain first.
          </p>
        )}
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Trigger type</label>
        <div className="pp-ldug-form-radios">
          {WOW_PLAN_TRIGGERS.map((t) => (
            <label key={t.id} className="pp-ldug-form-radio">
              <input
                type="radio"
                name="trigger"
                value={t.id}
                checked={triggerType === t.id}
                onChange={(e) => setTriggerType(e.target.value)}
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="pp-ldug-form-row">
        <label className="pp-ldug-form-label">Day 1 date (when leader starts in role)</label>
        <input
          type="date"
          className="pp-ldug-form-input"
          value={day1Date}
          onChange={(e) => setDay1Date(e.target.value)}
        />
      </div>

      <div className="pp-ldug-form-actions">
        <button
          className="pp-card-cta pp-card-cta--primary"
          disabled={submitting || !leaderEmail || !day1Date}
          onClick={handleSubmit}
        >
          {submitting ? "Creating…" : "Create WOW Plan"}
        </button>
      </div>
    </div>
  );
}
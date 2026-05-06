"use client";

// ════════════════════════════════════════════════════════════════════════════
// WowPlanWorkspace — main container for a WOW Plan instance
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 3)
// CSS prefix: pp-ldug-
//
// Routes to the right sub-screen based on plan.status and today's date:
//   Generated          → PreDay1 (leader prep)
//   PreDay1            → PreDay1 (still filling)
//   Active (post-Day1) → Checkpoint(30) once today >= day30, else Day1 read-only
//   Day30              → Checkpoint(60) once today >= day60
//   Day60              → CloseOut once today >= day90
//   Day90              → CloseOut
//   Closed             → CloseOut (read-only)
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from "react";
import ChainSnapshotBadge from "@/components/people/leadership-dugout/ChainSnapshotBadge";
import WowPlanPath from "@/components/people/leadership-dugout/WowPlanPath";
import WowPlanPreDay1 from "@/components/people/leadership-dugout/WowPlanPreDay1";
import WowPlanDay1 from "@/components/people/leadership-dugout/WowPlanDay1";
import WowPlanCheckpoint from "@/components/people/leadership-dugout/WowPlanCheckpoint";
import WowPlanCloseOut from "@/components/people/leadership-dugout/WowPlanCloseOut";
import { WOW_PLAN_STATUS } from "@/lib/performanceSchema";

const STATUS_LABEL = {
  [WOW_PLAN_STATUS.GENERATED]: "Generated · awaiting pre-Day 1",
  [WOW_PLAN_STATUS.PRE_DAY1]: "Pre-Day 1 in progress",
  [WOW_PLAN_STATUS.ACTIVE]: "Day 1 complete · in progress",
  [WOW_PLAN_STATUS.DAY30]: "Day 30 complete",
  [WOW_PLAN_STATUS.DAY60]: "Day 60 complete",
  [WOW_PLAN_STATUS.DAY90]: "Day 90 working",
  [WOW_PLAN_STATUS.CLOSED]: "Closed",
};

function todayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function deriveScreen(status, header) {
  const today = todayIso();
  if (status === WOW_PLAN_STATUS.CLOSED) return "closeout";
  if (status === WOW_PLAN_STATUS.DAY90) return "closeout";
  if (status === WOW_PLAN_STATUS.DAY60) {
    return today >= header.day90_date ? "closeout" : "day60";
  }
  if (status === WOW_PLAN_STATUS.DAY30) {
    return today >= header.day60_date ? "checkpoint60" : "day30";
  }
  if (status === WOW_PLAN_STATUS.ACTIVE) {
    return today >= header.day30_date ? "checkpoint30" : "day1";
  }
  if (status === WOW_PLAN_STATUS.GENERATED || status === WOW_PLAN_STATUS.PRE_DAY1) {
    if (today >= header.day1_date) return "day1";
    return "preday1";
  }
  return "preday1";
}

export default function WowPlanWorkspace({ planId, currentUserEmail, onBack, showToast }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/people/leadership-dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-wow-plan", email: currentUserEmail, plan_id: planId }),
      });
      const data = await res.json();
      if (data?.ok) {
        setPlan(data.plan);
        setError(null);
      } else {
        setError(data?.error || "Failed to load");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [planId, currentUserEmail]);

  useEffect(() => {
    if (planId) reload();
  }, [planId, reload]);

  if (loading) return <div className="pp-ldug-loading">Loading WOW Plan…</div>;
  if (error) {
    return (
      <div className="pp-ldug-empty-state">
        <h3 className="pp-ldug-empty-title">Couldn't load this plan</h3>
        <p className="pp-ldug-empty-desc">{error}</p>
        <button className="pp-ldug-link" onClick={onBack}>← Back</button>
      </div>
    );
  }
  if (!plan) return null;

  const { header } = plan;
  const screen = deriveScreen(header.status, header);

  return (
    <div className="pp-ldug-wow-workspace">
      <div className="pp-ldug-wow-workspace-header">
        <button className="pp-ldug-link" onClick={onBack}>← Back to Active Work</button>
        <span className={`pp-ldug-status-pill pp-ldug-status-pill--${header.status.toLowerCase()}`}>
          {STATUS_LABEL[header.status] || header.status}
        </span>
      </div>

      <div className="pp-ldug-wow-workspace-title">
        <h2>WOW Plan · {header.leader_name}</h2>
        <p>{header.role} · {header.account} · Day 1 was {header.day1_date}</p>
      </div>

      <ChainSnapshotBadge
        leaderName={header.leader_name}
        reviewerName={header.reviewer_email}
        oversightName={header.oversight_email}
      />

      <WowPlanPath header={header} />

      {screen === "preday1" && (
        <WowPlanPreDay1
          plan={plan}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onSubmit={reload}
        />
      )}
      {screen === "day1" && (
        <WowPlanDay1
          plan={plan}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onAdvance={reload}
        />
      )}
      {screen === "checkpoint30" && (
        <WowPlanCheckpoint
          day={30}
          plan={plan}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onAdvance={reload}
        />
      )}
      {screen === "day30" && (
        <div className="pp-ldug-empty-state">
          <h3 className="pp-ldug-empty-title">Between checkpoints</h3>
          <p className="pp-ldug-empty-desc">
            Day 30 is signed. Day 60 checkpoint opens on {header.day60_date}.
          </p>
        </div>
      )}
      {screen === "checkpoint60" && (
        <WowPlanCheckpoint
          day={60}
          plan={plan}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onAdvance={reload}
        />
      )}
      {screen === "day60" && (
        <div className="pp-ldug-empty-state">
          <h3 className="pp-ldug-empty-title">Between checkpoints</h3>
          <p className="pp-ldug-empty-desc">
            Day 60 is signed. Day 90 close-out opens on {header.day90_date}.
          </p>
        </div>
      )}
      {screen === "closeout" && (
        <WowPlanCloseOut
          plan={plan}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onClose={reload}
        />
      )}
    </div>
  );
}
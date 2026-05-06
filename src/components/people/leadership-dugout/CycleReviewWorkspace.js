"use client";

// ════════════════════════════════════════════════════════════════════════════
// CycleReviewWorkspace — main container for a Cycle Review instance
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 5 — wired)
// CSS prefix: pp-ldug-
//
// Status → screen routing per chunk-4 plumbing; Chunk 5 wires real screens.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from "react";
import ChainSnapshotBadge from "@/components/people/leadership-dugout/ChainSnapshotBadge";
import CoEditorBanner from "@/components/people/leadership-dugout/CoEditorBanner";
import CycleReviewFill from "@/components/people/leadership-dugout/CycleReviewFill";
import CycleReviewCalibrate from "@/components/people/leadership-dugout/CycleReviewCalibrate";
import CycleReviewConversation from "@/components/people/leadership-dugout/CycleReviewConversation";
import CycleReviewResponse from "@/components/people/leadership-dugout/CycleReviewResponse";
import CycleReviewSignOff from "@/components/people/leadership-dugout/CycleReviewSignOff";
import { CYCLE_REVIEW_STATUS, INSTRUMENT_ROLES } from "@/lib/performanceSchema";

const STATUS_LABEL = {
  [CYCLE_REVIEW_STATUS.OPEN]: "Open · self-assessment pending",
  [CYCLE_REVIEW_STATUS.SELF_PENDING]: "Self-assessment in progress",
  [CYCLE_REVIEW_STATUS.SELF_SUBMITTED]: "Self submitted · awaiting manager draft",
  [CYCLE_REVIEW_STATUS.MANAGER_DRAFT]: "Manager draft in progress",
  [CYCLE_REVIEW_STATUS.IN_CALIBRATION]: "In calibration",
  [CYCLE_REVIEW_STATUS.CALIBRATED]: "Calibrated · awaiting conversation",
  [CYCLE_REVIEW_STATUS.SENT_BACK]: "Sent back to Reviewer",
  [CYCLE_REVIEW_STATUS.CONVERSATION_HELD]: "Conversation held · awaiting response",
  [CYCLE_REVIEW_STATUS.AWAITING_RESPONSE]: "Awaiting Reviewed Party response",
  [CYCLE_REVIEW_STATUS.SIGN_OFF_PENDING]: "Awaiting sign-offs",
  [CYCLE_REVIEW_STATUS.CLOSED]: "Closed",
};

function deriveScreen(status, userRole) {
  if (status === CYCLE_REVIEW_STATUS.CLOSED) return "summary";
  if (status === CYCLE_REVIEW_STATUS.OPEN || status === CYCLE_REVIEW_STATUS.SELF_PENDING) {
    return userRole === INSTRUMENT_ROLES.REVIEWED_PARTY ? "fill-self" : "waiting-self";
  }
  if (status === CYCLE_REVIEW_STATUS.SELF_SUBMITTED ||
      status === CYCLE_REVIEW_STATUS.MANAGER_DRAFT ||
      status === CYCLE_REVIEW_STATUS.SENT_BACK) {
    return userRole === INSTRUMENT_ROLES.REVIEWER ? "fill-manager" : "waiting-manager";
  }
  if (status === CYCLE_REVIEW_STATUS.IN_CALIBRATION) {
    return (userRole === INSTRUMENT_ROLES.OVERSIGHT || userRole === INSTRUMENT_ROLES.SYSTEM_VIEWER)
      ? "calibrate"
      : "waiting-calibration";
  }
  if (status === CYCLE_REVIEW_STATUS.CALIBRATED) {
    return userRole === INSTRUMENT_ROLES.REVIEWER ? "conversation" : "waiting-conversation";
  }
  if (status === CYCLE_REVIEW_STATUS.AWAITING_RESPONSE ||
      status === CYCLE_REVIEW_STATUS.CONVERSATION_HELD) {
    return userRole === INSTRUMENT_ROLES.REVIEWED_PARTY ? "response" : "waiting-response";
  }
  if (status === CYCLE_REVIEW_STATUS.SIGN_OFF_PENDING) {
    return "signoff";
  }
  return "summary";
}

export default function CycleReviewWorkspace({ reviewId, currentUserEmail, onBack, showToast }) {
  const [review, setReview] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/people/leadership-dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get-cycle-review", email: currentUserEmail, review_id: reviewId }),
      });
      const data = await res.json();
      if (data?.ok) {
        setReview(data.review);
        setUserRole(data.user_role);
        setError(null);
      } else {
        setError(data?.error || "Failed to load");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [reviewId, currentUserEmail]);

  useEffect(() => {
    if (reviewId) reload();
  }, [reviewId, reload]);

  if (loading) return <div className="pp-ldug-loading">Loading Cycle Review…</div>;
  if (error) {
    return (
      <div className="pp-ldug-empty-state">
        <h3 className="pp-ldug-empty-title">Couldn't load this review</h3>
        <p className="pp-ldug-empty-desc">{error}</p>
        <button className="pp-ldug-link" onClick={onBack}>← Back</button>
      </div>
    );
  }
  if (!review) return null;

  const { header } = review;
  const screen = deriveScreen(header.status, userRole);

  return (
    <div className="pp-ldug-cr-workspace">
      <div className="pp-ldug-wow-workspace-header">
        <button className="pp-ldug-link" onClick={onBack}>← Back</button>
        <span className={`pp-ldug-status-pill pp-ldug-status-pill--${header.status.toLowerCase()}`}>
          {STATUS_LABEL[header.status] || header.status}
        </span>
      </div>

      <div className="pp-ldug-wow-workspace-title">
        <h2>Cycle Review · {header.leader_name}</h2>
        <p>
          {header.role} · {header.account} · {header.cycle_id} ·
          {" "}<strong>You are {userRole}</strong>
        </p>
      </div>

      <ChainSnapshotBadge
        leaderName={header.leader_name}
        reviewerName={header.reviewer_name || header.reviewer_email}
        oversightName={header.oversight_name || header.oversight_email}
      />

      <CoEditorBanner
        lastEditorEmail={header.last_action_by}
        lastEditorName={null}
        lastEditedAt={header.last_action_at}
        currentUserEmail={currentUserEmail}
      />

      {/* Real screens */}
      {screen === "fill-self" && (
        <CycleReviewFill
          mode="self"
          review={review}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onSubmit={reload}
        />
      )}
      {screen === "fill-manager" && (
        <CycleReviewFill
          mode="manager"
          review={review}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onSubmit={reload}
        />
      )}
      {screen === "calibrate" && (
        <CycleReviewCalibrate
          review={review}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onSubmit={reload}
        />
      )}
      {screen === "conversation" && (
        <CycleReviewConversation
          review={review}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onSubmit={reload}
        />
      )}
      {screen === "response" && (
        <CycleReviewResponse
          review={review}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onSubmit={reload}
        />
      )}
      {screen === "signoff" && (
        <CycleReviewSignOff
          review={review}
          userRole={userRole}
          currentUserEmail={currentUserEmail}
          showToast={showToast}
          onSign={reload}
        />
      )}
      {screen === "summary" && (
        <div className="pp-ldug-empty-state">
          <h3 className="pp-ldug-empty-title">Closed</h3>
          <p className="pp-ldug-empty-desc">
            All three signatures collected. PDF archive will appear once render completes (Chunk 6).
          </p>
        </div>
      )}

      {/* Waiting states */}
      {screen.startsWith("waiting-") && (
        <div className="pp-ldug-empty-state">
          <h3 className="pp-ldug-empty-title">Nothing for you to do right now</h3>
          <p className="pp-ldug-empty-desc">
            {STATUS_LABEL[header.status] || "Awaiting next step in the chain."} You'll be
            notified via Slack when it's your turn.
          </p>
        </div>
      )}
    </div>
  );
}
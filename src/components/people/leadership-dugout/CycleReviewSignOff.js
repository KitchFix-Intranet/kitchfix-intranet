"use client";

// ════════════════════════════════════════════════════════════════════════════
// CycleReviewSignOff — three-signature collection
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 5)
// CSS prefix: pp-ldug-
//
// Three sign-off blocks (Reviewed Party / Reviewer / Oversight). Each user
// signs their own row. When all 3 collected, status flips to Closed.
// PDF render fires async (Chunk 6).
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import SignOffBlock from "@/components/people/leadership-dugout/SignOffBlock";
import { INSTRUMENT_ROLES } from "@/lib/performanceSchema";

export default function CycleReviewSignOff({ review, userRole, currentUserEmail, onSign, showToast }) {
  const header = review?.header || {};
  const [submitting, setSubmitting] = useState(false);

  const handleSign = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/people/leadership-dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign-off-cycle-review",
          email: currentUserEmail,
          review_id: header.id,
        }),
      }).then((r) => r.json());

      if (res?.ok) {
        if (res.final_signature) {
          showToast?.({ msg: "Final signature collected. Cycle Review closed.", type: "success" });
        } else {
          showToast?.({ msg: "Signed. Awaiting other sign-offs.", type: "success" });
        }
        onSign?.();
      } else {
        showToast?.({ msg: res?.error || "Sign-off failed", type: "error" });
      }
    } catch (e) {
      showToast?.({ msg: e.message, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pp-ldug-cr-signoff">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">Sign-offs</h3>
        <p className="pp-ldug-section-desc">
          Three sigs close the review and trigger the PDF archive. Each party signs their
          own row.
        </p>
      </div>

      <div className="pp-ldug-signoff-grid">
        <SignOffBlock
          role="Reviewed Party"
          signerName={header.leader_name}
          signedAt={header.sig_reviewed_party_at || null}
          onSign={userRole === INSTRUMENT_ROLES.REVIEWED_PARTY ? handleSign : undefined}
          acknowledgmentText="I acknowledge this Cycle Review and the priorities going forward."
        />
        <SignOffBlock
          role="Reviewer"
          signerName={header.reviewer_name || header.reviewer_email}
          signedAt={header.sig_reviewer_at || null}
          onSign={userRole === INSTRUMENT_ROLES.REVIEWER ? handleSign : undefined}
          acknowledgmentText="I've delivered this review and aligned on next-cycle priorities."
        />
        <SignOffBlock
          role="Oversight"
          signerName={header.oversight_name || header.oversight_email}
          signedAt={header.sig_oversight_at || null}
          onSign={userRole === INSTRUMENT_ROLES.OVERSIGHT ? handleSign : undefined}
          acknowledgmentText="I've calibrated this review and approve closure."
        />
      </div>

      {submitting && <div className="pp-ldug-form-hint" style={{ marginTop: 12 }}>Signing…</div>}

      {userRole === INSTRUMENT_ROLES.NONE && (
        <p className="pp-ldug-form-hint" style={{ marginTop: 12 }}>
          You're viewing this as a system viewer. Each chain party signs their own row from their account.
        </p>
      )}
    </div>
  );
}
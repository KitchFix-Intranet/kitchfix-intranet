"use client";

// ════════════════════════════════════════════════════════════════════════════
// CycleReviewCalibrate — split-pane self vs manager + Section 10 + outcomes
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 5)
// CSS prefix: pp-ldug-
//
// Oversight-only screen. Shows:
//   - Six themes self vs manager side-by-side with delta chips
//   - Composites side-by-side
//   - Section 10 calibration notes (gated to Reviewer/Oversight/SystemViewer)
//   - Three outcome buttons: Approve / Approve with notes / Send back
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import DeltaFlag from "@/components/people/leadership-dugout/DeltaFlag";
import Section10Notes from "@/components/people/leadership-dugout/Section10Notes";
import { THEMES, getCompositesForRole } from "@/lib/performanceSchema";

export default function CycleReviewCalibrate({ review, currentUserEmail, onSubmit, showToast }) {
  const header = review?.header || {};
  const body = review?.body || {};
  const themesSelf = body.themes_self || [];
  const themesManager = body.themes_manager || [];
  const compositesSelf = body.composites_self || [];
  const compositesManager = body.composites_manager || [];
  const applicableComposites = getCompositesForRole(header.role);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (outcome) => {
    if (outcome === "SentBack") {
      const reason = window.prompt("Reason for sending back to Reviewer? (Required)");
      if (!reason || !reason.trim()) {
        showToast?.({ msg: "Send-back requires a reason.", type: "error" });
        return;
      }
      // Append reason to notes
      const existingNotes = body.calibration?.notes || "";
      const stamped = `${existingNotes}\n\n[Sent back ${new Date().toLocaleDateString()}]: ${reason}`.trim();
      await fetch("/api/people/leadership-dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-cycle-review-section",
          email: currentUserEmail,
          review_id: header.id,
          section_key: "calibration",
          value: { ...(body.calibration || {}), notes: stamped },
        }),
      });
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/people/leadership-dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-calibration",
          email: currentUserEmail,
          review_id: header.id,
          outcome,
        }),
      }).then((r) => r.json());
      if (res?.ok) {
        showToast?.({
          msg: outcome === "SentBack"
            ? "Sent back to Reviewer."
            : `Calibration ${outcome === "Approved" ? "approved" : "approved with notes"}.`,
          type: "success",
        });
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
    <div className="pp-ldug-cr-calibrate">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">Calibration</h3>
        <p className="pp-ldug-section-desc">
          Walk the manager draft against the self-assessment. Flag deltas worth a conversation.
          Drop calibration notes for the Reviewer (Section 10 — never visible to Reviewed Party).
          Approve, approve with notes, or send back.
        </p>
      </div>

      {/* SIX THEMES */}
      <div className="pp-ldug-cr-section-group">
        <h4 className="pp-ldug-cr-group-title">Six Themes — self vs manager</h4>
        {THEMES.map((theme) => {
          const self = themesSelf.find((t) => t.theme_id === theme.id) || {};
          const mgr = themesManager.find((t) => t.theme_id === theme.id) || {};
          return (
            <div key={theme.id} className="pp-ldug-cr-split-row">
              <div className="pp-ldug-cr-split-header">
                <h5 className="pp-ldug-cr-theme-title">{theme.label}</h5>
                <DeltaFlag selfRating={self.rating} managerRating={mgr.rating} compact />
              </div>
              <div className="pp-ldug-cr-split-body">
                <div className="pp-ldug-cr-split-pane">
                  <div className="pp-ldug-cr-split-tag">Self</div>
                  <div className="pp-ldug-cr-split-rating">{self.rating ?? "—"}</div>
                  <div className="pp-ldug-cr-split-narrative">{self.narrative || <em>—</em>}</div>
                  {self.example && <div className="pp-ldug-cr-split-example">{self.example}</div>}
                </div>
                <div className="pp-ldug-cr-split-pane pp-ldug-cr-split-pane--manager">
                  <div className="pp-ldug-cr-split-tag">Manager</div>
                  <div className="pp-ldug-cr-split-rating">{mgr.rating ?? "—"}</div>
                  <div className="pp-ldug-cr-split-narrative">{mgr.narrative || <em>—</em>}</div>
                  {mgr.example && <div className="pp-ldug-cr-split-example">{mgr.example}</div>}
                </div>
              </div>
              <DeltaFlag selfRating={self.rating} managerRating={mgr.rating} />
            </div>
          );
        })}
      </div>

      {/* COMPOSITES */}
      <div className="pp-ldug-cr-section-group">
        <h4 className="pp-ldug-cr-group-title">Composites</h4>
        {applicableComposites.map((comp) => {
          const self = compositesSelf.find((c) => c.composite_id === comp.id) || {};
          const mgr = compositesManager.find((c) => c.composite_id === comp.id) || {};
          return (
            <div key={comp.id} className="pp-ldug-cr-split-row">
              <div className="pp-ldug-cr-split-header">
                <h5 className="pp-ldug-cr-theme-title">{comp.label}</h5>
                <DeltaFlag selfRating={self.rating} managerRating={mgr.rating} compact />
              </div>
              <div className="pp-ldug-cr-split-body">
                <div className="pp-ldug-cr-split-pane">
                  <div className="pp-ldug-cr-split-tag">Self</div>
                  <div className="pp-ldug-cr-split-rating">{self.rating ?? "—"}</div>
                  <div className="pp-ldug-cr-split-narrative">{self.narrative || <em>—</em>}</div>
                </div>
                <div className="pp-ldug-cr-split-pane pp-ldug-cr-split-pane--manager">
                  <div className="pp-ldug-cr-split-tag">Manager</div>
                  <div className="pp-ldug-cr-split-rating">{mgr.rating ?? "—"}</div>
                  <div className="pp-ldug-cr-split-narrative">{mgr.narrative || <em>—</em>}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* TOP 3 from Manager */}
      {(body.top3_strengths?.length > 0 || body.top3_dev_areas?.length > 0) && (
        <div className="pp-ldug-cr-section-group">
          <h4 className="pp-ldug-cr-group-title">Manager's Top 3</h4>
          <div className="pp-ldug-cr-top3-grid">
            <div>
              <div className="pp-ldug-form-label">Strengths</div>
              <ol className="pp-ldug-cr-top3-list">
                {(body.top3_strengths || []).map((s, i) => (
                  <li key={i}>{s.item || <em>—</em>}</li>
                ))}
              </ol>
            </div>
            <div>
              <div className="pp-ldug-form-label">Development areas</div>
              <ol className="pp-ldug-cr-top3-list">
                {(body.top3_dev_areas || []).map((s, i) => (
                  <li key={i}>{s.item || <em>—</em>}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 10 */}
      <div className="pp-ldug-cr-section-group">
        <Section10Notes review={review} currentUserEmail={currentUserEmail} />
      </div>

      {/* OUTCOMES */}
      <div className="pp-ldug-cr-outcomes">
        <button
          className="pp-card-cta pp-card-cta--primary"
          disabled={submitting}
          onClick={() => submit("Approved")}
        >
          ✓ Approve
        </button>
        <button
          className="pp-ldug-cr-outcome-btn pp-ldug-cr-outcome-btn--notes"
          disabled={submitting}
          onClick={() => submit("ApprovedWithNotes")}
        >
          Approve with notes
        </button>
        <button
          className="pp-ldug-cr-outcome-btn pp-ldug-cr-outcome-btn--sendback"
          disabled={submitting}
          onClick={() => submit("SentBack")}
        >
          ↩ Send back to Reviewer
        </button>
      </div>
    </div>
  );
}
"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Stepper, YesNoToggle } from "./shared";
import {
  INCIDENT_TYPES,
  SEVERITY_TIERS,
} from "@/lib/incidentSchema";

// ═══════════════════════════════════════════════════════════════
// INCIDENT CENTER - 5-step submission wizard
// Lives at view === "incidents" inside /people/page.js
// Mirrors the PAFForm.js / NewHireWizard.js patterns
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// TYPE ICONS (Lucide-style line icons)
// ─────────────────────────────────────────────
const ICONS = {
  employee_injury: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 12H3" /><path d="M16 6H3" /><path d="M16 18H3" />
      <path d="M18 9v6" /><path d="M21 12h-6" />
    </svg>
  ),
  vehicle: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
      <circle cx="7" cy="17" r="2" />
      <path d="M9 17h6" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  ),
  allergen_reaction: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="5" />
      <circle cx="15" cy="15" r="5" />
    </svg>
  ),
  foodborne_illness: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2v8.5a2.5 2.5 0 0 1-5 0V2" />
      <path d="M7 2v20" />
      <path d="M21 16V2H17a4 4 0 0 0 0 8h4" />
      <path d="M17 12v10" />
    </svg>
  ),
  food_safety: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z" />
    </svg>
  ),
  property_damage: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  non_employee_injury: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  near_miss: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  ),
  security_altercation: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  ),
};

const TOTAL_STEPS = 5;

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function IncidentCenter({ bootstrapData, onNavigate, showToast, refreshHistory }) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null); // { incidentId, driveFolderUrl, notificationsSent }
  const [errors, setErrors] = useState({});

  const [form, setForm] = useState({
    incident_type: null,
    severity: null,
    site_code: "",
    incident_date: "",
    incident_time: "",
    location_detail: "",
    manager_aware_date: "",
    what_happened: "",
    immediate_actions_taken: "",
    witnesses: "",
    type_specific_data: {},
    attachments: [], // { name, mimeType, base64, size }
  });

  const update = (field, value) => {
    setForm((f) => {
      const next = { ...f, [field]: value };
      // SOP severity auto-rules (Bucket C)
      if (field === "incident_type") {
        // C1 - foodborne illness is ALWAYS S1 (SOP §7.4)
        if (value === "foodborne_illness") next.severity = "S1";
        // C4 - near-miss defaults to S4 (SOP §7.8)
        else if (value === "near_miss" && !next.severity) next.severity = "S4";
        // C3 - non-employee injury is S2 minimum; clear if currently S3/S4
        else if (value === "non_employee_injury" && (next.severity === "S3" || next.severity === "S4")) {
          next.severity = "S2";
        }
      }
      return next;
    });
    if (errors[field]) {
      setErrors((e) => { const n = { ...e }; delete n[field]; return n; });
    }
  };
  const updateTS = (field, value) => {
    setForm((f) => {
      const nextTS = { ...f.type_specific_data, [field]: value };
      const next = { ...f, type_specific_data: nextTS };
      // C2 - food safety auto-escalates to S1 if food was served (SOP §7.5)
      if (f.incident_type === "food_safety" && field === "food_served" && value === "Yes") {
        next.severity = "S1";
      }
      return next;
    });
  };

  // Severity options gating (C3 - non-employee injury removes S3/S4)
  const allowedSeverities = (() => {
    if (form.incident_type === "foodborne_illness") return ["S1"];                // C1 lock
    if (form.incident_type === "non_employee_injury") return ["S1", "S2"];        // C3 floor
    return ["S1", "S2", "S3", "S4"];
  })();
  const severityLocked = allowedSeverities.length === 1;

  // ─── Validation per step ───
  const validateStep = (s) => {
    const e = {};
    if (s === 1 && !form.incident_type) e.incident_type = true;
    if (s === 2 && !form.severity) e.severity = true;
    if (s === 3) {
      if (!form.site_code) e.site_code = true;
      if (!form.incident_date) e.incident_date = true;
      if (!form.incident_time) e.incident_time = true;
      if (!form.manager_aware_date) e.manager_aware_date = true;
      if (!form.what_happened || form.what_happened.trim().length < 10) e.what_happened = true;
      if (!form.immediate_actions_taken || form.immediate_actions_taken.trim().length < 5) e.immediate_actions_taken = true;
    }
    return e;
  };

  const handleNext = () => {
    const e = validateStep(step);
    if (Object.keys(e).length > 0) {
      setErrors(e);
      return;
    }
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      handleSubmit();
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
    else onNavigate("dashboard");
  };

// ─── Submit ───
  const handleSubmit = async () => {
    // Direction A guard: even with image compression, a stack of large PDFs
    // can still blow the 4.5MB serverless body limit. Sum base64 lengths;
    // base64 is ~1.37x raw bytes, so 3.5MB encoded ≈ 2.6MB actual. Block at
    // 3.5MB to leave headroom for form fields + JSON overhead.
    const PAYLOAD_LIMIT_B64 = 3.5 * 1024 * 1024;
    const totalB64 = (form.attachments || []).reduce(
      (sum, a) => sum + (a.base64?.length || 0),
      0
    );
    if (totalB64 > PAYLOAD_LIMIT_B64) {
      const totalMb = (totalB64 / 1024 / 1024).toFixed(1);
      if (showToast) {
        showToast(
          `⚠️ Attachments total ~${totalMb} MB — too large to submit. Remove a file and try again.`,
          "error"
        );
      }
      return;
    }

setSubmitting(true);
    try {
      const payload = {
        ...form,
        // attachments are already base64 in form state
        submitterEmail: bootstrapData?.userEmail || "",
        submitterName: bootstrapData?.firstName || "",
      };

      // P4 diagnostic — log payload shape to browser console pre-flight.
      // If submit fails / files don't land, this log answers: "did the client
      // even try to send N files of size X each, or was the array empty?"
      const reqBody = JSON.stringify({ action: "submit-incident", form: payload });
      const reqMb = (reqBody.length / 1024 / 1024).toFixed(2);
      console.log(
        `[Incident] POST /api/people | action=submit-incident | ` +
        `attachments=${(form.attachments || []).length} | ` +
        `payload=${reqMb} MB | ` +
        `Vercel limit=4.5 MB`
      );
      if (form.attachments?.length) {
        form.attachments.forEach((a, i) => {
          console.log(`[Incident]   client attachment[${i}] name=${a.name} size=${a.size} b64Len=${a.base64?.length || 0}`);
        });
      }

      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: reqBody,
      });
      console.log(`[Incident] response status=${res.status} ok=${res.ok}`);
      const data = await res.json();
      console.log(`[Incident] response body=`, data);

      if (data.success) {
        setSuccess({
          incidentId: data.incident_id,
          driveFolderUrl: data.drive_folder_url,
          notificationsSent: data.notifications_sent,
          severity: form.severity,
          incidentType: form.incident_type,
          medicalTreatmentRefused: form.type_specific_data?.medical_treatment_refused === "Yes",
          // P4 diagnostic: pass through attachment outcomes
          attachmentsTotal: data.attachments_total ?? 0,
          attachmentsUploaded: data.attachments_uploaded ?? 0,
          attachmentErrors: data.attachment_errors || [],
          // P4C: PDF export — base64 for client-side download
          pdfBase64: data.pdf_base64 || "",
          pdfDriveUrl: data.pdf_drive_url || "",
        });
        if (refreshHistory) refreshHistory();
        if (showToast) showToast("✅ Incident submitted");
      } else {
        if (showToast) showToast(`⚠️ ${data.error || "Submission failed"}`, "error");
      }
    } catch (err) {
      console.error(`[Incident] submit threw:`, err);
      if (showToast) showToast(`⚠️ Error: ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setForm({
      incident_type: null, severity: null,
      site_code: "", incident_date: "", incident_time: "",
      location_detail: "", manager_aware_date: "",
      what_happened: "", immediate_actions_taken: "", witnesses: "",
      type_specific_data: {}, attachments: [],
    });
    setStep(1);
    setSuccess(null);
    setErrors({});
  };

  // ─── Success view ───
  // P4B Option A: redesigned as a single confirmation card with conversational tone.
  // Was: 7 separate elements (check + title + subtitle + ID pill + notif list + Drive link + Appendix C card + 2 buttons)
  // Now: tight single card. Green check, "Incident submitted", INC ID, conversational summary.
  // Secondary actions (Drive folder, Appendix C, S1 callout) tucked under primary confirmation.
  if (success) {
    const isS1 = success.severity === "S1";
    const needsAppendixC = success.incidentType === "employee_injury" && success.medicalTreatmentRefused;
    const allAttachmentsLanded = success.attachmentsTotal > 0 && success.attachmentsUploaded === success.attachmentsTotal;
    const partialAttachments = success.attachmentsTotal > 0 && success.attachmentsUploaded < success.attachmentsTotal;

    return (
      <div className="pp-card pp-card--form pp-inc-nested" style={{ padding: "32px 24px", maxWidth: 480, margin: "0 auto" }}>

        {/* Hero: green check + heading + INC ID — tight stack */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%", background: "#d1fae5", color: "#059669",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h2 className="pp-card-title" style={{ marginBottom: 4, fontSize: 18 }}>Incident submitted</h2>
          <div style={{
            display: "inline-block", fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 500,
            color: "#7c3aed", letterSpacing: "0.04em",
          }}>
            {success.incidentId}
          </div>
        </div>

        {/* Conversational summary — replaces "Your incident has been recorded" + notification list */}
        <p style={{
          fontSize: 13, color: "#475569", lineHeight: 1.55, margin: "0 0 16px", textAlign: "center",
        }}>
          All set. We'll route this to Mariela and the leadership team.
          {isS1 && " S1 protocol requires a phone call — see below."}
        </p>

        {/* Attachment status — quiet line for success, amber callout for partial */}
        {allAttachmentsLanded && (
          <div style={{
            fontSize: 12, color: "#10b981", textAlign: "center", marginBottom: 16,
          }}>
            ✓ {success.attachmentsTotal === 1 ? "1 attachment uploaded" : `${success.attachmentsTotal} attachments uploaded`}
          </div>
        )}
        {partialAttachments && (
          <div style={{
            background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8,
            padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#92400e",
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              ⚠ {success.attachmentsUploaded}/{success.attachmentsTotal} attachments uploaded
            </div>
            {success.attachmentErrors?.length > 0 && (
              <ul style={{ margin: "4px 0 0 16px", padding: 0, fontSize: 11 }}>
                {success.attachmentErrors.map((e, i) => (
                  <li key={i}>{e.name}: {e.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* S1 protocol callout — only when severity is S1 */}
        {isS1 && (
          <div className="pp-inc-callout pp-inc-callout--critical" style={{ marginBottom: 16 }}>
            <div className="pp-inc-callout-head">📞 Call Mariela now</div>
            <div className="pp-inc-callout-phone">
              <a href="tel:+13125481420">(312) 548-1420</a>
            </div>
            <div className="pp-inc-callout-body">
              Within 15 minutes once the person is in a safe spot. The form does not replace the call.
            </div>
          </div>
        )}

        {/* Appendix C callout — only when employee_injury + medical_treatment_refused */}
        {needsAppendixC && (
          <div className="pp-inc-callout pp-inc-callout--warn" style={{ marginBottom: 16 }}>
            <div className="pp-inc-callout-head">📝 Appendix C required</div>
            <div className="pp-inc-callout-body">
              Complete the <strong>Refusal of Medical Treatment</strong> form. Both employee and manager must sign. Send signed copy to Mariela.
              {bootstrapData?.appendixCUrl && (
                <div style={{ marginTop: 8 }}>
                  <a
                    href={bootstrapData.appendixCUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 12px", background: "#d97706", color: "white",
                      textDecoration: "none", borderRadius: 6, fontSize: 12, fontWeight: 600,
                    }}
                  >
                    📄 Open / print Appendix C →
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Secondary actions — Drive folder + Download PDF, both quiet text links */}
        {(success.driveFolderUrl || success.pdfBase64) && (
          <div style={{
            display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap",
            marginBottom: 18,
          }}>
            {success.driveFolderUrl && (
              <a
                href={success.driveFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#7c3aed", textDecoration: "none", fontSize: 13, fontWeight: 500,
                }}
              >
                📂 Open Drive folder ↗
              </a>
            )}
            {/* P4C: Download PDF — converts base64 to a Blob, triggers browser download.
                Filename matches the Drive copy ({INC_ID}_Report.pdf). */}
            {success.pdfBase64 && (
              <button
                type="button"
                onClick={() => {
                  try {
                    const byteChars = atob(success.pdfBase64);
                    const bytes = new Uint8Array(byteChars.length);
                    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
                    const blob = new Blob([bytes], { type: "application/pdf" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${success.incidentId || "incident"}_Report.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    console.error("[Incident] PDF download failed:", err);
                    if (showToast) showToast("⚠️ PDF download failed", "error");
                  }
                }}
                style={{
                  background: "none", border: "none", padding: 0, cursor: "pointer",
                  color: "#7c3aed", fontSize: 13, fontWeight: 500, fontFamily: "inherit",
                }}
              >
                📥 Download report PDF
              </button>
            )}
          </div>
        )}

        {/* Primary navigation — two buttons, equal weight */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="pp-btn pp-btn--ghost" onClick={() => { resetForm(); onNavigate("dashboard"); }}>
            Back to Home
          </button>
          <button className="pp-btn pp-btn--primary" onClick={resetForm}>
            Submit another
          </button>
        </div>
      </div>
    );
  }

  // ─── Wizard view ───
  return (
    <div className="pp-card pp-card--form pp-inc-nested">
      <Stepper step={step} totalSteps={TOTAL_STEPS} />

        <div className="pp-form-content">
{step === 1 && <Step1Type form={form} update={update} errors={errors} />}
          {step === 2 && <Step2Severity form={form} update={update} errors={errors} allowedSeverities={allowedSeverities} severityLocked={severityLocked} />}
          {step === 3 && <Step3Basics form={form} update={update} errors={errors} locations={bootstrapData?.locations || []} />}
          {step === 4 && <Step4TypeSpecific form={form} updateTS={updateTS} appendixCUrl={bootstrapData?.appendixCUrl} />}
          {step === 5 && <Step5Review form={form} update={update} submitting={submitting} locations={bootstrapData?.locations || []} />}
                  </div>

        <div className="pp-form-footer">
          <button className="pp-btn pp-btn--ghost" onClick={handleBack} disabled={submitting}>
            Back
          </button>
          <button
            className="pp-btn pp-btn--primary"
            onClick={handleNext}
            disabled={submitting}
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {submitting ? (
              <><span className="pp-spinner" /> Submitting...</>
            ) : step === TOTAL_STEPS ? "Submit" : "Next"}
          </button>
        </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STEP 1 - TYPE PICKER
// ═══════════════════════════════════════════════════════════════
// P1 — Phase 2: domain grouping for the Step 1 type picker.
// Cuts the 9-card flat scan into three operational buckets, reducing
// cognitive load on first-time submitters (Hick's Law).
// Order within each group preserves the existing schema order so the
// underlying data flow / icons / colors don't change.
const TYPE_GROUPS = [
  {
    id: "people",
    label: "People",
    types: ["employee_injury", "non_employee_injury"],
  },
  {
    id: "operations",
    label: "Operations",
    types: ["vehicle", "allergen_reaction", "foodborne_illness", "food_safety", "property_damage"],
  },
  {
    id: "hazards",
    label: "Hazards & Security",
    types: ["near_miss", "security_altercation"],
  },
];

function Step1Type({ form, update, errors }) {
  return (
    <>

      <h3 className="pp-card-title" style={{ marginBottom: 4 }}>What kind of incident?</h3>
      <p className="pp-inc-step-help">Pick the type that best fits. If unsure between two, pick the more serious one.</p>

      {TYPE_GROUPS.map((group, gIdx) => {
        const groupTypes = group.types
          .map((id) => INCIDENT_TYPES.find((t) => t.id === id))
          .filter(Boolean);
        if (groupTypes.length === 0) return null;
        return (
          <div key={group.id} style={{ marginTop: gIdx === 0 ? 0 : 18 }}>
            <div className="pp-inc-typegroup-label">{group.label}</div>
            <div className="pp-inc-typegrid">
              {groupTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`pp-inc-typecard${form.incident_type === t.id ? " pp-inc-typecard--selected" : ""}`}
                  onClick={() => update("incident_type", t.id)}
                >
                  <div className="pp-inc-typeicon" style={{ background: t.color }}>
                    {ICONS[t.id]}
                  </div>
                  <div className="pp-inc-typelabel">{t.label}</div>
                  <div className="pp-inc-typedesc">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {errors.incident_type && <div className="pp-inc-step-error">Please pick an incident type</div>}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// STEP 2 - SEVERITY PICKER (with SOP auto-rules per Bucket C)
// ═══════════════════════════════════════════════════════════════
function Step2Severity({ form, update, errors, allowedSeverities, severityLocked }) {
  const showLockNotice = severityLocked && form.incident_type === "foodborne_illness";
  const showFloorNotice = form.incident_type === "non_employee_injury";
  const showNearMissPrompt = form.incident_type === "near_miss";

  return (
    <>

      <h3 className="pp-card-title" style={{ marginBottom: 4 }}>How severe is it?</h3>
      <p className="pp-inc-step-help">Not sure? Classify up — Mariela can downgrade in triage.</p>

{showLockNotice && (
        <div className="pp-inc-callout pp-inc-callout--lock">
          <strong>Auto-classified:</strong> Suspected foodborne illness is always S1. Mariela will triage.
        </div>
      )}
      {showFloorNotice && (
        <div className="pp-inc-callout pp-inc-callout--note">
          <strong>Note:</strong> Non-employee injury is S2 minimum. Player injury or any offsite medical care = S1.
        </div>
      )}
      {showNearMissPrompt && (
        <div className="pp-inc-callout pp-inc-callout--note">
          <strong>Worst-case check:</strong> If this had played out worst-case, would it have been S1 or S2? If yes, classify there — not S4.
        </div>
      )}

      {/* P0 — Phase 1: SOP §06 Critical S1 phone call callout.
          Was previously rendered AFTER the tier stack, which buried the most
          critical instruction in the entire flow below the Near-Miss option.
          A chef on a phone in a real S1 had to scroll past S2/S3/S4 to find it.
          Moved here so it appears immediately when S1 is selected, in the
          thumb zone, with the call-Mariela tap target front-and-center. */}
      {form.severity === "S1" && (
        <div className="pp-inc-callout pp-inc-callout--critical">
          <div className="pp-inc-callout-head">📞 S1 requires a phone call — the form is not enough</div>
          <div className="pp-inc-callout-body">
            Within 15 minutes once the person is in a safe spot, the Site Leader or Manager of Record personally calls Mariela at <a href="tel:+13125481420">(312) 548-1420</a>. Voicemail counts only with a callback number AND a Slack message.
          </div>
        </div>
      )}

      <div className="pp-inc-tierstack">
        {SEVERITY_TIERS.map((t) => {
          const allowed = allowedSeverities.includes(t.id);
          const selected = form.severity === t.id;
          return (
            <button
              key={t.id}
              type="button"
              className={`pp-inc-tiercard${selected ? " pp-inc-tiercard--selected" : ""}${!allowed ? " pp-inc-tiercard--disabled" : ""}`}
              style={{ "--tc": t.color, borderLeftColor: t.color }}
              onClick={() => allowed && update("severity", t.id)}
              disabled={!allowed}
              title={!allowed ? "Not allowed for this incident type per SOP" : ""}
            >
              <div className="pp-inc-tier-row">
                <span className="pp-inc-tier-code" style={{ background: t.color }}>{t.id}</span>
                <span className="pp-inc-tier-label">{t.label}</span>
                <span className="pp-inc-tier-deadline" style={{ color: t.color }}>{t.deadline}</span>
              </div>
              <div className="pp-inc-tier-examples">{t.examples}</div>
            </button>
          );
        })}
      </div>

      {errors.severity && <div className="pp-inc-step-error">Please pick a severity tier</div>}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// STEP 3 - THE BASICS (combined site/date/time/location/aware/description/witnesses)
// ═══════════════════════════════════════════════════════════════
function Step3Basics({ form, update, errors, locations = [] }) {
      return (
    <>

      <h3 className="pp-card-title" style={{ marginBottom: 4 }}>The basics</h3>
      <p className="pp-inc-step-help">Capture the essential facts. The "manager became aware" date is a compliance check (24-hour rule).</p>

      <div className="pp-inc-section-divider">When &amp; where</div>

<label className="pp-label">Site</label>
      <select
        className={`pp-select${errors.site_code ? " pp-input-error" : ""}`}
        value={form.site_code}
        onChange={(e) => update("site_code", e.target.value)}
      >
        <option value="">Select a site...</option>
        {/* W7 — sourced from Hub `accounts` tab via bootstrapData.locations.
            Single source of truth across People Portal (PAF, New Hire, Incidents). */}
        {locations.map((s) => (
          <option key={s.key} value={s.key}>{s.key} — {s.name}</option>
        ))}
      </select>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">Incident date</label>
          <input
            type="date"
            className={`pp-input${errors.incident_date ? " pp-input-error" : ""}`}
            value={form.incident_date}
            onChange={(e) => update("incident_date", e.target.value)}
          />
        </div>
        <div>
          <label className="pp-label">Incident time</label>
          <input
            type="time"
            className={`pp-input${errors.incident_time ? " pp-input-error" : ""}`}
            value={form.incident_time}
            onChange={(e) => update("incident_time", e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">Location within site</label>
          <input
            type="text"
            className="pp-input"
            value={form.location_detail}
            onChange={(e) => update("location_detail", e.target.value)}
            placeholder="e.g., walk-in cooler"
          />
        </div>
        <div>
          <label className="pp-label">Manager aware date</label>
          <input
            type="date"
            className={`pp-input${errors.manager_aware_date ? " pp-input-error" : ""}`}
            value={form.manager_aware_date}
            onChange={(e) => update("manager_aware_date", e.target.value)}
          />
        </div>
      </div>

      <div className="pp-inc-section-divider" style={{ marginTop: 18 }}>What happened</div>

      <label className="pp-label">Describe what happened</label>
      <textarea
        className={`pp-input${errors.what_happened ? " pp-input-error" : ""}`}
        rows={5}
        value={form.what_happened}
        onChange={(e) => update("what_happened", e.target.value)}
        placeholder="e.g., 'Cook was prepping vegetables when knife slipped...'"
        style={{ resize: "vertical", minHeight: 90 }}
      />

      <label className="pp-label" style={{ marginTop: 12 }}>Immediate actions taken</label>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
        What did you do right after — first aid, called 911, pulled the food, cordoned the area, etc.
      </div>
      <textarea
        className={`pp-input${errors.immediate_actions_taken ? " pp-input-error" : ""}`}
        rows={3}
        value={form.immediate_actions_taken}
        onChange={(e) => update("immediate_actions_taken", e.target.value)}
        placeholder="e.g., 'Applied pressure with clean towel, escorted to urgent care, pulled all knives from line for inspection.'"
        style={{ resize: "vertical", minHeight: 70 }}
      />

      <label className="pp-label" style={{ marginTop: 12 }}>Witnesses</label>
      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
        Names + phone/email — one per line. Optional.
      </div>
      <textarea
        className="pp-input"
        rows={2}
        value={form.witnesses}
        onChange={(e) => update("witnesses", e.target.value)}
        placeholder="e.g., 'Maria Lopez (line cook), 555-1234'"
        style={{ resize: "vertical", minHeight: 60 }}
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// STEP 4 - TYPE-SPECIFIC FIELDS (router by type)
// ═══════════════════════════════════════════════════════════════
function Step4TypeSpecific({ form, updateTS, appendixCUrl }) {
      const typeMeta = INCIDENT_TYPES.find((t) => t.id === form.incident_type);

  let content;
if (form.incident_type === "employee_injury") {
    content = <EmployeeInjuryFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} appendixCUrl={appendixCUrl} />;
  } else if (form.incident_type === "vehicle") {
        content = <VehicleFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} />;
  } else if (form.incident_type === "allergen_reaction") {
    content = <AllergenFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} />;
  } else if (form.incident_type === "foodborne_illness") {
    content = <FoodborneFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} />;
  } else if (form.incident_type === "food_safety") {
    content = <FoodSafetyFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} />;
  } else if (form.incident_type === "property_damage") {
    content = <PropertyDamageFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} />;
  } else if (form.incident_type === "non_employee_injury") {
    content = <NonEmployeeInjuryFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} />;
  } else if (form.incident_type === "near_miss") {
    content = <NearMissFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} />;
  } else if (form.incident_type === "security_altercation") {
    content = <SecurityFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} />;
  } else {
    content = <div style={{ color: "#94a3b8", fontSize: 13 }}>No additional fields for this type. Click Next to continue.</div>;
  }

  return (
    <>

      <h3 className="pp-card-title" style={{ marginBottom: 4 }}>Type-specific details</h3>
      <p className="pp-inc-step-help">A few extra fields that only apply to {typeMeta?.label || "this type"}. All optional.</p>

      {content}
    </>
  );
}

// ─── Type-specific field components ───
function EmployeeInjuryFields({ ts, updateTS, accent, appendixCUrl }) {
      return (
    <TypeBlock accent={accent} label="Employee Injury">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="pp-label">Person injured</label>
          <input className="pp-input" value={ts.person_injured || ""} onChange={(e) => updateTS("person_injured", e.target.value)} />
        </div>
        <div>
          <label className="pp-label">Title / role</label>
          <input className="pp-input" value={ts.title || ""} onChange={(e) => updateTS("title", e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">Body part</label>
          <input className="pp-input" value={ts.body_part || ""} onChange={(e) => updateTS("body_part", e.target.value)} placeholder="e.g., left index finger" />
        </div>
        <div>
<label className="pp-label">Type of injury</label>
          <select className="pp-select" value={ts.injury_type || ""} onChange={(e) => updateTS("injury_type", e.target.value)}>
            <option value="">Select...</option>
            {["Cut/laceration", "Burn", "Strain/sprain", "Contusion/bruise", "Heat illness", "Slip/fall", "Other"].map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>
      {ts.injury_type === "Other" && (
        <div style={{ marginTop: 12 }}>
          <label className="pp-label">Please specify <span style={{ color: "#dc2626" }}>*</span></label>
          <input
            className="pp-input"
            value={ts.injury_type_other || ""}
            onChange={(e) => updateTS("injury_type_other", e.target.value)}
            placeholder="Describe the injury type"
          />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">Required medical attention?</label>

          <YesNoToggle value={ts.medical || ""} onChange={(v) => updateTS("medical", v)} />
        </div>
        <div>
          <label className="pp-label">911 called?</label>
          <YesNoToggle value={ts.called_911 || ""} onChange={(v) => updateTS("called_911", v)} />
        </div>
      </div>
      {ts.medical === "Yes" && (
        <div style={{ marginTop: 12 }}>
          <label className="pp-label">Where was care received?</label>
          <input className="pp-input" value={ts.care_location || ""} onChange={(e) => updateTS("care_location", e.target.value)} placeholder="e.g., St. Louis Urgent Care" />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Expected to miss work?</label>
        <YesNoToggle value={ts.miss_work || ""} onChange={(v) => updateTS("miss_work", v)} />
      </div>
<div style={{ marginTop: 12 }}>
        <label className="pp-label">Did the employee refuse offered medical care?</label>
        <YesNoToggle value={ts.medical_treatment_refused || ""} onChange={(v) => updateTS("medical_treatment_refused", v)} />
        {ts.medical_treatment_refused === "Yes" && (
          <div style={{ marginTop: 6, fontSize: 11, color: "#92400e" }}>
            <strong>Required:</strong> Refusal of Medical Treatment form (Appendix C) must be signed by employee and manager.
            {/* W8 — direct link to printable form when manifest provides it */}
{/* P1 — Phase 2: link recolored from purple to amber so it sits in the
                same warning palette as the alert area, instead of clashing. */}
            {appendixCUrl && (
              <>
                {" "}
                <a
                  href={appendixCUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#92400e", fontWeight: 700, textDecoration: "underline" }}
                >
                  Open / print the form →
                </a>
              </>
            )}
                      </div>
        )}
      </div>
          </TypeBlock>
  );
}

function VehicleFields({ ts, updateTS, accent }) {
  return (
    <TypeBlock
      accent={accent}
      label="Vehicle"
      tip={<><strong>On scene:</strong> Get the police report number. Photograph all vehicles and plates. Do not admit fault. VPO is auto-cc'd on every vehicle incident regardless of severity.</>}
    >
      <div>
        <label className="pp-label">KitchFix vehicle?</label>
        <YesNoToggle value={ts.kf_vehicle || ""} onChange={(v) => updateTS("kf_vehicle", v)} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Other driver name + contact</label>
        <input className="pp-input" value={ts.other_driver || ""} onChange={(e) => updateTS("other_driver", e.target.value)} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Other vehicle make / model / plate</label>
        <input className="pp-input" value={ts.other_vehicle || ""} onChange={(e) => updateTS("other_vehicle", e.target.value)} placeholder="e.g., Honda CRV, IL ABC1234" />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Other insurance + policy</label>
        <input className="pp-input" value={ts.other_insurance || ""} onChange={(e) => updateTS("other_insurance", e.target.value)} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Damage description</label>
        <textarea className="pp-input" rows={2} value={ts.damage_description || ""} onChange={(e) => updateTS("damage_description", e.target.value)} style={{ minHeight: 60, resize: "vertical" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">Weather conditions</label>
          <input className="pp-input" value={ts.weather || ""} onChange={(e) => updateTS("weather", e.target.value)} />
        </div>
        <div>
          <label className="pp-label">Police called?</label>
          <YesNoToggle value={ts.police || ""} onChange={(v) => updateTS("police", v)} />
        </div>
      </div>
      {ts.police === "Yes" && (
        <div style={{ marginTop: 12 }}>
          <label className="pp-label">Police report number</label>
          <input className="pp-input" value={ts.police_report_number || ""} onChange={(e) => updateTS("police_report_number", e.target.value)} placeholder="If not yet issued, leave blank and update later" />
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Tickets issued?</label>
        <YesNoToggle value={ts.tickets || ""} onChange={(v) => updateTS("tickets", v)} />
      </div>
      {ts.tickets === "Yes" && (
        <div style={{ marginTop: 12 }}>
          <label className="pp-label">Ticket details</label>
          <input className="pp-input" value={ts.ticket_details || ""} onChange={(e) => updateTS("ticket_details", e.target.value)} />
        </div>
      )}
    </TypeBlock>
  );
}

function AllergenFields({ ts, updateTS, accent }) {
  return (
    <TypeBlock
      accent={accent}
      label="Allergen Reaction"
      tip={<><strong>Critical:</strong> Notify within 10 minutes — faster than the standard S1 15-minute window. Pull suspected item and utensils. Preserve food and packaging. Client communication runs through corporate, not the Site Leader.</>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="pp-label">Person affected</label>
          <select className="pp-select" value={ts.affected_person || ""} onChange={(e) => updateTS("affected_person", e.target.value)}>
            <option value="">Select...</option>
            {["Player", "Employee", "Guest", "Visitor"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="pp-label">Allergen identified</label>
          <select className="pp-select" value={ts.allergen || ""} onChange={(e) => updateTS("allergen", e.target.value)}>
            <option value="">Select...</option>
            {["Milk", "Eggs", "Fish", "Shellfish", "Tree nuts", "Peanuts", "Wheat", "Soy", "Sesame", "Unknown", "Other"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Product / dish involved</label>
        <input className="pp-input" value={ts.product || ""} onChange={(e) => updateTS("product", e.target.value)} placeholder="e.g., Cashew chicken at dinner service" />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Symptoms</label>
        <textarea className="pp-input" rows={2} value={ts.symptoms || ""} onChange={(e) => updateTS("symptoms", e.target.value)} style={{ minHeight: 60, resize: "vertical" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">911 called?</label>
          <YesNoToggle value={ts.called_911 || ""} onChange={(v) => updateTS("called_911", v)} />
        </div>
        <div>
          <label className="pp-label">EpiPen administered?</label>
          <YesNoToggle value={ts.epipen || ""} onChange={(v) => updateTS("epipen", v)} />
        </div>
      </div>
    </TypeBlock>
  );
}

function FoodborneFields({ ts, updateTS, accent }) {
  return (
    <TypeBlock
      accent={accent}
      label="Suspected Foodborne Illness"
      tip={<><strong>Always S1.</strong> Preserve all suspected food — label, date, refrigerate or freeze. Do not discard. Pull menu items from production until cleared. Health department contact is corporate-only.</>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="pp-label">Affected count (estimate)</label>
          <input className="pp-input" type="number" min="1" value={ts.affected_count || ""} onChange={(e) => updateTS("affected_count", e.target.value)} />
        </div>
        <div>
          <label className="pp-label">Onset time (after meal)</label>
          <input className="pp-input" value={ts.onset_time || ""} onChange={(e) => updateTS("onset_time", e.target.value)} placeholder="e.g., ~2 hr after dinner" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Symptoms reported</label>
        <textarea className="pp-input" rows={2} value={ts.symptoms || ""} onChange={(e) => updateTS("symptoms", e.target.value)} style={{ minHeight: 60, resize: "vertical" }} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Suspected meal / product</label>
        <input className="pp-input" value={ts.suspected_product || ""} onChange={(e) => updateTS("suspected_product", e.target.value)} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Other staff aware?</label>
        <YesNoToggle value={ts.staff_aware || ""} onChange={(v) => updateTS("staff_aware", v)} />
      </div>
    </TypeBlock>
  );
}

function FoodSafetyFields({ ts, updateTS, accent }) {
  return (
    <TypeBlock
      accent={accent}
      label="Food Safety Incident"
      tip={<><strong>On scene:</strong> Pull and segregate. Label "DO NOT USE." Photograph product, packaging, and lot codes before any disposal.</>}
    >
      <div style={{ background: "#fef3c7", border: "0.5px solid #fde68a", borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <label className="pp-label" style={{ marginTop: 0 }}>Was any of the affected food served to anyone?</label>
        <YesNoToggle value={ts.food_served || ""} onChange={(v) => updateTS("food_served", v)} />
        {ts.food_served === "Yes" && (
          <div style={{ marginTop: 6, fontSize: 11, color: "#92400e" }}>
            ⚠ <strong>Severity auto-set</strong> to S1. The incident becomes a foodborne illness watch.
          </div>
        )}
      </div>
      <div>
        <label className="pp-label">Product affected</label>
        <input className="pp-input" value={ts.product_affected || ""} onChange={(e) => updateTS("product_affected", e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">Hold / recall status</label>
          <select className="pp-select" value={ts.hold_status || ""} onChange={(e) => updateTS("hold_status", e.target.value)}>
            <option value="">Select...</option>
            {["Held", "Discarded", "Recalled", "No action needed"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="pp-label">Quantity affected</label>
          <input className="pp-input" value={ts.quantity || ""} onChange={(e) => updateTS("quantity", e.target.value)} placeholder="e.g., 4 pans, ~30 lb" />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Temperature / time excursion details</label>
        <textarea className="pp-input" rows={2} value={ts.excursion_details || ""} onChange={(e) => updateTS("excursion_details", e.target.value)} style={{ minHeight: 60, resize: "vertical" }} placeholder="e.g., Walk-in #2 found at 47°F at 9am, ~14 hr excursion" />
      </div>
    </TypeBlock>
  );
}

function PropertyDamageFields({ ts, updateTS, accent }) {
  return (
    <TypeBlock
      accent={accent}
      label="Property / Equipment Damage"
      tip={<><strong>Watch for:</strong> If safety-critical equipment (refrigeration, fire suppression, gas, vehicles) is damaged, tag out of service and notify HR regardless of dollar value. Do not attempt repair without authorization. Photograph from multiple angles.</>}
    >
      <div>
        <label className="pp-label">Equipment / property</label>
        <input className="pp-input" value={ts.equipment || ""} onChange={(e) => updateTS("equipment", e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">Estimated value ($)</label>
          <input className="pp-input" type="number" min="0" value={ts.estimated_value || ""} onChange={(e) => updateTS("estimated_value", e.target.value)} />
        </div>
        <div>
          <label className="pp-label">Operational impact</label>
          <select className="pp-select" value={ts.operational_impact || ""} onChange={(e) => updateTS("operational_impact", e.target.value)}>
            <option value="">Select...</option>
            {["None", "Service degraded", "Service stopped", "Site closed"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
    </TypeBlock>
  );
}

function NonEmployeeInjuryFields({ ts, updateTS, accent }) {
  return (
    <TypeBlock
      accent={accent}
      label="Non-Employee Injury"
      tip={<><strong>On scene:</strong> Render aid to level of training. Do not admit fault, speculate on cause, or offer compensation. All non-employee injuries are S2 minimum. Player injury OR offsite medical care = S1.</>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label className="pp-label">Affected person</label>
          <input className="pp-input" value={ts.affected_person_name || ""} onChange={(e) => updateTS("affected_person_name", e.target.value)} />
        </div>
        <div>
          <label className="pp-label">Relationship to KitchFix</label>
          <select className="pp-select" value={ts.relationship || ""} onChange={(e) => updateTS("relationship", e.target.value)}>
            <option value="">Select...</option>
            {["Player", "Guest", "Visitor", "Contractor", "Other"].map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Body part / injury type</label>
        <input className="pp-input" value={ts.injury_detail || ""} onChange={(e) => updateTS("injury_detail", e.target.value)} placeholder="e.g., right knee, sprain" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">Required medical attention?</label>
          <YesNoToggle value={ts.medical || ""} onChange={(v) => updateTS("medical", v)} />
        </div>
        <div>
          <label className="pp-label">911 called?</label>
          <YesNoToggle value={ts.called_911 || ""} onChange={(v) => updateTS("called_911", v)} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Did they receive offsite medical care?</label>
        <YesNoToggle value={ts.offsite_medical || ""} onChange={(v) => updateTS("offsite_medical", v)} />
      </div>
      {(ts.relationship === "Player" || ts.offsite_medical === "Yes") && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "#fee2e2", border: "0.5px solid #fecaca", borderRadius: 8, fontSize: 11, color: "#991b1b" }}>
          ⚠ <strong>Heads up:</strong> {ts.relationship === "Player" ? "Player injury" : "Offsite medical care"} should be classified <strong>S1</strong>. Go back to Step 2 to upgrade if it isn&apos;t already.
        </div>
      )}
    </TypeBlock>
  );
}

function NearMissFields({ ts, updateTS, accent }) {
  return (
    <TypeBlock accent={accent} label="Near-Miss / Hazard">
      <div>
        <label className="pp-label">What almost happened</label>
        <textarea className="pp-input" rows={2} value={ts.what_almost || ""} onChange={(e) => updateTS("what_almost", e.target.value)} style={{ minHeight: 60, resize: "vertical" }} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">What prevented harm</label>
        <textarea className="pp-input" rows={2} value={ts.what_prevented || ""} onChange={(e) => updateTS("what_prevented", e.target.value)} style={{ minHeight: 60, resize: "vertical" }} />
      </div>
      <div style={{ marginTop: 12 }}>
        <label className="pp-label">Hazard category</label>
        <select className="pp-select" value={ts.hazard_category || ""} onChange={(e) => updateTS("hazard_category", e.target.value)}>
          <option value="">Select...</option>
          {["Slip/trip", "Burn risk", "Cut risk", "Allergen risk", "Equipment failure", "Vehicle", "Security", "Other"].map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>
    </TypeBlock>
  );
}

function SecurityFields({ ts, updateTS, accent }) {
  return (
    <TypeBlock
      accent={accent}
      label="Security / Altercation"
      tip={<><strong>Personal safety first:</strong> Do not engage physically except in self-defense. Call 911 for any threat, weapon, or active assault. <strong>No social media. No discussion outside the operation.</strong></>}
    >
      <div>
        <label className="pp-label">Persons involved</label>
        <textarea className="pp-input" rows={2} value={ts.persons_involved || ""} onChange={(e) => updateTS("persons_involved", e.target.value)} style={{ minHeight: 60, resize: "vertical" }} placeholder="Names + roles if known" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div>
          <label className="pp-label">Police called?</label>
          <YesNoToggle value={ts.police || ""} onChange={(v) => updateTS("police", v)} />
        </div>
        <div>
          <label className="pp-label">Threat ongoing?</label>
          <YesNoToggle value={ts.threat_ongoing || ""} onChange={(v) => updateTS("threat_ongoing", v)} />
        </div>
      </div>
    </TypeBlock>
  );
}

// ═══════════════════════════════════════════════════════════════
// STEP 5 - REVIEW + ATTACH + SUBMIT
// ═══════════════════════════════════════════════════════════════
function Step5Review({ form, update, submitting, locations = [] }) {
  const t = INCIDENT_TYPES.find((x) => x.id === form.incident_type);
  const sev = SEVERITY_TIERS.find((x) => x.id === form.severity);
  // W7 — site lookup via bootstrap-supplied locations (Hub accounts tab)
  const site = locations.find((x) => x.key === form.site_code);
  const fileInputRef = useRef(null);

const handleFiles = async (e) => {
    const newFiles = Array.from(e.target.files || []);
    if (!newFiles.length) return;

    // Direction A: compress images via canvas, pass through PDFs/docs as-is.
    // allSettled lets us surface failures per-file without losing the rest.
    const results = await Promise.allSettled(newFiles.map(async (f) => {
      if (f.type.startsWith("image/")) {
        try {
          const compressed = await compressImage(f);
          console.log(
            `[Incident] compressed ${f.name}: ` +
            `${formatFileSize(f.size)} → ${formatFileSize(compressed.size)} ` +
            `(${Math.round((1 - compressed.size / f.size) * 100)}% smaller)`
          );
          return compressed;
        } catch (err) {
          console.warn(`[Incident] image compression failed for ${f.name}, using raw:`, err.message);
          // Fall back to raw — server-side will fail if it's truly oversized,
          // but smaller HEIC/odd formats may still squeak through.
          return await readFileAsBase64(f);
        }
      }
      return await readFileAsBase64(f);
    }));

    const successful = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    const failed = results.filter((r) => r.status === "rejected");

    if (failed.length) {
      const names = failed.map((r) => r.reason?.message || "Unknown error").join("\n");
      alert(`Some files couldn't be processed:\n${names}\n\nThe rest were added.`);
    }

    if (successful.length) {
      update("attachments", [...(form.attachments || []), ...successful]);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  
  const removeFile = (idx) => {
    update("attachments", form.attachments.filter((_, i) => i !== idx));
  };

const rawTsEntries = Object.entries(form.type_specific_data || {}).filter(([, v]) => v);

  // P1 — Phase 2: merge "injury_type" + "injury_type_other" into a single row
  // so the review screen reads "Type of Injury — Other (Stubbed toe)" instead
  // of two adjacent rows where one has the database column name as a label.
  const tsEntries = (() => {
    const map = Object.fromEntries(rawTsEntries);
    const merged = [];
    const seen = new Set();
    for (const [k, v] of rawTsEntries) {
      if (seen.has(k)) continue;
      if (k === "injury_type" && map["injury_type_other"]) {
        merged.push(["injury_type", `${v} — ${map["injury_type_other"]}`]);
        seen.add("injury_type");
        seen.add("injury_type_other");
        continue;
      }
      if (k === "injury_type_other" && map["injury_type"]) {
        // already folded into the injury_type row above; skip
        seen.add(k);
        continue;
      }
      merged.push([k, v]);
      seen.add(k);
    }
    return merged;
  })();

  return (
    <>
      <h3 className="pp-card-title" style={{ marginBottom: 4 }}>Review and submit</h3>
      <p className="pp-inc-step-help">Verify everything below, attach any photos, then submit.</p>

      {/* P4B Direction 1: receipt-style single card.
          Was: 5 separate ReviewBlock cards stacked, each with own border.
          Now: one card with internal section dividers — feels like a printed
          incident report receipt instead of a form-with-form-with-form. */}
      <div style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "16px 18px",
        marginBottom: 10,
      }}>

        {/* SECTION 1 — Type & Severity (no divider above; this is the top) */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 14 }}>
          <div className="pp-inc-typeicon" style={{ background: t?.color, width: 36, height: 36, marginBottom: 0, flexShrink: 0 }}>
            {ICONS[t?.id]}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#153968", marginBottom: 2 }}>
              {t?.label || "—"}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="pp-inc-tier-code" style={{ background: sev?.color, fontSize: 11, padding: "3px 8px", minWidth: "auto" }}>
                {sev?.id || "—"}
              </span>
              <span>{sev?.label || ""}</span>
              {sev?.deadline && (
                <span style={{ color: sev?.color || "#64748b", fontWeight: 600 }}>· {sev.deadline}</span>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 2 — When & Where */}
        <ReceiptDivider label="When & where" />
        <ReceiptRow l="Site" v={site ? `${site.key} — ${site.name}` : form.site_code || "—"} />
        <ReceiptRow l="Date" v={form.incident_date || "—"} />
        <ReceiptRow l="Time" v={form.incident_time || "—"} />
        <ReceiptRow l="Location" v={form.location_detail || "—"} />
        <ReceiptRow l="Manager aware" v={form.manager_aware_date || "—"} />

        {/* SECTION 3 — Narrative (what happened + immediate actions + witnesses) */}
        <ReceiptDivider label="Narrative" />
        <div style={{ marginBottom: form.immediate_actions_taken || form.witnesses ? 10 : 0 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>What happened</div>
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "#334155", whiteSpace: "pre-wrap" }}>
            {form.what_happened || <span style={{ color: "#cbd5e1" }}>No description</span>}
          </div>
        </div>
        {form.immediate_actions_taken && (
          <div style={{ marginBottom: form.witnesses ? 10 : 0 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>Immediate actions</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "#334155", whiteSpace: "pre-wrap" }}>
              {form.immediate_actions_taken}
            </div>
          </div>
        )}
        {form.witnesses && (
          <div>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, fontWeight: 600 }}>Witnesses</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "#334155", whiteSpace: "pre-wrap" }}>
              {form.witnesses}
            </div>
          </div>
        )}

        {/* SECTION 4 — Type-specific details (only if any) */}
        {tsEntries.length > 0 && (
          <>
            <ReceiptDivider label="Type-specific details" />
            {tsEntries.map(([k, v]) => <ReceiptRow key={k} l={prettify(k)} v={String(v)} />)}
          </>
        )}

        {/* SECTION 5 — Photos & documents */}
        <ReceiptDivider label="Photos & documents" />
        {(form.attachments || []).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
            {form.attachments.map((a, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#f8fafc", borderRadius: 6, padding: "6px 10px", fontSize: 12,
              }}>
                <span style={{ fontSize: 14 }}>📎</span>
                <span style={{ flex: 1, color: "#334155" }}>{a.name}</span>
                <span style={{ color: "#94a3b8", fontSize: 11 }}>{formatFileSize(a.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  style={{ border: "none", background: "none", color: "#94a3b8", cursor: "pointer", fontSize: 11 }}
                  disabled={submitting}
                >
                  Remove
                </button>
              </div>
            ))}
            {(() => {
              // Total size meter — amber warning at 75%, red block at 100%
              const totalB64 = form.attachments.reduce((s, a) => s + (a.base64?.length || 0), 0);
              const totalBytes = Math.round(totalB64 * 0.75);
              const PAYLOAD_LIMIT = 3.5 * 1024 * 1024;
              const pctB64 = totalB64 / PAYLOAD_LIMIT;
              const isWarn = pctB64 > 0.75;
              const isOver = pctB64 > 1;
              const color = isOver ? "#dc2626" : isWarn ? "#92400e" : "#94a3b8";
              const count = form.attachments.length;
              const label = count === 1 ? "1 file" : `${count} files`;
              return (
                <div style={{
                  fontSize: 11, color, marginTop: 2, paddingLeft: 4,
                  fontWeight: isWarn ? 600 : 500,
                }}>
                  {/* P4B: attachment count visibility — "2 files · 248 KB total" */}
                  {label} · {formatFileSize(totalBytes)} total
                  {isOver && " — too large to submit, remove a file"}
                  {!isOver && isWarn && " — approaching upload limit"}
                </div>
              );
            })()}
          </div>
        )}
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: "#fafafa", border: "1.5px dashed #cbd5e1", borderRadius: 10,
            padding: 14, textAlign: "center", cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 18, marginBottom: 4 }}>📎</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#475569" }}>Tap or drop files</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Photos · PDFs · Documents · Multiple files OK</div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx"
          onChange={handleFiles}
          style={{ display: "none" }}
        />
      </div>

      {/* P4B disclaimer footer — small print, builds operational accountability.
          Not a callout box; reads as the standard "by submitting, you confirm" footer
          that any printed compliance form would have. */}
      <div style={{
        fontSize: 11, color: "#94a3b8", lineHeight: 1.5, padding: "0 4px",
        textAlign: "center", marginBottom: 4,
      }}>
        By submitting, I confirm this report is accurate to the best of my knowledge. Mariela will follow up if more information is needed.
      </div>
    </>
  );
}

// P4B Direction 1: receipt-style row helpers used by Step 5 review card.
// Internal to this module — kept here to colocate with the only consumer.
function ReceiptDivider({ label }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      margin: "14px 0 10px",
      fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
      textTransform: "uppercase", color: "#64748b",
    }}>
      <span>{label}</span>
      <span style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
    </div>
  );
}

function ReceiptRow({ l, v }) {
  return (
    <div style={{ display: "flex", padding: "3px 0", fontSize: 12 }}>
      <div style={{ color: "#64748b", width: 130, flexShrink: 0 }}>{l}</div>
      <div style={{ color: "#153968", flex: 1, fontWeight: 500 }}>{v}</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────
function TypeBlock({ accent, label, tip, children }) {
  return (
    <div style={{
      background: "white", border: "0.5px solid #e2e8f0",
      borderLeft: `3px solid ${accent || "#7c3aed"}`,
      borderRadius: 10, padding: 14,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 500, letterSpacing: "0.06em",
        textTransform: "uppercase", color: accent || "#7c3aed",
        marginBottom: 10,
      }}>
        {label} — additional fields
      </div>
      {tip && (
        <div className="pp-inc-typetip" style={{ borderLeftColor: accent || "#7c3aed" }}>
          {tip}
        </div>
      )}
      {children}
    </div>
  );
}

function ReviewBlock({ title, children }) {
  return (
    <div style={{
      background: "white", border: "0.5px solid #e2e8f0", borderRadius: 10,
      padding: "12px 14px", marginBottom: 10,
    }}>
      <h4 style={{
        fontSize: 11, fontWeight: 500, letterSpacing: "0.06em",
        textTransform: "uppercase", color: "#94a3b8",
        margin: "0 0 8px",
      }}>{title}</h4>
      {children}
    </div>
  );
}

function ReviewRow({ l, v }) {
  return (
    <div style={{ display: "flex", padding: "3px 0", fontSize: 12 }}>
      <div style={{ color: "#64748b", width: 130, flexShrink: 0 }}>{l}</div>
      <div style={{ color: "#153968", flex: 1 }}>{v}</div>
    </div>
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ═══════════════════════════════════════════════════════════════
// FILE PROCESSING — Direction A from the design review
// Mirrors InvoiceTool.js compression pattern (canvas downscale + JPEG re-encode)
// to keep payloads under Vercel's 4.5MB serverless body limit.
// Without this, a single iPhone photo (4–11 MB base64) blows the limit and
// the whole submission is rejected with 413 before the route handler runs.
// ═══════════════════════════════════════════════════════════════
const IMG_MAX_WIDTH = 1280;     // most evidence reads fine at 1280px wide
const IMG_JPEG_QUALITY = 0.85;  // matches invoice flow; ~250–500 KB per photo

// Compress images via canvas → JPEG. Throws if the browser can't decode
// (HEIC on Chrome desktop, corrupt files); caller falls back to raw.
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const scale = img.width > IMG_MAX_WIDTH ? IMG_MAX_WIDTH / img.width : 1;
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", IMG_JPEG_QUALITY);
          const base64 = dataUrl.split(",")[1];
          resolve({
            // Force .jpg extension since we re-encoded to JPEG
            name: file.name.replace(/\.[^.]+$/, ".jpg"),
            mimeType: "image/jpeg",
            size: Math.round(base64.length * 0.75), // approx decoded byte size
            base64,
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error(`Could not decode ${file.name}`));
      img.src = reader.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Pass-through for PDFs and documents — no compression, just base64 encode.
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      resolve({
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        base64,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function prettify(k) {
  return k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

// P0 — Phase 1: rewritten to handle:
//   • production codes (slack-channel, email-s1-6rcpts, email-s3-4rcpts, etc.)
//   • test-mode codes (slack-test, email-test, slack-status-test, etc.)
//   • status-change codes (slack-status, email-status-submitter)
//   • unknown codes → returns null so caller filters them out instead of
//     leaking raw debug strings like "slack-test" / "email-test" to the user.
function formatNotification(code) {
  if (!code) return null;

  // Slack channel posts
  if (code === "slack-channel") return "Posted to incident channel";
  if (code === "slack-test")    return "Posted to test channel";
  if (code === "slack-status")  return "Status update posted to channel";
  if (code === "slack-status-test") return "Status update posted to test channel";

  // Test-mode email
  if (code === "email-test") return "Test email sent";
  if (code === "email-status-test") return "Test status email sent";
  if (code === "email-status-submitter") return "Submitter notified by email";

  // Production email — patterns like "email-s1-6rcpts" / "email-s3-4rcpts"
  const m = code.match(/^email-(s[1-4])-(\d+)rcpts?$/i);
  if (m) {
    const sev = m[1].toUpperCase();
    const count = m[2];
    return `Email sent to ${count} recipient${count === "1" ? "" : "s"} (${sev} distribution)`;
  }

  // Legacy / explicit production codes (kept for backward compatibility)
  if (code === "email-mariela-s1") return "🚨 Email sent to Mariela (S1 — urgent)";
  if (code === "email-mariela-s2") return "Email sent to Mariela";
  if (code === "email-mariela-corp-s3") return "Email sent to Mariela + corporate";

  // Unknown code — don't leak the raw string to the user
  return null;
}
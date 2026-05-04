"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Stepper, YesNoToggle } from "./shared";
import {
  INCIDENT_TYPES,
  SEVERITY_TIERS,
  SITES,
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
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        // attachments are already base64 in form state
        submitterEmail: bootstrapData?.userEmail || "",
        submitterName: bootstrapData?.firstName || "",
      };

      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit-incident", form: payload }),
      });
      const data = await res.json();

      if (data.success) {
        setSuccess({
          incidentId: data.incident_id,
          driveFolderUrl: data.drive_folder_url,
          notificationsSent: data.notifications_sent,
          severity: form.severity,
          incidentType: form.incident_type,
          medicalTreatmentRefused: form.type_specific_data?.medical_treatment_refused === "Yes",
        });
        if (refreshHistory) refreshHistory();
        if (showToast) showToast("✅ Incident submitted");
      } else {
        if (showToast) showToast(`⚠️ ${data.error || "Submission failed"}`, "error");
      }
    } catch (err) {
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
  if (success) {
    return (
      <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
        <div className="pp-card pp-card--form" style={{ textAlign: "center", padding: "32px 24px" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%", background: "#d1fae5", color: "#059669",
            display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h2 className="pp-card-title" style={{ marginBottom: 6 }}>Incident submitted</h2>
          <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 14px" }}>Your incident has been recorded.</p>
          <div style={{
            display: "inline-block", fontFamily: "ui-monospace, monospace", fontSize: 14, fontWeight: 500,
            background: "#f3e8ff", color: "#7c3aed", padding: "6px 14px", borderRadius: 6, marginBottom: 16,
          }}>{success.incidentId}</div>

          <div style={{ textAlign: "left", maxWidth: 360, margin: "0 auto 20px", fontSize: 13, lineHeight: 1.7, color: "#475569" }}>
            {success.notificationsSent && success.notificationsSent.split("|").filter(Boolean).map((n, i) => (
              <div key={i}>
                <span style={{ color: "#10b981", fontWeight: 500, marginRight: 6 }}>✓</span>
                {formatNotification(n)}
              </div>
            ))}
            {success.driveFolderUrl && (
              <div style={{ marginTop: 12 }}>
                <a href={success.driveFolderUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#7c3aed", textDecoration: "none", fontWeight: 500 }}>
                  📂 Open Drive folder ↗
                </a>
              </div>
            )}
          </div>

          {/* SOP §06 - S1 phone call is non-delegable */}
          {success.severity === "S1" && (
            <div className="pp-inc-callout pp-inc-callout--critical" style={{ maxWidth: 420, margin: "0 auto 16px" }}>
              <div className="pp-inc-callout-head">📞 Call Mariela now</div>
              <div className="pp-inc-callout-phone">
                <a href="tel:+13125481420">(312) 548-1420</a>
              </div>
              <div className="pp-inc-callout-body">
                S1 requires a phone call within 15 minutes — the form does not replace the call. Voicemail counts only with a callback number AND a Slack message.
              </div>
            </div>
          )}

          {/* SOP §7.1 - Refusal of Medical Treatment Form (Appendix C) */}
          {success.incidentType === "employee_injury" && success.medicalTreatmentRefused && (
            <div className="pp-inc-callout pp-inc-callout--warn" style={{ maxWidth: 420, margin: "0 auto 16px" }}>
              <div className="pp-inc-callout-head">📝 Appendix C required</div>
              <div className="pp-inc-callout-body">
                Complete the <strong>Refusal of Medical Treatment</strong> form. Both employee and manager must sign. Send signed copy to Mariela.
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="pp-btn pp-btn--ghost" onClick={() => { resetForm(); onNavigate("dashboard"); }}>
              Back to Home
            </button>
            <button className="pp-btn pp-btn--primary" onClick={resetForm}>
              Submit another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Wizard view ───
  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-card pp-card--form">
        <Stepper step={step} totalSteps={TOTAL_STEPS} />

        <div className="pp-form-content">
          {step === 1 && <Step1Type form={form} update={update} errors={errors} />}
          {step === 2 && <Step2Severity form={form} update={update} errors={errors} allowedSeverities={allowedSeverities} severityLocked={severityLocked} />}
          {step === 3 && <Step3Basics form={form} update={update} errors={errors} />}
          {step === 4 && <Step4TypeSpecific form={form} updateTS={updateTS} />}
          {step === 5 && <Step5Review form={form} update={update} submitting={submitting} />}
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STEP 1 - TYPE PICKER
// ═══════════════════════════════════════════════════════════════
function Step1Type({ form, update, errors }) {
  return (
    <>

      <h3 className="pp-card-title" style={{ marginBottom: 4 }}>What kind of incident?</h3>
      <p className="pp-inc-step-help">Pick the type that best fits. If unsure between two, pick the more serious one.</p>

      <div className="pp-inc-typegrid">
        {INCIDENT_TYPES.map((t) => (
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

      {/* SOP §06 Critical - S1 phone call non-delegable */}
      {form.severity === "S1" && (
        <div className="pp-inc-callout pp-inc-callout--critical" style={{ marginTop: 12 }}>
          <div className="pp-inc-callout-head">📞 S1 requires a phone call — the form is not enough</div>
          <div className="pp-inc-callout-body">
            Within 15 minutes, the Site Leader or Manager of Record personally calls Mariela at <a href="tel:+13125481420">(312) 548-1420</a>. Voicemail counts only with a callback number AND a Slack message.
          </div>
        </div>
      )}

      {errors.severity && <div className="pp-inc-step-error">Please pick a severity tier</div>}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
// STEP 3 - THE BASICS (combined site/date/time/location/aware/description/witnesses)
// ═══════════════════════════════════════════════════════════════
function Step3Basics({ form, update, errors }) {
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
        {SITES.map((s) => (
          <option key={s.code} value={s.code}>{s.code} — {s.label}</option>
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
function Step4TypeSpecific({ form, updateTS }) {
  const typeMeta = INCIDENT_TYPES.find((t) => t.id === form.incident_type);

  let content;
  if (form.incident_type === "employee_injury") {
    content = <EmployeeInjuryFields ts={form.type_specific_data} updateTS={updateTS} accent={typeMeta?.color} />;
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
function EmployeeInjuryFields({ ts, updateTS, accent }) {
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
function Step5Review({ form, update, submitting }) {
  const t = INCIDENT_TYPES.find((x) => x.id === form.incident_type);
  const sev = SEVERITY_TIERS.find((x) => x.id === form.severity);
  const site = SITES.find((x) => x.code === form.site_code);
  const fileInputRef = useRef(null);

  const handleFiles = async (e) => {
    const newFiles = Array.from(e.target.files || []);
    const processed = await Promise.all(newFiles.map(async (f) => {
      const buf = await f.arrayBuffer();
      const base64 = Buffer.from(buf).toString("base64");
      return {
        name: f.name,
        mimeType: f.type || "application/octet-stream",
        size: f.size,
        base64,
      };
    }));
    update("attachments", [...(form.attachments || []), ...processed]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx) => {
    update("attachments", form.attachments.filter((_, i) => i !== idx));
  };

  const tsEntries = Object.entries(form.type_specific_data || {}).filter(([, v]) => v);

  return (
    <>

      <h3 className="pp-card-title" style={{ marginBottom: 4 }}>Review and submit</h3>
      <p className="pp-inc-step-help">Verify everything below, attach any photos, then submit.</p>

      <ReviewBlock title="Type & Severity">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div className="pp-inc-typeicon" style={{ background: t?.color, width: 32, height: 32, marginBottom: 0 }}>
            {ICONS[t?.id]}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{t?.label || "—"}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              <span className="pp-inc-tier-code" style={{ background: sev?.color, marginRight: 6 }}>{sev?.id || "—"}</span>
              {sev?.label || ""} <span style={{ color: sev?.color || "#64748b" }}>· {sev?.deadline || ""}</span>
            </div>
          </div>
        </div>
      </ReviewBlock>

      <ReviewBlock title="When & Where">
        <ReviewRow l="Site" v={site ? `${site.code} — ${site.label}` : form.site_code || "—"} />
        <ReviewRow l="Date" v={form.incident_date || "—"} />
        <ReviewRow l="Time" v={form.incident_time || "—"} />
        <ReviewRow l="Location" v={form.location_detail || "—"} />
        <ReviewRow l="Manager aware" v={form.manager_aware_date || "—"} />
      </ReviewBlock>

      <ReviewBlock title="What happened">
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "#334155", padding: "4px 0", whiteSpace: "pre-wrap" }}>
          {form.what_happened || <span style={{ color: "#94a3b8" }}>No description</span>}
        </div>
        {form.immediate_actions_taken && (
          <>
            <div style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "#94a3b8", marginTop: 10, marginBottom: 4 }}>Immediate actions</div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "#334155", padding: "4px 0", whiteSpace: "pre-wrap" }}>
              {form.immediate_actions_taken}
            </div>
          </>
        )}
        {form.witnesses && <ReviewRow l="Witnesses" v={form.witnesses} />}
      </ReviewBlock>

      {tsEntries.length > 0 && (
        <ReviewBlock title="Type-specific details">
          {tsEntries.map(([k, v]) => <ReviewRow key={k} l={prettify(k)} v={String(v)} />)}
        </ReviewBlock>
      )}

      <ReviewBlock title="Photos and documents">
        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: "white", border: "1.5px dashed #cbd5e1", borderRadius: 10,
            padding: 14, textAlign: "center", cursor: "pointer", marginBottom: 8,
          }}
        >
          <div style={{ fontSize: 18, marginBottom: 4 }}>📎</div>
          <div style={{ fontSize: 12, fontWeight: 500 }}>Click to add files</div>
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
        {(form.attachments || []).length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {form.attachments.map((a, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#f8fafc", borderRadius: 6, padding: "6px 10px", fontSize: 11,
              }}>
                <span style={{ fontSize: 14 }}>📎</span>
                <span style={{ flex: 1 }}>{a.name}</span>
                <span style={{ color: "#94a3b8", fontSize: 10 }}>{formatFileSize(a.size)}</span>
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
          </div>
        )}
      </ReviewBlock>
    </>
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
      <div style={{ color: "#0f3057", flex: 1 }}>{v}</div>
    </div>
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function prettify(k) {
  return k.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatNotification(code) {
  const map = {
    "slack-channel": "Posted to #opshub-incident-submissions",
    "email-mariela-s1": "🚨 Email sent to Mariela (S1 - urgent)",
    "email-mariela-s2": "Email sent to Mariela",
    "email-mariela-corp-s3": "Email sent to Mariela + corporate",
  };
  return map[code] || code;
}
"use client";
import { useState, useEffect, useCallback, useRef } from "react";

function getLocalISODate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
}

function getDefaults() {
  return {
    effectiveDate: getLocalISODate(), locationKey: "", locationName: "", employeeName: "",
    actionType: "", actionGroup: "Voluntary", separationReason: "", rehireEligible: "Yes",
    statusChangeDirection: "Part-Time to Full-Time",
    reclassFrom: "", reclassTo: "", reclassChangeRate: "No",
    oldTitle: "", newTitle: "", oldRate: "", newRate: "", amount: "",
    cellFrequency: "Monthly",
    travelStartDate: "", travelEndDate: "", travelTotalDays: 0,
    travelSupplementEnabled: "No", travelSupplementTotal: 0,
    perDiemTotal: 0, travelGrandTotal: 0,
    explanation: "", uploadData: null, uploadFileName: "",
  };
}

function Stepper({ step }) {
  return (
    <div className="pp-stepper">
      {[1, 2, 3].map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center" }}>
          <div className={`pp-step${s < step ? " pp-step--done" : s === step ? " pp-step--active" : ""}`}>
            {s < step ? "✓" : s}
          </div>
          {i < 2 && <div className="pp-step-line" />}
        </div>
      ))}
    </div>
  );
}

// Dynamic detail fields based on action type
function ActionDetails({ form, update, errors, Formatter }) {
  const type = form.actionType;

  if (type === "separation") {
    return (
      <>
        <label className="pp-label">Separation Type</label>
        <div className="pp-pill-group">
          <div className={`pp-pill-option${form.actionGroup === "Voluntary" ? " pp-pill-option--active" : ""}`} onClick={() => update("actionGroup", "Voluntary")}>Voluntary</div>
          <div className={`pp-pill-option${form.actionGroup === "Involuntary" ? " pp-pill-option--active" : ""}`} onClick={() => update("actionGroup", "Involuntary")}>Involuntary</div>
        </div>
        <label className="pp-label">Reason for Separation</label>
        <textarea className="pp-textarea" value={form.separationReason} onChange={(e) => update("separationReason", e.target.value)} placeholder="Brief reason..." />
        <label className="pp-label">Eligible for Rehire?</label>
        <div className="pp-pill-group">
          <div className={`pp-pill-option${form.rehireEligible === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("rehireEligible", "Yes")}>Yes</div>
          <div className={`pp-pill-option${form.rehireEligible === "No" ? " pp-pill-option--active" : ""}`} onClick={() => update("rehireEligible", "No")}>No</div>
        </div>
      </>
    );
  }

  if (type === "rate_change") {
    return (
      <>
        <label className="pp-label">Current Rate ($)</label>
        <input className="pp-input" type="number" value={form.oldRate} onChange={(e) => update("oldRate", e.target.value)} placeholder="0.00" />
        <label className="pp-label">New Rate ($)</label>
        <input className={`pp-input${errors.newRate ? " pp-input-error" : ""}`} type="number" value={form.newRate} onChange={(e) => update("newRate", e.target.value)} placeholder="0.00" />
      </>
    );
  }

  if (type === "title_change") {
    return (
      <>
        <label className="pp-label">Current Title</label>
        <input className="pp-input" value={form.oldTitle} onChange={(e) => update("oldTitle", e.target.value)} placeholder="e.g. Prep Cook" />
        <label className="pp-label">New Title</label>
        <input className={`pp-input${errors.newTitle ? " pp-input-error" : ""}`} value={form.newTitle} onChange={(e) => update("newTitle", e.target.value)} placeholder="e.g. Line Cook" />
        <label className="pp-label">Does this also change rate of pay?</label>
        <div className="pp-pill-group">
          <div className={`pp-pill-option${form.reclassChangeRate !== "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassChangeRate", "No")}>No</div>
          <div className={`pp-pill-option${form.reclassChangeRate === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassChangeRate", "Yes")}>Yes</div>
        </div>
        {form.reclassChangeRate === "Yes" && (
          <>
            <label className="pp-label">New Rate ($)</label>
            <input className="pp-input" type="number" value={form.newRate} onChange={(e) => update("newRate", e.target.value)} placeholder="0.00" />
          </>
        )}
      </>
    );
  }

  if (type === "status_change") {
    return (
      <>
        <label className="pp-label">Direction of Change</label>
        <div className="pp-pill-group pp-pill-group--stack">
          {["Part-Time to Full-Time", "Full-Time to Part-Time"].map((dir) => (
            <div key={dir} className={`pp-pill-option${form.statusChangeDirection === dir ? " pp-pill-option--active" : ""}`} onClick={() => update("statusChangeDirection", dir)}>{dir}</div>
          ))}
        </div>
      </>
    );
  }

  if (type === "reclassification") {
    return (
      <>
        <label className="pp-label">From Department</label>
        <input className="pp-input" value={form.reclassFrom} onChange={(e) => update("reclassFrom", e.target.value)} placeholder="e.g. Kitchen" />
        <label className="pp-label">To Department</label>
        <input className="pp-input" value={form.reclassTo} onChange={(e) => update("reclassTo", e.target.value)} placeholder="e.g. Catering" />
        <label className="pp-label">Does this also change rate of pay?</label>
        <div className="pp-pill-group">
          <div className={`pp-pill-option${form.reclassChangeRate !== "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassChangeRate", "No")}>No</div>
          <div className={`pp-pill-option${form.reclassChangeRate === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassChangeRate", "Yes")}>Yes</div>
        </div>
        {form.reclassChangeRate === "Yes" && (
          <>
            <label className="pp-label">New Rate ($)</label>
            <input className="pp-input" type="number" value={form.newRate} onChange={(e) => update("newRate", e.target.value)} placeholder="0.00" />
          </>
        )}
      </>
    );
  }

  if (type === "add_cell_phone") {
    return (
      <>
        <label className="pp-label">Frequency</label>
        <div className="pp-pill-group">
          {["Monthly", "Bi-Weekly"].map((f) => (
            <div key={f} className={`pp-pill-option${form.cellFrequency === f ? " pp-pill-option--active" : ""}`} onClick={() => update("cellFrequency", f)}>{f}</div>
          ))}
        </div>
      </>
    );
  }

  if (type === "travel_reimbursement") {
    return (
      <>
        <label className="pp-label">Travel Start Date</label>
        <input className="pp-input" type="date" value={form.travelStartDate} onChange={(e) => update("travelStartDate", e.target.value)} />
        <label className="pp-label">Travel End Date</label>
        <input className="pp-input" type="date" value={form.travelEndDate} onChange={(e) => update("travelEndDate", e.target.value)} />
        <div className="pp-hours-box" style={{ marginTop: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
          <div className="pp-hours-text">
            <strong>Per Diem & Travel Supplement</strong>
            <p>The exact per diem and supplement amounts will be calculated by People Ops based on your travel dates and meal coverage.</p>
          </div>
        </div>
      </>
    );
  }

  // Bonus, deduction, gratuity, other reimbursement
  if (["add_bonus", "add_deduction", "add_gratuity", "other_reimbursement"].includes(type)) {
    return (
      <>
        <label className="pp-label">Amount ($)</label>
        <input className={`pp-input${errors.amount ? " pp-input-error" : ""}`} type="number" value={form.amount} onChange={(e) => update("amount", e.target.value)} placeholder="0.00" />
      </>
    );
  }

  return null;
}

export default function PAFForm({ bootstrapData, Drafts, Formatter, onNavigate, showToast, openConfirm, refreshHistory }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(getDefaults);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const draft = Drafts.load("paf");
    if (draft) setForm((prev) => ({ ...prev, ...draft }));
  }, [Drafts]);

  useEffect(() => { Drafts.save("paf", form); }, [form, Drafts]);

  const update = useCallback((key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }));
    setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  const validate = () => {
    const errs = {};
    if (step === 1) {
      if (!form.locationKey) errs.locationKey = true;
      if (!form.employeeName) errs.employeeName = true;
    } else if (step === 2) {
      if (!form.actionType) errs.actionType = true;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (!validate()) return;
    if (step < 3) setStep(step + 1);
    else setShowReview(true);
  };

  const handleBack = () => {
    if (step === 1) onNavigate("dashboard");
    else setStep(step - 1);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit-paf", form: { ...form, submitterEmail: bootstrapData.userEmail } }),
      });
      const data = await res.json();
      if (data.success) {
        setShowReview(false);
        setSuccess(true);
        Drafts.clear("paf");
        refreshHistory();
      } else {
        showToast("Submission Failed: " + data.message, "error");
        setSubmitting(false);
      }
    } catch (e) {
      showToast("Network Error: " + e.message, "error");
      setSubmitting(false);
    }
  };

  const resetForm = (stayOnForm) => {
    setForm(getDefaults());
    setStep(1);
    setSuccess(false);
    setSubmitting(false);
    if (!stayOnForm) onNavigate("dashboard");
  };

  const locations = bootstrapData?.locations || [];
  const actionTypes = bootstrapData?.pafConfig?.actionTypes || [];
  const groups = {};
  actionTypes.forEach((a) => { if (!groups[a.category]) groups[a.category] = []; groups[a.category].push(a); });
  const actionLabel = actionTypes.find((a) => a.key === form.actionType)?.label || form.actionType;

  if (success) {
    return (
      <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
        <div className="pp-card pp-card--form">
          <div className="pp-success-view">
            <div className="pp-success-circle"><div className="pp-success-icon">✅</div></div>
            <h2 className="pp-card-title">Request Submitted!</h2>
            <p className="pp-card-desc">Your {actionLabel} request for {form.employeeName} is now being processed.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24, width: "100%", maxWidth: 280, margin: "24px auto 0" }}>
              <button className="pp-btn pp-btn--primary" onClick={() => resetForm(true)}>Submit Another</button>
              <button className="pp-btn pp-btn--ghost" onClick={() => resetForm(false)}>Back to Home</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-card pp-card--form">
        <Stepper step={step} />

        <div className="pp-form-content">
          {/* STEP 1: Employee Context */}
          {step === 1 && (
            <>
              <h3 className="pp-card-title">Employee Context</h3>
              <label className="pp-label">Location</label>
              <select className={`pp-select${errors.locationKey ? " pp-input-error" : ""}`} value={form.locationKey} onChange={(e) => update("locationKey", e.target.value)}>
                <option value="">Select...</option>
                {locations.map((l) => (
                  <option key={l.key} value={`${l.key} - ${l.name}`}>{l.key} - {l.name}</option>
                ))}
              </select>
              <label className="pp-label">Employee Name</label>
              <input className={`pp-input${errors.employeeName ? " pp-input-error" : ""}`} value={form.employeeName} onChange={(e) => update("employeeName", e.target.value)} placeholder="e.g. Michael Jordan" />
              <label className="pp-label">Effective Date</label>
              <input className="pp-input" type="date" value={form.effectiveDate} onChange={(e) => update("effectiveDate", e.target.value)} />
            </>
          )}

          {/* STEP 2: Action Type */}
          {step === 2 && (
            <>
              <h3 className="pp-card-title">What needs to happen?</h3>
              <label className="pp-label">Action Type</label>
              <select className={`pp-select${errors.actionType ? " pp-input-error" : ""}`} value={form.actionType} onChange={(e) => update("actionType", e.target.value)}>
                <option value="">Select an action...</option>
                {["HR Actions", "Payroll", "Expenses"].map((cat) => groups[cat] && (
                  <optgroup key={cat} label={cat}>
                    {groups[cat].map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </>
          )}

          {/* STEP 3: Dynamic Details */}
          {step === 3 && (
            <>
              <h3 className="pp-card-title">{actionLabel}</h3>
              <ActionDetails form={form} update={update} errors={errors} Formatter={Formatter} />
              <label className="pp-label" style={{ marginTop: 24 }}>Notes / Explanation</label>
              <textarea className="pp-textarea" value={form.explanation} onChange={(e) => update("explanation", e.target.value)} placeholder="Any additional context..." />

              {/* File Upload */}
              <label className="pp-label">Attach Receipt (optional)</label>
              {form.uploadFileName ? (
                <div className="pp-upload-preview">
                  <span>📎 {form.uploadFileName}</span>
                  <button className="pp-btn-discard" onClick={() => { update("uploadData", null); update("uploadFileName", ""); }}>Remove</button>
                </div>
              ) : (
                <input type="file" accept="image/*" className="pp-input" onChange={(e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) { showToast("File too large. Max 5MB.", "error"); return; }
                  const reader = new FileReader();
                  reader.onload = (ev) => { update("uploadData", ev.target.result); update("uploadFileName", file.name); };
                  reader.readAsDataURL(file);
                }} />
              )}
            </>
          )}
        </div>

        <div className="pp-form-footer">
          <button className="pp-btn pp-btn--ghost" onClick={handleBack}>Back</button>
          <button className="pp-btn pp-btn--primary" onClick={handleNext}>{step === 3 ? "Review" : "Next"}</button>
        </div>
      </div>

      {/* Review Modal */}
      {showReview && (
        <div className="pp-modal-overlay" onClick={() => setShowReview(false)}>
          <div className="pp-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="pp-modal-header">
              <div className="pp-modal-icon" style={{ background: "#f3e8ff", color: "#7c3aed" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <h3 className="pp-card-title">Confirm Submission</h3>
            </div>
            <div className="pp-review-body">
              {[
                ["Employee", form.employeeName],
                ["Location", form.locationKey],
                ["Action", actionLabel],
                ["Effective", form.effectiveDate],
                form.oldRate && ["Old Rate", Formatter.toMoney(form.oldRate)],
                form.newRate && ["New Rate", Formatter.toMoney(form.newRate)],
                form.amount && ["Amount", Formatter.toMoney(form.amount)],
                form.oldTitle && ["Old Title", form.oldTitle],
                form.newTitle && ["New Title", form.newTitle],
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} className="pp-review-row">
                  <span className="pp-review-label">{label}</span>
                  <span className="pp-review-val">{value}</span>
                </div>
              ))}
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn pp-btn--ghost" onClick={() => setShowReview(false)}>Go Back</button>
              <button className="pp-btn pp-btn--primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? <><span className="pp-btn-spinner" /> Sending...</> : "Confirm & Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
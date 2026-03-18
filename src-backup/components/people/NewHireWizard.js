"use client";
import { useState, useEffect, useCallback, useRef } from "react";

const STANDARD_ROLES = ["General Manager", "Executive Chef", "Sous Chef", "Cook", "Prep Cook", "Dishwasher", "Driver"];
const MGMT_ROLES = ["General Manager", "Executive Chef", "Sous Chef"];

function getLocalISODate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
}

function getDefaults() {
  return {
    isRehire: "No", payType: "Hourly",
    needsCard: "No", needsLaptop: "No", needsEmail: "No", needsCell: "No",
    isFullTime: false, startDate: getLocalISODate(),
    jobTitle: "", manager: "", operation: "",
    firstName: "", lastName: "", personalEmail: "", payRate: "",
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

function YesNoToggle({ value, onChange }) {
  return (
    <div className="pp-yn-toggle">
      <div className={`pp-yn-option${value !== "Yes" ? " pp-yn-active-no" : ""}`} onClick={() => onChange("No")}>No</div>
      <div className={`pp-yn-option${value === "Yes" ? " pp-yn-active-yes" : ""}`} onClick={() => onChange("Yes")}>Yes</div>
    </div>
  );
}

function TechRow({ label, value, onChange }) {
  return (
    <div className="pp-tech-row">
      <span className="pp-tech-label">{label}</span>
      <YesNoToggle value={value} onChange={onChange} />
    </div>
  );
}

export default function NewHireWizard({ bootstrapData, Drafts, Formatter, onNavigate, showToast, openConfirm, refreshHistory }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(getDefaults);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [success, setSuccess] = useState(false);
  const salaryConfirmed = useRef(false);

  // Load draft on mount
  useEffect(() => {
    const draft = Drafts.load("nh");
    if (draft) setForm((prev) => ({ ...prev, ...draft }));
  }, [Drafts]);

  // Save draft on form change
  useEffect(() => { Drafts.save("nh", form); }, [form, Drafts]);

  const update = useCallback((key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }));
    setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  const validate = () => {
    const errs = {};
    if (step === 1) {
      if (!form.firstName) errs.firstName = true;
      if (!form.lastName) errs.lastName = true;
      if (!form.personalEmail) errs.personalEmail = true;
    } else if (step === 2) {
      if (!form.operation) errs.operation = true;
      if (!form.manager) errs.manager = true;
      if (!form.jobTitle) errs.jobTitle = true;
    } else if (step === 3) {
      if (!form.payRate) errs.payRate = true;
      if (!form.startDate) errs.startDate = true;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (!validate()) return;

    if (step === 3 && !salaryConfirmed.current) {
      const rate = parseFloat(form.payRate || 0);
      const isHourly = form.payType === "Hourly";
      let flag = false;
      if (isHourly && (rate < 10 || rate > 30)) flag = true;
      if (!isHourly && (rate < 50000 || rate > 150000)) flag = true;

      if (flag) {
        openConfirm(
          "Double Check Rate?",
          `You entered a ${form.payType} rate of ${Formatter.toMoney(rate)}. This is outside our typical range. Is this correct?`,
          "Yes, Confirm",
          () => { salaryConfirmed.current = true; handleNext(); }
        );
        return;
      }
    }

    if (step < 3) {
      setStep(step + 1);
    } else {
      setShowReview(true);
    }
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
        body: JSON.stringify({ action: "submit-newhire", form: { ...form, submitterEmail: bootstrapData.userEmail } }),
      });
      const data = await res.json();
      if (data.success) {
        setShowReview(false);
        setSuccess(true);
        Drafts.clear("nh");
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
    salaryConfirmed.current = false;
    if (!stayOnForm) onNavigate("dashboard");
  };

  // ── Derived data ──
  const locations = bootstrapData?.locations || [];
  const allManagers = bootstrapData?.managers || [];
  const activeLocKey = (() => {
    const loc = locations.find((l) => `${l.key} - ${l.name}` === form.operation);
    return loc ? loc.key : null;
  })();
  const filteredManagers = activeLocKey ? allManagers.filter((m) => m.teamKey === activeLocKey) : [];
  const isOtherRole = form.jobTitle && !STANDARD_ROLES.includes(form.jobTitle);
  const isSalary = form.payType === "Salary";

  if (success) {
    return (
      <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
        <div className="pp-card pp-card--form">
          <div className="pp-success-view">
            <div className="pp-success-circle"><div className="pp-success-icon">👍</div></div>
            <h2 className="pp-card-title">Team Reinforced!</h2>
            <p className="pp-card-desc">{form.firstName} has been queued for onboarding.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24, width: "100%", maxWidth: 280, margin: "24px auto 0" }}>
              <button className="pp-btn pp-btn--primary" onClick={() => resetForm(true)}>Start Another Hire</button>
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
          {/* STEP 1: Identity */}
          {step === 1 && (
            <>
              <h3 className="pp-card-title">Let&apos;s meet the candidate.</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                <div>
                  <label className="pp-label">First Name</label>
                  <input className={`pp-input${errors.firstName ? " pp-input-error" : ""}`} value={form.firstName} onChange={(e) => update("firstName", e.target.value)} placeholder="e.g. Jane" />
                </div>
                <div>
                  <label className="pp-label">Last Name</label>
                  <input className={`pp-input${errors.lastName ? " pp-input-error" : ""}`} value={form.lastName} onChange={(e) => update("lastName", e.target.value)} placeholder="e.g. Doe" />
                </div>
              </div>
              <label className="pp-label">Personal Email</label>
              <input className={`pp-input${errors.personalEmail ? " pp-input-error" : ""}`} type="email" value={form.personalEmail} onChange={(e) => update("personalEmail", e.target.value)} placeholder="jane.doe@gmail.com" />
              <label className="pp-label">Rehire Status</label>
              <div className="pp-pill-group">
                <div className={`pp-pill-option${form.isRehire !== "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("isRehire", "No")}>New Employee</div>
                <div className={`pp-pill-option${form.isRehire === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("isRehire", "Yes")}>Returning</div>
              </div>
            </>
          )}

          {/* STEP 2: Role */}
          {step === 2 && (
            <>
              <h3 className="pp-card-title">Where do they fit in?</h3>
              <label className="pp-label">Operation</label>
              <select
                className={`pp-select${errors.operation ? " pp-input-error" : ""}`}
                value={form.operation}
                onChange={(e) => {
                  update("operation", e.target.value);
                  update("manager", ""); // Reset manager when operation changes
                }}
              >
                <option value="">Select...</option>
                {locations.map((l) => (
                  <option key={l.key} value={`${l.key} - ${l.name}`}>{l.key} - {l.name}</option>
                ))}
              </select>

              <label className="pp-label">Reporting Manager</label>
              <select
                className={`pp-select${errors.manager ? " pp-input-error" : ""}`}
                value={form.manager}
                onChange={(e) => update("manager", e.target.value)}
                disabled={!activeLocKey}
              >
                <option value="">Select...</option>
                {filteredManagers.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>

              <label className="pp-label">Job Title</label>
              <select
                className={`pp-select${errors.jobTitle && !isOtherRole ? " pp-input-error" : ""}`}
                value={isOtherRole ? "Other" : form.jobTitle}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "Other") {
                    update("jobTitle", "");
                  } else {
                    update("jobTitle", val);
                    if (MGMT_ROLES.includes(val)) update("payType", "Salary");
                    else update("payType", "Hourly");
                    salaryConfirmed.current = false;
                  }
                }}
              >
                <option value="">Select...</option>
                <optgroup label="Management">
                  <option>General Manager</option>
                  <option>Executive Chef</option>
                  <option>Sous Chef</option>
                </optgroup>
                <optgroup label="Staff">
                  <option>Cook</option>
                  <option>Prep Cook</option>
                  <option>Dishwasher</option>
                  <option>Driver</option>
                </optgroup>
                <option value="Other">Other (Specify)</option>
              </select>

              {(isOtherRole || form.jobTitle === "") && (
                <div className={`pp-slide-wrapper${isOtherRole || form.jobTitle === "" ? "" : ""}`}>
                  {isOtherRole && (
                    <>
                      <label className="pp-label">Specify Job Title</label>
                      <input className={`pp-input${errors.jobTitle ? " pp-input-error" : ""}`} value={form.jobTitle} onChange={(e) => update("jobTitle", e.target.value)} placeholder="Enter role name" />
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* STEP 3: Compensation */}
          {step === 3 && (
            <>
              <h3 className="pp-card-title">Compensation & Access</h3>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
                <div className="pp-pill-group">
                  <div className={`pp-pill-option${!isSalary ? " pp-pill-option--active" : ""}`} onClick={() => { update("payType", "Hourly"); salaryConfirmed.current = false; }}>Hourly</div>
                  <div className={`pp-pill-option${isSalary ? " pp-pill-option--active" : ""}`} onClick={() => { update("payType", "Salary"); salaryConfirmed.current = false; }}>Salary</div>
                </div>
              </div>

              <label className="pp-label">{isSalary ? "Annual Salary" : "Hourly Rate"} ($)</label>
              <input className={`pp-input${errors.payRate ? " pp-input-error" : ""}`} type="number" value={form.payRate} onChange={(e) => update("payRate", e.target.value)} placeholder="0.00" />

              <div className="pp-hours-box">
                <input type="checkbox" className="pp-checkbox" checked={form.isFullTime || false} onChange={(e) => update("isFullTime", e.target.checked)} />
                <div className="pp-hours-text">
                  <strong>Full-Time (30+ Hours)</strong>
                  <p>Checking this confirms eligibility for Company Benefits.</p>
                </div>
              </div>

              <label className="pp-label">Start Date</label>
              <input className={`pp-input${errors.startDate ? " pp-input-error" : ""}`} type="date" value={form.startDate} onChange={(e) => update("startDate", e.target.value)} />

              <div style={{ marginTop: 24 }}>
                <label className="pp-label">Tools & Access</label>
                <TechRow label="Company Card?" value={form.needsCard} onChange={(v) => update("needsCard", v)} />
                <TechRow label="KitchFix Email?" value={form.needsEmail} onChange={(v) => update("needsEmail", v)} />
                <TechRow label="Company Laptop?" value={form.needsLaptop} onChange={(v) => update("needsLaptop", v)} />
                <TechRow label="Cell Reimbursement?" value={form.needsCell} onChange={(v) => update("needsCell", v)} />
              </div>
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
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
              </div>
              <h3 className="pp-card-title">Confirm Hiring Details</h3>
            </div>
            <div className="pp-review-body">
              {[
                ["Candidate", `${form.firstName} ${form.lastName}`, 1],
                ["Role", form.jobTitle, 2],
                ["Manager", form.manager, 2],
                ["Start Date", form.startDate, 3],
                ["Comp", `$${form.payRate} (${form.payType})`, 3],
                ["Equipment", [form.needsCard === "Yes" && "Card", form.needsLaptop === "Yes" && "Laptop", form.needsEmail === "Yes" && "Email", form.needsCell === "Yes" && "Cell"].filter(Boolean).join(", ") || "Standard Access", 3],
              ].map(([label, value, s]) => (
                <div key={label} className="pp-review-row">
                  <span className="pp-review-label">{label}</span>
                  <span className="pp-review-val">{value}</span>
                  <button className="pp-btn-edit" onClick={() => { setShowReview(false); setStep(s); }}>✎</button>
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
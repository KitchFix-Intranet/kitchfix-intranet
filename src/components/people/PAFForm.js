"use client";
import { useState, useEffect, useCallback } from "react";
import { Stepper, CurrencyInput, EditButton } from "./shared";

function getLocalISODate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
}

// REF-006 + REF-007 pay bands (DRAFT, pending Finance validation).
// Hourly bands keyed by state; leadership bands national.
const PAY_BANDS = {
  hourly: {
    AZ: {
      Dishwasher:      { min: 15.50, mid: 17.50, max: 20.00 },
      Cook:            { min: 18.00, mid: 21.00, max: 25.00 },
      "FOH Attendant": { min: 16.00, mid: 18.50, max: 22.00 },
      Driver:          { min: 18.00, mid: 21.00, max: 25.00 },
    },
    FL: {
      Dishwasher:      { min: 15.00, mid: 17.00, max: 19.50 },
      Cook:            { min: 17.50, mid: 20.50, max: 24.00 },
      "FOH Attendant": { min: 15.50, mid: 18.00, max: 21.00 },
      Driver:          { min: 17.50, mid: 20.50, max: 24.00 },
    },
    TX: {
      Dishwasher:      { min: 15.00, mid: 17.00, max: 19.50 },
      Cook:            { min: 18.00, mid: 21.00, max: 25.00 },
      "FOH Attendant": { min: 15.50, mid: 18.00, max: 21.00 },
      Driver:          { min: 18.00, mid: 21.00, max: 25.00 },
    },
    NY: {
      Dishwasher:      { min: 16.00, mid: 18.00, max: 20.00 },
      Cook:            { min: 18.00, mid: 21.00, max: 25.00 },
      "FOH Attendant": { min: 16.50, mid: 19.00, max: 22.00 },
      Driver:          { min: 18.00, mid: 21.00, max: 25.00 },
    },
    MO: {
      Dishwasher:      { min: 15.00, mid: 17.00, max: 19.00 },
      Cook:            { min: 17.00, mid: 20.00, max: 23.50 },
      "FOH Attendant": { min: 15.50, mid: 18.00, max: 21.00 },
      Driver:          { min: 17.00, mid: 20.00, max: 23.50 },
    },
    OH: {
      Dishwasher:      { min: 14.50, mid: 16.00, max: 18.00 },
      Cook:            { min: 16.50, mid: 19.50, max: 23.00 },
      "FOH Attendant": { min: 14.50, mid: 17.00, max: 20.00 },
      Driver:          { min: 16.50, mid: 19.50, max: 23.00 },
    },
    KY: {
      Dishwasher:      { min: 14.00, mid: 15.50, max: 17.50 },
      Cook:            { min: 16.00, mid: 18.50, max: 22.00 },
      "FOH Attendant": { min: 14.00, mid: 16.50, max: 19.50 },
      Driver:          { min: 16.00, mid: 18.50, max: 22.00 },
    },
  },
  leadership: {
    "Sous Chef":           { min: 52000, mid: 60000, max: 72000 },
    "Hospitality Manager": { min: 55000, mid: 66000, max: 82000 },
    "Executive Chef":      { min: 80000, mid: 95000, max: 120000 },
    "General Manager":     { min: 80000, mid: 95000, max: 120000 },
  },
};

const STATE_ALIAS = { BUF: "NY" };

function parseStateFromLocation(locationKey) {
  if (!locationKey) return null;
  const segments = locationKey.split(" - ");
  const key = segments[0]?.trim();
  if (key === "CORP") return null;
  const raw = segments[1]?.trim();
  if (!raw) return null;
  return STATE_ALIAS[raw] || raw;
}

function getBand(employeeLevel, role, state) {
  if (!role || role === "Other") return null;
  if (employeeLevel === "leadership") return PAY_BANDS.leadership[role] || null;
  if (!state || !PAY_BANDS.hourly[state]) return null;
  return PAY_BANDS.hourly[state][role] || null;
}

function getDefaults() {
  return {
    effectiveDate: getLocalISODate(), locationKey: "", locationName: "", employeeName: "",
actionType: "", actionGroup: "Voluntary", separationReason: "", rehireEligible: "Yes", lastDayWorked: "",
    statusChangeDirection: "Part-Time to Full-Time",
    reclassFrom: "", reclassTo: "", reclassChangeRate: "No", reclassTitleChange: "No",
    oldTitle: "", newTitle: "", oldRate: "", newRate: "", amount: "",
    cellFrequency: "Monthly",
    travelStartDate: "", travelEndDate: "", travelTotalDays: 0,
    travelSupplementEnabled: "No", travelSupplementTotal: 0,
    perDiemTotal: 0, travelGrandTotal: 0,
    perDiem_noMeals: "0", perDiem_bkfstProvided: "0", perDiem_lunchProvided: "0",
    perDiem_dinnerProvided: "0", perDiem_bkfstLunch: "0", perDiem_bkfstDinner: "0",
    perDiem_lunchDinner: "0", perDiem_allMeals: "0",
    explanation: "", uploadData: null, uploadFileName: "",
    // pay_increase fields
    increaseType: "", employeeLevel: "", role: "", customRole: "",
    dollarIncrease: "", pctIncrease: "",
    eligSeasonComplete: false, eligNoDiscipline: false, eligCertsCurrent: false, eligManagerApproved: false,
    // equipment_request fields
    equipmentRequestType: "", replacementReason: "", currentDeviceDetails: "",
    equipmentShipTo: "", confirmReturn: false, confirmReported: false,
  };
}

// Fix #12: Fields to reset when switching action types
const ACTION_SPECIFIC_FIELDS = {
separation: ["actionGroup", "separationReason", "rehireEligible", "lastDayWorked"],
  rate_change: ["oldRate", "newRate"],
  pay_increase: ["increaseType", "employeeLevel", "role", "customRole", "oldRate", "newRate", "dollarIncrease", "pctIncrease", "eligSeasonComplete", "eligNoDiscipline", "eligCertsCurrent", "eligManagerApproved"],
  title_change: ["oldTitle", "newTitle", "reclassChangeRate"],
  status_change: ["statusChangeDirection"],
  reclassification: ["reclassFrom", "reclassTo", "reclassChangeRate", "reclassTitleChange", "oldTitle", "newTitle"],
  add_cell_phone: ["cellFrequency"],
  travel_reimbursement: ["travelStartDate", "travelEndDate", "travelSupplementEnabled", "perDiem_noMeals", "perDiem_bkfstProvided", "perDiem_lunchProvided", "perDiem_dinnerProvided", "perDiem_bkfstLunch", "perDiem_bkfstDinner", "perDiem_lunchDinner", "perDiem_allMeals"],
  add_bonus: ["amount"],
  add_deduction: ["amount"],
  add_gratuity: ["amount"],
  other_reimbursement: ["amount"],
  equipment_request: ["equipmentRequestType", "replacementReason", "currentDeviceDetails", "equipmentShipTo", "confirmReturn", "confirmReported"],
};

// Separation sub-reasons by type
const SEPARATION_REASONS = {
  Voluntary: ["Resignation", "Job Abandonment"],
  Involuntary: ["Termination", "Layoff", "Furlough", "End of Season"],
};

/* Shared components imported from ./shared */

// Dynamic detail fields based on action type
function ActionDetails({ form, update, errors, Formatter, bootstrapData, showTravelHelp, setShowTravelHelp }) {
  const type = form.actionType;

  if (type === "separation") {
    const reasons = SEPARATION_REASONS[form.actionGroup] || [];
    return (
      <>
        <label className="pp-label">Separation Type</label>
        <div className="pp-pill-group">
          <button type="button" className={`pp-pill-option${form.actionGroup === "Voluntary" ? " pp-pill-option--active" : ""}`} onClick={() => { update("actionGroup", "Voluntary"); update("separationReason", ""); }}>Voluntary</button>
          <button type="button" className={`pp-pill-option${form.actionGroup === "Involuntary" ? " pp-pill-option--active" : ""}`} onClick={() => { update("actionGroup", "Involuntary"); update("separationReason", ""); }}>Involuntary</button>
        </div>
        <label className="pp-label">Reason</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {reasons.map((r) => {
            const selected = form.separationReason === r;
            return (
              <button
                type="button"
                key={r}
                onClick={() => update("separationReason", r)}
                style={{
                  padding: "10px 20px",
                  borderRadius: 50,
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  border: selected ? "1.5px solid var(--pp-purple)" : "1.5px solid #e2e8f0",
                  background: selected ? "var(--pp-purple-soft)" : "#fff",
                  color: selected ? "var(--pp-purple)" : "var(--pp-grey)",
                  boxShadow: selected ? "0 2px 8px rgba(124, 58, 237, 0.15)" : "none",
                }}
              >
                {selected && <span style={{ marginRight: 6 }}>✓</span>}{r}
              </button>
            );
          })}
        </div>
        {errors.separationReason && !form.separationReason && (
          <p style={{ color: "var(--pp-error)", fontSize: 12, fontWeight: 600, margin: "4px 0 0" }}>Please select a reason.</p>
        )}
        <label className="pp-label">Additional Details (optional)</label>
        <textarea className="pp-textarea" value={form.explanation} onChange={(e) => update("explanation", e.target.value)} placeholder="Any additional context about this separation..." rows={3} />
<label className="pp-label">Last Day Worked</label>
        <input type="date" className="pp-input" value={form.lastDayWorked || ""} onChange={(e) => update("lastDayWorked", e.target.value)} />
        <label className="pp-label">Eligible for Rehire?</label>
        <div className="pp-pill-group">
          <button type="button" className={`pp-pill-option${form.rehireEligible === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("rehireEligible", "Yes")}>Yes</button>
          <button type="button" className={`pp-pill-option${form.rehireEligible === "No" ? " pp-pill-option--active" : ""}`} onClick={() => update("rehireEligible", "No")}>No</button>
        </div>
              </>
    );
  }

  if (type === "pay_increase") {
    const state = parseStateFromLocation(form.locationKey);
    const isLeadership = form.employeeLevel === "leadership";
    const band = getBand(form.employeeLevel, form.role, state);
    const oldNum = parseFloat(String(form.oldRate || "").replace(/[^0-9.]/g, ""));
    const newNum = parseFloat(String(form.newRate || "").replace(/[^0-9.]/g, ""));
    const hasBoth = oldNum > 0 && newNum > 0;
    const diff = hasBoth ? newNum - oldNum : 0;
    const pct = hasBoth && oldNum > 0 ? ((diff / oldNum) * 100).toFixed(1) : "0.0";
    const isUp = diff > 0;

    // Persist computed values into form state for payload (email/Slack consume these)
    useEffect(() => {
      if (!hasBoth) return;
      const dStr = isLeadership
        ? `$${Math.abs(diff).toLocaleString("en-US", { minimumFractionDigits: 0 })}`
        : `$${Math.abs(diff).toFixed(2)}`;
      const pStr = `${diff >= 0 ? "+" : "-"}${Math.abs(pct)}%`;
      if (form.dollarIncrease !== dStr) update("dollarIncrease", dStr);
      if (form.pctIncrease !== pStr) update("pctIncrease", pStr);
    }, [hasBoth, diff, pct, isLeadership, form.dollarIncrease, form.pctIncrease, update]);

    const hourlyRoles = ["Dishwasher", "Cook", "FOH Attendant", "Driver", "Other"];
    const leadershipRoles = ["Sous Chef", "Hospitality Manager", "Executive Chef", "General Manager", "Other"];

    // Mid-season detection: effective date between April 1 and September 30
    const eff = form.effectiveDate ? new Date(form.effectiveDate + "T00:00:00") : null;
    const effMonth = eff ? eff.getMonth() : -1;
    const isMidSeason = effMonth >= 3 && effMonth <= 8;

    return (
      <>
        {/* Increase type */}
        <label className="pp-label">Increase type</label>
        <div className="pp-pill-group" style={{ marginBottom: 16, flexWrap: "wrap" }}>
          {["Merit", "Market / structural", "Promotion", "Equity", "Retention"].map((t) => (
            <button key={t} type="button"
              className={`pp-pill-option${form.increaseType === t ? " pp-pill-option--active" : ""}`}
              onClick={() => update("increaseType", t)}>{t}</button>
          ))}
        </div>

        {/* Employee level */}
        <label className="pp-label">Employee level</label>
        <div className="pp-pill-group" style={{ marginBottom: 16 }}>
          {[["hourly", "Hourly"], ["leadership", "Leadership"]].map(([val, label]) => (
            <button key={val} type="button"
              className={`pp-pill-option${form.employeeLevel === val ? " pp-pill-option--active" : ""}`}
              onClick={() => { update("employeeLevel", val); update("role", ""); update("customRole", ""); }}>{label}</button>
          ))}
        </div>

        {/* Role */}
        {form.employeeLevel && (
          <>
            <label className="pp-label">Role</label>
            <div className="pp-pill-group" style={{ marginBottom: form.role === "Other" ? 8 : 16, flexWrap: "wrap", gap: 6 }}>
              {(form.employeeLevel === "hourly" ? hourlyRoles : leadershipRoles).map((r) => (
                <button key={r} type="button"
                  className={`pp-pill-option${form.role === r ? " pp-pill-option--active" : ""}${r === "Other" ? " pp-pill-option--dashed" : ""}`}
                  style={{ padding: "8px 12px", fontSize: 13 }}
                  onClick={() => { update("role", r); if (r !== "Other") update("customRole", ""); }}>{r}</button>
              ))}
            </div>
            {form.role === "Other" && (
              <div style={{ marginBottom: 16 }}>
                <label className="pp-label" style={{ textTransform: "none" }}>Please specify</label>
                <input className={`pp-input${errors.customRole ? " pp-input-error" : ""}`}
                  value={form.customRole} onChange={(e) => update("customRole", e.target.value)}
                  placeholder="Enter role title..." />
              </div>
            )}
          </>
        )}

        {/* Rate */}
        <div style={{ marginTop: 20, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="pp-label">{isLeadership ? "Current salary" : "Current rate"}</label>
              <CurrencyInput value={form.oldRate} onChange={(v) => update("oldRate", v)} error={errors.oldRate} />
            </div>
            <div>
              <label className="pp-label">{isLeadership ? "Proposed salary" : "Proposed rate"}</label>
              <CurrencyInput value={form.newRate} onChange={(v) => update("newRate", v)} error={errors.newRate} />
            </div>
          </div>

          {hasBoth && diff !== 0 && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: isUp ? "#ecfdf5" : "#fef2f2", borderRadius: 8, marginTop: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isUp ? "#10b981" : "#ef4444"} strokeWidth="2.5">
                {isUp
                  ? (<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>)
                  : (<><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></>)}
              </svg>
              <span style={{ fontWeight: 600, color: isUp ? "#065f46" : "#991b1b" }}>
                {isUp ? "+" : "-"}{isLeadership ? `$${Math.abs(diff).toLocaleString("en-US")}` : `$${Math.abs(diff).toFixed(2)}`}
              </span>
              <span style={{ fontSize: 13, color: isUp ? "#065f46" : "#991b1b" }}>({pct}%)</span>
            </div>
          )}
        </div>

        {/* Band position - hourly only, known roles only */}
        {form.employeeLevel === "hourly" && band && (
          <div style={{ marginTop: 20, padding: 16, background: "#f8fafc", borderRadius: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
              {[["Minimum", band.min], ["Midpoint", band.mid], ["Maximum", band.max]].map(([label, val]) => (
                <div key={label} style={{ textAlign: "center", padding: "6px 0" }}>
                  <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.3px" }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>${val.toFixed(2)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>
              {state} {form.role} band - planning baseline, pending Finance validation.
            </div>

            {newNum > 0 && (() => {
              const bandPct = Math.round(((newNum - band.min) / (band.max - band.min)) * 100);
              const clampedPct = Math.min(Math.max(bandPct, 0), 100);
              const labelStyle = {
                position: "absolute", top: -24, fontSize: 11, fontWeight: 600, color: "#153968", whiteSpace: "nowrap",
                ...(clampedPct < 15 ? { left: 0, transform: "none" }
                  : clampedPct > 85 ? { right: 0, transform: "none", left: "auto" }
                  : { left: "50%", transform: "translateX(-50%)" }),
              };
              const bandMessage = bandPct === 0 ? "at band minimum"
                : bandPct >= 100 && newNum <= band.max ? "at band maximum"
                : `within band - ${bandPct}% of range`;
              return (
                <>
                  <div style={{ position: "relative", height: 10, borderRadius: 5, background: "linear-gradient(90deg, #f1f5f9 0%, #dbeafe 50%, #f1f5f9 100%)", marginTop: 20 }}>
                    <div style={{
                      position: "absolute", top: -6, width: 3, height: 22, background: "#153968", borderRadius: 2, zIndex: 2,
                      left: `${clampedPct}%`,
                      transform: "translateX(-50%)",
                    }}>
                      <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", width: 8, height: 8, borderRadius: "50%", background: "#153968" }} />
                      <div style={labelStyle}>
                        ${isLeadership ? newNum.toLocaleString("en-US") : newNum.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#94a3b8" }}>
                    <span>${band.min.toFixed(2)}</span>
                    <span>${band.max.toFixed(2)}</span>
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 8, marginTop: 10,
                    background: newNum > band.max ? "#fffbeb" : "#eff6ff",
                  }}>
                    {newNum > band.max ? (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                        <span style={{ fontSize: 13, color: "#92400e" }}>Exceeds band maximum - requires VP Ops + People Ops sign-off</span>
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                        <span style={{ fontSize: 13, color: "#1e40af" }}>
                          ${newNum.toFixed(2)} is {bandMessage}
                        </span>
                      </>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Eligibility assessment */}
        <div style={{ marginTop: 20, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
          <label className="pp-label" style={{ textTransform: "none" }}>Eligibility assessment</label>
          {[
            { key: "eligSeasonComplete", label: "Completed at least one full season or review period", sub: null },
            { key: "eligNoDiscipline", label: "Not on active disciplinary track", sub: "No Level 3, final written warning, or PIP under SOP-004" },
            { key: "eligCertsCurrent", label: "Required certifications current", sub: "ServSafe Food Handler + ServSafe Allergen" },
            { key: "eligManagerApproved", label: "Discussed and approved by your manager", sub: null },
          ].map((item) => (
            <label key={item.key} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={!!form[item.key]} onChange={(e) => update(item.key, e.target.checked)}
                style={{ width: 18, height: 18, minWidth: 18, marginTop: 1, accentColor: "#153968" }} />
              <div>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>{item.label}</div>
                {item.sub && <div style={{ fontSize: 11, color: "#94a3b8" }}>{item.sub}</div>}
              </div>
            </label>
          ))}
        </div>

        {/* Mid-season warning */}
        {isMidSeason && (
          <div style={{ marginTop: 16, display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", background: "#fffbeb", borderRadius: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.4 }}>
              <strong>Mid-season change detected.</strong> Mid-season rate changes require VP Ops + RDO + People Ops approval. Only genuine promotions qualify.
            </div>
          </div>
        )}

        {/* Rationale */}
        <div style={{ marginTop: 20, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
          <label className="pp-label" style={{ textTransform: "none" }}>Why does this person deserve a raise?</label>
          <textarea className={`pp-textarea${errors.explanation ? " pp-input-error" : ""}`}
            value={form.explanation} onChange={(e) => update("explanation", e.target.value)}
            placeholder="What have they done? What's changed? Be specific."
            rows={4} />
        </div>
      </>
    );
  }

  if (type === "equipment_request") {
    const isReplacement = form.equipmentRequestType === "replacement";
    const isLostStolen = isReplacement && (form.replacementReason === "Lost" || form.replacementReason === "Stolen");

    return (
      <>
        {/* Request type */}
        <label className="pp-label" style={{ textTransform: "none" }}>Request type</label>
        <div className="pp-pill-group" style={{ marginBottom: 16 }}>
          {[["new", "New device"], ["replacement", "Replacement"]].map(([val, label]) => (
            <button key={val} type="button"
              className={`pp-pill-option${form.equipmentRequestType === val ? " pp-pill-option--active" : ""}`}
              onClick={() => { update("equipmentRequestType", val); update("replacementReason", ""); update("currentDeviceDetails", ""); update("confirmReturn", false); update("confirmReported", false); }}>{label}</button>
          ))}
        </div>
        {!isReplacement && form.equipmentRequestType === "new" && (
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: -12, marginBottom: 16 }}>New device = first laptop for this employee.</div>
        )}

        {/* Replacement reason */}
        {isReplacement && (
          <div style={{ marginTop: 4, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
            <label className="pp-label" style={{ textTransform: "none" }}>Reason for replacement</label>
            <div className="pp-pill-group" style={{ marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
              {["Damaged", "Lost", "Stolen", "End of life / upgrade"].map((r) => (
                <button key={r} type="button"
                  className={`pp-pill-option${form.replacementReason === r ? " pp-pill-option--active" : ""}${(r === "Lost" || r === "Stolen") ? " pp-pill-option--warn" : ""}`}
                  style={{
                    padding: "8px 12px", fontSize: 13,
                    ...((r === "Lost" || r === "Stolen") && form.replacementReason !== r ? { background: "#fef2f2", color: "#991b1b", borderColor: "#fca5a5" } : {}),
                    ...((r === "Lost" || r === "Stolen") && form.replacementReason === r ? { background: "#991b1b", color: "#fff", borderColor: "#991b1b" } : {}),
                  }}
                  onClick={() => { update("replacementReason", r); update("confirmReported", false); }}>{r}</button>
              ))}
            </div>

            {/* Lost/stolen warning */}
            {isLostStolen && (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", background: "#fffbeb", borderRadius: 8, marginTop: 8 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                  <div style={{ fontSize: 12, color: "#92400e", lineHeight: 1.4 }}>
                    <strong>Lost or stolen devices must be reported to the Senior Director of Operations within 24 hours of discovery</strong> per AGR-002. Damage or loss from negligence may be the employee&apos;s financial responsibility.
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", marginTop: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!form.confirmReported} onChange={(e) => update("confirmReported", e.target.checked)}
                    style={{ width: 18, height: 18, minWidth: 18, marginTop: 1, accentColor: "#153968" }} />
                  <div style={{ fontSize: 13, lineHeight: 1.4 }}>Reported to Sr. Director of Operations within 24 hours</div>
                </label>
              </>
            )}
          </div>
        )}

        {/* Current device details - replacement only */}
        {isReplacement && form.replacementReason && (
          <div style={{ marginTop: 20, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
            <label className="pp-label" style={{ textTransform: "none" }}>Current device details</label>
            <input className={`pp-input${errors.currentDeviceDetails ? " pp-input-error" : ""}`}
              value={form.currentDeviceDetails} onChange={(e) => update("currentDeviceDetails", e.target.value)}
              placeholder="Make, model, and what's wrong..." />
          </div>
        )}

        {/* Ship to - always shown when request type is selected */}
        {form.equipmentRequestType && (
          <div style={{ marginTop: 20, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
            <label className="pp-label" style={{ textTransform: "none" }}>{isReplacement ? "Ship new device to" : "Ship to"}</label>
            <input className={`pp-input${errors.equipmentShipTo ? " pp-input-error" : ""}`}
              value={form.equipmentShipTo} onChange={(e) => update("equipmentShipTo", e.target.value)}
              placeholder="Account site, home address, or other..." />
          </div>
        )}

        {/* Additional details */}
        {form.equipmentRequestType && (
          <div style={{ marginTop: 20, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
            <label className="pp-label" style={{ textTransform: "none" }}>{form.equipmentRequestType === "new" ? "Why does this employee need a laptop?" : "Additional details"}</label>
            <textarea className={`pp-textarea${errors.explanation ? " pp-input-error" : ""}`}
              value={form.explanation} onChange={(e) => update("explanation", e.target.value)}
              placeholder={form.equipmentRequestType === "new" ? "New hire, role change, operational need..." : "Any specs, urgency, or context..."}
              rows={3} />
          </div>
        )}

        {/* Return shipping notice - replacement only */}
        {isReplacement && form.replacementReason && (
          <div style={{ marginTop: 20, borderTop: "1px solid #e2e8f0", paddingTop: 20 }}>
            <div style={{ padding: "14px 16px", background: "#f8fafc", borderRadius: 8, border: "0.5px solid #e2e8f0" }}>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" style={{ flexShrink: 0 }}><rect x="1" y="6" width="22" height="12" rx="2" /><path d="M1 10h22" /></svg>
                Return current device to
              </div>
              <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
                Kevin Fietek - Office 805<br />
                Attn: KitchFix<br />
                805 Greenwood St<br />
                Evanston, IL 60201
              </div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Per AGR-002, the current device must be returned before or at the time the replacement is issued.</div>
            </div>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", marginTop: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={!!form.confirmReturn} onChange={(e) => update("confirmReturn", e.target.checked)}
                style={{ width: 18, height: 18, minWidth: 18, marginTop: 1, accentColor: "#153968" }} />
              <div>
                <div style={{ fontSize: 13, lineHeight: 1.4 }}>I acknowledge the current device will be shipped back to the address above</div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Required before submitting</div>
              </div>
            </label>
          </div>
        )}

        {/* New device AGR-002 info note */}
        {form.equipmentRequestType === "new" && (
          <div style={{ marginTop: 16, display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", background: "#eff6ff", borderRadius: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
            <div style={{ fontSize: 12, color: "#1e40af", lineHeight: 1.4 }}>
              New devices are coordinated through Operations and IT. The employee will need to sign AGR-002 (Laptop Acceptance Agreement) when the device is issued.
            </div>
          </div>
        )}
      </>
    );
  }

  if (type === "title_change") {
    return (
      <>
        <label className="pp-label">What&apos;s their current role?</label>
        <input className={`pp-input${errors.oldTitle ? " pp-input-error" : ""}`} value={form.oldTitle} onChange={(e) => update("oldTitle", e.target.value)} placeholder="e.g. Prep Cook" />
        <label className="pp-label">What role are they moving into?</label>
        <input className={`pp-input${errors.newTitle ? " pp-input-error" : ""}`} value={form.newTitle} onChange={(e) => update("newTitle", e.target.value)} placeholder="e.g. Line Cook" />
        <label className="pp-label">Will their pay change too?</label>
        <div className="pp-pill-group">
          <button type="button" className={`pp-pill-option${form.reclassChangeRate !== "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassChangeRate", "No")}>No</button>
          <button type="button" className={`pp-pill-option${form.reclassChangeRate === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassChangeRate", "Yes")}>Yes</button>
        </div>
        {form.reclassChangeRate === "Yes" && (
          <>
            <label className="pp-label">New Rate</label>
            <CurrencyInput value={form.newRate} onChange={(v) => update("newRate", v)} error={errors.newRate} />
          </>
        )}
      </>
    );
  }

  if (type === "status_change") {
    const toFull = form.statusChangeDirection === "Part-Time to Full-Time";
    return (
      <>
        <label className="pp-label">What&apos;s changing?</label>
        <div className="pp-pill-group pp-pill-group--stack">
          {["Part-Time to Full-Time", "Full-Time to Part-Time"].map((dir) => (
            <button type="button" key={dir} className={`pp-pill-option${form.statusChangeDirection === dir ? " pp-pill-option--active" : ""}`} onClick={() => update("statusChangeDirection", dir)}>{dir}</button>
          ))}
        </div>
        <div className="pp-hours-box" style={{ marginTop: 16 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={toFull ? "#10b981" : "#f59e0b"} strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
          <div className="pp-hours-text">
            <strong>{toFull ? "Benefits Eligibility" : "Benefits Impact"}</strong>
            <p>{toFull
              ? "Moving to 30+ hours makes this employee eligible for company benefits."
              : "Dropping below 30 hours will end eligibility for company benefits."
            }</p>
          </div>
        </div>
      </>
    );
  }

  if (type === "reclassification") {
    const locations = bootstrapData?.locations || [];
    return (
      <>
        <label className="pp-label">Where are they now?</label>
        <select
          className={`pp-select${errors.reclassFrom ? " pp-input-error" : ""}`}
          value={form.reclassFrom}
          onChange={(e) => update("reclassFrom", e.target.value)}
        >
          <option value="">Select current account...</option>
          {locations.map((l) => (
            <option key={l.key} value={`${l.key} - ${l.name}`}>{l.key} - {l.name}</option>
          ))}
        </select>

        <label className="pp-label">Where are they moving?</label>
        <select
          className={`pp-select${errors.reclassTo ? " pp-input-error" : ""}`}
          value={form.reclassTo}
          onChange={(e) => update("reclassTo", e.target.value)}
        >
          <option value="">Select new account...</option>
          {locations.map((l) => (
            <option key={l.key} value={`${l.key} - ${l.name}`}>{l.key} - {l.name}</option>
          ))}
        </select>

        <label className="pp-label">Will their title change?</label>
        <div className="pp-pill-group">
          <button type="button" className={`pp-pill-option${form.reclassTitleChange !== "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassTitleChange", "No")}>No</button>
          <button type="button" className={`pp-pill-option${form.reclassTitleChange === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassTitleChange", "Yes")}>Yes</button>
        </div>
        {form.reclassTitleChange === "Yes" && (
          <>
            <label className="pp-label">Current Title</label>
            <input className={`pp-input${errors.oldTitle ? " pp-input-error" : ""}`} value={form.oldTitle} onChange={(e) => update("oldTitle", e.target.value)} placeholder="e.g. Prep Cook" />
            <label className="pp-label">New Title</label>
            <input className={`pp-input${errors.newTitle ? " pp-input-error" : ""}`} value={form.newTitle} onChange={(e) => update("newTitle", e.target.value)} placeholder="e.g. Line Cook" />
          </>
        )}

        <label className="pp-label">Will their pay change?</label>
        <div className="pp-pill-group">
          <button type="button" className={`pp-pill-option${form.reclassChangeRate !== "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassChangeRate", "No")}>No</button>
          <button type="button" className={`pp-pill-option${form.reclassChangeRate === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("reclassChangeRate", "Yes")}>Yes</button>
        </div>
        {form.reclassChangeRate === "Yes" && (
          <>
            <label className="pp-label">New Rate</label>
            <CurrencyInput value={form.newRate} onChange={(v) => update("newRate", v)} error={errors.newRate} />
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
            <button type="button" key={f} className={`pp-pill-option${form.cellFrequency === f ? " pp-pill-option--active" : ""}`} onClick={() => update("cellFrequency", f)}>{f}</button>
          ))}
        </div>
      </>
    );
  }

  if (type === "travel_reimbursement") {
    const PER_DIEM_TIERS = [
      { key: "noMeals", label: "No Meals Provided", rate: 80, desc: "Full day away from site" },
      { key: "bkfstProvided", label: "Breakfast Provided", rate: 65, desc: "Lunch & dinner on your own" },
      { key: "lunchProvided", label: "Lunch Provided", rate: 60, desc: "Breakfast & dinner on your own" },
      { key: "dinnerProvided", label: "Dinner Provided", rate: 45, desc: "Breakfast & lunch on your own" },
      { key: "bkfstLunch", label: "Breakfast & Lunch Provided", rate: 45, desc: "Default for on-site work" },
      { key: "bkfstDinner", label: "Breakfast & Dinner Provided", rate: 30, desc: "Lunch on your own" },
      { key: "lunchDinner", label: "Lunch & Dinner Provided", rate: 25, desc: "Breakfast on your own" },
      { key: "allMeals", label: "All Meals Provided", rate: 10, desc: "Incidentals only" },
    ];

    // Calculate trip duration
    const start = form.travelStartDate ? new Date(form.travelStartDate + "T00:00:00") : null;
    const end = form.travelEndDate ? new Date(form.travelEndDate + "T00:00:00") : null;
    const tripDays = (start && end && end >= start) ? Math.round((end - start) / 86400000) + 1 : 0;

    // Per diem days from form (stored as perDiem_noMeals, perDiem_bkfstProvided, etc.)
    const assignedDays = PER_DIEM_TIERS.reduce((sum, t) => sum + (parseInt(form["perDiem_" + t.key]) || 0), 0);
    const remainingDays = tripDays - assignedDays;

    // Totals
    const perDiemTotal = PER_DIEM_TIERS.reduce((sum, t) => sum + (parseInt(form["perDiem_" + t.key]) || 0) * t.rate, 0);
    const supplementTotal = form.travelSupplementEnabled === "Yes" ? tripDays * 50 : 0;
    const grandTotal = perDiemTotal + supplementTotal;

    return (
      <>
        {/* Help button */}
        <button
          type="button"
          onClick={() => setShowTravelHelp(!showTravelHelp)}
          style={{
            position: "absolute", top: 16, right: 16,
            width: 32, height: 32, borderRadius: "50%",
            background: "#f3e8ff", border: "1px solid #e9d5ff",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", fontSize: 15, fontWeight: 800, color: "#7c3aed",
          }}
          title="View Travel Policy"
          aria-label="View Travel Policy"
        >?</button>

        {/* SOP Help Modal */}
        {showTravelHelp && (
          <div style={{
            background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12,
            padding: 20, marginBottom: 20, fontSize: 13, lineHeight: 1.6,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 15, color: "#1e293b" }}>📋 Travel & Per Diem Policy</h4>
              <button onClick={() => setShowTravelHelp(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8" }} aria-label="Close policy panel">✕</button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <strong style={{ color: "#7c3aed" }}>Core Principle</strong>
              <p style={{ margin: "4px 0", color: "#475569" }}>&quot;Work the Shift, Not the Expense Report.&quot; KitchFix uses per diem for personal meals — no receipts needed for personal food. You DO need receipts for business expenses (client dinners, hardware, printing).</p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <strong style={{ color: "#7c3aed" }}>How Per Diem Works</strong>
              <p style={{ margin: "4px 0", color: "#475569" }}>Rates adjust based on which meals the site provides. When traveling, you should be eating on-site during meal periods. Travel days follow the same rules — only claim meals not provided to you before departure.</p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <strong style={{ color: "#7c3aed" }}>Daily Rates</strong>
              <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                {PER_DIEM_TIERS.map((t) => (
                  <div key={t.key} style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", background: "#fff", borderRadius: 6, fontSize: 12 }}>
                    <span style={{ color: "#475569" }}>{t.label}</span>
                    <strong style={{ color: "#1e293b" }}>${t.rate}/day</strong>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <strong style={{ color: "#7c3aed" }}>Travel Supplement ($50/day)</strong>
              <p style={{ margin: "4px 0", color: "#475569" }}>For Site Leaders/Managers reassigned to support a different location while their primary location is still operating. Taxable income. Requires eligibility — not all travel qualifies.</p>
            </div>

            <div>
              <strong style={{ color: "#7c3aed" }}>Company Card vs. Personal</strong>
              <p style={{ margin: "4px 0", color: "#475569" }}>Personal meals = Per Diem (no receipts). Team/client meals, flights, hotel, gas, supplies = Company Card (receipts required). If you claim Per Diem, do NOT use the Company Card for personal meals.</p>
            </div>
          </div>
        )}

        {/* Date Range */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="pp-label">Start Date</label>
            <input className={`pp-input${errors.travelStartDate ? " pp-input-error" : ""}`} type="date" value={form.travelStartDate} onChange={(e) => update("travelStartDate", e.target.value)} />
          </div>
          <div>
            <label className="pp-label">End Date</label>
            <input className={`pp-input${errors.travelEndDate ? " pp-input-error" : ""}`} type="date" value={form.travelEndDate} onChange={(e) => update("travelEndDate", e.target.value)} />
          </div>
        </div>

        {tripDays > 0 && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 14px", borderRadius: 10,
            background: "#f0fdf4", color: "#15803d",
            fontSize: 13, fontWeight: 600, marginTop: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
            {tripDays} day{tripDays !== 1 ? "s" : ""} total
          </div>
        )}

        {/* Travel Supplement */}
        <div style={{ marginTop: 20 }}>
          <label className="pp-label">Travel Supplement ($50/day)?</label>
          <div className="pp-pill-group">
            <button type="button" className={`pp-pill-option${form.travelSupplementEnabled !== "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("travelSupplementEnabled", "No")}>No</button>
            <button type="button" className={`pp-pill-option${form.travelSupplementEnabled === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("travelSupplementEnabled", "Yes")}>Yes</button>
          </div>
          {form.travelSupplementEnabled === "Yes" && (
            <div className="pp-hours-box" style={{ marginTop: 8 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
              <div className="pp-hours-text">
                <strong>Taxable Income</strong>
                <p style={{ margin: 0, fontSize: 12 }}>Only for managers reassigned to support a different location while their primary site is still active.</p>
              </div>
            </div>
          )}
        </div>

        {/* Per Diem Breakdown */}
        {tripDays > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <label className="pp-label" style={{ margin: 0 }}>Per Diem Breakdown</label>
              <span style={{
                fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 12,
                background: remainingDays === 0 ? "#ecfdf5" : remainingDays < 0 ? "#fef2f2" : "#fffbeb",
                color: remainingDays === 0 ? "#059669" : remainingDays < 0 ? "#dc2626" : "#d97706",
              }}>
                {remainingDays === 0 ? "✓ All days assigned" : remainingDays > 0 ? `${remainingDays} day${remainingDays !== 1 ? "s" : ""} remaining` : `${Math.abs(remainingDays)} day${Math.abs(remainingDays) !== 1 ? "s" : ""} over`}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PER_DIEM_TIERS.map((tier) => {
                const days = parseInt(form["perDiem_" + tier.key]) || 0;
                return (
                  <div key={tier.key} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: 10,
                    background: days > 0 ? "#faf5ff" : "#fafbfc",
                    border: days > 0 ? "1px solid #e9d5ff" : "1px solid #f1f5f9",
                    transition: "all 0.15s ease",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{tier.label}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{tier.desc}</div>
                    </div>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: "#7c3aed",
                      background: "#f3e8ff", padding: "2px 10px", borderRadius: 8,
                      whiteSpace: "nowrap", flexShrink: 0,
                    }}>${tier.rate}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <button
                        type="button"
                        aria-label={`Decrease ${tier.label} days`}
                        onClick={() => update("perDiem_" + tier.key, String(Math.max(0, days - 1)))}
                        disabled={days === 0}
                        style={{
                          width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0",
                          background: "#fff", cursor: days === 0 ? "default" : "pointer", fontSize: 16, fontWeight: 700,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: days === 0 ? "#cbd5e1" : "#64748b",
                          opacity: days === 0 ? 0.5 : 1,
                        }}
                      >−</button>
                      <span style={{ width: 28, textAlign: "center", fontSize: 15, fontWeight: 700, color: "#1e293b" }}>{days}</span>
                      <button
                        type="button"
                        aria-label={`Increase ${tier.label} days`}
                        onClick={() => update("perDiem_" + tier.key, String(days + 1))}
                        disabled={remainingDays <= 0}
                        style={{
                          width: 28, height: 28, borderRadius: 6, border: "1px solid #e2e8f0",
                          background: remainingDays <= 0 ? "#f8fafc" : "#fff",
                          cursor: remainingDays <= 0 ? "default" : "pointer", fontSize: 16, fontWeight: 700,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: remainingDays <= 0 ? "#cbd5e1" : "#64748b",
                          opacity: remainingDays <= 0 ? 0.5 : 1,
                        }}
                      >+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Summary Card */}
        {tripDays > 0 && (perDiemTotal > 0 || supplementTotal > 0) && (
          <div style={{
            marginTop: 16, padding: 16, borderRadius: 12,
            background: "linear-gradient(135deg, #faf5ff 0%, #f0f9ff 100%)",
            border: "1px solid #e9d5ff",
          }}>
            {supplementTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#475569", marginBottom: 6 }}>
                <span>Supplement ({tripDays} × $50)</span>
                <span style={{ fontWeight: 600 }}>${supplementTotal.toFixed(2)}</span>
              </div>
            )}
            {perDiemTotal > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#475569", marginBottom: supplementTotal > 0 ? 10 : 0 }}>
                <span>Per Diem</span>
                <span style={{ fontWeight: 600 }}>${perDiemTotal.toFixed(2)}</span>
              </div>
            )}
            {supplementTotal > 0 && perDiemTotal > 0 && (
              <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 10 }} />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, color: "#1e293b" }}>
              <span>Grand Total</span>
              <span style={{ color: "#7c3aed" }}>${grandTotal.toFixed(2)}</span>
            </div>
          </div>
        )}
      </>
    );
  }

  // Bonus, deduction, gratuity, other reimbursement
  if (["add_bonus", "add_deduction", "add_gratuity", "other_reimbursement"].includes(type)) {
    return (
      <>
        <label className="pp-label">Amount</label>
        <CurrencyInput value={form.amount} onChange={(v) => update("amount", v)} error={errors.amount} />
      </>
    );
  }

  return null;
}

export default function PAFForm({ bootstrapData, Drafts, Formatter, onNavigate, showToast, openConfirm, refreshHistory }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() => {
    const draft = Drafts.load("paf");
    return draft ? { ...getDefaults(), ...draft } : getDefaults();
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showTravelHelp, setShowTravelHelp] = useState(false);

  // Persist form to draft on every change
  useEffect(() => {
    Drafts.save("paf", form);
  }, [form, Drafts]);

  // Migrate stale rate_change drafts to pay_increase (rate_change is historical only).
  useEffect(() => {
    if (form.actionType === "rate_change") {
      setForm((prev) => ({ ...prev, actionType: "pay_increase" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((key, val) => {
    setForm((prev) => {
      const next = { ...prev, [key]: val };

      // Fix #12: When switching action types, reset all action-specific fields
      if (key === "actionType" && val !== prev.actionType) {
        const defaults = getDefaults();
        // Reset all action-specific fields to defaults
        Object.values(ACTION_SPECIFIC_FIELDS).flat().forEach((field) => {
          if (defaults[field] !== undefined) next[field] = defaults[field];
        });
        next.explanation = "";
        next.uploadData = null;
        next.uploadFileName = "";
        next.newRate = "";
      }

      return next;
    });
    setErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, []);

  const validate = () => {
    const errs = {};
    if (step === 1) {
      if (!form.locationKey) errs.locationKey = true;
      if (!form.employeeName) errs.employeeName = true;
      if (!form.actionType) errs.actionType = true;
    } else if (step === 2) {
      if (form.actionType === "separation" && !form.separationReason) errs.separationReason = true;
      // historical only - rate_change drafts auto-map to pay_increase, but keep validation as safety net
      if (form.actionType === "rate_change") {
        if (!form.oldRate) errs.oldRate = true;
        if (!form.newRate) errs.newRate = true;
        if (!form.explanation.trim()) errs.explanation = true;
      }
      if (form.actionType === "pay_increase") {
        if (!form.increaseType) errs.increaseType = true;
        if (!form.employeeLevel) errs.employeeLevel = true;
        if (!form.role) errs.role = true;
        if (form.role === "Other" && !form.customRole) errs.customRole = true;
        if (!form.oldRate) errs.oldRate = true;
        if (!form.newRate) errs.newRate = true;
        if (!form.explanation.trim()) errs.explanation = true;
      }
      if (form.actionType === "equipment_request") {
        if (!form.equipmentRequestType) errs.equipmentRequestType = true;
        if (form.equipmentRequestType === "replacement") {
          if (!form.replacementReason) errs.replacementReason = true;
          if (!form.currentDeviceDetails) errs.currentDeviceDetails = true;
          if (!form.confirmReturn) errs.confirmReturn = true;
          if ((form.replacementReason === "Lost" || form.replacementReason === "Stolen") && !form.confirmReported) errs.confirmReported = true;
        }
        if (!form.equipmentShipTo) errs.equipmentShipTo = true;
        if (!form.explanation.trim()) errs.explanation = true;
      }
      if (form.actionType === "title_change") {
        if (!form.oldTitle.trim()) errs.oldTitle = true;
        if (!form.newTitle.trim()) errs.newTitle = true;
        if (form.reclassChangeRate === "Yes" && !form.newRate) errs.newRate = true;
        if (!form.explanation.trim()) errs.explanation = true;
      }
      if (["add_bonus", "add_deduction", "add_gratuity", "other_reimbursement"].includes(form.actionType) && !form.amount) errs.amount = true;
      if (form.actionType === "travel_reimbursement") {
        if (!form.travelStartDate) errs.travelStartDate = true;
        if (!form.travelEndDate) errs.travelEndDate = true;
        if (!form.explanation.trim()) errs.explanation = true;
        // Validate per diem days match trip duration
        const s = form.travelStartDate ? new Date(form.travelStartDate + "T00:00:00") : null;
        const e = form.travelEndDate ? new Date(form.travelEndDate + "T00:00:00") : null;
        const days = (s && e && e >= s) ? Math.round((e - s) / 86400000) + 1 : 0;
        const tierKeys = ["noMeals","bkfstProvided","lunchProvided","dinnerProvided","bkfstLunch","bkfstDinner","lunchDinner","allMeals"];
        const assigned = tierKeys.reduce((sum, k) => sum + (parseInt(form["perDiem_" + k]) || 0), 0);
        if (days > 0 && assigned !== days) errs.perDiemBalance = true;
      }
      if (form.actionType === "reclassification") {
        if (!form.reclassFrom) errs.reclassFrom = true;
        if (!form.reclassTo) errs.reclassTo = true;
        if (form.reclassTitleChange === "Yes") {
          if (!form.oldTitle.trim()) errs.oldTitle = true;
          if (!form.newTitle.trim()) errs.newTitle = true;
        }
        if (form.reclassChangeRate === "Yes" && !form.newRate) errs.newRate = true;
      }
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      if (errs.perDiemBalance) showToast("Per diem days must equal your trip duration.", "error");
      else if (step === 1) showToast("Please fill in all required fields.", "error");
      else showToast("Some required fields are missing.", "error");
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (!validate()) return;
    if (step < 2) setStep(step + 1);
    else setShowReview(true);
  };

  const handleBack = () => {
    if (step === 1) onNavigate("dashboard");
    else setStep(step - 1);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Fix #1: Compute travel totals before sending
      const submitData = { ...form, submitterEmail: bootstrapData.userEmail };
      if (form.actionType === "travel_reimbursement") {
        const tiers = [
          { key: "noMeals", rate: 80 }, { key: "bkfstProvided", rate: 65 },
          { key: "lunchProvided", rate: 60 }, { key: "dinnerProvided", rate: 45 },
          { key: "bkfstLunch", rate: 45 }, { key: "bkfstDinner", rate: 30 },
          { key: "lunchDinner", rate: 25 }, { key: "allMeals", rate: 10 },
        ];
        const s = new Date(form.travelStartDate + "T00:00:00");
        const e = new Date(form.travelEndDate + "T00:00:00");
        const days = (s && e && e >= s) ? Math.round((e - s) / 86400000) + 1 : 0;
        const pd = tiers.reduce((sum, t) => sum + (parseInt(form["perDiem_" + t.key]) || 0) * t.rate, 0);
        const sup = form.travelSupplementEnabled === "Yes" ? days * 50 : 0;
        submitData.travelTotalDays = days;
        submitData.perDiemTotal = pd;
        submitData.travelSupplementTotal = sup;
        submitData.travelGrandTotal = pd + sup;
      }

      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit-paf", form: submitData }),
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
            <div className="pp-success-circle">
              <div className="pp-success-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
            </div>
            <h2 className="pp-card-title">{form.isEdit ? "Correction Resubmitted!" : "Request Submitted!"}</h2>
            <p className="pp-card-desc">Your {actionLabel} request for {form.employeeName} is now being processed.</p>
            {/* Fix #3: Back to Home is primary */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24, width: "100%", maxWidth: 280, margin: "24px auto 0" }}>
              <button className="pp-btn pp-btn--primary" onClick={() => resetForm(false)}>Back to Home</button>
              <button className="pp-btn pp-btn--ghost" onClick={() => resetForm(true)}>Submit Another</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-card pp-card--form">
        <Stepper step={step} totalSteps={2} />

        <div className="pp-form-content" style={{ position: "relative" }}>
          {/* STEP 1: Who + What (merged) */}
          {step === 1 && (
            <>
              <h3 className="pp-card-title">Who&apos;s this about?</h3>
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

              <div style={{ borderTop: "1px solid #e2e8f0", marginTop: 24, paddingTop: 20 }}>
                <label className="pp-label">What needs to happen?</label>
                <select className={`pp-select${errors.actionType ? " pp-input-error" : ""}`} value={form.actionType} onChange={(e) => update("actionType", e.target.value)}>
                  <option value="">Select an action...</option>
                  {["HR Actions", "Payroll", "Expenses", "IT & Equipment"].map((cat) => groups[cat] && (
                    <optgroup key={cat} label={cat}>
                      {groups[cat].map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* STEP 2: Dynamic action details */}
          {step === 2 && (
            <>
              <h3 className="pp-card-title">Fill in the details.</h3>
              <p className="pp-card-desc" style={{ marginTop: -8, marginBottom: 20 }}>
                {form.actionType === "separation" ? "Offboarding" :
                 form.actionType === "status_change" ? "Status update for" :
                 form.actionType === "reclassification" ? "Transferring" :
                 form.actionType === "rate_change" ? "Pay adjustment for" :
                 form.actionType === "pay_increase" ? `Pay increase recommendation for` :
                 form.actionType === "equipment_request" ? `Equipment request for` :
                 actionLabel + " for"} {form.employeeName}
              </p>
              <ActionDetails form={form} update={update} errors={errors} Formatter={Formatter} bootstrapData={bootstrapData} showTravelHelp={showTravelHelp} setShowTravelHelp={setShowTravelHelp} />

              {/* Hide generic notes for separation, status_change, pay_increase, and equipment_request (each renders its own labeled rationale) */}
              {!["separation", "status_change", "pay_increase", "equipment_request"].includes(form.actionType) && (
                <>
                  <label className="pp-label" style={{ marginTop: 24 }}>
                    {["title_change", "rate_change"].includes(form.actionType) ? "Reason for Change" :
                     form.actionType === "travel_reimbursement" ? "Business Purpose" :
                     form.actionType === "reclassification" ? "Reason for Transfer" :
                     "Notes / Explanation"}
                  </label>
                  <textarea
                    className={`pp-textarea${["title_change", "rate_change", "travel_reimbursement", "reclassification"].includes(form.actionType) && errors.explanation ? " pp-input-error" : ""}`}
                    value={form.explanation}
                    onChange={(e) => update("explanation", e.target.value)}
                    placeholder={
                      form.actionType === "title_change" ? "e.g. Promotion, lateral move, restructuring..." :
                      form.actionType === "rate_change" ? "e.g. Annual raise, merit increase, market adjustment..." :
                      form.actionType === "travel_reimbursement" ? "Describe business purpose and clients visited..." :
                      form.actionType === "reclassification" ? "e.g. Location consolidation, staffing need, employee request..." :
                      "Any additional context..."
                    }
                  />
                </>
              )}
</>
          )}
        </div>
        <div className="pp-form-footer">
          <button className="pp-btn pp-btn--ghost" onClick={handleBack}>Back</button>
          <button className="pp-btn pp-btn--primary" onClick={handleNext}>{step === 2 ? "Review" : "Next"}</button>
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
              {/* Fix #8: Full review rows for every action type */}
              {(() => {
                // Compute travel totals for review
                let travelTotal = null;
                let travelDays = 0;
                let travelSupplement = 0;
                let travelPerDiem = 0;
                if (form.actionType === "travel_reimbursement") {
                  const tiers = [
                    { key: "noMeals", rate: 80 }, { key: "bkfstProvided", rate: 65 },
                    { key: "lunchProvided", rate: 60 }, { key: "dinnerProvided", rate: 45 },
                    { key: "bkfstLunch", rate: 45 }, { key: "bkfstDinner", rate: 30 },
                    { key: "lunchDinner", rate: 25 }, { key: "allMeals", rate: 10 },
                  ];
                  const st = new Date(form.travelStartDate + "T00:00:00");
                  const en = new Date(form.travelEndDate + "T00:00:00");
                  travelDays = (st && en && en >= st) ? Math.round((en - st) / 86400000) + 1 : 0;
                  travelPerDiem = tiers.reduce((s, t) => s + (parseInt(form["perDiem_" + t.key]) || 0) * t.rate, 0);
                  travelSupplement = form.travelSupplementEnabled === "Yes" ? travelDays * 50 : 0;
                  travelTotal = travelPerDiem + travelSupplement;
                }

                const rows = [
                  // Universal
                  ["Employee", form.employeeName, 1],
                  ["Location", form.locationKey, 1],
                  ["Action", actionLabel, 1],
                  ["Effective", Formatter.toDate(form.effectiveDate), 1],

// Separation
                  form.actionType === "separation" && ["Type", form.actionGroup, 2],
                  form.actionType === "separation" && ["Reason", form.separationReason, 2],
                  form.actionType === "separation" && form.lastDayWorked && ["Last Day Worked", Formatter.toDate(form.lastDayWorked), 2],
                  form.actionType === "separation" && ["Rehire Eligible", form.rehireEligible, 2],
                                    // Status Change
                  form.actionType === "status_change" && ["Direction", form.statusChangeDirection, 2],

                  // Reclassification
                  form.actionType === "reclassification" && form.reclassFrom && ["From Account", form.reclassFrom, 2],
                  form.actionType === "reclassification" && form.reclassTo && ["To Account", form.reclassTo, 2],
                  form.actionType === "reclassification" && form.reclassTitleChange === "Yes" && form.oldTitle && ["Old Title", form.oldTitle, 2],
                  form.actionType === "reclassification" && form.reclassTitleChange === "Yes" && form.newTitle && ["New Title", form.newTitle, 2],
                  form.actionType === "reclassification" && form.reclassChangeRate === "Yes" && form.newRate && ["New Rate", Formatter.toMoney(form.newRate), 2],

                  // Title Change
                  form.actionType === "title_change" && form.oldTitle && ["Old Title", form.oldTitle, 2],
                  form.actionType === "title_change" && form.newTitle && ["New Title", form.newTitle, 2],
                  form.actionType === "title_change" && form.reclassChangeRate === "Yes" && form.newRate && ["New Rate", Formatter.toMoney(form.newRate), 2],

                  // Rate Change (historical only)
                  form.actionType === "rate_change" && form.oldRate && ["Old Rate", Formatter.toMoney(form.oldRate), 2],
                  form.actionType === "rate_change" && form.newRate && ["New Rate", Formatter.toMoney(form.newRate), 2],

                  // Pay Increase Recommendation
                  form.actionType === "pay_increase" && form.increaseType && ["Increase Type", form.increaseType, 2],
                  form.actionType === "pay_increase" && form.employeeLevel && ["Employee Level", form.employeeLevel === "leadership" ? "Leadership" : "Hourly", 2],
                  form.actionType === "pay_increase" && form.role && ["Role", form.role + (form.customRole ? ` (${form.customRole})` : ""), 2],
                  form.actionType === "pay_increase" && form.oldRate && ["Current " + (form.employeeLevel === "leadership" ? "Salary" : "Rate"), Formatter.toMoney(form.oldRate), 2],
                  form.actionType === "pay_increase" && form.newRate && ["Proposed " + (form.employeeLevel === "leadership" ? "Salary" : "Rate"), Formatter.toMoney(form.newRate), 2],
                  form.actionType === "pay_increase" && form.dollarIncrease && ["Increase", `${form.dollarIncrease} (${form.pctIncrease})`, 2],

                  // Equipment Request
                  form.actionType === "equipment_request" && form.equipmentRequestType && ["Request Type", form.equipmentRequestType === "new" ? "New Device" : "Replacement", 2],
                  form.actionType === "equipment_request" && form.equipmentRequestType === "replacement" && form.replacementReason && ["Reason", form.replacementReason, 2],
                  form.actionType === "equipment_request" && form.currentDeviceDetails && ["Current Device", form.currentDeviceDetails, 2],
                  form.actionType === "equipment_request" && form.equipmentShipTo && ["Ship To", form.equipmentShipTo, 2],

                  // Amount-based
                  ["add_bonus", "add_deduction", "add_gratuity", "other_reimbursement"].includes(form.actionType) && form.amount && ["Amount", Formatter.toMoney(form.amount), 2],

                  // Cell phone
                  form.actionType === "add_cell_phone" && ["Frequency", form.cellFrequency, 2],

                  // Travel
                  form.actionType === "travel_reimbursement" && form.travelStartDate && ["Travel Dates", Formatter.toDate(form.travelStartDate) + " → " + Formatter.toDate(form.travelEndDate), 2],
                  form.actionType === "travel_reimbursement" && travelDays > 0 && ["Duration", travelDays + " day" + (travelDays !== 1 ? "s" : ""), 2],
                  form.actionType === "travel_reimbursement" && travelSupplement > 0 && ["Supplement", Formatter.toMoney(travelSupplement) + " (taxable)", 2],
                  form.actionType === "travel_reimbursement" && travelPerDiem > 0 && ["Per Diem", Formatter.toMoney(travelPerDiem), 2],
                  form.actionType === "travel_reimbursement" && travelTotal > 0 && ["Grand Total", Formatter.toMoney(travelTotal), 2],

                  // Notes / Explanation
                  form.explanation && ["Notes", form.explanation, 2],
                ];

                return rows.filter(Boolean).map(([label, value, s], idx) => (
                  <div key={`${label}-${idx}`} className="pp-review-row">
                    <span className="pp-review-label">{label}</span>
                    <span className="pp-review-val">{value}</span>
                    <EditButton onClick={() => { setShowReview(false); setStep(s); }} />
                  </div>
                ));
              })()}
            </div>
            <div className="pp-modal-footer">
              <button className="pp-btn pp-btn--ghost" onClick={() => setShowReview(false)}>Go Back</button>
              <button className="pp-btn pp-btn--primary" onClick={handleSubmit} disabled={submitting} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {submitting ? (
                  <><span className="pp-btn-spinner" /> Sending...</>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    Confirm & Send
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
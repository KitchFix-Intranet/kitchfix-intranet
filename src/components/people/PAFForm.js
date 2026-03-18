"use client";
import { useState, useEffect, useCallback } from "react";
import { Stepper, CurrencyInput, EditButton } from "./shared";

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
  };
}

// Fix #12: Fields to reset when switching action types
const ACTION_SPECIFIC_FIELDS = {
  separation: ["actionGroup", "separationReason", "rehireEligible"],
  rate_change: ["oldRate", "newRate"],
  title_change: ["oldTitle", "newTitle", "reclassChangeRate"],
  status_change: ["statusChangeDirection"],
  reclassification: ["reclassFrom", "reclassTo", "reclassChangeRate", "reclassTitleChange", "oldTitle", "newTitle"],
  add_cell_phone: ["cellFrequency"],
  travel_reimbursement: ["travelStartDate", "travelEndDate", "travelSupplementEnabled", "perDiem_noMeals", "perDiem_bkfstProvided", "perDiem_lunchProvided", "perDiem_dinnerProvided", "perDiem_bkfstLunch", "perDiem_bkfstDinner", "perDiem_lunchDinner", "perDiem_allMeals"],
  add_bonus: ["amount"],
  add_deduction: ["amount"],
  add_gratuity: ["amount"],
  other_reimbursement: ["amount"],
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
        <label className="pp-label">Eligible for Rehire?</label>
        <div className="pp-pill-group">
          <button type="button" className={`pp-pill-option${form.rehireEligible === "Yes" ? " pp-pill-option--active" : ""}`} onClick={() => update("rehireEligible", "Yes")}>Yes</button>
          <button type="button" className={`pp-pill-option${form.rehireEligible === "No" ? " pp-pill-option--active" : ""}`} onClick={() => update("rehireEligible", "No")}>No</button>
        </div>
      </>
    );
  }

  if (type === "rate_change") {
    const oldNum = parseFloat(form.oldRate) || 0;
    const newNum = parseFloat(form.newRate) || 0;
    const hasBoth = oldNum > 0 && newNum > 0;
    const diff = newNum - oldNum;
    const pct = oldNum > 0 ? ((diff / oldNum) * 100).toFixed(1) : 0;
    const isRaise = diff > 0;

    return (
      <>
        <label className="pp-label">What are they making now?</label>
        <CurrencyInput value={form.oldRate} onChange={(v) => update("oldRate", v)} error={errors.oldRate} />
        <label className="pp-label">What will the new rate be?</label>
        <CurrencyInput value={form.newRate} onChange={(v) => update("newRate", v)} error={errors.newRate} />

        {hasBoth && diff !== 0 && (
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 700,
            background: isRaise ? "#ecfdf5" : "#fef2f2",
            color: isRaise ? "#059669" : "#dc2626",
            marginTop: 4,
          }}>
            {isRaise ? "↑" : "↓"} {isRaise ? "+" : ""}{Formatter.toMoney(diff)} ({isRaise ? "+" : ""}{pct}%)
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
      if (form.actionType === "rate_change") {
        if (!form.oldRate) errs.oldRate = true;
        if (!form.newRate) errs.newRate = true;
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
                  {["HR Actions", "Payroll", "Expenses"].map((cat) => groups[cat] && (
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
                 actionLabel + " for"} {form.employeeName}
              </p>
              <ActionDetails form={form} update={update} errors={errors} Formatter={Formatter} bootstrapData={bootstrapData} showTravelHelp={showTravelHelp} setShowTravelHelp={setShowTravelHelp} />

              {/* Hide generic notes for separation & status_change (reclass uses the shared one) */}
              {!["separation", "status_change"].includes(form.actionType) && (
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

                  // Rate Change
                  form.actionType === "rate_change" && form.oldRate && ["Old Rate", Formatter.toMoney(form.oldRate), 2],
                  form.actionType === "rate_change" && form.newRate && ["New Rate", Formatter.toMoney(form.newRate), 2],

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
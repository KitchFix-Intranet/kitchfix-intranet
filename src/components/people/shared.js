"use client";
import { useState } from "react";

/**
 * Stepper — configurable step indicator
 * @param {number} step - Current active step (1-indexed)
 * @param {number} totalSteps - Total number of steps (default: 3)
 */
export function Stepper({ step, totalSteps = 3 }) {
  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);
  return (
    <div className="pp-stepper">
      {steps.map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center" }}>
          <div className={`pp-step${s < step ? " pp-step--done" : s === step ? " pp-step--active" : ""}`}>
            {s < step ? "✓" : s}
          </div>
          {i < steps.length - 1 && <div className="pp-step-line" />}
        </div>
      ))}
    </div>
  );
}

/**
 * CurrencyInput — formats as USD on blur, raw number while editing
 */
export function CurrencyInput({ value, onChange, error, placeholder }) {
  const [focused, setFocused] = useState(false);
  const display = focused
    ? value
    : value ? Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";

  return (
    <input
      className={`pp-input${error ? " pp-input-error" : ""}`}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.]/g, "");
        const parts = raw.split(".");
        const clean = parts[0] + (parts.length > 1 ? "." + parts[1].slice(0, 2) : "");
        onChange(clean);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder || "$0.00"}
    />
  );
}

/**
 * EditButton — purple circle with pencil icon for review modals
 */
export function EditButton({ onClick }) {
  return (
    <button
      className="pp-btn-edit-circle"
      onClick={onClick}
      title="Edit"
      style={{
        width: 32, height: 32, borderRadius: "50%",
        background: "#f3e8ff", border: "1px solid #e9d5ff",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", flexShrink: 0,
        transition: "all 0.15s ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#7c3aed"; e.currentTarget.querySelector("svg").style.stroke = "white"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "#f3e8ff"; e.currentTarget.querySelector("svg").style.stroke = "#7c3aed"; }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.15s ease" }}>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    </button>
  );
}

/**
 * YesNoToggle — accessible pill toggle for binary choices
 */
export function YesNoToggle({ value, onChange }) {
  return (
    <div className="pp-yn-toggle">
      <button type="button" className={`pp-yn-option${value !== "Yes" ? " pp-yn-active-no" : ""}`} onClick={() => onChange("No")}>No</button>
      <button type="button" className={`pp-yn-option${value === "Yes" ? " pp-yn-active-yes" : ""}`} onClick={() => onChange("Yes")}>Yes</button>
    </div>
  );
}

/**
 * TechRow — labeled row with YesNo toggle (used for equipment questions)
 */
export function TechRow({ label, value, onChange }) {
  return (
    <div className="pp-tech-row">
      <span className="pp-tech-label">{label}</span>
      <YesNoToggle value={value} onChange={onChange} />
    </div>
  );
}
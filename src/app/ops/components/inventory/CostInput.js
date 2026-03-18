"use client";

export default function CostInput({ id, label, value, onChange, required, disabled, focused, onFocus, onBlur, inputRef, onEnter, prevValue, prevPeriod }) {
  return (
    <div className={`oh-input-row${focused ? " oh-row-active" : ""}`}>
      <div className="oh-input-label-row">
        <label className="oh-input-label">
          {label}{required && <span style={{ color: "#ef4444" }}> *</span>}
        </label>
        {prevValue > 0 && (
          <span className="oh-input-prev">
            {prevPeriod}: ${Math.round(prevValue).toLocaleString()}
          </span>
        )}
      </div>
<div className={`oh-input-box${value ? " oh-input-box--filled" : ""}${disabled ? " oh-input-box--locked" : ""}`}>
        {disabled && (!value || parseFloat(String(value).replace(/,/g, "")) === 0) ? (
          <span className="oh-cost-input oh-cost-input--empty">—</span>
        ) : (
          <>
            <span className="oh-prefix">$</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              className="oh-cost-input"
              placeholder="—"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={onFocus}
              onBlur={onBlur}
              onKeyDown={onEnter}
              disabled={disabled}
            />
            {value && !disabled && (
              <button className="oh-clear-btn" onClick={() => onChange("")} tabIndex={-1}>×</button>
            )}
          </>
        )}
      </div>
          </div>
  );
}
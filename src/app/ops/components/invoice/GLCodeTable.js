"use client";
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import ReactDOM from "react-dom";

const GL_USAGE_KEY = "kf_inv_gl_usage";
const MAX_FAVORITES = 5;

/**
 * GLCodeTable — Grouped GL Code Entry with custom searchable dropdown
 *
 * Props:
 *   glCodes   — Grouped format: [{ category, codes: [{ code, name }] }, ...]
 *   rows      — [{ code, amount }] current GL line items
 *   onChange  — (rows) => void
 *   hasError  — boolean
 *   disabled  — boolean
 */

// ─── Custom GL Code Picker ───────────────────────────────────────────────────
function GLCodePicker({ value, glCodes, codeLookup, favorites, allCodesFlat, disabled, onChange, onUsage, onAfterSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState({});
const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const selected = value ? codeLookup[value] : null;

  // Calculate fixed position from trigger bounding rect
  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 280) {
      setDropdownStyle({
        position: "fixed",
        left: rect.left,
        bottom: window.innerHeight - rect.top,
        width: rect.width,
        zIndex: 9999,
      });
    } else {
      setDropdownStyle({
        position: "fixed",
        left: rect.left,
        top: rect.bottom + 2,
        width: rect.width,
        zIndex: 9999,
      });
    }
  }, []);

// Close on outside click — must check both trigger AND portaled dropdown
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      const inTrigger = containerRef.current && containerRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inTrigger && !inDropdown) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [open]);

  // Recalculate position on scroll or resize while open
  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  // Focus search when opened
  useEffect(() => {
    if (open && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  // Filtered + grouped results
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null; // null = show full grouped list
    const results = allCodesFlat.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q)
    );
    return results.slice(0, 30);
  }, [search, allCodesFlat]);

  function handleSelect(code) {
    onChange(code);
    onUsage(code);
    setOpen(false);
    setSearch("");
    onAfterSelect?.(); // auto-focus the amount input for this row
  }

  function handleClear(e) {
    e.stopPropagation();
    onChange("");
    setSearch("");
  }

  return (
    <div
      className={`oh-inv-gl-picker${open ? " oh-inv-gl-picker--open" : ""}${disabled ? " oh-inv-gl-picker--disabled" : ""}`}
      ref={containerRef}
    >
      {/* Trigger button */}
      <button
        type="button"
        className={`oh-inv-gl-trigger${!value ? " oh-inv-gl-trigger--placeholder" : ""}`}
        onClick={() => { if (!disabled) setOpen((o) => !o); }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="oh-inv-gl-trigger-text">
          {selected
            ? <><span className="oh-inv-gl-code-tag">{value}</span>{selected.name}</>
            : "Select GL Code..."
          }
        </span>
        <span className="oh-inv-gl-trigger-icons">
          {value && !disabled && (
            <span
              className="oh-inv-gl-clear"
              onMouseDown={handleClear}
              title="Clear"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          )}
          <svg
            className={`oh-inv-gl-chevron${open ? " oh-inv-gl-chevron--open" : ""}`}
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {/* Dropdown panel — portaled to body to escape overflow clip */}
      {open && typeof document !== "undefined" && ReactDOM.createPortal(
<div className="oh-inv-gl-dropdown" ref={dropdownRef} style={dropdownStyle} role="listbox">
            {/* Search input */}
          <div className="oh-inv-gl-search-wrap">
            <svg className="oh-inv-gl-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              className="oh-inv-gl-search"
              placeholder="Search code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setSearch(""); }
                if (e.key === "Enter" && filtered?.length === 1) handleSelect(filtered[0].code);
              }}
            />
            {search && (
              <button className="oh-inv-gl-search-clear" onClick={() => setSearch("")} type="button">×</button>
            )}
          </div>

          {/* List */}
          <div className="oh-inv-gl-list" ref={listRef}>
            {filtered !== null ? (
              /* Search results — flat list */
              filtered.length === 0 ? (
                <div className="oh-inv-gl-empty">No codes match "{search}"</div>
              ) : (
                <div className="oh-inv-gl-group">
                  {filtered.map((item) => (
                    <GLOption
                      key={item.code}
                      item={item}
                      selected={value === item.code}
                      category={codeLookup[item.code]?.category}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              )
            ) : (
              /* Full grouped list */
              <>
                {/* Frequently Used */}
                {favorites.length > 0 && (
                  <div className="oh-inv-gl-group">
                    <div className="oh-inv-gl-group-label oh-inv-gl-group-label--fav">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#d97706" stroke="#d97706" strokeWidth="1">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      Frequently Used
                    </div>
                    {favorites.map((f) => (
                      <GLOption
                        key={`fav-${f.code}`}
                        item={f}
                        selected={value === f.code}
                        onSelect={handleSelect}
                      />
                    ))}
                    <div className="oh-inv-gl-divider" />
                  </div>
                )}

                {/* Grouped by category */}
                {glCodes.map((group) => (
                  <div key={group.category} className="oh-inv-gl-group">
                    <div className="oh-inv-gl-group-label">{group.category}</div>
                    {group.codes.map((item) => (
                      <GLOption
                        key={item.code}
                        item={item}
                        selected={value === item.code}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function GLOption({ item, selected, category, onSelect }) {
  return (
    <div
      className={`oh-inv-gl-option${selected ? " oh-inv-gl-option--selected" : ""}`}
      role="option"
      aria-selected={selected}
      onMouseDown={() => onSelect(item.code)}
    >
      <span className="oh-inv-gl-option-code">{item.code}</span>
      <span className="oh-inv-gl-option-name">{item.name}</span>
      {category && <span className="oh-inv-gl-option-cat">{category}</span>}
      {selected && (
        <svg className="oh-inv-gl-option-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );
}

// ─── Main GLCodeTable ─────────────────────────────────────────────────────────
export default function GLCodeTable({ glCodes = [], rows, onChange, hasError, disabled }) {
  const [glUsage, setGlUsage] = useState({});
  const amountRefs = useRef([]); // one ref per row — used to auto-focus after code selection

  // Load GL usage from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GL_USAGE_KEY);
      if (stored) setGlUsage(JSON.parse(stored));
    } catch {}
  }, []);

  // Build a flat lookup map: code → { name, category }
  const codeLookup = useMemo(() => {
    const map = {};
    for (const group of glCodes) {
      for (const item of group.codes) {
        map[item.code] = { name: item.name, category: group.category };
      }
    }
    return map;
  }, [glCodes]);

  // Flatten all codes
  const allCodesFlat = useMemo(() => {
    return glCodes.flatMap((g) => g.codes);
  }, [glCodes]);

  // Top N frequently used codes that exist in current account's code list
  const favorites = useMemo(() => {
    if (!allCodesFlat.length) return [];
    const validCodes = new Set(allCodesFlat.map((c) => c.code));
    return Object.entries(glUsage)
      .filter(([code]) => validCodes.has(code))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_FAVORITES)
      .map(([code]) => allCodesFlat.find((c) => c.code === code))
      .filter(Boolean);
  }, [glUsage, allCodesFlat]);

  // Track usage when a code is selected
  const trackUsage = useCallback((code) => {
    if (!code) return;
    const updated = { ...glUsage, [code]: (glUsage[code] || 0) + 1 };
    setGlUsage(updated);
    try { localStorage.setItem(GL_USAGE_KEY, JSON.stringify(updated)); } catch {}
  }, [glUsage]);

  // Row handlers
  function updateRowCode(idx, code) {
    const updated = rows.map((r, i) => (i === idx ? { ...r, code } : r));
    onChange(updated);
  }

  function updateRowAmount(idx, amount) {
    const updated = rows.map((r, i) => (i === idx ? { ...r, amount } : r));
    onChange(updated);
  }

  function removeRow(idx) {
    if (rows.length <= 1) {
      onChange([{ code: "", amount: "" }]);
      return;
    }
    onChange(rows.filter((_, i) => i !== idx));
  }

  function addRow() {
    onChange([...rows, { code: "", amount: "" }]);
  }

  return (
    <div className={`oh-inv-gl-table${hasError ? " oh-inv-error" : ""}`}>
      {rows.map((row, idx) => (
        <div key={idx} className="oh-inv-gl-row">
          {/* Custom searchable GL code picker */}
          <GLCodePicker
            value={row.code}
            glCodes={glCodes}
            codeLookup={codeLookup}
            favorites={favorites}
            allCodesFlat={allCodesFlat}
            disabled={disabled}
            onChange={(code) => updateRowCode(idx, code)}
            onUsage={trackUsage}
            onAfterSelect={() => {
              // Auto-focus the amount input for this row after code selection
              setTimeout(() => amountRefs.current[idx]?.focus(), 60);
            }}
          />

          <div className="oh-inv-gl-amount-wrap">
            <span className="oh-inv-gl-dollar">$</span>
            <input
              ref={(el) => { amountRefs.current[idx] = el; }}
              type="number"
              className="oh-inv-gl-amount"
              placeholder="0.00"
              value={row.amount}
              onChange={(e) => updateRowAmount(idx, e.target.value)}
              disabled={disabled}
              step="0.01"
              min="0"
            />
          </div>

          {rows.length > 1 && (
            <button
              type="button"
              className="oh-inv-gl-remove"
              onClick={() => removeRow(idx)}
              disabled={disabled}
              title="Remove row"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      ))}

      <button type="button" className="oh-inv-gl-add" onClick={addRow} disabled={disabled}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add GL Row
      </button>
    </div>
  );
}
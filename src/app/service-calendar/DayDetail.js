"use client";
import { useState, useEffect, useMemo, useCallback } from "react";

const GREEN = "#0F6E56";
const RED = "#dc2626";
const AMBER = "#EF9F27";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOWS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function fmt$(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
function fmtPrice(n) { return "$" + Number(n).toFixed(2).replace(/\.00$/, ""); }
function formatDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return `${DOWS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export default function DayDetail({ day, serviceGroups, overrides, onSave, onConfirmAsProjected, saving, dayIndex, totalDays, monthRevenue, onPrev, onNext, onClose }) {
  // Values: "" = untouched (ghost), "0" = explicitly zero, "123" = entered
  const [editValues, setEditValues] = useState({});
  const [touched, setTouched] = useState(new Set()); // track which inputs user has interacted with
  const [notes, setNotes] = useState("");
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [expandedExtras, setExpandedExtras] = useState(new Set());
  const [showReview, setShowReview] = useState(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const vals = {};
    const t = new Set();
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (day.actual[s.colIndex] != null) {
          // Day already has actuals saved — show them as real values
          vals[s.colIndex] = String(day.actual[s.colIndex]);
          t.add(s.colIndex);
        } else {
          vals[s.colIndex] = ""; // empty = ghost projection shown as placeholder
        }
      }
    }
    setEditValues(vals);
    setTouched(t);
    setNotes("");
    setExpandedGroups(new Set());
    setExpandedExtras(new Set());
    setShowReview(null);
    setJustSaved(false);
  }, [day.date, serviceGroups, day.actual]);

  const handleChange = useCallback((colIndex, value) => {
    const clean = value.replace(/[^0-9]/g, "");
    setEditValues(prev => ({ ...prev, [colIndex]: clean }));
    setTouched(prev => { const n = new Set(prev); n.add(colIndex); return n; });
  }, []);

  const toggleGroup = useCallback((name) => {
    setExpandedGroups(prev => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }, []);

  const toggleExtras = useCallback((name) => {
    setExpandedExtras(prev => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }, []);

  // "Actuals match projections" for a specific group
  const fillGroupWithProjections = useCallback((group) => {
    const newVals = { ...editValues };
    const newTouched = new Set(touched);
    for (const s of group.services) {
      newVals[s.colIndex] = String(day.projected[s.colIndex] ?? 0);
      newTouched.add(s.colIndex);
    }
    setEditValues(newVals);
    setTouched(newTouched);
  }, [editValues, touched, day.projected]);

  // Categorize groups
  const { activeGroups, inactiveGroups } = useMemo(() => {
    const active = [], inactive = [];
    for (const g of serviceGroups) {
      if (g.services.some(s => (day.projected[s.colIndex] ?? 0) > 0)) active.push(g);
      else inactive.push(g);
    }
    return { activeGroups: active, inactiveGroups: inactive };
  }, [serviceGroups, day.projected]);

  // Get effective value: if touched use editValues, else 0 (empty = 0 on save)
  const getVal = useCallback((colIndex) => {
    const v = editValues[colIndex];
    if (v === "" || v === undefined) return 0;
    return Number(v);
  }, [editValues]);

  const groupSummary = useCallback((group) => {
    let meals = 0, rev = 0;
    for (const s of group.services) { const v = getVal(s.colIndex); meals += v; rev += v * s.price; }
    return { meals, revenue: rev };
  }, [getVal]);

  const summary = useMemo(() => {
    let meals = 0, rev = 0;
    for (const g of serviceGroups) {
      for (const s of g.services) { const v = getVal(s.colIndex); meals += v; rev += v * s.price; }
    }
    return { meals, revenue: rev };
  }, [serviceGroups, getVal]);

  const hasTouchedAny = touched.size > 0;

  const executeSave = useCallback(() => {
    const entries = [];
    for (const g of serviceGroups) {
      for (const s of g.services) { entries.push({ colIndex: s.colIndex, value: getVal(s.colIndex) }); }
    }
    onSave(day, entries);
    setShowReview(null);
    setJustSaved(true);
  }, [serviceGroups, getVal, day, onSave]);

  const executeConfirmAll = useCallback(() => {
    // Fill all with projections then save
    const entries = [];
    for (const g of serviceGroups) {
      for (const s of g.services) { entries.push({ colIndex: s.colIndex, value: day.projected[s.colIndex] ?? 0 }); }
    }
    onSave(day, entries);
    setShowReview(null);
    setJustSaved(true);
  }, [serviceGroups, day, onSave]);

  const isOverdue = day.isPast && day.isLocked && !day.hasActuals;
  const status = day.hasActuals ? "entered" : isOverdue ? "overdue" : day.isPast ? "needs-entry" : "upcoming";
  const revPct = monthRevenue > 0 ? Math.round(summary.revenue / monthRevenue * 100) : 0;

  const coaching = {
    "needs-entry": { bg: "#fffbeb", border: "#fde68a", color: "#92400e", text: "Enter actual meal counts. Projections shown for reference." },
    "overdue": { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", text: "Past due — enter actual counts as soon as possible." },
    "upcoming": { bg: "#f9fafb", border: "#e5e7eb", color: "#6b7280", text: "Enter actual meal counts. Projections shown for reference." },
    "entered": { bg: "#E1F5EE", border: "#9FE1CB", color: "#085041", text: "Actuals recorded. Edit and re-save if needed." },
  }[status];

  function renderServiceRow(svc) {
    const projVal = day.projected[svc.colIndex] ?? 0;
    const editVal = editValues[svc.colIndex] ?? "";
    const isTouched = touched.has(svc.colIndex);
    const numVal = isTouched ? (editVal !== "" ? Number(editVal) : 0) : 0;
    const delta = isTouched ? numVal - projVal : null;

    return (
      <div key={svc.colIndex} className="sc-day-row">
<div className="sc-day-row-left">
          <span className="sc-day-row-name">{svc.name}</span>
<span className="sc-day-row-proj-label">Proj: {projVal} · {fmtPrice(svc.price)}</span>
        </div>
        <div className="sc-day-row-right">
          <input type="text" inputMode="numeric" pattern="[0-9]*"
            className={`sc-day-input ${isTouched ? "sc-day-input--touched" : "sc-day-input--ghost"}`}
            placeholder={String(projVal)}
            value={editVal}
            onChange={e => handleChange(svc.colIndex, e.target.value)} />
          {isTouched && delta !== null && (
            <span className={`sc-day-row-delta ${delta > 0 ? "sc-day-row-delta--pos" : delta < 0 ? "sc-day-row-delta--neg" : "sc-day-row-delta--match"}`}>
              {delta === 0 ? "✓" : (delta > 0 ? "+" : "") + delta}
            </span>
          )}
          {!isTouched && <span className="sc-day-row-delta" />}
        </div>
      </div>
    );
  }

  // ── Review overlay ──
  if (showReview) {
    const isConfirmAll = showReview === "confirm-all";
    return (
      <div className="sc-day sc-day--review">
        <div className="sc-day-review-inner">
          <div className="sc-day-review-header">
            <h3 className="sc-day-review-title">{isConfirmAll ? "Save all as projected?" : "Review before saving"}</h3>
            <p className="sc-day-review-date">{formatDate(day.date)}</p>
          </div>
          <div className="sc-day-review-body">
            {serviceGroups.map(group => {
              const svcs = group.services.filter(s => {
                if (isConfirmAll) return (day.projected[s.colIndex] ?? 0) > 0;
                return getVal(s.colIndex) > 0;
              });
              if (svcs.length === 0) return null;
              const gs = isConfirmAll
                ? { meals: svcs.reduce((s, sv) => s + (day.projected[sv.colIndex] ?? 0), 0), revenue: svcs.reduce((s, sv) => s + (day.projected[sv.colIndex] ?? 0) * sv.price, 0) }
                : groupSummary(group);
              return (
                <div key={group.name} className="sc-day-review-group">
                  <div className="sc-day-review-group-name">{group.name} · {fmtPrice(group.services[0]?.price || 0)}/plate</div>
                  {svcs.map(s => {
                    const val = isConfirmAll ? (day.projected[s.colIndex] ?? 0) : getVal(s.colIndex);
                    return <div key={s.colIndex} className="sc-day-review-row"><span>{s.name}</span><span className="sc-day-review-val">{val}</span></div>;
                  })}
                  <div className="sc-day-review-subtotal">{gs.meals} meals · {fmt$(gs.revenue)}</div>
                </div>
              );
            })}
          </div>
          <div className="sc-day-review-summary">
            <span className="sc-day-review-total-meals">{isConfirmAll ? serviceGroups.reduce((s, g) => s + g.services.reduce((ss, sv) => ss + (day.projected[sv.colIndex] ?? 0), 0), 0).toLocaleString() : summary.meals.toLocaleString()} meals</span>
            <span className="sc-day-review-total-rev">{isConfirmAll ? fmt$(serviceGroups.reduce((s, g) => s + g.services.reduce((ss, sv) => ss + (day.projected[sv.colIndex] ?? 0) * sv.price, 0), 0)) : fmt$(summary.revenue)}</span>
          </div>
          <div className="sc-day-review-actions">
            <button className="sc-btn sc-btn--outline" onClick={() => setShowReview(null)}>Go back</button>
            <button className="sc-btn sc-btn--primary" disabled={saving} onClick={isConfirmAll ? executeConfirmAll : executeSave}>
              {saving ? "Saving..." : "Confirm & save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Success state ──
  if (justSaved) {
    return (
      <div className="sc-day sc-day--success">
        <div className="sc-day-success-inner">
          <div className="sc-day-success-check">✓</div>
          <h3 className="sc-day-success-title">Saved!</h3>
          <p className="sc-day-success-detail">{formatDate(day.date)} · {summary.meals.toLocaleString()} meals · {fmt$(summary.revenue)}</p>
          <div className="sc-day-success-actions">
            {onNext && <button className="sc-btn sc-btn--primary" onClick={onNext}>Next day →</button>}
            <button className="sc-btn sc-btn--outline" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sc-day">
      <div className="sc-day-header">
        <h3 className="sc-day-title">{formatDate(day.date)}</h3>
        <div className="sc-day-nav">
          {onPrev && <button className="sc-day-nav-btn" onClick={onPrev}>&#8249;</button>}
          <span className="sc-day-nav-label">{dayIndex + 1} of {totalDays}</span>
          {onNext && <button className="sc-day-nav-btn" onClick={onNext}>&#8250;</button>}
          <button className="sc-day-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      </div>

      {coaching && (
        <div className="sc-day-coaching" style={{ background: coaching.bg, borderColor: coaching.border, color: coaching.color }}>
          {coaching.text}
        </div>
      )}

      <div className="sc-day-body">
        {activeGroups.map(group => {
          const activeSvcs = group.services.filter(s => (day.projected[s.colIndex] ?? 0) > 0);
          const inactiveSvcs = group.services.filter(s => (day.projected[s.colIndex] ?? 0) === 0);
          const gs = groupSummary(group);
          const extrasOpen = expandedExtras.has(group.name);
          const groupTouched = group.services.some(s => touched.has(s.colIndex));

          return (
            <div key={group.name} className="sc-day-group">
              <div className="sc-day-group-header">
                <span className="sc-day-group-name">{group.name}</span>
<span className="sc-day-group-price">{fmtPrice(group.services[0]?.price || 0)}</span>
              </div>

              {activeSvcs.map(svc => renderServiceRow(svc))}

              {/* Per-group "actuals match" button */}
              {!groupTouched && activeSvcs.length > 0 && (
                <button className="sc-day-match-btn" onClick={() => fillGroupWithProjections(group)}>
                  Actuals match projections
                </button>
              )}

              {inactiveSvcs.length > 0 && !extrasOpen && (
                <div className="sc-day-extras-btn" onClick={() => toggleExtras(group.name)}>
                  <span className="sc-day-extras-btn-icon">+</span>
                  <span>{inactiveSvcs.length} more services (no projection)</span>
                </div>
              )}
              {extrasOpen && inactiveSvcs.map(svc => renderServiceRow(svc))}
              {extrasOpen && <button className="sc-day-extras-hide" onClick={() => toggleExtras(group.name)}>Hide extras</button>}

              {gs.meals > 0 && <div className="sc-day-group-subtotal">{gs.meals.toLocaleString()} meals · {fmt$(gs.revenue)}</div>}
            </div>
          );
        })}

        {inactiveGroups.map(group => {
          const isOpen = expandedGroups.has(group.name);
          const gs = groupSummary(group);
          return (
            <div key={group.name}>
              <button className="sc-day-collapsed-btn" onClick={() => toggleGroup(group.name)}>
                <span>{group.name} — off today ({group.services.length} services)</span>
                <span className="sc-day-collapsed-icon">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div className="sc-day-group sc-day-group--expanded">
                  <div className="sc-day-group-header">
                    <span className="sc-day-group-name">{group.name}</span>
                    <span className="sc-day-group-price">{fmtPrice(group.services[0]?.price || 0)}/plate</span>
                  </div>
                  {group.services.map(svc => renderServiceRow(svc))}
                  {gs.meals > 0 && <div className="sc-day-group-subtotal">{gs.meals.toLocaleString()} meals · {fmt$(gs.revenue)}</div>}
                </div>
              )}
            </div>
          );
        })}

        <div className="sc-day-notes">
          <textarea className="sc-day-notes-input" placeholder="Day notes — rain delay, added dinner, etc."
            value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        </div>
      </div>

      <div className="sc-day-footer">
        <div className="sc-day-totals">
          <div>
            <span className="sc-day-total-meals">{summary.meals.toLocaleString()} meals</span>
            {revPct > 0 && <span className="sc-day-total-pct"> · {revPct}% of month</span>}
          </div>
          <span className="sc-day-total-rev">{fmt$(summary.revenue)}</span>
        </div>
<div className="sc-day-actions">
          {!day.hasActuals && (
            <button className="sc-btn sc-btn--outline" disabled={saving} onClick={() => setShowReview("confirm-all")}>
              All match projections
            </button>
          )}
          <button className="sc-btn sc-btn--primary" disabled={!hasTouchedAny || saving} onClick={() => setShowReview("save")}>
            Save actuals
          </button>
          <button className="sc-btn sc-btn--cancel" onClick={onClose}>Cancel</button>
        </div>
              </div>
    </div>
  );
}
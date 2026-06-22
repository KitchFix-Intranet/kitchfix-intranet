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

// In-service predicate: a (service, day) pair is in service iff the service
// has no archive date OR the day is on or before its archive date. Mirrors
// the sc_daily_revenue view's catalog JOIN (sc-6b) exactly. Used to gate
// data entry in DayDetail - services archived strictly after day.date
// render as a read-only "Archived" chip instead of an editable input. The
// view already drops those day rows; this stops the UI from offering
// entry where the view will never surface a result. Pure YYYY-MM-DD
// string compare; both inputs are already in that form (day.date from
// loadMonthData, activeUntil from sc_services.active_until DATE).
function isInServiceOnDay(svc, dayDate) {
  if (!svc.activeUntil) return true;
  return dayDate <= String(svc.activeUntil).slice(0, 10);
}

export default function DayDetail({ day, serviceGroups, overrides, onSave, onConfirmAsProjected, saving, dayIndex, totalDays, monthRevenue, accountName, onPrev, onNext, onClose, isFeeAccount, homestandContext }) {
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
        // Skip services archived as of day.date - they should not appear as
        // touched/initial-value entries. The view will not surface them
        // either, so any value the operator typed would be a silent orphan.
        if (!isInServiceOnDay(s, day.date)) continue;
        if (day.actual[s.colIndex] != null) {
          // Day already has actuals saved - show them as real values
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

  // "Actuals match projections" for a specific group. Skips services
  // archived as of day.date so the helper cannot retroactively populate
  // a day for a service the view will not surface.
  const fillGroupWithProjections = useCallback((group) => {
    const newVals = { ...editValues };
    const newTouched = new Set(touched);
    for (const s of group.services) {
      if (!isInServiceOnDay(s, day.date)) continue;
      newVals[s.colIndex] = String(day.projected[s.colIndex] ?? 0);
      newTouched.add(s.colIndex);
    }
    setEditValues(newVals);
    setTouched(newTouched);
  }, [editValues, touched, day.projected, day.date]);

  // Categorize groups. A group is "active" if EITHER a projection OR an
  // actual on any of its services is non-zero. The actual check matters
  // for days like a PDC Battery Camp Sunday where projections are all
  // zero but the operator served flat-fee items (Coffee Service, Pre-Game
  // Snack). Without it the popup would label such groups "off today"
  // while the green banner says "Actuals recorded" - the contradiction
  // that surfaced this bug.
  const { activeGroups, inactiveGroups } = useMemo(() => {
    const active = [], inactive = [];
    for (const g of serviceGroups) {
      const hasAnyValue = g.services.some(s =>
        (day.projected[s.colIndex] ?? 0) > 0 ||
        (day.hasActuals && (day.actual[s.colIndex] ?? 0) > 0)
      );
      if (hasAnyValue) active.push(g);
      else inactive.push(g);
    }
    return { activeGroups: active, inactiveGroups: inactive };
  }, [serviceGroups, day.projected, day.actual, day.hasActuals]);

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

  // Footer total is display-only: shows projected for untouched services
  // and entered for touched ones, so the operator always sees a real
  // running total instead of "0 meals" before the first keystroke. Save
  // path still uses getVal/summary - this calc never reaches the wire.
  const footerDisplay = useMemo(() => {
    let meals = 0, rev = 0;
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        const v = touched.has(s.colIndex) ? getVal(s.colIndex) : (day.projected[s.colIndex] ?? 0);
        meals += v;
        rev += v * s.price;
      }
    }
    return { meals, revenue: rev };
  }, [serviceGroups, touched, getVal, day.projected, day.date]);
  const footerLabel = hasTouchedAny ? "Total" : "Projected";

  const executeSave = useCallback(async () => {
    // P0-1: ONLY send touched services. Untouched services are preserved
    // by the orchestrator (no row written = existing PG row left alone).
    // Saving with no touched fields is a no-op; the Save button is already
    // disabled in that case via hasTouchedAny.
    // Bundle 2 guard: skip services archived as of day.date even if
    // somehow flagged touched (defense in depth - the in-service helpers
    // above never mark them touched, but this keeps the wire payload
    // honest if a future code path tries).
    const entries = [];
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        if (touched.has(s.colIndex)) {
          entries.push({ colIndex: s.colIndex, value: getVal(s.colIndex) });
        }
      }
    }
    if (entries.length === 0) {
      setShowReview(null);
      return;
    }
    // P0-2: await the save before showing the success screen. If the
    // request fails (toast shown by handleSave), keep the review modal
    // open so the chef can retry without losing what they typed.
    const result = await onSave(day, entries);
    if (result?.success) {
      setShowReview(null);
      setJustSaved(true);
    }
  }, [serviceGroups, touched, getVal, day, onSave]);

  const executeConfirmAll = useCallback(async () => {
    // User explicitly chose "All match projections" - intent is to apply
    // the projection value to every service. Send every service, including
    // those with projection=0 (records "no service occurred" intentionally).
    // Bundle 2 guard: skip services archived as of day.date.
    const entries = [];
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        entries.push({ colIndex: s.colIndex, value: day.projected[s.colIndex] ?? 0 });
      }
    }
    // P0-2: same await + success-gate as executeSave.
    const result = await onSave(day, entries);
    if (result?.success) {
      setShowReview(null);
      setJustSaved(true);
    }
  }, [serviceGroups, day, onSave]);

  const isOverdue = day.isPast && day.isLocked && !day.hasActuals;
  const status = day.hasActuals ? "entered" : isOverdue ? "overdue" : day.isPast ? "needs-entry" : "upcoming";
  const revPct = monthRevenue > 0 ? Math.round(footerDisplay.revenue / monthRevenue * 100) : 0;

  // Coaching banner: fee accounts reframe around delivery + homestand
  // context. Game days vs prep days get different language; revenue
  // urgency is dropped (billing isn't per-meal for these accounts).
  const isPrepDay = isFeeAccount && homestandContext && homestandContext.dayType !== "GAME";
  const isGameDay = isFeeAccount && homestandContext?.dayType === "GAME";
  const coaching = isFeeAccount
    ? (
        isPrepDay
          ? { bg: "#f9fafb", border: "#e5e7eb", color: "#6b7280", text: `${homestandContext.dayType} day - enter counts if meals were served.` }
          : isGameDay && status === "entered"
            ? { bg: "#E1F5EE", border: "#9FE1CB", color: "#085041", text: "Delivery logged. Edit and re-save if needed." }
            : isGameDay && status === "needs-entry"
              ? { bg: "#fffbeb", border: "#fde68a", color: "#92400e", text: "Game day - enter meal counts." }
              : isGameDay && status === "overdue"
                ? { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", text: "Past due game day - enter meal counts now." }
                : isGameDay
                  ? { bg: "#f9fafb", border: "#e5e7eb", color: "#6b7280", text: "Upcoming game day. Projections shown for reference." }
                  : { bg: "#f9fafb", border: "#e5e7eb", color: "#6b7280", text: "Enter meal counts if any were served." }
      )
    : {
        "needs-entry": { bg: "#fffbeb", border: "#fde68a", color: "#92400e", text: "Enter actual meal counts. Projections shown for reference." },
        "overdue": { bg: "#fef2f2", border: "#fecaca", color: "#dc2626", text: "Past due - enter actual counts as soon as possible." },
        "upcoming": { bg: "#f9fafb", border: "#e5e7eb", color: "#6b7280", text: "Enter actual meal counts. Projections shown for reference." },
        "entered": { bg: "#E1F5EE", border: "#9FE1CB", color: "#085041", text: "Actuals recorded. Edit and re-save if needed." },
      }[status];

  function renderServiceRow(svc) {
    const projVal = day.projected[svc.colIndex] ?? 0;
    const editVal = editValues[svc.colIndex] ?? "";
    const isTouched = touched.has(svc.colIndex);
    const numVal = isTouched ? (editVal !== "" ? Number(editVal) : 0) : 0;
    const delta = isTouched ? numVal - projVal : null;
    // Bundle 2: services archived as of day.date render a read-only chip
    // instead of an editable input. Same visible-but-marked discipline as
    // the admin side (archived = visible, archived = unenterable).
    const inService = isInServiceOnDay(svc, day.date);
    const archiveDate = !inService ? String(svc.activeUntil).slice(0, 10) : null;

    return (
      <div key={svc.colIndex} className={`sc-day-row${!inService ? " sc-day-row--archived" : ""}`}>
<div className="sc-day-row-left">
          <span className="sc-day-row-name">{svc.name}</span>
          {/* Fee accounts: drop the $X/plate label - svc.price is $0 here. */}
<span className="sc-day-row-proj-label">Projected: {projVal}{isFeeAccount ? "" : ` · ${fmtPrice(svc.price)}`}</span>
        </div>
        <div className="sc-day-row-right">
          {inService ? (
            <>
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
            </>
          ) : (
            <span className="sc-day-row-archived-chip" title={`Archived as of ${archiveDate}`}>
              Archived {archiveDate}
            </span>
          )}
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
              // P0-1 review surface: regular save shows ONLY services the
              // chef touched (intentional 0 included). Confirm-all keeps the
              // "services with projections > 0" filter since that's the
              // intent of that flow.
              const svcs = group.services.filter(s => {
                if (isConfirmAll) return (day.projected[s.colIndex] ?? 0) > 0;
                return touched.has(s.colIndex);
              });
              if (svcs.length === 0) return null;
              const gs = isConfirmAll
                ? { meals: svcs.reduce((s, sv) => s + (day.projected[sv.colIndex] ?? 0), 0), revenue: svcs.reduce((s, sv) => s + (day.projected[sv.colIndex] ?? 0) * sv.price, 0) }
                : { meals: svcs.reduce((acc, sv) => acc + getVal(sv.colIndex), 0), revenue: svcs.reduce((acc, sv) => acc + getVal(sv.colIndex) * sv.price, 0) };
              return (
                <div key={group.name} className="sc-day-review-group">
                  <div className="sc-day-review-group-name">{group.name}{!isFeeAccount && ` · ${fmtPrice(group.services[0]?.price || 0)}/plate`}</div>
                  {svcs.map(s => {
                    const val = isConfirmAll ? (day.projected[s.colIndex] ?? 0) : getVal(s.colIndex);
                    return <div key={s.colIndex} className="sc-day-review-row"><span>{s.name}</span><span className="sc-day-review-val">{val}</span></div>;
                  })}
                  <div className="sc-day-review-subtotal">{gs.meals} meals{isFeeAccount ? "" : ` · ${fmt$(gs.revenue)}`}</div>
                </div>
              );
            })}
          </div>
          <div className="sc-day-review-summary">
            <span className="sc-day-review-total-meals">{isConfirmAll ? serviceGroups.reduce((s, g) => s + g.services.reduce((ss, sv) => ss + (day.projected[sv.colIndex] ?? 0), 0), 0).toLocaleString() : summary.meals.toLocaleString()} meals</span>
            {!isFeeAccount && <span className="sc-day-review-total-rev">{isConfirmAll ? fmt$(serviceGroups.reduce((s, g) => s + g.services.reduce((ss, sv) => ss + (day.projected[sv.colIndex] ?? 0) * sv.price, 0), 0)) : fmt$(summary.revenue)}</span>}
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
          <p className="sc-day-success-detail">{formatDate(day.date)} · {summary.meals.toLocaleString()} meals{isFeeAccount ? "" : ` · ${fmt$(summary.revenue)}`}</p>
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
        <div className="sc-day-header-titles">
          <h3 className="sc-day-title">{formatDate(day.date)}</h3>
          {accountName && <div className="sc-day-account">{accountName}</div>}
        </div>
        <div className="sc-day-nav">
          {onPrev && <button className="sc-day-nav-btn" onClick={onPrev}>&#8249;</button>}
          <span className="sc-day-nav-label">Day {dayIndex + 1} of {totalDays}</span>
          {onNext && <button className="sc-day-nav-btn" onClick={onNext}>&#8250;</button>}
          <button className="sc-day-close" onClick={onClose} aria-label="Close">
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
          // Per-service active/inactive split must consider actuals, not just
          // projections - same actuals-first-class rule applied to the group
          // categorization above. Without this, days like Jan 4 Battery Camp
          // (Pre-Game Snack/Coffee/Fountain Bev actuals with zero projection)
          // collapse the served-services behind the "+ N more services"
          // expander, leaving the active group header rendering empty.
          const hasValue = (s) =>
            (day.projected[s.colIndex] ?? 0) > 0 ||
            (day.hasActuals && (day.actual[s.colIndex] ?? 0) > 0);
          const activeSvcs = group.services.filter(hasValue);
          const inactiveSvcs = group.services.filter((s) => !hasValue(s));
          const gs = groupSummary(group);
          const extrasOpen = expandedExtras.has(group.name);
          const groupTouched = group.services.some(s => touched.has(s.colIndex));

          return (
            <div key={group.name} className="sc-day-group">
              <div className="sc-day-group-header">
                <span className="sc-day-group-name">{group.name}</span>
                {!isFeeAccount && <span className="sc-day-group-price">{fmtPrice(group.services[0]?.price || 0)}</span>}
              </div>

              {activeSvcs.map(svc => renderServiceRow(svc))}

              {/* Per-group "actuals match" button */}
              {!groupTouched && activeSvcs.length > 0 && (
                <button className="sc-day-match-btn" onClick={() => fillGroupWithProjections(group)}>
                  Match projections
                </button>
              )}

              {inactiveSvcs.length > 0 && !extrasOpen && (
                <button type="button" className="sc-day-extras-btn" onClick={() => toggleExtras(group.name)}>
                  <span className="sc-day-extras-btn-icon">+</span>
                  <span>{inactiveSvcs.length} more {inactiveSvcs.length === 1 ? "service" : "services"}</span>
                </button>
              )}
              {extrasOpen && inactiveSvcs.map(svc => renderServiceRow(svc))}
              {extrasOpen && (
                <button type="button" className="sc-day-extras-hide" onClick={() => toggleExtras(group.name)}>
                  <span className="sc-day-extras-btn-icon">−</span>
                  <span>Hide extras</span>
                </button>
              )}

              {gs.meals > 0 && <div className="sc-day-group-subtotal">{gs.meals.toLocaleString()} meals{isFeeAccount ? "" : ` · ${fmt$(gs.revenue)}`}</div>}
            </div>
          );
        })}

        {inactiveGroups.map(group => {
          const isOpen = expandedGroups.has(group.name);
          const gs = groupSummary(group);
          return (
            <div key={group.name}>
              <button className="sc-day-collapsed-btn" onClick={() => toggleGroup(group.name)}>
                <span>{group.name} - off today ({group.services.length} {group.services.length === 1 ? "service" : "services"})</span>
                <span className="sc-day-collapsed-icon">{isOpen ? "−" : "+"}</span>
              </button>
              {isOpen && (
                <div className="sc-day-group sc-day-group--expanded">
                  <div className="sc-day-group-header">
                    <span className="sc-day-group-name">{group.name}</span>
                    {!isFeeAccount && <span className="sc-day-group-price">{fmtPrice(group.services[0]?.price || 0)}/plate</span>}
                  </div>
                  {group.services.map(svc => renderServiceRow(svc))}
                  {gs.meals > 0 && <div className="sc-day-group-subtotal">{gs.meals.toLocaleString()} meals{isFeeAccount ? "" : ` · ${fmt$(gs.revenue)}`}</div>}
                </div>
              )}
            </div>
          );
        })}

        <div className="sc-day-notes">
          <label className="sc-day-notes-label">Day notes (optional)</label>
          <textarea className="sc-day-notes-input" placeholder="Rain delay, added dinner, etc."
            value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
        </div>
      </div>

      <div className="sc-day-footer">
        <div className={`sc-day-totals${hasTouchedAny ? "" : " sc-day-totals--projected"}`}>
          <div className="sc-day-totals-left">
            <span className="sc-day-total-label">{footerLabel}</span>
            <span className="sc-day-total-meals">{footerDisplay.meals.toLocaleString()} meals</span>
            {!isFeeAccount && revPct > 0 && <span className="sc-day-total-pct">{revPct}% of month</span>}
          </div>
          {!isFeeAccount && <span className="sc-day-total-rev">{fmt$(footerDisplay.revenue)}</span>}
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
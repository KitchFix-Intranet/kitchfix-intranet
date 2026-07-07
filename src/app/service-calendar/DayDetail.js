"use client";
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { X, ChevronLeft, ChevronRight } from "./Icons";

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

export default function DayDetail({ day, serviceGroups, overrides, onSave, onConfirmAsProjected, saving, dayIndex, totalDays, monthRevenue, accountName, onPrev, onNext, onNextException, onClose, isFeeAccount, homestandContext, scopeLabel = "month" }) {
  // PR-SC-Redesign Stage 3: `scopeLabel` lets the caller relabel the
  // "% of {scope}" readout. Legacy callers (the legacy month/period
  // views) don't pass it and default to "month" - the existing label
  // stays unchanged. The new Period workspace passes "period" and
  // sends the period's revenue as monthRevenue, so the readout reads
  // correctly as "% of period". Surgical, backward-compatible fix to
  // the audit-flagged monthRevenue trap (spec 11.3).
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

  const isOverdue = day.isPast && day.isLocked && !day.hasActuals;
  const status = day.hasActuals ? "entered" : isOverdue ? "overdue" : day.isPast ? "needs-entry" : "upcoming";

  // Entry flow refs + progress. Auto-focus the first un-entered ghost
  // input on open (and on each day-nav) so the operator can start typing
  // immediately. Enter/mobile-keypad "Next" advances field-to-field;
  // Enter on the last input focuses the primary footer button (natural
  // land-on-save). "N of M entered" progress in the sub-header covers
  // only in-service served services (projection > 0, in service on
  // day.date); off-today + archived are correctly excluded.
  const bodyRef = useRef(null);
  const primaryBtnRef = useRef(null);

  const { enteredCount, totalToEnter } = useMemo(() => {
    let entered = 0;
    let total = 0;
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        const proj = day.projected[s.colIndex] ?? 0;
        if (proj <= 0) continue;
        total++;
        if (touched.has(s.colIndex)) entered++;
      }
    }
    return { enteredCount: entered, totalToEnter: total };
  }, [serviceGroups, day.date, day.projected, touched]);

  // Auto-focus first ghost input on open + on day-nav.
  useEffect(() => {
    if (!bodyRef.current) return;
    const rafId = requestAnimationFrame(() => {
      const first = bodyRef.current?.querySelector(".sc-day-input--ghost");
      if (first && typeof first.focus === "function") first.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [day.date]);

  // enterKeyHint: "next" on all inputs, "done" on the last. Set via a
  // post-render pass so the "last" input tracks whatever the current
  // render + expanded-extras state produces without threading a
  // last-column-index prop through renderServiceRow.
  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    const inputs = bodyRef.current.querySelectorAll(".sc-day-input");
    inputs.forEach((el, i) => {
      el.setAttribute("enterkeyhint", i === inputs.length - 1 ? "done" : "next");
    });
  });

  // Body-level Enter → next input; last input's Enter blurs and focuses
  // the primary footer button (Save actuals). Delegation via bodyRef so
  // it stays a single handler regardless of how many inputs render.
  const handleBodyKeyDown = useCallback((e) => {
    if (e.key !== "Enter") return;
    const el = e.target;
    if (!el?.classList?.contains?.("sc-day-input")) return;
    e.preventDefault();
    if (!bodyRef.current) return;
    const inputs = Array.from(bodyRef.current.querySelectorAll(".sc-day-input"));
    const idx = inputs.indexOf(el);
    if (idx >= 0 && idx < inputs.length - 1) {
      inputs[idx + 1].focus({ preventScroll: true });
    } else {
      el.blur();
      primaryBtnRef.current?.focus({ preventScroll: true });
    }
  }, []);

  // Coaching banner: fee accounts reframe around delivery + homestand
  // context. Game days vs prep days get different language; revenue
  // urgency is dropped (billing isn't per-meal for these accounts).
  const isPrepDay = isFeeAccount && homestandContext && homestandContext.dayType !== "GAME";
  const isGameDay = isFeeAccount && homestandContext?.dayType === "GAME";
  const coaching = isFeeAccount
    ? (
        isPrepDay
          ? { tone: "neutral", text: `${homestandContext.dayType} day - enter counts if meals were served.` }
          : isGameDay && status === "entered"
            ? { tone: "entered", text: "Delivery logged. Edit and re-save if needed." }
            : isGameDay && status === "needs-entry"
              ? { tone: "needs", text: "Game day - enter meal counts." }
              : isGameDay && status === "overdue"
                ? { tone: "overdue", text: "Past due game day - enter meal counts now." }
                : isGameDay
                  ? { tone: "neutral", text: "Upcoming game day. Projections shown for reference." }
                  : { tone: "neutral", text: "Enter meal counts if any were served." }
      )
    : {
        "needs-entry": { tone: "needs",   text: "Enter actual meal counts. Projections shown for reference." },
        "overdue":     { tone: "overdue", text: "Past due - enter actual counts as soon as possible." },
        "upcoming":    { tone: "neutral", text: "Enter actual meal counts. Projections shown for reference." },
        "entered":     { tone: "entered", text: "Actuals recorded. Edit and re-save if needed." },
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
        </div>
        <div className="sc-day-row-right">
          {inService ? (
            <>
              <input type="text" inputMode="numeric" pattern="[0-9]*"
                className={`sc-day-input ${isTouched ? "sc-day-input--touched" : "sc-day-input--ghost"}`}
                placeholder={String(projVal)}
                value={editVal}
                onChange={e => handleChange(svc.colIndex, e.target.value)} />
              {isTouched && delta !== null && (() => {
                const mag = Math.abs(delta);
                // Matched rows drop the check - the green input already says
                // "entered + on plan". Only misses render an indicator. Amber
                // (--big) is a genuine outlier (~50% swing or abs>=15); everything
                // else is --minor (calm neutral) so amber stays rare + meaningful.
                if (mag === 0) return <span className="sc-day-row-delta" />;
                const isBig = mag >= Math.max(15, Math.round(projVal * 0.5));
                const cls = isBig ? "sc-day-row-delta--big" : "sc-day-row-delta--minor";
                return (
                  <span className={`sc-day-row-delta ${cls}`}>{(delta > 0 ? "+" : "") + delta}</span>
                );
              })()}
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
    const svcCount = serviceGroups.reduce((n, g) => n + g.services.filter(s => touched.has(s.colIndex)).length, 0);
    return (
      <div className="sc-day sc-day--review">
        <div className="sc-day-scoreboard sc-day-review-board">
          <div className="sc-day-sb-row1">
            <div className="sc-day-sb-ctx">
              <span className="sc-day-review-title2">Review before saving</span>
              <span className="sc-day-sb-account">{formatDate(day.date)}{accountName ? ` · ${accountName}` : ""}</span>
            </div>
            <button className="sc-day-review-back" onClick={() => setShowReview(null)}>‹ Go back</button>
          </div>
          <div className="sc-day-sb-line">
            <div className="sc-day-sb-fig">
              {!isFeeAccount && <span className="sc-day-sb-amount sc-day-sb-amount--recorded">{fmt$(summary.revenue)}</span>}
              <span className="sc-day-sb-meals">{summary.meals.toLocaleString()} meals</span>
            </div>
            <span className="sc-day-sb-status sc-day-sb-status--entry">{svcCount} {svcCount === 1 ? "service" : "services"}</span>
          </div>
        </div>
        <div className="sc-day-body">
          {serviceGroups.map(group => {
            // Review shows ONLY services the chef touched (intentional 0 included).
            const svcs = group.services.filter(s => touched.has(s.colIndex));
            if (svcs.length === 0) return null;
            const gs = {
              meals: svcs.reduce((acc, sv) => acc + getVal(sv.colIndex), 0),
              revenue: svcs.reduce((acc, sv) => acc + getVal(sv.colIndex) * sv.price, 0),
            };
            return (
              <div key={group.name} className="sc-day-group">
                <div className="sc-day-group-header">
                  <span className="sc-day-group-name">{group.name}</span>
                  {!isFeeAccount && <span className="sc-day-group-price">{fmtPrice(group.services[0]?.price || 0)} / meal</span>}
                </div>
                {svcs.map(s => (
                  <div key={s.colIndex} className="sc-day-row sc-day-review-row2">
                    <span className="sc-day-row-name">{s.name}</span>
                    <span className="sc-day-review-val2">{getVal(s.colIndex)}</span>
                  </div>
                ))}
                <div className="sc-day-group-subtotal">{gs.meals} meals{isFeeAccount ? "" : ` · ${fmt$(gs.revenue)}`}</div>
              </div>
            );
          })}
        </div>
        <div className="sc-day-footer">
          <div className="sc-day-actions">
            <button className="sc-btn sc-btn--outline" onClick={() => setShowReview(null)}>Go back</button>
            <button className="sc-btn sc-btn--primary" disabled={saving} onClick={executeSave}>
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
          <h3 className="sc-day-success-title">Recorded</h3>
          {isFeeAccount ? (
            <span className="sc-day-success-hero">{summary.meals.toLocaleString()} meals</span>
          ) : (
            <span className="sc-day-success-hero">{fmt$(summary.revenue)}</span>
          )}
          <p className="sc-day-success-sub">
            {isFeeAccount ? formatDate(day.date) : `${summary.meals.toLocaleString()} meals · ${formatDate(day.date)}`}
          </p>
          <div className="sc-day-success-actions">
            {onNextException ? (
              <button className="sc-btn sc-btn--primary" onClick={onNextException}>Next needing entry →</button>
            ) : (
              <span className="sc-day-success-caughtup">✓ All caught up</span>
            )}
            <button className="sc-btn sc-btn--outline" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sc-day">
      <div className="sc-day-scoreboard">
        <div className="sc-day-sb-row1">
          <div className="sc-day-sb-ctx">
            <h3 className="sc-day-sb-date" id="sc-day-detail-title">{formatDate(day.date)}</h3>
            {accountName && <span className="sc-day-sb-account">{accountName}</span>}
          </div>
          <div className="sc-day-sb-nav">
            {onPrev && (
              <button className="sc-day-nav-btn" onClick={onPrev} aria-label="Previous day">
                <ChevronLeft size="sm" />
              </button>
            )}
            <span className="sc-day-nav-label">{dayIndex + 1}/{totalDays}</span>
            {onNext && (
              <button className="sc-day-nav-btn" onClick={onNext} aria-label="Next day">
                <ChevronRight size="sm" />
              </button>
            )}
            <button className="sc-day-close" onClick={onClose} aria-label="Close">
              <X size="sm" />
            </button>
          </div>
        </div>
        <div className="sc-day-sb-line">
          <div className="sc-day-sb-fig">
            {!isFeeAccount && (
              <span className={`sc-day-sb-amount sc-day-sb-amount--${hasTouchedAny ? "recorded" : "projected"}`}>
                {fmt$(footerDisplay.revenue)}
              </span>
            )}
            <span className="sc-day-sb-meals">{footerDisplay.meals.toLocaleString()} meals</span>
          </div>
          {totalToEnter > 0 && (
            <span
              className={`sc-day-sb-status sc-day-sb-status--${enteredCount === totalToEnter ? "recorded" : "entry"}`}
              aria-live="polite"
            >
              {enteredCount === totalToEnter && <span aria-hidden="true">✓</span>}
              {enteredCount} of {totalToEnter} {enteredCount === totalToEnter ? "recorded" : "entered"}
            </span>
          )}
        </div>
      </div>

      {/* Coaching stays as a thin subtle line below the scoreboard so
         account-specific guidance (fee/homestand) survives. Kevin will
         eyeball whether to hide it on per-meal accounts (may be
         redundant with the scoreboard status there) in a follow-up. */}
      {coaching && (
        <div className="sc-day-coaching-line">{coaching.text}</div>
      )}

      <div className="sc-day-body" ref={bodyRef} onKeyDown={handleBodyKeyDown}>
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
                {!isFeeAccount && <span className="sc-day-group-price">{fmtPrice(group.services[0]?.price || 0)} / meal</span>}
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
        <div className="sc-day-actions">
          <button ref={primaryBtnRef} className="sc-btn sc-btn--primary" disabled={!hasTouchedAny || saving} onClick={() => setShowReview("save")}>
            Review &amp; save
          </button>
          <button className="sc-btn sc-btn--cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
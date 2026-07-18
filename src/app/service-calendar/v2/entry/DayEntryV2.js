"use client";

// SC v2 - DayEntryV2 (W7 PR 1/3, Phases 0-2).
//
// Two-pane day entry: scrolling service list on the left, live-bill
// rail on the right, ONE Confirm on the rail wired to the existing
// `onSave` write path. The separate Review screen is DELETED on the
// v2 path (v1 DayDetail keeps it).
//
// STANDING LAWS (see PR body):
// 1. Write path INTERNALS untouched. This component imports + calls
//    `onSave` / `onAddNote` verbatim. No mutation, no debounce, no
//    optimistic UI. Confirm is a deliberate write per §5 Option A.
// 2. ZERO new money math. Every memo (enteredTotals, dayProjection,
//    groupSummary, projectedGroupSummary) is byte-identical to the
//    v1 DayDetail memos - same inputs, same rounding, same rules.
// 3. Mount gate lives at the caller (ServiceCalendar): scV2 ON +
//    entry-v2 ON + !isFeeAccount. This component NEVER receives a
//    fee-account day.
// 4. Same host contract: props identical to DayDetail. forwardRef
//    exposes `requestClose()` for the parent's guarded-close.
//
// Reused display helpers imported verbatim from ../../DayDetail:
//   formatDate, formatEntryStamp, mergeActivity, groupNameCarriesSegment,
//   deltaChip, deriveUnit, renderRate, LEDGER_HEAD, isInServiceOnDay
// Reused money primitives: fmt$, round2 from season/format
// Reused status: isPastDate from dayResolvers
// Reused animation: useAnimatedNumber (W2-W4 F3 pattern)

import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { X, ChevronLeft, ChevronRight } from "../../Icons";
import { fmt$, round2 } from "../../season/format";
import { isPastDate } from "../../dayResolvers";
import {
  formatDate,
  formatEntryStamp,
  mergeActivity,
  groupNameCarriesSegment,
  deltaChip,
  deriveUnit,
  renderRate,
  LEDGER_HEAD,
  isInServiceOnDay,
} from "../../DayDetail";
import useAnimatedNumber from "../../useAnimatedNumber";
import "./dayEntryV2.css";

function DayEntryV2({
  day,
  serviceGroups,
  overrides,
  onSave,
  onAddNote,
  saving,
  dayIndex,
  totalDays,
  monthRevenue,
  accountName,
  accountSegment = "",
  onPrev,
  onNext,
  onNextException,
  onClose,
  isFeeAccount,           // always false at mount (mount gate); prop kept for parity
  homestandContext,
  scopeLabel = "period",
}, ref) {
  // ═══════════════════════════════════════════════════════════════
  // State - byte-identical to v1 DayDetail (see DayDetail.js:208-263).
  // Values: "" = untouched (ghost), "0" = explicit zero, "123" = entered
  // ═══════════════════════════════════════════════════════════════
  const [editValues, setEditValues] = useState({});
  const [initialValues, setInitialValues] = useState({});
  const [touched, setTouched] = useState(new Set());
  const [notes, setNotes] = useState("");
  const [noteEntries, setNoteEntries] = useState(day.noteEntries || []);
  const [historyEntries, setHistoryEntries] = useState(day.historyEntries || []);
  const [isPostingNote, setIsPostingNote] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [justSaved, setJustSaved] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showNoServiceConfirm, setShowNoServiceConfirm] = useState(false);
  const [standaloneDraft, setStandaloneDraft] = useState("");
  const keepEditingBtnRef = useRef(null);
  const nsCancelBtnRef = useRef(null);
  const standaloneInputRef = useRef(null);
  const rideNoteRef = useRef(null);
  const bodyRef = useRef(null);
  const primaryBtnRef = useRef(null);
  const successPrimaryBtnRef = useRef(null);
  const prevViewRef = useRef({ justSaved: false });

  // Day-nav re-seed - matches DayDetail.js:265-308 verbatim. Same source,
  // same predicates, same reset set.
  useEffect(() => {
    const vals = {};
    const t = new Set();
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        if (day.actual[s.colIndex] != null) {
          vals[s.colIndex] = String(day.actual[s.colIndex]);
          t.add(s.colIndex);
        } else {
          vals[s.colIndex] = "";
        }
      }
    }
    setEditValues(vals);
    setInitialValues(vals);
    setTouched(t);
    setNotes("");
    setNoteEntries(day.noteEntries || []);
    setHistoryEntries(day.historyEntries || []);
    setExpandedGroups(new Set());
    setJustSaved(false);
    setShowDiscardConfirm(false);
    setShowNoServiceConfirm(false);
    setStandaloneDraft("");
  }, [day.date, serviceGroups, day.actual, day.noteEntries, day.historyEntries]);

  // isDirty - matches DayDetail.js:316-335. Value comparison + note drafts.
  const isDirty = useMemo(() => {
    if (justSaved) return false;
    if ((notes || "").trim().length > 0) return true;
    if ((standaloneDraft || "").trim().length > 0) return true;
    for (const ci of Object.keys(editValues)) {
      if ((editValues[ci] ?? "") !== (initialValues[ci] ?? "")) return true;
    }
    return false;
  }, [justSaved, editValues, initialValues, notes, standaloneDraft]);

  // Imperative handle for parent's guarded close.
  useImperativeHandle(ref, () => ({
    requestClose: () => {
      if (!isDirty) return true;
      setShowDiscardConfirm(true);
      return false;
    },
  }), [isDirty]);

  const attemptClose = useCallback(() => {
    if (isDirty) setShowDiscardConfirm(true);
    else onClose();
  }, [isDirty, onClose]);

  // Focus the keep-editing button when the confirm opens.
  useEffect(() => {
    if (showDiscardConfirm) {
      const rafId = requestAnimationFrame(() => {
        keepEditingBtnRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [showDiscardConfirm]);

  // Focus the safe default (Cancel) when the no-service confirm opens.
  useEffect(() => {
    if (showNoServiceConfirm) {
      const rafId = requestAnimationFrame(() => {
        nsCancelBtnRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [showNoServiceConfirm]);

  const handleChange = useCallback((colIndex, value) => {
    const clean = value.replace(/[^0-9]/g, "");
    setEditValues(prev => ({ ...prev, [colIndex]: clean }));
    setTouched(prev => {
      const n = new Set(prev);
      if (clean === "" && day.actual[colIndex] == null) {
        n.delete(colIndex);
      } else {
        n.add(colIndex);
      }
      return n;
    });
  }, [day.actual]);

  const toggleGroup = useCallback((name) => {
    setExpandedGroups(prev => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  }, []);

  // executeMarkNoService - matches DayDetail.js:404-449. Local wrapper
  // over onSave (write path unchanged). ZERO reimplementation of the
  // save internals.
  const executeMarkNoService = useCallback(async () => {
    const entries = [];
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        entries.push({ colIndex: s.colIndex, value: 0 });
      }
    }
    if (entries.length === 0) {
      setShowNoServiceConfirm(false);
      return;
    }
    const trimmed = (notes || "").trim();
    const literal = "Service cancelled - marked no service";
    const auditNote = trimmed ? `${trimmed}\n${literal}` : literal;
    setShowNoServiceConfirm(false);
    const result = await onSave(day, entries, { noService: true, auditNote });
    if (result?.success) {
      if (result.queued) {
        const hasDraft = (notes || "").trim().length > 0;
        if (hasDraft) {
          setShowDiscardConfirm(true);
        } else {
          setNotes("");
          onClose?.();
        }
      } else {
        setJustSaved(true);
        setNotes("");
      }
    }
  }, [serviceGroups, day, notes, onSave, onClose]);

  // handleAddNote - matches DayDetail.js:458-479. Standalone Activity
  // composer post via onAddNote (write path unchanged).
  const handleAddNote = useCallback(async () => {
    const trimmed = (standaloneDraft || "").trim();
    if (!trimmed || isPostingNote) return;
    if (!onAddNote) return;
    setIsPostingNote(true);
    try {
      const res = await onAddNote(day, trimmed);
      if (res?.success && res.entry) {
        setNoteEntries((prev) => [res.entry, ...prev]);
        setStandaloneDraft("");
        requestAnimationFrame(() => {
          standaloneInputRef.current?.focus({ preventScroll: true });
        });
      }
    } finally {
      setIsPostingNote(false);
    }
  }, [standaloneDraft, day, onAddNote, isPostingNote]);

  // Focus on success mount.
  useEffect(() => {
    const prev = prevViewRef.current;
    const enteredSuccess = justSaved && !prev.justSaved;
    prevViewRef.current = { justSaved };
    if (!enteredSuccess) return;
    const rafId = requestAnimationFrame(() => {
      successPrimaryBtnRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [justSaved]);

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

  // getVal + memos - byte-identical to DayDetail (see DayDetail.js:549-662).
  const getVal = useCallback((colIndex) => {
    const v = editValues[colIndex];
    if (v === "" || v === undefined) return 0;
    return Number(v);
  }, [editValues]);

  const groupSummary = useCallback((group) => {
    let meals = 0, rev = 0;
    for (const s of group.services) {
      const v = getVal(s.colIndex);
      if (!s.isFlatFee) meals += v;
      if (!s.isNonRevenue) rev += round2(v * (day.priceAtDate?.[s.colIndex] ?? s.price ?? 0));
    }
    return { meals, revenue: rev };
  }, [getVal, day.priceAtDate]);

  const projectedGroupSummary = useCallback((group) => {
    let meals = 0, rev = 0;
    for (const s of group.services) {
      if (!isInServiceOnDay(s, day.date)) continue;
      const v = day.projected[s.colIndex] ?? 0;
      const price = day.priceAtDate?.[s.colIndex] ?? s.price ?? 0;
      if (!s.isFlatFee) meals += v;
      if (!s.isNonRevenue) rev += round2(v * price);
    }
    return { meals, revenue: rev };
  }, [day.projected, day.priceAtDate, day.date]);

  const summary = useMemo(() => {
    let meals = 0, rev = 0;
    for (const g of serviceGroups) {
      for (const s of g.services) {
        const v = getVal(s.colIndex);
        if (!s.isFlatFee) meals += v;
        if (!s.isNonRevenue) rev += round2(v * (day.priceAtDate?.[s.colIndex] ?? s.price ?? 0));
      }
    }
    return { meals, revenue: rev };
  }, [serviceGroups, getVal, day.priceAtDate]);

  const enteredTotals = useMemo(() => {
    let meals = 0, rev = 0;
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        if (!touched.has(s.colIndex)) continue;
        const editVal = editValues[s.colIndex];
        if (editVal === "" || editVal === undefined) continue;
        const v = Number(editVal);
        const price = day.priceAtDate?.[s.colIndex] ?? s.price ?? 0;
        if (!s.isFlatFee) meals += v;
        if (!s.isNonRevenue) rev += round2(v * price);
      }
    }
    return { meals, revenue: rev };
  }, [serviceGroups, touched, editValues, day.priceAtDate, day.date]);

  const dayProjection = useMemo(() => {
    let meals = 0, rev = 0;
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        const v = day.projected[s.colIndex] ?? 0;
        const price = day.priceAtDate?.[s.colIndex] ?? s.price ?? 0;
        if (!s.isFlatFee) meals += v;
        if (!s.isNonRevenue) rev += round2(v * price);
      }
    }
    return { meals, revenue: rev };
  }, [serviceGroups, day.projected, day.priceAtDate, day.date]);

  // Confirm handler = DayDetail.js:664-735 executeSave verbatim (minus
  // the setShowReview lines that no longer apply on the v2 path -
  // Review screen deleted).
  const executeConfirm = useCallback(async () => {
    const entries = [];
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        if (touched.has(s.colIndex)) {
          entries.push({ colIndex: s.colIndex, value: getVal(s.colIndex) });
        }
      }
    }
    if (entries.length === 0) return;
    const trimmedDraft = (notes || "").trim();
    const rideNote = trimmedDraft.length > 0 ? trimmedDraft : undefined;
    const result = await onSave(day, entries, { rideNote });
    if (result?.success) {
      if (result.queued) {
        setNotes("");
        onClose?.();
      } else if (result.noteFailed) {
        onClose?.();
      } else {
        setJustSaved(true);
        setNotes("");
      }
    }
  }, [serviceGroups, touched, getVal, day, onSave, onClose, notes]);

  // Status + coaching = DayDetail.js:741-835.
  const dayIsPast = isPastDate(day.date);
  const isOverdue = dayIsPast && day.isLocked && !day.hasActuals;
  const status = day.hasActuals ? "entered" : isOverdue ? "overdue" : dayIsPast ? "needs-entry" : "upcoming";

  // Progress counter for the rail meta.
  const { enteredCount, totalToEnter } = useMemo(() => {
    let entered = 0, total = 0;
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

  // Auto-focus first ghost input + enterkeyhint on last - DayDetail.js:771-790.
  useEffect(() => {
    if (!bodyRef.current) return;
    const rafId = requestAnimationFrame(() => {
      const first = bodyRef.current?.querySelector(".sc-day-input--ghost");
      if (first && typeof first.focus === "function") first.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [day.date]);

  useLayoutEffect(() => {
    if (!bodyRef.current) return;
    const inputs = bodyRef.current.querySelectorAll(".sc-day-input");
    inputs.forEach((el, i) => {
      el.setAttribute("enterkeyhint", i === inputs.length - 1 ? "done" : "next");
    });
  });

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

  // Coaching per-meal branch - DayDetail.js:829-835 (fee branch omitted
  // because DayEntryV2 never receives a fee-account day).
  const coaching = {
    "needs-entry": { tone: "needs",   text: "Enter actual meal counts. Projections shown for reference." },
    "overdue":     { tone: "overdue", text: "Past due - enter actual counts as soon as possible." },
    "upcoming":    { tone: "neutral", text: "Enter actual meal counts. Projections shown for reference." },
    "entered":     { tone: "entered", text: "Actuals recorded. Edit and re-save if needed." },
  }[status];

  // Group active/inactive - DayDetail.js:536-547.
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

  const hasTouchedAny = touched.size > 0;
  const combinedActivity = useMemo(
    () => mergeActivity(noteEntries, historyEntries),
    [noteEntries, historyEntries]
  );

  // Header nav - DayDetail day nav for prev/next.
  const showDayNav = onPrev || onNext;

  // Success state - after clean save, celebration screen.
  if (justSaved) {
    return (
      <div className="sc-v2-entry sc-v2-entry--success" role="status" aria-live="polite">
        <div className="sc-v2-entry-success-inner">
          <div className="sc-v2-entry-success-check">✓</div>
          <h3 className="sc-v2-entry-success-title">Recorded</h3>
          <span className="sc-v2-entry-success-hero">{fmt$(summary.revenue)}</span>
          <p className="sc-v2-entry-success-sub">
            {summary.meals.toLocaleString()} meals · {formatDate(day.date)}
          </p>
          <div className="sc-v2-entry-success-actions">
            {onNextException ? (
              <button ref={successPrimaryBtnRef} className="sc-btn sc-btn--primary" onClick={onNextException}>Next needing entry →</button>
            ) : (
              <span className="sc-v2-entry-success-caughtup">✓ All caught up</span>
            )}
            <button ref={onNextException ? undefined : successPrimaryBtnRef} className="sc-btn sc-btn--outline" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sc-v2-entry">
      {showDiscardConfirm && (
        <DiscardConfirm
          onKeepEditing={() => setShowDiscardConfirm(false)}
          onDiscard={() => { setShowDiscardConfirm(false); onClose(); }}
          keepEditingBtnRef={keepEditingBtnRef}
        />
      )}
      {showNoServiceConfirm && (
        <NoServiceConfirm
          onCancel={() => setShowNoServiceConfirm(false)}
          onConfirm={executeMarkNoService}
          cancelBtnRef={nsCancelBtnRef}
        />
      )}

      {/* ─── Header ─── */}
      <div className="sc-v2-entry-head">
        <div className="sc-v2-entry-head-brand">
          <h2 className="sc-v2-entry-title" id="sc-day-detail-title">{formatDate(day.date)}</h2>
          {accountName && (
            <span className="sc-v2-entry-account">
              {accountName}
              {accountSegment && ` · ${accountSegment}`}
            </span>
          )}
        </div>
        <div className="sc-v2-entry-head-nav">
          {showDayNav && (
            <div className="sc-v2-entry-nav">
              <button
                type="button"
                className="sc-v2-entry-nav-btn"
                onClick={onPrev}
                disabled={!onPrev}
                aria-label="Previous day"
              >
                <ChevronLeft size="sm" />
              </button>
              <span className="sc-v2-entry-nav-count">
                {dayIndex != null && totalDays ? `${dayIndex + 1} of ${totalDays}` : ""}
              </span>
              <button
                type="button"
                className="sc-v2-entry-nav-btn"
                onClick={onNext}
                disabled={!onNext}
                aria-label="Next day"
              >
                <ChevronRight size="sm" />
              </button>
            </div>
          )}
          <button
            type="button"
            className="sc-v2-entry-close"
            onClick={attemptClose}
            aria-label="Close"
          >
            <X size="sm" />
          </button>
        </div>
      </div>

      {/* ─── Coaching banner ─── */}
      {coaching && (
        <div className={`sc-v2-entry-coaching sc-v2-entry-coaching--${coaching.tone}`}>
          {coaching.text}
        </div>
      )}

      {/* ─── Two-pane workspace ─── */}
      <div className="sc-v2-entry-pane">
        {/* ─── Left: service list ─── */}
        <div
          ref={bodyRef}
          className="sc-v2-entry-list"
          onKeyDown={handleBodyKeyDown}
        >
          {activeGroups.map(group => (
            <GroupBlock
              key={group.name}
              group={group}
              day={day}
              editValues={editValues}
              touched={touched}
              accountSegment={accountSegment}
              onChange={handleChange}
              onFillProjections={fillGroupWithProjections}
              groupSummary={groupSummary}
              projectedGroupSummary={projectedGroupSummary}
              expanded={true}
            />
          ))}
          {inactiveGroups.length > 0 && (
            <details className="sc-v2-entry-inactive">
              <summary>Show {inactiveGroups.length} inactive {inactiveGroups.length === 1 ? "group" : "groups"}</summary>
              {inactiveGroups.map(group => (
                <GroupBlock
                  key={group.name}
                  group={group}
                  day={day}
                  editValues={editValues}
                  touched={touched}
                  accountSegment={accountSegment}
                  onChange={handleChange}
                  onFillProjections={fillGroupWithProjections}
                  groupSummary={groupSummary}
                  projectedGroupSummary={projectedGroupSummary}
                  expanded={false}
                />
              ))}
            </details>
          )}

          {/* Mark-no-service link */}
          {status !== "entered" && (
            <div className="sc-v2-entry-nsvc">
              <button
                type="button"
                className="sc-v2-entry-nsvc-btn"
                onClick={() => setShowNoServiceConfirm(true)}
              >
                Mark day as no service
              </button>
            </div>
          )}

          {/* Standalone Activity composer + ledger */}
          <ActivityBand
            entries={combinedActivity}
            draft={standaloneDraft}
            onDraftChange={setStandaloneDraft}
            onPost={handleAddNote}
            isPosting={isPostingNote}
            inputRef={standaloneInputRef}
          />
        </div>

        {/* ─── Right: live-bill rail ─── */}
        <aside className="sc-v2-entry-rail" aria-label="Forming invoice">
          <BillRail
            summary={summary}
            enteredTotals={enteredTotals}
            dayProjection={dayProjection}
            hasTouchedAny={hasTouchedAny}
            enteredCount={enteredCount}
            totalToEnter={totalToEnter}
            serviceGroups={activeGroups}
            day={day}
            editValues={editValues}
            touched={touched}
            groupSummary={groupSummary}
            projectedGroupSummary={projectedGroupSummary}
            notes={notes}
            onNotesChange={setNotes}
            noteRef={rideNoteRef}
            onConfirm={executeConfirm}
            confirmDisabled={!hasTouchedAny || saving}
            confirmLabel={saving ? "Saving..." : "Confirm & save"}
            confirmBtnRef={primaryBtnRef}
          />
        </aside>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// GroupBlock - one service group's rows.
// Renders per DayDetail.js:837-914 renderServiceRow (per-meal branch)
// with the same input/chip/rate/amount composition.
// ═════════════════════════════════════════════════════════════════
function GroupBlock({
  group, day, editValues, touched, accountSegment,
  onChange, onFillProjections,
  groupSummary, projectedGroupSummary,
  expanded,
}) {
  const gsEntered = groupSummary(group);
  const gsProjected = projectedGroupSummary(group);
  const hasProjectedRevenue = gsProjected.revenue > 0;

  return (
    <section className="sc-v2-entry-group" data-active={expanded ? "true" : "false"}>
      <header className="sc-v2-entry-group-header">
        <div className="sc-v2-entry-group-title">
          <span className="sc-v2-entry-group-name">{group.name}</span>
          {accountSegment && !groupNameCarriesSegment(group.name, accountSegment) && (
            <span className="sc-v2-entry-group-seg">{accountSegment}</span>
          )}
        </div>
        <div className="sc-v2-entry-group-actions">
          {hasProjectedRevenue && (
            <button
              type="button"
              className="sc-v2-entry-group-match"
              onClick={() => onFillProjections(group)}
            >
              Match projections
            </button>
          )}
        </div>
      </header>
      <div className="sc-day-ledger">
        {LEDGER_HEAD}
        {group.services.map(s => (
          <ServiceRow
            key={s.colIndex}
            svc={s}
            day={day}
            editValues={editValues}
            touched={touched}
            onChange={onChange}
          />
        ))}
      </div>
      <footer className="sc-v2-entry-group-subtotal">
        <span className="sc-v2-entry-group-subtotal-label">
          {gsEntered.meals.toLocaleString()} meals
        </span>
        <span className="sc-v2-entry-group-subtotal-amount">
          {fmt$(gsEntered.revenue)}
        </span>
      </footer>
    </section>
  );
}

// One service row - reuses the v1 CSS class names so the atom style
// inherits automatically. See DayDetail.js:837-914 for the shape.
function ServiceRow({ svc, day, editValues, touched, onChange }) {
  const projVal = day.projected[svc.colIndex] ?? 0;
  const editVal = editValues[svc.colIndex] ?? "";
  const isTouched = touched.has(svc.colIndex);
  const isEmpty = editVal === "";
  const inService = isInServiceOnDay(svc, day.date);
  const archiveDate = !inService ? String(svc.activeUntil).slice(0, 10) : null;

  let chip = null;
  if (inService && isTouched && !isEmpty) {
    chip = deltaChip(Number(editVal), projVal);
  }

  const qtyCell = inService ? (
    <div className="sc-day-row-right">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={svc.name}
        className={`sc-day-input ${isTouched && !isEmpty ? "sc-day-input--touched" : "sc-day-input--ghost"}`}
        placeholder={String(projVal)}
        value={editVal}
        onChange={e => onChange(svc.colIndex, e.target.value)}
      />
      {chip ? (
        <span className={`sc-day-row-delta ${chip.cls}`}>{chip.text}</span>
      ) : (
        <span className="sc-day-row-delta" />
      )}
    </div>
  ) : (
    <span className="sc-day-row-archived-chip" title={`Archived as of ${archiveDate}`}>
      Archived {archiveDate}
    </span>
  );

  const rate = day.priceAtDate?.[svc.colIndex] ?? svc.price ?? 0;
  const unit = deriveUnit(svc.name, svc.isFlatFee);
  const entered = inService && isTouched && !isEmpty;

  return (
    <div className={`sc-day-row sc-day-row--ledger${!inService ? " sc-day-row--archived" : ""}`}>
      <div className="sc-day-row-left">
        <span className="sc-day-row-name">{svc.name}</span>
      </div>
      <span className="sc-day-row-rate">{renderRate(svc, rate, unit)}</span>
      {qtyCell}
      <span className="sc-day-row-amount">
        {svc.isNonRevenue
          ? <span className="sc-day-amount-none" title="Not billed">—</span>
          : entered
            ? fmt$(Number(editVal) * rate)
            : inService
              ? <span className="sc-day-amount-ghost">~{fmt$(projVal * rate)}</span>
              : <span className="sc-day-amount-pending">–</span>}
      </span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// BillRail - the live forming-invoice rail (Phase 2).
// Consumes the SAME memos the workspace uses; ZERO new money math.
// Hero animates via useAnimatedNumber (W2-W4 F3 pattern).
// ═════════════════════════════════════════════════════════════════
function BillRail({
  summary, enteredTotals, dayProjection,
  hasTouchedAny, enteredCount, totalToEnter,
  serviceGroups, day, editValues, touched,
  groupSummary, projectedGroupSummary,
  notes, onNotesChange, noteRef,
  onConfirm, confirmDisabled, confirmLabel, confirmBtnRef,
}) {
  // Hero value: entered total (from touched services) when the operator
  // has touched something, otherwise the projected total. Matches
  // DayDetail's SC-072 "entered-only from first entry onward" rule.
  const heroValue = hasTouchedAny ? enteredTotals.revenue : dayProjection.revenue;
  const heroAnimated = useAnimatedNumber(heroValue);

  const pctComplete = totalToEnter > 0 ? Math.round((enteredCount / totalToEnter) * 100) : 0;

  return (
    <div className="sc-v2-entry-rail-shell">
      <div className="sc-v2-entry-rail-label">
        {hasTouchedAny ? "ENTERED" : "PROJECTED"}
      </div>
      <div className="sc-v2-entry-rail-hero">
        <span className="sc-v2-entry-rail-hero-value" aria-live="polite">
          {hasTouchedAny ? "" : "~"}{fmt$(heroAnimated)}
        </span>
        <span className="sc-v2-entry-rail-hero-meta">
          {summary.meals.toLocaleString()} meals · {enteredCount} of {totalToEnter} services entered
        </span>
      </div>

      <div className="sc-v2-entry-rail-progress" role="progressbar" aria-valuenow={pctComplete} aria-valuemin={0} aria-valuemax={100}>
        <div className="sc-v2-entry-rail-progress-fill" style={{ width: `${pctComplete}%` }} />
      </div>

      {/* Forming invoice - every in-service service as a line */}
      <div className="sc-v2-entry-rail-invoice">
        {serviceGroups.map(group => {
          const gsEntered = groupSummary(group);
          const gsProjected = projectedGroupSummary(group);
          const lines = group.services.filter(s => isInServiceOnDay(s, day.date));
          if (!lines.length) return null;
          return (
            <div key={group.name} className="sc-v2-entry-rail-group">
              <div className="sc-v2-entry-rail-group-name">{group.name}</div>
              {lines.map(s => (
                <BillLine
                  key={s.colIndex}
                  svc={s}
                  day={day}
                  editValues={editValues}
                  touched={touched}
                />
              ))}
              <div className="sc-v2-entry-rail-group-sub">
                <span>Subtotal</span>
                <span className="sc-v2-entry-rail-group-sub-amount">
                  {gsEntered.revenue > 0 ? fmt$(gsEntered.revenue) : (
                    <span className="sc-v2-entry-rail-line-ghost">~{fmt$(gsProjected.revenue)}</span>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Ride-along note */}
      <div className="sc-v2-entry-rail-note">
        <label htmlFor="sc-v2-entry-ride-note" className="sc-v2-entry-rail-note-label">
          Note riding this save
        </label>
        <textarea
          id="sc-v2-entry-ride-note"
          ref={noteRef}
          className="sc-v2-entry-rail-note-input"
          placeholder="Optional note - saves with the confirm"
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
          rows={2}
        />
      </div>

      {/* Confirm - ONE primary action */}
      <div className="sc-v2-entry-rail-footer">
        <button
          type="button"
          ref={confirmBtnRef}
          className="sc-v2-entry-rail-cta"
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

// One bill-line: entered solid or pending ghost.
function BillLine({ svc, day, editValues, touched }) {
  const rate = day.priceAtDate?.[svc.colIndex] ?? svc.price ?? 0;
  const editVal = editValues[svc.colIndex] ?? "";
  const isTouched = touched.has(svc.colIndex);
  const isEmpty = editVal === "";
  const entered = isTouched && !isEmpty;
  const projVal = day.projected[svc.colIndex] ?? 0;
  const displayVal = entered ? Number(editVal) : projVal;
  const displayAmt = round2(displayVal * rate);

  if (svc.isNonRevenue) {
    return (
      <div className="sc-v2-entry-rail-line sc-v2-entry-rail-line--nonrev">
        <span className="sc-v2-entry-rail-line-name">{svc.name}</span>
        <span className="sc-v2-entry-rail-line-count">{displayVal}</span>
        <span className="sc-v2-entry-rail-line-amount">—</span>
      </div>
    );
  }

  return (
    <div className={`sc-v2-entry-rail-line ${entered ? "sc-v2-entry-rail-line--solid" : "sc-v2-entry-rail-line--ghost"}`}>
      <span className="sc-v2-entry-rail-line-name">{svc.name}</span>
      <span className="sc-v2-entry-rail-line-count">{entered ? displayVal : `~${displayVal}`}</span>
      <span className="sc-v2-entry-rail-line-amount">
        {entered ? fmt$(displayAmt) : `~${fmt$(displayAmt)}`}
      </span>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ActivityBand - standalone note composer + merged ledger.
// ═════════════════════════════════════════════════════════════════
function ActivityBand({ entries, draft, onDraftChange, onPost, isPosting, inputRef }) {
  return (
    <section className="sc-v2-entry-activity" aria-label="Activity">
      <div className="sc-v2-entry-activity-composer">
        <input
          ref={inputRef}
          type="text"
          className="sc-v2-entry-activity-input"
          placeholder="Add a note..."
          value={draft}
          onChange={e => onDraftChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              onPost();
            }
          }}
          disabled={isPosting}
        />
        <button
          type="button"
          className="sc-v2-entry-activity-post"
          onClick={onPost}
          disabled={isPosting || !(draft || "").trim()}
        >
          {isPosting ? "..." : "Add note"}
        </button>
      </div>
      {entries.length > 0 && (
        <ul className="sc-v2-entry-activity-list">
          {entries.slice(0, 8).map((e, i) => (
            <li key={e.id || `${e.kind}-${i}`} className={`sc-v2-entry-activity-item sc-v2-entry-activity-item--${e.kind || "note"}`}>
              <span className="sc-v2-entry-activity-stamp">{formatEntryStamp(e.createdAt || e.ts || e.postedAt)}</span>
              {e.author && <span className="sc-v2-entry-activity-author">{e.author}</span>}
              <span className="sc-v2-entry-activity-body">{e.body || e.text || e.summary || ""}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ═════════════════════════════════════════════════════════════════
// DiscardConfirm / NoServiceConfirm - dialogs, same copy as v1.
// ═════════════════════════════════════════════════════════════════
function DiscardConfirm({ onKeepEditing, onDiscard, keepEditingBtnRef }) {
  return (
    <div className="sc-v2-entry-modal" role="alertdialog" aria-modal="true">
      <div className="sc-v2-entry-modal-inner">
        <h4 className="sc-v2-entry-modal-title">Unsaved changes</h4>
        <p className="sc-v2-entry-modal-body">You have unsaved counts or a note draft. Discard them?</p>
        <div className="sc-v2-entry-modal-actions">
          <button ref={keepEditingBtnRef} className="sc-btn sc-btn--primary" onClick={onKeepEditing}>Keep editing</button>
          <button className="sc-btn sc-btn--outline" onClick={onDiscard}>Discard</button>
        </div>
      </div>
    </div>
  );
}

function NoServiceConfirm({ onCancel, onConfirm, cancelBtnRef }) {
  return (
    <div className="sc-v2-entry-modal" role="alertdialog" aria-modal="true">
      <div className="sc-v2-entry-modal-inner">
        <h4 className="sc-v2-entry-modal-title">Mark as no service?</h4>
        <p className="sc-v2-entry-modal-body">Every in-service service records zero. An audit note is appended.</p>
        <div className="sc-v2-entry-modal-actions">
          <button ref={cancelBtnRef} className="sc-btn sc-btn--outline" onClick={onCancel}>Cancel</button>
          <button className="sc-btn sc-btn--primary" onClick={onConfirm}>Mark no service</button>
        </div>
      </div>
    </div>
  );
}

export default forwardRef(DayEntryV2);

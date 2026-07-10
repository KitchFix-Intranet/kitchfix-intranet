"use client";
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { X, ChevronLeft, ChevronRight } from "./Icons";
import { fmt$ } from "./season/format";
import { isPastDate } from "./dayResolvers";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOWS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function fmtPrice(n) { return "$" + Number(n).toFixed(2).replace(/\.00$/, ""); }
function formatDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return `${DOWS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
// SC-079: note-ledger timestamp format. Server returns ISO strings;
// render in the operator's local timezone with the "Jul 9 · 10:05 AM"
// shape the render pack specifies. Falls back to the raw string if the
// value can't be parsed.
function formatEntryStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const monthShort = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dateStr = `${monthShort[d.getMonth()]} ${d.getDate()}`;
  const timeStr = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dateStr} · ${timeStr}`;
}

// F1 (M2): merge NOTE ledger + actuals EDIT history into one
// chronological Activity feed (newest first) for the DayDetail M2
// rendering. Consecutive same-timestamp EDITs that ALL write 0 collapse
// into a single "Marked no service" system row - matches the mark-no-
// service flow's server-side signature (all in-service services set to
// 0 in the same batch). Anything else renders individually per row.
//
// noteEntries: [{ note, author, createdAt }]  (server order: newest first)
// historyEntries: [{ serviceId, serviceName, oldValue, newValue, author, changedAt }]
//   (server order: newest first)
//
// Return shape:
//   [{ type: "note"|"edit", timestamp, author, key, ...body }]
//   where body varies:
//     note      -> { note }
//     edit      -> { serviceName, oldValue, newValue }
//     edit sys  -> { systemPhrasing: true }  (all-zero batch)
function mergeActivity(noteEntries, historyEntries) {
  const rows = [];
  for (const n of (noteEntries || [])) {
    rows.push({
      type: "note",
      timestamp: n.createdAt,
      author: n.author,
      key: `n:${n.createdAt}`,
      note: n.note,
    });
  }
  // Bucket history by changedAt truncated to the second. The trigger
  // fires per-service inside one upsert, so within-batch rows share
  // changedAt to millisecond precision; the second-truncation gives a
  // little slop for ~1s network jitter.
  const buckets = new Map();
  for (const h of (historyEntries || [])) {
    const t = new Date(h.changedAt);
    if (!Number.isNaN(t.getTime())) t.setMilliseconds(0);
    const key = Number.isNaN(t.getTime()) ? String(h.changedAt) : t.toISOString();
    if (!buckets.has(key)) buckets.set(key, { author: h.author, changedAt: h.changedAt, entries: [] });
    buckets.get(key).entries.push(h);
  }
  for (const [bucketKey, bucket] of buckets.entries()) {
    const allZero = bucket.entries.length > 0 && bucket.entries.every(e => Number(e.newValue) === 0);
    if (allZero) {
      rows.push({
        type: "edit",
        systemPhrasing: true,
        timestamp: bucket.changedAt,
        author: bucket.author,
        key: `edit-sys:${bucketKey}`,
      });
    } else {
      for (const e of bucket.entries) {
        rows.push({
          type: "edit",
          timestamp: e.changedAt,
          author: e.author,
          key: `edit:${bucketKey}:${e.serviceId}`,
          serviceName: e.serviceName,
          oldValue: e.oldValue,
          newValue: e.newValue,
        });
      }
    }
  }
  rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return rows;
}

// SC-058: PDC-PDC dedupe. TBJ-FL (and similar) group.name rows in
// sc_service_groups already end with the segment ("Minor League - PDC"),
// while the price line composes `{accountSegment} · {price}`. The row
// then reads "Minor League - PDC · PDC · $11.55/meal". Suppress the
// prefix when the group name already trails the segment. Cheap
// case-insensitive endsWith on the two forms the data uses
// (`- SEGMENT` with hyphen-space, or bare `SEGMENT`).
function groupNameCarriesSegment(name, segment) {
  if (!name || !segment) return false;
  const n = name.trim().toLowerCase();
  const s = segment.trim().toLowerCase();
  return n === s || n.endsWith(` - ${s}`) || n.endsWith(` ${s}`) || n.endsWith(`-${s}`);
}

// SC-064: single source of truth for the delta-chip meaning. Was
// duplicated in the entry row (~:395) and the review row (~:468) with
// slight drift. Direction carries the meaning; magnitude survives as
// weight only. Red is not on the table (blame connotation).
//   under  (value < proj) : amber, "-N"
//   over   (value > proj) : green, "+N"
//   match  (value === proj) : green bold, "✓"
// The "strong" weight kicks in on genuine outliers (|d| >= max(15,
// round(proj*0.5))) for under + over so the CVD-safe direction cue
// picks up an emphasis when the miss is big. Sign is always rendered.
function deltaChip(numVal, projVal) {
  const delta = numVal - projVal;
  if (delta === 0) {
    return { text: "✓", cls: "sc-day-row-delta--match sc-day-row-delta--strong" };
  }
  const mag = Math.abs(delta);
  const isStrong = mag >= Math.max(15, Math.round(projVal * 0.5));
  const dirCls = delta > 0 ? "sc-day-row-delta--over" : "sc-day-row-delta--under";
  const weightCls = isStrong ? " sc-day-row-delta--strong" : "";
  const sign = delta > 0 ? "+" : "−"; // U+2212 minus sign for typographic sanity
  return { text: `${sign}${mag}`, cls: `${dirCls}${weightCls}` };
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

function DayDetail({ day, serviceGroups, overrides, onSave, onAddNote, saving, dayIndex, totalDays, monthRevenue, accountName, accountSegment = "", onPrev, onNext, onNextException, onClose, isFeeAccount, homestandContext, scopeLabel = "month" }, ref) {
  // PR-SC-Redesign Stage 3: `scopeLabel` lets the caller relabel the
  // "% of {scope}" readout. Legacy callers (the legacy month/period
  // views) don't pass it and default to "month" - the existing label
  // stays unchanged. The new Period workspace passes "period" and
  // sends the period's revenue as monthRevenue, so the readout reads
  // correctly as "% of period". Surgical, backward-compatible fix to
  // the audit-flagged monthRevenue trap (spec 11.3).
  // Values: "" = untouched (ghost), "0" = explicitly zero, "123" = entered
  const [editValues, setEditValues] = useState({});
  // C1b: initialValues snapshot seeded alongside editValues (mount +
  // day-nav) so isDirty can be a VALUE comparison. `touched` survives
  // for its render duties (delta chips, entered-only hero, review
  // filter, wire payload) - only the dirty guard's definition changes.
  const [initialValues, setInitialValues] = useState({});
  const [touched, setTouched] = useState(new Set()); // track which inputs user has interacted with
  // SC-079: notes moved off the singleton dayNotes column onto the
  // append-only ledger (sc_day_note_entries via sc-9). The textarea
  // is now a DRAFT for the next entry, not a persisted field, and the
  // "Add note" button below posts it via sc-add-note. Local mirror of
  // day.noteEntries lets us prepend optimistically without waiting on
  // a refetch.
  const [notes, setNotes] = useState("");
  const [noteEntries, setNoteEntries] = useState(day.noteEntries || []);
  // F1 (M2): actuals-edit history read at the same moment as the notes.
  // Day-nav reseeds both. Add-note prepends optimistically only into
  // noteEntries; history rehydrates naturally on the next month refetch
  // triggered by a successful save.
  const [historyEntries, setHistoryEntries] = useState(day.historyEntries || []);
  const [isPostingNote, setIsPostingNote] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [expandedExtras, setExpandedExtras] = useState(new Set());
  const [showReview, setShowReview] = useState(null);
  const [justSaved, setJustSaved] = useState(false);
  // SC-063: discard guard state. When dirty AND the operator tries to
  // close (Esc, backdrop, X, Cancel), show a confirm instead of the
  // silent-discard the old flow did. Success closes and pristine closes
  // stay instant - the confirm only intercepts real unsaved work.
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const keepEditingBtnRef = useRef(null);
  // SC-066: Mark-no-service flow. showNoServiceConfirm gates the small
  // confirm dialog; the write itself goes through the normal onSave
  // path with all in-service services set to 0 and a note appended.
  const [showNoServiceConfirm, setShowNoServiceConfirm] = useState(false);
  const nsCancelBtnRef = useRef(null);
  // C1b (F10): focus placement on view transitions. Refs point at each
  // view's primary action. The effect below moves focus on the
  // corresponding transition.
  const reviewConfirmBtnRef = useRef(null);
  const successPrimaryBtnRef = useRef(null);
  const prevViewRef = useRef({ showReview: null, justSaved: false });

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
    // C1b: snapshot at the SAME moment editValues seeds, from the SAME
    // source. Mutated only by the same effect on day-nav/re-seed;
    // handleChange / fillGroupWithProjections write to editValues only.
    setInitialValues(vals);
    setTouched(t);
    // SC-079: on day-nav, the note draft resets to empty (drafts belong
    // to the current day only) and the local ledger mirror rehydrates
    // from the new day's payload. Prior saved history persists in
    // day.noteEntries; nothing needs preserving in local state.
    setNotes("");
    setNoteEntries(day.noteEntries || []);
    setHistoryEntries(day.historyEntries || []);
    setExpandedGroups(new Set());
    setExpandedExtras(new Set());
    setShowReview(null);
    setJustSaved(false);
    // SC-063: day-nav also drops any lingering discard-confirm state so
    // the next day's overlay starts clean.
    setShowDiscardConfirm(false);
    // SC-066: same for the no-service confirm.
    setShowNoServiceConfirm(false);
  }, [day.date, serviceGroups, day.actual, day.noteEntries, day.historyEntries]);

  // SC-063 + C1b: dirty = any editValues entry differs from its
  // initialValues counterpart OR the notes draft is non-empty.
  // Retyping the same value or typing-then-reverting reads clean now
  // (was: `touched.size > 0` which fired on any interaction).
  // justSaved + review states are UI transitions, not user work - a
  // close from those paths goes straight through.
  const isDirty = useMemo(() => {
    if (justSaved) return false;
    // SC-079: the note draft counts dirty if it has any non-whitespace
    // content. It compares against EMPTY (not against a persisted
    // day.dayNotes anymore) because notes moved to append-only ledger
    // entries. A typed-but-not-posted draft trips the discard guard so
    // the operator doesn't silently lose work.
    if ((notes || "").trim().length > 0) return true;
    for (const ci of Object.keys(editValues)) {
      if ((editValues[ci] ?? "") !== (initialValues[ci] ?? "")) return true;
    }
    return false;
  }, [justSaved, editValues, initialValues, notes]);

  // Imperative handle for ServiceCalendar's guarded onClose. Returns
  // true when parent may proceed with the close (pristine); false when
  // this component just opened its own discard-confirm. Discard button
  // inside the confirm calls onClose directly, bypassing the guard.
  useImperativeHandle(ref, () => ({
    requestClose: () => {
      if (!isDirty) return true;
      setShowDiscardConfirm(true);
      return false;
    },
  }), [isDirty]);

  // Local close attempt for the X and Cancel buttons (which reach the
  // parent via onClose without going through useDialogA11y). Same gate.
  const attemptClose = useCallback(() => {
    if (isDirty) setShowDiscardConfirm(true);
    else onClose();
  }, [isDirty, onClose]);

  // SC-063: focus the safe default (Keep editing) when the confirm
  // opens so a stray Enter reaffirms editing rather than discarding.
  useEffect(() => {
    if (showDiscardConfirm) {
      const rafId = requestAnimationFrame(() => {
        keepEditingBtnRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [showDiscardConfirm]);

  const handleChange = useCallback((colIndex, value) => {
    const clean = value.replace(/[^0-9]/g, "");
    setEditValues(prev => ({ ...prev, [colIndex]: clean }));
    // SC-071: clearing an input on a service with no prior saved actual
    // restores the ghost/untouched state. Same predicate the init effect
    // uses: day.actual[colIndex] != null means "we had a saved value on
    // page load", touched should stay so the operator can re-enter or
    // reconfirm; day.actual[colIndex] == null means "this was ghost from
    // the start", clearing should return it there. This also drops the
    // dirty-guard over-trigger on type-then-delete for previously-empty
    // rows (partially retires the Section-3 candidate).
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
    setExpandedGroups(prev => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }, []);

  const toggleExtras = useCallback((name) => {
    setExpandedExtras(prev => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }, []);

  // SC-066: mark-no-service handler. Zero-writes every in-service
  // service via the normal save path and appends the audit note to
  // any typed note (preserved on its own line above). Ships `noService:
  // true` in the opts so the toast picks the "No service recorded"
  // headline override + drops the money line. Clears the confirm
  // dialog before the save so the operator sees the success state
  // (justSaved) without an intermediate flash.
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
    // SC-079: audit note posts as a ledger entry via the same server
    // action - server derives author from the session. Any note draft
    // the operator typed is preserved in-line here so it also lands as
    // context alongside the audit literal (both go into the same
    // sc-submit-day request via auditNote so ordering is deterministic).
    const trimmed = (notes || "").trim();
    const literal = "Service cancelled - marked no service";
    const auditNote = trimmed ? `${trimmed}\n${literal}` : literal;
    setShowNoServiceConfirm(false);
    const result = await onSave(day, entries, { noService: true, auditNote });
    if (result?.success) {
      setJustSaved(true);
      setNotes("");
    }
  }, [serviceGroups, day, notes, onSave]);

  // SC-079: post one authored entry against sc-add-note, prepend to
  // the local ledger optimistically on success, clear the draft.
  const handleAddNote = useCallback(async () => {
    const trimmed = (notes || "").trim();
    if (!trimmed || isPostingNote) return;
    if (!onAddNote) return;
    setIsPostingNote(true);
    try {
      const res = await onAddNote(day, trimmed);
      if (res?.success && res.entry) {
        setNoteEntries((prev) => [res.entry, ...prev]);
        setNotes("");
      }
    } finally {
      setIsPostingNote(false);
    }
  }, [notes, day, onAddNote, isPostingNote]);

  // Focus the safe default (Cancel) when the no-service confirm opens
  // so a stray Enter reaffirms the entry state rather than firing the
  // primary destructive-ish write.
  useEffect(() => {
    if (showNoServiceConfirm) {
      const rafId = requestAnimationFrame(() => {
        nsCancelBtnRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [showNoServiceConfirm]);

  // C1b (F10): focus placement on DayDetail view transitions.
  //   entry -> review opens  : focus Confirm & save
  //   review -> back to entry: focus Review & save (entry primary)
  //   save success           : focus success screen primary (Next / Close)
  // Uses a prev-view ref so a fresh mount does not steal focus (initial
  // focus lives with the dialog's own trap).
  useEffect(() => {
    const prev = prevViewRef.current;
    const enteredReview  = !!showReview && !prev.showReview && !justSaved;
    const backToEntry    = !showReview && !!prev.showReview && !justSaved;
    const enteredSuccess = justSaved && !prev.justSaved;
    prevViewRef.current = { showReview, justSaved };
    if (!enteredReview && !backToEntry && !enteredSuccess) return;
    const rafId = requestAnimationFrame(() => {
      if (enteredSuccess) successPrimaryBtnRef.current?.focus({ preventScroll: true });
      else if (enteredReview) reviewConfirmBtnRef.current?.focus({ preventScroll: true });
      else if (backToEntry) primaryBtnRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [showReview, justSaved]);

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
  //
  // SC-052 / SC-072: prices come from day.priceAtDate[colIndex] - the
  // effective-dated per-day price the sc_daily_revenue view uses (via
  // LATERAL pick against sc_service_prices). This is the SAME source
  // the tile rail + week card + drill-in read.
  //
  // SC-072 (render E-a): the scoreboard hero is entered-only from the
  // first entry onward. Untouched services contribute NOTHING to the
  // hero even before save - reading them into the total was the
  // "blends entered + projections and looks like recorded actuals"
  // behavior owner review rejected. The static full-day projection is
  // rendered separately as a subordinate phrase after the meals span.
  //
  // 0-state (nothing touched): both hero + projection collapse to the
  // same effective-dated projection sum so the scoreboard reads
  // "~$X · ~N meals" (the #361 behavior). First keystroke: hero starts
  // tracking touched services only; projection phrase appears + stays
  // static.
  //
  // "Entered" here matches the touched set. touched is seeded from
  // day.actual on mount, so a service with a prior saved actual is
  // already touched + already contributes; a service with a projection
  // but no actual is untouched + excluded from the hero.
  const enteredTotals = useMemo(() => {
    let meals = 0, rev = 0;
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        if (!touched.has(s.colIndex)) continue;
        const editVal = editValues[s.colIndex];
        if (editVal === "" || editVal === undefined) continue;  // SC-071
        const v = Number(editVal);
        const price = day.priceAtDate?.[s.colIndex] ?? s.price ?? 0;
        meals += v;
        rev += v * price;
      }
    }
    return { meals, revenue: rev };
  }, [serviceGroups, touched, editValues, day.priceAtDate, day.date]);

  // Static full-day projection - what the day would book if every
  // in-service service reported its projection. Effective-dated per
  // service so it matches day.totals.projectedRevenue (the view's
  // per-service sum). Used for the 0-state hero AND the enterned-state
  // subordinate phrase.
  const dayProjection = useMemo(() => {
    let meals = 0, rev = 0;
    for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        const v = day.projected[s.colIndex] ?? 0;
        const price = day.priceAtDate?.[s.colIndex] ?? s.price ?? 0;
        meals += v;
        rev += v * price;
      }
    }
    return { meals, revenue: rev };
  }, [serviceGroups, day.projected, day.priceAtDate, day.date]);

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
    //
    // SC-079: notes no longer travel with the save payload. Adding a
    // note is now an independent action via handleAddNote/sc-add-note.
    // If the operator has a draft in the textarea, they were told to
    // click "Add note" first (or the discard guard traps a close).
    const result = await onSave(day, entries);
    if (result?.success) {
      setShowReview(null);
      setJustSaved(true);
    }
  }, [serviceGroups, touched, getVal, day, onSave]);

  // C1b: derive pastness at read time so a tab open across midnight
  // no longer misclassifies today/yesterday. Server payload's isPast
  // is deliberately ignored client-side. isLocked stays as-is (it
  // decays on a slower N-day cadence; separate concern).
  const dayIsPast = isPastDate(day.date);
  const isOverdue = dayIsPast && day.isLocked && !day.hasActuals;
  const status = day.hasActuals ? "entered" : isOverdue ? "overdue" : dayIsPast ? "needs-entry" : "upcoming";

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
    // SC-071: guard on the RAW editVal before coercion. A cleared input
    // (editVal === "") must render no chip - the old flow was Number("")
    // -> 0, which computed a phantom "-projVal" delta. Even if touched
    // is still set (mid-clear), the ghost state wins.
    const isEmpty = editVal === "";
    // Bundle 2: services archived as of day.date render a read-only chip
    // instead of an editable input. Same visible-but-marked discipline as
    // the admin side (archived = visible, archived = unenterable).
    const inService = isInServiceOnDay(svc, day.date);
    const archiveDate = !inService ? String(svc.activeUntil).slice(0, 10) : null;

    let chip = null;
    if (inService && isTouched && !isEmpty) {
      const numVal = Number(editVal);
      chip = deltaChip(numVal, projVal);
    }

    return (
      <div key={svc.colIndex} className={`sc-day-row${!inService ? " sc-day-row--archived" : ""}`}>
        <div className="sc-day-row-left">
          <span className="sc-day-row-name">{svc.name}</span>
        </div>
        <div className="sc-day-row-right">
          {inService ? (
            <>
              <input type="text" inputMode="numeric" pattern="[0-9]*"
                className={`sc-day-input ${isTouched && !isEmpty ? "sc-day-input--touched" : "sc-day-input--ghost"}`}
                placeholder={String(projVal)}
                value={editVal}
                onChange={e => handleChange(svc.colIndex, e.target.value)} />
              {chip ? (
                <span className={`sc-day-row-delta ${chip.cls}`}>{chip.text}</span>
              ) : (
                <span className="sc-day-row-delta" />
              )}
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
      <>
      {showDiscardConfirm && renderDiscardConfirm()}
      {showNoServiceConfirm && renderNoServiceConfirm()}
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
                  {!isFeeAccount && (
                    <span className="sc-day-group-price">
                      {accountSegment && !groupNameCarriesSegment(group.name, accountSegment) ? `${accountSegment} · ` : ""}{fmtPrice(group.services[0]?.price || 0)} / meal
                    </span>
                  )}
                </div>
                {svcs.map(s => {
                  const projVal = day.projected[s.colIndex] ?? 0;
                  const numVal = getVal(s.colIndex);
                  // SC-064: review adopts the same helper as entry so
                  // the direction/weight semantics stay identical
                  // across the confirm step.
                  const chip = deltaChip(numVal, projVal);
                  return (
                    <div key={s.colIndex} className="sc-day-row sc-day-review-row2">
                      <span className="sc-day-row-name">{s.name}</span>
                      <span className="sc-day-review-val2">{numVal}</span>
                      <span className={`sc-day-row-delta ${chip.cls}`}>{chip.text}</span>
                    </div>
                  );
                })}
                <div className="sc-day-group-subtotal">{gs.meals} meals{isFeeAccount ? "" : ` · ${fmt$(gs.revenue)}`}</div>
              </div>
            );
          })}

          {/* SC-053 review surface: the day-note the chef typed lives
              inline below the group list so it enters the review pass.
              Bundle 1 wired the data end-to-end; this bundle surfaces
              it. Empty note renders as an explicit muted "No note" so
              the row's absence-of-note is deliberate + auditable. */}
          {/* SC-079: review surfaces the LATEST authored note (newest
              first from the ledger + author/time context) rather than
              echoing an unposted textarea draft. Empty ledger renders
              the muted "No notes" state so the row's absence is
              deliberate.
              F1 (M2): this surface stays NOTES-only. Its semantic is
              "the operator's last authored explanation before this
              save" - not an audit slice. Actuals edit history lives in
              the Activity ledger below and never appears here. */}
          {(() => {
            const latest = noteEntries[0];
            const emptyCls = latest ? "" : " sc-day-review-note--empty";
            return (
              <div className={`sc-day-review-note${emptyCls}`}>
                <span className="sc-day-review-note-label">Latest note</span>
                {latest ? (
                  <blockquote className="sc-day-review-note-body">
                    &ldquo;{latest.note}&rdquo;
                    <span className="sc-day-review-note-meta">
                      {" — "}
                      <strong>{latest.author || "—"}</strong>
                      {" · "}
                      {formatEntryStamp(latest.createdAt)}
                    </span>
                  </blockquote>
                ) : (
                  <span className="sc-day-review-note-body">No notes</span>
                )}
              </div>
            );
          })()}
        </div>
        <div className="sc-day-footer">
          <div className="sc-day-actions">
            <button className="sc-btn sc-btn--outline" onClick={() => setShowReview(null)}>Go back</button>
            <button ref={reviewConfirmBtnRef} className="sc-btn sc-btn--primary" disabled={saving} onClick={executeSave}>
              {saving ? "Saving..." : "Confirm & save"}
            </button>
          </div>
        </div>
      </div>
      </>
    );
  }

  // ── Success state ──
  // C1b (F11): role="status" + aria-live="polite" so the recorded
  // totals announce to screen readers when the success screen mounts.
  // SubmissionToast dropped its own live region in the same bundle to
  // avoid double-announce on single-day saves; bulk saves (no success
  // screen) still surface visually through the toast.
  if (justSaved) {
    return (
      <div className="sc-day sc-day--success" role="status" aria-live="polite">
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
              <button ref={successPrimaryBtnRef} className="sc-btn sc-btn--primary" onClick={onNextException}>Next needing entry →</button>
            ) : (
              <span className="sc-day-success-caughtup">✓ All caught up</span>
            )}
            <button ref={onNextException ? undefined : successPrimaryBtnRef} className="sc-btn sc-btn--outline" onClick={onClose}>Close</button>
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
            <button className="sc-day-close" onClick={attemptClose} aria-label="Close">
              <X size="sm" />
            </button>
          </div>
        </div>
        <div className="sc-day-sb-line">
          <div className="sc-day-sb-fig">
            {(() => {
              // SC-072 (render E-a):
              //   0-state: hero = day projection, both $ and meals
              //     carry `~`, "projected" class.
              //   entered: hero = entered-only sum (touched services);
              //     no `~`, "recorded" class. A subordinate muted phrase
              //     appears after the meals span: "· ~$X day projection".
              // The status counter "N of M entered" is untouched below.
              const hasEntered = enteredCount >= 1;
              const hero = hasEntered ? enteredTotals : dayProjection;
              const amountCls = hasEntered ? "recorded" : "projected";
              const prefix = hasEntered ? "" : "~";
              return (
                <>
                  {!isFeeAccount && (
                    <span className={`sc-day-sb-amount sc-day-sb-amount--${amountCls}`}>
                      {prefix}{fmt$(hero.revenue)}
                    </span>
                  )}
                  <span className="sc-day-sb-meals">{prefix}{hero.meals.toLocaleString()} meals</span>
                  {hasEntered && !isFeeAccount && (
                    <span className="sc-day-sb-day-projection">
                      · ~{fmt$(dayProjection.revenue)} day projection
                    </span>
                  )}
                </>
              );
            })()}
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
                {!isFeeAccount && (
                  <span className="sc-day-group-price">
                    {accountSegment && !groupNameCarriesSegment(group.name, accountSegment) ? `${accountSegment} · ` : ""}{fmtPrice(group.services[0]?.price || 0)} / meal
                  </span>
                )}
              </div>

              {activeSvcs.map(svc => renderServiceRow(svc))}

              {/* Per-group "actuals match" button */}
              {!groupTouched && activeSvcs.length > 0 && (
                <button className="sc-day-match-btn" onClick={() => fillGroupWithProjections(group)}>
                  <span className="sc-day-match-btn-icon" aria-hidden="true">↗</span>
                  Match projections
                </button>
              )}

              {/* SC-075 (render G1): in-group extras expander becomes a
                  page-tint sub-header band inside the card. The whole
                  band is the toggle button (aria-expanded announces
                  state); the +/- glyph on the right is the F3 bordered
                  chip. Expanded: rows render beneath within the same
                  card. Off-group rows keep their #366 F3 treatment - this
                  only touches the in-group expander. */}
              {inactiveSvcs.length > 0 && (
                <button
                  type="button"
                  className="sc-day-extras-band"
                  onClick={() => toggleExtras(group.name)}
                  aria-expanded={extrasOpen}
                >
                  <span className="sc-day-extras-band-label">
                    More services <span className="sc-day-extras-band-count">· {inactiveSvcs.length}</span>
                  </span>
                  <span className="sc-day-extras-band-chip" aria-hidden="true">
                    {extrasOpen ? "−" : "+"}
                  </span>
                </button>
              )}
              {extrasOpen && inactiveSvcs.map(svc => renderServiceRow(svc))}

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

        {/* SC-066 (render B2): Mark-no-service row for the client-
            cancelled-service case. Non-homestand accounts only (MLB
            homestand is schedule-driven, no operator-marked cancels).
            Renders only when there are projections AND the day isn't
            already handled (entered/no-service/off-season/prep). Sits
            above DAY NOTES so the confirm decision reads next to the
            note the operator might have already started. */}
        {(() => {
          // SC-077: SC-066 flow now available on MLB homestand accounts
          // too (rainout use case). Gate splits per billing model:
          //   - per-meal / MiLB / STL-FL: need day.projected to have
          //     something (no meals = no service to cancel).
          //   - MLB homestand: need the day to be a scheduled game
          //     (non-game days already read as prep on the schedule).
          // dayHandled short-circuits both paths - if the classifier
          // already labeled the day complete, no button.
          const isMlbHomestand = isFeeAccount && !!homestandContext?.dayType;
          const dayHandled = status === "entered" || status === "no-service" || status === "off-season" || status === "prep";
          if (dayHandled) return null;
          const hasScheduledService = isMlbHomestand
            ? homestandContext?.dayType === "GAME"
            : dayProjection.meals > 0;
          if (!hasScheduledService) return null;
          return (
            <div className="sc-day-noservice-row">
              <span className="sc-day-noservice-copy">Client cancelled service for this day?</span>
              <button
                type="button"
                className="sc-btn sc-btn--outline sc-day-noservice-btn"
                onClick={() => setShowNoServiceConfirm(true)}
                disabled={saving}
              >
                Mark no service
              </button>
            </div>
          );
        })()}

        {/* SC-079 (render I3): notes become a per-day append-only
            ledger. Textarea is a DRAFT for the next entry; Add note
            button posts it via sc-add-note (server-derived author),
            prepends to the ledger optimistically, clears the draft.
            Ledger container beneath: bordered, rows scroll past ~4
            entries, empty state hides the container. */}
        <div className="sc-day-notes">
          <label className="sc-day-notes-label" htmlFor="sc-day-note-draft">
            Add a note
          </label>
          <textarea
            id="sc-day-note-draft"
            className="sc-day-notes-input"
            placeholder="Rain delay, added dinner, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          <div className="sc-day-notes-actions">
            <button
              type="button"
              className="sc-btn sc-btn--outline sc-day-notes-add"
              onClick={handleAddNote}
              disabled={!notes.trim() || isPostingNote}
            >
              {isPostingNote ? "Adding..." : "Add note"}
            </button>
          </div>

          {/* F1 (M2): the ledger becomes the unified Activity view -
              notes + actuals edit history merged newest-first with a
              type chip per row. NOTE rows are the append-only sc_day_note
              ledger unchanged. EDIT rows come from sc_daily_actuals_history
              via the trigger (BEFORE UPDATE only; first-writes produce no
              EDIT row by design). Consecutive same-timestamp EDITs all
              writing 0 collapse to a single system row "Marked no service
              (all services 0)"; anything else renders individually. The
              add-note input above stays a NOTES-only surface (a new note
              prepends as a NOTE row); the review overlay's Latest note
              remains NOTES-only for semantic clarity. */}
          {(noteEntries.length > 0 || historyEntries.length > 0) && (
            <div className="sc-day-activity">
              <div className="sc-day-activity-band">
                <span className="sc-day-activity-band-label">Activity</span>
                <span className="sc-day-activity-band-count">
                  · {noteEntries.length + historyEntries.length}
                </span>
              </div>
              <ul className="sc-day-activity-list" aria-label="Activity ledger">
                {mergeActivity(noteEntries, historyEntries).map((row, i) => (
                  <li key={row.key || `${row.timestamp}-${i}`} className={`sc-day-activity-item sc-day-activity-item--${row.type}`}>
                    <span className={`sc-day-activity-chip sc-day-activity-chip--${row.type}`}>
                      {row.type === "note" ? "NOTE" : "EDIT"}
                    </span>
                    <div className="sc-day-activity-body">
                      {row.type === "note" ? (
                        <span className="sc-day-activity-note">{row.note}</span>
                      ) : row.systemPhrasing ? (
                        <span className="sc-day-activity-system">Marked no service (all services 0)</span>
                      ) : (
                        <span className="sc-day-activity-edit">
                          <strong className="sc-day-activity-svc">{row.serviceName}</strong>
                          {" "}
                          <span className="sc-day-activity-old">{row.oldValue}</span>
                          {" → "}
                          <strong className="sc-day-activity-new">{row.newValue}</strong>
                        </span>
                      )}
                    </div>
                    <span className="sc-day-activity-meta">
                      <strong>{row.author || "—"}</strong>
                      {" · "}
                      {formatEntryStamp(row.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="sc-day-footer">
        <div className="sc-day-actions">
          <button ref={primaryBtnRef} className="sc-btn sc-btn--primary" disabled={!hasTouchedAny || saving} onClick={() => setShowReview("save")}>
            Review &amp; save
          </button>
          <button className="sc-btn sc-btn--cancel" onClick={attemptClose}>Cancel</button>
        </div>
      </div>
      {showDiscardConfirm && renderDiscardConfirm()}
      {showNoServiceConfirm && renderNoServiceConfirm()}
    </div>
  );

  // ── SC-063: discard-confirm dialog ──
  //
  // Inline nested modal that intercepts Esc/backdrop/X/Cancel closes
  // when the entry has dirty state. Rendered as a portal-style overlay
  // absolutely positioned over the parent .sc-overlay-card. Keep
  // editing is the default-focused safe action; Discard is the
  // destructive one and fires the RAW parent onClose (bypassing the
  // guard). Reduced-motion note: no entrance animation - the confirm
  // is a decision surface, not a hero moment.
  function renderDiscardConfirm() {
    return (
      <div
        className="sc-day-discard"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sc-day-discard-title"
        aria-describedby="sc-day-discard-body"
        // Post-#362 review: Esc dismisses the confirm without discarding
        // (returns to editing). stopPropagation so useDialogA11y on the
        // outer day-overlay doesn't also see the Esc and re-invoke the
        // guard, which would immediately reopen the confirm.
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setShowDiscardConfirm(false);
          }
        }}
      >
        <div className="sc-day-discard-scrim" aria-hidden="true" />
        <div className="sc-day-discard-card">
          <h3 id="sc-day-discard-title" className="sc-day-discard-title">Discard unsaved entries?</h3>
          <p id="sc-day-discard-body" className="sc-day-discard-body">
            {`The counts${(notes || "").trim() ? " and note" : ""} you typed for ${formatDate(day.date)} haven't been saved. Discarding closes this day without writing.`}
          </p>
          <div className="sc-day-discard-actions">
            <button
              ref={keepEditingBtnRef}
              className="sc-btn sc-btn--primary"
              onClick={() => setShowDiscardConfirm(false)}
            >
              Keep editing
            </button>
            <button
              className="sc-btn sc-btn--danger"
              onClick={() => { setShowDiscardConfirm(false); onClose(); }}
            >
              Discard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // SC-066 confirm: small alertdialog. Cancel default-focused (safe);
  // primary "Mark no service" runs the write. Esc dismisses without
  // firing the write; stopPropagation so useDialogA11y's outer keydown
  // doesn't cascade the parent close guard.
  function renderNoServiceConfirm() {
    return (
      <div
        className="sc-day-discard"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sc-day-noservice-title"
        aria-describedby="sc-day-noservice-body"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setShowNoServiceConfirm(false);
          }
        }}
      >
        <div className="sc-day-discard-scrim" aria-hidden="true" />
        <div className="sc-day-discard-card">
          <h3 id="sc-day-noservice-title" className="sc-day-discard-title">
            Mark {formatDate(day.date)} as no service?
          </h3>
          <p id="sc-day-noservice-body" className="sc-day-discard-body">
            All services record 0 for this day and it counts as complete. A note is added for the record.
          </p>
          <div className="sc-day-discard-actions">
            <button
              ref={nsCancelBtnRef}
              className="sc-btn sc-btn--outline"
              onClick={() => setShowNoServiceConfirm(false)}
            >
              Cancel
            </button>
            <button
              className="sc-btn sc-btn--primary"
              onClick={executeMarkNoService}
              disabled={saving}
            >
              {saving ? "Saving..." : "Mark no service"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default forwardRef(DayDetail);
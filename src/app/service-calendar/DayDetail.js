"use client";
import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import { X, ChevronLeft, ChevronRight } from "./Icons";
import { fmt$, round2 } from "./season/format";
import { isPastDate } from "./dayResolvers";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOWS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// W7 (2026-07-18): the pure helpers below were module-private since
// stage 4. Exported as named exports so v2/entry/DayEntryV2 can reuse
// them VERBATIM without duplication or drift. The default export
// (DayDetail forwardRef) is unchanged; the helpers themselves are
// unchanged - only their visibility. Zero behavior touch.
export function formatDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return `${DOWS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
// SC-079: note-ledger timestamp format. Server returns ISO strings;
// render in the operator's local timezone with the "Jul 9 · 10:05 AM"
// shape the render pack specifies. Falls back to the raw string if the
// value can't be parsed.
export function formatEntryStamp(iso) {
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
//   [{ type: "note"|"edit"|"first-entered", timestamp, author, key, ...body }]
//   where body varies:
//     note           -> { note }
//     edit           -> { serviceName, oldValue, newValue }
//     edit sys       -> { systemPhrasing: true }  (all-zero batch)
//     first-entered  -> {}  (synthetic row from readHistoryEntriesForRange;
//                       fills the audit-trigger INSERT gap. Guarded
//                       BEFORE bucketing so its null newValue cannot
//                       corrupt the every(newValue === 0) collapse.)
export function mergeActivity(noteEntries, historyEntries) {
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
  //
  // Phase 1 Ledger (2026-07-24): the synthetic first-entered row (marker
  // `kind === "first-entered"` from readHistoryEntriesForRange) is
  // filtered OUT of the bucketing loop and pushed directly. Rationale:
  // (a) its null oldValue/newValue would render "undefined -> undefined"
  // if it fell through to the edit branch, and (b) Number(null) === 0
  // would cause it to be absorbed by the all-zero collapse if it
  // landed in a real mark-no-service bucket.
  const buckets = new Map();
  for (const h of (historyEntries || [])) {
    if (h.kind === "first-entered") {
      rows.push({
        type: "first-entered",
        timestamp: h.changedAt,
        author: h.author,
        key: `first:${h.changedAt}`,
      });
      continue;
    }
    const t = new Date(h.changedAt);
    if (!Number.isNaN(t.getTime())) t.setMilliseconds(0);
    const key = Number.isNaN(t.getTime()) ? String(h.changedAt) : t.toISOString();
    if (!buckets.has(key)) buckets.set(key, { author: h.author, changedAt: h.changedAt, entries: [] });
    buckets.get(key).entries.push(h);
  }
  for (const [bucketKey, bucket] of buckets.entries()) {
    // A true mark-no-service writes ALL in-service services in one
    // batch, so bucket.entries.length > 1 is the required signature.
    // A lone zero (a single-service correction from N -> 0) is a plain
    // edit and must render as `Service N -> 0`, not as the system
    // "Marked no service" phrasing. The theoretical single-service-day
    // edge (a day with exactly one service that gets marked no-service)
    // falls through to the normal EDIT row - still truthful.
    const allZero = bucket.entries.length > 1 && bucket.entries.every(e => Number(e.newValue) === 0);
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
export function groupNameCarriesSegment(name, segment) {
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
export function deltaChip(numVal, projVal) {
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

// Unit label for the rate line. PG has no unit column, so infer from the
// service name + flat flag (mirrors scripts/generate-price-book.mjs).
export function deriveUnit(name, isFlatFee) {
  const n = (name || "").toLowerCase();
  if (/coffee|fountain|bev/.test(n)) return "wk";
  if (/extra protein/.test(n))       return "pan";
  if (/\bmto\b/.test(n))             return "order";
  if (/extended day labor/.test(n))  return "day";
  return isFlatFee ? "ea" : "meal";
}

// Rate-cell content for a service. Two-line stacked structure so the
// flag pills sit side by side beneath the price, never inline next to
// it, never wrapping individually. Non-revenue takes the price line's
// place (there is no billable rate).
export function renderRate(svc, rate, unit) {
  if (svc.isNonRevenue) {
    return <span className="sc-day-svc-tag sc-day-svc-tag--nonrev">not billed</span>;
  }
  const hasTags = svc.isFlatFee || svc.isTaxFree;
  return (
    <>
      <span className="sc-day-rate-amt">{fmt$(rate)} / {unit}</span>
      {hasTags && (
        <span className="sc-day-rate-tags">
          {svc.isFlatFee && <span className="sc-day-svc-tag sc-day-svc-tag--flat">flat</span>}
          {svc.isTaxFree && <span className="sc-day-svc-tag sc-day-svc-tag--tax">tax-free</span>}
        </span>
      )}
    </>
  );
}

// Column header for the ledger. Module scope so every mount uses the
// same JSX ref - keeps subgrid alignment identical everywhere the head
// appears (entry active groups, entry extras, review, expanded-off).
export const LEDGER_HEAD = (
  <div className="sc-day-ledger-head" aria-hidden="true">
    <span className="sc-lh-name">Service</span>
    <span className="sc-lh-rate">Rate</span>
    <span className="sc-lh-qty">Qty</span>
    <span className="sc-lh-amount">Amount</span>
  </div>
);

// 3-col variant for bulk custom-entry (no per-day Amount column -
// amounts vary by day). Pairs with .sc-day-ledger--no-amount on the
// wrapper (dayEntryV2.css). Owner Ruling 2 / redline #11.
export const LEDGER_HEAD_NO_AMOUNT = (
  <div className="sc-day-ledger-head" aria-hidden="true">
    <span className="sc-lh-name">Service</span>
    <span className="sc-lh-rate">Rate</span>
    <span className="sc-lh-qty">Qty</span>
  </div>
);

// 2-col fee variant for fee-no-dollar accounts (STL-FL). NO Rate cell
// (prices are $0 by design; a rate column would leak "$0.00 / meal"
// on every row) and NO Amount cell. Column word is "Qty" to match
// the per-meal header (LEDGER_HEAD). Pairs with .sc-day-ledger--fee
// on the wrapper (dayEntryV2.css). Phase 2B gate-2 fix (2026-07-25).
export const LEDGER_HEAD_FEE = (
  <div className="sc-day-ledger-head" aria-hidden="true">
    <span className="sc-lh-name">Service</span>
    <span className="sc-lh-qty">Qty</span>
  </div>
);

// In-service predicate: a (service, day) pair is in service iff the service
// has no archive date OR the day is on or before its archive date. Mirrors
// the sc_daily_revenue view's catalog JOIN (sc-6b) exactly. Used to gate
// data entry in DayDetail - services archived strictly after day.date
// render as a read-only "Archived" chip instead of an editable input. The
// view already drops those day rows; this stops the UI from offering
// entry where the view will never surface a result. Pure YYYY-MM-DD
// string compare; both inputs are already in that form (day.date from
// loadMonthData, activeUntil from sc_services.active_until DATE).
export function isInServiceOnDay(svc, dayDate) {
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
  // P2.1 (2026-07-11): decoupled draft for the always-on Activity band
  // composer. Independent from the ride-along `notes` state - the two
  // inputs post to different targets (ride goes with the actuals submit;
  // this posts directly to the notes ledger). See isDirty below - it
  // ORs across both drafts so a typed-but-unposted note in either input
  // trips the discard guard (no silent black-hole).
  const [standaloneDraft, setStandaloneDraft] = useState("");
  // Composer input ref - after a successful post we KEEP FOCUS here so
  // consecutive notes flow without re-clicking. See handleAddNote below.
  const standaloneInputRef = useRef(null);
  // P2 (item 2): ref on the ride-along textarea so review overlay's
  // Edit button can pop the operator back to the entry with focus on
  // the note field, ready to keep typing.
  const rideNoteRef = useRef(null);
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

  // B8a Fix 4 (2026-07-23): parallel to the DayEntryV2 seed guard.
  // Previously this effect re-fired whenever [day.date, serviceGroups,
  // day.actual, day.noteEntries, day.historyEntries] changed reference.
  // That was fine for day-nav (day.date genuinely changes) but broke
  // under B8a Fix 1's monthCache invalidation: a background refresh
  // replaces the payload with a new object (new day.actual reference)
  // and the effect re-fired, OVERWRITING editValues with server values
  // and wiping operator input mid-edit. Same data-loss shape v2 got.
  //
  // v1 has slightly different state than v2 (expandedExtras +
  // showReview instead of mobileBillOpen) but the pristine check is
  // IDENTICAL: v1's isDirty memo at :335-340 keys on editValues vs
  // initialValues, notes, and standaloneDraft - so those three are
  // the correct dirty signal for the guard here too.
  //
  // Three cases:
  //   day.date changed -> reseed everything (day-nav; existing behavior)
  //   same day, pristine -> reseed freely (refresh under a clean form
  //                         should take fresh server values)
  //   same day, dirty -> skip value/UI reseed, but still sync the
  //                      server-owned noteEntries + historyEntries so
  //                      the Ledger stays fresh under the dirty form
  const seededDateRef = useRef(null);
  useEffect(() => {
    const dateChanged = seededDateRef.current !== day.date;
    const isPristine = touched.size === 0
      && !(notes || "").trim()
      && !(standaloneDraft || "").trim();
    if (!dateChanged && !isPristine) {
      // Same-day background refresh under a dirty form. Sync ledger
      // streams; leave everything else alone.
      setNoteEntries(day.noteEntries || []);
      setHistoryEntries(day.historyEntries || []);
      return;
    }
    seededDateRef.current = day.date;
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
    // P2.1 (2026-07-11): the always-on Activity composer draft is
    // per-day, same as `notes`. Day-nav clears both.
    setStandaloneDraft("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.date, serviceGroups, day.actual, day.noteEntries, day.historyEntries]);

  // SC-063 + C1b: dirty = any editValues entry differs from its
  // initialValues counterpart OR the notes draft is non-empty.
  // Retyping the same value or typing-then-reverting reads clean now
  // (was: `touched.size > 0` which fired on any interaction).
  // justSaved + review states are UI transitions, not user work - a
  // close from those paths goes straight through.
  const isDirty = useMemo(() => {
    if (justSaved) return false;
    // SC-079: the ride-along note draft counts dirty if it has any
    // non-whitespace content. It compares against EMPTY (not against a
    // persisted day.dayNotes anymore) because notes moved to append-
    // only ledger entries. A typed-but-not-posted draft trips the
    // discard guard so the operator doesn't silently lose work.
    if ((notes || "").trim().length > 0) return true;
    // P2.1 (2026-07-11): the Activity composer draft is a SEPARATE
    // typed-but-unposted input. Without this branch it would be a
    // silent black hole - Kevin's engineering flag. OR with `notes`
    // so the COMBINED case (both drafts non-empty) fires ONE confirm,
    // not two stacked prompts (renderDiscardConfirm renders once
    // regardless of which branch tripped the memo).
    if ((standaloneDraft || "").trim().length > 0) return true;
    for (const ci of Object.keys(editValues)) {
      if ((editValues[ci] ?? "") !== (initialValues[ci] ?? "")) return true;
    }
    return false;
  }, [justSaved, editValues, initialValues, notes, standaloneDraft]);

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
      if (result.queued) {
        // F3: same close-cleanly-to-grid semantic as the executeSave
        // path - the badge is the truthful signal for a queued write.
        // Draft guard: the auto-note here (`auditNote`) is the audit
        // trail, NOT the operator's draft. Empty-draft => clean close
        // (setNotes("") is the standard reset). Non-empty draft => route
        // through discard-confirm and DO NOT reset the draft; the
        // operator either keeps editing or explicitly discards. P2
        // scope will fold notes into the save payload; until then the
        // guarded path is the honest one.
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

  // SC-079: post one authored entry against sc-add-note, prepend to
  // the local ledger optimistically on success, clear the draft.
  // P2.1 (2026-07-11): reads the decoupled `standaloneDraft` (Activity
  // composer input), not the ride-along `notes`. The two inputs are
  // independent drafts serving independent post targets. After a
  // successful post we RETAIN focus in the composer input so
  // consecutive notes flow without re-clicking the field.
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
        // Retain focus for consecutive posts. requestAnimationFrame
        // waits for React's re-render (composer input isn't disabled
        // long enough to lose focus, but the ref may be stale if the
        // list above re-orders synchronously).
        requestAnimationFrame(() => {
          standaloneInputRef.current?.focus({ preventScroll: true });
        });
      }
    } finally {
      setIsPostingNote(false);
    }
  }, [standaloneDraft, day, onAddNote, isPostingNote]);

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

  // Stage 4 display polish: is_flat_fee services stay in the revenue
  // math (they're billable line items) but are excluded from the
  // headcount tally. A week of Coffee shouldn't count as 1 meal; 13
  // Extra Protein pans shouldn't add 13 to "meals." Non-revenue keeps
  // its existing meals-count behavior (documented; Kevin's ruling).
  const groupSummary = useCallback((group) => {
    let meals = 0, rev = 0;
    for (const s of group.services) {
      const v = getVal(s.colIndex);
      if (!s.isFlatFee) meals += v;
      if (!s.isNonRevenue) rev += round2(v * (day.priceAtDate?.[s.colIndex] ?? s.price ?? 0));
    }
    return { meals, revenue: rev };
  }, [getVal, day.priceAtDate]);

  // Projected group summary: what the group would sub-total to if the
  // operator "Matched projections" today. Used for the ghost subtotal in
  // the empty state (nothing in the group touched yet). Skips archived
  // and non-revenue services - mirrors renderServiceRow's amount rule.
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
        if (!s.isFlatFee) meals += v;
        if (!s.isNonRevenue) rev += round2(v * price);
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
        if (!s.isFlatFee) meals += v;
        if (!s.isNonRevenue) rev += round2(v * price);
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
    // P2 (item 2, 2026-07-10): the note draft now rides the save via
    // opts.rideNote. Server appends it via addDayNoteEntry AFTER the
    // actuals write succeeds; a post-save note failure surfaces as
    // result.noteFailed (the partial-success case) and the parent's
    // handleSave shows the honest "Saved - note couldn't post, use Add
    // note" toast. On clean success we drop the draft here so the entry
    // screen resets to a pristine state.
    const trimmedDraft = (notes || "").trim();
    const rideNote = trimmedDraft.length > 0 ? trimmedDraft : undefined;
    const result = await onSave(day, entries, { rideNote });
    if (result?.success) {
      setShowReview(null);
      if (result.queued) {
        // F3: the save is captured locally but the server has NOT echoed
        // yet (network fail). Skip the success screen (which would show
        // uncomfirmed totals), and close the modal so the operator lands
        // back on the grid where the tile SYNCING badge tells the story
        // truthfully. No error surfaces here - the queue driver will
        // retry silently, and only a REJECTED replay (server 4xx/5xx on
        // retry) surfaces via toast.
        //
        // P2 (item 2): rideNote joins the queued payload alongside the
        // entries (see saveQueue.enqueue). Clean-close now clears the
        // draft too - the note is in the queue, not lost. This retires
        // the F3-era hasDraft => discard-confirm carve-out.
        setNotes("");
        onClose?.();
      } else if (result.noteFailed) {
        // P2 (item 2): partial-success. Save landed, note append
        // failed. Keep the draft so the operator can retry the note
        // via the standalone Add note flow. Skip the success screen
        // and close - the partial toast (raised by handleSave) is the
        // signal; the ledger will reflect the save on next refetch.
        onClose?.();
      } else {
        setJustSaved(true);
        // Clean-success: draft is committed as a ledger entry via the
        // ride-along path. Clear locally; refetch will hydrate it into
        // noteEntries. Optimistic prepend deliberately skipped here -
        // the server holds the authoritative timestamp + author, and
        // the natural refresh path (handleSave -> setReloadKey) lands
        // in ~a tick either way.
        setNotes("");
      }
    }
  }, [serviceGroups, touched, getVal, day, onSave, onClose, notes]);

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
      chip = deltaChip(Number(editVal), projVal);
    }

    // Qty cell = input + delta chip (in-service) or the archived chip.
    // Protected mechanic - unchanged from pre-Stage-4 except an a11y label.
    const qtyCell = inService ? (
      <div className="sc-day-row-right">
        <input type="text" inputMode="numeric" pattern="[0-9]*"
          aria-label={svc.name}
          className={`sc-day-input ${isTouched && !isEmpty ? "sc-day-input--touched" : "sc-day-input--ghost"}`}
          placeholder={String(projVal)}
          value={editVal}
          onChange={e => handleChange(svc.colIndex, e.target.value)} />
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

    // Fee accounts: no per-meal dollars by design - keep the two-cell row.
    if (isFeeAccount) {
      return (
        <div key={svc.colIndex} className={`sc-day-row${!inService ? " sc-day-row--archived" : ""}`}>
          <div className="sc-day-row-left">
            <span className="sc-day-row-name">{svc.name}</span>
          </div>
          {qtyCell}
        </div>
      );
    }

    // Per-service ledger row (Stage 4). Rate + amount from the effective-
    // dated price the sc_daily_revenue view uses.
    const rate = day.priceAtDate?.[svc.colIndex] ?? svc.price ?? 0;
    const unit = deriveUnit(svc.name, svc.isFlatFee);
    const entered = inService && isTouched && !isEmpty;

    return (
      <div key={svc.colIndex} className={`sc-day-row sc-day-row--ledger${!inService ? " sc-day-row--archived" : ""}`}>
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
              meals: svcs.reduce((acc, sv) => sv.isFlatFee ? acc : acc + getVal(sv.colIndex), 0),
              revenue: svcs.reduce((acc, sv) => {
                if (sv.isNonRevenue) return acc;
                return acc + round2(getVal(sv.colIndex) * (day.priceAtDate?.[sv.colIndex] ?? sv.price ?? 0));
              }, 0),
            };
            const renderReviewRow = (s) => {
              const projVal = day.projected[s.colIndex] ?? 0;
              const numVal = getVal(s.colIndex);
              // SC-064: review adopts the same helper as entry so the
              // direction/weight semantics stay identical.
              const chip = deltaChip(numVal, projVal);
              if (isFeeAccount) {
                return (
                  <div key={s.colIndex} className="sc-day-row sc-day-review-row2">
                    <span className="sc-day-row-name">{s.name}</span>
                    <span className="sc-day-review-val2">{numVal}</span>
                    <span className={`sc-day-row-delta ${chip.cls}`}>{chip.text}</span>
                  </div>
                );
              }
              const rate = day.priceAtDate?.[s.colIndex] ?? s.price ?? 0;
              return (
                <div key={s.colIndex} className="sc-day-row sc-day-review-row2 sc-day-row--ledger">
                  <div className="sc-day-row-left"><span className="sc-day-row-name">{s.name}</span></div>
                  <span className="sc-day-row-rate">{renderRate(s, rate, deriveUnit(s.name, s.isFlatFee))}</span>
                  <div className="sc-day-row-right">
                    <span className="sc-day-review-val2">{numVal}</span>
                    <span className={`sc-day-row-delta ${chip.cls}`}>{chip.text}</span>
                  </div>
                  <span className="sc-day-row-amount">
                    {s.isNonRevenue ? <span className="sc-day-amount-none">—</span> : fmt$(numVal * rate)}
                  </span>
                </div>
              );
            };
            return (
              <div key={group.name} className="sc-day-group">
                <div className="sc-day-group-header">
                  <span className="sc-day-group-name">{group.name}</span>
                  {accountSegment && !groupNameCarriesSegment(group.name, accountSegment) && (
                    <span className="sc-day-group-seg">{accountSegment}</span>
                  )}
                </div>
                {isFeeAccount ? (
                  svcs.map(renderReviewRow)
                ) : (
                  <div className="sc-day-ledger">
                    {LEDGER_HEAD}
                    {svcs.map(renderReviewRow)}
                  </div>
                )}
                <div className="sc-day-group-subtotal">{gs.meals} meals{isFeeAccount ? "" : ` · ${fmt$(gs.revenue)}`}</div>
              </div>
            );
          })}

          {/* P2 (item 2, R2a, 2026-07-10): the review overlay now shows
              what the operator is ADDING to this day (the ride-along
              note), not a historical echo. The prior "Latest note"
              block (SC-053 review surface, then the SC-079 rewrite that
              read the last authored entry) is gone - reading history
              here confused the pass with adding intent. Present only
              when a draft exists; absent otherwise (no empty-state row).
              Edit returns to the entry with focus on the ride-along
              textarea; Remove clears the draft in-place so the operator
              can Confirm & save without the note riding along. */}
          {(() => {
            const draft = (notes || "").trim();
            if (!draft) return null;
            return (
              <div className="sc-day-review-ride">
                <span className="sc-day-review-ride-label">Note riding this save</span>
                <blockquote className="sc-day-review-ride-body">
                  &ldquo;{draft}&rdquo;
                </blockquote>
                <div className="sc-day-review-ride-actions">
                  <button
                    type="button"
                    className="sc-btn sc-btn--outline sc-day-review-ride-btn"
                    onClick={() => {
                      setShowReview(null);
                      // rAF so the Edit click's blur unwinds before we
                      // yank focus into the textarea (avoids the scroll
                      // jump some browsers do on immediate focus).
                      requestAnimationFrame(() => rideNoteRef.current?.focus({ preventScroll: false }));
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="sc-btn sc-btn--outline sc-day-review-ride-btn"
                    onClick={() => setNotes("")}
                  >
                    Remove
                  </button>
                </div>
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
                {accountSegment && !groupNameCarriesSegment(group.name, accountSegment) && (
                  <span className="sc-day-group-seg">{accountSegment}</span>
                )}
              </div>

              {isFeeAccount ? (
                activeSvcs.map(svc => renderServiceRow(svc))
              ) : (
                <div className="sc-day-ledger">
                  {activeSvcs.length > 0 && LEDGER_HEAD}
                  {activeSvcs.map(svc => renderServiceRow(svc))}
                </div>
              )}

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
              {extrasOpen && (isFeeAccount ? (
                inactiveSvcs.map(svc => renderServiceRow(svc))
              ) : (
                // No LEDGER_HEAD here - the primary/active ledger above
                // already carries one in the same card; a second header
                // directly above identical columns reads as noise.
                // Subgrid still guarantees column alignment with the
                // active ledger since both use .sc-day-ledger.
                <div className="sc-day-ledger">
                  {inactiveSvcs.map(svc => renderServiceRow(svc))}
                </div>
              ))}

              {(() => {
                // Ghost subtotal (fully-empty state, non-fee): show projected
                // group total with ~ prefix in muted style so the operator
                // sees what the group would foot to at Match. On any touched
                // row in the group, swap to the live entered totals.
                const isGhost = !isFeeAccount && !groupTouched;
                const sub = isGhost ? projectedGroupSummary(group) : gs;
                if (!isGhost && sub.meals === 0) return null;
                if (isGhost && sub.meals === 0) return null;
                const tilde = isGhost ? "~" : "";
                return (
                  <div className={`sc-day-group-subtotal${isGhost ? " sc-day-group-subtotal--ghost" : ""}`}>
                    {tilde}{sub.meals.toLocaleString()} meals{isFeeAccount ? "" : ` · ${tilde}${fmt$(sub.revenue)}`}
                  </div>
                );
              })()}
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
                  {isFeeAccount ? (
                    group.services.map(svc => renderServiceRow(svc))
                  ) : (
                    <div className="sc-day-ledger">
                      {LEDGER_HEAD}
                      {group.services.map(svc => renderServiceRow(svc))}
                    </div>
                  )}
                  {gs.meals > 0 && <div className="sc-day-group-subtotal">{gs.meals.toLocaleString()} meals{isFeeAccount ? "" : ` · ${fmt$(gs.revenue)}`}</div>}
                </div>
              )}
            </div>
          );
        })}

        {/* SC-066 (render B2): Mark-no-service row for the client-
            cancelled-service case.
            2026-07-24 (owner Ruling 2): "entered" is no longer terminal
            for this button. Two workflows demand it: a game cancelled
            after counts are entered, and wrong-day entries. Manual
            zeroing loses the audit signal (six separate edits vs one
            "cancelled" batch); this button preserves it.
            Schedule-truth principle governs which OTHER statuses see
            the button: off-season / prep mean nothing was scheduled,
            so there is nothing to cancel; no-service is already in the
            terminal state. Once counts are recorded, the counts are
            the truth - even a fee non-game day with entered counts
            gets the button (entered wins over the schedule).
            Sits above DAY NOTES so the confirm decision reads next to
            the note the operator might have already started. */}
        {(() => {
          const isMlbHomestand = isFeeAccount && !!homestandContext?.dayType;
          // Gate reads SERVER status (day.status). The local `status`
          // var at :805 is a 4-value simplification (entered/overdue/
          // needs-entry/upcoming) and never emits "no-service", "off-
          // season", or "prep" - the pre-2026-07-24 gate checked those
          // three but the branches were dead in local scope. Using
          // day.status makes the intent effective.
          //
          // Never offer on statuses where cancellation is meaningless:
          //   no-service - already there
          //   off-season - not on the schedule
          //   prep       - fee non-game day with nothing recorded
          const dayHandled = day.status === "no-service" || day.status === "off-season" || day.status === "prep";
          if (dayHandled) return null;
          // For NON-entered statuses (needs-entry / overdue / future),
          // keep the pre-existing hasScheduledService gate: no point
          // offering "cancel" when nothing was scheduled to serve.
          // Entered days bypass this gate - the counts are the truth,
          // whatever the schedule said.
          if (day.status !== "entered") {
            const hasScheduledService = isMlbHomestand
              ? homestandContext?.dayType === "GAME"
              : dayProjection.meals > 0;
            if (!hasScheduledService) return null;
          }
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

        {/* Ride-along note draft. Saves with the operator's actuals
            submission (`rideNote` in the sc-submit-day payload) and
            lands as a NOTE ledger entry (server-derived author) after
            the actuals write. Same `notes` state; C1b dirty guard
            still catches an unposted draft (see isDirty).
            P2.1 (2026-07-11): label + hint sharpened so this input
            is unambiguously distinct from the always-on Activity
            composer below. */}
        <div className="sc-day-notes">
          <label className="sc-day-notes-label" htmlFor="sc-day-note-draft">
            Add a note to this submission
            <span className="sc-day-notes-optional"> (optional)</span>
          </label>
          <textarea
            ref={rideNoteRef}
            id="sc-day-note-draft"
            className="sc-day-notes-input"
            placeholder="Rain delay, added dinner, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          <p className="sc-day-notes-hint">
            Saves with your counts when you submit.
          </p>

          {/* F1 (M2): the ledger is the unified Activity view -
              notes + actuals edit history merged newest-first with a
              type chip per row. NOTE rows come from the append-only
              sc_day_note_entries ledger. EDIT rows come from
              sc_daily_actuals_history via the trigger. Same-timestamp
              zero-EDIT bundles collapse to a "Marked no service" system row.

              P2.1 (2026-07-11): the band is ALWAYS rendered (was
              gated on ledger non-empty). Header carries `ACTIVITY · N`.
              An always-on composer input sits pinned at the top of
              the band body - post one entry against sc-add-note
              WITHOUT the actuals submission. When the merged ledger
              is empty, an "empty row" replaces the list; the first
              posted entry displaces it. */}
          <div className="sc-day-activity">
            <div className="sc-day-activity-band">
              <span className="sc-day-activity-band-label">Activity</span>
              <span className="sc-day-activity-band-count">
                · {noteEntries.length + historyEntries.length}
              </span>
            </div>

            {/* Always-on composer: decoupled draft, decoupled Post pill.
                Enter posts (single-line input). After post: input clears
                and KEEPS FOCUS so consecutive notes flow. The `Post`
                pill disables when the trimmed draft is empty. */}
            <div className="sc-day-activity-composer">
              <input
                ref={standaloneInputRef}
                type="text"
                className="sc-day-activity-composer-input"
                placeholder="Add a note..."
                aria-label="Log a note now, without submitting counts"
                value={standaloneDraft}
                onChange={(e) => setStandaloneDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (standaloneDraft.trim() && !isPostingNote) handleAddNote();
                  }
                }}
                disabled={isPostingNote}
              />
              <button
                type="button"
                className="sc-btn sc-day-activity-composer-post"
                onClick={handleAddNote}
                disabled={!standaloneDraft.trim() || isPostingNote}
              >
                {isPostingNote ? "..." : "Post"}
              </button>
            </div>
            <p className="sc-day-activity-composer-hint">
              Posts to Activity now &mdash; no submission needed.
            </p>

            {(noteEntries.length > 0 || historyEntries.length > 0) ? (
              <ul className="sc-day-activity-list" aria-label="Activity ledger">
                {mergeActivity(noteEntries, historyEntries).map((row, i) => (
                  <li key={row.key || `${row.timestamp}-${i}`} className={`sc-day-activity-item sc-day-activity-item--${row.type}`}>
                    <span className={`sc-day-activity-chip sc-day-activity-chip--${row.type}`}>
                      {row.type === "note" ? "NOTE" : row.type === "first-entered" ? "ENTRY" : "EDIT"}
                    </span>
                    <div className="sc-day-activity-body">
                      {row.type === "note" ? (
                        <span className="sc-day-activity-note">{row.note}</span>
                      ) : row.type === "first-entered" ? (
                        <span className="sc-day-activity-system">Entered counts</span>
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
            ) : (
              <p className="sc-day-activity-empty">
                No activity yet &mdash; post a note above, or submit counts.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="sc-day-footer">
        <div className="sc-day-actions">
          <button ref={primaryBtnRef} className="sc-btn sc-btn--primary" disabled={!hasTouchedAny || saving} onClick={() => setShowReview("save")}>
            Review &amp; save
          </button>
          <button className="sc-btn sc-btn--cancel" onClick={attemptClose}>Cancel</button>
        </div>
        {/* P2.1 (2026-07-11): the footer "+ Add a note without saving"
            link is retired. The always-on Activity composer above
            (post-immediately, no submit) takes over that role, so the
            subordinated footer affordance is redundant. */}
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
  //
  // Owner Ruling 3 (2026-07-24): entered days need a destructive-copy
  // variant with a concrete meals/services summary. Meals + service
  // count only, NO currency (server-derived; a wrong dollar figure
  // in a destructive dialog is worse than no dollar figure).
  // Un-entered copy unchanged.
  function renderNoServiceConfirm() {
    // day.status (server-classified) not local `status` (:805 is a
    // 4-value simplification). Same reason as the gate above.
    const isEntered = day.status === "entered";
    let enteredMeals = 0;
    let enteredServices = 0;
    if (isEntered) {
      for (const g of serviceGroups) {
        for (const s of g.services) {
          if (!isInServiceOnDay(s, day.date)) continue;
          const v = Number(day.actual?.[s.colIndex]);
          if (Number.isFinite(v) && v > 0) {
            enteredMeals += v;
            enteredServices += 1;
          }
        }
      }
    }
    const hasEnteredCounts = isEntered && enteredServices > 0;
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
          {hasEnteredCounts ? (
            <p id="sc-day-noservice-body" className="sc-day-discard-body">
              This day has <strong>{enteredMeals.toLocaleString()} meal{enteredMeals === 1 ? "" : "s"}</strong> recorded across <strong>{enteredServices} service{enteredServices === 1 ? "" : "s"}</strong>. Every service will be set to zero and an audit note added to the Ledger.
            </p>
          ) : (
            <p id="sc-day-noservice-body" className="sc-day-discard-body">
              All services record 0 for this day and it counts as complete. A note is added for the record.
            </p>
          )}
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
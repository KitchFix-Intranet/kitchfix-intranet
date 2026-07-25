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
  LEDGER_HEAD_NO_AMOUNT,
  isInServiceOnDay,
} from "../../DayDetail";
// Phase 2B (2026-07-25): fee-no-dollar variant. Sibling rail + vocab
// helper. Both key on the same isFeeNoDollar predicate so the entry
// tree stays consistent on STL-FL without perturbing per-meal or MLB.
import BillRailFee from "./BillRailFee";
import { isFeeNoDollar, unitLabel, verbLabel, verbLabelPast, verbLabelPastUpper } from "../vocab";

// ═══════════════════════════════════════════════════════════════════
// groupActivity - v2's grouped Activity feed for the Ledger (Phase 1).
// ═══════════════════════════════════════════════════════════════════
//
// v1's mergeActivity (DayDetail.js:50-106) buckets history rows internally
// by second-truncated changedAt, then FLATTENS regular multi-service edits
// back to N per-service rows. That worked for v1's density but produces
// noisy Ledger walls on a busy day where one save touches 5-8 services.
//
// v2 spec (§8, owner-approved): hybrid summary line per EVENT (bucket),
// expandable to per-service detail. Same bucketing input as mergeActivity;
// preserves the bucket structure instead of flattening.
//
// First-entered synthesis lives in the DATA LAYER (owner Q1 ruling): the
// server appends a {kind: "first-entered"} row to historyEntries so v1
// AND v2 both receive it through the same channel. This helper filters
// it out of the bucketing loop and emits it as its own row - same guard
// mergeActivity applies, protecting the mark-no-service collapse.
//
// Owner constraint: mergeActivity's output shape MUST NOT change (v1
// consumes it too). This helper is v2-only, alongside mergeActivity.
//
// Row shapes emitted (all carry timestamp for sorting):
//   note            -> { type: "note",           timestamp, author, key, note }
//   edit-event      -> { type: "edit-event",     timestamp, author, key,
//                        entries: [{serviceId, serviceName, oldValue, newValue}] }
//   edit-noservice  -> { type: "edit-noservice", timestamp, author, key }
//                       (all-zero batch, aka "Marked no service")
//   first-entered   -> { type: "first-entered",  timestamp, author, key }
//                       (from server-appended kind marker; who FIRST
//                       inserted any actuals for this day - the audit
//                       trigger's INSERT gap)
// Sorted newest first.
function groupActivity(noteEntries, historyEntries) {
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
  // Bucketing: same second-truncation as mergeActivity. History rows
  // within one upsert share changedAt to millisecond precision; the
  // truncation is jitter slop.
  //
  // The synthetic first-entered row (kind === "first-entered") is
  // filtered OUT of the bucketing loop. See mergeActivity's guard for
  // the full rationale (null values, allZero collapse corruption).
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
    const bucketKey = Number.isNaN(t.getTime()) ? String(h.changedAt) : t.toISOString();
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { author: h.author, changedAt: h.changedAt, entries: [] });
    buckets.get(bucketKey).entries.push(h);
  }
  for (const [bucketKey, bucket] of buckets.entries()) {
    const allZero = bucket.entries.length > 1 && bucket.entries.every(e => Number(e.newValue) === 0);
    if (allZero) {
      rows.push({
        type: "edit-noservice",
        timestamp: bucket.changedAt,
        author: bucket.author,
        key: `edit-sys:${bucketKey}`,
      });
    } else {
      rows.push({
        type: "edit-event",
        timestamp: bucket.changedAt,
        author: bucket.author,
        key: `edit:${bucketKey}`,
        entries: bucket.entries.map(e => ({
          serviceId: e.serviceId,
          serviceName: e.serviceName,
          oldValue: e.oldValue,
          newValue: e.newValue,
        })),
      });
    }
  }
  rows.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return rows;
}
import useAnimatedNumber from "../../useAnimatedNumber";
import { scrollIntoViewRM, prefersReducedMotion } from "../motion";
import MobileBooksBar from "../MobileBooksBar";
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
  // Phase 2B (2026-07-25): isFeeAccount is no longer always false.
  // STL-FL now mounts DayEntryV2 via the ENTRY_V2_ACCOUNTS cutover
  // override (flags.js:187+). MLB fee accounts (CIN-OH, STL-MO,
  // TXR-TX-H, TXR-TX-V) stay OUT of the set until Phase 4 and never
  // reach this component. `account` is the full account object
  // (billingModel + hasHomestandSchedule) - the isFeeNoDollar
  // predicate on it selects the fee-no-dollar shape (STL-FL only).
  isFeeAccount,
  account = null,
  periodStats = null,     // { daysConfirmed, daysTotal, servedToDate } - fee Month block
  homestandContext,
  scopeLabel = "period",
}, ref) {
  // Fee-no-dollar shape flag - keyed on the account, not isFeeAccount.
  // MLB (flat_fee + hasHomestandSchedule) reads false here; STL-FL
  // (flat_fee + !hasHomestandSchedule) reads true. Vocabulary helpers
  // and rail branching read this single derived boolean.
  const feeNoDollar = isFeeNoDollar(account);
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
  // A3 failure UI (2026-07-24): inline failure state. Set by
  // executeConfirm when onSave returns !success (server rejected the
  // write; nothing committed). Rendered as a red-rail banner at the
  // top of the modal body. Cleared on next handleChange (operator is
  // retrying) and on any successful save. Shape:
  //   { message: string, serviceId?: string }
  // The serviceId is present for validation errors (from the server's
  // ActualCountValidationError path); UI can highlight the offending
  // input if we choose. Absent for other rejection classes.
  const [saveError, setSaveError] = useState(null);
  // W7 PR 2/3 motion: colIndexes currently mid-flash. Populated by
  // handleChange (ghost -> solid transition) and by fillGroupWithProjections
  // (Match-projections cascade). Each colIndex is a Map key -> stagger
  // delay in ms so the ServiceRow can apply `animation-delay` for the
  // cascade. Set-alone (no stagger) for single-input flash. Cleared per
  // colIndex on a token-tied setTimeout; --duration-slow = 280ms so
  // the animation window is ~360ms (adds a 80ms tail so overlapping
  // flashes reset cleanly without visible reflow).
  const [flashMap, setFlashMap] = useState(new Map());
  // W7 PR 3/3 Phase 5 mobile - single boolean toggling the second
  // sheet stage (bill open over list). Same component tree; the class
  // hooks CSS layout, no behavior fork. Desktop (>=768) ignores this
  // entirely - the media query gates every rule that reads it.
  const [mobileBillOpen, setMobileBillOpen] = useState(false);
  const flashTimeoutsRef = useRef(new Map());
  useEffect(() => () => {
    // Cleanup on unmount: cancel any pending flash clears so we
    // don't call setState on an unmounted component.
    for (const t of flashTimeoutsRef.current.values()) clearTimeout(t);
    flashTimeoutsRef.current.clear();
  }, []);
  const markFlash = useCallback((colIndex, delayMs = 0) => {
    setFlashMap(prev => {
      const next = new Map(prev);
      next.set(colIndex, delayMs);
      return next;
    });
    // Clear this flash after animation window + stagger delay.
    const existing = flashTimeoutsRef.current.get(colIndex);
    if (existing) clearTimeout(existing);
    const totalMs = delayMs + 400;
    const timer = setTimeout(() => {
      setFlashMap(prev => {
        if (!prev.has(colIndex)) return prev;
        const next = new Map(prev);
        next.delete(colIndex);
        return next;
      });
      flashTimeoutsRef.current.delete(colIndex);
    }, totalMs);
    flashTimeoutsRef.current.set(colIndex, timer);
  }, []);
  const keepEditingBtnRef = useRef(null);
  const nsCancelBtnRef = useRef(null);
  const standaloneInputRef = useRef(null);
  const rideNoteRef = useRef(null);
  const bodyRef = useRef(null);
  const primaryBtnRef = useRef(null);
  const successPrimaryBtnRef = useRef(null);
  const prevViewRef = useRef({ justSaved: false });

  // Day-nav re-seed. Previously matched DayDetail.js:265-308 verbatim
  // and re-fired whenever any of [day.date, serviceGroups, day.actual,
  // day.noteEntries, day.historyEntries] changed reference. That was
  // fine for day-nav (day.date genuinely changes) but broke on a
  // same-day background refresh: monthCache invalidation replaces the
  // payload with a NEW object (new day.actual reference), the effect
  // re-fired, and setEditValues(vals) OVERWROTE the operator's typed
  // input with server values - data loss. Save button greyed out too
  // because initialValues + touched got re-seeded.
  //
  // Fix (B8a Fix 2 amend, 2026-07-23): distinguish "different day
  // opened" (seed from server) from "same day's payload refreshed"
  // (don't clobber operator input).
  //   - Track the last-seeded day.date via a ref.
  //   - If day.date is unchanged AND the form is dirty (any touched
  //     service, any note draft), skip the value + UI reseed. The
  //     server-owned ledger streams (noteEntries / historyEntries)
  //     STILL sync so a save elsewhere shows up in the Ledger under
  //     the operator's open form.
  //   - If day.date is unchanged AND the form is pristine, reseed
  //     freely - that's what a refresh under a pristine form should do.
  //   - If day.date changed, reseed regardless (dirty state on the
  //     PREVIOUS day is destroyed by day-nav; the discard-confirm
  //     imperative handle upstream catches user-initiated nav; forced
  //     nav is deliberate).
  const seededDateRef = useRef(null);
  useEffect(() => {
    const dateChanged = seededDateRef.current !== day.date;
    const isPristine = touched.size === 0
      && !(notes || "").trim()
      && !(standaloneDraft || "").trim();
    if (!dateChanged && !isPristine) {
      // Same-day background refresh under a dirty form. Sync the
      // server-owned ledger streams (safe - they don't conflict with
      // typed input) and leave everything else alone.
      setNoteEntries(day.noteEntries || []);
      setHistoryEntries(day.historyEntries || []);
      return;
    }
    seededDateRef.current = day.date;
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
    setMobileBillOpen(false);
    // A3 failure UI (2026-07-24): clear inline save error on day-nav.
    // Failure state belongs to the day + values that failed - opening
    // a different day shouldn't inherit it.
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // A3 failure UI (2026-07-24): clear any prior save error - the
    // operator is retrying by typing. Panel is no longer in a failed
    // state until their next Confirm & save resolves.
    setSaveError(null);
    const clean = value.replace(/[^0-9]/g, "");
    setEditValues(prev => {
      const was = prev[colIndex] ?? "";
      // Motion: on the ghost -> solid transition, mark this row for
      // a brief flash. Empty-to-empty and same-value edits get no
      // flash. Reduced-motion honored via CSS (the .sc-v2-entry-row--flash
      // rule collapses its animation to 0ms under prefers-reduced-motion).
      if (was === "" && clean !== "") {
        markFlash(colIndex, 0);
      }
      return { ...prev, [colIndex]: clean };
    });
    setTouched(prev => {
      const n = new Set(prev);
      if (clean === "" && day.actual[colIndex] == null) {
        n.delete(colIndex);
      } else {
        n.add(colIndex);
      }
      return n;
    });
  }, [day.actual, markFlash]);

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
    // Motion: Match-projections cascade. Each newly-solid row gets a
    // staggered flash - 60ms per row from top - so the sequence reads
    // as ONE gesture rather than a rain of independent events. The
    // total hero pulses ONCE at the cascade start - React batches the
    // setEditValues call, heroValue changes in one render, the
    // hero-change effect fires exactly one pulse. The pulse runs
    // CONCURRENTLY with the row cascade (both are ~280ms, hero
    // starts at 0ms, last row's flash starts at 60ms * (N-1)). This
    // reads as the cascade IS the totalization - one gesture, one
    // beat. Chosen over "defer pulse to cascade tail" (which would
    // add a second beat and a timer) for feel simplicity - see PR
    // #466 F3b.
    let staggerIdx = 0;
    for (const s of group.services) {
      if (!isInServiceOnDay(s, day.date)) continue;
      const wasEmpty = (newVals[s.colIndex] ?? "") === "";
      newVals[s.colIndex] = String(day.projected[s.colIndex] ?? 0);
      newTouched.add(s.colIndex);
      if (wasEmpty) {
        markFlash(s.colIndex, staggerIdx * 60);
        staggerIdx++;
      }
    }
    setEditValues(newVals);
    setTouched(newTouched);
  }, [editValues, touched, day.projected, day.date, markFlash]);

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

  // Phase 2B (2026-07-25): fee-no-dollar `groupSummary` variant. The
  // per-meal `groupSummary` above skips isFlatFee services (`if
  // (!s.isFlatFee) meals += v;`) because they carry no per-meal count.
  // On STL-FL every service is flatFee-billed, so `gsEntered.meals` is
  // always 0 - useless for the group subtotal. This variant returns
  // `meals` = sum of ALL typed values (irrespective of isFlatFee),
  // matching the "served" concept on a fee account. Passed to
  // GroupBlock only on the fee branch; per-meal keeps its per-meal
  // groupSummary unchanged.
  const feeGroupSummary = useCallback((group) => {
    let served = 0;
    for (const s of group.services) {
      const v = getVal(s.colIndex);
      served += v;
    }
    return { meals: served, revenue: 0 };
  }, [getVal]);
  const feeProjectedGroupSummary = useCallback((group) => {
    let served = 0;
    for (const s of group.services) {
      if (!isInServiceOnDay(s, day.date)) continue;
      served += day.projected[s.colIndex] ?? 0;
    }
    return { meals: served, revenue: 0 };
  }, [day.projected, day.date]);

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
    // A3 failure UI (2026-07-24): pass silentFailure so handleSave
    // does NOT fire its floating "Save failed" toast. The failure
    // renders inline in this panel instead (per §8B "failure is the
    // absence of the handoff"). Panel stays open, counts intact.
    const result = await onSave(day, entries, { rideNote, silentFailure: true });
    if (result?.success) {
      setSaveError(null);   // any prior failure state is stale now
      if (result.queued) {
        setNotes("");
        onClose?.();
      } else if (result.noteFailed || result.auditNoteFailed) {
        onClose?.();
      } else {
        setJustSaved(true);
        setNotes("");
      }
    } else {
      // Nothing committed. Panel stays open, counts intact.
      setSaveError({
        message: result?.error || "Save failed",
        serviceId: result?.serviceId || null,
      });
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

  // W7 PR 3/3 Phase 5 mobile - onFocus handler at the list level so
  // TAPPING an input on mobile scrolls its row into view (the on-screen
  // keyboard would otherwise bury the focused row). React's onFocus
  // bubbles from descendants; the guard checks the target is a
  // .sc-day-input so composer/other-focus events pass through. Uses
  // scrollIntoViewRM block:"nearest" - the mobile analog of the F1
  // sequential-scroll intent. Desktop is unaffected because the
  // viewport already sits above the keyboard and `nearest` is a no-op
  // when the row is already in view.
  const handleListFocus = useCallback((e) => {
    const el = e.target;
    if (!el?.classList?.contains?.("sc-day-input")) return;
    const row = el.closest ? el.closest(".sc-day-row") : null;
    if (row) scrollIntoViewRM(row, { block: "nearest" });
  }, []);

  // Focus a target input with intent-scoped scroll (W7 PR 2/3 F1 split):
  //   sequential=true  -> block: "nearest" (Enter, ArrowUp, ArrowDown).
  //     Browser scrolls ONLY when the target is outside the viewport,
  //     minimally. This keeps rapid entry stable - the viewport
  //     doesn't swim under the operator's hands during fast keying.
  //   sequential=false -> block: "center" (PageUp/PageDown group jump).
  //     A teleport SHOULD reorient the viewport.
  // Same helper, options pass-through - no second scroll helper.
  const focusInputScrolled = useCallback((el, { sequential = true } = {}) => {
    if (!el || typeof el.focus !== "function") return;
    // Find the row wrapper so the scroll targets the whole ledger row.
    const row = el.closest ? (el.closest(".sc-day-row") || el) : el;
    scrollIntoViewRM(row, { block: sequential ? "nearest" : "center" });
    el.focus({ preventScroll: true });
  }, []);

  // Keyboard grid handler (W7 PR 2/3):
  //   Enter      - advance to next input (or blur -> Confirm on last).
  //                Preserves the PR-1 body-level Enter-advance verbatim.
  //   ArrowDown  - next input across the whole list (skips read-only rows).
  //   ArrowUp    - previous input.
  //   PageDown   - first input of the next group.
  //   PageUp     - first input of the previous group.
  //   Cmd/Ctrl+Enter - fire Confirm from anywhere in the workspace.
  //                    Routed through the SAME confirmDisabled check
  //                    the button uses (!hasTouchedAny || saving), so
  //                    a chord while pristine is a no-op (law 1).
  //
  // Law 2 verdict: DayEntryV2's count inputs are type="text" +
  // inputMode="numeric" (ServiceRow @ 740-741). Arrow keys carry no
  // input-native increment/decrement semantics on text inputs; binding
  // them for row navigation is safe. Mobile numeric keyboard still
  // opens via inputMode="numeric"; digit-only input still enforced via
  // handleChange's [^0-9] replace.
  const handleBodyKeyDown = useCallback((e) => {
    // Cmd/Ctrl+Enter Confirm from anywhere (except when the composer
    // input has focus - Enter there posts a note; the chord is not
    // treated specially inside the composer, so the composer's own
    // handler wins).
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      const target = e.target;
      if (target?.classList?.contains?.("sc-v2-entry-activity-input")) return;
      e.preventDefault();
      // Law 1: same guarded path the button uses. confirmDisabled at
      // the button site = !hasTouchedAny || saving. hasTouchedAny is
      // touched.size > 0; inlined here to avoid the TDZ (declaration
      // sits below in the render body).
      const hasTouched = touched.size > 0;
      if (!hasTouched || saving) return;
      executeConfirm();
      return;
    }

    const el = e.target;
    if (!el?.classList?.contains?.("sc-day-input")) return;
    if (!bodyRef.current) return;
    const inputs = Array.from(bodyRef.current.querySelectorAll(".sc-day-input"));
    const idx = inputs.indexOf(el);
    if (idx < 0) return;

    if (e.key === "Enter") {
      e.preventDefault();
      if (idx < inputs.length - 1) {
        focusInputScrolled(inputs[idx + 1]);
      } else {
        el.blur();
        primaryBtnRef.current?.focus({ preventScroll: true });
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (idx < inputs.length - 1) focusInputScrolled(inputs[idx + 1]);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) focusInputScrolled(inputs[idx - 1]);
      return;
    }

    if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      const forward = e.key === "PageDown";
      // Find the input's containing group (.sc-v2-entry-group), then
      // LOOP through subsequent groups in the chosen direction until
      // one containing a focusable input is found (W7 PR 2/3 F2 fix).
      // A group whose services are all archived / out-of-service renders
      // no `.sc-day-input`; the pre-fix ±1 logic dead-ended there. This
      // loop skips input-less groups until it finds a real target or
      // hits the end of the list (no-op then).
      const group = el.closest ? el.closest(".sc-v2-entry-group") : null;
      if (!group) return;
      const allGroups = Array.from(bodyRef.current.querySelectorAll(".sc-v2-entry-group"));
      const groupIdx = allGroups.indexOf(group);
      if (groupIdx < 0) return;
      const step = forward ? 1 : -1;
      for (let i = groupIdx + step; i >= 0 && i < allGroups.length; i += step) {
        const targetInput = allGroups[i].querySelector(".sc-day-input");
        if (targetInput) {
          focusInputScrolled(targetInput, { sequential: false });
          return;
        }
      }
      // No target found in that direction - no-op.
      return;
    }
  }, [touched, saving, executeConfirm, focusInputScrolled]);

  // Coaching per-meal branch - DayDetail.js:829-835. Phase 2B: fee-no-
  // dollar variant swaps "enter" -> "confirm" and "meal counts" ->
  // "served counts" (vocab.js). MLB fee never reaches this component
  // so the fee branch here targets STL-FL only.
  const coaching = feeNoDollar ? {
    "needs-entry": { tone: "needs",   text: "Confirm served counts. Projections shown for reference." },
    "overdue":     { tone: "overdue", text: "Past due - confirm served counts as soon as possible." },
    "upcoming":    { tone: "neutral", text: "Confirm served counts. Projections shown for reference." },
    "entered":     { tone: "entered", text: "Counts confirmed. Edit and re-save if needed." },
  }[status] : {
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
  // Phase 1 Ledger (2026-07-24): swapped mergeActivity -> groupActivity
  // (v2-specific). Preserves bucket structure (hybrid summary + expand
  // detail per §8). The first-entered synthesis row is now DATA-LAYER
  // (kind marker in historyEntries) so both v1 and v2 receive it; no
  // separate arg needed here.
  const combinedActivity = useMemo(
    () => groupActivity(noteEntries, historyEntries),
    [noteEntries, historyEntries]
  );

  // Header nav - DayDetail day nav for prev/next.
  const showDayNav = onPrev || onNext;

  // Success state - after clean save, celebration screen.
  // Fee-no-dollar variant: no currency hero; served count is the hero,
  // "Confirmed" replaces "Recorded" in the title (Ruling 3, vocabulary).
  if (justSaved) {
    let feeServed = 0;
    if (feeNoDollar) {
      for (const g of serviceGroups) {
        for (const s of g.services) {
          if (!isInServiceOnDay(s, day.date)) continue;
          const v = editValues[s.colIndex];
          if (v !== "" && v !== undefined && touched.has(s.colIndex)) {
            feeServed += Number(v) || 0;
          }
        }
      }
    }
    return (
      <div className="sc-v2-entry sc-v2-entry--success" role="status" aria-live="polite">
        <div className="sc-v2-entry-success-inner">
          <div className="sc-v2-entry-success-check">✓</div>
          <h3 className="sc-v2-entry-success-title">{feeNoDollar ? "Confirmed" : "Recorded"}</h3>
          <span className="sc-v2-entry-success-hero">
            {feeNoDollar ? `${feeServed.toLocaleString()} served` : fmt$(summary.revenue)}
          </span>
          <p className="sc-v2-entry-success-sub">
            {feeNoDollar
              ? formatDate(day.date)
              : <>{summary.meals.toLocaleString()} meals · {formatDate(day.date)}</>
            }
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
    <div className={`sc-v2-entry${mobileBillOpen ? " sc-v2-entry--mobile-bill-open" : ""}`}>
      {/* W7 PR 3/3 Phase 5 - drag-handle affordance. Visible at
          ≤767 only via CSS. Not a drag-to-dismiss target - it's a
          visual "this is a sheet" cue. Dismiss stays on the header
          close (attemptClose -> requestClose guard) so the discard
          flow is the same one gesture, everywhere. */}
      <div className="sc-v2-entry-drag-handle" aria-hidden="true" />
      {showDiscardConfirm && (
        <DiscardConfirm
          onKeepEditing={() => setShowDiscardConfirm(false)}
          onDiscard={() => { setShowDiscardConfirm(false); onClose(); }}
          keepEditingBtnRef={keepEditingBtnRef}
        />
      )}
      {showNoServiceConfirm && (() => {
        // Owner Ruling 3 (2026-07-24): entered days need a destructive
        // copy variant with a concrete counts summary - the misclick
        // guardrail. Meals + service count only, NO currency (currency
        // is server-derived; a wrong dollar figure in a destructive
        // dialog is worse than none).
        // Local `status` at :621 is a 4-value simplification that
        // conflates "any actuals" with "entered"; day.status is the
        // server-classified truth. Both would work here (this branch
        // only cares about hasActuals + non-zero counts), but day.
        // status keeps the concept aligned with the gate above.
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
        return (
          <NoServiceConfirm
            onCancel={() => setShowNoServiceConfirm(false)}
            onConfirm={executeMarkNoService}
            cancelBtnRef={nsCancelBtnRef}
            dateLabel={formatDate(day.date)}
            hasEnteredCounts={isEntered && enteredServices > 0}
            enteredMeals={enteredMeals}
            enteredServices={enteredServices}
            unit={unitLabel(account)}
            feeNoDollar={feeNoDollar}
          />
        );
      })()}

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

      {/* A3 failure UI (2026-07-24): inline save-failure banner. Red
          left-rail per §8B. Renders above the pane so it's the first
          thing above the input area. Counts/typed values remain intact
          in the body below. Cleared on retry (handleChange) or day-nav.
          Panel does not close - operator can fix the reason and retry
          in place. */}
      {saveError && (
        <div className="sc-v2-entry-alert sc-v2-entry-alert--error" role="alert" aria-live="assertive">
          <div className="sc-v2-entry-alert-head">Save failed - nothing recorded</div>
          <div className="sc-v2-entry-alert-body">{saveError.message}</div>
        </div>
      )}

      {/* ─── Two-pane workspace ─── */}
      <div className="sc-v2-entry-pane">
        {/* ─── Left: service list ─── */}
        <div
          ref={bodyRef}
          className="sc-v2-entry-list"
          onKeyDown={handleBodyKeyDown}
          onFocus={handleListFocus}
          aria-keyshortcuts="Enter ArrowUp ArrowDown PageUp PageDown Control+Enter Meta+Enter"
        >
          {activeGroups.map(group => (
            <GroupBlock
              key={group.name}
              group={group}
              day={day}
              editValues={editValues}
              touched={touched}
              flashMap={flashMap}
              accountSegment={accountSegment}
              onChange={handleChange}
              onFillProjections={fillGroupWithProjections}
              groupSummary={feeNoDollar ? feeGroupSummary : groupSummary}
              projectedGroupSummary={feeNoDollar ? feeProjectedGroupSummary : projectedGroupSummary}
              hideAmount={feeNoDollar}
              unit={feeNoDollar ? "served" : "meals"}
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
                  flashMap={flashMap}
                  accountSegment={accountSegment}
                  onChange={handleChange}
                  onFillProjections={fillGroupWithProjections}
                  groupSummary={feeNoDollar ? feeGroupSummary : groupSummary}
                  projectedGroupSummary={feeNoDollar ? feeProjectedGroupSummary : projectedGroupSummary}
                  hideAmount={feeNoDollar}
                  unit={feeNoDollar ? "served" : "meals"}
                  expanded={false}
                />
              ))}
            </details>
          )}

          {/* Mark-no-service link
              2026-07-24 (owner Ruling 2): entered days ARE eligible for
              cancellation - a game cancelled after counts, or a wrong-
              day entry. Only no-service (already terminal) is gated.
              v2 doesn't see prep/off-season (MLB fee stays on v1).
              Gate reads SERVER status (day.status): the local `status`
              var at :621 is a 4-value simplification (entered/overdue/
              needs-entry/upcoming) and never emits "no-service", so
              gating on local would leak the button onto server-no-
              service days (all-zero actuals present). */}
          {day.status !== "no-service" && (
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

          {/* Ledger - composer on top, chronological events beneath.
              Phase 1 (2026-07-24): renamed from ActivityBand. Events are
              now grouped per §8 hybrid: one summary line per save event,
              expandable to per-service detail. First-entered synthesis
              row appears for any day with actuals (no schema change -
              synthesized server-side from sc_daily_actuals.created_*). */}
          <LedgerBand
            entries={combinedActivity}
            draft={standaloneDraft}
            onDraftChange={setStandaloneDraft}
            onPost={handleAddNote}
            isPosting={isPostingNote}
            inputRef={standaloneInputRef}
          />
        </div>

        {/* ─── Right: rail. BillRailFee sibling on fee-no-dollar
             (STL-FL only today); BillRail on per-meal. Zero edits
             inside BillRail per owner Ruling 2 - the sibling keeps
             per-meal untouched by construction. ─── */}
        <aside
          id="sc-v2-entry-rail-mobile"
          className="sc-v2-entry-rail"
          aria-label={feeNoDollar ? "Confirmation summary" : "Forming invoice"}
        >
          {feeNoDollar ? (
            <BillRailFee
              serviceGroups={activeGroups}
              day={day}
              editValues={editValues}
              touched={touched}
              hasTouchedAny={hasTouchedAny}
              enteredCount={enteredCount}
              totalToEnter={totalToEnter}
              periodStats={periodStats}
            />
          ) : (
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
            />
          )}
        </aside>
      </div>

      {/* B3 (2026-07-24): pinned actions row per §8C. Desktop-only
          via CSS media query; mobile keeps its MobileBooksBar stickyAction
          below. Confirm & save was previously the last child of BillRail
          which lives inside a scrollable rail column - at 555px viewport
          the button rendered at y=754 (below the fold). Pinning it here,
          as a sibling of the pane rather than a child, keeps it visible
          at every supported height. Day total shown alongside for
          §8C's "day total + Confirm & save" contract. */}
      <div className="sc-v2-entry-actions">
        <div className="sc-v2-entry-actions-total">
          {feeNoDollar ? (
            <>
              {/* Fee-no-dollar: no currency in the actions total.
                  The label reads "Served" and the value is the sum
                  of typed counts (entered) or projections (pristine). */}
              <span className="sc-v2-entry-actions-total-label">
                {hasTouchedAny ? "Served" : "Scheduled"}
              </span>
              <span className="sc-v2-entry-actions-total-value">
                {(() => {
                  let n = 0;
                  for (const g of serviceGroups) {
                    for (const s of g.services) {
                      if (!isInServiceOnDay(s, day.date)) continue;
                      if (hasTouchedAny) {
                        const v = editValues[s.colIndex];
                        if (v !== "" && v !== undefined && touched.has(s.colIndex)) n += Number(v) || 0;
                      } else {
                        n += day.projected[s.colIndex] ?? 0;
                      }
                    }
                  }
                  return `${hasTouchedAny ? "" : "~"}${n.toLocaleString()} served`;
                })()}
              </span>
            </>
          ) : (
            <>
              <span className="sc-v2-entry-actions-total-label">
                {hasTouchedAny ? "Day total" : "Projected"}
              </span>
              <span className="sc-v2-entry-actions-total-value">
                {hasTouchedAny ? "" : "~"}{fmt$(hasTouchedAny ? enteredTotals.revenue : dayProjection.revenue)}
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          ref={primaryBtnRef}
          className="sc-v2-entry-rail-cta"
          onClick={executeConfirm}
          disabled={!hasTouchedAny || saving}
        >
          {saving ? "Saving..." : "Confirm & save"}
        </button>
      </div>

      {/*
        W9 PR 1/2 - the entry's mobile footer is unified into the
        shared MobileBooksBar shell (bar + stickyAction). Bar-only
        mode (no `children` passed) so no aside/backdrop is emitted -
        entry's rail overlay is still the pre-existing
        `.sc-v2-entry-rail` aside inside `.sc-v2-entry-pane`, toggled
        by the `sc-v2-entry--mobile-bill-open` root class + CSS. What
        changed vs W7 PR 3: the bar + Confirm markup + CSS are the
        SHARED shell now; `mobileBillOpen` is threaded through
        MobileBooksBar's controlled `open`/`onOpenChange` so the
        day-nav reset effect still clears it. All figures pass
        through unchanged (Entered/Projected label + revenue +
        entered count + Confirm through executeConfirm with the same
        `!hasTouchedAny || saving` disable + saving label).

        Bar label formatting matches the pre-unification voice:
        "Entered $X.XX" vs "Projected ~$X.XX". The bar-status slot
        carries the entered/total count.
      */}
      <MobileBooksBar
        barLabel={hasTouchedAny ? (feeNoDollar ? "Confirmed" : "Entered") : (feeNoDollar ? "Scheduled" : "Projected")}
        barValue={
          feeNoDollar
            ? (() => {
                let n = 0;
                for (const g of serviceGroups) {
                  for (const s of g.services) {
                    if (!isInServiceOnDay(s, day.date)) continue;
                    if (hasTouchedAny) {
                      const v = editValues[s.colIndex];
                      if (v !== "" && v !== undefined && touched.has(s.colIndex)) n += Number(v) || 0;
                    } else {
                      n += day.projected[s.colIndex] ?? 0;
                    }
                  }
                }
                return `${hasTouchedAny ? "" : "~"}${n.toLocaleString()} served`;
              })()
            : `${hasTouchedAny ? "" : "~"}${fmt$(hasTouchedAny ? enteredTotals.revenue : dayProjection.revenue)}`
        }
        barStatus={`${enteredCount} of ${totalToEnter} ${feeNoDollar ? "confirmed" : "entered"}`}
        open={mobileBillOpen}
        onOpenChange={setMobileBillOpen}
        controlsId="sc-v2-entry-rail-mobile"
        stickyAction={(
          <button
            type="button"
            className="sc-v2-entry-mobile-confirm"
            onClick={executeConfirm}
            disabled={!hasTouchedAny || saving}
          >
            {saving ? "Saving..." : "Confirm & save"}
          </button>
        )}
      />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// GroupBlock - one service group's rows.
// Renders per DayDetail.js:837-914 renderServiceRow (per-meal branch)
// with the same input/chip/rate/amount composition.
// ═════════════════════════════════════════════════════════════════
// Exported for reuse by v2 bulk (owner Ruling 2, 2026-07-24: reuse
// in place, do not extract a new primitive yet). Bulk custom-entry
// panel imports this to render its per-group cards without authoring
// a parallel .bulk-* variant - the same classes drive both surfaces,
// which is what the computed-style diff on gate protects.
//
// hideAmount prop: bulk custom-entry omits the per-day Amount column
// (amounts vary by day). ServiceRow drops its amount cell; group
// footer drops its amount span; caller must apply the CSS variant
// class .sc-day-ledger--no-amount on the wrapper (defined in
// dayEntryV2.css). Match / projections / entry stays 4-col.
export function GroupBlock({
  group, day, editValues, touched, flashMap, accountSegment,
  onChange, onFillProjections,
  groupSummary, projectedGroupSummary,
  expanded,
  hideAmount = false,
  unit = "meals",   // Phase 2B: fee-no-dollar variant passes "served"
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
      <div className={`sc-day-ledger${hideAmount ? " sc-day-ledger--no-amount" : ""}`}>
        {hideAmount ? LEDGER_HEAD_NO_AMOUNT : LEDGER_HEAD}
        {group.services.map(s => (
          <ServiceRow
            key={s.colIndex}
            svc={s}
            day={day}
            editValues={editValues}
            touched={touched}
            flashDelay={flashMap?.get(s.colIndex)}
            onChange={onChange}
            hideAmount={hideAmount}
          />
        ))}
      </div>
      <footer className="sc-v2-entry-group-subtotal">
        <span className="sc-v2-entry-group-subtotal-label">
          {gsEntered.meals.toLocaleString()} {unit}
        </span>
        {!hideAmount && (
          <span className="sc-v2-entry-group-subtotal-amount">
            {fmt$(gsEntered.revenue)}
          </span>
        )}
      </footer>
    </section>
  );
}

// One service row - reuses the v1 CSS class names so the atom style
// inherits automatically. See DayDetail.js:837-914 for the shape.
// Exported alongside GroupBlock (2026-07-24, owner Ruling 2) for
// bulk custom-entry reuse.
// hideAmount omits the trailing amount cell; caller's ledger wrapper
// must carry .sc-day-ledger--no-amount so the subgrid is 3-col.
export function ServiceRow({ svc, day, editValues, touched, flashDelay, onChange, hideAmount = false }) {
  const projVal = day.projected[svc.colIndex] ?? 0;
  const editVal = editValues[svc.colIndex] ?? "";
  const isTouched = touched.has(svc.colIndex);
  const isEmpty = editVal === "";
  const inService = isInServiceOnDay(svc, day.date);
  const archiveDate = !inService ? String(svc.activeUntil).slice(0, 10) : null;
  // W7 PR 2/3 motion: `flashDelay` is a stagger delay in ms (0 for
  // single-input flash; N*60 for the Match-projections cascade). When
  // defined, the row gets the `sc-v2-entry-row--flash` class + inline
  // animation-delay style. Undefined = no class = no animation.
  const isFlashing = flashDelay != null;

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
    <div
      className={`sc-day-row sc-day-row--ledger${!inService ? " sc-day-row--archived" : ""}${isFlashing ? " sc-v2-entry-row--flash" : ""}`}
      style={isFlashing ? { animationDelay: `${flashDelay}ms` } : undefined}
    >
      <div className="sc-day-row-left">
        <span className="sc-day-row-name">{svc.name}</span>
      </div>
      <span className="sc-day-row-rate">{renderRate(svc, rate, unit)}</span>
      {qtyCell}
      {!hideAmount && (
        <span className="sc-day-row-amount">
          {svc.isNonRevenue
            ? <span className="sc-day-amount-none" title="Not billed">—</span>
            : entered
              ? fmt$(Number(editVal) * rate)
              : inService
                ? <span className="sc-day-amount-ghost">~{fmt$(projVal * rate)}</span>
                : <span className="sc-day-amount-pending">–</span>}
        </span>
      )}
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
}) {
  // B3 (2026-07-24): the Confirm & save block was extracted from here
  // to a pinned actions row in the parent (DayEntryV2). Rail now
  // renders label + hero + progress + invoice + ride-along note.
  // Hero value: entered total (from touched services) when the operator
  // has touched something, otherwise the projected total. Matches
  // DayDetail's SC-072 "entered-only from first entry onward" rule.
  const heroValue = hasTouchedAny ? enteredTotals.revenue : dayProjection.revenue;
  const heroAnimated = useAnimatedNumber(heroValue);

  // W7 PR 2/3 motion: total pulse. A brief scale/glow tick when the
  // hero value changes. Toggled via a `sc-v2-entry-rail-hero--pulse`
  // class that CSS keyframes for --duration-slow, then clears via a
  // timeout. Same reduced-motion behavior at the token layer (rules
  // wrapped in a prefers-reduced-motion: no-preference query).
  const heroRef = useRef(null);
  const lastHeroRef = useRef(heroValue);
  useEffect(() => {
    if (lastHeroRef.current === heroValue) return;
    lastHeroRef.current = heroValue;
    const el = heroRef.current;
    if (!el) return;
    el.classList.remove("sc-v2-entry-rail-hero--pulse");
    // eslint-disable-next-line no-unused-expressions
    void el.offsetWidth; // force reflow so animation re-triggers
    el.classList.add("sc-v2-entry-rail-hero--pulse");
    const timer = setTimeout(() => el?.classList.remove("sc-v2-entry-rail-hero--pulse"), 400);
    return () => clearTimeout(timer);
  }, [heroValue]);

  const pctComplete = totalToEnter > 0 ? Math.round((enteredCount / totalToEnter) * 100) : 0;

  // W7 PR 3/3 P1.2 pristine-rail anchor - the affordance line names the
  // first ghost input the auto-focus effect will land on. Derived
  // inline from the SAME predicate the effect uses
  // (`querySelector(".sc-day-input--ghost")`), which matches an input
  // NOT (isTouched && !isEmpty). Pure prop-derived - no memo, no state,
  // recomputed each render but N is small and skipped once anything is
  // entered.
  let firstGhostName = null;
  if (!hasTouchedAny && totalToEnter > 0) {
    outer: for (const g of serviceGroups) {
      for (const s of g.services) {
        if (!isInServiceOnDay(s, day.date)) continue;
        const editVal = editValues[s.colIndex] ?? "";
        const isTouched = touched.has(s.colIndex);
        if (!(isTouched && editVal !== "")) {
          firstGhostName = s.name;
          break outer;
        }
      }
    }
  }

  return (
    <div className="sc-v2-entry-rail-shell">
      <div className="sc-v2-entry-rail-label">
        {hasTouchedAny ? "ENTERED" : "PROJECTED"}
      </div>
      <div ref={heroRef} className={`sc-v2-entry-rail-hero${!hasTouchedAny ? " sc-v2-entry-rail-hero--pristine" : ""}`}>
        {/*
          W7 PR 2/3 aria-live note: the visible value ticks through
          useAnimatedNumber's ~250ms ease. Modern SR implementations
          debounce polite announcements to the settled reading, but to
          make the guarantee explicit we hoist the announcement onto
          a SEPARATE sc-visually-hidden span that carries the settled
          value only (updates when heroValue - the target - changes,
          not per animation frame). The visible span keeps the visual
          tick without a live-region tag on it.
        */}
        <span className="sc-v2-entry-rail-hero-value" aria-hidden="true">
          {hasTouchedAny ? "" : "~"}{fmt$(heroAnimated)}
        </span>
        <span className="sc-visually-hidden" aria-live="polite">
          {hasTouchedAny ? "Entered total " : "Projected total "}{fmt$(heroValue)}
        </span>
        <span className="sc-v2-entry-rail-hero-meta">
          {summary.meals.toLocaleString()} meals · {enteredCount} of {totalToEnter} services entered
        </span>
        {firstGhostName && (
          <span className="sc-v2-entry-rail-affordance">
            0 of {totalToEnter} entered - start with <strong>{firstGhostName}</strong>
          </span>
        )}
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

      {/* Phase 1 Ledger (2026-07-24): ride-along note removed per
          owner redline #8 - one note location, not two. The Ledger's
          composer (posts immediately via sc-add-note) is the single
          note surface now. rideNote prop path preserved server-side
          for queued replays that stored one before this PR; new saves
          from this UI never populate it. */}

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
// LedgerBand - the day's Ledger (§8, Phase 1).
// Composer on top (notes post immediately via sc-add-note - the hint
// under the button says so). Chronological event stream beneath,
// newest first. Row types (produced by groupActivity above):
//   note            - always-visible body text
//   edit-event      - summary "Kevin updated N services"; click to
//                     expand a per-service `old -> new` detail block
//   edit-noservice  - "Marked no service" system row
//   first-entered   - "Kevin entered counts" - synthesized from the
//                     day's earliest sc_daily_actuals.created_at
// Only edit-event is expandable (the others are single-line facts).
// Expansion state is LOCAL to this component - not persisted, not
// lifted; opening a modal opens all events collapsed.
// ═════════════════════════════════════════════════════════════════
function LedgerBand({ entries, draft, onDraftChange, onPost, isPosting, inputRef }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (key) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return (
    <section className="sc-v2-entry-ledger" aria-label="Ledger">
      <div className="sc-v2-entry-ledger-head">
        <h3 className="sc-v2-entry-ledger-title">Ledger</h3>
      </div>
      <div className="sc-v2-entry-ledger-composer">
        <input
          ref={inputRef}
          type="text"
          className="sc-v2-entry-ledger-input"
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
          className="sc-v2-entry-ledger-post"
          onClick={onPost}
          disabled={isPosting || !(draft || "").trim()}
        >
          {isPosting ? "..." : "Add note"}
        </button>
      </div>
      <p className="sc-v2-entry-ledger-hint">Notes post immediately - no need to save.</p>
      {entries.length > 0 && (
        <ul className="sc-v2-entry-ledger-list">
          {entries.map((e) => {
            const isExpandable = e.type === "edit-event";
            const isOpen = isExpandable && expanded.has(e.key);
            const nEntries = e.entries?.length || 0;
            return (
              <li
                key={e.key}
                className={`sc-v2-entry-ledger-item sc-v2-entry-ledger-item--${e.type}${isOpen ? " sc-v2-entry-ledger-item--open" : ""}`}
              >
                <div
                  className={`sc-v2-entry-ledger-row${isExpandable ? " sc-v2-entry-ledger-row--toggle" : ""}`}
                  onClick={isExpandable ? () => toggle(e.key) : undefined}
                  role={isExpandable ? "button" : undefined}
                  tabIndex={isExpandable ? 0 : undefined}
                  onKeyDown={isExpandable ? (evt) => {
                    if (evt.key === "Enter" || evt.key === " ") {
                      evt.preventDefault();
                      toggle(e.key);
                    }
                  } : undefined}
                  aria-expanded={isExpandable ? isOpen : undefined}
                >
                  <span className={`sc-v2-entry-ledger-pip sc-v2-entry-ledger-pip--${e.type}`} aria-hidden="true" />
                  <span className="sc-v2-entry-ledger-summary">
                    {e.type === "note" && e.note}
                    {e.type === "edit-event" && (
                      <>
                        <strong>{e.author || "Someone"}</strong>{" "}updated {nEntries} service{nEntries === 1 ? "" : "s"}
                      </>
                    )}
                    {e.type === "edit-noservice" && (
                      <>
                        <strong>{e.author || "Someone"}</strong>{" "}marked no service
                      </>
                    )}
                    {e.type === "first-entered" && (
                      <>
                        <strong>{e.author || "Someone"}</strong>{" "}entered counts
                      </>
                    )}
                  </span>
                  <span className="sc-v2-entry-ledger-stamp">{formatEntryStamp(e.timestamp)}</span>
                </div>
                {isOpen && (
                  <ul className="sc-v2-entry-ledger-detail">
                    {e.entries.map(en => (
                      <li key={en.serviceId} className="sc-v2-entry-ledger-detail-row">
                        <span className="sc-v2-entry-ledger-detail-name">{en.serviceName}</span>
                        <span className="sc-v2-entry-ledger-detail-arrow">
                          <span className="sc-v2-entry-ledger-detail-old">{en.oldValue}</span>
                          {" → "}
                          <span className="sc-v2-entry-ledger-detail-new">{en.newValue}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
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

// One dialog, two copy variants (owner Ruling 3, 2026-07-24):
//   hasEnteredCounts=false -> un-entered day, existing copy verbatim
//   hasEnteredCounts=true  -> entered day, destructive-warning copy
//                             with concrete meals/services summary
// No currency in either variant - server-derived; a wrong dollar
// figure in a destructive dialog is worse than no dollar figure.
function NoServiceConfirm({ onCancel, onConfirm, cancelBtnRef, dateLabel, hasEnteredCounts, enteredMeals, enteredServices, unit = "meal", feeNoDollar = false }) {
  const title = dateLabel ? `Mark ${dateLabel} as no service?` : "Mark as no service?";
  return (
    <div className="sc-v2-entry-modal" role="alertdialog" aria-modal="true">
      <div className="sc-v2-entry-modal-inner">
        <h4 className="sc-v2-entry-modal-title">{title}</h4>
        {hasEnteredCounts ? (
          <p className="sc-v2-entry-modal-body">
            This day has <strong>
              {feeNoDollar
                ? `${enteredMeals.toLocaleString()} served`
                : `${enteredMeals.toLocaleString()} meal${enteredMeals === 1 ? "" : "s"}`}
            </strong> {feeNoDollar ? "confirmed" : "recorded"} across <strong>{enteredServices} service{enteredServices === 1 ? "" : "s"}</strong>. Every service will be set to zero and an audit note added to the Ledger.
          </p>
        ) : (
          <p className="sc-v2-entry-modal-body">Every in-service service records zero. An audit note is appended.</p>
        )}
        <div className="sc-v2-entry-modal-actions">
          <button ref={cancelBtnRef} className="sc-btn sc-btn--outline" onClick={onCancel}>Cancel</button>
          <button className="sc-btn sc-btn--primary" onClick={onConfirm}>Mark no service</button>
        </div>
      </div>
    </div>
  );
}

export default forwardRef(DayEntryV2);

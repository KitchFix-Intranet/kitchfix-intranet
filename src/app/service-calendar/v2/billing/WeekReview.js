"use client";

// WeekReview - day-by-day approval gate before Finalize.
// 2026-09-08 (week-review-before-finalize feature).
//
// Spec authority: docs/design/KF_WEEK_REVIEW_RENDER.html (interactive
// mock, approved). Report + rulings: pre-build questions answered
// 2026-09-08 (state on sc_day_metadata; approvals persist and clear
// on any write to the day; Needs fix posts a "marked for fix" ledger
// note; biweekly pair is one 14-day review).
//
// Flow position:
//   Finalize button -> WeekReview -> (all approved) FinalizeOverlay
//                                 -> (any flagged)  close + open first
//                                                     flagged day
//
// Server contract:
//   GET  data: sc-week-review-data { accountKey, weekStart }
//              -> { span, days[] } with services + counts + amounts
//              + reviewStatus per day
//   POST vote: sc-review-day { accountKey, date, status }
//              status in ('approved','flagged')
//
// This component owns nothing but the review UI. It does not fire
// finalize; the parent's onAllApproved callback does that. It does
// not fire re-fetch of workspace data on close-to-fix; the parent's
// onFixFirstFlagged(date) call re-opens the day entry which already
// invalidates on save.

import { useEffect, useMemo, useRef, useState } from "react";

function fmtWeekTitle(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

function fmtWeekRange(start, end) {
  if (!start) return "";
  const opts = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
  const s = new Date(`${start}T12:00:00Z`).toLocaleDateString("en-US", opts);
  if (!end) return s;
  const e = new Date(`${end}T12:00:00Z`).toLocaleDateString("en-US", opts);
  return `${s} - ${e}`;
}

function fmtDayHead(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function fmtMoney(dollars) {
  const n = Number(dollars || 0);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// 2026-09-09 (operator-test fix #2): bucket a day's services by their
// group. Preserves first-appearance order for both groups and services
// within each group (server returns them in service-id order today, which
// tracks catalog sort-order after transform). A service with no groupName
// buckets under a single "__ungrouped__" section rendered header-less;
// this is a defensive fallback - every real catalog carries a group.
function groupServicesByGroup(services) {
  if (!Array.isArray(services) || services.length === 0) return [];
  const order = [];
  const byGroup = new Map();
  for (const s of services) {
    const key = s.groupName || "__ungrouped__";
    if (!byGroup.has(key)) {
      byGroup.set(key, { groupName: s.groupName || null, services: [] });
      order.push(key);
    }
    byGroup.get(key).services.push(s);
  }
  return order.map((k) => byGroup.get(k));
}

function focusableWithin(root) {
  if (!root) return [];
  const q =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll(q)).filter((el) => !el.hasAttribute("aria-hidden"));
}

export default function WeekReview({
  open,
  accountKey,
  weekStart,
  qboMode,              // 'test' | 'live' - drives the TEST MODE badge
  onCancel,             // fires from Cancel + Esc + backdrop
  onAllApproved,        // fires when the primary CTA is clicked with all days approved
  onFixFirstFlagged,    // (isoDate) => void; fires when the primary CTA is clicked with any flagged
  invokerRef,
}) {
  const scrimRef = useRef(null);
  const modalRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const [span, setSpan] = useState(null);
  const [days, setDays] = useState([]);
  // Track per-day in-flight status writes so the buttons show a
  // saving affordance and cannot double-fire.
  const [saving, setSaving] = useState(new Set());
  const [rowErr, setRowErr] = useState({}); // date -> error message

  // Fetch on open. Re-fetch each time open flips true so the review
  // reads latest state (a prior save could have cleared markers).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    fetch("/api/service-calendar", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sc-week-review-data", accountKey, weekStart }),
    })
      .then((r) => r.json().then((j) => ({ ok: r.ok, status: r.status, body: j })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok || !body?.success) {
          setLoadErr(body?.error || "Failed to load review data");
          setLoading(false);
          return;
        }
        setSpan(body.span);
        setDays(body.days);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadErr(e?.message || "Failed to load review data");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, accountKey, weekStart]);

  // Esc / Tab-trap / focus. Same shape as FinalizeOverlay.
  useEffect(() => {
    if (!open) return;
    const capturedInvoker = invokerRef?.current || null;
    const prevActive = document.activeElement;
    const raf = requestAnimationFrame(() => {
      const focusables = focusableWithin(modalRef.current);
      if (focusables.length === 0) {
        modalRef.current?.focus();
        return;
      }
      const preferred = modalRef.current?.querySelector("[data-autofocus]");
      const target = (preferred && focusables.includes(preferred)) ? preferred : focusables[0];
      target.focus();
    });
    function onKeyDown(e) {
      if (e.key === "Escape") { e.preventDefault(); onCancel?.(); return; }
      if (e.key !== "Tab") return;
      const focusables = focusableWithin(modalRef.current);
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      const target = capturedInvoker || prevActive;
      if (target && typeof target.focus === "function") {
        try { target.focus(); } catch (_) { /* ignore */ }
      }
    };
  }, [open, onCancel, invokerRef]);

  const summary = useMemo(() => {
    const approved = days.filter((d) => d.reviewStatus === "approved").length;
    const flagged  = days.filter((d) => d.reviewStatus === "flagged").length;
    const total    = days.length;
    const done     = approved + flagged;
    return { approved, flagged, total, done, allApproved: total > 0 && approved === total };
  }, [days]);

  if (!open) return null;

  const isTest = qboMode === "test";
  const isBiweekly = !!span?.isBiweekly && (span?.dates?.length === 14);
  const titleId = `sc-week-review-title-${weekStart || "x"}`;

  async function voteDay(date, status) {
    // Toggle: clicking the same status again is a no-op per the
    // render's aria-pressed toggle-back behaviour. Kevin's render
    // clears the mark on repeat click; the DB row set to NULL only
    // via write-invalidation is the safer server-side rule, so we
    // treat repeat-click as no-op here. Users unflag by clicking the
    // OTHER button.
    const current = days.find((d) => d.date === date)?.reviewStatus;
    if (current === status) return;
    setSaving((s) => { const n = new Set(s); n.add(date); return n; });
    setRowErr((e) => ({ ...e, [date]: undefined }));
    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sc-review-day", accountKey, date, status }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) {
        setRowErr((e) => ({ ...e, [date]: j?.error || `HTTP ${res.status}` }));
      } else {
        setDays((prev) => prev.map((d) => d.date === date
          ? { ...d, reviewStatus: status, reviewedBy: j.reviewedBy, reviewedAt: j.reviewedAt }
          : d));
      }
    } catch (err) {
      setRowErr((e) => ({ ...e, [date]: err?.message || "Save failed" }));
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(date); return n; });
    }
  }

  function handlePrimary() {
    if (summary.flagged > 0) {
      const firstFlagged = days.find((d) => d.reviewStatus === "flagged");
      if (firstFlagged) onFixFirstFlagged?.(firstFlagged.date);
      return;
    }
    if (summary.allApproved) onAllApproved?.();
  }

  const spanDaysLabel = isBiweekly ? "14" : "7";
  const progressPct = summary.total > 0 ? (summary.done / summary.total) * 100 : 0;

  return (
    <div
      className="sc-week-review-scrim"
      ref={scrimRef}
      onMouseDown={(e) => { if (e.target === scrimRef.current) onCancel?.(); }}
      data-open="true"
    >
      <div
        className="sc-week-review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="sc-week-review-head">
          <div className="sc-week-review-head-titleblock">
            <h2 id={titleId} className="sc-week-review-title">
              {isBiweekly
                ? `Review the bi-weekly pair ending ${fmtWeekTitle(weekStart)}`
                : `Review the week of ${fmtWeekTitle(weekStart)}`}
              {isTest && (
                <span className="sc-week-review-testtag" aria-label="Test mode">TEST MODE</span>
              )}
            </h2>
            <div className="sc-week-review-meta">
              {accountKey}
              {span ? ` · ${fmtWeekRange(span.spanStart, span.spanEnd)} · ${spanDaysLabel} service days` : ""}
            </div>
          </div>
        </div>

        <div className="sc-week-review-strip" role="note">
          Check each day against what was served.{" "}
          <b>Nothing is sent until every day is marked.</b>
        </div>

        <div className="sc-week-review-body">
          {loading && (
            <div className="sc-week-review-loading">Loading review...</div>
          )}
          {loadErr && (
            <div className="sc-week-review-loaderror" role="alert">
              Could not load review data: {loadErr}
            </div>
          )}
          {!loading && !loadErr && days.map((day, idx) => {
            const dayState = day.reviewStatus === "approved" ? "ok"
                            : day.reviewStatus === "flagged" ? "fix"
                            : null;
            const totalMeals = day.totals.actualMeals || day.totals.projectedMeals;
            const totalAmount = day.totals.actualRevenue;
            const proj = day.totals.projectedMeals;
            const varPct = proj > 0 ? Math.abs(totalMeals - proj) / proj : 0;
            const varChip = varPct > 0.4 && proj > 0
              ? { cls: "warn", text: `${totalMeals} vs ${proj} projected` }
              : { cls: "info", text: `${totalMeals} meal${totalMeals === 1 ? "" : "s"}` };
            const isSaving = saving.has(day.date);
            const err = rowErr[day.date];
            const hint = day.reviewStatus === "approved" ? "Marked approved"
                       : day.reviewStatus === "flagged" ? "Flagged - will open for editing"
                       : "Does this match what was served?";
            return (
              <div key={day.date} className="sc-week-review-day" data-review={dayState || ""}>
                <div className="sc-week-review-day-head">
                  <span className="sc-week-review-day-date">{fmtDayHead(day.date)}</span>
                  <span className={`sc-week-review-chip sc-week-review-chip--${varChip.cls}`}>
                    {varChip.text}
                  </span>
                  <span className="sc-week-review-grow" />
                  <span className="sc-week-review-day-total sc-week-review-num">
                    {fmtMoney(totalAmount)}
                  </span>
                </div>
                <div className="sc-week-review-svcs">
                  {day.services.length === 0 && (
                    <div className="sc-week-review-svc sc-week-review-svc--empty">
                      No services entered for this day.
                    </div>
                  )}
                  {/* 2026-09-09 (operator-test fix #2): group services by
                      groupName with a header per group. Prior flat render
                      showed TBJ - FL's MiLB "Dinner" and MLB "Dinner" as
                      two identical rows with nothing to distinguish them.
                      Grouped shape matches DayEntryV2's entry surface;
                      visual continuity between entry and review is worth
                      the header rows. Groups with no services simply
                      don't render - simple accounts (one group) see one
                      section header, same density as before. */}
                  {groupServicesByGroup(day.services).map((group) => (
                    <div key={group.groupName || "__ungrouped__"} className="sc-week-review-svc-group">
                      {group.groupName && (
                        <div className="sc-week-review-svc-group-header">
                          {group.groupName}
                        </div>
                      )}
                      {group.services.map((s) => (
                        <div key={s.serviceId} className="sc-week-review-svc">
                          <span className="sc-week-review-svc-name">{s.serviceName}</span>
                          <span className="sc-week-review-svc-qty sc-week-review-num">
                            {s.hasActual ? s.actualCount : "-"}
                          </span>
                          <span className="sc-week-review-svc-amt sc-week-review-num">
                            {s.hasActual ? fmtMoney(s.actualRevenue) : "-"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="sc-week-review-day-foot">
                  <span className="sc-week-review-day-hint">{hint}</span>
                  {err && (
                    <span className="sc-week-review-day-err" role="alert">
                      {err}
                    </span>
                  )}
                  <span className="sc-week-review-grow" />
                  <div className="sc-week-review-seg" role="group" aria-label={`Mark ${fmtDayHead(day.date)}`}>
                    <button
                      type="button"
                      className="sc-week-review-seg-btn sc-week-review-seg-btn--ok"
                      aria-pressed={day.reviewStatus === "approved"}
                      disabled={isSaving}
                      onClick={() => voteDay(day.date, "approved")}
                      data-autofocus={idx === 0 ? "true" : undefined}
                    >
                      Approved
                    </button>
                    <button
                      type="button"
                      className="sc-week-review-seg-btn sc-week-review-seg-btn--fix"
                      aria-pressed={day.reviewStatus === "flagged"}
                      disabled={isSaving}
                      onClick={() => voteDay(day.date, "flagged")}
                    >
                      Needs fix
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sc-week-review-foot">
          <div className="sc-week-review-progress">
            <div className="sc-week-review-progress-title">
              {summary.flagged > 0
                ? `${summary.flagged} day${summary.flagged === 1 ? "" : "s"} flagged`
                : summary.done === summary.total && summary.total > 0
                  ? `All ${summary.total} days reviewed`
                  : `${summary.done} of ${summary.total} days reviewed`}
            </div>
            <div className="sc-week-review-progress-bar" aria-hidden="true">
              <span
                className="sc-week-review-progress-fill"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="sc-week-review-progress-sub">
              {summary.flagged > 0
                ? "Fixing takes you to the first flagged day. The week stays unfinalized."
                : summary.allApproved
                  ? "Every day approved. Ready to send."
                  : "Mark each day Approved or Needs fix to continue."}
            </div>
          </div>
          <button
            type="button"
            className="sc-week-review-btn sc-week-review-btn--ghost"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={
              summary.flagged > 0
                ? "sc-week-review-btn sc-week-review-btn--fix"
                : "sc-week-review-btn sc-week-review-btn--go"
            }
            disabled={!(summary.flagged > 0 || summary.allApproved)}
            onClick={handlePrimary}
          >
            {summary.flagged > 0
              ? `Fix ${summary.flagged} day${summary.flagged === 1 ? "" : "s"}`
              : "Finalize and send to billing"}
          </button>
        </div>
      </div>
    </div>
  );
}

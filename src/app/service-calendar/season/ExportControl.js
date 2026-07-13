"use client";

// ExportControl - the operator export CTA (render J2).
//
// Chrome-right position, immediately LEFT of the Today chip. Renders a
// 32px bordered square carrying the download glyph. Click opens a
// dropdown menu:
//
//   Drill-in (period / month):
//     - Excel workbook (this scope)
//     - PDF - this month OR PDF - this period (whichever matches scope)
//     - Excel full year YYYY (year fallback, existing pattern)
//
//   Overview (year):
//     - Excel workbook (full year)
//     - PDF - season schedule (SCHEDULE-ACCOUNT-ONLY - gated on
//       has_homestand_schedule || has_schedule_overlay)
//     - PDF - year at a glance (ALL ACCOUNTS, since Wave 2 #420 -
//       per-meal PDCs get their service rhythm on a page too)
//
// #419 (2026-07-13): the menu was originally Excel-only with a scope-
// aware Item 1 + a year fallback. Wave 1 of the SC print export
// extends it to a flat list of format-explicit items. The UX shape
// choice was: FLAT LIST rather than a Format submenu, so operators
// can see every option at a glance and pick with one click. If we
// ever ship a third format the flat list stays manageable up to ~4
// items; beyond that, promote to a submenu.
//
// While a download is in flight the square becomes a spinner with
// aria-live="polite" and the tooltip flips to "Preparing..." (the
// specific artifact depends on the item clicked). Chrome around it
// stays interactive. Failures fall back to a toast (`showToast` prop)
// rather than a modal.
//
// Presentational + self-contained: the parent supplies scope + account
// + year + period/month + schedule-flag props + showToast, ExportControl
// owns the menu open state, keyboard handlers, and fetch.

import { useState, useRef, useEffect, useCallback } from "react";
import { Download } from "../Icons";
import "./exportControl.css";

export default function ExportControl({
  scope,               // "year" | "period" | "month"
  year,                // 2026
  periodKey,           // "P7" (when scope === "period")
  monthKey,            // "2026-07" (when scope === "month")
  accountKey,          // "CIN - AZ"
  showToast,           // (msg, kind?) => void
  // #419 (Wave 1): schedule flags gate the "PDF - season schedule"
  // menu item at year scope. Both default to false so the PDF item is
  // hidden for per-meal PDCs (which have no schedule to print).
  hasHomestandSchedule = false,
  hasScheduleOverlay   = false,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const firstItemRef = useRef(null);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus the first menu item when the menu opens.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      firstItemRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // #419: build a flat list of export items scoped to the current view.
  //
  //   Drill-in scopes (period / month):
  //     [Excel this scope, PDF this scope, Excel full year]
  //   Year scope (overview):
  //     [Excel full year, PDF season schedule (if schedule flag on)]
  //
  // Order matters - the first item is the "default" the operator lands
  // on when the menu opens (autofocus below).
  const menuItems = buildMenuItems({
    scope, year, periodKey, monthKey, accountKey,
    hasHomestandSchedule, hasScheduleOverlay,
  });

  const startDownload = useCallback(async (item) => {
    if (!accountKey || !item) return;
    setOpen(false);
    setBusy(true);
    try {
      const res = await fetch(item.href, { credentials: "same-origin" });
      if (!res.ok) {
        let msg = "Export failed";
        try { const j = await res.json(); msg = j.error || msg; } catch { /* not JSON */ }
        showToast?.(msg, "error");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Filename is authoritative on the server via Content-Disposition,
      // but set the attr too for browsers that prefer the anchor hint.
      a.download = item.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // A small delay before revoke gives the browser time to hand the
      // blob to the download stack on iOS Safari + older Firefox.
      setTimeout(() => URL.revokeObjectURL(url), 250);
    } catch (err) {
      showToast?.(err?.message || "Export failed", "error");
    } finally {
      setBusy(false);
    }
  }, [accountKey, showToast]);

  const onMenuKeyDown = useCallback((e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = wrapRef.current?.querySelectorAll(".sc-export-menu-item");
    if (!items || items.length === 0) return;
    const list = [...items];
    const idx = list.indexOf(document.activeElement);
    const next = e.key === "ArrowDown"
      ? (idx < 0 ? 0 : (idx + 1) % list.length)
      : (idx <= 0 ? list.length - 1 : idx - 1);
    list[next].focus();
  }, []);

  return (
    <div className="sc-export" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={`sc-export-btn${busy ? " sc-export-btn--busy" : ""}`}
        aria-label={busy ? "Preparing workbook..." : "Export .xlsx"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        title={busy ? "Preparing workbook..." : "Export .xlsx"}
        disabled={busy || !accountKey}
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? (
          <span className="sc-export-spinner" aria-hidden="true" />
        ) : (
          <Download size="sm" />
        )}
      </button>
      {busy && (
        <span role="status" aria-live="polite" className="sc-visually-hidden">
          Preparing workbook...
        </span>
      )}
      {open && (
        <div
          className="sc-export-menu"
          role="menu"
          aria-label="Export format + scope"
          onKeyDown={onMenuKeyDown}
        >
          {menuItems.map((item, idx) => (
            <button
              key={item.key}
              ref={idx === 0 ? firstItemRef : null}
              type="button"
              role="menuitem"
              className={`sc-export-menu-item${item.disabled ? " sc-export-menu-item-disabled" : ""}`}
              onClick={() => { if (!item.disabled) startDownload(item); }}
              aria-disabled={item.disabled || undefined}
              title={item.disabledTitle || undefined}
            >
              <span className="sc-export-menu-item-label">
                {item.label}
                {item.comingSoon ? <span className="sc-export-menu-item-tag">COMING SOON</span> : null}
              </span>
              <span className="sc-export-menu-item-sub">{item.disabled ? item.disabledSub : item.filename}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── scope -> label + filename + href ──────────────────────────────────
// Filenames mirror the server's Content-Disposition so the tooltip
// preview matches what the browser actually downloads. Kept in sync
// with src/lib/export/scWorkbook.js buildFilename (xlsx) and
// src/app/api/service-calendar/print/route.js buildFilenameStem (pdf).

function todayDateStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function xlsxItem({ scope, year, periodKey, monthKey, accountKey }) {
  const safeAccount = String(accountKey).replace(/\s+/g, "");
  const dateStr = todayDateStr();
  if (scope === "year") {
    return {
      key: "xlsx-year",
      label: `Excel - full year ${year}`,
      filename: `KitchFix_SC_${safeAccount}_FY${year}_${dateStr}.xlsx`,
      href: `/api/service-calendar/export?account=${encodeURIComponent(accountKey)}&scope=year&year=${year}`,
    };
  }
  if (scope === "period") {
    const num = String(periodKey).replace(/^P/i, "");
    return {
      key: "xlsx-period",
      label: `Excel - Period ${num}`,
      filename: `KitchFix_SC_${safeAccount}_Period${num}_${dateStr}.xlsx`,
      href: `/api/service-calendar/export?account=${encodeURIComponent(accountKey)}&scope=period&year=${year}&period=${num}`,
    };
  }
  if (scope === "month") {
    const [yy, mm] = monthKey.split("-").map(Number);
    const monthName = new Date(yy, mm - 1, 1).toLocaleDateString("en-US", { month: "long" });
    return {
      key: "xlsx-month",
      label: `Excel - ${monthName}`,
      filename: `KitchFix_SC_${safeAccount}_${monthKey}_${dateStr}.xlsx`,
      href: `/api/service-calendar/export?account=${encodeURIComponent(accountKey)}&scope=month&year=${year}&month=${monthKey}`,
    };
  }
  return null;
}

// The PDC/PDCO drill PDF is PARKED behind Coming Soon per Kevin's ruling
// 2026-07-13. The redesign lives at docs/design/PDC_PRINT_REDESIGN.md;
// the current sheet was superseded-in-waiting so the menu greys the
// drill item + the route returns 404 for scope=month|period on these
// accounts. Excel + Season PDF + Ops Calendar PDF are UNTOUCHED - PDC/
// PDCO operators keep every other export. See buildMenuItems() below
// for the gating rule (drill items grey when has_homestand_schedule is
// false + has_schedule_overlay drives the PDCO/PDC split).
const PDC_DRILL_DISABLED_TITLE = "PDF print for this account is being redesigned - see docs/design/PDC_PRINT_REDESIGN.md";

function pdfMonthItem({ year, monthKey, accountKey, disabled }) {
  const safeAccount = String(accountKey).replace(/\s+/g, "");
  const dateStr = todayDateStr();
  const [yy, mm] = monthKey.split("-").map(Number);
  const monthName = new Date(yy, mm - 1, 1).toLocaleDateString("en-US", { month: "long" });
  const item = {
    key: "pdf-month",
    label: `PDF - ${monthName} schedule`,
    filename: `KitchFix_SC_${safeAccount}_${monthKey}_${dateStr}.pdf`,
    href: `/api/service-calendar/print?account=${encodeURIComponent(accountKey)}&scope=month&year=${year}&month=${monthKey}`,
  };
  if (disabled) {
    item.disabled = true;
    item.comingSoon = true;
    item.disabledTitle = PDC_DRILL_DISABLED_TITLE;
    item.disabledSub = "redesign in progress";
  }
  return item;
}

function pdfPeriodItem({ year, periodKey, accountKey, disabled }) {
  const safeAccount = String(accountKey).replace(/\s+/g, "");
  const dateStr = todayDateStr();
  const num = String(periodKey).replace(/^P/i, "");
  const item = {
    key: "pdf-period",
    label: `PDF - Period ${num} schedule`,
    filename: `KitchFix_SC_${safeAccount}_Period${num}_FY${year}_${dateStr}.pdf`,
    href: `/api/service-calendar/print?account=${encodeURIComponent(accountKey)}&scope=period&year=${year}&period=${num}`,
  };
  if (disabled) {
    item.disabled = true;
    item.comingSoon = true;
    item.disabledTitle = PDC_DRILL_DISABLED_TITLE;
    item.disabledSub = "redesign in progress";
  }
  return item;
}

function pdfSeasonItem({ year, accountKey }) {
  const safeAccount = String(accountKey).replace(/\s+/g, "");
  const dateStr = todayDateStr();
  return {
    key: "pdf-season",
    label: `PDF - season schedule`,
    filename: `KitchFix_SC_${safeAccount}_Season_FY${year}_${dateStr}.pdf`,
    href: `/api/service-calendar/print?account=${encodeURIComponent(accountKey)}&scope=season&year=${year}`,
  };
}

function pdfOpsCalendarItem({ year, accountKey }) {
  const safeAccount = String(accountKey).replace(/\s+/g, "");
  const dateStr = todayDateStr();
  // Wave 3 (#422) rename: "year at a glance" -> "ops calendar" to
  // reflect the v2 spec's compliance-signal focus (states + period
  // starts + spring bars; games do NOT appear here).
  return {
    key: "pdf-ops-calendar",
    label: `PDF - ops calendar`,
    filename: `KitchFix_SC_${safeAccount}_OpsCalendar_FY${year}_${dateStr}.pdf`,
    href: `/api/service-calendar/print?account=${encodeURIComponent(accountKey)}&scope=year&year=${year}`,
  };
}

function buildMenuItems({
  scope, year, periodKey, monthKey, accountKey,
  hasHomestandSchedule, hasScheduleOverlay,
}) {
  if (!accountKey || !year) return [];
  const items = [];
  const hasSchedule = !!(hasHomestandSchedule || hasScheduleOverlay);
  // Park gate (2026-07-13): PDC + PDCO drill PDFs are Coming Soon
  // pending the wall-poster redesign. PDC = neither flag; PDCO =
  // has_schedule_overlay only. MLB + AAA drill PDFs stay live.
  // See docs/design/PDC_PRINT_REDESIGN.md.
  const isPdcOrPdco = !hasHomestandSchedule;

  if (scope === "month" && monthKey) {
    items.push(xlsxItem({ scope, year, monthKey, accountKey }));
    items.push(pdfMonthItem({ year, monthKey, accountKey, disabled: isPdcOrPdco }));
    items.push(xlsxItem({ scope: "year", year, accountKey }));
  } else if (scope === "period" && periodKey) {
    items.push(xlsxItem({ scope, year, periodKey, accountKey }));
    items.push(pdfPeriodItem({ year, periodKey, accountKey, disabled: isPdcOrPdco }));
    items.push(xlsxItem({ scope: "year", year, accountKey }));
  } else if (scope === "year") {
    items.push(xlsxItem({ scope: "year", year, accountKey }));
    if (hasSchedule) {
      items.push(pdfSeasonItem({ year, accountKey }));
    }
    // #422 (Wave 3): "PDF - ops calendar" for ALL accounts (not
    // schedule-gated). Replaces "year at a glance" - the v2 sheet is
    // a compliance surface (state fills, period starts, spring, M/F
    // header chips), not a game-density heatmap.
    items.push(pdfOpsCalendarItem({ year, accountKey }));
  }
  return items.filter(Boolean);
}

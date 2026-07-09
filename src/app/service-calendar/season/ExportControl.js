"use client";

// ExportControl - the operator Excel-export CTA (render J2).
//
// Chrome-right position, immediately LEFT of the Today chip. Renders a
// 32px bordered square carrying the download glyph. Click opens a
// dropdown menu (render J1's anatomy):
//   - Item 1 is scope-aware (e.g. "Export Period 7" / "Export July"
//     / "Export full year 2026") with the filename as the subtitle.
//   - Item 2 "Export full year YYYY" is shown at period + month
//     scopes; hidden when the current scope is already the year.
//
// While a download is in flight the square becomes a spinner with
// aria-live="polite" and the tooltip flips to "Preparing workbook...".
// Chrome around it stays interactive. Failures fall back to a toast
// (`showToast` prop) rather than a modal.
//
// Presentational + self-contained: the parent supplies scope + account
// + year + period/month + showToast, ExportControl owns the menu open
// state, keyboard handlers, and fetch.

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

  const primary = deriveScopeItem({ scope, year, periodKey, monthKey, accountKey });
  const yearFallback = scope !== "year"
    ? deriveScopeItem({ scope: "year", year, accountKey })
    : null;

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
          aria-label="Export scope"
          onKeyDown={onMenuKeyDown}
        >
          {primary && (
            <button
              ref={firstItemRef}
              type="button"
              role="menuitem"
              className="sc-export-menu-item"
              onClick={() => startDownload(primary)}
            >
              <span className="sc-export-menu-item-label">{primary.label}</span>
              <span className="sc-export-menu-item-sub">{primary.filename}</span>
            </button>
          )}
          {yearFallback && (
            <button
              type="button"
              role="menuitem"
              className="sc-export-menu-item"
              onClick={() => startDownload(yearFallback)}
            >
              <span className="sc-export-menu-item-label">{yearFallback.label}</span>
              <span className="sc-export-menu-item-sub">{yearFallback.filename}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── scope -> label + filename + href ──────────────────────────────────
// Filename mirrors the server's buildFilename output so the tooltip
// preview matches what the browser actually downloads. Kept in sync
// with src/lib/export/scWorkbook.js buildFilename.

function deriveScopeItem({ scope, year, periodKey, monthKey, accountKey }) {
  if (!accountKey || !year) return null;
  const safeAccount = String(accountKey).replace(/\s+/g, "");
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (scope === "year") {
    return {
      label: `Export full year ${year}`,
      filename: `KitchFix_SC_${safeAccount}_FY${year}_${dateStr}.xlsx`,
      href: `/api/service-calendar/export?account=${encodeURIComponent(accountKey)}&scope=year&year=${year}`,
    };
  }
  if (scope === "period") {
    if (!periodKey) return null;
    const num = String(periodKey).replace(/^P/i, "");
    return {
      label: `Export Period ${num}`,
      filename: `KitchFix_SC_${safeAccount}_Period${num}_${dateStr}.xlsx`,
      href: `/api/service-calendar/export?account=${encodeURIComponent(accountKey)}&scope=period&year=${year}&period=${num}`,
    };
  }
  if (scope === "month") {
    if (!monthKey) return null;
    const [yy, mm] = monthKey.split("-").map(Number);
    const monthName = new Date(yy, mm - 1, 1).toLocaleDateString("en-US", { month: "long" });
    return {
      label: `Export ${monthName}`,
      filename: `KitchFix_SC_${safeAccount}_${monthKey}_${dateStr}.xlsx`,
      href: `/api/service-calendar/export?account=${encodeURIComponent(accountKey)}&scope=month&year=${year}&month=${monthKey}`,
    };
  }
  return null;
}

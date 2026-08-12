"use client";
// src/app/kpi/labor/components/Toast.js
//
// D2 P10 / P11 - toast primitive backing:
//   M2 save success ("View saved · undo dismiss auto-hide 6s")
//   M4 export toast ("Report generated · Open · Save copy")
//   B1 undo-toast for view delete ("View deleted · Undo" for 6s)
//
// One toast at a time. New toast replaces old. Escape dismisses.
// role="status" for non-blocking announcement. Container also acts as
// the B10 live region.

import { useEffect, useRef } from "react";

export function ToastHost({ toast, onDismiss }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!toast) return;
    const t = toast.durationMs ?? 6000;
    if (t > 0) {
      timerRef.current = setTimeout(() => onDismiss(), t);
    }
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [toast, onDismiss]);

  useEffect(() => {
    if (!toast) return;
    const onKey = (e) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast, onDismiss]);

  return (
    <div className="kpi-toast-host" aria-live="polite" aria-atomic="true">
      {toast && (
        <div className={`kpi-toast kpi-toast-${toast.tone || "info"}`} role="status">
          <span className="kpi-toast-msg">{toast.message}</span>
          {toast.actions?.map((a, i) => (
            <button
              key={i}
              type="button"
              className={`kpi-toast-btn ${a.emphasis === "primary" ? "kpi-toast-btn-primary" : ""}`}
              onClick={() => { a.onClick(); if (a.dismissAfter !== false) onDismiss(); }}
            >{a.label}</button>
          ))}
          <button type="button" className="kpi-toast-close" onClick={onDismiss} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  );
}

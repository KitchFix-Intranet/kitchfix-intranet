"use client";
import { useState } from "react";
import F from "@/app/ops/components/shared/F";

export default function HistoryEntry({ h, showAccount, prevTotal, isFirst }) {
  const [open, setOpen] = useState(false);
  const cats = [
    { l: "Food Cost", v: h.food, color: "#f59e0b" },
    { l: "Packaging", v: h.packaging, color: "#3b82f6" },
    { l: "Supplies", v: h.supplies, color: "#8b5cf6" },
    { l: "Snacks", v: h.snacks, color: "#10b981" },
    { l: "Beverages", v: h.beverages, color: "#ec4899" },
  ].filter((c) => c.v > 0);

  const total = h.total || 0;

  // Delta vs previous period
  const delta = prevTotal != null && prevTotal > 0
    ? { amount: total - prevTotal, pct: Math.round(((total - prevTotal) / prevTotal) * 100) }
    : null;

  return (
    <div className="oh-hx-timeline-row">
      {/* ── Timeline Spine ── */}
      <div className="oh-hx-spine">
        <div className={`oh-hx-dot${open ? " oh-hx-dot--active" : ""}`} />
        <div className="oh-hx-line" />
      </div>

      {/* ── Entry Card ── */}
      <div className={`oh-hx-card${open ? " oh-hx-card--open" : ""}`}>
        {/* ── Collapsed Header ── */}
        <div className="oh-hx-card-header" onClick={() => setOpen(!open)}>
          <div className="oh-hx-card-left">
            <span className="oh-hx-period-badge">{h.period}</span>
            <div className="oh-hx-card-info">
              {showAccount && <span className="oh-hx-account">{h.account}</span>}
<span className="oh-hx-date">Entered {F.dateShort(h.date)}</span>
            </div>
          </div>

          <div className="oh-hx-card-right">
            {/* Delta Badge */}
{delta && (
              <span className="oh-hx-delta">
                {delta.amount >= 0 ? "↑" : "↓"} {Math.abs(delta.pct)}%
              </span>
            )}
                        <span className="oh-hx-total">{F.money(total)}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              className={`oh-hx-chevron${open ? " oh-hx-chevron--open" : ""}`}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        {/* ── Mini Breakdown Bar (always visible) ── */}
        {total > 0 && (
          <div className="oh-hx-mini-bar-wrap">
            <div className="oh-hx-mini-bar">
              {cats.map((c) => (
                <div
                  key={c.l}
                  className="oh-hx-mini-seg"
                  style={{ width: `${(c.v / total) * 100}%`, backgroundColor: c.color }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Expanded Detail ── */}
        {open && (
          <div className="oh-hx-card-detail">
            {/* Category rows with inline proportion bars */}
            <div className="oh-hx-cats">
              {cats.map((c) => {
                const pct = total > 0 ? Math.round((c.v / total) * 100) : 0;
                return (
                  <div key={c.l} className="oh-hx-cat-row">
                    <div className="oh-hx-cat-left">
                      <span className="oh-hx-cat-dot" style={{ backgroundColor: c.color }} />
                      <span className="oh-hx-cat-label">{c.l}</span>
                    </div>
                    <div className="oh-hx-cat-right">
                      <div className="oh-hx-cat-bar-track">
                        <div className="oh-hx-cat-bar-fill" style={{ width: `${pct}%`, backgroundColor: c.color }} />
                      </div>
                      <span className="oh-hx-cat-val">{F.money(c.v)}</span>
                      <span className="oh-hx-cat-pct">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total */}
            <div className="oh-hx-cat-total">
              <span>Total</span>
              <span>{F.money(total)}</span>
            </div>

            {/* Delta callout */}
{delta && (
              <div className="oh-hx-delta-callout">
                <span className="oh-hx-delta-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                </span>
                <span>
                  {delta.amount >= 0 ? "+" : ""}${Math.abs(Math.round(delta.amount)).toLocaleString()} ({delta.amount >= 0 ? "+" : ""}{delta.pct}%) vs previous period
                </span>
              </div>
            )}
            {/* Notes callout */}
            {h.notes && (
              <div className="oh-hx-notes-callout">
                <span className="oh-hx-notes-label">Notes</span>
                <span className="oh-hx-notes-text">{h.notes}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
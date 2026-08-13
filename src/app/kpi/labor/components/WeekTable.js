"use client";
// src/app/kpi/labor/components/WeekTable.js
//
// D2 P7 - table rebuild. Period groups (newest first), first two open
// by default. Sticky header with wrapper `overflow:clip` (B2 - never
// hidden). Collapsed-period subtotal follows the three-marker rule:
// dollars if any, "unpriced" if only unpriced hours, dash if truly
// empty. Single-week periods print no subtotal (spec §3.7).
// Conditional pnote row explains WHY a week is unpriced (pre-floor /
// current / other).
//
// K14 · **The drawer dies here.** Worker detail expands INLINE, sharing
// the seven-column grid. Kid rows indent + sunken background, per-
// worker badge, kid-note row states real-vs-inferred + D27 (dollars
// are never hours × rate).
//
// F16 - rate-on-hover title: `Name (#N) · ~$X.XX/hr avg in range`
// (D27-safe: derived $/hrs in the current range, never rendered as a
// column of its own).
//
// M5 - first 6 tbody rows get a 4px rise + 20ms stagger on first
// render; rows 7+ appear instantly.
//
// Esc collapses all open weeks (§3.7).

import { Fragment, useEffect, useRef } from "react";
import { fmt$, fmtHrs, fmtDate } from "../lib/formatting";

function workerLabel(meta, worker_id, redact) {
  const num = meta?.number != null ? `#${meta.number}` : `#${String(worker_id).slice(0, 6)}`;
  if (redact || !meta?.display_name) {
    const title = meta?.title ? ` · ${meta.title}` : "";
    return `${num}${title}`;
  }
  return `${meta.display_name} (${num})`;
}

// F16 - build the title attr with the range-avg rate for a worker.
// dr / dh / do / do_p / rh / rn = dollar and hour totals for this
// worker across the visible range (computed in the caller).
function workerTitle(baseLabel, workerRangeTotals) {
  if (!workerRangeTotals) return baseLabel;
  const { hoursWorked, dollarsTotal } = workerRangeTotals;
  if (hoursWorked <= 0 || dollarsTotal <= 0) return baseLabel;
  const rate = dollarsTotal / hoursWorked;
  return `${baseLabel} · ~$${rate.toFixed(2)}/hr avg in range`;
}

function badgeConfig(state) {
  return {
    complete:   { label: "Complete", cls: "kpi-bdg-complete",   icon: "check" },
    partial:    { label: "Partial",  cls: "kpi-bdg-partial",    icon: "warn"  },
    hours_only: { label: "Unpriced", cls: "kpi-bdg-unpriced",   icon: "wait"  },
    unknown:    { label: "Unknown",  cls: "kpi-bdg-unknown",    icon: "q"     },
    no_labor:   { label: "No labor", cls: "kpi-bdg-zero",       icon: "dash"  },
  }[state] || { label: state, cls: "kpi-bdg-zero", icon: "dash" };
}

function Badge({ state }) {
  const cfg = badgeConfig(state);
  return (
    <span className={`kpi-bdg ${cfg.cls}`} aria-label={`Coverage: ${cfg.label}`}>
      <span aria-hidden="true">
        {cfg.icon === "check" && "✓"}
        {cfg.icon === "warn" && "!"}
        {cfg.icon === "wait" && "◷"}
        {cfg.icon === "q" && "?"}
        {cfg.icon === "dash" && "—"}
      </span>{cfg.label}
    </span>
  );
}

// Cell renderer for hours - three markers:
//   — dash for null/zero
//   0.00 for genuinely-zero (never in this schema; we treat 0 as dash)
//   ? for unknown state
function HourCell({ v, coverage_state, warn }) {
  if (coverage_state === "unknown") return <span className="kpi-qm" aria-label="unknown">?</span>;
  if (v == null || Math.abs(v) < 0.004) return <span className="kpi-dash" aria-label="empty">—</span>;
  return <span className={warn ? "kpi-upw kpi-mono" : "kpi-mono"}>{fmtHrs(v)}</span>;
}

function DollarCell({ w }) {
  if (w.coverage_state === "unknown") return <span className="kpi-qm" aria-label="unknown">?</span>;
  if (w.amount == null) return <span className="kpi-dash" aria-label="no dollars available">—</span>;
  if (Math.abs(w.amount) < 0.004) return <span className="kpi-mono kpi-zr">$0.00</span>;
  return <span className="kpi-mono">{fmt$(w.amount)}</span>;
}

export function WeekTable({
  account,
  grouped,               // [{ key, fiscal_year, period_no, weeks: [...], subtotal }]
  grandTotal,            // { hours_regular, hours_overtime, hours_double_time, hours_without_dollars, amount }
  workers,               // { [worker_id]: { display_name, number, title } }
  redact,
  expandedPeriods,       // Set<period_no>
  onTogglePeriod,        // (period_no) => void
  expandedWeeks,         // Set<week_start>
  onToggleWeek,          // (week_start) => void
  onExpandAll,           // () => void
  onCollapseAll,         // () => void
  onJumpPeriod,          // (period_no) => void
  onEscape,              // () => void
  todayISO,
  workerRangeTotals,     // { [worker_id]: { hoursWorked, dollarsTotal } } - for F16 rate-on-hover
}) {
  const wrapRef = useRef(null);

  // M5 - first 6 tbody rows get animation class on first render.
  useEffect(() => {
    if (!wrapRef.current) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const rows = wrapRef.current.querySelectorAll("tbody tr");
    Array.from(rows).slice(0, 6).forEach((tr, i) => {
      tr.classList.add("kpi-tbl-anim");
      tr.style.animationDelay = `${i * 20}ms`;
      setTimeout(() => tr.classList.remove("kpi-tbl-anim"), 400 + i * 20);
    });
  }, [grouped]);

  // Esc collapses.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && expandedWeeks.size > 0) onEscape?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedWeeks, onEscape]);

  // Period jump chips + Expand/Collapse all. H8: chips cover every
  // group present, not just those with a non-null period_no. After H1
  // period_no is always an integer (>=1); 0 is the "prior FY" sentinel.
  const periods = grouped.map(g => g.period_no);
  const showChips = periods.length >= 2;

  return (
    <>
      {showChips && (
        <div className="kpi-jump-chips" aria-label="Jump to period">
          {periods.map(p => (
            <button
              key={p}
              type="button"
              className={`kpi-pjump ${expandedPeriods?.has(p) ? "open" : ""}`}
              onClick={() => onJumpPeriod?.(p)}
            >{p ? `P${p}` : "prior"}</button>
          ))}
          <span className="kpi-ttools">
            <button type="button" className="kpi-pjump" onClick={onExpandAll}>Expand all</button>
            <button type="button" className="kpi-pjump" onClick={onCollapseAll}>Collapse all</button>
          </span>
        </div>
      )}

      <div className="kpi-tw" ref={wrapRef}>
        <table className="kpi-tbl" aria-label={`Labor for ${account}`}>
          <caption className="kpi-sr">Weekly labor for {account}</caption>
          <thead>
            <tr>
              <th className="l" style={{ width: 190 }} scope="col">Week</th>
              <th className="l" style={{ width: 128 }} scope="col">Coverage</th>
              <th scope="col">Regular</th>
              <th scope="col">OT 1.5×</th>
              <th scope="col">Holiday 2×</th>
              <th scope="col" style={{ width: 96 }}>Unpriced</th>
              <th scope="col" style={{ width: 126 }}>Dollars</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(g => {
              const p = g.period_no;
              const isOpen = expandedPeriods?.has(p) ?? false;
              const rows = g.weeks;
              const sub = g.subtotal;

              // Note row - explain WHY a period has unpriced weeks, once
              const unp = rows.filter(w => w.coverage_state === "hours_only" || w.coverage_state === "partial");
              let noteText = null;
              if (unp.length > 0) {
                const preFloor = unp.every(w => w.week_start < "2026-04-20");
                const current = todayISO && p != null && rows.some(w => w.week_start <= todayISO && w.week_end >= todayISO);
                if (preFloor) noteText = "Dollars begin at the 2026-04-20 pay run · earlier weeks are unpriced by design; the P&L is authoritative.";
                else if (current) noteText = "Payroll for the open week has not computed yet · hours are known, dollars follow.";
                else noteText = "Some entries have no pay-segment coverage · see the unpriced column.";
              }

              // Collapsed-period tail cell (three-marker rule):
              // dollars if any, "unpriced" if only unpriced hours, dash if truly empty.
              const collapsedTail = sub.amount > 0.004
                ? <span className="kpi-mono">{fmt$(sub.amount)}</span>
                : sub.hours_without_dollars > 0.004
                  ? <span className="kpi-upw" style={{ fontSize: "var(--size-caption)" }}>unpriced</span>
                  : <span className="kpi-dash">—</span>;

              return (
                <Fragment key={g.key}>
                  <tr className={`kpi-perh ${isOpen ? "open" : ""}`} id={`kpi-per${p}`}>
                    <td colSpan={2} className="l">
                      <button
                        type="button"
                        className="kpi-perbtn"
                        onClick={() => onTogglePeriod?.(p)}
                        aria-expanded={isOpen}
                      >
                        <svg className="kpi-i kpi-chev" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        FY{g.fiscal_year || "?"} · PERIOD {p || "prior"}{isOpen ? "" : ` · ${rows.length} wk`}
                      </button>
                    </td>
                    {isOpen ? (
                      <td colSpan={5} />
                    ) : (
                      <>
                        <td><HourCell v={sub.hours_regular} coverage_state="complete" /></td>
                        <td><HourCell v={sub.hours_overtime} coverage_state="complete" /></td>
                        <td><HourCell v={sub.hours_double_time} coverage_state="complete" /></td>
                        <td><HourCell v={sub.hours_without_dollars} coverage_state="complete" warn /></td>
                        <td>{collapsedTail}</td>
                      </>
                    )}
                  </tr>
                  {isOpen && noteText && (
                    <tr className="kpi-pnoterow">
                      <td colSpan={7} className="l">
                        <span className="kpi-pnote">{noteText}</span>
                      </td>
                    </tr>
                  )}
                  {isOpen && rows.map(w => {
                    // Integrity guard from the collapse era.
                    if (w.coverage_state === "hours_only" && Math.abs(w.amount || 0) > 0.01) {
                      // eslint-disable-next-line no-console
                      console.warn("kpi-labor: unpriced week carries dollars", account, w.week_start, w.amount);
                    }
                    const wOpen = expandedWeeks?.has(w.week_start) ?? false;
                    const rowCls = `kpi-wk kpi-st-${w.coverage_state}${wOpen ? " open" : ""}`;
                    return (
                      <Fragment key={w.week_start}>
                        <tr className={rowCls}>
                          <td className="l">
                            <button
                              type="button"
                              className="kpi-wkbtn"
                              data-wk={w.week_start}
                              onClick={() => onToggleWeek?.(w.week_start)}
                              aria-expanded={wOpen}
                            >
                              <svg className="kpi-i kpi-chev" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              <span className="kpi-mono">{fmtDate(w.week_start)} – {fmtDate(w.week_end)}</span>
                            </button>
                          </td>
                          <td className="l"><Badge state={w.coverage_state} /></td>
                          <td><HourCell v={w.hours_regular} coverage_state={w.coverage_state} /></td>
                          <td><HourCell v={w.hours_overtime} coverage_state={w.coverage_state} /></td>
                          <td><HourCell v={w.hours_double_time} coverage_state={w.coverage_state} /></td>
                          <td><HourCell v={w.hours_without_dollars} coverage_state={w.coverage_state} warn /></td>
                          <td><DollarCell w={w} /></td>
                        </tr>
                        {wOpen && w.worker_rows && w.worker_rows.length > 0 && (
                          <>
                            {w.worker_rows.map(wr => {
                              const meta = workers?.[wr.worker_id];
                              const label = workerLabel(meta, wr.worker_id, redact);
                              const title = workerTitle(label, workerRangeTotals?.[wr.worker_id]);
                              return (
                                <tr key={wr.worker_id} className="kpi-kid">
                                  <td className="l">
                                    <span className="kpi-kidname" title={title}>{label}</span>
                                  </td>
                                  <td className="l"><Badge state={wr.coverage_state} /></td>
                                  <td><HourCell v={wr.hours_regular} coverage_state={wr.coverage_state} /></td>
                                  <td><HourCell v={wr.hours_overtime} coverage_state={wr.coverage_state} /></td>
                                  <td><HourCell v={wr.hours_double_time} coverage_state={wr.coverage_state} /></td>
                                  <td><HourCell v={wr.hours_without_dollars} coverage_state={wr.coverage_state} warn /></td>
                                  <td>{wr.amount > 0.004 ? <span className="kpi-mono">{fmt$(wr.amount)}</span> : <span className="kpi-dash">—</span>}</td>
                                </tr>
                              );
                            })}
                            <tr className="kpi-kid kpi-kid-note">
                              <td className="l" colSpan={7}>
                                Rippling pay-segment amounts, validated against paystubs. Dollars are never hours × rate (D27).
                              </td>
                            </tr>
                          </>
                        )}
                        {wOpen && (!w.worker_rows || w.worker_rows.length === 0) && (
                          <tr className="kpi-kid">
                            <td className="l" colSpan={7}>
                              <span className="kpi-dash">No per-worker detail for this week.</span>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {isOpen && rows.length > 1 && (
                    <tr className="kpi-sub">
                      <td className="l" colSpan={2}>Period {p} subtotal</td>
                      <td><HourCell v={sub.hours_regular} coverage_state="complete" /></td>
                      <td><HourCell v={sub.hours_overtime} coverage_state="complete" /></td>
                      <td><HourCell v={sub.hours_double_time} coverage_state="complete" /></td>
                      <td><HourCell v={sub.hours_without_dollars} coverage_state="complete" warn /></td>
                      <td>{sub.amount > 0.004 ? <span className="kpi-mono">{fmt$(sub.amount)}</span> : sub.hours_without_dollars > 0.004 ? <span className="kpi-upw" style={{ fontSize: "var(--size-caption)" }}>unpriced</span> : <span className="kpi-dash">—</span>}</td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {grandTotal && (
              <tr className="kpi-grand">
                <td className="l" colSpan={2}>Total · {grouped.length} period{grouped.length === 1 ? "" : "s"} with labor</td>
                <td><HourCell v={grandTotal.hours_regular} coverage_state="complete" /></td>
                <td><HourCell v={grandTotal.hours_overtime} coverage_state="complete" /></td>
                <td><HourCell v={grandTotal.hours_double_time} coverage_state="complete" /></td>
                <td><HourCell v={grandTotal.hours_without_dollars} coverage_state="complete" warn /></td>
                <td><span className="kpi-mono">{fmt$(grandTotal.amount)}</span></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}


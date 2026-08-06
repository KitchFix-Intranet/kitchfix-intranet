"use client";
// /kpi/labor
//
// Temporary labor-data test page. Admin-gated. Kevin only for now.
// Not a design surface - this exists so Kevin can look at the labor
// pipeline output and decide whether it is right. The first real KPI
// surface comes later.
//
// Three stacked tables: weekly summary, employee detail, unattributed.
// No charts, no exports, no saved views.

import { useEffect, useMemo, useState } from "react";

const ACCOUNTS = ["all", "CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO", "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];

function isoMondayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum);
  return d.toISOString().slice(0, 10);
}
function isoSundayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 6);
  return d.toISOString().slice(0, 10);
}
function fmt$(v) {
  if (v == null) return "-";
  return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtH(v) {
  if (v == null) return "-";
  return Number(v).toFixed(2);
}

const CONFIRMED_STATUSES = ["PAID", "FINALIZED"];
const PENDING_STATUSES = ["APPROVED", "DRAFT"];

function bucketDollars(approval, statuses) {
  let sum = 0;
  for (const st of statuses) sum += Number(approval?.[st]?.dollars || 0);
  return sum;
}
function bucketEntries(approval, statuses) {
  let sum = 0;
  for (const st of statuses) sum += Number(approval?.[st]?.entries || 0);
  return sum;
}
function pendingEntriesWithoutSegments(approval) {
  const stat = ["APPROVED", "DRAFT"];
  let entries = 0;
  let hours = 0;
  for (const st of stat) {
    entries += Number(approval?.[st]?.entries_without_segments || 0);
    hours += Number(approval?.[st]?.hours_without_segments || 0);
  }
  return { entries, hours };
}

export default function LaborPage() {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [account, setAccount] = useState("all");
  const [start, setStart] = useState(isoMondayOfWeek(today));
  const [end, setEnd] = useState(isoSundayOfWeek(today));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    const q = new URLSearchParams({ account, start, end }).toString();
    fetch(`/api/kpi/labor?${q}`, { credentials: "same-origin" })
      .then(r => r.json())
      .then(d => {
        if (!d.ok) throw new Error(d.error || "load failed");
        setData(d);
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [account, start, end]);

  // ─── Group by week for the summary table ──────────────────────
  const weeklySummary = useMemo(() => {
    if (!data) return [];
    const byWeek = new Map();
    for (const a of data.actuals) {
      const key = `${a.account_key}|${a.week_label}|${a.week_start}|${a.week_end}`;
      if (!byWeek.has(key)) {
        byWeek.set(key, {
          account_key: a.account_key,
          week_label: a.week_label,
          week_start: a.week_start,
          week_end: a.week_end,
          fiscal_year: a.fiscal_year,
          period_no: a.period_no,
          week_source: a.week_source,
          workers: new Set(),
          amount: 0,
          hours_regular: 0,
          hours_overtime: 0,
          confirmed_dollars: 0,
          pending_dollars: 0,
          needs_review_entries: 0,
          needs_review_hours: 0,
        });
      }
      const w = byWeek.get(key);
      w.workers.add(a.worker_id);
      w.amount += Number(a.amount || 0);
      w.hours_regular += Number(a.hours_regular || 0);
      w.hours_overtime += Number(a.hours_overtime || 0);
      w.confirmed_dollars += bucketDollars(a.approval_state, CONFIRMED_STATUSES);
      w.pending_dollars += bucketDollars(a.approval_state, PENDING_STATUSES);
      const nr = pendingEntriesWithoutSegments(a.approval_state);
      w.needs_review_entries += nr.entries;
      w.needs_review_hours += nr.hours;
    }
    return [...byWeek.values()].sort((a, b) => a.week_start.localeCompare(b.week_start) || a.account_key.localeCompare(b.account_key));
  }, [data]);

  // ─── Employee detail rows ────────────────────────────────────
  const employeeRows = useMemo(() => {
    if (!data) return [];
    return [...data.actuals].sort((a, b) => a.week_start.localeCompare(b.week_start) || a.account_key.localeCompare(b.account_key) || a.worker_id.localeCompare(b.worker_id));
  }, [data]);

  // Freshness banner - derived_at age with color-graded staleness.
  // The nightly workflow re-derives at ~07:00 UTC. "Fresh" is under
  // 30 hours (one nightly cycle plus buffer). Stale = missed a run.
  const freshness = useMemo(() => {
    if (!data?.derived_at) return null;
    const ageHrs = (Date.now() - new Date(data.derived_at).getTime()) / 3600000;
    if (ageHrs < 30) return { level: "fresh", bg: "#e6f4ea", fg: "#0a6d20", label: `Fresh - derived ${ageHrs.toFixed(1)}h ago` };
    if (ageHrs < 54) return { level: "aging", bg: "#fef7e0", fg: "#8a6d00", label: `Aging - derived ${ageHrs.toFixed(1)}h ago (nightly may have skipped)` };
    return { level: "stale", bg: "#fce8e6", fg: "#a50e0e", label: `STALE - derived ${(ageHrs / 24).toFixed(1)} days ago. Check Actions.` };
  }, [data?.derived_at]);

  return (
    <div style={{ padding: 20, fontFamily: "-apple-system, sans-serif", maxWidth: 1400, margin: "0 auto", color: "#111" }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>/kpi/labor</h1>
      <div style={{ color: "#555", fontSize: 12, marginTop: 4 }}>
        Temporary test surface. Admin-gated. Reads <code>labor_actuals_latest</code> + <code>labor_unattributed</code>. Never calls Rippling.
      </div>

      {/* Freshness banner - prominent so a stale figure is obvious from the
          page itself without opening the Actions tab. Nightly workflow
          re-derives at ~07:00 UTC; anything older than one cycle+buffer
          means the nightly stopped. */}
      {freshness && (
        <div style={{
          marginTop: 16,
          padding: "12px 16px",
          background: freshness.bg,
          color: freshness.fg,
          borderRadius: 4,
          fontSize: 14,
          fontWeight: 600,
          border: `1px solid ${freshness.fg}33`,
        }}>
          {freshness.label}
          <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 12, opacity: 0.8 }}>
            derived_at {new Date(data.derived_at).toLocaleString()}
          </span>
        </div>
      )}
      {data && !data.derived_at && (
        <div style={{
          marginTop: 16, padding: "12px 16px",
          background: "#fce8e6", color: "#a50e0e", borderRadius: 4,
          fontSize: 14, fontWeight: 600,
          border: "1px solid #a50e0e33",
        }}>
          No derivation on record - has <code>derive_labor_actuals.mjs</code> ever run?
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", marginTop: 16, padding: 12, background: "#f5f5f5", borderRadius: 4 }}>
        <label>
          <div style={{ fontSize: 11, color: "#666" }}>account</div>
          <select value={account} onChange={e => setAccount(e.target.value)} style={{ padding: 6, minWidth: 160 }}>
            {ACCOUNTS.map(a => <option key={a} value={a}>{a === "all" ? "All accounts" : a}</option>)}
          </select>
        </label>
        <label>
          <div style={{ fontSize: 11, color: "#666" }}>start</div>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} style={{ padding: 6 }} />
        </label>
        <label>
          <div style={{ fontSize: 11, color: "#666" }}>end</div>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={{ padding: 6 }} />
        </label>
      </div>

      {loading && <div style={{ marginTop: 12, color: "#888" }}>loading...</div>}
      {err && <div style={{ marginTop: 12, color: "#c00" }}>error: {err}</div>}

      {data && !loading && !err && (
        <>
          {/* Weekly summary */}
          <h2 style={{ marginTop: 24, fontSize: 16 }}>Weekly summary</h2>
          {weeklySummary.length === 0 ? (
            <div style={{ padding: 20, background: "#fafafa", color: "#888", fontStyle: "italic" }}>
              no data in this range
            </div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Account</Th><Th>Week</Th><Th>Dates</Th>
                  <Th right>Total $</Th><Th right>Reg hrs</Th><Th right>OT hrs</Th>
                  <Th right>Employees</Th>
                  <Th right>Confirmed $</Th><Th right>Pending $</Th>
                  <Th right>Needs review</Th>
                  <Th>Week src</Th>
                </tr>
              </thead>
              <tbody>
                {weeklySummary.map((w, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                    <Td>{w.account_key}</Td>
                    <Td>{w.week_label}</Td>
                    <Td>{w.week_start} - {w.week_end}</Td>
                    <Td right>{fmt$(w.amount)}</Td>
                    <Td right>{fmtH(w.hours_regular)}</Td>
                    <Td right>{fmtH(w.hours_overtime)}</Td>
                    <Td right>{w.workers.size}</Td>
                    <Td right><strong>{fmt$(w.confirmed_dollars)}</strong></Td>
                    <Td right style={{ color: "#a55" }}>{w.pending_dollars > 0 ? "~" + fmt$(w.pending_dollars) : "-"}</Td>
                    <Td right>{w.needs_review_entries > 0 ? `${w.needs_review_entries} (${fmtH(w.needs_review_hours)} hrs)` : "-"}</Td>
                    <Td style={{ fontSize: 11, color: w.week_source === "iso_fallback" ? "#a55" : "#888" }}>{w.week_source}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Employee detail */}
          <h2 style={{ marginTop: 32, fontSize: 16 }}>Employee detail</h2>
          {employeeRows.length === 0 ? (
            <div style={{ padding: 20, background: "#fafafa", color: "#888", fontStyle: "italic" }}>
              no data in this range
            </div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Account</Th><Th>Week</Th><Th>Employee</Th>
                  <Th right>Reg hrs</Th><Th right>OT hrs</Th><Th right>Total $</Th>
                  <Th>Status breakdown</Th>
                </tr>
              </thead>
              <tbody>
                {employeeRows.map((r, i) => {
                  const w = data.workers[r.worker_id];
                  const name = w?.display_name || `worker-${r.worker_id.slice(0, 8)}`;
                  const breakdown = Object.entries(r.approval_state || {}).map(([st, v]) => {
                    if ((v?.entries || 0) === 0 && (v?.dollars || 0) === 0) return null;
                    return `${st}: ${v.entries}e ${fmt$(v.dollars)}${v.entries_without_segments > 0 ? ` (+${v.entries_without_segments} no-seg, ${fmtH(v.hours_without_segments)}h)` : ""}`;
                  }).filter(Boolean).join(" · ");
                  return (
                    <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                      <Td style={{ fontSize: 11 }}>{r.account_key}</Td>
                      <Td>{r.week_label}</Td>
                      <Td title={r.worker_id}>{name}</Td>
                      <Td right>{fmtH(r.hours_regular)}</Td>
                      <Td right>{fmtH(r.hours_overtime)}</Td>
                      <Td right>{fmt$(r.amount)}</Td>
                      <Td style={{ fontSize: 11, color: "#666" }}>{breakdown || "-"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Unattributed - always rendered even when empty (a section that disappears when clean teaches people not to look for it) */}
          <h2 style={{ marginTop: 32, fontSize: 16 }}>Unattributed</h2>
          {data.unattributed.length === 0 ? (
            <div style={{ padding: 20, background: "#f0f8f0", color: "#080", fontStyle: "italic" }}>
              none
            </div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Reason</Th><Th>Dept ID</Th><Th>Dept name</Th><Th>Worker ID</Th>
                  <Th>Date</Th><Th right>$</Th><Th right>Hours</Th><Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {data.unattributed.map((u, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #eee" }}>
                    <Td style={{ color: "#a55" }}>{u.reason_code}</Td>
                    <Td style={{ fontSize: 11 }}>{u.department_id || "-"}</Td>
                    <Td>{u.department_name || "-"}</Td>
                    <Td style={{ fontSize: 11 }}>{u.worker_id || "-"}</Td>
                    <Td>{u.segment_date || "-"}</Td>
                    <Td right>{u.amount != null ? fmt$(u.amount) : "-"}</Td>
                    <Td right>{u.hours != null ? fmtH(u.hours) : "-"}</Td>
                    <Td style={{ fontSize: 11, color: "#666" }}>{u.notes || "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Footer notes */}
          <div style={{ marginTop: 40, padding: 12, background: "#fafafa", fontSize: 11, color: "#666", borderRadius: 4, lineHeight: 1.6 }}>
            <div><strong>Confirmed $</strong> = PAID + FINALIZED. <strong>Pending $</strong> (~ prefix) = APPROVED + DRAFT dollars that already have pay_segments; treat as provisional.</div>
            <div><strong>Needs review</strong> = APPROVED or DRAFT entries with no pay_segment yet - Rippling has not costed those hours, and the dollar column does NOT include them.</div>
            <div><strong>OT rule</strong>: a segment is OT if <code>overtime_multiplier &gt; 1.0</code> OR <code>merged_earning_type_name</code> matches /overtime|OT/i. Applied to <code>segment_duration_hours</code>.</div>
            <div><strong>Week src</strong>: <code>sc_day_metadata</code> is the operating week; <code>iso_fallback</code> (in red) means the week came from ISO week-of-year because the date fell outside the service calendar.</div>
            <div><strong>Amount</strong> comes from <code>pay_segment.estimated_amount</code> - Rippling-computed (D27). Never hours × rate.</div>
          </div>
        </>
      )}
    </div>
  );
}

const tableStyle = { borderCollapse: "collapse", width: "100%", marginTop: 8, fontSize: 13 };
function Th({ children, right }) {
  return <th style={{ textAlign: right ? "right" : "left", padding: "6px 8px", background: "#eee", fontWeight: 600, fontSize: 11, textTransform: "uppercase" }}>{children}</th>;
}
function Td({ children, right, style, title }) {
  return <td title={title} style={{ padding: "6px 8px", textAlign: right ? "right" : "left", verticalAlign: "top", ...style }}>{children}</td>;
}

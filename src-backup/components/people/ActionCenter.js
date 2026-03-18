"use client";
import { useState, useMemo } from "react";

const FILTERS = [
  { id: "action", label: "Action", icon: "⚡" },
  { id: "pending", label: "Pending", icon: "📬" },
  { id: "done", label: "Done", icon: "✅" },
  { id: "all", label: "All", icon: "📁" },
];

function statusMatch(status, filter) {
  if (filter === "all") return true;
  if (filter === "action") return /Rejected|Action/i.test(status);
  if (filter === "pending") return /Pending/i.test(status);
  if (filter === "done") return /Complete|Approved/i.test(status);
  return true;
}

function StatusChip({ status }) {
  const s = String(status).toLowerCase();
  let cls = "pp-chip-pending";
  let label = status;
  if (/complete|approved/i.test(s)) { cls = "pp-chip-success"; label = "Complete"; }
  if (/rejected|action/i.test(s)) { cls = "pp-chip-danger"; label = "Action Required"; }
  return <span className={`pp-status-chip ${cls}`}>{label}</span>;
}

function DrawerRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="pp-drawer-row">
      <span className="pp-drawer-label">{label}</span>
      <span className="pp-drawer-val">{String(value)}</span>
    </div>
  );
}

function HistoryItem({ item, Formatter, expanded, onToggle, onResumeEdit }) {
  const isNewHire = item.module === "newhire";
  const isRejected = /Rejected|Action/i.test(item.status);
  let payload = {};
  try { payload = JSON.parse(item.payload); } catch (e) {}

  const iconClass = isRejected ? "pp-icon-alert" : isNewHire ? "pp-icon-nh" : "pp-icon-paf";
  const borderClass = isRejected ? "pp-row-rejected" : /Pending/i.test(item.status) ? "pp-row-pending" : "pp-row-approved";

  return (
    <div className={`pp-list-row ${borderClass}`} onClick={onToggle}>
      <div className={`pp-feed-icon ${iconClass}`}>
        {isNewHire ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <StatusChip status={item.status} />
          <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>
            {Formatter.toDate(item.date)}
          </span>
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#0f3057" }}>{item.title}</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>{item.subtitle}</div>

        {/* Expanded drawer */}
        {expanded && (
          <div className="pp-history-drawer" onClick={(e) => e.stopPropagation()}>
            {isNewHire ? (
              <>
                <DrawerRow label="Role" value={payload.jobTitle} />
                <DrawerRow label="Operation" value={payload.operation} />
                <DrawerRow label="Manager" value={payload.manager} />
                <DrawerRow label="Pay" value={payload.payRate ? `$${payload.payRate} (${payload.payType})` : null} />
                <DrawerRow label="Start" value={payload.startDate} />
              </>
            ) : (
              <>
                <DrawerRow label="Action" value={Formatter.toTitleCase(payload.actionType)} />
                <DrawerRow label="Effective" value={payload.effectiveDate} />
                <DrawerRow label="Old Rate" value={payload.oldRate ? Formatter.toMoney(payload.oldRate) : null} />
                <DrawerRow label="New Rate" value={payload.newRate ? Formatter.toMoney(payload.newRate) : null} />
                <DrawerRow label="Amount" value={payload.amount ? Formatter.toMoney(payload.amount) : null} />
              </>
            )}

            {/* Admin notes for rejected */}
            {isRejected && item.notes && (
              <div className="pp-reject-reason">{item.notes}</div>
            )}

            {/* Fix & Resubmit button */}
            {isRejected && (
              <div className="pp-action-row">
                <button className="pp-btn-fix" onClick={(e) => { e.stopPropagation(); onResumeEdit(item); }}>
                  Fix & Resubmit
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {!expanded && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2" style={{ flexShrink: 0, marginLeft: 8 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  );
}

export default function ActionCenter({ history, onResumeEdit, Formatter }) {
  const [filter, setFilter] = useState("action");
  const [expanded, setExpanded] = useState(null);

  const filtered = useMemo(() => history.filter((h) => h.status !== "Archived" && statusMatch(h.status, filter)), [history, filter]);

  // Counts per filter
  const filterCounts = useMemo(() => {
    const c = { action: 0, pending: 0, done: 0 };
    history.forEach((h) => {
      if (h.status === "Archived") return;
      if (/Rejected|Action/i.test(h.status)) c.action++;
      else if (/Pending/i.test(h.status)) c.pending++;
      else if (/Complete|Approved/i.test(h.status)) c.done++;
    });
    return c;
  }, [history]);

  return (
    <div className="pp-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-master-card">
        <div className="pp-master-header">
          <h3 className="pp-card-title" style={{ margin: 0 }}>Action Center</h3>
          <div className="pp-toggle-container">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                className={`pp-pill${filter === f.id ? " pp-pill-primary active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                <span className="pp-pill-label">{f.label}</span>
                {f.id !== "all" && (
                  <span className="pp-pill-count">{filterCounts[f.id] || 0}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="pp-activity-feed">
          {filtered.length === 0 && (
            <div className="pp-empty-state">
              <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
              <p style={{ color: "#94a3b8", fontWeight: 600 }}>No items match this filter.</p>
            </div>
          )}
          {filtered.map((item) => (
            <HistoryItem
              key={item.id}
              item={item}
              Formatter={Formatter}
              expanded={expanded === item.id}
              onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
              onResumeEdit={onResumeEdit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
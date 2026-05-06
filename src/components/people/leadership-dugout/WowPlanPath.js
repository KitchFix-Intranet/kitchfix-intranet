"use client";

// ════════════════════════════════════════════════════════════════════════════
// WowPlanPath — Day 1/30/60/90 progress strip
//
// Module: People Portal · Leadership Dugout
// Sprint: 2
// CSS prefix: pp-ldug-
//
// Visual representation of the 90-day arc. Each cell shows the day, date,
// and status (signed / today / future). Used at the top of WowPlanWorkspace.
// ════════════════════════════════════════════════════════════════════════════

const DAYS = [
  { day: 1, label: "Day 1", subtitle: "Kickoff" },
  { day: 30, label: "Day 30", subtitle: "Landed" },
  { day: 60, label: "Day 60", subtitle: "Mid-arc" },
  { day: 90, label: "Day 90", subtitle: "Close-out" },
];

function formatShortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function deriveStatus(day, dateIso, signedAt, status) {
  if (signedAt) return "signed";
  if (status === "Closed") return "signed";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cellDate = new Date(dateIso + "T00:00:00");
  const diffDays = Math.round((cellDate - today) / 86400000);
  if (diffDays < 0) return "overdue";
  if (diffDays <= 3) return "today";
  return "future";
}

export default function WowPlanPath({ header }) {
  if (!header) return null;

  const cells = DAYS.map((d) => {
    const dateIso =
      d.day === 1 ? header.day1_date :
      d.day === 30 ? header.day30_date :
      d.day === 60 ? header.day60_date :
      header.day90_date;
    const signedAt =
      d.day === 1 ? header.day1_signed_at :
      d.day === 30 ? header.day30_signed_at :
      d.day === 60 ? header.day60_signed_at :
      header.day90_signed_at;
    return {
      ...d,
      dateIso,
      signedAt,
      cellStatus: deriveStatus(d.day, dateIso, signedAt, header.status),
    };
  });

  return (
    <div className="pp-ldug-wow-path">
      {cells.map((c) => (
        <div
          key={c.day}
          className={`pp-ldug-wow-path-cell pp-ldug-wow-path-cell--${c.cellStatus}`}
        >
          <div className="pp-ldug-wow-path-day">{c.label}</div>
          <div className="pp-ldug-wow-path-subtitle">{c.subtitle}</div>
          <div className="pp-ldug-wow-path-date">{formatShortDate(c.dateIso)}</div>
          {c.cellStatus === "signed" && <div className="pp-ldug-wow-path-mark">✓</div>}
          {c.cellStatus === "today" && <div className="pp-ldug-wow-path-mark">◉</div>}
          {c.cellStatus === "overdue" && <div className="pp-ldug-wow-path-mark">!</div>}
        </div>
      ))}
    </div>
  );
}
"use client";

export default function ExecDonutChart({ labor, food, packaging }) {
  const total = labor + food + packaging;
  if (total === 0) return <div style={{ textAlign: "center", padding: 30, color: "#94a3b8" }}>No cost data reported yet</div>;

  const segments = [
    { value: labor, color: "#2563eb", label: "Hourly Labor" },
    { value: food, color: "#f59e0b", label: "Food" },
    { value: packaging, color: "#8b5cf6", label: "Packaging" },
  ].filter(s => s.value > 0);

  const cx = 80, cy = 80, r = 60, strokeW = 20;
  const circumference = 2 * Math.PI * r;
  let accumulated = 0;

  return (
    <div className="oh-exec-donut-wrap">
      <svg viewBox="0 0 160 160" className="oh-exec-donut-svg">
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const dashLen = circumference * pct;
          const dashGap = circumference - dashLen;
          const offset = accumulated;
          accumulated += dashLen;
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color} strokeWidth={strokeW}
              strokeDasharray={`${dashLen} ${dashGap}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: "stroke-dasharray 0.8s ease, stroke-dashoffset 0.8s ease" }}
            />
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" className="oh-exec-donut-total">
          ${total >= 1000 ? `${(total / 1000).toFixed(0)}K` : total.toLocaleString()}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="oh-exec-donut-label">TOTAL COSTS</text>
      </svg>
      <div className="oh-exec-donut-legend">
        {segments.map((seg, i) => (
          <div key={i} className="oh-exec-donut-leg-item">
            <span className="oh-exec-donut-leg-dot" style={{ background: seg.color }} />
            <span className="oh-exec-donut-leg-name">{seg.label}</span>
            <span className="oh-exec-donut-leg-val">${seg.value.toLocaleString()}</span>
            <span className="oh-exec-donut-leg-pct">{(seg.value / total * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
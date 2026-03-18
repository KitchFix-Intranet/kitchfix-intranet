"use client";

export default function ExecSparkline({ periodData }) {
  const completed = (periodData || []).filter(p => p.completed);
  if (completed.length === 0) return <span style={{ color: "#cbd5e1", fontSize: 11 }}>—</span>;

  const vals = completed.map(p => p.variance);
  const maxAbs = Math.max(1, ...vals.map(Math.abs));
  const W = 72, H = 22, mid = H / 2;

  const points = vals.map((v, i) => {
    const x = vals.length === 1 ? W / 2 : (i / (vals.length - 1)) * W;
    const y = mid - (v / maxAbs) * (mid - 2);
    return `${x},${y}`;
  }).join(" ");

  const lastV = vals[vals.length - 1];
  const clr = lastV >= 0 ? "#22c55e" : "#ef4444";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <line x1="0" y1={mid} x2={W} y2={mid} stroke="#e2e8f0" strokeWidth="0.5" />
      <polyline points={points} fill="none" stroke={clr} strokeWidth="1.5" strokeLinejoin="round" />
      {vals.length > 0 && <circle cx={vals.length === 1 ? W / 2 : W} cy={mid - (lastV / maxAbs) * (mid - 2)} r="2" fill={clr} />}
    </svg>
  );
}
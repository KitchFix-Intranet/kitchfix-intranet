"use client";

export default function ProgressRingMini({ completed, total, results }) {
  const sz = 48, sw = 5;
  const radius = (sz - sw * 2) / 2;
  const cx = sz / 2, cy = sz / 2;
  const gap = 5, seg = (360 - total * gap) / total;
  const toRad = (d) => (d * Math.PI) / 180;
  let a = -90;
  const segs = [];
  for (let i = 0; i < total; i++) {
    const s = a + gap / 2, e = s + seg;
    const res = results[i];
    const col = res ? (res.var >= 0 ? "#22c55e" : "#ef4444") : "#e2e8f0";
    const p1 = { x: cx + radius * Math.cos(toRad(s)), y: cy + radius * Math.sin(toRad(s)) };
    const p2 = { x: cx + radius * Math.cos(toRad(e)), y: cy + radius * Math.sin(toRad(e)) };
    segs.push({ d: `M ${p1.x} ${p1.y} A ${radius} ${radius} 0 ${seg > 180 ? 1 : 0} 1 ${p2.x} ${p2.y}`, col });
    a = e + gap / 2;
  }
  return (
    <svg width={sz} height={sz} style={{ flexShrink: 0 }}>
      {segs.map((s, i) => <path key={i} d={s.d} fill="none" stroke={s.col} strokeWidth={sw} strokeLinecap="round"
        style={{ filter: s.col !== "#e2e8f0" ? `drop-shadow(0 0 2px ${s.col}66)` : "none" }} />)}
      <text x={cx} y={cy + 1} textAnchor="middle" fontSize="13" fontWeight="900" fill="#0f172a">{completed}</text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize="7" fontWeight="700" fill="#94a3b8">of {total}</text>
    </svg>
  );
}
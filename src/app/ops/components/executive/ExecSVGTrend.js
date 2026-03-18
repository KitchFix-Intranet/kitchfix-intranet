"use client";

export default function ExecSVGTrend({ data, height = 140 }) {
  if (!data || data.length === 0) return <div style={{ textAlign: "center", padding: 20, color: "#94a3b8" }}>No period data</div>;

  const W = 500, H = height;
  const pad = { t: 24, r: 30, b: 32, l: 48 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const vals = data.map(d => d.variance);
  const maxAbs = Math.max(1, ...vals.map(Math.abs)) * 1.15;
  const yMid = pad.t + plotH / 2;

  const yScale = (v) => yMid - (v / maxAbs) * (plotH / 2);
  const xScale = (i) => pad.l + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);

  const fmtV = (v) => {
    const abs = Math.abs(v);
    if (abs >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (abs >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return v.toLocaleString();
  };

  const linePoints = data.map((d, i) => `${xScale(i)},${yScale(d.variance)}`).join(" ");
  const areaPoints = [
    `${xScale(0)},${yScale(0)}`,
    ...data.map((d, i) => `${xScale(i)},${yScale(d.variance)}`),
    `${xScale(data.length - 1)},${yScale(0)}`,
  ].join(" ");

  return (
    <div className="oh-exec-svgtrend-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="oh-exec-svgtrend">
        <defs>
          <linearGradient id="execTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={pad.l} y1={yScale(0)} x2={W - pad.r} y2={yScale(0)} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="4,4" />
        <line x1={pad.l} y1={yScale(maxAbs * 0.5)} x2={W - pad.r} y2={yScale(maxAbs * 0.5)} stroke="#f1f5f9" strokeWidth="0.7" />
        <line x1={pad.l} y1={yScale(-maxAbs * 0.5)} x2={W - pad.r} y2={yScale(-maxAbs * 0.5)} stroke="#f1f5f9" strokeWidth="0.7" />
        <text x={pad.l - 6} y={yScale(maxAbs * 0.5) + 4} textAnchor="end" className="oh-exec-svgtrend-axis">+${fmtV(maxAbs * 0.5)}</text>
        <text x={pad.l - 6} y={yScale(0) + 4} textAnchor="end" className="oh-exec-svgtrend-axis">$0</text>
        <text x={pad.l - 6} y={yScale(-maxAbs * 0.5) + 4} textAnchor="end" className="oh-exec-svgtrend-axis">-${fmtV(maxAbs * 0.5)}</text>
        <polygon points={areaPoints} fill="url(#execTrendGrad)" />
        <polyline points={linePoints} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={xScale(i)} cy={yScale(d.variance)} r="4.5" fill="#2563eb" stroke="#fff" strokeWidth="2" />
            <text x={xScale(i)} y={yScale(d.variance) - 10} textAnchor="middle" className="oh-exec-svgtrend-val" fill={d.variance >= 0 ? "#166534" : "#dc2626"}>
              {d.variance >= 0 ? "+" : "-"}${fmtV(Math.abs(d.variance))}
            </text>
            <text x={xScale(i)} y={H - 8} textAnchor="middle" className="oh-exec-svgtrend-period">{d.period}</text>
            <text x={xScale(i)} y={H - 0} textAnchor="middle" className="oh-exec-svgtrend-sub">{d.count} accts</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
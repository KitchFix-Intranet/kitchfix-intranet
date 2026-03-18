"use client";

export default function ExecRevenueVsCost({ data }) {
  if (!data || data.length === 0) return null;

  const W = 500, H = 170;
  const pad = { t: 20, r: 20, b: 30, l: 52 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const maxV = Math.max(1, ...data.map(d => Math.max(d.revActual, d.cogs)));
  const barGroupW = plotW / data.length;
  const barW = barGroupW * 0.3;

  const yScale = (v) => pad.t + plotH - (v / maxV) * plotH;
  const xCenter = (i) => pad.l + (i + 0.5) * barGroupW;

  const fmtV = (v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toString();

  return (
    <div className="oh-exec-svgtrend-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="oh-exec-svgtrend">
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
          <g key={i}>
            <line x1={pad.l} y1={yScale(maxV * f)} x2={W - pad.r} y2={yScale(maxV * f)} stroke="#f1f5f9" strokeWidth="0.7" />
            {f > 0 && <text x={pad.l - 6} y={yScale(maxV * f) + 4} textAnchor="end" className="oh-exec-svgtrend-axis">${fmtV(maxV * f)}</text>}
          </g>
        ))}
        {data.map((d, i) => (
          <g key={i}>
            <rect x={xCenter(i) - barW - 1} y={yScale(d.revActual)} width={barW} height={Math.max(1, yScale(0) - yScale(d.revActual))} rx={3} fill="#2563eb" opacity={0.8}>
              <animate attributeName="height" from="0" to={Math.max(1, yScale(0) - yScale(d.revActual))} dur="0.5s" fill="freeze" />
            </rect>
            <rect x={xCenter(i) + 1} y={yScale(d.cogs)} width={barW} height={Math.max(1, yScale(0) - yScale(d.cogs))} rx={3} fill="#f59e0b" opacity={0.8}>
              <animate attributeName="height" from="0" to={Math.max(1, yScale(0) - yScale(d.cogs))} dur="0.5s" fill="freeze" />
            </rect>
            <text x={xCenter(i)} y={H - 8} textAnchor="middle" className="oh-exec-svgtrend-period">{d.period}</text>
          </g>
        ))}
        <rect x={W - pad.r - 140} y={6} width={10} height={10} rx={2} fill="#2563eb" opacity={0.8} />
        <text x={W - pad.r - 126} y={15} className="oh-exec-svgtrend-axis" style={{ fontSize: 10 }}>Revenue</text>
        <rect x={W - pad.r - 66} y={6} width={10} height={10} rx={2} fill="#f59e0b" opacity={0.8} />
        <text x={W - pad.r - 52} y={15} className="oh-exec-svgtrend-axis" style={{ fontSize: 10 }}>Ops Costs</text>
      </svg>
    </div>
  );
}
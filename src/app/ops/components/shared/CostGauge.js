"use client";
import useCounter from "@/app/ops/components/shared/useCounter";

export default function CostGauge({ actual, budget, verdict }) {
  const animatedVal = useCounter(actual, 1400, 400);
  const isOverflow = actual > 100;
  const displayVal = Math.min(animatedVal, 100);
  const radius = 80, stroke = 11, cx = 95, cy = 95;
  const startAngle = 150, totalSweep = 240;
  const toRad = (d) => (d * Math.PI) / 180;
  const arcPoint = (angle) => ({
    x: cx + radius * Math.cos(toRad(angle)),
    y: cy + radius * Math.sin(toRad(angle)),
  });
  const pctToAngle = (pct) => startAngle + (Math.min(pct, 100) / 100) * totalSweep;
  const valAngle = pctToAngle(displayVal);
  const budgetAngle = pctToAngle(Math.min(budget, 100));
  const describeArc = (startA, endA) => {
    const s = arcPoint(startA), e = arcPoint(endA);
    return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${endA - startA > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
  };
  const isGood = verdict !== undefined ? verdict : actual <= budget;
  const gaugeColor = isOverflow ? "#dc2626" : isGood ? "#22c55e" : actual <= budget + 5 ? "#f59e0b" : "#ef4444";
  const bp = arcPoint(budgetAngle);
  const diff = Math.abs(actual - budget).toFixed(1);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <svg width="190" height="130" viewBox="0 0 190 140" style={{ display: "block" }}>
        <path d={describeArc(startAngle, startAngle + totalSweep)} fill="none" stroke="#f1f5f9" strokeWidth={stroke} strokeLinecap="round" />
        {!isOverflow && (
          <path d={describeArc(startAngle, budgetAngle)} fill="none" stroke={isGood ? "#dcfce7" : "#fef9c3"} strokeWidth={stroke} strokeLinecap="round" />
        )}
        <path d={describeArc(startAngle, valAngle)} fill="none" stroke={gaugeColor} strokeWidth={stroke + 2} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${gaugeColor}44)` }} />
        {!isOverflow && (
          <>
            <line x1={bp.x} y1={bp.y} x2={cx + (radius + 8) * Math.cos(toRad(budgetAngle))} y2={cy + (radius + 8) * Math.sin(toRad(budgetAngle))}
              stroke="#1e293b" strokeWidth="2.5" strokeLinecap="round" />
            <text x={cx + (radius + 18) * Math.cos(toRad(budgetAngle))} y={cy + (radius + 18) * Math.sin(toRad(budgetAngle))}
              textAnchor="middle" fontSize="9" fontWeight="800" fill="#64748b">{budget}%</text>
          </>
        )}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize={isOverflow ? "28" : "34"} fontWeight="900" fill={isOverflow ? "#dc2626" : "#0f172a"}>{animatedVal.toFixed(1)}%</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill="#94a3b8" fontWeight="600">cost-to-revenue</text>
      </svg>
      <div className={`oh-kpi-gauge-badge ${isGood ? "oh-kpi-badge-green" : "oh-kpi-badge-red"}`}>
        {isOverflow ? `⚠️ ${diff}% over budget` : actual <= budget ? `${diff}% under budget` : `${diff}% over budget`}
      </div>
    </div>
  );
}
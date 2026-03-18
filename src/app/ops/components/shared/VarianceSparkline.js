"use client";

export default function VarianceSparkline({ data }) {
  if (!data || data.length === 0) return null;
  if (data.length === 1) {
    const v = data[0];
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 10px", background: v >= 0 ? "#f0fdf4" : "#fef2f2", border: `1px solid ${v >= 0 ? "#bbf7d0" : "#fecaca"}`, borderRadius: 8 }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: v >= 0 ? "#22c55e" : "#ef4444" }} />
        <span style={{ fontSize: 11, fontWeight: 800, color: v >= 0 ? "#166534" : "#dc2626" }}>P1: {v >= 0 ? "+" : ""}${v.toLocaleString()}</span>
      </div>
    );
  }
  const mx = Math.max(...data.map(Math.abs), 1);
  const futureCount = data.length <= 4 ? Math.min(3, 12 - data.length) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 28 }}>
        {data.map((v, i) => (
          <div key={i} className="oh-kpi-spark-bar" style={{
            height: Math.max(6, (Math.abs(v) / mx) * 26),
            background: v >= 0 ? "linear-gradient(180deg, #22c55e, #16a34a)" : "linear-gradient(180deg, #f87171, #dc2626)",
            animationDelay: `${0.5 + i * 0.08}s`,
          }} />
        ))}
        {Array.from({ length: futureCount }, (_, i) => (
          <div key={`f${i}`} style={{ width: 14, height: 4, borderRadius: "3px 3px 0 0", background: "#e2e8f0", flexShrink: 0 }} />
        ))}
      </div>
      <div style={{ fontSize: 8, color: "#cbd5e1", fontWeight: 600, letterSpacing: 1 }}>
        {data.map((_, i) => `P${i + 1}`).join("  ")}
      </div>
    </div>
  );
}
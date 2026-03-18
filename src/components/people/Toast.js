"use client";

export default function Toast({ msg, type = "success" }) {
  const colors = {
    success: { bg: "#dcfce7", border: "#86efac", color: "#166534", icon: "✅" },
    error: { bg: "#fee2e2", border: "#fecaca", color: "#991b1b", icon: "⚠️" },
    info: { bg: "#e0f2fe", border: "#bae6fd", color: "#0c4a6e", icon: "ℹ️" },
  };
  const c = colors[type] || colors.info;

  return (
    <div className="pp-toast-container">
      <div
        className="pp-toast pp-toast--visible"
        style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.color }}
      >
        <span>{c.icon}</span> {msg}
      </div>
    </div>
  );
}
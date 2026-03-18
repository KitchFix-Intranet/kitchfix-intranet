const F = {
  money: (v) => {
    if (v === "" || v == null || isNaN(v)) return "–";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
  },
  moneyShort: (v) => {
    const n = Number(v);
    if (isNaN(n)) return "–";
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  date: (v, opts = { month: "short", day: "numeric", year: "numeric" }) => {
    if (!v || v === "undefined") return "–";
    try {
      const s = String(v).trim();
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00" : s);
      return isNaN(d.getTime()) ? "–" : d.toLocaleDateString("en-US", opts);
    } catch { return "–"; }
  },
  dateShort: (v) => F.date(v, { month: "short", day: "numeric" }),
  dateNum: (v) => F.date(v, { month: "numeric", day: "numeric" }),
  daysUntil: (due) => {
    if (!due) return null;
    try {
      const s = String(due).trim();
      const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00" : s);
      return isNaN(d.getTime()) ? null : Math.ceil((d - new Date()) / 86400000);
    } catch { return null; }
  },
  // ── Updated: 3-tier urgency ──
  // Was: ≤3 warn, else safe
  // Now: ≤7 urgent, 8-29 warn, 30+ safe
  daysLabel: (d) => {
    if (d == null) return "--";
    if (d < 0) return `${Math.abs(d)}D OVERDUE`;
    if (d === 0) return "DUE TODAY";
    return `${d}D REMAINING`;
  },
  daysUrgency: (d) => {
    if (d == null) return "neutral";
    if (d < 0) return "urgent";
    if (d <= 7) return "urgent";
    if (d <= 29) return "warn";
    return "safe";
  },
  comma: (v) => {
    const raw = String(v).replace(/[^0-9.]/g, "");
    if (!raw || isNaN(raw)) return "";
    const parts = raw.split(".");
    const whole = Number(parts[0]).toLocaleString("en-US");
    return parts.length > 1 ? `${whole}.${parts[1].slice(0, 2)}` : whole;
  },
  num: (v) => parseFloat(String(v).replace(/,/g, "") || "0"),
  periodProgress: (start, end) => {
    if (!start || !end) return 0;
    try {
      const s = new Date(String(start).trim());
      const e = new Date(String(end).trim());
      const now = new Date();
      const total = e - s;
      if (total <= 0) return 0;
      return Math.min(100, Math.max(3, ((now - s) / total) * 100));
    } catch { return 0; }
  },
};

export default F;
"use client";

export default function OpsNav({ view, onNavigate }) {
  const tabs = [
    { key: "home",     label: "Home" },
    { key: "inventory", label: "Inventory" },
    { key: "invoices", label: "Invoices" },
    { key: "labor",    label: "Season Tracker" },
    { key: "vendors",  label: "Vendors" },
  ];

  return (
    <div className="oh-nav-wrapper">
      <div className="oh-nav-pill">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`oh-nav-item${view === t.key ? " oh-nav-item--active" : ""}`}
            onClick={() => onNavigate(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
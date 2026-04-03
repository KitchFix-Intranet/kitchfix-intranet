"use client";

const INV_MANAGER_DEV_USERS = ["k.fietek@kitchfix.com"];

export default function OpsNav({ view, onNavigate, userEmail = "" }) {
  const isInvManagerEnabled = INV_MANAGER_DEV_USERS.includes(userEmail);

  const tabs = [
    { key: "home",     label: "Home" },
    { key: "inventory", label: "Inventory" },
    ...(isInvManagerEnabled ? [{ key: "inv-manager", label: "Inv Manager" }] : []),
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
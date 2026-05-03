"use client";

const TABS = [
  { id: "dashboard", label: "Home" },
  { id: "activity", label: "Action Center" },
  { id: "newhire", label: "New Hire" },
  { id: "paf", label: "PAF" },
  { id: "incidents", label: "Incidents" },
];

export default function PeopleNav({ activeView, onNavigate, isAdmin }) {
  const tabs = isAdmin
    ? [...TABS, { id: "incident-admin", label: "Incident Admin" }, { id: "admin", label: "Admin" }]
    : TABS;

  return (
    <div className="pp-nav-wrapper">
      <nav className="pp-nav-pill">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`pp-nav-item${activeView === t.id ? " pp-nav-item--active" : ""}`}
            onClick={() => onNavigate(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
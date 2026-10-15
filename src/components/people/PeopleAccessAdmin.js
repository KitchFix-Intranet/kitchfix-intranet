"use client";
//
// PeopleAccessAdmin - People Portal Directory gear's admin panel.
//
// Rendered IN-CARD (replaces DirectoryView's directory body in place
// when admin mode is on). Two views - People (grouped master list +
// per-person detail with grouped permission controls + per-person
// changelog) and Permissions (reverse: permissions master list +
// ON/OFF roster on the right).
//
// Reuses the Stage 3 /api/directory admin endpoints (server-gated by
// requirePeopleAdmin): admin-people-list, admin-changelog,
// admin-people-update. One API call per change; every call requires a
// non-empty reason (<=280 chars). Flipping a control opens an inline
// Reason / Save / Cancel panel; the server call fires on Save only, and
// Cancel or any error reverts the control.
//
// Grouping: region (Corporate / East / West) → account (team_key),
// sourced from the additive `account.region` + `team_key` fields on
// admin-people-list. The editable `region` permission column is NOT
// used for grouping - it's a separate routing flag and can diverge.
//
// Styled with pp-access-* classes defined in src/app/people/people.css.
// No directory.css import, no td-* reuse.

import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Icons ────────────────────────────────────────────────────────
const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const ChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const ShieldIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// ─── Column metadata ─────────────────────────────────────────────
// Mirrors src/app/api/directory/route.js BOOLEAN_COLUMNS / ENUM_COLUMNS /
// FREE_TEXT_COLUMNS. Groupings per the render; labels from the API's
// columnLabels field so a server-side rename does not need a redeploy.
const BOOLEAN_COLS = new Set([
  "is_ops_leadership", "is_sc_access", "is_sc_admin", "is_sc_lock_override",
  "is_labor_admin", "is_invoice_admin", "is_inv_manager",
  "can_see_salary", "is_kpi_preview",
  "is_playbook_owner", "is_sous_preview", "is_hr_admin",
  "paf_always_cc",
]);
const ENUM_OPTIONS = {
  kpi_role:        [{ v: null, l: "- none -" }, { v: "corporate", l: "Corporate" }, { v: "rdo", l: "RDO" }],
  opd_access_tier: [{ v: "unrestricted", l: "Unrestricted" }, { v: "restricted", l: "Restricted" }, { v: "slt", l: "SLT" }],
  incident_notify: [{ v: "all", l: "All" }, { v: "s4_weekly", l: "S4 Weekly" }, { v: "none", l: "None" }],
  region:          [{ v: null, l: "- none -" }, { v: "East", l: "East" }, { v: "West", l: "West" }, { v: "CORP", l: "Corp" }],
};
const TEXT_COLS = new Set(["kpi_scope", "sc_default_account"]);

const GROUPS = [
  {
    key: "module", title: "Module Access", defaultOpen: true,
    cols: [
      "is_ops_leadership", "is_sc_access", "is_sc_admin", "is_sc_lock_override",
      "is_labor_admin", "is_invoice_admin", "is_inv_manager", "is_hr_admin",
      "is_playbook_owner", "is_sous_preview", "is_kpi_preview", "can_see_salary",
    ],
  },
  { key: "kpi",     title: "KPI",             defaultOpen: true,  cols: ["kpi_role", "kpi_scope"] },
  { key: "content", title: "Content & Tools", defaultOpen: false, cols: ["opd_access_tier", "sc_default_account"] },
  { key: "notify",  title: "Notifications",   defaultOpen: false, cols: ["incident_notify", "paf_always_cc"] },
  { key: "routing", title: "Routing",         defaultOpen: false, cols: ["region"] },
];

const CHIPS = [
  { key: "all",    label: "All",             pred: () => true },
  { key: "ops",    label: "Ops Leadership",  pred: (p) => !!p.is_ops_leadership },
  { key: "sc",     label: "SC Access",       pred: (p) => !!p.is_sc_access },
  { key: "scadm",  label: "SC Admin",        pred: (p) => !!p.is_sc_admin },
  { key: "kpi",    label: "KPI",             pred: (p) => !!p.is_kpi_preview || p.kpi_role },
];

// Region ordering per directory doctrine: Corporate first, then East,
// West. People whose account has no region or whose team_key is null
// are bucketed into "Unassigned" at the bottom.
const REGION_ORDER = ["CORP", "East", "West", "Unassigned"];
const REGION_LABEL = { CORP: "Corporate", East: "East", West: "West", Unassigned: "Unassigned" };

function colTypeOf(col) {
  if (BOOLEAN_COLS.has(col)) return "bool";
  if (ENUM_OPTIONS[col])     return "enum";
  if (TEXT_COLS.has(col))    return "text";
  return "unknown";
}

function initials(name) {
  return String(name || "?")
    .split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#be185d"];
function colorForName(name) {
  let h = 0;
  for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function formatChangedAt(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return String(iso); }
}
function formatValue(col, v) {
  if (v === null || v === undefined || v === "") return "(unset)";
  if (BOOLEAN_COLS.has(col)) return v ? "on" : "off";
  return String(v);
}

// Pick the region bucket for a person. Reads account.region (the
// grouping region), NOT the editable `region` permission column.
function regionOf(p) {
  const r = p?.account?.region;
  if (r === "CORP") return "CORP";
  if (r === "East") return "East";
  if (r === "West") return "West";
  return "Unassigned";
}
function accountLabel(p) {
  const name = p?.account?.name;
  const key  = p?.team_key;
  if (name && key) return `${name} · ${key}`;
  if (name) return name;
  if (key)  return key;
  return "No account";
}

// ─── Top-level panel ─────────────────────────────────────────────
export default function PeopleAccessAdmin({ onClose }) {
  const [view, setView] = useState("people"); // "people" | "permissions"
  const [people, setPeople] = useState(null);
  const [columnLabels, setColumnLabels] = useState({});
  const [changelog, setChangelog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // People view state
  const [search, setSearch] = useState("");
  const [chip, setChip]     = useState("all");
  const [selectedEmail, setSelectedEmail] = useState(null);
  // Collapsible region/account state. All open by default.
  const [collapsed, setCollapsed] = useState(() => ({ regions: new Set(), accounts: new Set() }));
  // Mobile pane state ("list" | "detail"). Only consulted below 720px.
  const [mobilePane, setMobilePane] = useState("list");

  // Permissions view state
  const [selectedPerm, setSelectedPerm] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plRes, clRes] = await Promise.all([
        fetch("/api/directory?action=admin-people-list"),
        fetch("/api/directory?action=admin-changelog&limit=200&offset=0"),
      ]);
      const pl = await plRes.json();
      const cl = await clRes.json();
      if (!pl.success) throw new Error(pl.error || "admin-people-list failed");
      if (!cl.success) throw new Error(cl.error || "admin-changelog failed");
      // Intranet-eligible filter: hourly staff who don't have a
      // kitchfix.com work_email can never log in, so they're not
      // relevant to a permissions panel. Hourly staff who DO have a
      // work_email (small number, flagged as an open item) will still
      // show under this filter.
      const intranetPeople = (pl.people || []).filter(
        (p) => String(p.work_email || "").trim() !== ""
      );
      setPeople(intranetPeople);
      setColumnLabels(pl.columnLabels || cl.columnLabels || {});
      setChangelog(cl.entries || []);
      // Default-select the first intranet-eligible person so the
      // detail pane is not empty at rest (per spec).
      if (intranetPeople.length > 0 && !selectedEmail) {
        setSelectedEmail(intranetPeople[0].work_email);
      }
    } catch (err) {
      setError(err.message || "load failed");
    } finally {
      setLoading(false);
    }
  }, [selectedEmail]);

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const applyLocalUpdate = useCallback((email, column, value) => {
    setPeople((prev) => prev?.map((p) =>
      String(p.work_email || "").toLowerCase() === String(email).toLowerCase()
        ? { ...p, [column]: value }
        : p
    ));
  }, []);

  const chipCounts = useMemo(() => {
    if (!people) return {};
    const out = {};
    for (const c of CHIPS) out[c.key] = people.filter(c.pred).length;
    return out;
  }, [people]);

  // Filtered flat list (filters narrow which people show; grouping
  // operates on the filtered set).
  const filteredPeople = useMemo(() => {
    if (!people) return [];
    const q = search.trim().toLowerCase();
    const chipFn = CHIPS.find((c) => c.key === chip)?.pred || (() => true);
    return people
      .filter(chipFn)
      .filter((p) => {
        if (!q) return true;
        return [p.display_name, p.work_email, p.title].some(
          (s) => String(s || "").toLowerCase().includes(q)
        );
      });
  }, [people, search, chip]);

  // region → account_key → person[] (ordered). Empty regions/accounts
  // are hidden.
  const grouped = useMemo(() => {
    const byRegion = new Map();
    for (const p of filteredPeople) {
      const r = regionOf(p);
      if (!byRegion.has(r)) byRegion.set(r, new Map());
      const byAcct = byRegion.get(r);
      const acctKey = p.team_key || "__none__";
      if (!byAcct.has(acctKey)) byAcct.set(acctKey, []);
      byAcct.get(acctKey).push(p);
    }
    // Sort regions by REGION_ORDER, accounts alphabetically by label,
    // people alphabetically by display_name within an account.
    const out = [];
    for (const r of REGION_ORDER) {
      if (!byRegion.has(r)) continue;
      const byAcct = byRegion.get(r);
      const accounts = [...byAcct.entries()]
        .map(([acctKey, members]) => ({
          acctKey,
          acctLabel: accountLabel(members[0]),
          members: members.slice().sort((a, b) =>
            String(a.display_name || "").localeCompare(String(b.display_name || ""))
          ),
        }))
        .sort((a, b) => a.acctLabel.localeCompare(b.acctLabel));
      out.push({ region: r, accounts });
    }
    return out;
  }, [filteredPeople]);

  const selectedPerson = useMemo(
    () => (selectedEmail ? people?.find((p) => String(p.work_email || "").toLowerCase() === selectedEmail.toLowerCase()) : null),
    [people, selectedEmail]
  );
  const selectedPersonChangelog = useMemo(() => {
    if (!selectedEmail) return [];
    const lc = selectedEmail.toLowerCase();
    return (changelog || []).filter((e) => String(e.person_email || "").toLowerCase() === lc);
  }, [changelog, selectedEmail]);

  const refreshChangelog = useCallback(() => {
    fetch("/api/directory?action=admin-changelog&limit=200&offset=0")
      .then((r) => r.json())
      .then((d) => { if (d.success) setChangelog(d.entries || []); })
      .catch(() => {});
  }, []);

  const toggleRegion = useCallback((r) => {
    setCollapsed((prev) => {
      const next = { ...prev, regions: new Set(prev.regions) };
      if (next.regions.has(r)) next.regions.delete(r); else next.regions.add(r);
      return next;
    });
  }, []);
  const toggleAccount = useCallback((region, acctKey) => {
    setCollapsed((prev) => {
      const k = `${region}|${acctKey}`;
      const next = { ...prev, accounts: new Set(prev.accounts) };
      if (next.accounts.has(k)) next.accounts.delete(k); else next.accounts.add(k);
      return next;
    });
  }, []);

  const chooseInListPane = useCallback((email) => {
    setSelectedEmail(email);
    setMobilePane("detail");
  }, []);

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="pp-access">
      <header className="pp-access-header">
        <button
          type="button"
          className="pp-access-back"
          onClick={onClose}
          aria-label="Back to Directory"
        >
          <BackIcon /><span>Directory</span>
        </button>
        <div className="pp-access-title-block">
          <h2 className="pp-access-title">People & Access</h2>
          <p className="pp-access-subtitle">
            {view === "people"
              ? "Permission toggles per person. Every change writes to the audit log."
              : "Reverse lookup: who has which permission."}
          </p>
        </div>
        <div className="pp-access-tabs" role="tablist" aria-label="View">
          <button
            type="button" role="tab"
            aria-selected={view === "people"}
            className={`pp-access-tab${view === "people" ? " pp-access-tab--on" : ""}`}
            onClick={() => { setView("people"); setMobilePane("list"); }}
          >People</button>
          <button
            type="button" role="tab"
            aria-selected={view === "permissions"}
            className={`pp-access-tab${view === "permissions" ? " pp-access-tab--on" : ""}`}
            onClick={() => { setView("permissions"); setMobilePane("list"); }}
          >Permissions</button>
        </div>
      </header>

      {loading && !people && (
        <div className="pp-access-body-pad pp-access-muted">Loading admin panel...</div>
      )}
      {error && (
        <div className="pp-access-body-pad pp-access-error">
          {error} <button type="button" className="pp-access-link" onClick={refresh}>retry</button>
        </div>
      )}

      {!loading && !error && people && view === "people" && (
        <div className={`pp-access-split pp-access-split--${mobilePane}`}>
          <aside className="pp-access-pane pp-access-pane--list">
            <div className="pp-access-filter-row">
              <div className="pp-access-search">
                <SearchIcon />
                <input
                  type="text"
                  placeholder="Search people..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search people"
                />
              </div>
            </div>
            <label className="pp-access-filter-select">
              <span className="pp-access-filter-select-label">Show</span>
              <select
                className="pp-access-select"
                value={chip}
                onChange={(e) => setChip(e.target.value)}
                aria-label="Filter"
              >
                {CHIPS.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label} ({chipCounts[c.key] ?? 0})
                  </option>
                ))}
              </select>
            </label>
            <div className="pp-access-groups">
              {grouped.length === 0 && (
                <div className="pp-access-empty">No matches.</div>
              )}
              {grouped.map(({ region, accounts }) => {
                const regionOpen = !collapsed.regions.has(region);
                const regionCount = accounts.reduce((n, a) => n + a.members.length, 0);
                return (
                  <div key={region} className="pp-access-region">
                    <button
                      type="button"
                      className="pp-access-region-head"
                      onClick={() => toggleRegion(region)}
                      aria-expanded={regionOpen}
                    >
                      <span className="pp-access-region-chev">{regionOpen ? <ChevronDown /> : <ChevronRight />}</span>
                      <span className="pp-access-region-label">{REGION_LABEL[region] || region}</span>
                      <span className="pp-access-region-count">{regionCount}</span>
                    </button>
                    {regionOpen && accounts.map(({ acctKey, acctLabel, members }) => {
                      const isCorp = region === "CORP";
                      const acctOpen = !collapsed.accounts.has(`${region}|${acctKey}`);
                      // Corporate has no account sub-header (per spec).
                      return (
                        <div key={acctKey} className="pp-access-account">
                          {!isCorp && (
                            <button
                              type="button"
                              className="pp-access-account-head"
                              onClick={() => toggleAccount(region, acctKey)}
                              aria-expanded={acctOpen}
                            >
                              <span className="pp-access-account-chev">{acctOpen ? <ChevronDown /> : <ChevronRight />}</span>
                              <span className="pp-access-account-label">{acctLabel}</span>
                              <span className="pp-access-account-count">{members.length}</span>
                            </button>
                          )}
                          {(isCorp || acctOpen) && (
                            <ul className="pp-access-list">
                              {members.map((p) => (
                                <PersonRow
                                  key={p.worker_id || p.work_email}
                                  person={p}
                                  selected={selectedEmail && String(p.work_email).toLowerCase() === selectedEmail.toLowerCase()}
                                  onSelect={() => chooseInListPane(p.work_email)}
                                />
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </aside>
          <section className="pp-access-pane pp-access-pane--detail">
            {selectedPerson ? (
              <>
                <button
                  type="button"
                  className="pp-access-mobile-back"
                  onClick={() => setMobilePane("list")}
                  aria-label="Back to list"
                >
                  <BackIcon /><span>People</span>
                </button>
                <PersonDetailDrawer
                  person={selectedPerson}
                  columnLabels={columnLabels}
                  changelog={selectedPersonChangelog}
                  onSaved={(column, value) => {
                    applyLocalUpdate(selectedPerson.work_email, column, value);
                    refreshChangelog();
                  }}
                />
              </>
            ) : (
              <div className="pp-access-body-pad pp-access-muted">Select a person on the left to view their access.</div>
            )}
          </section>
        </div>
      )}

      {!loading && !error && people && view === "permissions" && (
        <PermissionsView
          people={people}
          columnLabels={columnLabels}
          selectedPerm={selectedPerm}
          onSelectPerm={setSelectedPerm}
          onJumpToPerson={(email) => {
            setView("people");
            setSelectedEmail(email);
            setMobilePane("detail");
          }}
          mobilePane={mobilePane}
          setMobilePane={setMobilePane}
        />
      )}
    </div>
  );
}

// ─── Person row (list) ───────────────────────────────────────────
function PersonRow({ person, selected, onSelect }) {
  return (
    <li className="pp-access-row">
      <button
        type="button"
        className={`pp-access-row-btn${selected ? " pp-access-row-btn--on" : ""}`}
        onClick={onSelect}
        aria-pressed={!!selected}
      >
        <span className="pp-access-avatar" style={{ background: colorForName(person.display_name) }}>
          {initials(person.display_name)}
        </span>
        <span className="pp-access-row-main">
          <span className="pp-access-row-name">
            {person.display_name}
            {person.is_super_admin && (
              <span className="pp-access-shield" title="Super admin"><ShieldIcon /></span>
            )}
          </span>
          <span className="pp-access-row-sub">{person.title || "-"}</span>
          <span className="pp-access-badges">
            {person.is_ops_leadership && <span className="pp-access-badge pp-access-badge--ops">OPS</span>}
            {person.is_sc_admin        && <span className="pp-access-badge pp-access-badge--sc">SC ADMIN</span>}
            {!person.is_sc_admin && person.is_sc_access && <span className="pp-access-badge pp-access-badge--muted">SC</span>}
            {person.is_labor_admin     && <span className="pp-access-badge pp-access-badge--muted">LABOR</span>}
            {person.is_invoice_admin   && <span className="pp-access-badge pp-access-badge--muted">INV</span>}
            {person.is_hr_admin        && <span className="pp-access-badge pp-access-badge--muted">HR</span>}
            {person.is_kpi_preview     && <span className="pp-access-badge pp-access-badge--muted">KPI</span>}
          </span>
        </span>
        <span className="pp-access-row-chev"><ChevronRight /></span>
      </button>
    </li>
  );
}

// ─── Permissions view (master-detail) ────────────────────────────
function PermissionsView({ people, columnLabels, selectedPerm, onSelectPerm, onJumpToPerson, mobilePane, setMobilePane }) {
  const summaries = useMemo(() => {
    const out = [];
    for (const g of GROUPS) {
      for (const col of g.cols) {
        const type = colTypeOf(col);
        if (type === "bool") {
          const on = people.filter((p) => !!p[col]);
          out.push({ col, label: columnLabels[col] || col, type, count: on.length, on, group: g.key, groupTitle: g.title });
        } else if (type === "enum") {
          const buckets = new Map();
          for (const p of people) {
            const key = p[col] === null || p[col] === undefined ? "(unset)" : String(p[col]);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(p);
          }
          out.push({ col, label: columnLabels[col] || col, type, count: people.length, buckets, group: g.key, groupTitle: g.title });
        } else {
          const set = people.filter((p) => p[col] != null && String(p[col]).trim() !== "");
          out.push({ col, label: columnLabels[col] || col, type, count: set.length, set, group: g.key, groupTitle: g.title });
        }
      }
    }
    return out;
  }, [people, columnLabels]);

  const currentPerm = selectedPerm ? summaries.find((s) => s.col === selectedPerm) : null;
  // Default-select the first permission.
  useEffect(() => {
    if (!selectedPerm && summaries.length > 0) {
      onSelectPerm(summaries[0].col);
    }
  }, [selectedPerm, summaries, onSelectPerm]);

  const jump = (email) => {
    onJumpToPerson(email);
  };

  return (
    <div className={`pp-access-split pp-access-split--${mobilePane}`}>
      <aside className="pp-access-pane pp-access-pane--list">
        <ul className="pp-access-perm-master">
          {summaries.map((s) => {
            const on = selectedPerm === s.col;
            return (
              <li key={s.col}>
                <button
                  type="button"
                  className={`pp-access-perm-master-btn${on ? " pp-access-perm-master-btn--on" : ""}`}
                  onClick={() => { onSelectPerm(s.col); setMobilePane("detail"); }}
                  aria-pressed={on}
                >
                  <span className="pp-access-perm-master-group">{s.groupTitle}</span>
                  <span className="pp-access-perm-master-label">{s.label}</span>
                  <span className="pp-access-perm-count">{s.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </aside>
      <section className="pp-access-pane pp-access-pane--detail">
        <button
          type="button"
          className="pp-access-mobile-back"
          onClick={() => setMobilePane("list")}
          aria-label="Back to permissions"
        >
          <BackIcon /><span>Permissions</span>
        </button>
        {!currentPerm && (
          <div className="pp-access-body-pad pp-access-muted">Select a permission on the left.</div>
        )}
        {currentPerm && currentPerm.type === "bool" && (
          <div className="pp-access-perm-body">
            <div className="pp-access-perm-body-head">{currentPerm.label} <span className="pp-access-muted">({currentPerm.on.length})</span></div>
            {currentPerm.on.length === 0 && <div className="pp-access-muted">Nobody has this permission.</div>}
            {currentPerm.on.map((p) => (
              <button
                key={p.worker_id || p.work_email}
                type="button"
                className="pp-access-perm-member"
                onClick={() => jump(p.work_email)}
              >
                {p.display_name} <span className="pp-access-muted">({p.work_email})</span>
              </button>
            ))}
          </div>
        )}
        {currentPerm && currentPerm.type === "enum" && (
          <div className="pp-access-perm-body">
            <div className="pp-access-perm-body-head">{currentPerm.label}</div>
            {[...currentPerm.buckets.entries()].map(([bucketKey, members]) => (
              <div key={bucketKey} className="pp-access-perm-bucket">
                <div className="pp-access-perm-bucket-head">{bucketKey} <span className="pp-access-muted">({members.length})</span></div>
                {members.map((p) => (
                  <button
                    key={p.worker_id || p.work_email}
                    type="button"
                    className="pp-access-perm-member"
                    onClick={() => jump(p.work_email)}
                  >
                    {p.display_name} <span className="pp-access-muted">({p.work_email})</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
        {currentPerm && currentPerm.type === "text" && (
          <div className="pp-access-perm-body">
            <div className="pp-access-perm-body-head">{currentPerm.label} <span className="pp-access-muted">({currentPerm.set.length})</span></div>
            {currentPerm.set.length === 0 && <div className="pp-access-muted">Nobody has this set.</div>}
            {currentPerm.set.map((p) => (
              <button
                key={p.worker_id || p.work_email}
                type="button"
                className="pp-access-perm-member"
                onClick={() => jump(p.work_email)}
              >
                {p.display_name} <span className="pp-access-muted">({p.work_email})</span>
                <span className="pp-access-perm-text-val">= {String(p[currentPerm.col])}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Person detail drawer (right pane) ───────────────────────────
function PersonDetailDrawer({ person, columnLabels, changelog, onSaved }) {
  const [pending, setPending] = useState(null);
  const [softWarning, setSoftWarning] = useState("");
  const [openGroups, setOpenGroups] = useState(() => {
    const o = {};
    for (const g of GROUPS) o[g.key] = !!g.defaultOpen;
    return o;
  });

  // Reset pending when the person switches.
  useEffect(() => { setPending(null); setSoftWarning(""); }, [person?.work_email]);

  const startPending = useCallback((col, value) => {
    setPending({ col, value, reason: "", saving: false, error: "" });
    setSoftWarning("");
  }, []);
  const cancelPending = useCallback(() => setPending(null), []);
  const updatePendingReason = useCallback((reason) => {
    setPending((prev) => prev ? { ...prev, reason, error: "" } : prev);
  }, []);

  const commitPending = useCallback(async () => {
    if (!pending) return;
    const reason = (pending.reason || "").trim();
    if (reason.length === 0) {
      setPending((prev) => prev ? { ...prev, error: "Reason required." } : prev);
      return;
    }
    if (reason.length > 280) {
      setPending((prev) => prev ? { ...prev, error: "Reason must be <= 280 chars." } : prev);
      return;
    }
    setPending((prev) => prev ? { ...prev, saving: true, error: "" } : prev);
    try {
      const res = await fetch("/api/directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin-people-update",
          email:  person.work_email,
          column: pending.col,
          value:  pending.value,
          reason,
        }),
      });
      const d = await res.json();
      if (!res.ok || d.error) {
        setPending((prev) => prev ? { ...prev, saving: false, error: d.error || `HTTP ${res.status}` } : prev);
        return;
      }
      if (d.changed) {
        onSaved(pending.col, pending.value);
        if (d.changelog_warning) setSoftWarning(d.changelog_warning);
      }
      setPending(null);
    } catch (err) {
      setPending((prev) => prev ? { ...prev, saving: false, error: err.message || "network error" } : prev);
    }
  }, [pending, person, onSaved]);

  const toggleGroup = (key) => setOpenGroups((p) => ({ ...p, [key]: !p[key] }));

  return (
    <div className="pp-access-detail">
      <div className="pp-access-detail-head">
        <div className="pp-access-avatar pp-access-avatar--lg" style={{ background: colorForName(person.display_name) }}>
          {initials(person.display_name)}
        </div>
        <div>
          <div className="pp-access-detail-name">
            {person.display_name}
            {person.is_super_admin && (
              <span className="pp-access-shield pp-access-shield--lg" title="Super admin"><ShieldIcon size={14} /></span>
            )}
          </div>
          <div className="pp-access-detail-sub">{person.title || "-"}</div>
          <div className="pp-access-detail-sub">{accountLabel(person)}</div>
          <div className="pp-access-detail-sub">{person.work_email}</div>
        </div>
      </div>

      {softWarning && (
        <div className="pp-access-soft-warn">
          Saved, but audit log entry failed: {softWarning}
        </div>
      )}

      {GROUPS.map((g) => (
        <section key={g.key} className="pp-access-group">
          <button
            type="button"
            className="pp-access-group-head"
            onClick={() => toggleGroup(g.key)}
            aria-expanded={!!openGroups[g.key]}
          >
            <span className="pp-access-region-chev">{openGroups[g.key] ? <ChevronDown /> : <ChevronRight />}</span>
            <span>{g.title}</span>
          </button>
          {openGroups[g.key] && (
            <div className="pp-access-group-body">
              {g.cols.map((col) => (
                <PermissionRow
                  key={col}
                  person={person}
                  col={col}
                  label={columnLabels[col] || col}
                  pending={pending && pending.col === col ? pending : null}
                  onStart={startPending}
                  onCancel={cancelPending}
                  onReasonChange={updatePendingReason}
                  onCommit={commitPending}
                  anotherPending={pending && pending.col !== col}
                />
              ))}
            </div>
          )}
        </section>
      ))}

      <section className="pp-access-group">
        <div className="pp-access-group-head pp-access-group-head--static">Change log</div>
        <div className="pp-access-group-body">
          {changelog.length === 0 && (
            <div className="pp-access-muted">No changes yet.</div>
          )}
          {changelog.map((e) => (
            <div key={e.id} className="pp-access-log-row">
              <div className="pp-access-log-top">
                <span className="pp-access-log-col">{columnLabels[e.column_name] || e.column_name}</span>
                <span className="pp-access-muted">{formatChangedAt(e.changed_at)}</span>
              </div>
              <div className="pp-access-log-mid">
                {formatValue(e.column_name, e.old_value)} → <strong>{formatValue(e.column_name, e.new_value)}</strong>
              </div>
              <div className="pp-access-log-bot">
                {e.reason} <span className="pp-access-muted">· by {e.changed_by}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── One row (toggle/select/text) with inline Reason / Save / Cancel ──
function PermissionRow({ person, col, label, pending, onStart, onCancel, onReasonChange, onCommit, anotherPending }) {
  const type = colTypeOf(col);
  const currentVal = person[col];
  // Super-admin lock chip: for SUPER_ADMIN rows, the is_ops_leadership
  // control is static text ("Super admin"), not a toggle. The server
  // 403s anyway; this prevents the attempt and matches the render.
  const isSuperAdminLock = col === "is_ops_leadership" && !!person.is_super_admin;

  const isPending = !!pending;
  const previewVal = isPending ? pending.value : currentVal;

  const onFlip = () => {
    if (anotherPending || isSuperAdminLock) return;
    if (type === "bool") {
      onStart(col, !currentVal);
    }
  };
  const onEnum = (v) => {
    if (anotherPending) return;
    if (v === currentVal) {
      onCancel();
      return;
    }
    onStart(col, v);
  };
  const onText = (v) => {
    if (anotherPending) return;
    const normalized = v === "" ? null : v;
    if ((normalized ?? null) === (currentVal ?? null)) return;
    onStart(col, normalized);
  };

  return (
    <div className={`pp-access-perm${isPending ? " pp-access-perm--pending" : ""}${anotherPending ? " pp-access-perm--locked" : ""}`}>
      <div className="pp-access-perm-main">
        <div className="pp-access-perm-label-wrap">
          <span className="pp-access-perm-label-text">{label}</span>
          <span className="pp-access-perm-col">{col}</span>
        </div>
        <div className="pp-access-perm-ctrl">
          {isSuperAdminLock ? (
            <span className="pp-access-lock-chip" title="Super admin - immutable via UI">
              <ShieldIcon /> Super admin
            </span>
          ) : type === "bool" ? (
            <button
              type="button"
              role="switch"
              aria-checked={!!previewVal}
              disabled={anotherPending}
              className={`pp-access-switch${previewVal ? " pp-access-switch--on" : ""}`}
              onClick={onFlip}
            >
              <span className="pp-access-switch-dot" />
            </button>
          ) : type === "enum" ? (
            <select
              value={previewVal == null ? "" : String(previewVal)}
              onChange={(e) => onEnum(e.target.value === "" ? null : e.target.value)}
              disabled={anotherPending}
              className="pp-access-select"
            >
              {ENUM_OPTIONS[col].map((o) => (
                <option key={String(o.v)} value={o.v == null ? "" : o.v}>{o.l}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              defaultValue={previewVal ?? ""}
              onBlur={(e) => onText(e.target.value.trim())}
              disabled={anotherPending}
              className="pp-access-input"
              placeholder="(unset)"
            />
          )}
        </div>
      </div>
      {isPending && (
        <div className="pp-access-pending">
          <div className="pp-access-pending-row">
            <input
              type="text"
              value={pending.reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Reason (required, <=280 chars)"
              className="pp-access-input pp-access-reason"
              maxLength={280}
              autoFocus
            />
            <button
              type="button"
              className="pp-access-btn pp-access-btn--primary"
              onClick={onCommit}
              disabled={pending.saving}
            >{pending.saving ? "Saving..." : "Save"}</button>
            <button
              type="button"
              className="pp-access-btn"
              onClick={onCancel}
              disabled={pending.saving}
            >Cancel</button>
          </div>
          {pending.error && (
            <div className="pp-access-pending-err">{pending.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

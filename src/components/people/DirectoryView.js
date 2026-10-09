"use client";

import { useEffect, useMemo, useState, useCallback } from "react";

// ─── Icons (Lucide-style stroke SVG, matches DashboardView convention) ───
const UsersIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const MailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 7 10-7" />
  </svg>
);
const PhoneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);
const MapPinIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
const BellIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);
const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// ─── Helpers (preserved from v1) ───
const initials = (name) =>
  String(name || "?")
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#be185d"];
function colorForName(name) {
  let h = 0;
  for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function normalizePhone(raw) {
  if (!raw) return { href: "", display: "" };
  const s = String(raw).trim();
  const digits = s.replace(/[^\d+]/g, "");
  const display = s.replace(/^tel:/i, "").trim();
  return { href: `tel:${digits}`, display };
}

// Gmail compose URL. Comma-separated To, URL-encoded.
function gmailCompose(emails) {
  const list = (Array.isArray(emails) ? emails : [emails]).filter(Boolean);
  if (list.length === 0) return "";
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(list.join(","))}`;
}

// Site-header name: "City, State - Level". CORP has its own "Corporate" label.
function siteLabel(team) {
  if (team.team_key === "CORP") return "Corporate";
  const place = [team.city, team.state].filter(Boolean).join(", ");
  const parts = [place, team.level].filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : (team.name || team.team_key);
}

function regionLabel(name) {
  if (name === "CORP") return "Corp";
  return name;
}

// Parse YYYY-MM-DD as a local date (avoids UTC-shift). Returns null on bad input.
function parseStartDate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function formatLongDate(d) {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function tenureSummary(startISO) {
  const start = parseStartDate(startISO);
  if (!start) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let years = today.getFullYear() - start.getFullYear();
  let months = today.getMonth() - start.getMonth();
  if (today.getDate() < start.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  years = Math.max(0, years);
  months = Math.max(0, months);

  const nextAnniv = new Date(start.getFullYear() + years + 1, start.getMonth(), start.getDate());
  const yearNum = years + 1;

  const timeParts = [];
  if (years > 0) timeParts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months > 0) timeParts.push(`${months} ${months === 1 ? "month" : "months"}`);
  if (timeParts.length === 0) timeParts.push("under a month");

  return {
    started:     `Started: ${formatLongDate(start)}`,
    time:        `Time with KitchFix: ${timeParts.join(", ")}`,
    anniversary: `Next anniversary: ${formatLongDate(nextAnniv)} (${ordinal(yearNum)} year)`,
  };
}

// Build the hierarchy: Corp first, then regions East/West with their sites.
function buildTree(data) {
  if (!data) return { corp: null, regions: [] };

  const peopleByTeam = new Map();
  for (const p of data.people) {
    if (!p.team_key) continue;
    if (!peopleByTeam.has(p.team_key)) peopleByTeam.set(p.team_key, []);
    peopleByTeam.get(p.team_key).push(p);
  }

  function splitRoster(list) {
    const managers = list
      .filter((p) => p.is_salaried || p.is_manager || p.is_site_leader)
      .sort((a, b) => {
        if (a.is_site_leader !== b.is_site_leader) return a.is_site_leader ? -1 : 1;
        return a.display_name.localeCompare(b.display_name);
      });
    const team = list
      .filter((p) => !(p.is_salaried || p.is_manager || p.is_site_leader))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    return { managers, team };
  }

  const siteOf = (team) => ({
    team,
    roster: splitRoster(peopleByTeam.get(team.team_key) || []),
  });

  const corpTeam = data.teams.find((t) => t.region === "CORP") || null;
  const corp = corpTeam ? siteOf(corpTeam) : null;

  const regions = [];
  for (const name of ["East", "West"]) {
    const sites = data.teams.filter((t) => t.region === name).map(siteOf);
    if (sites.length === 0) continue;
    const headcount = sites.reduce((s, x) => s + x.team.headcount, 0);
    regions.push({ name, headcount, siteCount: sites.length, sites });
  }
  return { corp, regions };
}

// Case-insensitive match on display_name or title.
function matchesSearch(person, needle) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  return (person.display_name || "").toLowerCase().includes(n)
      || (person.title || "").toLowerCase().includes(n);
}

function buildRowTags(person, team) {
  const tags = [];
  if (person.is_site_leader) tags.push({ key: "sl", label: "SITE LEADER", tone: "leader" });
  tags.push({ key: "cls", label: person.is_salaried ? "SALARIED" : "HOURLY", tone: person.is_salaried ? "salaried" : "hourly" });
  const level = team?.level || "";
  if (level) tags.push({ key: "lvl", label: level.toUpperCase(), tone: "level" });
  return tags;
}

export default function DirectoryView({ showToast, bootstrapData }) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [region, setRegion] = useState("All");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedId, setSelectedId] = useState(null);

  const isAdmin = !!bootstrapData?.isAdmin;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/people?action=directory")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) setData(d);
        else setLoadErr(true);
      })
      .catch(() => { if (!cancelled) setLoadErr(true); });
    return () => { cancelled = true; };
  }, []);

  const tree = useMemo(() => buildTree(data), [data]);

  const teamsByKey = useMemo(() => {
    const m = new Map();
    for (const t of data?.teams || []) m.set(t.team_key, t);
    return m;
  }, [data]);

  // Which team_keys match the current search? Used to auto-expand +
  // filter visible people. Null when search is empty = pass-through.
  const searchActive = search.trim().length > 0;
  const matchByTeam = useMemo(() => {
    if (!searchActive) return null;
    const m = new Map();
    for (const p of data?.people || []) {
      if (!matchesSearch(p, search.trim())) continue;
      if (!m.has(p.team_key)) m.set(p.team_key, new Set());
      m.get(p.team_key).add(p.worker_id);
    }
    return m;
  }, [search, searchActive, data]);

  // When searching, auto-expand matching sites. Union with user-expanded.
  const effectiveExpanded = useMemo(() => {
    if (!searchActive || !matchByTeam) return expanded;
    const out = new Set(expanded);
    for (const key of matchByTeam.keys()) out.add(key);
    return out;
  }, [expanded, searchActive, matchByTeam]);

  const toggleSite = useCallback((teamKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(teamKey)) next.delete(teamKey);
      else next.add(teamKey);
      return next;
    });
  }, []);

  const chooseRegion = (r) => {
    setRegion(r);
    setSelectedId(null);
  };

  const selectedPerson = useMemo(() => {
    if (!selectedId || !data) return null;
    return data.people.find((p) => p.worker_id === selectedId) || null;
  }, [selectedId, data]);

  const selectedTeam = useMemo(() => {
    if (!selectedPerson) return null;
    return teamsByKey.get(selectedPerson.team_key) || null;
  }, [selectedPerson, teamsByKey]);

  const closeDrawer = useCallback(() => setSelectedId(null), []);

  // Escape key closes drawer
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e) => { if (e.key === "Escape") closeDrawer(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, closeDrawer]);

  if (loadErr) {
    return (
      <div className="pp-view">
        <div className="pp-card pp-dir-card">
          <div className="pp-dir-empty-pane" style={{ padding: 40, textAlign: "center" }}>
            <p style={{ color: "var(--pp-grey)" }}>Could not load directory.</p>
          </div>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="pp-view">
        <div className="pp-card pp-dir-card">
          <div className="pp-dir-loading">Loading teammates...</div>
        </div>
      </div>
    );
  }

  const allHeadcount = data.regions.reduce((s, r) => s + r.headcount, 0);
  const showRegion = (name) => region === "All" || region === name;

  return (
    <div className="pp-view pp-dir-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-card pp-dir-card">
        <header className="pp-dir-header">
          <div className="pp-dir-header-icon"><UsersIcon /></div>
          <div className="pp-dir-header-text">
            <h2 className="pp-dir-title">Directory</h2>
            <p className="pp-dir-subtitle">Active teammates across KitchFix</p>
          </div>
          {isAdmin && (
            <button
              type="button"
              className="pp-dir-admin-btn"
              onClick={() => showToast && showToast("Admin editing coming soon.", "info")}
              aria-label="Admin editing"
              title="Admin editing"
            >
              <GearIcon />
            </button>
          )}
        </header>

        <div className="pp-dir-region-pills" role="tablist">
          <RegionPill label="All" count={allHeadcount} active={region === "All"} onClick={() => chooseRegion("All")} />
          {data.regions.map((r) => (
            <RegionPill
              key={r.name}
              label={regionLabel(r.name)}
              count={r.headcount}
              active={region === r.name}
              onClick={() => chooseRegion(r.name)}
            />
          ))}
        </div>

        <div className="pp-dir-search-wrap">
          <span className="pp-dir-search-icon" aria-hidden><SearchIcon /></span>
          <input
            className="pp-dir-search"
            type="search"
            placeholder="Search name or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search directory"
          />
          {search && (
            <button
              type="button"
              className="pp-dir-search-clear"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="pp-dir-tree">
          {/* Corp - single-level collapsible section */}
          {tree.corp && showRegion("CORP") && (() => {
            const site = tree.corp;
            const matchSet = matchByTeam?.get(site.team.team_key) || null;
            const vMgr = searchActive ? site.roster.managers.filter((p) => !matchSet || matchSet.has(p.worker_id)) : site.roster.managers;
            const vTeam = searchActive ? site.roster.team.filter((p) => !matchSet || matchSet.has(p.worker_id)) : site.roster.team;
            if (searchActive && vMgr.length + vTeam.length === 0) return null;
            const open = effectiveExpanded.has(site.team.team_key);
            return (
              <section className="pp-dir-section pp-dir-section--corp">
                <SiteGroup
                  site={site}
                  open={open}
                  onToggle={() => toggleSite(site.team.team_key)}
                  labelOverride="Corporate"
                  managers={vMgr}
                  teamList={vTeam}
                  onPersonClick={(id) => setSelectedId(id)}
                />
              </section>
            );
          })()}

          {/* East + West */}
          {tree.regions.map((reg) => {
            if (!showRegion(reg.name)) return null;
            const visibleSites = reg.sites.filter((s) => {
              if (!searchActive) return true;
              return matchByTeam?.has(s.team.team_key);
            });
            if (searchActive && visibleSites.length === 0) return null;
            return (
              <section key={reg.name} className="pp-dir-section">
                <div className="pp-dir-region-head">
                  <h3 className="pp-dir-region-head-name">{reg.name}</h3>
                  <span className="pp-dir-region-head-count">
                    {reg.headcount} {reg.headcount === 1 ? "person" : "people"} - {visibleSites.length} {visibleSites.length === 1 ? "site" : "sites"}
                  </span>
                </div>
                {visibleSites.map((site) => {
                  const matchSet = matchByTeam?.get(site.team.team_key) || null;
                  const vMgr = searchActive ? site.roster.managers.filter((p) => !matchSet || matchSet.has(p.worker_id)) : site.roster.managers;
                  const vTeam = searchActive ? site.roster.team.filter((p) => !matchSet || matchSet.has(p.worker_id)) : site.roster.team;
                  const open = effectiveExpanded.has(site.team.team_key);
                  return (
                    <SiteGroup
                      key={site.team.team_key}
                      site={site}
                      open={open}
                      onToggle={() => toggleSite(site.team.team_key)}
                      managers={vMgr}
                      teamList={vTeam}
                      onPersonClick={(id) => setSelectedId(id)}
                    />
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>

      {selectedPerson && (
        <PersonDrawer
          person={selectedPerson}
          team={selectedTeam}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}

function RegionPill({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      className={`pp-dir-region-pill${active ? " pp-dir-region-pill--active" : ""}`}
      onClick={onClick}
      role="tab"
      aria-selected={active}
      aria-label={`${label} - ${count} ${count === 1 ? "person" : "people"}`}
    >
      <span className="pp-dir-region-pill-label">{label}</span>
      <span className="pp-dir-region-pill-count" aria-hidden="true">{count}</span>
    </button>
  );
}

function SiteGroup({ site, open, onToggle, managers, teamList, onPersonClick, labelOverride }) {
  const emails = [...managers, ...teamList].map((p) => p.work_email).filter(Boolean);
  const emailHref = gmailCompose(emails);
  const label = labelOverride || siteLabel(site.team);
  const visibleCount = managers.length + teamList.length;

  return (
    <div className={`pp-dir-site${open ? " pp-dir-site--open" : ""}`}>
      <div className="pp-dir-site-head-row">
        <button
          type="button"
          className="pp-dir-site-head"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className={`pp-dir-site-chev${open ? " pp-dir-site-chev--open" : ""}`} aria-hidden><Chevron /></span>
          <span className="pp-dir-site-icon" aria-hidden><MapPinIcon /></span>
          <span className="pp-dir-site-name">{label}</span>
          <span className="pp-dir-site-count">
            {visibleCount} {visibleCount === 1 ? "person" : "people"}
          </span>
        </button>
        {emails.length > 0 && (
          <a
            href={emailHref}
            target="_blank"
            rel="noopener"
            className="pp-dir-site-email-btn"
            aria-label={`Email ${emails.length} people at ${label} via Gmail`}
          >
            <MailIcon />
            <span>Email ({emails.length})</span>
          </a>
        )}
      </div>
      {open && (
        <div className="pp-dir-site-body">
          {managers.length > 0 && (
            <>
              <h4 className="pp-dir-section-head">Management ({managers.length})</h4>
              <div className="pp-dir-rows">
                {managers.map((p) => (
                  <PersonRow key={p.worker_id} person={p} team={site.team} onClick={() => onPersonClick(p.worker_id)} />
                ))}
              </div>
            </>
          )}
          {teamList.length > 0 && (
            <>
              <h4 className="pp-dir-section-head">Team ({teamList.length})</h4>
              <div className="pp-dir-rows">
                {teamList.map((p) => (
                  <PersonRow key={p.worker_id} person={p} team={site.team} onClick={() => onPersonClick(p.worker_id)} />
                ))}
              </div>
            </>
          )}
          {managers.length === 0 && teamList.length === 0 && (
            <div className="pp-dir-empty-site">No teammates match the current filters.</div>
          )}
        </div>
      )}
    </div>
  );
}

function PersonRow({ person, team, onClick }) {
  const tags = buildRowTags(person, team);
  return (
    <button type="button" className="pp-dir-row" onClick={onClick}>
      <div
        className="pp-dir-avatar"
        style={{ background: colorForName(person.display_name) }}
        aria-hidden
      >
        {initials(person.display_name)}
      </div>
      <div className="pp-dir-row-body">
        <div className="pp-dir-row-name">{person.display_name}</div>
        <div className="pp-dir-row-role">{person.title || "-"}</div>
      </div>
      <div className="pp-dir-row-tags">
        {tags.map((t) => (
          <span key={t.key} className={`pp-dir-tag pp-dir-tag--${t.tone}`}>{t.label}</span>
        ))}
      </div>
      <span className="pp-dir-row-chev" aria-hidden><Chevron /></span>
    </button>
  );
}

function PersonDrawer({ person, team, onClose }) {
  const phone = normalizePhone(person.phone);
  const email = person.work_email || "";
  const tenure = tenureSummary(person.start_date);
  const emailHref = email ? gmailCompose(email) : "";
  const siteName = team ? siteLabel(team) : "";

  const tags = [];
  if (person.is_site_leader) tags.push({ key: "sl", label: "SITE LEADER", tone: "leader" });
  tags.push({ key: "cls", label: person.is_salaried ? "SALARIED" : "HOURLY", tone: person.is_salaried ? "salaried" : "hourly" });
  const regionTag = team?.region ? regionLabel(team.region).toUpperCase() : "";
  const levelTag = team?.level ? team.level.toUpperCase() : "";
  // Skip region tag when it duplicates the level tag (CORP people have both set to "CORP").
  if (regionTag && regionTag !== levelTag) tags.push({ key: "rgn", label: regionTag, tone: "region" });
  if (levelTag) tags.push({ key: "lvl", label: levelTag, tone: "level" });

  return (
    <div className="pp-dir-drawer-root" role="dialog" aria-modal="true" aria-label={`${person.display_name} details`}>
      <div className="pp-dir-drawer-backdrop" onClick={onClose} />
      <aside className="pp-dir-drawer">
        <div className="pp-dir-drawer-handle" aria-hidden />
        <button type="button" className="pp-dir-drawer-close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
        <div className="pp-dir-drawer-head">
          <div
            className="pp-dir-avatar pp-dir-avatar--lg"
            style={{ background: colorForName(person.display_name) }}
            aria-hidden
          >
            {initials(person.display_name)}
          </div>
          <div className="pp-dir-drawer-id">
            <h3 className="pp-dir-drawer-name">{person.display_name}</h3>
            <p className="pp-dir-drawer-role">{person.title || "-"}</p>
            {siteName && (
              <p className="pp-dir-drawer-site">
                <MapPinIcon /> <span>{siteName}</span>
              </p>
            )}
          </div>
        </div>

        {tags.length > 0 && (
          <div className="pp-dir-badges">
            {tags.map((t) => (
              <span key={t.key} className={`pp-dir-tag pp-dir-tag--${t.tone}`}>{t.label}</span>
            ))}
          </div>
        )}

        <section className="pp-dir-drawer-section">
          <div className="pp-dir-drawer-section-title">Tenure</div>
          {tenure ? (
            <div className="pp-dir-tenure">
              <div>{tenure.started}</div>
              <div>{tenure.time}</div>
              <div>{tenure.anniversary}</div>
            </div>
          ) : (
            <div className="pp-dir-tenure pp-dir-tenure--empty">Start date not available</div>
          )}
        </section>

        <section className="pp-dir-drawer-section">
          <div className="pp-dir-drawer-section-title">Contact</div>
          <div className="pp-dir-contact-list">
            {email && (
              <div className="pp-dir-contact-row">
                <div className="pp-dir-contact-icon" aria-hidden><MailIcon /></div>
                <div className="pp-dir-contact-text">
                  <div className="pp-dir-contact-label">Email</div>
                  <div className="pp-dir-contact-value">{email}</div>
                </div>
                <a
                  className="pp-btn pp-btn--primary pp-dir-contact-action"
                  href={emailHref}
                  target="_blank"
                  rel="noopener"
                >
                  <MailIcon />
                  <span>Email</span>
                </a>
              </div>
            )}
            {phone.display && (
              <div className="pp-dir-contact-row">
                <div className="pp-dir-contact-icon" aria-hidden><PhoneIcon /></div>
                <div className="pp-dir-contact-text">
                  <div className="pp-dir-contact-label">Phone</div>
                  <div className="pp-dir-contact-value">{phone.display}</div>
                </div>
                <a className="pp-btn pp-btn--secondary pp-dir-contact-action" href={phone.href}>
                  <PhoneIcon />
                  <span>Call</span>
                </a>
              </div>
            )}
          </div>
        </section>

        {person.is_site_leader && (
          <section className="pp-dir-drawer-section">
            <div className="pp-dir-routing">
              <div className="pp-dir-routing-icon"><BellIcon /></div>
              <div className="pp-dir-routing-body">
                <div className="pp-dir-routing-title">Notification routing</div>
                <div className="pp-dir-routing-text">
                  CC&rsquo;d on all People Portal submissions from <strong>{siteName || "this site"}</strong>.
                  {person.site_leader_note ? <> {person.site_leader_note}</> : null}
                </div>
              </div>
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

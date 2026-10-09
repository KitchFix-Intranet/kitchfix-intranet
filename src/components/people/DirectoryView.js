"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";

// ─── Icons (Lucide-style stroke SVG) ─────────────────────────────────
const UsersIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const MailIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m2 7 10 7 10-7" />
  </svg>
);
const PhoneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);
const MapPinIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);
const ChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
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
const CalendarIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const ClockIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </svg>
);
const CakeIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8" />
    <path d="M4 16s1.5-2 4-2 2.5 2 4 2 2.5-2 4-2 4 2 4 2" />
    <path d="M2 21h20" />
    <path d="M7 8v3" /><path d="M12 8v3" /><path d="M17 8v3" />
    <path d="M7 4h.01" /><path d="M12 4h.01" /><path d="M17 4h.01" />
  </svg>
);

// ─── Helpers ─────────────────────────────────────────────────────────
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

// Gmail compose. Comma-separated To (or BCC when bcc=true).
function gmailCompose(emails, { bcc = false } = {}) {
  const list = (Array.isArray(emails) ? emails : [emails]).filter(Boolean);
  if (list.length === 0) return "";
  const param = bcc ? "bcc" : "to";
  return `https://mail.google.com/mail/?view=cm&fs=1&${param}=${encodeURIComponent(list.join(","))}`;
}

function siteLabel(team) {
  if (!team) return "";
  if (team.team_key === "CORP") return "Corporate";
  const place = [team.city, team.state].filter(Boolean).join(", ");
  const parts = [place, team.level].filter(Boolean);
  return parts.length > 0 ? parts.join(" - ") : (team.name || team.team_key);
}

function regionLabel(name) {
  if (name === "CORP") return "Corp";
  return name;
}

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

function formatMonthDay(d) {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
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

// Returns "X months", "X years", "in Y days", etc. from today to target.
function relativeFuture(target, from = new Date()) {
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  const t = new Date(target);
  t.setHours(0, 0, 0, 0);
  const diffMs = t - today;
  const days = Math.round(diffMs / (24 * 3600 * 1000));
  if (days < 0) return "";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 31) return `in ${days} days`;
  // Months
  let months = (t.getFullYear() - today.getFullYear()) * 12 + (t.getMonth() - today.getMonth());
  if (t.getDate() < today.getDate()) months--;
  if (months < 12) return `in ${months} ${months === 1 ? "month" : "months"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `in ${years} ${years === 1 ? "year" : "years"}`;
  return `in ${years} ${years === 1 ? "year" : "years"}, ${rem} ${rem === 1 ? "month" : "months"}`;
}

// Returns "X months with KitchFix" / "X years with KitchFix" from a start date.
function tenureSince(start, from = new Date()) {
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  let years = today.getFullYear() - s.getFullYear();
  let months = today.getMonth() - s.getMonth();
  if (today.getDate() < s.getDate()) months--;
  if (months < 0) { years--; months += 12; }
  years = Math.max(0, years);
  months = Math.max(0, months);
  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  if (parts.length === 0) parts.push("under a month");
  return `${parts.join(", ")} with KitchFix`;
}

// Next occurrence of a MM-DD birthday from today (uses current or next year).
function nextBirthdayDate(mmdd, from = new Date()) {
  const m = String(mmdd || "").match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]) - 1;
  const day = Number(m[2]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const today = new Date(from);
  today.setHours(0, 0, 0, 0);
  let candidate = new Date(today.getFullYear(), month, day);
  if (candidate < today) candidate = new Date(today.getFullYear() + 1, month, day);
  return candidate;
}

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
  const siteOf = (team) => ({ team, roster: splitRoster(peopleByTeam.get(team.team_key) || []) });
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

function matchesSearch(person, needle) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  return (person.display_name || "").toLowerCase().includes(n)
      || (person.title || "").toLowerCase().includes(n);
}

function buildRowTags(person, team) {
  const tags = [];
  if (person.is_site_leader) tags.push({ key: "sl", label: "SITE LEADER", tone: "leader" });
  tags.push({ key: "cls", label: person.is_salaried ? "MANAGER" : "ASSOCIATE", tone: person.is_salaried ? "salaried" : "hourly" });
  const regionTag = team?.region ? regionLabel(team.region).toUpperCase() : "";
  const levelTag = team?.level ? team.level.toUpperCase() : "";
  if (regionTag && regionTag !== levelTag) tags.push({ key: "rgn", label: regionTag, tone: "region" });
  if (levelTag) tags.push({ key: "lvl", label: levelTag, tone: "level" });
  return tags;
}

export default function DirectoryView({ showToast, bootstrapData }) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedTeamKey, setSelectedTeamKey] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [msgOpen, setMsgOpen] = useState(false);
  const [mobileMode, setMobileMode] = useState("tree"); // "tree" | "roster"
  const msgRef = useRef(null);

  const isAdmin = !!bootstrapData?.isAdmin;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/people?action=directory")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.success) {
          setData(d);
          // Default selection: CORP (always relevant) if present, else first team
          const defaultKey = d.teams.find((t) => t.region === "CORP")?.team_key
            || d.teams[0]?.team_key
            || null;
          setSelectedTeamKey(defaultKey);
        } else {
          setLoadErr(true);
        }
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

  // Effective selection: honor the user's choice when it still matches
  // the active search, otherwise fall back to the first match. Derived
  // at render time so no state cascade needed.
  const effectiveSelectedKey = useMemo(() => {
    if (!data) return null;
    if (searchActive && matchByTeam) {
      if (selectedTeamKey && matchByTeam.has(selectedTeamKey)) return selectedTeamKey;
      const first = [...matchByTeam.keys()][0];
      return first || selectedTeamKey;
    }
    return selectedTeamKey;
  }, [data, searchActive, matchByTeam, selectedTeamKey]);

  const selectedSite = useMemo(() => {
    if (!effectiveSelectedKey || !data) return null;
    const team = teamsByKey.get(effectiveSelectedKey);
    if (!team) return null;
    const peopleOfTeam = data.people.filter((p) => p.team_key === effectiveSelectedKey);
    const managers = peopleOfTeam
      .filter((p) => p.is_salaried || p.is_manager || p.is_site_leader)
      .sort((a, b) => {
        if (a.is_site_leader !== b.is_site_leader) return a.is_site_leader ? -1 : 1;
        return a.display_name.localeCompare(b.display_name);
      });
    const teamList = peopleOfTeam
      .filter((p) => !(p.is_salaried || p.is_manager || p.is_site_leader))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    const matchSet = matchByTeam?.get(effectiveSelectedKey) || null;
    const vMgr = searchActive ? managers.filter((p) => !matchSet || matchSet.has(p.worker_id)) : managers;
    const vTeam = searchActive ? teamList.filter((p) => !matchSet || matchSet.has(p.worker_id)) : teamList;
    return { team, managers: vMgr, team_list: vTeam };
  }, [effectiveSelectedKey, data, teamsByKey, matchByTeam, searchActive]);

  const chooseSite = useCallback((teamKey) => {
    setSelectedTeamKey(teamKey);
    setMobileMode("roster");
  }, []);

  const selectedPerson = useMemo(() => {
    if (!selectedId || !data) return null;
    return data.people.find((p) => p.worker_id === selectedId) || null;
  }, [selectedId, data]);
  const selectedPersonTeam = useMemo(() => {
    if (!selectedPerson) return null;
    return teamsByKey.get(selectedPerson.team_key) || null;
  }, [selectedPerson, teamsByKey]);

  const closeDrawer = useCallback(() => setSelectedId(null), []);

  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e) => { if (e.key === "Escape") closeDrawer(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, closeDrawer]);

  // Message menu outside click / Escape
  useEffect(() => {
    if (!msgOpen) return;
    const onDown = (e) => {
      if (msgRef.current && !msgRef.current.contains(e.target)) setMsgOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setMsgOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [msgOpen]);

  // Message menu actions
  const messageActions = useMemo(() => {
    if (!data) return null;
    const managersWithEmail = data.people.filter((p) => p.is_salaried && p.work_email);
    const managersByRegion = (regionName) => {
      const teamsInRegion = new Set(
        data.teams.filter((t) => t.region === regionName).map((t) => t.team_key)
      );
      return managersWithEmail.filter((p) => teamsInRegion.has(p.team_key));
    };
    return {
      all: managersWithEmail,
      east: managersByRegion("East"),
      west: managersByRegion("West"),
    };
  }, [data]);

  const copyManagerEmails = async () => {
    if (!messageActions?.all) return;
    const text = messageActions.all.map((p) => p.work_email).join("; ");
    try {
      await navigator.clipboard.writeText(text);
      showToast && showToast(`Copied ${messageActions.all.length} manager emails`, "success");
    } catch {
      showToast && showToast("Clipboard blocked - selecting the list for manual copy", "info");
      // Fallback: open a prompt so the user can select+copy manually
      try { window.prompt("Copy manager emails:", text); } catch { /* noop */ }
    }
    setMsgOpen(false);
  };

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

  return (
    <div className="pp-view pp-dir-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-card pp-dir-card">
        <header className="pp-dir-header">
          <div className="pp-dir-header-icon"><UsersIcon /></div>
          <div className="pp-dir-header-text">
            <h2 className="pp-dir-title">Directory</h2>
            <p className="pp-dir-subtitle">Active teammates across KitchFix</p>
          </div>
          <div className="pp-dir-header-actions">
            <div className="pp-dir-msg-wrap" ref={msgRef}>
              <button
                type="button"
                className="pp-dir-msg-btn"
                onClick={() => setMsgOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={msgOpen}
                aria-label="Message managers"
              >
                <MailIcon />
                <span>Message</span>
                <ChevronDown />
              </button>
              {msgOpen && messageActions && (
                <div className="pp-dir-msg-menu" role="menu">
                  <h5>Email in Gmail</h5>
                  {messageActions.all.length > 0 && (
                    <a
                      role="menuitem"
                      href={gmailCompose(messageActions.all.map((p) => p.work_email), { bcc: true })}
                      target="_blank"
                      rel="noopener"
                      onClick={() => setMsgOpen(false)}
                    >
                      <span>All managers</span>
                      <span className="pp-dir-msg-count">{messageActions.all.length}</span>
                    </a>
                  )}
                  {messageActions.east.length > 0 && (
                    <a
                      role="menuitem"
                      href={gmailCompose(messageActions.east.map((p) => p.work_email))}
                      target="_blank"
                      rel="noopener"
                      onClick={() => setMsgOpen(false)}
                    >
                      <span>East site managers</span>
                      <span className="pp-dir-msg-count">{messageActions.east.length}</span>
                    </a>
                  )}
                  {messageActions.west.length > 0 && (
                    <a
                      role="menuitem"
                      href={gmailCompose(messageActions.west.map((p) => p.work_email))}
                      target="_blank"
                      rel="noopener"
                      onClick={() => setMsgOpen(false)}
                    >
                      <span>West site managers</span>
                      <span className="pp-dir-msg-count">{messageActions.west.length}</span>
                    </a>
                  )}
                  <hr />
                  <button type="button" role="menuitem" onClick={copyManagerEmails}>
                    <span>Copy all manager emails</span>
                    <span className="pp-dir-msg-count">{messageActions.all.length}</span>
                  </button>
                  <p className="pp-dir-msg-hint">
                    Opens a new Gmail tab. The full list goes in BCC; site lists go in To so reply-all works.
                  </p>
                </div>
              )}
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
          </div>
        </header>

        {/* Two-panel layout: left tree + right roster. Below 720px the
            two panes become a single column with a tree/roster toggle. */}
        <div className={`pp-dir-split pp-dir-split--${mobileMode}`}>
          <aside className="pp-dir-pane pp-dir-pane--tree">
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

            <nav className="pp-dir-tree" aria-label="Sites">
              {tree.corp && (() => {
                const site = tree.corp;
                if (searchActive && !matchByTeam?.has(site.team.team_key)) return null;
                return (
                  <TreeSite
                    key={site.team.team_key}
                    team={site.team}
                    labelOverride="Corporate"
                    selected={effectiveSelectedKey === site.team.team_key}
                    onClick={() => chooseSite(site.team.team_key)}
                  />
                );
              })()}
              {tree.regions.map((reg) => {
                const visibleSites = reg.sites.filter((s) =>
                  !searchActive || matchByTeam?.has(s.team.team_key)
                );
                if (visibleSites.length === 0) return null;
                return (
                  <div className="pp-dir-tree-region" key={reg.name}>
                    <h3 className="pp-dir-tree-region-head">{reg.name}</h3>
                    {visibleSites.map((s) => (
                      <TreeSite
                        key={s.team.team_key}
                        team={s.team}
                        selected={selectedTeamKey === s.team.team_key}
                        onClick={() => chooseSite(s.team.team_key)}
                      />
                    ))}
                  </div>
                );
              })}
            </nav>
          </aside>

          <section className="pp-dir-pane pp-dir-pane--roster">
            {mobileMode === "roster" && (
              <button
                type="button"
                className="pp-dir-mobile-back"
                onClick={() => setMobileMode("tree")}
              >
                <ChevronLeft />
                <span>Back to sites</span>
              </button>
            )}
            {selectedSite ? (
              <RosterPanel
                site={selectedSite}
                onPersonClick={(id) => setSelectedId(id)}
              />
            ) : (
              <div className="pp-dir-empty-pane">
                <div className="pp-dir-empty-icon"><UsersIcon /></div>
                <p>Select a site from the tree to see teammates.</p>
              </div>
            )}
          </section>
        </div>
      </div>

      {selectedPerson && (
        <PersonDrawer
          person={selectedPerson}
          team={selectedPersonTeam}
          onClose={closeDrawer}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

function TreeSite({ team, labelOverride, selected, onClick }) {
  const label = labelOverride || siteLabel(team);
  return (
    <button
      type="button"
      className={`pp-dir-tree-site${selected ? " pp-dir-tree-site--active" : ""}`}
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
    >
      <span className="pp-dir-tree-site-icon" aria-hidden><MapPinIcon /></span>
      <span className="pp-dir-tree-site-label">{label}</span>
      <span className="pp-dir-tree-site-count">{team.headcount}</span>
    </button>
  );
}

function RosterPanel({ site, onPersonClick }) {
  const { team, managers, team_list } = site;
  const label = siteLabel(team);
  const emails = [...managers, ...team_list].map((p) => p.work_email).filter(Boolean);
  const emailHref = gmailCompose(emails);
  const totalVisible = managers.length + team_list.length;

  return (
    <div className="pp-dir-roster">
      <div className="pp-dir-roster-head">
        <div className="pp-dir-roster-title-row">
          <h3 className="pp-dir-roster-title">
            <MapPinIcon size={16} />
            <span>{label}</span>
          </h3>
          <div className="pp-dir-roster-count">
            {totalVisible} {totalVisible === 1 ? "person" : "people"}
          </div>
        </div>
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

      {totalVisible === 0 ? (
        <div className="pp-dir-empty-site">No teammates match the current filters.</div>
      ) : (
        <>
          {managers.length > 0 && (
            <>
              <h4 className="pp-dir-section-head">Management ({managers.length})</h4>
              <div className="pp-dir-rows">
                {managers.map((p) => (
                  <PersonRow key={p.worker_id} person={p} team={team} onClick={() => onPersonClick(p.worker_id)} />
                ))}
              </div>
            </>
          )}
          {team_list.length > 0 && (
            <>
              <h4 className="pp-dir-section-head">Team ({team_list.length})</h4>
              <div className="pp-dir-rows">
                {team_list.map((p) => (
                  <PersonRow key={p.worker_id} person={p} team={team} onClick={() => onPersonClick(p.worker_id)} />
                ))}
              </div>
            </>
          )}
        </>
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

function PersonDrawer({ person, team, onClose, isAdmin }) {
  const phone = normalizePhone(person.phone);
  const workEmail = person.work_email || "";
  const personalEmail = person.personal_email || "";
  const effectiveEmail = workEmail || personalEmail;
  const effectiveEmailLabel = workEmail ? "Email" : (personalEmail ? "Personal email" : "");
  const siteName = team ? siteLabel(team) : "";

  const tags = [];
  if (person.is_site_leader) tags.push({ key: "sl", label: "SITE LEADER", tone: "leader" });
  tags.push({ key: "cls", label: person.is_salaried ? "MANAGER" : "ASSOCIATE", tone: person.is_salaried ? "salaried" : "hourly" });
  const regionTag = team?.region ? regionLabel(team.region).toUpperCase() : "";
  const levelTag = team?.level ? team.level.toUpperCase() : "";
  if (regionTag && regionTag !== levelTag) tags.push({ key: "rgn", label: regionTag, tone: "region" });
  if (levelTag) tags.push({ key: "lvl", label: levelTag, tone: "level" });

  // Tenure facts
  const start = parseStartDate(person.start_date);
  const now = new Date();
  let factStarted = null;
  let factAnniv = null;
  if (start) {
    const years = Math.max(0, now.getFullYear() - start.getFullYear() - (
      (now.getMonth() < start.getMonth() || (now.getMonth() === start.getMonth() && now.getDate() < start.getDate())) ? 1 : 0
    ));
    const nextAnniv = new Date(start.getFullYear() + years + 1, start.getMonth(), start.getDate());
    factStarted = { value: formatLongDate(start), sub: tenureSince(start, now) };
    factAnniv = {
      value: `${formatLongDate(nextAnniv)} - ${ordinal(years + 1)} year`,
      sub: relativeFuture(nextAnniv, now),
    };
  }

  // Birthday fact
  let factBirthday = null;
  const nextBday = nextBirthdayDate(person.birthday, now);
  if (nextBday) {
    factBirthday = {
      value: formatMonthDay(nextBday),
      sub: relativeFuture(nextBday, now),
    };
  }

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
          <div className="pp-dir-drawer-section-title">Contact</div>
          <div className="pp-dir-contact-list">
            {effectiveEmail && (
              <div className="pp-dir-contact-row">
                <div className="pp-dir-contact-icon" aria-hidden><MailIcon /></div>
                <div className="pp-dir-contact-text">
                  <div className="pp-dir-contact-label">{effectiveEmailLabel}</div>
                  <div className="pp-dir-contact-value">{effectiveEmail}</div>
                </div>
                <a
                  className="pp-btn pp-btn--primary pp-dir-contact-action"
                  href={gmailCompose(effectiveEmail)}
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

        {person.start_date && (
          <section className="pp-dir-drawer-section">
            <div className="pp-dir-block-title">With KitchFix</div>
            {factStarted && (
              <div className="pp-dir-fact">
                <div className="pp-dir-fact-icon"><CalendarIcon /></div>
                <div>
                  <div className="pp-dir-fact-label">Started</div>
                  <div className="pp-dir-fact-value">{factStarted.value}</div>
                  <div className="pp-dir-fact-sub">{factStarted.sub}</div>
                </div>
              </div>
            )}
            {factAnniv && (
              <div className="pp-dir-fact">
                <div className="pp-dir-fact-icon"><ClockIcon /></div>
                <div>
                  <div className="pp-dir-fact-label">Work anniversary</div>
                  <div className="pp-dir-fact-value">{factAnniv.value}</div>
                  <div className="pp-dir-fact-sub">{factAnniv.sub}</div>
                </div>
              </div>
            )}
            <div className="pp-dir-fact">
              <div className="pp-dir-fact-icon"><CakeIcon /></div>
              <div>
                <div className="pp-dir-fact-label">Birthday</div>
                {factBirthday ? (
                  <>
                    <div className="pp-dir-fact-value">{factBirthday.value}</div>
                    <div className="pp-dir-fact-sub">{factBirthday.sub}</div>
                  </>
                ) : (
                  <div className="pp-dir-fact-value pp-dir-fact-value--muted">Not in Rippling sync yet</div>
                )}
              </div>
            </div>
          </section>
        )}

      </aside>
    </div>
  );
}

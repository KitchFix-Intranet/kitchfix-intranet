"use client";

import { useEffect, useMemo, useState } from "react";

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
const SlackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="13" y="2" width="3" height="8" rx="1.5" />
    <path d="M19 8.5A1.5 1.5 0 1 1 20.5 10H19V8.5z" />
    <rect x="8" y="14" width="3" height="8" rx="1.5" />
    <path d="M5 15.5A1.5 1.5 0 1 1 3.5 14H5v1.5z" />
    <rect x="14" y="13" width="8" height="3" rx="1.5" />
    <path d="M15.5 19a1.5 1.5 0 1 1 0 1.5V19z" />
    <rect x="2" y="8" width="8" height="3" rx="1.5" />
    <path d="M8.5 5A1.5 1.5 0 1 1 10 3.5V5H8.5z" />
  </svg>
);
const MapPinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);
const BriefcaseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);
const BellIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);
const ChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

// ─── helpers ───
const initials = (name) =>
  String(name || "?")
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

// Stable palette so an initials circle keeps the same color for a given name
const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#be185d"];
function colorForName(name) {
  let h = 0;
  for (const c of String(name || "")) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// Normalize Rippling phone (tel:+1-###-###-####) to a tel: URI + display text
function normalizePhone(raw) {
  if (!raw) return { href: "", display: "" };
  const s = String(raw).trim();
  const digits = s.replace(/[^\d+]/g, "");
  const display = s.replace(/^tel:/i, "").trim();
  return { href: `tel:${digits}`, display };
}

export default function DirectoryView({ showToast }) {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [region, setRegion] = useState("All");
  const [teamKey, setTeamKey] = useState(""); // "" = all teams in region
  const [selectedId, setSelectedId] = useState(null);

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

  // ─── Derive view-state ───
  const regionFiltered = useMemo(() => {
    if (!data) return [];
    if (region === "All") return data.teams;
    return data.teams.filter((t) => t.region === region);
  }, [data, region]);

  const activeTeam = useMemo(() => {
    if (!teamKey) return regionFiltered[0] || null;
    return regionFiltered.find((t) => t.team_key === teamKey) || regionFiltered[0] || null;
  }, [regionFiltered, teamKey]);

  const roster = useMemo(() => {
    if (!data || !activeTeam) return { managers: [], team: [] };
    const inSite = data.people.filter((p) => p.team_key === activeTeam.team_key);
    const managers = inSite
      .filter((p) => p.is_salaried || p.is_manager || p.is_site_leader)
      .sort((a, b) => {
        if (a.is_site_leader !== b.is_site_leader) return a.is_site_leader ? -1 : 1;
        return a.display_name.localeCompare(b.display_name);
      });
    const team = inSite
      .filter((p) => !(p.is_salaried || p.is_manager || p.is_site_leader))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    return { managers, team };
  }, [data, activeTeam]);

  // Derived selection: use explicit selectedId when set, otherwise
  // fall back to the first manager at the active site. Avoids an
  // effect-driven state cascade.
  const selected = useMemo(() => {
    if (!data || !activeTeam) return null;
    if (selectedId) {
      const match = data.people.find((p) => p.worker_id === selectedId);
      if (match && match.team_key === activeTeam.team_key) return match;
    }
    return roster.managers[0] || null;
  }, [selectedId, data, activeTeam, roster.managers]);

  const chooseRegion = (r) => {
    setRegion(r);
    setTeamKey("");
    setSelectedId(null);
  };

  const chooseTeam = (k) => {
    setTeamKey(k);
    setSelectedId(null);
  };

  // ─── Render ───
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

  return (
    <div className="pp-view pp-dir-view" style={{ animation: "pp-slideUp 0.4s ease" }}>
      <div className="pp-card pp-dir-card">
        <header className="pp-dir-header">
          <div className="pp-dir-header-icon"><UsersIcon /></div>
          <div>
            <h2 className="pp-dir-title">Directory</h2>
            <p className="pp-dir-subtitle">Active teammates across KitchFix</p>
          </div>
        </header>

        <div className="pp-dir-region-pills" role="tablist">
          <RegionPill label="All"  count={allHeadcount}         active={region === "All"}  onClick={() => chooseRegion("All")} />
          {data.regions.map((r) => (
            <RegionPill
              key={r.name}
              label={r.name}
              count={r.headcount}
              active={region === r.name}
              onClick={() => chooseRegion(r.name)}
            />
          ))}
        </div>

        <div className="pp-dir-site-row">
          <label className="pp-dir-site-label">Site</label>
          <select
            className="pp-dir-site-select"
            value={activeTeam?.team_key || ""}
            onChange={(e) => chooseTeam(e.target.value)}
            aria-label="Select site"
          >
            {regionFiltered.map((t) => (
              <option key={t.team_key} value={t.team_key}>
                {t.name}  -  {t.headcount} {t.headcount === 1 ? "person" : "people"}
              </option>
            ))}
          </select>
        </div>

        {activeTeam ? (
          <>
            <div className="pp-dir-site-banner">
              <div className="pp-dir-site-name">
                <MapPinIcon />
                <span>{activeTeam.name}</span>
              </div>
              <div className="pp-dir-site-stats">
                <span className="pp-dir-stat"><strong>{roster.managers.length}</strong> Management</span>
                <span className="pp-dir-stat-sep" aria-hidden>·</span>
                <span className="pp-dir-stat"><strong>{roster.team.length}</strong> Team</span>
                <span className="pp-dir-stat-sep" aria-hidden>·</span>
                <span className="pp-dir-stat"><strong>{activeTeam.headcount}</strong> Total</span>
              </div>
            </div>

            <div className="pp-dir-split">
              <aside className="pp-dir-roster">
                {roster.managers.length > 0 && (
                  <>
                    <h4 className="pp-dir-section-head">Management ({roster.managers.length})</h4>
                    <div className="pp-dir-rows">
                      {roster.managers.map((p) => (
                        <RosterRow
                          key={p.worker_id}
                          person={p}
                          selected={selectedId === p.worker_id}
                          onClick={() => setSelectedId(p.worker_id)}
                        />
                      ))}
                    </div>
                  </>
                )}
                {roster.team.length > 0 && (
                  <>
                    <h4 className="pp-dir-section-head">Team ({roster.team.length})</h4>
                    <div className="pp-dir-rows">
                      {roster.team.map((p) => (
                        <SlimRow key={p.worker_id} person={p} />
                      ))}
                    </div>
                  </>
                )}
                {roster.managers.length === 0 && roster.team.length === 0 && (
                  <div className="pp-dir-empty-site">No active teammates at this site.</div>
                )}
              </aside>

              <section className="pp-dir-detail" aria-live="polite">
                {selected ? (
                  <ManagerCard person={selected} team={activeTeam} />
                ) : (
                  <div className="pp-dir-empty-pane">
                    <div className="pp-dir-empty-icon"><UsersIcon /></div>
                    <p>Select a manager for contact details</p>
                  </div>
                )}
              </section>
            </div>
          </>
        ) : (
          <div className="pp-dir-empty-site">No sites in this region.</div>
        )}
      </div>
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

function RosterRow({ person, selected, onClick }) {
  return (
    <button
      type="button"
      className={`pp-dir-row pp-dir-row--manager${selected ? " pp-dir-row--selected" : ""}`}
      onClick={onClick}
    >
      <div className="pp-dir-avatar" style={{ background: colorForName(person.display_name) }}>
        {initials(person.display_name)}
      </div>
      <div className="pp-dir-row-body">
        <div className="pp-dir-row-name">{person.display_name}</div>
        <div className="pp-dir-row-role">{person.title || "-"}</div>
      </div>
      <span className="pp-dir-row-chev" aria-hidden><ChevronRight /></span>
    </button>
  );
}

function SlimRow({ person }) {
  const phone = normalizePhone(person.phone);
  const email = person.work_email || person.personal_email || "";
  return (
    <div className="pp-dir-row pp-dir-row--hourly">
      <div className="pp-dir-avatar pp-dir-avatar--slim" style={{ background: colorForName(person.display_name) }}>
        {initials(person.display_name)}
      </div>
      <div className="pp-dir-row-body">
        <div className="pp-dir-row-name">{person.display_name}</div>
        <div className="pp-dir-row-role">{person.title || "-"}</div>
      </div>
      <div className="pp-dir-row-contacts">
        {email && (
          <a className="pp-dir-icon-link" href={`mailto:${email}`} aria-label={`Email ${person.display_name}`}>
            <MailIcon />
          </a>
        )}
        {phone.href && (
          <a className="pp-dir-icon-link" href={phone.href} aria-label={`Call ${person.display_name}`}>
            <PhoneIcon />
          </a>
        )}
      </div>
    </div>
  );
}

function ManagerCard({ person, team }) {
  const phone = normalizePhone(person.phone);
  const email = person.work_email || person.personal_email || "";
  const slackHref = person.slack_user_id ? `slack://user?id=${person.slack_user_id}` : "";

  const badges = [];
  if (person.is_site_leader) badges.push({ label: "SITE LEADER", tone: "leader" });
  if (person.is_manager)     badges.push({ label: "MANAGER",     tone: "manager" });
  if (person.is_salaried)    badges.push({ label: "SALARIED",    tone: "salaried" });

  return (
    <article className="pp-dir-manager-card">
      <div className="pp-dir-manager-head">
        <div className="pp-dir-avatar pp-dir-avatar--lg" style={{ background: colorForName(person.display_name) }}>
          {initials(person.display_name)}
        </div>
        <div className="pp-dir-manager-id">
          <h3 className="pp-dir-manager-name">{person.display_name}</h3>
          <p className="pp-dir-manager-role">{person.title || "-"}</p>
        </div>
      </div>

      {badges.length > 0 && (
        <div className="pp-dir-badges">
          {badges.map((b) => (
            <span key={b.label} className={`pp-dir-badge pp-dir-badge--${b.tone}`}>{b.label}</span>
          ))}
        </div>
      )}

      <div className="pp-dir-contact-list">
        {email && (
          <ContactRow icon={<MailIcon />} label="Email" value={email} href={`mailto:${email}`} />
        )}
        {phone.display && (
          <ContactRow icon={<PhoneIcon />} label="Phone" value={phone.display} href={phone.href} />
        )}
        {person.slack_handle && (
          <ContactRow
            icon={<SlackIcon />}
            label="Slack"
            value={person.slack_handle}
            href={slackHref}
          />
        )}
        <ContactRow icon={<MapPinIcon />} label="Location" value={team.name} />
        <ContactRow icon={<BriefcaseIcon />} label="Role" value={person.title || "-"} />
      </div>

      {person.is_site_leader && (
        <div className="pp-dir-routing">
          <div className="pp-dir-routing-icon"><BellIcon /></div>
          <div className="pp-dir-routing-body">
            <div className="pp-dir-routing-title">Notification routing</div>
            <div className="pp-dir-routing-text">
              CC&rsquo;d on all People Portal submissions from <strong>{team.name}</strong>.
              {person.site_leader_note ? <> {person.site_leader_note}</> : null}
            </div>
          </div>
        </div>
      )}

      <div className="pp-dir-detail-actions">
        {email && (
          <a className="pp-btn pp-btn--primary pp-dir-action" href={`mailto:${email}`}>
            <MailIcon />
            <span>Email</span>
          </a>
        )}
        {slackHref && (
          <a className="pp-btn pp-btn--secondary pp-dir-action" href={slackHref}>
            <SlackIcon />
            <span>Slack</span>
          </a>
        )}
      </div>
    </article>
  );
}

function ContactRow({ icon, label, value, href }) {
  return (
    <div className="pp-dir-contact-row">
      <div className="pp-dir-contact-icon" aria-hidden>{icon}</div>
      <div className="pp-dir-contact-text">
        <div className="pp-dir-contact-label">{label}</div>
        {href ? (
          <a className="pp-dir-contact-value pp-dir-contact-value--link" href={href}>{value}</a>
        ) : (
          <div className="pp-dir-contact-value">{value}</div>
        )}
      </div>
    </div>
  );
}

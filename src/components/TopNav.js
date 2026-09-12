'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import ProfileModal from './ProfileModal';
import './TopNav.css';

/* ── Icon helpers ── */
const icons = {
  home: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
directory: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="8" y1="6" x2="8" y2="6.01" />
      <line x1="8" y1="10" x2="8" y2="10.01" />
      <line x1="8" y1="14" x2="8" y2="14.01" />
    </svg>
  ),
    ops: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  ),
people: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  calendar: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01" />
      <path d="M12 14h.01" />
      <path d="M16 14h.01" />
      <path d="M8 18h.01" />
      <path d="M12 18h.01" />
    </svg>
  ),
  playbook: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
      <path d="M4 19.5V22h16" />
      <line x1="8" y1="7"  x2="16" y2="7"  />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  ),
  sous: (
    // Sous identity mark - 24-basis 1A rendered at 18px on currentColor.
    // Geometry matches docs/SOUS_MARK_SPEC.md §2 (nav cut): 6.4 tiles at
    // orbit 6, 1.9 corner radius, mound r 1.25. TopNav.css carries the
    // one scoped rule that swaps active color to var(--accent-sous).
    <svg className="sa-navmark" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="8.8" y="2.8"  width="6.4" height="6.4" rx="1.9" transform="rotate(45 12 6)"/>
      <rect x="14.8" y="8.8" width="6.4" height="6.4" rx="1.9" transform="rotate(45 18 12)"/>
      <rect x="8.8" y="14.8" width="6.4" height="6.4" rx="1.9" transform="rotate(45 12 18)"/>
      <rect x="2.8" y="8.8"  width="6.4" height="6.4" rx="1.9" transform="rotate(45 6 12)"/>
      <circle cx="12" cy="12" r="1.25"/>
    </svg>
  ),
};

const kpiIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="20" x2="12" y2="10" />
    <line x1="18" y1="20" x2="18" y2="4" />
    <line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);

const navLinks = [
  { href: '/',                 label: 'Home',      icon: icons.home      },
  { href: '/people',           label: 'People',    icon: icons.people    },
  { href: '/ops',              label: 'Ops Hub',   icon: icons.ops       },
  { href: '/service-calendar', label: 'Service',   icon: icons.calendar  },
  // KPI is admin-gated at the server (OPS_LEADERSHIP_EMAILS) but visible
  // to everyone in the nav per the 2026-08-10 ruling; non-allowlisted
  // users get a Coming Soon screen.
  //
  // Overview Phase 4 (2026-08-31): KPI landing now goes to /kpi/overview,
  // the P&L Overview board. Labor and Purchasing remain reachable via
  // the section dropdown on any board. See KPI_MASTER_SCOPE.md §5.1
  // ("landing section pnl_overview") + §7 build phase 4 ("landing PR").
  { href: '/kpi/overview',     label: 'KPI',       icon: kpiIcon         },
  { href: '/playbook',         label: 'Playbook',  icon: icons.playbook  },
  // Train 3 A1: Chat's assumption - Sous sits between Playbook and Directory.
  // Kevin to strike or approve. Rationale: adjacent to Playbook because both
  // surface Playbook content; before Directory because the Directory jump is
  // a lookup destination, whereas Sous is a workflow tool the operator returns
  // to constantly.
  { href: '/sous',             label: 'Sous',      icon: icons.sous      },
  { href: '/directory',        label: 'Directory', icon: icons.directory },
];

// Bell inbox + its 60-second poll on /api/people?action=my-notifications
// were retired 2026-09-11 along with the notification_log Sheets tab
// that backed them. The measurement probe showed the PAF submitter's
// confirmation email did not start sending until t=3.7s under the
// sequential admin -> log -> submitter -> log pipeline; the Sheets
// append was the whole latency budget. Bell helpers (NIcon,
// NOTIF_ICONS, formatNotification, PAF_DESCRIPTIONS, humanize,
// timeAgo) all removed here. `getInitials` below is kept - it feeds
// the profile avatar.


function getInitials(email) {
  if (!email) return "?";
  const local = email.split("@")[0];
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export default function TopNav({ canViewSousReports = false, canUseSous = false }) {
  const pathname  = usePathname();
  const router    = useRouter();
  // Filter the /sous item out of the nav when the resolved visibility says
  // no. The layout resolves visibility server-side via canUseSous(email)
  // in src/lib/opdAcl.js and passes it in as a prop; TopNav never inspects
  // the session itself. Same single-gate pattern as canViewSousReports.
  const visibleNavLinks = canUseSous
    ? navLinks
    : navLinks.filter(({ href }) => href !== '/sous');
  const [email, setEmail]                     = useState("");
  const [firstName, setFirstName]             = useState("");
  const [userObj, setUserObj]                 = useState(null);
  const [profileOpen, setProfileOpen]         = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const profileRef = useRef(null);

  /* ── Bootstrap user ── */
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("kf_user_email") || "" : "";
    setEmail(stored);
    if (!stored) return;
    fetch(`/api/people?action=bootstrap&email=${encodeURIComponent(stored)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setFirstName(data.firstName || "");
          setUserObj({
            name:       data.firstName || stored.split("@")[0],
            role:       data.isAdmin ? "Administrator" : "Team Member",
            initials:   getInitials(stored),
            streak:     0,
            stadiumImg: data.heroImage || "",
          });
        }
      })
      .catch(() => {});
  }, []);

  /* ── Click outside to close profile menu ── */
  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Bell inbox state + effects + markRead/markAllRead handlers all
  // removed 2026-09-11 along with the notification_log Sheets tab.
  // The email itself is the notification; audit BCC + Slack + Vercel
  // logs cover the admin case.

  if (pathname === '/login') return null;

  const initials = getInitials(email);

  return (
    <>
      <nav className="kf-topnav">
        <div className="kf-topnav-inner">

          {/* ── Brand ── */}
          <Link href="/" className="kf-topnav-brand">
<img src="/PFS_PrimaryLogo_Navy_Circle.png" alt="KitchFix" className="kf-topnav-logo-img" />
            <span className="kf-topnav-wordmark">KitchFix</span>
          </Link>

          {/* ── Right: Links + Avatar (bell retired 2026-09-11) ── */}
          <div className="kf-topnav-right">
            <div className="kf-topnav-links">
              {visibleNavLinks.map(({ href, label, icon }) => {
                const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
                // Same-route Service click emits an EXPLICIT fresh-landing
                // intent via `?reset=1`. Distinguishes top-nav click from
                // the in-app `<- Season` button, which pushes the bare
                // `/service-calendar` path (the "show me the overview"
                // intent). Both URLs would otherwise be identical, so
                // P1 #379's unconditional clean-URL latch-clear bounced
                // floor+home users out of Season back into their period
                // on the Season click. ServiceCalendar's landing effect
                // reads the marker, clears the floor-redirect latch, then
                // router.replace-strips it - so the URL after the pass
                // is the same clean `/service-calendar` as before.
                // First-visit clicks from other routes keep the plain
                // href; mount landing already handles fresh sessions.
                const onClick = href === '/service-calendar' && pathname.startsWith('/service-calendar')
                  ? (e) => { e.preventDefault(); router.push('/service-calendar?reset=1'); }
                  : undefined;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onClick}
                    className={`kf-topnav-link ${isActive ? 'active' : ''}`}
                  >
                    {icon}
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="kf-topnav-separator" />


            {/* ── Avatar ── */}
            <div className="kf-topnav-profile-wrap" ref={profileRef}>
              <button
                className={`kf-topnav-avatar${profileOpen ? " kf-topnav-avatar--active" : ""}`}
                onClick={() => setProfileOpen(!profileOpen)}
                aria-label="Profile menu"
              >
                {initials}
              </button>

              {profileOpen && (
                <div className="kf-topnav-dropdown kf-topnav-dropdown--profile">
                  <div className="kf-topnav-pinfo">
                    <div className="kf-topnav-pinfo-avatar">{initials}</div>
                    <div>
                      <div className="kf-topnav-pinfo-name">{firstName || email.split("@")[0]}</div>
                      <div className="kf-topnav-pinfo-email">{email}</div>
                    </div>
                  </div>
                  <div className="kf-topnav-dropdown-divider" />
                  <div className="kf-topnav-pnav">
                    <button
                      className="kf-topnav-pnav-link"
                      onClick={() => { setProfileOpen(false); setProfileModalOpen(true); }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="7" r="4" /><path d="M5.5 21a8.38 8.38 0 0 1 13 0" /></svg>
                      View Profile
                    </button>
                    <Link href="/people" className="kf-topnav-pnav-link" onClick={() => setProfileOpen(false)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
                      People Portal
                    </Link>
<Link href="/" className="kf-topnav-pnav-link" onClick={() => setProfileOpen(false)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                      Home
                    </Link>
                    {canViewSousReports && (
                      <Link href="/sousai/reports" className="kf-topnav-pnav-link" onClick={() => setProfileOpen(false)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
                        Sous Reports
                      </Link>
                    )}
                  </div>
                  <div className="kf-topnav-dropdown-divider" />
                  <div className="kf-topnav-pnav">
                    <button
                      className="kf-topnav-pnav-link kf-topnav-pnav-link--signout"                      onClick={() => signOut({ callbackUrl: '/login' })}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Profile Modal */}
      <ProfileModal
        user={userObj}
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
      />
    </>
  );
}
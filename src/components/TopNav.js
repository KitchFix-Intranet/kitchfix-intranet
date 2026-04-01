'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
};

const navLinks = [
  { href: '/',            label: 'Dashboard', icon: icons.home      },
  { href: '/directory',   label: 'Directory', icon: icons.directory },
  { href: '/ops',         label: 'Ops Hub',   icon: icons.ops       },
  { href: '/service-calendar', label: 'Service Calendar', icon: icons.calendar },
  { href: '/people',      label: 'People',    icon: icons.people    },
];

/* ── Notification SVG Icons ── */
const NIcon = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);

const NOTIF_ICONS = {
  new_hire:             <NIcon><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></NIcon>,
  separation:           <NIcon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></NIcon>,
  rate_change:          <NIcon><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></NIcon>,
  title_change:         <NIcon><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></NIcon>,
  add_bonus:            <NIcon><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6" /><path d="M12 2v10" /><rect x="2" y="7" width="20" height="5" rx="1" /><path d="M12 7c-2-3-6-3-6 0" /><path d="M12 7c2-3 6-3 6 0" /></NIcon>,
  add_cell_phone:       <NIcon><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></NIcon>,
  travel_reimbursement: <NIcon><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.4-.1.9.3 1.1l5.6 3.2-3 3-1.5-.4c-.3-.1-.6 0-.8.2l-.2.3c-.2.3-.1.7.2.9l2.6 1.8 1.8 2.6c.2.3.6.4.9.2l.3-.2c.2-.2.3-.5.2-.8l-.4-1.5 3-3 3.2 5.6c.2.4.7.5 1.1.3l.5-.3c.4-.2.6-.6.5-1.1z" /></NIcon>,
  add_deduction:        <NIcon><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></NIcon>,
  add_gratuity:         <NIcon><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></NIcon>,
  reclassification:     <NIcon><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></NIcon>,
  status_change:        <NIcon><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></NIcon>,
  other_reimbursement:  <NIcon><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></NIcon>,
  help_request_hr:      <NIcon><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></NIcon>,
  status_update:        <NIcon><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></NIcon>,
fallback:             <NIcon><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></NIcon>,
  // Ops & Directory types
  inventory_submitted:  <NIcon><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></NIcon>,
  inventory_due_3d:     <NIcon><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></NIcon>,
  inventory_due_2d:     <NIcon><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></NIcon>,
  inventory_due_1d:     <NIcon><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></NIcon>,
  inventory_due_today:  <NIcon><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></NIcon>,
  inventory_past_due:   <NIcon><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></NIcon>,
  period_start:         <NIcon><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></NIcon>,
  directory_update:     <NIcon><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></NIcon>,
  news_posted:          <NIcon><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" /><line x1="10" y1="8" x2="18" y2="8" /><line x1="10" y1="12" x2="18" y2="12" /></NIcon>,
  birthday:             <NIcon><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></NIcon>,
  anniversary:          <NIcon><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></NIcon>,
};

function formatNotification(n) {
  const icon    = NOTIF_ICONS[n.eventType] || NOTIF_ICONS.fallback;
  const subject = n.subject || "";
  let title = "", detail = "", tag = "", tagColor = "", desc = "";
  let href = "/people";
  let ctaLabel = "View in Action Center";

  if (subject.startsWith("[APPROVED]")) {
    tag = "Approved"; tagColor = "#16a34a";
    const rest = subject.replace("[APPROVED]", "").trim();
    const [rawAction, name] = rest.split(" - ").map((s) => s.trim());
    title  = `${humanize(rawAction)} approved`;
    detail = name || n.related;
    desc   = "This request has been completed. No further action needed.";
  } else if (subject.startsWith("[ACTION REQUIRED]")) {
    tag = "Action Required"; tagColor = "#dc2626";
    const rest = subject.replace("[ACTION REQUIRED]", "").trim();
    const [rawAction, name] = rest.split(" - ").map((s) => s.trim());
    title  = `${humanize(rawAction)} needs review`;
    detail = name || n.related;
    desc   = "A submission is waiting for admin review.";
    ctaLabel = "Open Admin Queue";
  } else if (subject.startsWith("[RESUBMITTED]")) {
    tag = "Resubmitted"; tagColor = "#d97706";
    const rest  = subject.replace("[RESUBMITTED]", "").trim();
    const parts = rest.split(" - ");
    title  = `${humanize(parts[0])} resubmitted`;
    detail = parts.slice(1).join(" · ");
    desc   = "A previously rejected request has been updated and resubmitted.";
    ctaLabel = "Open Admin Queue";
  } else if (subject.startsWith("[NEW HIRE]")) {
    tag = "New Hire"; tagColor = "#2563eb";
    const rest  = subject.replace("[NEW HIRE]", "").trim();
    const parts = rest.split(" - ");
    title  = parts[0] || "New hire submitted";
    detail = parts.slice(1).join(" · ");
    desc   = "Onboarding request submitted and pending processing.";
  } else if (subject.startsWith("[PAF]")) {
    const rest = subject.replace("[PAF]", "").trim();
    const [rawAction, ...nameParts] = rest.split(" - ");
    title  = humanize(rawAction);
    detail = nameParts.join(" - ");
    desc   = PAF_DESCRIPTIONS[n.eventType] || "Personnel action submitted and pending review.";
  } else if (subject.startsWith("[HELP]")) {
    tag = "Help"; tagColor = "#7c3aed";
    title  = "Help request submitted";
    detail = n.related;
    desc   = "Your message has been sent to the HR team.";
} else if (subject.startsWith("[OPS]")) {
    const rest = subject.replace("[OPS]", "").trim();
    if (n.eventType === "inventory_submitted") {
      tag = "Submitted"; tagColor = "#16a34a";
      title = "Inventory submitted";
      detail = rest.replace("Inventory submitted —", "").trim();
      desc = "Your inventory count has been recorded.";
      href = "/ops";
      ctaLabel = "View Ops Hub";
    } else if (n.eventType?.startsWith("inventory_due")) {
      tag = "Reminder"; tagColor = "#d97706";
      title = rest;
      desc = "Make sure your inventory count is ready.";
      href = "/ops";
      ctaLabel = "Open Ops Hub";
    } else if (n.eventType === "inventory_past_due") {
      tag = "Past Due"; tagColor = "#dc2626";
      title = rest;
      desc = "Your inventory submission is overdue.";
      href = "/ops";
      ctaLabel = "Submit Now";
    } else if (n.eventType === "period_start") {
      tag = "New Period"; tagColor = "#2563eb";
      title = rest;
      desc = "A new accounting period has started.";
      href = "/ops";
      ctaLabel = "View Ops Hub";
    } else {
      title = rest;
      href = "/ops";
      ctaLabel = "View Ops Hub";
    }
  } else if (subject.startsWith("[DIRECTORY]")) {
    tag = "Directory"; tagColor = "#0d9488";
    title = subject.replace("[DIRECTORY]", "").trim();
    desc = "The team directory has been updated.";
    href = "/directory";
    ctaLabel = "View Directory";
  } else if (subject.startsWith("[NEWS]")) {
    tag = "News"; tagColor = "#2563eb";
    title = subject.replace("[NEWS]", "").trim();
    desc = "A new KitchFix news item has been posted.";
    href = "/";
    ctaLabel = "Read on Dashboard";
  } else if (subject.startsWith("[CELEBRATION]")) {
    tag = "Celebration"; tagColor = "#d97706";
    title = subject.replace("[CELEBRATION]", "").trim();
    desc = "Let\u2019s celebrate our team!";
    href = "/";
    ctaLabel = "View Dashboard";
  } else {
    title    = subject;
    detail   = n.related;
    ctaLabel = "View Details";
  }

  return { icon, title, detail, tag, tagColor, desc, href, ctaLabel };
}

const PAF_DESCRIPTIONS = {
  separation:           "Employee offboarding initiated.",
  rate_change:          "Compensation adjustment submitted for approval.",
  title_change:         "Role title update submitted for approval.",
  add_bonus:            "Bonus payment submitted for processing.",
  add_cell_phone:       "Cell phone reimbursement request submitted.",
  travel_reimbursement: "Travel per diem reimbursement submitted.",
  add_deduction:        "Payroll deduction submitted for processing.",
  add_gratuity:         "Gratuity payment submitted for processing.",
  reclassification:     "Employment reclassification submitted.",
  status_change:        "Employment status change submitted.",
  other_reimbursement:  "Reimbursement submitted for processing.",
};

function humanize(str) {
  if (!str) return "";
  return str.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getInitials(email) {
  if (!email) return "?";
  const local = email.split("@")[0];
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export default function TopNav() {
  const pathname  = usePathname();
  const router    = useRouter();
  const [email, setEmail]                     = useState("");
  const [firstName, setFirstName]             = useState("");
  const [userObj, setUserObj]                 = useState(null);
  const [notifications, setNotifications]     = useState([]);
  const [unreadCount, setUnreadCount]         = useState(0);
  const [bellOpen, setBellOpen]               = useState(false);
  const [profileOpen, setProfileOpen]         = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const bellRef    = useRef(null);
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

  /* ── Notifications ── */
  const fetchNotifications = useCallback(() => {
    if (!email) return;
    fetch(`/api/people?action=my-notifications&email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setNotifications(data.notifications || []);
          setUnreadCount(data.unreadCount || 0);
        }
      })
      .catch(() => {});
  }, [email]);

  useEffect(() => {
    if (!email) return;
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [email, fetchNotifications]);

  /* ── Click outside to close dropdowns ── */
  useEffect(() => {
    const handler = (e) => {
      if (bellRef.current    && !bellRef.current.contains(e.target))    setBellOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markRead = (id) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
    fetch("/api/people", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "mark-notification-read", notificationId: id }),
    }).catch(() => {});
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    fetch("/api/people", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "mark-all-read", email }),
    }).catch(() => {});
  };

  if (pathname === '/login') return null;

  const initials = getInitials(email);

  const DAY  = 86400000;
  const now  = Date.now();
  const visibleUnread = notifications.filter((n) => {
    if (n.read) return false;
    return (now - new Date(n.timestamp).getTime()) < 14 * DAY;
  }).length;

  /* ── Render single notification ── */
  const renderNotifItem = (n) => {
    const fmt = formatNotification(n);
    return (
      <button
        key={n.id}
        className={`kf-topnav-notif-item${!n.read ? " kf-topnav-notif-item--unread" : ""}`}
        onClick={() => {
          if (!n.read) markRead(n.id);
          setBellOpen(false);
          router.push(fmt.href);
        }}
      >
        <span className="kf-topnav-notif-icon">{fmt.icon}</span>
        <div className="kf-topnav-notif-content">
          {fmt.tag && (
            <span className="kf-topnav-notif-tag" style={{ color: fmt.tagColor }}>{fmt.tag}</span>
          )}
          <div className="kf-topnav-notif-subject">{fmt.title}</div>
          {fmt.desc && <div className="kf-topnav-notif-desc">{fmt.desc}</div>}
          <div className="kf-topnav-notif-meta">
            {fmt.detail && <span>{fmt.detail}</span>}
            <span>{timeAgo(n.timestamp)}</span>
          </div>
          <span className="kf-topnav-notif-cta">
            {fmt.ctaLabel}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
            </svg>
          </span>
        </div>
        {!n.read && <span className="kf-topnav-notif-dot" />}
      </button>
    );
  };

  return (
    <>
      <nav className="kf-topnav">
        <div className="kf-topnav-inner">

          {/* ── Brand ── */}
          <Link href="/" className="kf-topnav-brand">
<img src="/PFS_PrimaryLogo_Navy_Circle.png" alt="KitchFix" className="kf-topnav-logo-img" />
            <span className="kf-topnav-wordmark">KitchFix</span>
          </Link>

          {/* ── Right: Links + Bell + Avatar ── */}
          <div className="kf-topnav-right">
            <div className="kf-topnav-links">
              {navLinks.map(({ href, label, icon }) => {
                const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`kf-topnav-link ${isActive ? 'active' : ''}`}
                  >
                    {icon}
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="kf-topnav-separator" />

            {/* ── Bell ── */}
            <div className="kf-topnav-bell-wrap" ref={bellRef}>
              <button
                className={`kf-topnav-icon-btn${bellOpen ? " kf-topnav-icon-btn--active" : ""}`}
                onClick={() => { setBellOpen(!bellOpen); setProfileOpen(false); }}
                aria-label="Notifications"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                {visibleUnread > 0 && (
                  <span className="kf-topnav-badge">{visibleUnread > 9 ? "9+" : visibleUnread}</span>
                )}
              </button>

              {bellOpen && (
                <div className="kf-topnav-dropdown kf-topnav-dropdown--notif">
                  <div className="kf-topnav-dropdown-header">
                    <span className="kf-topnav-dropdown-title">Notifications</span>
                    {visibleUnread > 0 && (
                      <button className="kf-topnav-dropdown-action" onClick={markAllRead}>
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div className="kf-topnav-notif-list">
                    {notifications.length === 0 ? (
                      <div className="kf-topnav-notif-empty">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                        </svg>
                        <span>No notifications yet</span>
                      </div>
                    ) : (
                      (() => {
                        const visible = notifications.filter((n) => {
                          const age = now - new Date(n.timestamp).getTime();
                          return n.read ? age < 7 * DAY : age < 14 * DAY;
                        });

                        const ACTION_SUBJECTS = ["[ACTION REQUIRED]", "[RESUBMITTED]"];
                        const pinned    = visible.filter((n) => !n.read && ACTION_SUBJECTS.some((p) => (n.subject || "").startsWith(p)));
                        const pinnedIds = new Set(pinned.map((n) => n.id));
                        const newItems  = visible.filter((n) => !n.read && !pinnedIds.has(n.id));
                        const earlier   = visible.filter((n) => n.read);

                        if (visible.length === 0) {
                          return (
                            <div className="kf-topnav-notif-empty">
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                              </svg>
                              <span>All caught up</span>
                            </div>
                          );
                        }

                        return (
                          <>
                            {pinned.length > 0 && (
                              <>
                                <div className="kf-topnav-notif-section kf-topnav-notif-section--pinned">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8"  x2="12" y2="12"   />
                                    <line x1="12" y1="16" x2="12.01" y2="16" />
                                  </svg>
                                  Needs Attention
                                </div>
                                {pinned.map((n) => renderNotifItem(n))}
                              </>
                            )}
                            {newItems.length > 0 && (
                              <>
                                <div className="kf-topnav-notif-section">New</div>
                                {newItems.map((n) => renderNotifItem(n))}
                              </>
                            )}
                            {earlier.length > 0 && (
                              <>
                                <div className="kf-topnav-notif-section">Earlier</div>
                                {earlier.map((n) => renderNotifItem(n))}
                              </>
                            )}
                          </>
                        );
                      })()
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Avatar ── */}
            <div className="kf-topnav-profile-wrap" ref={profileRef}>
              <button
                className={`kf-topnav-avatar${profileOpen ? " kf-topnav-avatar--active" : ""}`}
                onClick={() => { setProfileOpen(!profileOpen); setBellOpen(false); }}
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
                      Dashboard
                    </Link>
                    {email === "k.fietek@kitchfix.com" && (
                      <Link href="/analytics" className="kf-topnav-pnav-link" onClick={() => setProfileOpen(false)}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-6"/></svg>
                        Analytics
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
"use client";
// ─────────────────────────────────────────────────────────────
// Standalone /directory page - retirement notice.
//
// The Team Directory now lives in the People Portal (/people -> Directory
// tab). This page used to render the team grid + admin drawer; it has
// been replaced with a centered "moved" notice. The route stays live
// so existing links (nav items, bookmarks) resolve to a clear
// in-app signpost instead of a dead URL. Full teardown of this file
// plus sibling components (TeamGrid.js, DirectoryAdmin.js, directory.css)
// is a later PR; keeping them on disk preserves the admin content tabs
// as a reference until the Accounts/Contacts/Hero porting question is
// resolved.
//
// Auth path is unchanged: middleware still gates the route; this is a
// client component rendering a static notice.
// ─────────────────────────────────────────────────────────────

import Link from "next/link";
import "./directory.css";

function MovedIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export default function DirectoryMovedPage() {
  return (
    <div className="td-moved-wrap">
      <div className="td-moved-card">
        <div className="td-moved-icon"><MovedIcon /></div>
        <h1 className="td-moved-title">Directory has moved</h1>
        <p className="td-moved-body">The Team Directory is now part of the People Portal.</p>
        <Link href="/people?tab=directory" className="td-moved-btn">
          <span>Open the Directory</span>
          <ArrowIcon />
        </Link>
      </div>
    </div>
  );
}

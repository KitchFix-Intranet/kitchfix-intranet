"use client";
import { useState, useEffect, useCallback, useRef } from "react";

const FILTERS = [
  { label: "All",     tag: "all" },
  { label: "Ops",     tag: "ops" },
  { label: "HR",      tag: "people" },
  { label: "Safety",  tag: "safety" },
  { label: "Kudos",   tag: "kudos" },
  { label: "Kitchen", tag: "culinary" },
  { label: "General", tag: "general" },
  { label: "saved",   tag: "saved" },
];

// ── Category-specific empty states ──
const EMPTY_MSGS = {
  all:      { icon: "📬", msg: "No news right now - check back soon" },
  ops:      { icon: "📋", msg: "All caught up on ops updates" },
  people:   { icon: "👥", msg: "No people updates this week" },
  safety:   { icon: "✅", msg: "No safety alerts right now - that's a good thing" },
  kudos:    { icon: "🌟", msg: "No kudos this week - time to recognize someone?" },
  culinary: { icon: "🍳", msg: "No culinary updates right now" },
  general:  { icon: "📰", msg: "No general announcements lately" },
  saved:    { icon: "🔖", msg: "No saved posts yet - bookmark items to find them here" },
};

// ── Helpers ──
function daysAgo(dateStr) {
  if (!dateStr) return 999;
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.floor((now - d) / 86400000);
}

function formatDate(dateStr) {
  const days = daysAgo(dateStr);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeClass(days) {
  if (days <= 2) return "";
  if (days >= 10) return "kf-news-time--aging";
  return "";
}

function archiveNote(days, expiresDate) {
  if (!expiresDate) return "";
  const expDays = daysAgo(expiresDate);
  // expDays is negative when expires is in the future
  if (expDays >= -3 && expDays < 0) return " · archiving soon";
  return "";
}

function countdownInfo(countdownDate) {
  if (!countdownDate) return null;
  const target = new Date(countdownDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diff = Math.ceil((target - now) / 86400000);
  if (diff < 0) return { label: "Past due", level: "red" };
  if (diff === 0) return { label: "Due today", level: "red" };
  if (diff <= 2) return { label: `Due in ${diff}d`, level: "red" };
  if (diff <= 5) return { label: `Due in ${diff}d`, level: "amber" };
  return { label: `Due in ${diff}d`, level: "green" };
}

// ── SVG Icons ──
const DocIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const PinIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M12 2L2 7l10 5 10-5-10-5z" />
    <path d="M2 17l10 5 10-5" />
    <path d="M2 12l10 5 10-5" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const BookmarkIcon = ({ filled }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" strokeWidth="1.8"
    stroke={filled ? "#d97706" : "currentColor"} fill={filled ? "#d97706" : "none"}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const LinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);


export default function NewsFeed({ session, refreshKey }) {
  const [posts, setPosts] = useState([]);
  const [interactions, setInteractions] = useState({});   // keyed by postId
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [sweeping, setSweeping] = useState(false);
  const listRef = useRef(null);
  const localEditsRef = useRef({});  // tracks recent optimistic edits by postId

  const userEmail = session?.user?.email || "";

  // ── Fetch news (initial + silent refresh) ──
  const loadNews = useCallback(async (silent = false) => {
    try {
      const res = await fetch("/api/dashboard?action=news-bootstrap");
      if (!res.ok) throw new Error("Failed to load news");
      const data = await res.json();
      setPosts(data.posts || []);

      // Build server interactions map
      const serverIx = {};
      (data.interactions || []).forEach((ix) => {
        serverIx[ix.postId] = ix;
      });

      if (silent) {
        // Merge: local optimistic edits win over server for recent changes
        setInteractions((prev) => {
          const merged = { ...serverIx };
          const now = Date.now();
          const edits = localEditsRef.current;
          for (const pid of Object.keys(edits)) {
            // Local edits within the last 30s take priority
            if (now - edits[pid].ts < 30000) {
              merged[pid] = { ...(serverIx[pid] || {}), ...prev[pid] };
            }
          }
          // Clean up stale edit timestamps
          for (const pid of Object.keys(edits)) {
            if (now - edits[pid].ts >= 30000) delete edits[pid];
          }
          return merged;
        });
      } else {
        setInteractions(serverIx);
      }
    } catch (err) {
      console.error("NewsFeed load error:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { loadNews(false); }, [loadNews]);

  // Silent refresh — triggered by parent via refreshKey prop
  useEffect(() => {
    if (refreshKey > 0) {
      loadNews(true);
    }
  }, [refreshKey, loadNews]);

  // ── API helpers (fire-and-forget, optimistic UI) ──
  const postAction = async (action, body) => {
    try {
      await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
    } catch (err) {
      console.error(`NewsFeed ${action} error:`, err);
    }
  };

  // ── Interactions ──
  const getIx = (postId) => interactions[postId] || { postId, read: false, saved: false, acknowledged: false };

  const updateIx = (postId, changes) => {
    localEditsRef.current[postId] = { ts: Date.now() };
    setInteractions((prev) => ({
      ...prev,
      [postId]: { ...getIx(postId), ...changes },
    }));
  };

  // ── Toggle expand (also marks read) ──
  const toggleExpand = (postId) => {
    if (expandedId === postId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(postId);
    const ix = getIx(postId);
    if (!ix.read) {
      updateIx(postId, { read: true, readAt: new Date().toISOString() });
      postAction("news-read", { postId });
    }
  };

  // ── Mark all read ──
  const markAllRead = () => {
    setSweeping(true);
    const unreadIds = posts.filter((p) => !getIx(p.postId).read).map((p) => p.postId);
    // Stagger visual, then commit
    setTimeout(() => {
      const now = new Date().toISOString();
      const updates = {};
      unreadIds.forEach((id) => {
        updates[id] = { ...getIx(id), read: true, readAt: now };
      });
      setInteractions((prev) => ({ ...prev, ...updates }));
      setSweeping(false);
      postAction("news-mark-all-read", { postIds: unreadIds });
    }, unreadIds.length * 60 + 300);
  };

  // ── Bookmark ──
  const toggleSave = (e, postId) => {
    e.stopPropagation();
    const ix = getIx(postId);
    updateIx(postId, { saved: !ix.saved });
    postAction("news-save", { postId, saved: !ix.saved });
  };

  // ── Acknowledge pinned ──
  const toggleAck = (postId) => {
    const ix = getIx(postId);
    updateIx(postId, { acknowledged: !ix.acknowledged, read: true });
    postAction("news-ack", { postId, acknowledged: !ix.acknowledged });
  };

  // ── Derived data ──
  const now = new Date();
  const activePosts = posts.filter((p) => p.active === "TRUE" || p.active === true);
  const filtered = activePosts.filter((p) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "saved") return getIx(p.postId).saved;
    return p.tag.toLowerCase() === activeFilter;
  });

  // In "Saved" view, don't show pinned banner separately
  const pinnedPost = activeFilter === "saved"
    ? null
    : filtered.find((p) => p.pinned === "TRUE" || p.pinned === true);
  const listPosts = activeFilter === "saved"
    ? filtered
    : filtered.filter((p) => p.pinned !== "TRUE" && p.pinned !== true);

  const savedCount = activePosts.filter((p) => getIx(p.postId).saved).length;
  const unreadCount = activePosts.filter((p) => !getIx(p.postId).read).length;
  const weekPosts = activePosts.filter((p) => daysAgo(p.publishDate) <= 7);
  const weekUnread = weekPosts.filter((p) => !getIx(p.postId).read).length;

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="kf-news-wrap">
        <div className="kf-news-header">
          <span className="kf-news-htitle"><DocIcon /> KITCHFIX NEWS</span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="kf-news-skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div className="kf-news-wrap">
      {/* ── Weekly digest ── */}
      <div className="kf-news-digest">
        <span className="kf-news-digest-stat">{weekPosts.length} posts this week</span>
        <span className="kf-news-digest-dot" />
        <span>
          {weekUnread > 0
            ? <strong style={{ color: "var(--text-primary, #1a1a1a)" }}>{weekUnread} unread</strong>
            : "All caught up"}
        </span>
      </div>

      {/* ── Header ── */}
      <div className="kf-news-header">
        <span className="kf-news-htitle">
          <DocIcon /> KITCHFIX NEWS
        </span>
        <div className="kf-news-hright">
          {unreadCount > 0 && (
            <button className="kf-news-mark-all" onClick={markAllRead}>
              Mark all read
            </button>
          )}
          {unreadCount > 0 && (
            <span className="kf-news-badge">{unreadCount} new</span>
          )}
        </div>
      </div>

      {/* ── Filter pills ── */}
      <div className="kf-news-filters">
        {FILTERS.map((f) => (
          <button
            key={f.tag}
            className={`kf-news-pill${activeFilter === f.tag ? " kf-news-pill--on" : ""}${f.tag === "saved" ? ` kf-news-pill--saved${savedCount > 0 ? " kf-news-pill--has-saved" : ""}` : ""}`}
            onClick={() => setActiveFilter(f.tag)}
          >
            {f.tag === "saved" ? (
              <>
                <BookmarkIcon filled={activeFilter === "saved" || savedCount > 0} />
                {savedCount > 0 ? savedCount : ""}
              </>
            ) : f.label}
          </button>
        ))}
      </div>

      {/* ── Pinned post ── */}
      {pinnedPost && (() => {
        const isAcked = getIx(pinnedPost.postId).acknowledged;
        return isAcked ? (
          /* Compact acknowledged state */
          <div className="kf-news-pinned kf-news-pinned--acked">
            <div className="kf-news-pin-acked-row">
              <div className="kf-news-pin-acked-left">
                <CheckIcon />
                <span className="kf-news-pin-acked-title">{pinnedPost.title}</span>
              </div>
              <button
                className="kf-news-ack kf-news-ack--undo"
                onClick={() => toggleAck(pinnedPost.postId)}
              >
                Undo
              </button>
            </div>
          </div>
        ) : (
          /* Full unacknowledged state */
          <div className="kf-news-pinned">
            <div className="kf-news-pin-label">
              <PinIcon /> PINNED
            </div>
            <h3 className="kf-news-pin-title">{pinnedPost.title}</h3>
            <p className="kf-news-pin-body">{pinnedPost.body}</p>
            <div className="kf-news-pin-meta">
              <span className="kf-news-pin-author">
                {pinnedPost.author} · {formatDate(pinnedPost.publishDate)}
              </span>
              <button
                className="kf-news-ack"
                onClick={() => toggleAck(pinnedPost.postId)}
              >
                <CheckIcon />
                Got it
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Post list ── */}
      <div className="kf-news-list" ref={listRef}>
        {listPosts.length === 0 && !pinnedPost && (
          <div className="kf-news-empty">
            <div className="kf-news-empty-icon">
              {EMPTY_MSGS[activeFilter]?.icon || "📬"}
            </div>
            {EMPTY_MSGS[activeFilter]?.msg || "Nothing here yet"}
          </div>
        )}

        {listPosts.map((post, idx) => {
          const ix = getIx(post.postId);
          const isRead = ix.read;
          const isExpanded = expandedId === post.postId;
          const days = daysAgo(post.publishDate);
          const isNew = days <= 2 && !isRead;
          const cd = countdownInfo(post.countdownDate);

          return (
            <div key={post.postId}>
              {idx > 0 && <div className="kf-news-divider" />}
              <div
                className={`kf-news-item${sweeping && !isRead ? " kf-news-item--sweeping" : ""}`}
                style={{ animationDelay: `${idx * 80}ms` }}
                onClick={() => toggleExpand(post.postId)}
              >
                {/* Unread dot */}
                <div className={`kf-news-dot${isRead ? " kf-news-dot--off" : ""}`} />

                <div className="kf-news-body">
                  {/* Tag row */}
                  <div className="kf-news-top">
                    <span className={`kf-news-tag kf-news-tag--${post.tag}`}>
                      {post.tag.toUpperCase()}
                    </span>
                    {isNew && <span className="kf-news-new">NEW</span>}
                  </div>

                  {/* Title + bookmark */}
                  <div className="kf-news-title-row">
                    <div className={`kf-news-ititle${isRead ? " kf-news-ititle--read" : ""}`}>
                      {post.title}
                    </div>
                    <button
                      className={`kf-news-bkmk${ix.saved ? " kf-news-bkmk--saved" : ""}`}
                      onClick={(e) => toggleSave(e, post.postId)}
                      title={ix.saved ? "Unsave" : "Save"}
                    >
                      <BookmarkIcon filled={ix.saved} />
                    </button>
                  </div>

                  {/* Preview / expanded body */}
                  <div className={`kf-news-preview${isExpanded ? " kf-news-preview--open" : ""}${isRead ? " kf-news-preview--read" : ""}`}>
                    {post.body}
                  </div>

                  {/* Countdown chip */}
                  {cd && (
                    <div className={`kf-news-countdown kf-news-cd--${cd.level}`}>
                      ⏱️ {cd.label}
                    </div>
                  )}

                  {/* Link */}
                  {isExpanded && post.link && (
                    <a
                      href={post.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="kf-news-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <LinkIcon /> Open Link
                    </a>
                  )}

                  {/* Footer */}
                  <div className="kf-news-footer">
                    <span className="kf-news-author">{post.author}</span>
                    <span>·</span>
                    <span className={`kf-news-time ${timeClass(days)}`}>
                      {formatDate(post.publishDate)}
                      {archiveNote(days, post.expiresDate)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
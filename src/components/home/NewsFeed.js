"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { OPS_LEADERSHIP_EMAILS } from "@/lib/admin";
import NewsAdmin from "@/components/home/NewsAdmin";

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

function getLinkLabel(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "");
    if (host.includes("meet.google")) return "Join Google Meet";
    if (host.includes("zoom.us")) return "Join Zoom";
    if (host.includes("docs.google")) return "Open Document";
    if (host.includes("drive.google")) return "Open in Drive";
    if (host.includes("sheets.google")) return "Open Spreadsheet";
    if (host.includes("slides.google")) return "Open Slides";
    if (host.includes("youtube") || host.includes("youtu.be")) return "Watch Video";
    if (host.includes("slack.com")) return "Open in Slack";
    return "Open Link";
  } catch { return "Open Link"; }
}

// ── Icons ──
const BookmarkIcon = ({ filled }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" strokeWidth="1.8"
    stroke={filled ? "#d97706" : "currentColor"} fill={filled ? "#d97706" : "none"}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
);
const ExternalLinkIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
);

export default function NewsFeed({ session, refreshKey }) {
  const [posts, setPosts] = useState([]);
  const [interactions, setInteractions] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [showAdmin, setShowAdmin] = useState(false);
  const [readingPost, setReadingPost] = useState(null);
  const localEditsRef = useRef({});

  const userEmail = session?.user?.email || "";
  const isNewsAdmin = OPS_LEADERSHIP_EMAILS.includes(userEmail);

  // ── Fetch news (initial + silent refresh) ──
  const loadNews = useCallback(async (silent = false) => {
    try {
      const res = await fetch("/api/dashboard?action=news-bootstrap");
      if (!res.ok) throw new Error("Failed to load news");
      const data = await res.json();
      setPosts(data.posts || []);

      const serverIx = {};
      (data.interactions || []).forEach((ix) => { serverIx[ix.postId] = ix; });

      if (silent) {
        setInteractions((prev) => {
          const merged = { ...serverIx };
          const now = Date.now();
          const edits = localEditsRef.current;
          for (const pid of Object.keys(edits)) {
            if (now - edits[pid].ts < 30000) {
              merged[pid] = { ...(serverIx[pid] || {}), ...prev[pid] };
            }
          }
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

  useEffect(() => { loadNews(false); }, [loadNews]);
  useEffect(() => { if (refreshKey > 0) loadNews(true); }, [refreshKey, loadNews]);

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

  const getIx = useCallback(
    (postId) => interactions[postId] || { postId, read: false, saved: false, acknowledged: false },
    [interactions]
  );

  const updateIx = useCallback((postId, changes) => {
    localEditsRef.current[postId] = { ts: Date.now() };
    setInteractions((prev) => ({
      ...prev,
      [postId]: { ...(prev[postId] || { postId, read: false, saved: false, acknowledged: false }), ...changes },
    }));
  }, []);

  const markRead = useCallback((postId) => {
    updateIx(postId, { read: true, readAt: new Date().toISOString() });
    postAction("news-read", { postId });
  }, [updateIx]);

  const markAllRead = () => {
    const unreadIds = posts.filter((p) => !getIx(p.postId).read).map((p) => p.postId);
    if (unreadIds.length === 0) return;
    const now = new Date().toISOString();
    setInteractions((prev) => {
      const next = { ...prev };
      unreadIds.forEach((id) => {
        next[id] = { ...(prev[id] || { postId: id, read: false, saved: false, acknowledged: false }), read: true, readAt: now };
        localEditsRef.current[id] = { ts: Date.now() };
      });
      return next;
    });
    postAction("news-mark-all-read", { postIds: unreadIds });
  };

  const toggleSave = (e, postId) => {
    e.stopPropagation();
    const ix = getIx(postId);
    updateIx(postId, { saved: !ix.saved });
    postAction("news-save", { postId, saved: !ix.saved });
  };

  // ── Reader overlay ──
  const openReader = (post) => setReadingPost(post);

  const closeReader = useCallback(() => {
    if (readingPost && !getIx(readingPost.postId).read) {
      markRead(readingPost.postId);
    }
    setReadingPost(null);
  }, [readingPost, getIx, markRead]);

  // Escape key + body scroll lock while reader open
  useEffect(() => {
    if (!readingPost) return;
    const handler = (e) => { if (e.key === "Escape") closeReader(); };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [readingPost, closeReader]);

  // ── Derived data ──
  const activePosts = posts.filter((p) => p.active === "TRUE" || p.active === true);

  const filtered = activePosts.filter((p) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "saved") return getIx(p.postId).saved;
    return String(p.tag || "").toLowerCase() === activeFilter;
  });

  // Pinned first (pinned posts now render inline with a Pinned badge,
  // not as a separate banner). Within pinned/unpinned groups, the
  // server already sorts by publishDate DESC.
  const listPosts = [...filtered].sort((a, b) => {
    const aPin = a.pinned === "TRUE" || a.pinned === true;
    const bPin = b.pinned === "TRUE" || b.pinned === true;
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return 1;
    return 0;
  });

  const savedCount = activePosts.filter((p) => getIx(p.postId).saved).length;
  const unreadCount = activePosts.filter((p) => !getIx(p.postId).read).length;

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="nf-feed">
        <div className="nf-header">
          <div className="nf-header-left">
            <span className="nf-header-title">KitchFix News</span>
          </div>
        </div>
        {[1, 2, 3].map((i) => <div key={i} className="nf-skeleton" />)}
      </div>
    );
  }

  return (
    <div className="nf-feed">
      {/* Header */}
      <div className="nf-header">
        <div className="nf-header-left">
          <span className="nf-header-title">KitchFix News</span>
          {unreadCount > 0 && <span className="nf-header-badge">{unreadCount} new</span>}
        </div>
        <div className="nf-header-right">
          {isNewsAdmin && (
            <button className="nf-manage-btn" onClick={() => setShowAdmin(true)} title="Manage news posts">
              <SettingsIcon /> Manage
            </button>
          )}
          {unreadCount > 0 && (
            <button className="nf-mark-all" onClick={markAllRead}>Mark all read</button>
          )}
        </div>
      </div>

      {/* Filter pills */}
      <div className="nf-pills">
        {FILTERS.map((f) => (
          <button
            key={f.tag}
            className={`nf-pill${activeFilter === f.tag ? " nf-pill--active" : ""}`}
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

      {/* Card list */}
      <div className="nf-list">
        {listPosts.length === 0 ? (
          <div className="nf-empty">
            <div className="nf-empty-icon">{EMPTY_MSGS[activeFilter]?.icon || "📬"}</div>
            {EMPTY_MSGS[activeFilter]?.msg || "Nothing here yet"}
          </div>
        ) : (
          listPosts.map((post) => {
            const ix = getIx(post.postId);
            const isRead = ix.read;
            const days = daysAgo(post.publishDate);
            const isNew = days <= 2 && !isRead;
            const cd = countdownInfo(post.countdownDate);
            const isPinned = post.pinned === "TRUE" || post.pinned === true;
            const tag = String(post.tag || "general").toLowerCase();

            return (
              <article
                key={post.postId}
                className={`nf-card${isRead ? " nf-card--read" : " nf-card--unread"}`}
                onClick={() => openReader(post)}
              >
                {post.imageUrl && (
                  <img src={post.imageUrl} alt="" className="nf-card-img" loading="lazy" />
                )}
                <div className="nf-card-body">
                  <div className="nf-card-top">
                    <span className={`nf-card-tag nf-card-tag--${tag}`}>{tag}</span>
                    {isPinned && <span className="nf-card-badge-pinned">Pinned</span>}
                    {isNew && <span className="nf-card-new">New</span>}
                    {cd && (
                      <span className={`nf-card-countdown nf-card-countdown--${cd.level}`}>
                        ⏱ {cd.label}
                      </span>
                    )}
                  </div>

                  <h3 className="nf-card-title">{post.title}</h3>
                  <p className="nf-card-excerpt">{post.body}</p>

                  <div className="nf-card-footer">
                    <span className="nf-card-author">{post.author}</span>
                    <span>·</span>
                    <span>{formatDate(post.publishDate)}</span>
                    <button
                      className={`nf-card-bookmark${ix.saved ? " nf-card-bookmark--saved" : ""}`}
                      onClick={(e) => toggleSave(e, post.postId)}
                      title={ix.saved ? "Unsave" : "Save"}
                      aria-label={ix.saved ? "Remove bookmark" : "Bookmark"}
                    >
                      <BookmarkIcon filled={ix.saved} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Reading overlay */}
      {readingPost && (() => {
        const ix = getIx(readingPost.postId);
        const tag = String(readingPost.tag || "general").toLowerCase();
        const cd = countdownInfo(readingPost.countdownDate);
        const isPinned = readingPost.pinned === "TRUE" || readingPost.pinned === true;
        return (
          <div className="nf-overlay" onClick={closeReader}>
            <div
              className="nf-reader"
              role="dialog"
              aria-modal="true"
              aria-labelledby="nf-reader-title"
              onClick={(e) => e.stopPropagation()}
            >
              {readingPost.imageUrl && (
                <img className="nf-reader-hero" src={readingPost.imageUrl} alt="" />
              )}
              <div className="nf-reader-body">
                <div className="nf-reader-top">
                  <span className={`nf-card-tag nf-card-tag--${tag}`}>{tag}</span>
                  {isPinned && <span className="nf-card-badge-pinned">Pinned</span>}
                  {cd && (
                    <span className={`nf-card-countdown nf-card-countdown--${cd.level}`}>
                      ⏱ {cd.label}
                    </span>
                  )}
                </div>
                <h2 id="nf-reader-title" className="nf-reader-title">{readingPost.title}</h2>
                <div className="nf-reader-meta">
                  {readingPost.author} · {formatDate(readingPost.publishDate)}
                </div>
                <p className="nf-reader-text">{readingPost.body}</p>
                {(readingPost.link || (cd && readingPost.countdownDate)) && (
                  <div className="nf-reader-actions">
                    {readingPost.link && (
                      <a
                        className="nf-reader-link"
                        href={readingPost.link}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLinkIcon /> {getLinkLabel(readingPost.link)}
                      </a>
                    )}
                    {cd && readingPost.countdownDate && (
                      <div className={`nf-reader-countdown nf-reader-countdown--${cd.level}`}>
                        ⏱ {cd.label} · {new Date(readingPost.countdownDate).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="nf-reader-footer">
                <button className="nf-reader-close" onClick={closeReader}>Close</button>
                <button
                  className={`nf-reader-action${ix.saved ? " nf-reader-action--saved" : ""}`}
                  onClick={(e) => toggleSave(e, readingPost.postId)}
                >
                  <BookmarkIcon filled={ix.saved} />
                  {ix.saved ? "Saved" : "Save"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showAdmin && (
        <NewsAdmin
          session={session}
          onClose={() => setShowAdmin(false)}
          onRefresh={() => loadNews(true)}
        />
      )}
    </div>
  );
}

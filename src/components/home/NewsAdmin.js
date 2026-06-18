"use client";
import { useState, useEffect, useCallback } from "react";

// UI label → data value (mirrors NewsFeed.js FILTERS - "HR" maps to "people",
// "Kitchen" maps to "culinary").
const TAG_OPTIONS = [
  { label: "Ops",     value: "ops" },
  { label: "HR",      value: "people" },
  { label: "Safety",  value: "safety" },
  { label: "Kudos",   value: "kudos" },
  { label: "Kitchen", value: "culinary" },
  { label: "General", value: "general" },
];

const TAG_LABEL = Object.fromEntries(TAG_OPTIONS.map((t) => [t.value, t.label]));

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg"];

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function getEmptyPost(authorName) {
  return {
    title: "",
    body: "",
    tag: "general",
    pinned: false,
    author: authorName || "",
    publishDate: todayISO(),
    expiresDate: "",
    countdownLabel: "",
    countdownDate: "",
    link: "",
    active: true,
    imageUrl: "",
  };
}

// ── Icons ──
const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
);
const EditIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
);
const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);
const UploadIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
);
const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
);

export default function NewsAdmin({ session, onClose, onRefresh }) {
  const userName = session?.user?.name || "";

  const [view, setView] = useState("list");
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [imageRemoved, setImageRemoved] = useState(false);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard?action=news-admin-list");
      const data = await res.json();
      if (data.success) setPosts(data.posts || []);
    } catch (err) {
      console.error("[NewsAdmin] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const openNewEditor = () => {
    setEditing(getEmptyPost(userName));
    setImageFile(null);
    setImagePreview("");
    setImageRemoved(false);
    setFormError("");
    setView("editor");
  };

  const openEditEditor = (post) => {
    setEditing({ ...post });
    setImageFile(null);
    setImagePreview(post.imageUrl || "");
    setImageRemoved(false);
    setFormError("");
    setView("editor");
  };

  const backToList = () => {
    setEditing(null);
    setImageFile(null);
    setImagePreview("");
    setImageRemoved(false);
    setFormError("");
    setView("list");
  };

  const updateField = (key, val) => setEditing((prev) => ({ ...prev, [key]: val }));

  const handleImageSelect = (e) => {
    setFormError("");
    const file = e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { setFormError("Image must be 5MB or smaller"); return; }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) { setFormError("PNG or JPEG only"); return; }
    setImageFile(file);
    setImageRemoved(false);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview("");
    setImageRemoved(true);
  };

  const getImageBase64 = () => new Promise((resolve) => {
    if (!imageFile) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result || "").split(",")[1] || "";
      resolve({ data: base64, fileName: imageFile.name, mimeType: imageFile.type });
    };
    reader.readAsDataURL(imageFile);
  });

  const handleSave = async () => {
    if (!editing.title.trim()) { setFormError("Title is required"); return; }
    if (!editing.body.trim()) { setFormError("Body is required"); return; }
    setSaving(true);
    setFormError("");
    try {
      const imgData = await getImageBase64();
      const isNew = !editing.postId;
      const body = isNew
        ? {
            action: "news-create",
            post: { ...editing },
            ...(imgData ? { imageData: imgData.data, imageFileName: imgData.fileName, imageMimeType: imgData.mimeType } : {}),
          }
        : {
            action: "news-update",
            postId: editing.postId,
            patch: { ...editing },
            removeImage: imageRemoved && !imgData,
            ...(imgData ? { imageData: imgData.data, imageFileName: imgData.fileName, imageMimeType: imgData.mimeType } : {}),
          };
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Save failed");
      await loadList();
      backToList();
      onRefresh?.();
    } catch (err) {
      setFormError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const requestDelete = (post) => setDeleteTarget(post);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "news-delete", postId: deleteTarget.postId }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Delete failed");
      setDeleteTarget(null);
      await loadList();
      onRefresh?.();
    } catch (err) {
      console.error("[NewsAdmin] delete failed:", err);
    } finally {
      setDeleting(false);
    }
  };

  const today = todayISO();

  return (
    <div className="kf-news-admin-overlay" onClick={onClose}>
      <div className="kf-news-admin-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="kf-news-admin-header">
          {view === "editor" ? (
            <button className="kf-news-admin-back" onClick={backToList}>
              <BackIcon /> Back
            </button>
          ) : (
            <span style={{ fontWeight: 700, color: "#153968", fontSize: 15 }}>Manage News</span>
          )}
          <button className="kf-news-admin-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        {/* List view */}
        {view === "list" && (
          <>
            <div className="kf-news-admin-subheader">
              <span style={{ fontSize: 12, color: "#64748b" }}>
                {loading ? "Loading..." : `${posts.length} post${posts.length !== 1 ? "s" : ""}`}
              </span>
              <button className="kf-news-admin-primary" onClick={openNewEditor}>
                <PlusIcon /> New post
              </button>
            </div>

            <div className="kf-news-admin-body">
              {loading ? (
                <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Loading posts...</div>
              ) : posts.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
                  No posts yet. Click <strong>New post</strong> to create the first one.
                </div>
              ) : (
                posts.map((p) => {
                  const isExpired = p.expiresDate && p.expiresDate < today;
                  const isDim = !p.active || isExpired;
                  return (
                    <div
                      key={p.postId}
                      className={`kf-news-admin-item${isDim ? " kf-news-admin-item--inactive" : ""}`}
                    >
                      {p.imageUrl && (
                        <img src={p.imageUrl} alt="" className="kf-news-admin-item-thumb" />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: "#153968", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {p.title || "(no title)"}
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                          {p.author || "Unknown"} {p.publishDate && `· ${p.publishDate}`}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                          <span className={`kf-news-tag kf-news-tag--${p.tag}`} style={{ fontSize: 10 }}>
                            {TAG_LABEL[p.tag] || p.tag.toUpperCase()}
                          </span>
                          {p.pinned && <span className="kf-news-admin-badge kf-news-admin-badge--pinned">PINNED</span>}
                          {!p.active && <span className="kf-news-admin-badge kf-news-admin-badge--inactive">INACTIVE</span>}
                          {isExpired && <span className="kf-news-admin-badge kf-news-admin-badge--expired">EXPIRED</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button className="kf-news-admin-ghost" style={{ padding: "8px 10px", minWidth: 36 }} onClick={() => openEditEditor(p)} title="Edit">
                          <EditIcon />
                        </button>
                        <button className="kf-news-admin-ghost kf-news-admin-ghost--danger" style={{ padding: "8px 10px", minWidth: 36 }} onClick={() => requestDelete(p)} title="Delete">
                          <TrashIcon />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* Editor view */}
        {view === "editor" && editing && (
          <>
            <div className="kf-news-admin-body">
              {/* Title */}
              <label className="kf-news-admin-label">Title</label>
              <input
                type="text"
                className="kf-news-admin-input"
                value={editing.title}
                onChange={(e) => updateField("title", e.target.value)}
                placeholder="Headline for the post"
              />

              {/* Image */}
              <label className="kf-news-admin-label" style={{ marginTop: 16 }}>Image (optional)</label>
              {imagePreview ? (
                <div className="kf-news-upload-preview">
                  <img src={imagePreview} alt="Preview" />
                  <div className="kf-news-upload-preview-bar">
                    <span style={{ fontSize: 11, color: "#64748b" }}>
                      {imageFile ? `${imageFile.name} · ${Math.round(imageFile.size / 1024)}KB` : "Current image"}
                    </span>
                    <button type="button" className="kf-news-admin-ghost kf-news-admin-ghost--danger" onClick={removeImage}>
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <label className="kf-news-upload-zone">
                  <UploadIcon />
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                    Click to upload a PNG or JPEG (max 5MB)
                  </div>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    style={{ display: "none" }}
                    onChange={handleImageSelect}
                  />
                </label>
              )}

              {/* Body */}
              <label className="kf-news-admin-label" style={{ marginTop: 16 }}>Body</label>
              <textarea
                className="kf-news-admin-textarea"
                rows={5}
                value={editing.body}
                onChange={(e) => updateField("body", e.target.value)}
                placeholder="What you want to share..."
              />

              {/* Category */}
              <label className="kf-news-admin-label" style={{ marginTop: 16 }}>Category</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {TAG_OPTIONS.map((opt) => {
                  const active = editing.tag === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateField("tag", opt.value)}
                      className={`kf-news-tag kf-news-tag--${opt.value}`}
                      style={{
                        cursor: "pointer",
                        border: active ? "1.5px solid #153968" : "1.5px solid transparent",
                        opacity: active ? 1 : 0.6,
                        padding: "6px 12px",
                        fontSize: 12,
                        fontWeight: 700,
                        textTransform: "none",
                        letterSpacing: 0,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {/* Dates row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
                <div>
                  <label className="kf-news-admin-label">Publish date</label>
                  <input
                    type="date"
                    className="kf-news-admin-input"
                    value={editing.publishDate}
                    onChange={(e) => updateField("publishDate", e.target.value)}
                  />
                </div>
                <div>
                  <label className="kf-news-admin-label">Expires (optional)</label>
                  <input
                    type="date"
                    className="kf-news-admin-input"
                    value={editing.expiresDate}
                    onChange={(e) => updateField("expiresDate", e.target.value)}
                  />
                </div>
              </div>

              {/* Countdown + Link row */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 16 }}>
                <div>
                  <label className="kf-news-admin-label">Countdown date (optional)</label>
                  <input
                    type="date"
                    className="kf-news-admin-input"
                    value={editing.countdownDate}
                    onChange={(e) => updateField("countdownDate", e.target.value)}
                  />
                </div>
                <div>
                  <label className="kf-news-admin-label">Link (optional)</label>
                  <input
                    type="url"
                    className="kf-news-admin-input"
                    value={editing.link}
                    onChange={(e) => updateField("link", e.target.value)}
                    placeholder="https://..."
                  />
                </div>
              </div>

              {/* Pin */}
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 16, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!editing.pinned}
                  onChange={(e) => updateField("pinned", e.target.checked)}
                  style={{ width: 16, height: 16, marginTop: 2, accentColor: "#153968" }}
                />
                <div>
                  <div style={{ fontSize: 13, color: "#153968", fontWeight: 600 }}>Pin to top</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>Any other pinned post will be unpinned automatically.</div>
                </div>
              </label>

              {/* Author + Active */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 16 }}>
                <div>
                  <label className="kf-news-admin-label">Author</label>
                  <input
                    type="text"
                    className="kf-news-admin-input"
                    value={editing.author}
                    onChange={(e) => updateField("author", e.target.value)}
                  />
                </div>
                <div>
                  <label className="kf-news-admin-label">Status</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="kf-news-admin-ghost"
                      style={editing.active ? { background: "#153968", color: "#fff", borderColor: "#153968" } : {}}
                      onClick={() => updateField("active", true)}
                    >Active</button>
                    <button
                      type="button"
                      className="kf-news-admin-ghost"
                      style={!editing.active ? { background: "#153968", color: "#fff", borderColor: "#153968" } : {}}
                      onClick={() => updateField("active", false)}
                    >Inactive</button>
                  </div>
                </div>
              </div>

              {formError && (
                <div style={{ marginTop: 12, padding: "8px 12px", background: "#fef2f2", color: "#991b1b", borderRadius: 6, fontSize: 12 }}>
                  {formError}
                </div>
              )}
            </div>

            <div className="kf-news-admin-footer">
              <button className="kf-news-admin-ghost" onClick={backToList} disabled={saving}>Cancel</button>
              <button className="kf-news-admin-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : (editing.postId ? "Save changes" : "Publish")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="kf-news-admin-overlay" style={{ zIndex: 1100 }} onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="kf-news-admin-modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="kf-news-admin-header" style={{ background: "#f8fafc" }}>
              <span style={{ fontWeight: 700, color: "#475569", fontSize: 15 }}>Delete post</span>
            </div>
            <div className="kf-news-admin-body" style={{ padding: 20 }}>
              <div style={{ fontSize: 13, color: "#153968", fontWeight: 600 }}>{deleteTarget.title || "(no title)"}</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                {deleteTarget.author} · {deleteTarget.publishDate}
              </div>
              <div style={{ marginTop: 14, padding: "10px 12px", background: "#f8fafc", borderRadius: 6, fontSize: 12, color: "#64748b" }}>
                This post will be removed from the dashboard for everyone. The row stays in the sheet but is blanked out.
              </div>
            </div>
            <div className="kf-news-admin-footer">
              <button className="kf-news-admin-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
              <button
                className="kf-news-admin-primary"
                style={{ background: "#64748b" }}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

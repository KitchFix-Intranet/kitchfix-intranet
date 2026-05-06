"use client";

// ════════════════════════════════════════════════════════════════════════════
// CoEditorBanner — warns when another editor was active recently
//
// Module: People Portal · Leadership Dugout
// Sprint: 2
// CSS prefix: pp-ldug-
//
// Fires when last_action_by ≠ current user AND last_action_at < 5 min ago.
// ════════════════════════════════════════════════════════════════════════════

export default function CoEditorBanner({
  lastEditorEmail,
  lastEditorName,
  lastEditedAt,
  currentUserEmail,
  warnMinutes = 5,
}) {
  if (!lastEditorEmail || !lastEditedAt) return null;
  if (lastEditorEmail.toLowerCase() === (currentUserEmail || "").toLowerCase()) return null;

  const minutesAgo = (Date.now() - new Date(lastEditedAt).getTime()) / 60000;
  if (minutesAgo > warnMinutes) return null;

  const display = lastEditorName || lastEditorEmail;
  const ago = Math.max(1, Math.round(minutesAgo));

  return (
    <div className="pp-ldug-coeditor" role="alert">
      <span className="pp-ldug-coeditor-icon" aria-hidden>⚠</span>
      <span>
        <strong>{display}</strong> was editing this {ago} {ago === 1 ? "minute" : "minutes"} ago — your changes will overwrite theirs if you save.
      </span>
    </div>
  );
}
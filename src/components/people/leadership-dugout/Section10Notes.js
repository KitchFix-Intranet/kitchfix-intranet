"use client";

// ════════════════════════════════════════════════════════════════════════════
// Section10Notes — ACL-gated calibration notes with 60s TTL editor lock
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 5)
// CSS prefix: pp-ldug-
//
// Visible ONLY to Reviewer + Oversight + system viewers (server enforces).
// Heartbeats every 30s while open to refresh the lock.
// Sister editors see read-only with banner.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from "react";
import NarrativeField from "@/components/people/leadership-dugout/NarrativeField";

export default function Section10Notes({ review, currentUserEmail, onSave }) {
  const header = review?.header || {};
  const body = review?.body || {};
  const calibration = body.calibration || {};

  const [notes, setNotes] = useState(calibration.notes || "");
  const [lockState, setLockState] = useState({ ok: true, locked_by: null });
  const heartbeatRef = useRef(null);

  // Initial heartbeat + 30s interval
  useEffect(() => {
    if (!header.id) return;
    let cancelled = false;

    const beat = async () => {
      try {
        const res = await fetch("/api/people/leadership-dugout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "heartbeat-section",
            email: currentUserEmail,
            review_id: header.id,
            section_key: "calibration",
          }),
        }).then((r) => r.json());

        if (cancelled) return;
        setLockState({
          ok: res.ok,
          locked_by: res.locked_by || null,
          seconds_remaining: res.seconds_remaining,
        });
      } catch (e) {
        // Best-effort; don't block UI on heartbeat failures
        console.warn("[Section10] heartbeat failed:", e.message);
      }
    };

    beat();
    heartbeatRef.current = setInterval(beat, 30000);
    return () => {
      cancelled = true;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [header.id, currentUserEmail]);

  const saveNotes = async (text) => {
    setNotes(text);
    const next = { ...calibration, notes: text };
    await fetch("/api/people/leadership-dugout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-cycle-review-section",
        email: currentUserEmail,
        review_id: header.id,
        section_key: "calibration",
        value: next,
      }),
    });
    onSave?.(text);
  };

  const lockedByOther = !lockState.ok && lockState.locked_by && lockState.locked_by !== currentUserEmail;

  return (
    <div className="pp-ldug-section10">
      <div className="pp-ldug-section10-header">
        <span className="pp-ldug-section10-icon" aria-hidden>🔒</span>
        <span className="pp-ldug-section10-label">Section 10 · Calibration notes</span>
        <span className="pp-ldug-section10-meta">Reviewer + Oversight + Sr Dir Ops only</span>
      </div>

      {lockedByOther && (
        <div className="pp-ldug-coeditor" role="alert" style={{ marginBottom: 10 }}>
          <span className="pp-ldug-coeditor-icon" aria-hidden>⚠</span>
          <span>
            <strong>{lockState.locked_by}</strong> is editing Section 10 — your changes
            won't save while their lock is active. Refresh in ~{Math.round(lockState.seconds_remaining || 0)}s.
          </span>
        </div>
      )}

      <NarrativeField
        value={notes}
        onSave={saveNotes}
        placeholder="Calibration notes for the Reviewer. Specific examples, themes worth raising in conversation, deltas to discuss."
        minHeight={120}
        disabled={lockedByOther}
      />
    </div>
  );
}
"use client";
import { useState } from "react";

export default function HelpModal({ userEmail, onClose, showToast }) {
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!msg.trim()) { showToast("Please type a message first.", "error"); return; }
    setSending(true);
    try {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-help",
          userEmail,
          message: msg.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
        setSending(false);
        setTimeout(() => onClose(), 2500);
      } else {
        showToast("Failed to send: " + (data.error || "Unknown error"), "error");
        setSending(false);
      }
    } catch (e) {
      showToast("Network error: " + e.message, "error");
      setSending(false);
    }
  };

  return (
    <div className="pp-modal-overlay" onClick={onClose}>
      <div className="pp-modal-content pp-help-modal" onClick={(e) => e.stopPropagation()}>
        {!sent ? (
          <>
            <div className="pp-help-icon-circle">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
            </div>
            <h3 className="pp-help-title">How can we support you?</h3>
            <p className="pp-help-desc">Direct line to People Ops. Whether it&apos;s payroll, benefits, or just a question, we&apos;re here.</p>
            <textarea className="pp-textarea" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="I have a question about..." style={{ marginBottom: 16 }} />
            <div className="pp-help-actions">
              <button className="pp-btn pp-btn--ghost" onClick={onClose}>Cancel</button>
              <button className="pp-btn pp-btn--primary" onClick={handleSend} disabled={sending}>
                {sending ? "Sending..." : "Send Message"}
              </button>
            </div>
          </>
        ) : (
          <div className="pp-success-view" style={{ padding: 40 }}>
            <div className="pp-success-circle">
              <div className="pp-success-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
            </div>
            <h3 className="pp-card-title" style={{ marginTop: 16 }}>Message Sent!</h3>
            <p className="pp-card-desc">Someone from People Ops will follow up shortly.</p>
          </div>
        )}
      </div>
    </div>
  );
}
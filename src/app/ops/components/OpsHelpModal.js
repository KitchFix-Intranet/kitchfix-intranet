"use client";
import { useState } from "react";

export default function OpsHelpModal({ userEmail, onClose, showToast }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "help-request", email: userEmail, message: message.trim() }) });
      const data = await res.json();
      if (data.success) { showToast("✅ Help request sent to Ops Leadership"); onClose(); }
      else showToast("Failed to send — try again", "error");
    } catch { showToast("Network error", "error"); }
    finally { setSending(false); }
  };
  return (
    <div className="oh-modal-overlay" onClick={onClose}>
      <div className="oh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="oh-modal-icon-circle oh-modal-icon--help">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
        </div>
        <h3 className="oh-modal-title">Need Help?</h3>
        <p className="oh-modal-subtitle">Send a message directly to Ops Leadership. We typically respond within 1 business day.</p>
        <textarea className="oh-textarea" placeholder="Describe what you need help with..." value={message} onChange={(e) => setMessage(e.target.value)} rows={4} />
        <div className="oh-modal-actions" style={{ marginTop: 20 }}>
          <button className="oh-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="oh-btn oh-btn--primary" onClick={handleSend} disabled={!message.trim() || sending} style={{ flex: 2 }}>
            {sending && <span className="oh-btn-spinner" />}{sending ? "Sending..." : "Send Message"}
          </button>
        </div>
      </div>
    </div>
  );
}
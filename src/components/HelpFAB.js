"use client";
import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/* ═══════════════════════════════════════════════════════════
   GLOBAL HELP FAB — Unified across all pages
   Features: Inline message (→ Gmail API), Slack #ops-help link
   Auto-includes page context in email
   ═══════════════════════════════════════════════════════════ */

function getPageLabel(pathname) {
  if (pathname.startsWith("/ops")) return "Ops Hub";
  if (pathname.startsWith("/people")) return "People Portal";
  if (pathname.startsWith("/directory")) return "Team Directory";
  if (pathname.startsWith("/financial")) return "Financial";
  return "Home Dashboard";
}

export default function HelpFAB() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("menu"); // "menu" | "compose"
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const wrapRef = useRef(null);
  const textRef = useRef(null);

  // Don't render on login page
  if (pathname === "/login") return null;

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        // Reset after animation
        setTimeout(() => { setMode("menu"); setMessage(""); setSent(false); }, 200);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Auto-focus textarea when compose opens
  useEffect(() => {
    if (mode === "compose" && textRef.current) {
      textRef.current.focus();
    }
  }, [mode]);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    setSending(true);

    try {
      const email = typeof window !== "undefined" ? localStorage.getItem("kf_user_email") || "" : "";
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit-help-global",
          email,
          message: message.trim(),
          page: getPageLabel(pathname),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSent(true);
        setMessage("");
        setTimeout(() => {
          setOpen(false);
          setTimeout(() => { setMode("menu"); setSent(false); }, 200);
        }, 2000);
      } else {
        alert("Failed to send. Please try Slack instead.");
      }
    } catch {
      alert("Network error. Please try Slack instead.");
    } finally {
      setSending(false);
    }
  };

  const handleToggle = () => {
    if (open) {
      setOpen(false);
      setTimeout(() => { setMode("menu"); setMessage(""); setSent(false); }, 200);
    } else {
      setOpen(true);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
    if (e.key === "Escape") {
      setOpen(false);
      setTimeout(() => { setMode("menu"); setMessage(""); setSent(false); }, 200);
    }
  };

  return (
    <div className="kf-help-wrapper" ref={wrapRef}>
      {/* ── Dropdown Panel ── */}
      <div className={`kf-help-menu ${open ? "active" : ""}`}>
        <div className="kf-help-menu-header">
          <span>{mode === "compose" ? "Send a Message" : "Need Help?"}</span>
          {mode === "compose" && (
            <button
              className="kf-help-back"
              onClick={() => { setMode("menu"); setMessage(""); }}
            >
              ← Back
            </button>
          )}
        </div>

        {mode === "menu" && (
          <div className="kf-help-list">
            <button className="kf-help-item" onClick={() => setMode("compose")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <div className="kf-help-item-text">
                <span className="kf-help-item-title">Send a Message</span>
                <span className="kf-help-item-desc">Email goes directly to Ops Leadership</span>
              </div>
            </button>
            <a
              href="https://kitchfix.slack.com/archives/C0AL9SXFCJ0"
              target="_blank"
              rel="noopener noreferrer"
              className="kf-help-item"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z" />
                <path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" />
                <path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z" />
                <path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z" />
              </svg>
              <div className="kf-help-item-text">
                <span className="kf-help-item-title">Slack #ops-help</span>
                <span className="kf-help-item-desc">Open the channel in Slack</span>
              </div>
            </a>
          </div>
        )}

        {mode === "compose" && !sent && (
          <div className="kf-help-compose">
            <div className="kf-help-context">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              Sending from: {getPageLabel(pathname)}
            </div>
            <textarea
              ref={textRef}
              className="kf-help-textarea"
              placeholder="Describe what you need help with..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              maxLength={1000}
            />
            <div className="kf-help-compose-footer">
              <span className="kf-help-hint">⌘ + Enter to send</span>
              <button
                className={`kf-help-send${message.trim() ? "" : " kf-help-send--disabled"}`}
                onClick={handleSend}
                disabled={!message.trim() || sending}
              >
                {sending ? "Sending..." : "Send Message"}
              </button>
            </div>
          </div>
        )}

        {mode === "compose" && sent && (
          <div className="kf-help-success">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="kf-help-success-title">Message Sent!</span>
            <span className="kf-help-success-desc">We'll get back to you soon.</span>
          </div>
        )}
      </div>

      {/* ── FAB Button ── */}
      <button className="kf-help-fab" onClick={handleToggle}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
<span className="kf-help-fab-label">Need Help?</span>
      </button>
    </div>
  );
}
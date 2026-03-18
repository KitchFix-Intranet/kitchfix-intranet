"use client";
import { useState, useEffect } from "react";

export default function DailyPulse() {
  const [poll, setPoll] = useState(null);
  const [hasVoted, setHasVoted] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pulse")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.poll) {
          setPoll(data.poll);
          // Check localStorage for previous vote
          try {
            const voted = localStorage.getItem("kf_voted_" + data.poll.id);
            if (voted) setHasVoted(true);
          } catch (e) {}
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleVote(index) {
    if (!poll) return;
    setHasVoted(true);
    try {
      localStorage.setItem("kf_voted_" + poll.id, "true");
    } catch (e) {}

    // Optimistic: increment the count
    setPoll((prev) => {
      const newCounts = [...prev.counts];
      newCounts[index]++;
      return { ...prev, counts: newCounts };
    });

    try {
      await fetch("/api/pulse/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pollId: poll.id, optionIndex: index }),
      });
    } catch (e) {}
  }

  if (loading || !poll) {
    return (
      <div className="kf-widget-card">
        <div className="kf-card-header">
          <div className="kf-card-title">
            <svg className="kf-card-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span>Daily Pulse</span>
          </div>
        </div>
        <div className="kf-pulse-loading">Loading Pulse...</div>
      </div>
    );
  }

  const total = poll.counts.reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="kf-widget-card">
      <div className="kf-card-header">
        <div className="kf-card-title">
          <svg className="kf-card-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span>Daily Pulse</span>
        </div>
      </div>
      <div className="kf-pulse-content">
        <div className="kf-pulse-question">{poll.question}</div>
        {!hasVoted ? (
          <div className="kf-pulse-options">
            {poll.options.map((opt, idx) => (
              <button
                key={idx}
                className="kf-pulse-btn squish"
                onClick={() => handleVote(idx)}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <div className="kf-pulse-results">
            {poll.options.map((opt, idx) => {
              const pct = Math.round((poll.counts[idx] / total) * 100);
              return (
                <div key={idx} className="kf-pulse-result-row">
                  <div className="kf-pulse-label-group">
                    <span>{opt}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="kf-pulse-bar-track">
                    <div
                      className="kf-pulse-bar-fill"
                      style={{ width: `${pct}%`, transition: "width 1s cubic-bezier(0.25, 1, 0.5, 1)" }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="kf-pulse-total">{total} votes today</div>
          </div>
        )}
      </div>
    </div>
  );
}
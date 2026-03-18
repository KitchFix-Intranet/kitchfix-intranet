"use client";
import { useState, useEffect } from "react";

export default function SousAI({ periodData, periodId }) {
  const [state, setState] = useState("idle");
  const [bullets, setBullets] = useState([]);
  const [tone, setTone] = useState("neutral");
  const [visibleCount, setVisibleCount] = useState(0);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    setState("idle");
    setBullets([]);
    setVisibleCount(0);
    setErrMsg("");
  }, [periodId]);

  useEffect(() => {
    if (state === "done" && visibleCount < bullets.length) {
      const t = setTimeout(() => setVisibleCount((v) => v + 1), 400);
      return () => clearTimeout(t);
    }
  }, [state, visibleCount, bullets.length]);

  const analyze = async () => {
    setState("thinking");
    setErrMsg("");
    try {
      const res = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sous-analyze", periodData }),
      });
      const data = await res.json();
      if (data.success && data.bullets?.length > 0) {
        setBullets(data.bullets);
        setTone(data.tone || "neutral");
        setVisibleCount(0);
        setState("done");
      } else {
        setErrMsg(data.error || "No analysis returned");
        setState("error");
      }
    } catch {
      setErrMsg("Network error — try again");
      setState("error");
    }
  };

  const icons = ["\u{1F4CA}", "\u26A0\uFE0F", "\u{1F4A1}"];
  const borderColor = tone === "positive" ? "#bbf7d0" : tone === "caution" ? "#fef3c7" : tone === "negative" ? "#fecaca" : "#e2e8f0";
  const bgColor = tone === "positive" ? "#f0fdf4" : tone === "caution" ? "#fffbeb" : tone === "negative" ? "#fef2f2" : "#f8fafc";

  return (
    <div className="oh-sous-card">
      <div className="oh-sous-header">
        <div className="oh-sous-brand">
          <div className="oh-sous-icon">{"\u{1F52A}"}</div>
          <div>
            <span className="oh-sous-name">Sous AI</span>
            <span className="oh-sous-tagline">your numbers, explained</span>
          </div>
        </div>
        <div className="oh-sous-actions">
          {state === "idle" && (
            <button className="oh-sous-btn" onClick={analyze}>
              Ask Sous about {periodId}
            </button>
          )}
          {state === "done" && (
            <button className="oh-sous-regen" onClick={() => { setState("idle"); setBullets([]); setVisibleCount(0); }}>
              {"\u21BB"} Regenerate
            </button>
          )}
          {state === "error" && (
            <button className="oh-sous-regen" onClick={analyze}>Retry</button>
          )}
        </div>
      </div>

      {state === "thinking" && (
        <div className="oh-sous-thinking">
          <div className="oh-sous-dots">
            <span className="oh-sous-dot" style={{ animationDelay: "0s" }} />
            <span className="oh-sous-dot" style={{ animationDelay: "0.2s" }} />
            <span className="oh-sous-dot" style={{ animationDelay: "0.4s" }} />
          </div>
          <span>Sous is reviewing {periodId} financials...</span>
        </div>
      )}

      {state === "error" && (
        <div className="oh-sous-error">
          {errMsg}
        </div>
      )}

      {state === "done" && bullets.length > 0 && (
        <div className="oh-sous-result" style={{ background: bgColor, borderColor }}>
          {bullets.map((b, i) => (
            <div key={i} className={`oh-sous-bullet${i < visibleCount ? " oh-sous-bullet--visible" : ""}`}>
              <span className="oh-sous-bullet-icon">{icons[i] || "\u{1F4CA}"}</span>
              <span className={i === 2 ? "oh-sous-bullet-text oh-sous-bullet-text--action" : "oh-sous-bullet-text"}>{b}</span>
            </div>
          ))}
          <div className="oh-sous-footer">
            <span>Sous AI {"\u00B7"} {periodId} period data {"\u00B7"} revenue-adjusted model</span>
            <span>Powered by Claude</span>
          </div>
        </div>
      )}
    </div>
  );
}
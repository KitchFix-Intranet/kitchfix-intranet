"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Script from "next/script";
import "./analytics.css";

// ═══════════════════════════════════════
// ANALYTICS COMMAND CENTER — /analytics
// Admin-only dashboard reading from analytics Google Sheet tabs
// ═══════════════════════════════════════

const CHART_JS_URL = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js";

function getInitials(str) {
  if (!str) return "?";
  const parts = str.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return str.slice(0, 2).toUpperCase();
}

function scoreLevel(score) {
  if (score >= 70) return "high";
  if (score >= 40) return "mid";
  return "low";
}

// ─── Heatmap helpers ───
const HEATMAP_HOURS = [6, 8, 10, 12, 14, 16, 18];
const HEATMAP_HOUR_LABELS = ["6a", "8a", "10a", "12p", "2p", "4p", "6p"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// JS getDay: 0=Sun, remap: Mon=1..Sun=0 → index 0..6
const DAY_INDEX_MAP = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };

function heatmapLevel(count, max) {
  if (!count || count === 0) return 0;
  const pct = count / (max || 1);
  if (pct > 0.75) return 4;
  if (pct > 0.5) return 3;
  if (pct > 0.25) return 2;
  return 1;
}


export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [range, setRange] = useState("7");
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [chartReady, setChartReady] = useState(false);

  const trendChartRef = useRef(null);
  const deviceChartRef = useRef(null);
  const trendInstance = useRef(null);
  const deviceInstance = useRef(null);

  // ─── Fetch data ───
  const fetchData = useCallback(async (r) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?action=bootstrap&range=${r}`);
      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (e) {
      console.error("[Analytics] Fetch failed:", e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [range, fetchData]);

  // ─── Build charts when data + Chart.js ready ───
  useEffect(() => {
    if (!data || !chartReady || typeof window.Chart === "undefined") return;

    // Trend chart
    if (trendChartRef.current) {
      if (trendInstance.current) trendInstance.current.destroy();
      const ctx = trendChartRef.current.getContext("2d");
      trendInstance.current = new window.Chart(ctx, {
        type: "line",
        data: {
          labels: data.trend.map((d) => {
            const dt = new Date(d.date + "T12:00:00");
            return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          }),
          datasets: [
            {
              label: "Events",
              data: data.trend.map((d) => d.events),
              borderColor: "#0f3057",
              backgroundColor: "rgba(15, 48, 87, 0.08)",
              fill: true,
              tension: 0.3,
              pointRadius: 4,
              pointBackgroundColor: "#0f3057",
              borderWidth: 2,
            },
            {
              label: "Submissions",
              data: data.trend.map((d) => d.submissions),
              borderColor: "#d97706",
              backgroundColor: "transparent",
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 4,
              pointBackgroundColor: "#d97706",
              borderDash: [4, 4],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: "top",
              labels: {
                usePointStyle: true,
                pointStyle: "circle",
                boxWidth: 6,
                font: { size: 11, family: "Inter" },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 11 } } },
            y: { grid: { color: "#f1f5f9" }, ticks: { font: { size: 11 } }, beginAtZero: true },
          },
        },
      });
    }

    // Device chart
    if (deviceChartRef.current && data.devices?.length > 0) {
      if (deviceInstance.current) deviceInstance.current.destroy();
      const ctx2 = deviceChartRef.current.getContext("2d");
      const colors = { mobile: "#0f3057", desktop: "#d97706", unknown: "#e2e8f0" };
      deviceInstance.current = new window.Chart(ctx2, {
        type: "doughnut",
        data: {
          labels: data.devices.map((d) => d.device.charAt(0).toUpperCase() + d.device.slice(1)),
          datasets: [{
            data: data.devices.map((d) => d.count),
            backgroundColor: data.devices.map((d) => colors[d.device] || "#94a3b8"),
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: "65%",
          plugins: {
            legend: {
              position: "bottom",
              labels: {
                usePointStyle: true,
                pointStyle: "circle",
                boxWidth: 6,
                font: { size: 11, family: "Inter" },
                padding: 12,
              },
            },
          },
        },
      });
    }

    return () => {
      if (trendInstance.current) trendInstance.current.destroy();
      if (deviceInstance.current) deviceInstance.current.destroy();
    };
  }, [data, chartReady]);

  // ─── Forbidden state ───
  if (forbidden) {
    return (
      <div className="an-page">
        <div className="an-forbidden">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <h2>Access denied</h2>
          <p>This page is restricted to platform administrators.</p>
        </div>
      </div>
    );
  }

  // ─── Loading state ───
  if (loading || !data) {
    return (
      <div className="an-page">
        <div className="an-hero">
          <div className="an-hero-left">
            <div className="an-hero-icon">
              <svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" /></svg>
            </div>
            <div>
              <h1>Analytics command center</h1>
              <p>Loading...</p>
            </div>
          </div>
        </div>
        <div className="an-metrics">
          {[1, 2, 3, 4].map((i) => <div key={i} className="an-skeleton" />)}
        </div>
        <div className="an-row">
          <div className="an-skeleton" style={{ height: 240 }} />
          <div className="an-skeleton" style={{ height: 240 }} />
        </div>
      </div>
    );
  }

  const m = data.metrics;
  const d = data.deltas;
  const heatmap = data.heatmap || {};

  // Heatmap max value for scaling
  const heatmapMax = Math.max(1, ...Object.values(heatmap));

  const rangeLabel = range === "1" ? "vs yesterday" : range === "7" ? "vs last week" : "vs last 30d";

  return (
    <div className="an-page">
      {/* Chart.js CDN */}
      <Script src={CHART_JS_URL} strategy="afterInteractive" onLoad={() => setChartReady(true)} />

      {/* ── Hero ── */}
      <div className="an-hero">
        <div className="an-hero-left">
          <div className="an-hero-icon">
            <svg viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 4-6" /></svg>
          </div>
          <div>
            <h1>Analytics command center</h1>
            <p>Intranet usage intelligence</p>
          </div>
        </div>
        <div className="an-hero-badge">ADMIN ONLY</div>
      </div>

      {/* ── Period pills ── */}
      <div className="an-period">
        {[
          { value: "1", label: "Today" },
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
        ].map((p) => (
          <button
            key={p.value}
            className={`an-pill${range === p.value ? " an-pill--active" : ""}`}
            onClick={() => setRange(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Metric cards ── */}
      <div className="an-metrics">
        <div className="an-metric">
          <div className="an-metric-label">Total events</div>
          <div className="an-metric-value">{m.totalEvents.toLocaleString()}</div>
          <div className="an-metric-sub">
            {d.eventsPct !== 0 ? (
              <span className={d.eventsPct > 0 ? "an-up" : "an-down"}>
                {d.eventsPct > 0 ? "+" : ""}{d.eventsPct}%
              </span>
            ) : (
              <span className="an-flat">—</span>
            )}{" "}
            {rangeLabel}
          </div>
        </div>
        <div className="an-metric">
          <div className="an-metric-label">Active users</div>
          <div className="an-metric-value">{m.uniqueUsers}</div>
          <div className="an-metric-sub">
            {d.users !== 0 ? (
              <span className={d.users > 0 ? "an-up" : "an-down"}>
                {d.users > 0 ? "+" : ""}{d.users}
              </span>
            ) : (
              <span className="an-flat">—</span>
            )}{" "}
            {rangeLabel}
          </div>
        </div>
        <div className="an-metric">
          <div className="an-metric-label">Submissions</div>
          <div className="an-metric-value">{m.submissions}</div>
          <div className="an-metric-sub">
            Inventory {m.invCount} / Invoice {m.invoiceCount} / HR {m.hrCount}
          </div>
        </div>
        <div className="an-metric">
          <div className="an-metric-label">Error rate</div>
          <div className="an-metric-value">{m.errorRate}%</div>
          <div className="an-metric-sub">
            {m.errors > 0 ? (
              <><span className="an-down">{m.errors} failure{m.errors > 1 ? "s" : ""}</span> — {m.topFailService}</>
            ) : (
              <span className="an-up">No errors</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Row 1: Trend + Heatmap ── */}
      <div className="an-row">
        <div className="an-card">
          <h3>Activity trend <span>daily events</span></h3>
          <div className="an-chart-area">
            <canvas ref={trendChartRef} />
          </div>
        </div>
        <div className="an-card">
          <h3>Submission velocity <span>hour × day heatmap</span></h3>
          <div className="an-heatmap">
            <div className="an-heatmap-label" />
            {DAY_LABELS.map((dl) => (
              <div key={dl} className="an-heatmap-header">{dl}</div>
            ))}
            {HEATMAP_HOURS.map((hour, hi) => (
              <React.Fragment key={`row-${hour}`}>
                <div className="an-heatmap-label">{HEATMAP_HOUR_LABELS[hi]}</div>
                {[1, 2, 3, 4, 5, 6, 0].map((dayJs) => {
                  const count = heatmap[`${hour}:${dayJs}`] || 0;
                  const level = heatmapLevel(count, heatmapMax);
                  return (
                    <div
                      key={`c-${hour}-${dayJs}`}
                      className={`an-heatmap-cell an-h${level}`}
                      title={`${DAY_LABELS[DAY_INDEX_MAP[dayJs]]} ${HEATMAP_HOUR_LABELS[hi]}: ${count}`}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <div className="an-heatmap-legend">
            <span>Less</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <div key={l} className={`an-heatmap-legend-cell an-h${l}`} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>

      {/* ── Row 2: Account Scorecard + Feature Funnel ── */}
      <div className="an-row">
        <div className="an-card">
          <h3>Account adoption <span>scorecard</span></h3>
          {data.scorecard?.length > 0 ? (
            <table className="an-table">
              <thead>
                <tr><th>Account</th><th>Users</th><th>Submissions</th><th>Score</th></tr>
              </thead>
              <tbody>
                {data.scorecard.map((a) => (
                  <tr key={a.account}>
                    <td className={a.score < 30 ? "an-red an-bold" : "an-bold"}>{a.account}</td>
                    <td>{a.users}</td>
                    <td>{a.submissions}</td>
                    <td>
                      <span className={`an-score an-score--${scoreLevel(a.score)}`} />
                      {a.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="an-empty">No account data yet</div>
          )}
        </div>
        <div className="an-card">
          <h3>Feature funnel <span>conversion</span></h3>
          {data.funnel?.length > 0 ? (
            <>
              {data.funnel.map((f) => (
                <div key={f.name} className="an-funnel-row">
                  <div className="an-funnel-label">{f.name}</div>
                  <div className="an-funnel-bar-wrap">
                    <div className="an-funnel-bar" style={{ width: `${Math.max(f.pct, 2)}%` }} />
                  </div>
                  <div className="an-funnel-pct">{f.pct}%</div>
                </div>
              ))}
              <p className="an-hint">% of page views that result in a completed submission</p>
            </>
          ) : (
            <div className="an-empty">No funnel data yet</div>
          )}
        </div>
      </div>

      {/* ── Row 3: Power Users + Ghost Users ── */}
      <div className="an-row">
        <div className="an-card">
          <h3>Power users <span>top {Math.min(10, data.powerUsers?.length || 0)}</span></h3>
          {data.powerUsers?.length > 0 ? (
            <table className="an-table">
              <thead>
                <tr><th>User</th><th>Actions</th><th>Top tool</th></tr>
              </thead>
              <tbody>
                {data.powerUsers.map((u) => (
                  <tr key={u.email}>
                    <td className="an-bold">{u.name}</td>
                    <td className="an-navy">{u.actions}</td>
                    <td>{u.topCategory}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="an-empty">No user data yet</div>
          )}
        </div>
        <div className="an-card">
          <h3>Ghost users <span>login only, no actions</span></h3>
          {data.ghostUsers?.length > 0 ? (
            <>
              {data.ghostUsers.map((g) => (
                <div key={g.email} className="an-ghost">
                  <div className="an-ghost-avatar">{getInitials(g.email)}</div>
                  <div className="an-ghost-info">
                    <div className="an-ghost-name">{g.name || g.email.split("@")[0]}</div>
                    <div className="an-ghost-detail">{g.logins} login{g.logins > 1 ? "s" : ""}, 0 submissions</div>
                  </div>
                </div>
              ))}
              <p className="an-hint">Users who log in but never complete a workflow</p>
            </>
          ) : (
            <div className="an-empty">No ghost users — everyone is engaged</div>
          )}
        </div>
      </div>

      {/* ── Row 4: Devices + Error Impact ── */}
      <div className="an-row">
        <div className="an-card">
          <h3>Device breakdown <span>this period</span></h3>
          <div className="an-chart-area" style={{ height: 180 }}>
            <canvas ref={deviceChartRef} />
          </div>
        </div>
        <div className="an-card">
          <h3>Error impact <span>actions with failures</span></h3>
          {data.errorImpact?.length > 0 ? (
            <table className="an-table">
              <thead>
                <tr><th>Action</th><th>Errors</th><th>Rate</th><th>Top error</th></tr>
              </thead>
              <tbody>
                {data.errorImpact.map((e) => (
                  <tr key={e.action}>
                    <td className="an-bold">{e.action}</td>
                    <td className="an-red">{e.errors}</td>
                    <td>{e.rate}</td>
                    <td className="an-muted">{e.topError}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="an-empty">
              <span className="an-up" style={{ fontSize: 13 }}>No errors this period</span>
            </div>
          )}
        </div>
      </div>

      {/* ── AI Pulse ── */}
      {data.aiPulse && (
        <div className="an-row--wide">
          <div className="an-pulse">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                <path d="M12 2a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4z" />
                <path d="M12 18v4M8 22h8" />
              </svg>
              AI pulse — week of {data.aiPulse.date}
            </h3>
            <p>{data.aiPulse.summary}</p>
            <div className="an-pulse-date">
              Generated by Claude Sonnet
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
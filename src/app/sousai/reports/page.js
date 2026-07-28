// ═══════════════════════════════════════════════════════════════════════════
// /sousai/reports · Sous Reports · R1 (viewer-allowlisted, server-rendered)
// ═══════════════════════════════════════════════════════════════════════════
//
// SERVER COMPONENT. Gate order (all server-side):
//   1. middleware (edge) - redirects unauth requests to /login
//   2. this component - await auth() re-check + canViewSousReports check
//        - no session -> notFound()
//        - not on the SOUSAI_REPORTS_VIEWERS allowlist -> notFound()
//
// canViewSousReports() is the SINGLE SOURCE OF TRUTH for who sees Sous
// Reports. It also gates the profile-dropdown nav-link visibility (via a
// server-resolved prop from src/app/layout.js -> src/components/TopNav.js).
// One helper, one env var; there is no second surface to keep in sync -
// see src/lib/opdAcl.js for rationale and the fail-closed default.
//
// notFound() is the house-standard behavior for viewer-gated server pages -
// exposes zero information about the route's existence to non-authorized
// users. Ratified via #536 (R1) placement decision.
//
// Tab switching + Today/Yesterday toggle use search params so the page is
// pure server-render with no client JS. Refresh affordance: <a href="...">
// links reload with the same params.
//
// R1 non-negotiables enforced here:
//   1. Status legend visible on every tab (see LEGEND at bottom)
//   2. Data-read errors render an explicit error state, never silent zeros
//   3. Every section has an empty-state message; the page is sane with 1 row
// ═══════════════════════════════════════════════════════════════════════════

import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { canViewSousReports } from "@/lib/opdAcl";
import { fetchReportRows } from "./data.js";
import "./reports.css";
import {
  isoDay, daysAgo, serverToday,
  scoreboard, rowsForDay,
  transcript, declinesAndErrors, thumbsDowns,
  dayByDay, repeatQuestions, mostCitedDocs, declineGaps, feedbackSummary,
  adoptionByWeek, byPersonUsage, monthPerf, unansweredDemand,
  bucketOf,
} from "./aggregate.js";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Sous Reports · KitchFix",
  description: "Adoption + outcomes for SousAI (SLT-only).",
};

// ── Small render helpers ────────────────────────────────────────────────────

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
function fmtDateTime(iso) {
  if (!iso) return "";
  return `${isoDay(iso)} ${fmtTime(iso)}`;
}
function fmtSeconds(s) {
  if (s === null || s === undefined) return "—";
  return `${s.toFixed(1)}s`;
}
function fmtUsd(n) {
  if (n === null || n === undefined) return "—";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
function fmtPct(n) {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(0)}%`;
}
function StatusPill({ status }) {
  return <span className={`kf-sousai-pill kf-sousai-pill-${status}`}>{status}</span>;
}
function Empty({ children }) {
  return <p className="kf-sousai-empty">{children}</p>;
}

// ── Views ───────────────────────────────────────────────────────────────────

function DailyView({ rows, dayISO, dayLabel }) {
  const dayRows = rowsForDay(rows, dayISO);
  const s = scoreboard(dayRows);
  const t = transcript(dayRows);
  const de = declinesAndErrors(dayRows);
  const td = thumbsDowns(dayRows);

  return (
    <>
      <h2 className="kf-sousai-h2">Scoreboard - {dayLabel} ({dayISO})</h2>
      <div className="kf-sousai-scoreboard">
        <div><span className="kf-sousai-metric">{s.questions}</span><span className="kf-sousai-label">questions</span></div>
        <div><span className="kf-sousai-metric">{s.unique_askers}</span><span className="kf-sousai-label">unique askers</span></div>
        <div><span className="kf-sousai-metric">{s.grounded}</span><span className="kf-sousai-label">grounded</span></div>
        <div><span className="kf-sousai-metric">{s.partial}</span><span className="kf-sousai-label">partial</span></div>
        <div><span className="kf-sousai-metric">{s.declined}</span><span className="kf-sousai-label">declined</span></div>
        <div><span className="kf-sousai-metric">{s.error}</span><span className="kf-sousai-label">errors</span></div>
        <div><span className="kf-sousai-metric">{fmtSeconds(s.avg_seconds)}</span><span className="kf-sousai-label">avg (est.)</span></div>
        <div><span className="kf-sousai-metric">{fmtUsd(s.est_cost)}</span><span className="kf-sousai-label">est. cost</span></div>
      </div>

      <h2 className="kf-sousai-h2">Transcript</h2>
      {t.length === 0 ? <Empty>No questions on {dayISO}.</Empty> : (
        <table className="kf-sousai-table">
          <thead><tr><th>Time</th><th>Asker</th><th>Status</th><th>Question</th><th>Response preview</th></tr></thead>
          <tbody>
            {t.map((r) => (
              <tr key={r.id}>
                <td>{fmtTime(r.time)}</td>
                <td className="kf-sousai-email">{r.asker}</td>
                <td><StatusPill status={r.status} /></td>
                <td className="kf-sousai-question">{r.question}</td>
                <td className="kf-sousai-preview">{r.answer_preview}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="kf-sousai-h2">Declines &amp; errors</h2>
      {de.length === 0 ? <Empty>No declines or errors on {dayISO}.</Empty> : (
        <table className="kf-sousai-table">
          <thead><tr><th>Time</th><th>Asker</th><th>Status</th><th>Question</th><th>Reason</th></tr></thead>
          <tbody>
            {de.map((r) => (
              <tr key={r.id}>
                <td>{fmtTime(r.time)}</td>
                <td className="kf-sousai-email">{r.asker}</td>
                <td><StatusPill status={r.status} /></td>
                <td className="kf-sousai-question">{r.question}</td>
                <td className="kf-sousai-preview">{r.reason || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="kf-sousai-h2">Thumbs-downs with comments</h2>
      {td.length === 0 ? <Empty>No thumbs-downs on {dayISO}.</Empty> : (
        <table className="kf-sousai-table">
          <thead><tr><th>Time</th><th>Asker</th><th>Question</th><th>Comment</th></tr></thead>
          <tbody>
            {td.map((r) => (
              <tr key={r.id}>
                <td>{fmtTime(r.time)}</td>
                <td className="kf-sousai-email">{r.asker}</td>
                <td className="kf-sousai-question">{r.question}</td>
                <td className="kf-sousai-preview">{r.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function WeeklyView({ rows, endDayISO }) {
  const startDay = isoDay(daysAgo(new Date(endDayISO), 6));
  const weekRows = rows.filter((r) => {
    const d = isoDay(r.created_at);
    return d >= startDay && d <= endDayISO;
  });
  const dbd = dayByDay(rows, endDayISO, 7);
  const rq = repeatQuestions(weekRows);
  const mcd = mostCitedDocs(weekRows);
  const dg = declineGaps(weekRows);
  const fb = feedbackSummary(weekRows);

  return (
    <>
      <h2 className="kf-sousai-h2">Day-by-day volume (last 7 days ending {endDayISO})</h2>
      <table className="kf-sousai-table">
        <thead><tr><th>Day</th><th>Total</th><th>Grounded</th><th>Partial</th><th>Declined</th><th>Errors</th></tr></thead>
        <tbody>
          {dbd.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.total}</td>
              <td>{d.grounded}</td>
              <td>{d.partial}</td>
              <td>{d.declined}</td>
              <td>{d.error}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="kf-sousai-h2">Repeat questions (asked &gt; 1 time)</h2>
      {rq.length === 0 ? <Empty>No repeats this week.</Empty> : (
        <table className="kf-sousai-table">
          <thead><tr><th>Sample question</th><th>Count</th><th>Askers</th><th>Last seen</th></tr></thead>
          <tbody>
            {rq.map((r) => (
              <tr key={r.normalized}>
                <td className="kf-sousai-question">{r.sample}</td>
                <td>{r.count}</td>
                <td>{r.distinct_askers}</td>
                <td>{fmtDateTime(r.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="kf-sousai-h2">Most-cited documents</h2>
      {mcd.length === 0 ? <Empty>No citations this week.</Empty> : (
        <table className="kf-sousai-table">
          <thead><tr><th>Doc</th><th>Cites</th></tr></thead>
          <tbody>
            {mcd.map((r) => (<tr key={r.doc_id}><td>{r.doc_id}</td><td>{r.count}</td></tr>))}
          </tbody>
        </table>
      )}

      <h2 className="kf-sousai-h2">Declines grouped by question</h2>
      {dg.length === 0 ? <Empty>No declines this week.</Empty> : (
        <table className="kf-sousai-table">
          <thead><tr><th>Sample question</th><th>Count</th><th>Askers</th><th>Reason(s)</th></tr></thead>
          <tbody>
            {dg.map((r) => (
              <tr key={r.normalized}>
                <td className="kf-sousai-question">{r.sample}</td>
                <td>{r.count}</td>
                <td className="kf-sousai-email">{r.askers.join(", ")}</td>
                <td className="kf-sousai-preview">{r.reasons.join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="kf-sousai-h2">Feedback</h2>
      <div className="kf-sousai-scoreboard">
        <div><span className="kf-sousai-metric">{fb.up}</span><span className="kf-sousai-label">up</span></div>
        <div><span className="kf-sousai-metric">{fb.down}</span><span className="kf-sousai-label">down</span></div>
        <div><span className="kf-sousai-metric">{fb.rated}/{fb.total}</span><span className="kf-sousai-label">rated / total</span></div>
        <div><span className="kf-sousai-metric">{fmtPct(fb.pct_rated)}</span><span className="kf-sousai-label">% rated</span></div>
      </div>
    </>
  );
}

function MonthlyView({ rows, endDayISO }) {
  const adopt = adoptionByWeek(rows, endDayISO);
  const bpu = byPersonUsage(rows);
  const perf = monthPerf(rows);
  const demand = unansweredDemand(rows);

  return (
    <>
      <h2 className="kf-sousai-h2">Adoption by week (4 most recent, ending {endDayISO})</h2>
      <table className="kf-sousai-table">
        <thead><tr><th>Week</th><th>Questions</th><th>Distinct askers</th><th>% grounded</th><th>% declined</th></tr></thead>
        <tbody>
          {adopt.map((w) => (
            <tr key={w.week_start}>
              <td>{w.week_start} — {w.week_end}</td>
              <td>{w.questions}</td>
              <td>{w.distinct_askers}</td>
              <td>{fmtPct(w.pct_grounded)}</td>
              <td>{fmtPct(w.pct_declined)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="kf-sousai-h2">By-person usage (30 days)</h2>
      {bpu.length === 0 ? <Empty>No askers this month.</Empty> : (
        <table className="kf-sousai-table">
          <thead><tr><th>Person</th><th>Questions</th><th>Grounded</th><th>Declined</th><th>Last seen</th></tr></thead>
          <tbody>
            {bpu.map((p) => (
              <tr key={p.email}>
                <td className="kf-sousai-email">{p.email}</td>
                <td>{p.questions}</td>
                <td>{p.grounded}</td>
                <td>{p.declined}</td>
                <td>{fmtDateTime(p.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="kf-sousai-h2">Cost + speed (30 days)</h2>
      <div className="kf-sousai-scoreboard">
        <div><span className="kf-sousai-metric">{fmtUsd(perf.est_cost)}</span><span className="kf-sousai-label">est. cost</span></div>
        <div><span className="kf-sousai-metric">{fmtSeconds(perf.avg_seconds)}</span><span className="kf-sousai-label">avg (est.)</span></div>
        <div><span className="kf-sousai-metric">{fmtSeconds(perf.worst_seconds)}</span><span className="kf-sousai-label">worst (est.)</span></div>
      </div>

      <h2 className="kf-sousai-h2">Unanswered demand (30 days)</h2>
      {demand.length === 0 ? <Empty>No declines this month.</Empty> : (
        <table className="kf-sousai-table">
          <thead><tr><th>Sample question</th><th>Times asked</th><th>First seen</th><th>Last seen</th></tr></thead>
          <tbody>
            {demand.map((d) => (
              <tr key={d.normalized}>
                <td className="kf-sousai-question">{d.sample}</td>
                <td>{d.count}</td>
                <td>{fmtDateTime(d.first_seen)}</td>
                <td>{fmtDateTime(d.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

// ── Page (server component) ─────────────────────────────────────────────────

export default async function SousaiReportsPage({ searchParams }) {
  const sp = (await searchParams) || {};
  const tab = typeof sp.tab === "string" && ["daily", "weekly", "monthly"].includes(sp.tab) ? sp.tab : "daily";
  const day = sp.day === "yesterday" ? "yesterday" : "today";

  const session = await auth();
  const email = session?.user?.email;
  if (!email) notFound();
  if (!canViewSousReports(email)) notFound();

  const now = new Date();
  const { rows, error } = await fetchReportRows(now);

  const today = serverToday(now);
  const todayISO = isoDay(today);
  const yesterdayISO = isoDay(daysAgo(today, 1));
  const endDayISO = todayISO;

  return (
    <div className="kf-sousai-reports">
      <header className="kf-sousai-header">
        <div>
          <h1 className="kf-sousai-h1">Sous Reports</h1>
          <p className="kf-sousai-sub">Adoption + outcomes for SousAI - live from <code>sousai_questions</code>. SLT-only.</p>
        </div>
        <div className="kf-sousai-refresh">
          <a href={`?tab=${tab}${tab === "daily" ? `&day=${day}` : ""}`}>Refresh</a>
        </div>
      </header>

      <nav className="kf-sousai-tabs" aria-label="Report period">
        <Link href="?tab=daily&day=today" className={tab === "daily" ? "active" : ""}>Daily</Link>
        <Link href="?tab=weekly" className={tab === "weekly" ? "active" : ""}>Weekly (7 days)</Link>
        <Link href="?tab=monthly" className={tab === "monthly" ? "active" : ""}>Monthly (30 days)</Link>
      </nav>

      {error ? (
        <div className="kf-sousai-error" role="alert">
          <strong>Read failed.</strong> The reports page could not fetch <code>sousai_questions</code>: {error}. This is an explicit error state - the page will not render zeros over a failed read.
        </div>
      ) : (
        <>
          {tab === "daily" && (
            <>
              <div className="kf-sousai-daytoggle">
                <Link href="?tab=daily&day=today" className={day === "today" ? "active" : ""}>Today ({todayISO})</Link>
                <Link href="?tab=daily&day=yesterday" className={day === "yesterday" ? "active" : ""}>Yesterday ({yesterdayISO})</Link>
              </div>
              <DailyView rows={rows} dayISO={day === "today" ? todayISO : yesterdayISO} dayLabel={day === "today" ? "Today so far" : "Yesterday"} />
            </>
          )}
          {tab === "weekly" && <WeeklyView rows={rows} endDayISO={endDayISO} />}
          {tab === "monthly" && <MonthlyView rows={rows} endDayISO={endDayISO} />}
        </>
      )}

      <footer className="kf-sousai-footer">
        <div className="kf-sousai-legend">
          <span className="kf-sousai-legend-label">Status:</span>
          <StatusPill status="grounded" /> <span>every claim cited to a fetched source</span>
          <StatusPill status="partial" /> <span>answered with a gap</span>
          <StatusPill status="declined" /> <span>hard-floor decline / out of scope</span>
          <StatusPill status="error" /> <span>upstream failure (auth / credit / rate-limit / timeout)</span>
        </div>
        <p className="kf-sousai-note">Window: last 30 days. All aggregations computed live on load from one fetch (excluding trajectory). No cron, no cached views. Cost figures are estimates (labeled &quot;est.&quot;).</p>
      </footer>
    </div>
  );
}

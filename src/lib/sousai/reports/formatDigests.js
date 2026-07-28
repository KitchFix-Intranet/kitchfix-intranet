// ═══════════════════════════════════════════════════════════════════════════
// src/lib/sousai/reports/formatDigests.js
// ═══════════════════════════════════════════════════════════════════════════
//
// R1.5 pure formatters for the scheduled digests.
//
//   formatSlackDaily(rows, dayISO) -> Slack incoming-webhook JSON payload
//   formatEmailWeekly(rows, endDayISO) -> { subject, html }
//   formatEmailMonthly(rows, endDayISO) -> { subject, html }
//
// Every function is pure: takes rows + date, returns an object. Zero DB,
// zero side-effects, unit-testable from a fixture. Numeric aggregation is
// DELEGATED to R1's aggregate.js verbatim - the digest and the page must be
// incapable of disagreeing (R1.5 binding).
//
// House rules honored:
//   - Hyphens only, including subjects (docs/GOTCHAS.md §em-dash: subject
//     lines with em-dashes produce =?UTF-8?... garbage in some clients).
//   - No em-dashes anywhere in generated output.
//   - Emails: table-based HTML, inline styles, no JS, no external CSS.
//   - Slack: use attachment colors for the accent bar (navy for main,
//     amber for attention blocks like thumbs-downs / errors).
// ═══════════════════════════════════════════════════════════════════════════

import {
  isoDay,
  daysAgo,
  scoreboard,
  rowsForDay,
  declinesAndErrors,
  thumbsDowns,
  dayByDay,
  repeatQuestions,
  mostCitedDocs,
  declineGaps,
  feedbackSummary,
  adoptionByWeek,
  byPersonUsage,
  monthPerf,
  unansweredDemand,
  previewAnswer,
} from "../../../app/sousai/reports/aggregate.js";

// ── Brand colors + reporting constants ──────────────────────────────────────
const NAVY = "#153968";
const AMBER = "#D9892F";
const REPORTS_URL_PATH = "/sousai/reports";

// ── Formatting helpers ─────────────────────────────────────────────────────
function fmtSeconds(s) {
  if (s === null || s === undefined) return "-";
  return `${s.toFixed(1)}s`;
}
function fmtUsd(n) {
  if (n === null || n === undefined) return "-";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
function fmtPct(n) {
  if (n === null || n === undefined) return "-";
  return `${n.toFixed(0)}%`;
}
function truncate(text, chars = 100) {
  if (!text) return "";
  const s = String(text).replace(/\s+/g, " ").trim();
  return s.length > chars ? s.slice(0, chars) + "..." : s;
}

// Decline-classification heuristic. RULE-BASED (approved).
// Live-numbers keywords -> Phase F data-tool demand; everything else -> doc gap.
const LIVE_NUMBERS_PATTERN = /\b(meal[- ]?count|count|numbers?|figure|amount|budget|forecast|actual|homestand|schedule|calendar|inventory|price|rate|invoice|billing|revenue|cost|total|period\s*\d)/i;
export function classifyDecline(question) {
  const q = String(question || "");
  if (LIVE_NUMBERS_PATTERN.test(q)) return "likely live-numbers demand (Phase F)";
  return "likely missing document";
}

// Slack section text sanitizer. Slack renders `*text*` as bold, `_text_` as
// italic; escape `<>&` per Slack docs.
function slackEscape(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Slack DAILY digest ─────────────────────────────────────────────────────
//
// Format: incoming-webhook JSON with "attachments" for the color bar.
// The zero-activity path returns a minimal one-liner - silence is
// indistinguishable from a broken cron, so a "no questions" post proves
// the pipeline is alive.
export function formatSlackDaily(rows, dayISO, opts = {}) {
  const baseUrl = opts.baseUrl || "";
  const dayRows = rowsForDay(rows, dayISO);
  const link = `${baseUrl}${REPORTS_URL_PATH}?tab=daily&day=yesterday`;

  if (dayRows.length === 0) {
    return {
      text: `Sous digest for ${dayISO}: No questions yesterday.`,
      attachments: [
        {
          color: NAVY,
          text: `<${link}|Open Sous Reports>`,
          footer: "SLT-only. Verbatim questions may appear. Cost figures estimated.",
        },
      ],
    };
  }

  const s = scoreboard(dayRows);
  const de = declinesAndErrors(dayRows);
  const td = thumbsDowns(dayRows);
  const errors = de.filter((r) => r.status === "error");
  const declines = de.filter((r) => r.status === "declined");

  const attachments = [];

  // Scoreboard - navy bar
  const scoreLine =
    `*Questions:* ${s.questions}    ` +
    `*Askers:* ${s.unique_askers}    ` +
    `*Grounded:* ${s.grounded}    ` +
    `*Partial:* ${s.partial}    ` +
    `*Declined:* ${s.declined}    ` +
    `*Errors:* ${s.error}\n` +
    `*Avg (est.):* ${fmtSeconds(s.avg_seconds)}    ` +
    `*Est. cost:* ${fmtUsd(s.est_cost)}`;
  attachments.push({
    color: NAVY,
    title: `Sous digest for ${dayISO}`,
    text: scoreLine,
    mrkdwn_in: ["text", "title"],
  });

  // Declines - grouped, with heuristic line each
  if (declines.length > 0) {
    const groups = declineGaps(dayRows);
    const declineText = groups.map((g) => {
      const heuristic = classifyDecline(g.sample);
      return (
        `*_declined:_* ${slackEscape(truncate(g.sample, 140))}\n` +
        `askers: ${slackEscape(g.askers.join(", ") || "-")}    ` +
        `count: ${g.count}\n` +
        `_heuristic (keyword-based, not judgment):_ ${heuristic}`
      );
    }).join("\n\n");
    attachments.push({
      color: NAVY,
      title: `Declines (${declines.length})`,
      text: declineText,
      mrkdwn_in: ["text", "title"],
    });
  }

  // Thumbs-downs - amber bar (attention block)
  if (td.length > 0) {
    const tdText = td.map((r) =>
      `_${slackEscape(r.asker)}_ on \`${slackEscape(truncate(r.question, 100))}\`\n` +
      `> ${slackEscape(truncate(r.comment, 200))}`
    ).join("\n\n");
    attachments.push({
      color: AMBER,
      title: `Thumbs-downs (${td.length})`,
      text: tdText,
      mrkdwn_in: ["text", "title"],
    });
  }

  // Errors - amber bar (attention block)
  if (errors.length > 0) {
    const errText = errors.map((r) =>
      `_${slackEscape(r.asker)}_ - kind: ${slackEscape(r.reason)}\n` +
      `> ${slackEscape(truncate(r.question, 140))}`
    ).join("\n\n");
    attachments.push({
      color: AMBER,
      title: `Errors (${errors.length})`,
      text: errText,
      mrkdwn_in: ["text", "title"],
    });
  }

  // Footer with link
  attachments.push({
    color: NAVY,
    text: `<${link}|Open Sous Reports>`,
    footer: "SLT-only. Verbatim questions may appear. Cost figures estimated.",
  });

  return {
    text: `Sous digest for ${dayISO}: ${s.questions} question${s.questions === 1 ? "" : "s"} from ${s.unique_askers} asker${s.unique_askers === 1 ? "" : "s"}.`,
    attachments,
  };
}

// ── Email HTML skeleton (shared) ───────────────────────────────────────────
function emailHead(titleText) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${titleText}</title></head>
<body style="margin:0;padding:0;background:#f4f7fc;font-family:Arial,Helvetica,sans-serif;color:#0A2548;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fc;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #d1dae6;border-radius:6px;">`;
}
function emailFoot(baseUrl, footerNote) {
  const link = `${baseUrl}${REPORTS_URL_PATH}`;
  return `
<tr><td style="padding:16px 24px;background:${NAVY};border-radius:0 0 6px 6px;color:#ffffff;font-size:12px;">
<a href="${link}" style="color:#ffffff;text-decoration:underline;">Open Sous Reports</a>
</td></tr>
<tr><td style="padding:12px 24px;color:#64748b;font-size:11px;">${footerNote}</td></tr>
</table>
</td></tr></table></body></html>`;
}

function emailHeader(bandText, tone = "navy") {
  const bg = tone === "amber" ? AMBER : NAVY;
  return `
<tr><td style="padding:20px 24px;background:${bg};color:#ffffff;border-radius:6px 6px 0 0;">
<div style="font-size:12px;letter-spacing:0.6px;text-transform:uppercase;opacity:0.85;">Sous Reports</div>
<div style="font-size:20px;font-weight:700;margin-top:4px;">${bandText}</div>
</td></tr>`;
}

function emailLegend() {
  return `
<tr><td style="padding:12px 24px 4px;font-size:11px;color:#64748b;">
<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#E9FDEC;color:#006515;border:1px solid #A2D9AB;margin-right:6px;">grounded</span>
<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#FFF2E2;color:#8C3A00;border:1px solid #F7C299;margin-right:6px;">partial</span>
<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#F4F2EC;color:#475569;border:1px solid #E5E7EB;margin-right:6px;">declined</span>
<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#FFEDE7;color:#970000;border:1px solid #FFA69B;">error</span>
</td></tr>`;
}

function emailTable(headers, rows, note) {
  const th = headers.map((h) => `<th style="text-align:left;padding:6px 8px;background:#f4f2ec;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;border-bottom:1px solid #d1dae6;">${h}</th>`).join("");
  const tr = rows.length === 0
    ? `<tr><td colspan="${headers.length}" style="padding:12px;color:#94A3B8;font-size:12px;">No rows.</td></tr>`
    : rows.map((r) => `<tr>${r.map((cell) => `<td style="padding:6px 8px;font-size:12px;border-bottom:1px solid #f0eee7;vertical-align:top;">${cell}</td>`).join("")}</tr>`).join("");
  const noteHtml = note ? `<div style="font-size:11px;color:#64748b;margin-top:4px;">${note}</div>` : "";
  return `
<tr><td style="padding:6px 24px 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
<thead><tr>${th}</tr></thead><tbody>${tr}</tbody>
</table>${noteHtml}
</td></tr>`;
}

function emailScoreCards(cards) {
  return `
<tr><td style="padding:8px 24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${cards.map((c) => `<td style="padding:12px;background:#faf9f5;border:1px solid #d1dae6;border-radius:4px;vertical-align:top;text-align:center;">
<div style="font-size:20px;font-weight:700;color:${NAVY};">${c.value}</div>
<div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:0.4px;margin-top:2px;">${c.label}</div>
${c.delta ? `<div style="font-size:11px;color:${c.delta.startsWith("+") ? "#006515" : c.delta.startsWith("-") ? "#970000" : "#64748b"};margin-top:2px;">${c.delta}</div>` : ""}
</td>`).join("<td style=\"width:8px;\">&nbsp;</td>")}
</tr></table>
</td></tr>`;
}

function emailHeading(text) {
  return `
<tr><td style="padding:12px 24px 4px;font-size:13px;font-weight:600;color:${NAVY};text-transform:uppercase;letter-spacing:0.4px;">${text}</td></tr>`;
}

// ── Weekly EMAIL ───────────────────────────────────────────────────────────
export function formatEmailWeekly(rows, endDayISO, opts = {}) {
  const baseUrl = opts.baseUrl || "";
  const startISO = isoDay(daysAgo(new Date(endDayISO), 6));
  const weekRows = rows.filter((r) => {
    const d = isoDay(r.created_at);
    return d >= startISO && d <= endDayISO;
  });

  // Previous 7-day window for delta computation
  const prevStart = isoDay(daysAgo(new Date(endDayISO), 13));
  const prevEnd = isoDay(daysAgo(new Date(endDayISO), 7));
  const prevRows = rows.filter((r) => {
    const d = isoDay(r.created_at);
    return d >= prevStart && d <= prevEnd;
  });

  const s = scoreboard(weekRows);
  const sPrev = scoreboard(prevRows);
  const dbd = dayByDay(rows, endDayISO, 7);
  const rq = repeatQuestions(weekRows);
  const dg = declineGaps(weekRows);
  const mcd = mostCitedDocs(weekRows);
  const fb = feedbackSummary(weekRows);

  const docGapsCount = dg.length;
  const range = `${startISO} to ${endDayISO}`;
  const subject = `Sous Weekly - ${range} - ${s.questions} questions, ${docGapsCount} doc gaps surfaced`;

  const delta = (curr, prev) => {
    if (prev === 0 && curr === 0) return "";
    const diff = curr - prev;
    const sign = diff > 0 ? "+" : "";
    return `${sign}${diff} vs prior 7d`;
  };

  const scoreCards = [
    { value: String(s.questions), label: "questions", delta: delta(s.questions, sPrev.questions) },
    { value: String(s.unique_askers), label: "askers", delta: delta(s.unique_askers, sPrev.unique_askers) },
    { value: String(s.grounded), label: "grounded", delta: delta(s.grounded, sPrev.grounded) },
    { value: String(s.declined), label: "declined", delta: delta(s.declined, sPrev.declined) },
  ];

  const dbdRows = dbd.map((d) => [d.day, d.total, d.grounded, d.partial, d.declined, d.error]);

  const rqRows = rq.slice(0, 20).map((r) => [
    truncate(r.sample, 120),
    r.count,
    r.distinct_askers,
    isoDay(r.last_seen),
  ]);

  const dgRows = dg.slice(0, 20).map((g) => [
    truncate(g.sample, 120),
    g.count,
    g.askers.map((a) => truncate(a, 40)).join(", "),
    classifyDecline(g.sample),
  ]);

  const mcdRows = mcd.slice(0, 20).map((r) => [r.doc_id, r.count]);

  const html = emailHead(subject) +
    emailHeader(`Weekly digest - ${range}`) +
    emailScoreCards(scoreCards) +
    emailLegend() +
    emailHeading("Day-by-day volume") +
    emailTable(["Day", "Total", "Grounded", "Partial", "Declined", "Errors"], dbdRows) +
    emailHeading("Asked more than once") +
    emailTable(["Sample question", "Count", "Askers", "Last seen"], rqRows) +
    emailHeading("Doc gaps (declines grouped)") +
    emailTable(["Sample question", "Count", "Askers", "Heuristic"], dgRows,
      "Heuristic is keyword-based, not a judgment. Live-numbers wording suggests Phase F data-tool demand; other declines suggest a missing document.") +
    emailHeading("Most-cited documents") +
    emailTable(["Doc", "Cites"], mcdRows) +
    emailHeading("Feedback") +
    emailScoreCards([
      { value: String(fb.up), label: "up" },
      { value: String(fb.down), label: "down" },
      { value: `${fb.rated}/${fb.total}`, label: "rated / total" },
      { value: fmtPct(fb.pct_rated), label: "% rated" },
    ]) +
    emailFoot(baseUrl, "SLT-only. Content may include verbatim questions. Cost figures are estimates.");

  return { subject, html };
}

// ── Monthly EMAIL ──────────────────────────────────────────────────────────
export function formatEmailMonthly(rows, endDayISO, opts = {}) {
  const baseUrl = opts.baseUrl || "";
  const startISO = isoDay(daysAgo(new Date(endDayISO), 29));
  const monthRows = rows.filter((r) => {
    const d = isoDay(r.created_at);
    return d >= startISO && d <= endDayISO;
  });

  const s = scoreboard(monthRows);
  const adopt = adoptionByWeek(rows, endDayISO);
  const bpu = byPersonUsage(monthRows);
  const perf = monthPerf(monthRows);
  const demand = unansweredDemand(monthRows);

  const range = `${startISO} to ${endDayISO}`;
  const subject = `Sous Monthly - ${range} - ${s.questions} questions, ${demand.length} distinct unanswered`;

  const adoptRows = adopt.map((w) => [
    `${w.week_start} - ${w.week_end}`,
    w.questions,
    w.distinct_askers,
    fmtPct(w.pct_grounded),
    fmtPct(w.pct_declined),
  ]);

  const bpuRows = bpu.slice(0, 30).map((p) => [
    truncate(p.email, 60),
    p.questions,
    p.grounded,
    p.declined,
    isoDay(p.last_seen),
  ]);

  const demandRows = demand.slice(0, 50).map((d) => [
    truncate(d.sample, 120),
    d.count,
    isoDay(d.first_seen),
    isoDay(d.last_seen),
  ]);

  const html = emailHead(subject) +
    emailHeader(`Monthly digest - ${range}`) +
    emailScoreCards([
      { value: String(s.questions), label: "questions" },
      { value: String(s.unique_askers), label: "askers" },
      { value: fmtUsd(perf.est_cost), label: "est. cost" },
      { value: fmtSeconds(perf.avg_seconds), label: "avg (est.)" },
      { value: fmtSeconds(perf.worst_seconds), label: "worst (est.)" },
    ]) +
    emailLegend() +
    emailHeading("Adoption by week") +
    emailTable(["Week", "Questions", "Askers", "% grounded", "% declined"], adoptRows) +
    emailHeading("Usage by person") +
    emailTable(["Person", "Questions", "Grounded", "Declined", "Last seen"], bpuRows) +
    emailHeading("Unanswered demand (ranked)") +
    emailTable(["Sample question", "Times asked", "First seen", "Last seen"], demandRows) +
    emailFoot(baseUrl, "SLT-only. Content may include verbatim questions. Cost figures are estimates.");

  return { subject, html };
}

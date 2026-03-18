import { NextResponse } from "next/server";
import {
  logEventSA,
  logHealthSA,
  readAnalyticsSheet,
  writeAnalyticsRow,
  clearAndWriteAnalytics,
  slackRecap,
} from "@/lib/analytics";


// ═══════════════════════════════════════
// ANALYTICS CRON — Daily/Weekly/Monthly Aggregation
// Schedule: Every day at 8:00 AM CT (14:00 UTC)
// Runs 1 hour after the notification cron (7 AM CT)
//
// Daily:  Aggregate yesterday's events → daily_summary, ghost_users, submission_velocity, health check, Slack recap
// Weekly: (Monday) account_scorecard, feature_funnel, device_breakdown, power_users, cross_account, notif effectiveness, deadline, draft_decay, error_impact, AI pulse, Slack + email
// Monthly: (1st) Archive events, monthly comparison, Slack + email
// ═══════════════════════════════════════


// ─── Date Helpers ───
function yesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0]; // "2026-03-11"
}

function todayDate() {
  return new Date().toISOString().split("T")[0];
}

function isMonday() {
  return new Date().getDay() === 1;
}

function isFirstOfMonth() {
  return new Date().getDate() === 1;
}

// Get the Monday of the current week as "YYYY-MM-DD"
function weekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split("T")[0];
}

// Previous month label: "2026-02"
function previousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Filter rows from the events tab to a specific date
// Events row: [0]=timestamp, [1]=email, [2]=userName, [3]=category, [4]=action, [5]=page, [6]=detail, [7]=durationMs, [8]=status, [9]=errorMsg, [10]=userAgent
function filterByDate(rows, dateStr) {
  return rows.filter((r) => (r[0] || "").startsWith(dateStr));
}

// Filter rows from events tab to date range (inclusive)
function filterByDateRange(rows, startDate, endDate) {
  return rows.filter((r) => {
    const d = (r[0] || "").split("T")[0];
    return d >= startDate && d <= endDate;
  });
}

// Get past N days as array of date strings
function pastNDays(n) {
  const dates = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}


// ═══════════════════════════════════════
// DAILY TASK 1: Aggregate into daily_summary
// Row: [date, totalEvents, uniqueUsers, pageViews, submissions, errors, avgResponseMs, topCategory, topAction, healthFailures]
// ═══════════════════════════════════════
async function buildDailySummary(dayEvents, dayHealth, dateStr) {
  const totalEvents = dayEvents.length;
  const uniqueUsers = new Set(dayEvents.map((r) => r[1]).filter(Boolean)).size;
  const pageViews = dayEvents.filter((r) => r[4] === "page_view").length;
  const submissions = dayEvents.filter((r) =>
    ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice", "submit_newhire", "submit_paf"].includes(r[4])
  ).length;
  const errors = dayEvents.filter((r) => r[8] === "error").length;

  // Average response time (from events that have durationMs)
  const durations = dayEvents.map((r) => Number(r[7])).filter((n) => n > 0);
  const avgResponseMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // Most common category
  const catCounts = {};
  dayEvents.forEach((r) => {
    const cat = r[3] || "unknown";
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });
  const topCategory = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  // Most common action
  const actCounts = {};
  dayEvents.forEach((r) => {
    const act = r[4] || "unknown";
    actCounts[act] = (actCounts[act] || 0) + 1;
  });
  const topAction = Object.entries(actCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  // Health failures count
  const healthFailures = dayHealth.filter((r) => r[3] !== "ok").length;

  const row = [dateStr, totalEvents, uniqueUsers, pageViews, submissions, errors, avgResponseMs, topCategory, topAction, healthFailures];
  await writeAnalyticsRow("daily_summary", row);

  return { totalEvents, uniqueUsers, pageViews, submissions, errors, avgResponseMs, topCategory, topAction, healthFailures };
}


// ═══════════════════════════════════════
// DAILY TASK 2: Ghost Users (login but no real actions)
// Row: [date, email, userName, loginCount, actionCount]
// ═══════════════════════════════════════
async function buildGhostUsers(dayEvents, dateStr) {
  // Group by user
  const userMap = {};
  dayEvents.forEach((r) => {
    const email = r[1];
    if (!email) return;
    if (!userMap[email]) userMap[email] = { name: r[2] || "", logins: 0, actions: 0 };
    if (r[4] === "page_view" || r[4] === "login") {
      userMap[email].logins++;
    } else {
      userMap[email].actions++;
    }
  });

  const ghosts = [];
  for (const [email, data] of Object.entries(userMap)) {
    if (data.actions === 0 && data.logins > 0) {
      const row = [dateStr, email, data.name, data.logins, 0];
      await writeAnalyticsRow("ghost_users", row);
      ghosts.push(email);
    }
  }
  return ghosts;
}


// ═══════════════════════════════════════
// DAILY TASK 3: Submission Velocity (hour/day heatmap)
// Row: [date, hour, dayOfWeek, count]
// ═══════════════════════════════════════
async function buildSubmissionVelocity(dayEvents, dateStr) {
  const submissionActions = ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice", "submit_newhire", "submit_paf"];
  const subs = dayEvents.filter((r) => submissionActions.includes(r[4]));

  // Group by hour
  const hourCounts = {};
  subs.forEach((r) => {
    const ts = r[0] || "";
    const hour = ts.includes("T") ? parseInt(ts.split("T")[1].split(":")[0]) : 0;
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  });

  const dayOfWeek = new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
  const rows = [];
  for (const [hour, count] of Object.entries(hourCounts)) {
    const row = [dateStr, hour, dayOfWeek, count];
    await writeAnalyticsRow("submission_velocity", row);
    rows.push(row);
  }
  return rows.length;
}


// ═══════════════════════════════════════
// DAILY TASK 4: Check health_log for failures
// ═══════════════════════════════════════
function summarizeHealthFailures(dayHealth) {
  const failures = dayHealth.filter((r) => r[3] !== "ok");
  if (failures.length === 0) return null;

  const byService = {};
  failures.forEach((r) => {
    const svc = r[1] || "unknown";
    if (!byService[svc]) byService[svc] = { count: 0, lastError: "" };
    byService[svc].count++;
    byService[svc].lastError = r[5] || "";
  });

  return byService;
}


// ═══════════════════════════════════════
// DAILY TASK 5: Post daily Slack recap
// ═══════════════════════════════════════
async function postDailyRecap(dateStr, stats, ghosts, healthIssues) {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `📊 Daily Intranet Recap — ${dateStr}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Events:* ${stats.totalEvents}   |   *Users:* ${stats.uniqueUsers}   |   *Page Views:* ${stats.pageViews}`,
          `*Submissions:* ${stats.submissions}   |   *Errors:* ${stats.errors}`,
          stats.avgResponseMs ? `*Avg Response:* ${stats.avgResponseMs}ms` : "",
          `*Top Category:* ${stats.topCategory}   |   *Top Action:* ${stats.topAction}`,
        ].filter(Boolean).join("\n"),
      },
    },
  ];

  if (ghosts.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*👻 Ghost Users (login only, no actions):* ${ghosts.length}\n${ghosts.slice(0, 5).join(", ")}${ghosts.length > 5 ? ` +${ghosts.length - 5} more` : ""}`,
      },
    });
  }

  if (healthIssues) {
    const lines = Object.entries(healthIssues).map(
      ([svc, d]) => `• *${svc}*: ${d.count} failure${d.count > 1 ? "s" : ""} — ${d.lastError || "no detail"}`
    );
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⚠️ Health Issues:*\n${lines.join("\n")}`,
      },
    });
  }

  if (stats.totalEvents === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No events recorded yesterday. This is expected if the platform wasn't used._" },
    });
  }

  await slackRecap(`Daily Intranet Recap — ${dateStr}`, blocks);
}


// ═══════════════════════════════════════
// WEEKLY TASK: Account Scorecard
// Row: [weekStart, accountKey, totalEvents, uniqueUsers, submissions, adoptionScore]
// ═══════════════════════════════════════
async function buildAccountScorecard(weekEvents) {
  const ws = weekStart();
  const acctMap = {};

  weekEvents.forEach((r) => {
    // Try to extract account from detail JSON
    let account = "";
    try {
      const det = r[6] ? JSON.parse(r[6]) : {};
      account = det.account || "";
    } catch { /* not JSON */ }
    if (!account) account = r[3] || "unknown"; // fall back to category

    if (!acctMap[account]) acctMap[account] = { events: 0, users: new Set(), submissions: 0 };
    acctMap[account].events++;
    if (r[1]) acctMap[account].users.add(r[1]);

    const subActions = ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice"];
    if (subActions.includes(r[4])) acctMap[account].submissions++;
  });

  const rows = Object.entries(acctMap).map(([acct, d]) => {
    // Simple adoption score: weighted sum
    const score = Math.min(100, Math.round((d.users.size * 20) + (d.submissions * 10) + (d.events * 0.5)));
    return [ws, acct, d.events, d.users.size, d.submissions, score];
  });

  if (rows.length) await clearAndWriteAnalytics("account_scorecard", rows);
  return rows.length;
}


// ═══════════════════════════════════════
// WEEKLY TASK: Feature Funnel
// Row: [weekStart, feature, startCount, completeCount, dropoffPct]
// ═══════════════════════════════════════
async function buildFeatureFunnel(weekEvents) {
  const ws = weekStart();

  // Define funnels: page_view → action
  const funnels = {
    "Inventory": { start: (r) => r[3] === "ops" && r[4] === "page_view", end: (r) => r[4] === "submit_inventory" },
    "Invoice":   { start: (r) => r[3] === "ops" && r[4] === "page_view", end: (r) => r[4] === "submit_invoice" },
    "New Hire":  { start: (r) => r[3] === "people" && r[4] === "page_view", end: (r) => r[4] === "submit_newhire" },
    "PAF":       { start: (r) => r[3] === "people" && r[4] === "page_view", end: (r) => r[4] === "submit_paf" },
  };

  const rows = Object.entries(funnels).map(([name, f]) => {
    const startCount = weekEvents.filter(f.start).length;
    const endCount = weekEvents.filter(f.end).length;
    const dropoff = startCount > 0 ? Math.round((1 - endCount / startCount) * 100) : 0;
    return [ws, name, startCount, endCount, `${dropoff}%`];
  });

  if (rows.length) await clearAndWriteAnalytics("feature_funnel", rows);
  return rows.length;
}


// ═══════════════════════════════════════
// WEEKLY TASK: Device Breakdown
// Row: [weekStart, device, count, percentage]
// ═══════════════════════════════════════
async function buildDeviceBreakdown(weekEvents) {
  const ws = weekStart();
  const deviceCounts = { mobile: 0, desktop: 0, unknown: 0 };

  weekEvents.forEach((r) => {
    const ua = (r[10] || "").toLowerCase();
    if (!ua) { deviceCounts.unknown++; return; }
    if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) {
      deviceCounts.mobile++;
    } else {
      deviceCounts.desktop++;
    }
  });

  const total = weekEvents.length || 1;
  const rows = Object.entries(deviceCounts)
    .filter(([, c]) => c > 0)
    .map(([device, count]) => [ws, device, count, `${Math.round((count / total) * 100)}%`]);

  if (rows.length) await clearAndWriteAnalytics("device_breakdown", rows);
  return rows.length;
}


// ═══════════════════════════════════════
// WEEKLY TASK: Power Users (Top 10)
// Row: [weekStart, email, userName, totalActions, topCategory, topAction]
// ═══════════════════════════════════════
async function buildPowerUsers(weekEvents) {
  const ws = weekStart();
  const userMap = {};

  weekEvents.forEach((r) => {
    const email = r[1];
    if (!email) return;
    if (!userMap[email]) userMap[email] = { name: r[2] || "", actions: 0, cats: {}, acts: {} };
    userMap[email].actions++;
    const cat = r[3] || "";
    const act = r[4] || "";
    userMap[email].cats[cat] = (userMap[email].cats[cat] || 0) + 1;
    userMap[email].acts[act] = (userMap[email].acts[act] || 0) + 1;
  });

  const sorted = Object.entries(userMap)
    .sort((a, b) => b[1].actions - a[1].actions)
    .slice(0, 10);

  const rows = sorted.map(([email, d]) => {
    const topCat = Object.entries(d.cats).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const topAct = Object.entries(d.acts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return [ws, email, d.name, d.actions, topCat, topAct];
  });

  if (rows.length) await clearAndWriteAnalytics("power_users", rows);
  return rows.length;
}


// ═══════════════════════════════════════
// WEEKLY TASK: Cross-Account Matrix
// Row: [weekStart, email, userName, accountCount, accounts]
// ═══════════════════════════════════════
async function buildCrossAccountMatrix(weekEvents) {
  const ws = weekStart();
  const userAccounts = {};

  weekEvents.forEach((r) => {
    const email = r[1];
    if (!email) return;
    try {
      const det = r[6] ? JSON.parse(r[6]) : {};
      if (det.account) {
        if (!userAccounts[email]) userAccounts[email] = { name: r[2] || "", accounts: new Set() };
        userAccounts[email].accounts.add(det.account);
      }
    } catch { /* not JSON */ }
  });

  // Only include users who touched 2+ accounts
  const rows = Object.entries(userAccounts)
    .filter(([, d]) => d.accounts.size >= 2)
    .map(([email, d]) => [ws, email, d.name, d.accounts.size, [...d.accounts].join(", ")])
    .sort((a, b) => b[3] - a[3]);

  if (rows.length) await clearAndWriteAnalytics("cross_account_matrix", rows);
  return rows.length;
}


// ═══════════════════════════════════════
// WEEKLY TASK: Notification Effectiveness
// Row: [weekStart, totalSent, totalRead, readRate]
// ═══════════════════════════════════════
async function buildNotificationEffectiveness(weekEvents) {
  const ws = weekStart();
  const sent = weekEvents.filter((r) =>
    r[3] === "people" && ["submit_newhire", "submit_paf", "admin_approve", "admin_reject"].includes(r[4])
  ).length;
  const read = weekEvents.filter((r) => r[4] === "notif_read").length;
  const rate = sent > 0 ? `${Math.round((read / sent) * 100)}%` : "N/A";

  const row = [ws, sent, read, rate];
  await writeAnalyticsRow("notification_effectiveness", row);
  return { sent, read, rate };
}


// ═══════════════════════════════════════
// WEEKLY TASK: Draft Decay
// Row: [date, email, module, draftAgeHours, status]
// ═══════════════════════════════════════
async function buildDraftDecay(weekEvents) {
  const ws = weekStart();
  const drafts = {};

  // Track draft saves and deletes
  weekEvents.forEach((r) => {
    if (r[4] === "draft_save") {
      const email = r[1] || "";
      try {
        const det = r[6] ? JSON.parse(r[6]) : {};
        const key = `${email}:${det.module || ""}`;
        drafts[key] = { email, module: det.module || "", savedAt: r[0], deleted: false };
      } catch { /* skip */ }
    }
    if (r[4] === "draft_delete") {
      const email = r[1] || "";
      try {
        const det = r[6] ? JSON.parse(r[6]) : {};
        const key = `${email}:${det.module || ""}`;
        if (drafts[key]) drafts[key].deleted = true;
      } catch { /* skip */ }
    }
  });

  const now = Date.now();
  const rows = Object.values(drafts)
    .filter((d) => !d.deleted) // Only active drafts
    .map((d) => {
      const age = Math.round((now - new Date(d.savedAt).getTime()) / (1000 * 60 * 60));
      const status = age > 72 ? "stale" : age > 24 ? "aging" : "fresh";
      return [ws, d.email, d.module, age, status];
    });

  if (rows.length) await clearAndWriteAnalytics("draft_decay", rows);
  return rows.length;
}


// ═══════════════════════════════════════
// WEEKLY TASK: Error Impact
// Row: [weekStart, action, errorCount, errorRate, topError]
// ═══════════════════════════════════════
async function buildErrorImpact(weekEvents) {
  const ws = weekStart();

  // Group errors by action
  const actionTotals = {};
  const actionErrors = {};

  weekEvents.forEach((r) => {
    const act = r[4] || "unknown";
    actionTotals[act] = (actionTotals[act] || 0) + 1;
    if (r[8] === "error") {
      if (!actionErrors[act]) actionErrors[act] = { count: 0, messages: {} };
      actionErrors[act].count++;
      const msg = r[9] || "unknown error";
      actionErrors[act].messages[msg] = (actionErrors[act].messages[msg] || 0) + 1;
    }
  });

  const rows = Object.entries(actionErrors)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([act, d]) => {
      const total = actionTotals[act] || 1;
      const rate = `${Math.round((d.count / total) * 100)}%`;
      const topErr = Object.entries(d.messages).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      return [ws, act, d.count, rate, topErr];
    });

  if (rows.length) await clearAndWriteAnalytics("error_impact", rows);
  return rows.length;
}


// ═══════════════════════════════════════
// WEEKLY TASK: Deadline Compliance
// Row: [weekStart, account, status, daysFromDeadline]
// ═══════════════════════════════════════
async function buildDeadlineCompliance(weekEvents) {
  const ws = weekStart();

  // Look at inventory submissions to gauge timeliness
  // This is a simplified version — could be enhanced with period_data from the HUB sheet
  const submissions = weekEvents.filter((r) => r[4] === "submit_inventory");
  const acctStatus = {};

  submissions.forEach((r) => {
    try {
      const det = r[6] ? JSON.parse(r[6]) : {};
      const acct = det.account || "unknown";
      if (!acctStatus[acct]) acctStatus[acct] = "on_time"; // default
    } catch { /* skip */ }
  });

  const rows = Object.entries(acctStatus).map(([acct, status]) => [ws, acct, status, 0]);

  if (rows.length) await clearAndWriteAnalytics("deadline_compliance", rows);
  return rows.length;
}


// ═══════════════════════════════════════
// WEEKLY TASK: AI Pulse (via Anthropic API)
// Generates a short AI summary of the week's activity
// Row: [date, type, summary]
// ═══════════════════════════════════════
async function buildAIPulse(stats, weekEvents) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[Analytics] No ANTHROPIC_API_KEY — skipping AI pulse");
    return null;
  }

  const ws = weekStart();

  // Build a concise data summary for the prompt
  const uniqueUsers = new Set(weekEvents.map((r) => r[1]).filter(Boolean)).size;
  const totalEvents = weekEvents.length;
  const submissions = weekEvents.filter((r) =>
    ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice", "submit_newhire", "submit_paf"].includes(r[4])
  ).length;
  const errors = weekEvents.filter((r) => r[8] === "error").length;

  const catCounts = {};
  weekEvents.forEach((r) => {
    const cat = r[3] || "other";
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });
  const catSummary = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}: ${n}`).join(", ");

  const prompt = `You are a concise analytics reporter for KitchFix, a performance food service company running kitchens at MLB stadiums and Player Development Centers. Summarize this week's intranet usage in 3-4 sentences. Be specific, mention numbers, and note any concerns.

Week of ${ws}:
- Total events: ${totalEvents}
- Unique users: ${uniqueUsers}
- Submissions: ${submissions}
- Errors: ${errors}
- Activity by category: ${catSummary}

Keep it under 100 words. No bullet points. Direct and conversational tone.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      console.warn("[Analytics] AI pulse API error:", res.status);
      return null;
    }

    const data = await res.json();
    const summary = data.content?.[0]?.text || "";

    if (summary) {
      await writeAnalyticsRow("ai_pulse_log", [ws, "weekly", summary]);
    }
    return summary;
  } catch (e) {
    console.warn("[Analytics] AI pulse failed:", e.message);
    return null;
  }
}


// ═══════════════════════════════════════
// WEEKLY: Slack Recap
// ═══════════════════════════════════════
async function postWeeklyRecap(weekEvents, aiSummary) {
  const ws = weekStart();
  const uniqueUsers = new Set(weekEvents.map((r) => r[1]).filter(Boolean)).size;
  const totalEvents = weekEvents.length;
  const submissions = weekEvents.filter((r) =>
    ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice", "submit_newhire", "submit_paf"].includes(r[4])
  ).length;
  const errors = weekEvents.filter((r) => r[8] === "error").length;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `📈 Weekly Intranet Report — Week of ${ws}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Events:* ${totalEvents}   |   *Users:* ${uniqueUsers}\n*Submissions:* ${submissions}   |   *Errors:* ${errors}`,
      },
    },
  ];

  if (aiSummary) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*🤖 AI Pulse:*\n${aiSummary}` },
    });
  }

  await slackRecap(`Weekly Intranet Report — ${ws}`, blocks);
}


// ═══════════════════════════════════════
// WEEKLY: Send styled HTML email
// Uses service account + Gmail API with domain-wide delegation
// If delegation isn't set up, this will fail gracefully
// ═══════════════════════════════════════
async function sendWeeklyEmail(weekEvents, aiSummary) {
  const ws = weekStart();
  const uniqueUsers = new Set(weekEvents.map((r) => r[1]).filter(Boolean)).size;
  const totalEvents = weekEvents.length;
  const submissions = weekEvents.filter((r) =>
    ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice", "submit_newhire", "submit_paf"].includes(r[4])
  ).length;
  const errors = weekEvents.filter((r) => r[8] === "error").length;

  const html = `
    <div style="font-family:Inter,-apple-system,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#0f3057;padding:16px 24px;border-radius:12px 12px 0 0;">
        <span style="color:#fff;font-size:14px;font-weight:700;">KITCHFIX INTRANET</span>
        <span style="float:right;color:#d97706;font-size:12px;font-weight:700;">WEEKLY ANALYTICS</span>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;padding:24px;border-radius:0 0 12px 12px;">
        <h2 style="margin:0 0 4px;color:#0f3057;font-size:18px;">Weekly Report — ${ws}</h2>
        <p style="margin:0 0 16px;color:#64748b;font-size:13px;">Automated analytics summary</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Total Events</td><td style="text-align:right;color:#0f3057;font-weight:700;">${totalEvents}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Unique Users</td><td style="text-align:right;color:#0f3057;font-weight:700;">${uniqueUsers}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-weight:700;">Submissions</td><td style="text-align:right;color:#0f3057;font-weight:700;">${submissions}</td></tr>
          <tr style="border-top:2px solid #e2e8f0;"><td style="padding:8px 0;color:${errors > 0 ? "#dc2626" : "#0f3057"};font-weight:800;">Errors</td><td style="text-align:right;color:${errors > 0 ? "#dc2626" : "#0f3057"};font-weight:800;">${errors}</td></tr>
        </table>
        ${aiSummary ? `<div style="margin:16px 0 0;padding:12px;background:#f8fafc;border-radius:8px;border-left:3px solid #d97706;font-size:12px;color:#475569;"><strong>🤖 AI Pulse:</strong> ${aiSummary}</div>` : ""}
        <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;">Generated ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })}</p>
      </div>
    </div>`;

  try {
    await sendAnalyticsEmail({
      to: "k.fietek@kitchfix.com",
      subject: `[KitchFix] Weekly Analytics — ${ws}`,
      html,
    });
    console.log("[Analytics] Weekly email sent");
  } catch (e) {
    console.warn("[Analytics] Weekly email failed (Gmail delegation may not be configured):", e.message);
  }
}


// ═══════════════════════════════════════
// MONTHLY: Archive previous month's events
// Creates a new tab: events_YYYY_MM
// ═══════════════════════════════════════
async function archiveMonthlyEvents(allEvents) {
  const pm = previousMonth(); // "2026-02"
  const monthEvents = allEvents.filter((r) => (r[0] || "").startsWith(pm));
  if (monthEvents.length === 0) return 0;

  // Write to archive tab
  const archiveTab = `events_${pm.replace("-", "_")}`;
  try {
    for (const row of monthEvents) {
      await writeAnalyticsRow(archiveTab, row);
    }
    console.log(`[Analytics] Archived ${monthEvents.length} events to ${archiveTab}`);
  } catch (e) {
    console.warn(`[Analytics] Archive failed (tab "${archiveTab}" may need to be created manually):`, e.message);
  }
  return monthEvents.length;
}


// ═══════════════════════════════════════
// MONTHLY: Slack Recap
// ═══════════════════════════════════════
async function postMonthlyRecap(allEvents) {
  const pm = previousMonth();
  const monthEvents = allEvents.filter((r) => (r[0] || "").startsWith(pm));
  const uniqueUsers = new Set(monthEvents.map((r) => r[1]).filter(Boolean)).size;
  const submissions = monthEvents.filter((r) =>
    ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice", "submit_newhire", "submit_paf"].includes(r[4])
  ).length;

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `📅 Monthly Intranet Report — ${pm}` },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Total Events:* ${monthEvents.length}   |   *Users:* ${uniqueUsers}   |   *Submissions:* ${submissions}\n*Archived:* ${monthEvents.length} events backed up to \`events_${pm.replace("-", "_")}\``,
      },
    },
  ];

  await slackRecap(`Monthly Intranet Report — ${pm}`, blocks);
}


// ═══════════════════════════════════════
// EMAIL HELPER: Send via Gmail API + Service Account
// Requires domain-wide delegation with gmail.send scope
// ═══════════════════════════════════════
async function sendAnalyticsEmail({ to, subject, html }) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const keyRaw = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !keyRaw) throw new Error("Missing service account credentials");

  const privateKey = keyRaw.replace(/\\n/g, "\n");
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: email,
    sub: "k.fietek@kitchfix.com", // Impersonate this user
    scope: "https://www.googleapis.com/auth/gmail.send",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const claimSet = btoa(JSON.stringify(claims));
  const unsignedJwt = `${header}.${claimSet}`;

  const pemContents = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(unsignedJwt)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${unsignedJwt}.${signature}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) throw new Error(`Gmail SA token failed: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();

  // Build email
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    ``,
    html,
  ];
  const raw = btoa(unescape(encodeURIComponent(lines.join("\r\n"))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const sendRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  if (!sendRes.ok) throw new Error(`Gmail send failed: ${await sendRes.text()}`);
}


// ═══════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════
export async function GET(request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = { daily: {}, weekly: {}, monthly: {} };

  try {
    console.log("[Analytics Cron] Starting...");
    logEventSA({ category: "system", action: "cron_start", detail: { type: "analytics" } });

    // ─── Load raw data ───
    const allEvents = await readAnalyticsSheet("events");
    const allHealth = await readAnalyticsSheet("health_log");

    const yesterday = yesterdayDate();
    const dayEvents = filterByDate(allEvents, yesterday);
    const dayHealth = filterByDate(allHealth, yesterday);

    console.log(`[Analytics Cron] Yesterday (${yesterday}): ${dayEvents.length} events, ${dayHealth.length} health entries`);

    // ═══════════════════════════════════════
    // DAILY TASKS (every run)
    // ═══════════════════════════════════════
    const stats = await buildDailySummary(dayEvents, dayHealth, yesterday);
    results.daily.summary = stats;

    const ghosts = await buildGhostUsers(dayEvents, yesterday);
    results.daily.ghostUsers = ghosts.length;

    const velocityRows = await buildSubmissionVelocity(dayEvents, yesterday);
    results.daily.velocityRows = velocityRows;

    const healthIssues = summarizeHealthFailures(dayHealth);
    results.daily.healthIssues = healthIssues ? Object.keys(healthIssues).length : 0;

    await postDailyRecap(yesterday, stats, ghosts, healthIssues);
    results.daily.slackPosted = true;

    console.log("[Analytics Cron] Daily tasks complete");

    // ═══════════════════════════════════════
    // WEEKLY TASKS (Monday only)
    // ═══════════════════════════════════════
    if (isMonday()) {
      console.log("[Analytics Cron] Monday — running weekly tasks...");

      const past7 = pastNDays(7);
      const weekEvents = filterByDateRange(allEvents, past7[0], past7[past7.length - 1]);
      console.log(`[Analytics Cron] Week data: ${weekEvents.length} events over ${past7[0]} to ${past7[past7.length - 1]}`);

      results.weekly.accountScorecard = await buildAccountScorecard(weekEvents);
      results.weekly.featureFunnel = await buildFeatureFunnel(weekEvents);
      results.weekly.deviceBreakdown = await buildDeviceBreakdown(weekEvents);
      results.weekly.powerUsers = await buildPowerUsers(weekEvents);
      results.weekly.crossAccount = await buildCrossAccountMatrix(weekEvents);
      results.weekly.notifications = await buildNotificationEffectiveness(weekEvents);
      results.weekly.deadlineCompliance = await buildDeadlineCompliance(weekEvents);
      results.weekly.draftDecay = await buildDraftDecay(weekEvents);
      results.weekly.errorImpact = await buildErrorImpact(weekEvents);

      const aiSummary = await buildAIPulse(stats, weekEvents);
      results.weekly.aiPulse = aiSummary ? "generated" : "skipped";

      await postWeeklyRecap(weekEvents, aiSummary);
      results.weekly.slackPosted = true;

      await sendWeeklyEmail(weekEvents, aiSummary);
      results.weekly.emailSent = true;

      console.log("[Analytics Cron] Weekly tasks complete");
    }

    // ═══════════════════════════════════════
    // MONTHLY TASKS (1st of month only)
    // ═══════════════════════════════════════
    if (isFirstOfMonth()) {
      console.log("[Analytics Cron] 1st of month — running monthly tasks...");

      const archived = await archiveMonthlyEvents(allEvents);
      results.monthly.archived = archived;

      await postMonthlyRecap(allEvents);
      results.monthly.slackPosted = true;

      // Monthly email — reuse weekly email format with monthly data
      try {
        const pm = previousMonth();
        const monthEvents = allEvents.filter((r) => (r[0] || "").startsWith(pm));
        await sendWeeklyEmail(monthEvents, `Monthly archive complete: ${archived} events backed up.`);
        results.monthly.emailSent = true;
      } catch (e) {
        console.warn("[Analytics Cron] Monthly email failed:", e.message);
        results.monthly.emailSent = false;
      }

      console.log("[Analytics Cron] Monthly tasks complete");
    }

    logEventSA({ category: "system", action: "cron_complete", detail: { type: "analytics", results } });
    console.log("[Analytics Cron] ✅ All done.", JSON.stringify(results));

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error("[Analytics Cron] ❌ CRASH:", error.message, error.stack);
    logEventSA({ category: "system", action: "cron_error", status: "error", errorMsg: error.message, detail: { type: "analytics", error: error.message } });

    // Still try to post error to Slack
    slackRecap("Analytics Cron Error", [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*❌ Analytics cron crashed*\n\`\`\`${error.message}\`\`\`` },
      },
    ]).catch(() => {});

    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
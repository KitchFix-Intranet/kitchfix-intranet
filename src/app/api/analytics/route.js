import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { readAnalyticsSheet } from "@/lib/analytics";

// ═══════════════════════════════════════
// ANALYTICS API — Admin-only dashboard data
// Single action: bootstrap (returns all tabs for the selected range)
// Auth: OAuth session, gated to ADMIN_EMAILS
// ═══════════════════════════════════════

const ADMIN_EMAILS = ["k.fietek@kitchfix.com"];

// ─── Date helpers ───
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function filterByDateRange(rows, startDate, endDate) {
  return rows.filter((r) => {
    const d = (r[0] || "").split("T")[0];
    return d >= startDate && d <= endDate;
  });
}

// ─── Aggregation helpers ───
function computeDailyTrend(events, days) {
  const map = {};
  days.forEach((d) => (map[d] = { events: 0, submissions: 0 }));
  const subActions = ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice", "submit_newhire", "submit_paf"];
  events.forEach((r) => {
    const d = (r[0] || "").split("T")[0];
    if (map[d]) {
      map[d].events++;
      if (subActions.includes(r[4])) map[d].submissions++;
    }
  });
  return days.map((d) => ({ date: d, events: map[d].events, submissions: map[d].submissions }));
}

function computeMetrics(events, healthRows) {
  const subActions = ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice", "submit_newhire", "submit_paf"];
  const totalEvents = events.length;
  const uniqueUsers = new Set(events.map((r) => r[1]).filter(Boolean)).size;
  const pageViews = events.filter((r) => r[4] === "page_view").length;
  const submissions = events.filter((r) => subActions.includes(r[4])).length;
  const errors = events.filter((r) => r[8] === "error").length;
  const errorRate = totalEvents > 0 ? ((errors / totalEvents) * 100).toFixed(1) : "0.0";

  // Submission breakdown
  const invCount = events.filter((r) => r[4] === "submit_inventory").length;
  const invoiceCount = events.filter((r) => r[4] === "submit_invoice").length;
  const hrCount = events.filter((r) => ["submit_newhire", "submit_paf"].includes(r[4])).length;

  // Health failures
  const healthFailures = healthRows.filter((r) => r[3] !== "ok");
  const topFailService = (() => {
    const svcCount = {};
    healthFailures.forEach((r) => { svcCount[r[1]] = (svcCount[r[1]] || 0) + 1; });
    return Object.entries(svcCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  })();

  return {
    totalEvents, uniqueUsers, pageViews, submissions, errors, errorRate,
    invCount, invoiceCount, hrCount,
    healthFailureCount: healthFailures.length, topFailService,
  };
}

function computeAccountScorecard(events) {
  const subActions = ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice"];
  const acctMap = {};
  events.forEach((r) => {
    let account = "";
    try { const det = r[6] ? JSON.parse(r[6]) : {}; account = det.account || ""; } catch {}
    if (!account) return;
    if (!acctMap[account]) acctMap[account] = { events: 0, users: new Set(), submissions: 0 };
    acctMap[account].events++;
    if (r[1]) acctMap[account].users.add(r[1]);
    if (subActions.includes(r[4])) acctMap[account].submissions++;
  });
  return Object.entries(acctMap)
    .map(([acct, d]) => ({
      account: acct,
      users: d.users.size,
      submissions: d.submissions,
      score: Math.min(100, Math.round((d.users.size * 20) + (d.submissions * 10) + (d.events * 0.5))),
    }))
    .sort((a, b) => b.score - a.score);
}

function computeFeatureFunnel(events) {
  const funnels = {
    Inventory: { start: (r) => r[3] === "ops" && r[4] === "page_view", end: (r) => r[4] === "submit_inventory" },
    Invoice: { start: (r) => r[3] === "ops" && r[4] === "page_view", end: (r) => r[4] === "submit_invoice" },
    "New hire": { start: (r) => r[3] === "people" && r[4] === "page_view", end: (r) => r[4] === "submit_newhire" },
    PAF: { start: (r) => r[3] === "people" && r[4] === "page_view", end: (r) => r[4] === "submit_paf" },
  };
  return Object.entries(funnels).map(([name, f]) => {
    const starts = events.filter(f.start).length;
    const ends = events.filter(f.end).length;
    const pct = starts > 0 ? Math.round((ends / starts) * 100) : 0;
    return { name, starts, ends, pct };
  });
}

function computePowerUsers(events) {
  const userMap = {};
  events.forEach((r) => {
    const email = r[1];
    if (!email) return;
    if (!userMap[email]) userMap[email] = { name: r[2] || email.split("@")[0], actions: 0, cats: {} };
    userMap[email].actions++;
    const cat = r[3] || "other";
    userMap[email].cats[cat] = (userMap[email].cats[cat] || 0) + 1;
  });
  return Object.entries(userMap)
    .sort((a, b) => b[1].actions - a[1].actions)
    .slice(0, 10)
    .map(([email, d]) => {
      const topCat = Object.entries(d.cats).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      return { email, name: d.name, actions: d.actions, topCategory: topCat };
    });
}

function computeGhostUsers(events) {
  const userMap = {};
  events.forEach((r) => {
    const email = r[1];
    if (!email) return;
    if (!userMap[email]) userMap[email] = { name: r[2] || "", logins: 0, actions: 0 };
    if (r[4] === "page_view" || r[4] === "login") userMap[email].logins++;
    else userMap[email].actions++;
  });
  return Object.entries(userMap)
    .filter(([, d]) => d.actions === 0 && d.logins > 0)
    .map(([email, d]) => ({ email, name: d.name, logins: d.logins }));
}

function computeDeviceBreakdown(events) {
  const counts = { mobile: 0, desktop: 0, unknown: 0 };
  events.forEach((r) => {
    const ua = (r[10] || "").toLowerCase();
    if (!ua) { counts.unknown++; return; }
    if (ua.includes("mobile") || ua.includes("iphone") || ua.includes("android")) counts.mobile++;
    else counts.desktop++;
  });
  const total = events.length || 1;
  return Object.entries(counts)
    .filter(([, c]) => c > 0)
    .map(([device, count]) => ({ device, count, pct: Math.round((count / total) * 100) }));
}

function computeErrorImpact(events) {
  const actionTotals = {};
  const actionErrors = {};
  events.forEach((r) => {
    const act = r[4] || "unknown";
    actionTotals[act] = (actionTotals[act] || 0) + 1;
    if (r[8] === "error") {
      if (!actionErrors[act]) actionErrors[act] = { count: 0, messages: {} };
      actionErrors[act].count++;
      const msg = r[9] || "unknown";
      actionErrors[act].messages[msg] = (actionErrors[act].messages[msg] || 0) + 1;
    }
  });
  return Object.entries(actionErrors)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([act, d]) => {
      const total = actionTotals[act] || 1;
      const topErr = Object.entries(d.messages).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      return { action: act, errors: d.count, rate: `${Math.round((d.count / total) * 100)}%`, topError: topErr };
    });
}

function computeVelocityHeatmap(events) {
  const subActions = ["submit_inventory", "labor_submit", "sold_revenue", "submit_invoice", "submit_newhire", "submit_paf"];
  const subs = events.filter((r) => subActions.includes(r[4]));
  // Build hour × day matrix
  const matrix = {};
  subs.forEach((r) => {
    const ts = r[0] || "";
    const hour = ts.includes("T") ? parseInt(ts.split("T")[1].split(":")[0]) : 0;
    const dayOfWeek = new Date(ts).getDay(); // 0=Sun
    const key = `${hour}:${dayOfWeek}`;
    matrix[key] = (matrix[key] || 0) + 1;
  });
  return matrix;
}


// ═══════════════════════════════════════
// GET HANDLER
// ═══════════════════════════════════════
export async function GET(request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const token = session.accessToken;
  if (!token) return NextResponse.json({ error: "No access token" }, { status: 400 });

  const email = session.user?.email?.toLowerCase().trim();
  if (!ADMIN_EMAILS.includes(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "bootstrap";
  const range = searchParams.get("range") || "7"; // "1", "7", "30"

  try {
    if (action === "bootstrap") {
      // Determine date range
      const rangeDays = parseInt(range) || 7;
      const startDate = daysAgo(rangeDays);
      const endDate = todayStr();

      // Generate list of dates in range
      const days = [];
      for (let i = rangeDays; i >= 0; i--) days.push(daysAgo(i));

      // Batch read analytics tabs
      const [allEvents, allHealth, aiPulseRows] = await Promise.all([
        readAnalyticsSheet("events"),
        readAnalyticsSheet("health_log"),
        readAnalyticsSheet("ai_pulse_log"),
      ]);

      // Filter to range
      const events = filterByDateRange(allEvents, startDate, endDate);
      const health = filterByDateRange(allHealth, startDate, endDate);

      // Previous period for comparison
      const prevStart = daysAgo(rangeDays * 2);
      const prevEnd = daysAgo(rangeDays + 1);
      const prevEvents = filterByDateRange(allEvents, prevStart, prevEnd);
      const prevMetrics = computeMetrics(prevEvents, []);

      // Compute all dashboard data
      const metrics = computeMetrics(events, health);
      const trend = computeDailyTrend(events, days);
      const scorecard = computeAccountScorecard(events);
      const funnel = computeFeatureFunnel(events);
      const powerUsers = computePowerUsers(events);
      const ghostUsers = computeGhostUsers(events);
      const devices = computeDeviceBreakdown(events);
      const errorImpact = computeErrorImpact(events);
      const heatmap = computeVelocityHeatmap(events);

      // Latest AI pulse
      const latestPulse = aiPulseRows.length > 0 ? aiPulseRows[aiPulseRows.length - 1] : null;
      const aiPulse = latestPulse ? {
        date: latestPulse[0] || "",
        type: latestPulse[1] || "",
        summary: latestPulse[2] || "",
      } : null;

      // Deltas vs previous period
      const deltas = {
        events: metrics.totalEvents - prevMetrics.totalEvents,
        eventsPct: prevMetrics.totalEvents > 0
          ? Math.round(((metrics.totalEvents - prevMetrics.totalEvents) / prevMetrics.totalEvents) * 100)
          : 0,
        users: metrics.uniqueUsers - prevMetrics.uniqueUsers,
        submissions: metrics.submissions - prevMetrics.submissions,
      };

      return NextResponse.json({
        success: true,
        range: rangeDays,
        startDate,
        endDate,
        metrics,
        deltas,
        trend,
        scorecard,
        funnel,
        powerUsers,
        ghostUsers,
        devices,
        errorImpact,
        heatmap,
        aiPulse,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Analytics API]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
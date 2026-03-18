// ═══════════════════════════════════════
// PEOPLE PORTAL — EMAIL REPORT GENERATOR
// Weekly (Mon 8am CT) + Monthly (1st 8am CT)
// Recipient: k.fietek@kitchfix.com
// ═══════════════════════════════════════

const REPORT_RECIPIENT = "k.fietek@kitchfix.com";

// ── Column indices (0-indexed, matches SUB in route.js) ──
const C = {
  TIMESTAMP: 0,
  SUBMITTER: 1,
  MODULE: 2,
  EMPLOYEE: 3,
  LOCATION: 4,
  ACTION_TYPE: 5,
  EFFECTIVE: 6,
  PAYLOAD: 7,
  STATUS: 8,
  NOTES: 9,
  ADMIN_ACTION: 10, // Column K — admin action timestamp (new)
};

// ═══════════════════════════════════════
// DATE RANGE HELPERS
// ═══════════════════════════════════════

function getWeeklyRange() {
  // Last Monday 00:00 CT → This Monday 00:00 CT
  const now = new Date();
  const ct = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const day = ct.getDay(); // 0=Sun, 1=Mon
  const thisMon = new Date(ct);
  thisMon.setDate(ct.getDate() - (day === 0 ? 6 : day - 1));
  thisMon.setHours(0, 0, 0, 0);

  const lastMon = new Date(thisMon);
  lastMon.setDate(thisMon.getDate() - 7);

  return {
    start: lastMon,
    end: thisMon,
    label: `${fmt(lastMon)} – ${fmt(new Date(thisMon.getTime() - 86400000))}`,
    periodType: "weekly",
  };
}

function getMonthlyRange() {
  const now = new Date();
  const ct = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const thisFirst = new Date(ct.getFullYear(), ct.getMonth(), 1);
  const lastFirst = new Date(ct.getFullYear(), ct.getMonth() - 1, 1);

  const monthNames = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];

  return {
    start: lastFirst,
    end: thisFirst,
    label: `${monthNames[lastFirst.getMonth()]} ${lastFirst.getFullYear()}`,
    periodType: "monthly",
  };
}

// Previous period for trend comparison
function getPriorRange(range) {
  const duration = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - duration),
    end: new Date(range.start.getTime()),
  };
}

function fmt(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function fmtShort(d) {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ═══════════════════════════════════════
// METRICS ENGINE
// ═══════════════════════════════════════

function parseRows(allRows) {
  return allRows.map((row, i) => {
    const ts = row[C.TIMESTAMP] ? new Date(row[C.TIMESTAMP]) : null;
    const adminTs = row[C.ADMIN_ACTION] ? new Date(row[C.ADMIN_ACTION]) : null;
    const notes = String(row[C.NOTES] || "");

    // Parse admin email from notes: [Complete by email] or [Rejected by email]
    let adminEmail = null;
    const adminMatch = notes.match(/\[(Complete|Rejected)\s+by\s+(.+?)\]/);
    if (adminMatch) adminEmail = adminMatch[2].trim();

    return {
      rowIndex: i + 2,
      timestamp: ts,
      submitter: String(row[C.SUBMITTER] || "").toLowerCase().trim(),
      module: String(row[C.MODULE] || ""),
      employee: String(row[C.EMPLOYEE] || ""),
      location: String(row[C.LOCATION] || ""),
      actionType: String(row[C.ACTION_TYPE] || ""),
      status: String(row[C.STATUS] || "Pending").trim(),
      notes,
      adminActionTime: adminTs,
      adminEmail,
      isResubmit: String(row[C.EMPLOYEE] || "").includes("[RESUBMITTED]") ||
                  notes.includes("[RESUBMITTED]") ||
                  (row[C.PAYLOAD] && String(row[C.PAYLOAD]).includes('"_isResubmit":true')),
    };
  });
}

function inRange(date, start, end) {
  return date && date >= start && date < end;
}

function computeMetrics(allParsed, range) {
  const { start, end } = range;
  const prior = getPriorRange(range);

  // Submissions created in this period
  const periodSubs = allParsed.filter(r => inRange(r.timestamp, start, end));
  const priorSubs = allParsed.filter(r => inRange(r.timestamp, prior.start, prior.end));

  // Admin actions taken in this period (by admin action timestamp)
  const periodActions = allParsed.filter(r => inRange(r.adminActionTime, start, end));
  const priorActions = allParsed.filter(r => inRange(r.adminActionTime, prior.start, prior.end));

  // ── 1. HEADCOUNT MOVEMENT ──
  const newHiresSub = periodSubs.filter(r => r.module === "newhire");
  const newHiresApproved = periodActions.filter(r => r.module === "newhire" && /Complete|Approved/i.test(r.status));
  const separationsSub = periodSubs.filter(r => r.actionType === "separation");
  const separationsApproved = periodActions.filter(r => r.actionType === "separation" && /Complete|Approved/i.test(r.status));

  const headcountByLocation = {};
  [...newHiresApproved].forEach(r => {
    const loc = r.location || "Unknown";
    if (!headcountByLocation[loc]) headcountByLocation[loc] = { hires: 0, seps: 0 };
    headcountByLocation[loc].hires++;
  });
  [...separationsApproved].forEach(r => {
    const loc = r.location || "Unknown";
    if (!headcountByLocation[loc]) headcountByLocation[loc] = { hires: 0, seps: 0 };
    headcountByLocation[loc].seps++;
  });

  const headcount = {
    newHiresSubmitted: newHiresSub.length,
    newHiresApproved: newHiresApproved.length,
    separationsSubmitted: separationsSub.length,
    separationsApproved: separationsApproved.length,
    netChange: newHiresApproved.length - separationsApproved.length,
    byLocation: headcountByLocation,
    priorNewHires: priorSubs.filter(r => r.module === "newhire").length,
    priorSeparations: priorSubs.filter(r => r.actionType === "separation").length,
  };

  // ── 2. PAF ACTIVITY ──
  const pafSubs = periodSubs.filter(r => r.module === "paf");
  const pafByType = {};
  const pafByLocation = {};
  pafSubs.forEach(r => {
    const type = r.actionType || "unknown";
    pafByType[type] = (pafByType[type] || 0) + 1;
    const loc = r.location || "Unknown";
    pafByLocation[loc] = (pafByLocation[loc] || 0) + 1;
  });

  const pafActivity = {
    total: pafSubs.length,
    byType: pafByType,
    byLocation: pafByLocation,
    priorTotal: priorSubs.filter(r => r.module === "paf").length,
  };

  // ── 3. PIPELINE HEALTH ──
  const pendingNow = allParsed.filter(r => /^Pending$/i.test(r.status));
  const reactionTimes = periodActions
    .filter(r => r.adminActionTime && r.timestamp)
    .map(r => (r.adminActionTime.getTime() - r.timestamp.getTime()) / (1000 * 60 * 60)); // hours

  const avgReaction = reactionTimes.length > 0
    ? reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length
    : null;

  let oldestPending = null;
  pendingNow.forEach(r => {
    if (r.timestamp && (!oldestPending || r.timestamp < oldestPending.timestamp)) {
      oldestPending = r;
    }
  });
  const stuckItems = pendingNow.filter(r => {
    if (!r.timestamp) return false;
    const ageDays = (Date.now() - r.timestamp.getTime()) / (1000 * 60 * 60 * 24);
    return ageDays > 3;
  });

  const pipeline = {
    pendingCount: pendingNow.length,
    avgReactionHours: avgReaction,
    oldestPending: oldestPending ? {
      employee: oldestPending.employee,
      ageDays: Math.floor((Date.now() - oldestPending.timestamp.getTime()) / (1000 * 60 * 60 * 24)),
    } : null,
    stuckCount: stuckItems.length,
  };

  // ── 4. REJECTION METRICS ──
  const rejectedInPeriod = periodActions.filter(r => /Rejected/i.test(r.status));
  const resubmittedInPeriod = periodSubs.filter(r => r.isResubmit);
  const totalProcessed = periodActions.length;
  const rejectionRate = totalProcessed > 0 ? rejectedInPeriod.length / totalProcessed : 0;

  const rejections = {
    total: rejectedInPeriod.length,
    resubmissions: resubmittedInPeriod.length,
    rate: rejectionRate,
    priorTotal: priorActions.filter(r => /Rejected/i.test(r.status)).length,
  };

  // ── 5. ADMIN PERFORMANCE ──
  const adminStats = {};
  periodActions.forEach(r => {
    if (!r.adminEmail) return;
    const email = r.adminEmail.toLowerCase();
    if (!adminStats[email]) {
      adminStats[email] = { processed: 0, approved: 0, rejected: 0, reactionTimes: [] };
    }
    adminStats[email].processed++;
    if (/Complete|Approved/i.test(r.status)) adminStats[email].approved++;
    if (/Rejected/i.test(r.status)) adminStats[email].rejected++;

    if (r.adminActionTime && r.timestamp) {
      const hours = (r.adminActionTime.getTime() - r.timestamp.getTime()) / (1000 * 60 * 60);
      adminStats[email].reactionTimes.push(hours);
    }
  });

  // Compute aggregates per admin
  const adminPerformance = Object.entries(adminStats).map(([email, stats]) => {
    const times = stats.reactionTimes;
    const avg = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : null;
    const fastest = times.length > 0 ? Math.min(...times) : null;
    const slowest = times.length > 0 ? Math.max(...times) : null;
    return {
      email,
      processed: stats.processed,
      approved: stats.approved,
      rejected: stats.rejected,
      avgReactionHours: avg,
      fastestHours: fastest,
      slowestHours: slowest,
    };
  }).sort((a, b) => b.processed - a.processed);

  // ── 6. USAGE METRICS ──
  const subsByUser = {};
  const subsByLocation = {};
  const subsByDay = {};
  periodSubs.forEach(r => {
    subsByUser[r.submitter] = (subsByUser[r.submitter] || 0) + 1;
    const loc = r.location || "Unknown";
    subsByLocation[loc] = (subsByLocation[loc] || 0) + 1;
    if (r.timestamp) {
      const dayKey = r.timestamp.toISOString().slice(0, 10);
      subsByDay[dayKey] = (subsByDay[dayKey] || 0) + 1;
    }
  });

  const busiestDay = Object.entries(subsByDay).sort((a, b) => b[1] - a[1])[0] || null;
  const moduleNewHire = periodSubs.filter(r => r.module === "newhire").length;
  const modulePAF = periodSubs.filter(r => r.module === "paf").length;

  const usage = {
    byUser: Object.entries(subsByUser).sort((a, b) => b[1] - a[1]),
    byLocation: Object.entries(subsByLocation).sort((a, b) => b[1] - a[1]),
    busiestDay: busiestDay ? { date: busiestDay[0], count: busiestDay[1] } : null,
    moduleNewHire,
    modulePAF,
  };

  // ── 7. TRENDS ──
  const trends = {
    submissions: { current: periodSubs.length, prior: priorSubs.length },
    processed: { current: periodActions.length, prior: priorActions.length },
    newHires: { current: newHiresSub.length, prior: headcount.priorNewHires },
    separations: { current: separationsSub.length, prior: headcount.priorSeparations },
    pafs: { current: pafActivity.total, prior: pafActivity.priorTotal },
    rejections: { current: rejections.total, prior: rejections.priorTotal },
  };

  return { headcount, pafActivity, pipeline, rejections, adminPerformance, usage, trends };
}

// ═══════════════════════════════════════
// HTML EMAIL TEMPLATE
// ═══════════════════════════════════════

function formatHours(h) {
  if (h === null || h === undefined) return "N/A";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  const days = Math.floor(h / 24);
  const rem = h % 24;
  return `${days}d ${Math.round(rem)}h`;
}

function trend(current, prior) {
  if (prior === 0 && current === 0) return '<span style="color:#64748b;">—</span>';
  if (prior === 0) return '<span style="color:#16a34a;">↑ new</span>';
  const delta = current - prior;
  const pct = Math.round(Math.abs(delta / prior) * 100);
  if (delta > 0) return `<span style="color:#16a34a;">↑ ${pct}%</span>`;
  if (delta < 0) return `<span style="color:#dc2626;">↓ ${pct}%</span>`;
  return '<span style="color:#64748b;">→ 0%</span>';
}

function actionLabel(key) {
  const map = {
    new_hire: "New Hire", separation: "Separation", rate_change: "Rate Change",
    title_change: "Title Change", status_change: "Status Change",
    reclassification: "Reclassification", add_bonus: "Bonus",
    add_deduction: "Deduction", add_gratuity: "Gratuity",
    add_cell_phone: "Cell Phone", travel_reimbursement: "Travel Reimbursement",
    other_reimbursement: "Other Reimbursement",
  };
  return map[key] || key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function buildEmailHTML(metrics, range) {
  const m = metrics;
  const purple = "#7c3aed";
  const navy = "#0f3057";

  // ── Reusable template pieces ──
  const sectionHeader = (icon, title) => `
    <tr><td style="padding:28px 0 12px;">
      <div style="font-size:13px;font-weight:800;color:${purple};text-transform:uppercase;letter-spacing:0.08em;">
        ${icon} ${title}
      </div>
      <div style="height:2px;background:linear-gradient(90deg,${purple},transparent);margin-top:6px;border-radius:2px;"></div>
    </td></tr>`;

  const metricCard = (label, value, sub) => `
    <td style="background:#f8f6ff;border-radius:8px;padding:14px 16px;text-align:center;border:1px solid #ede9fe;">
      <div style="font-size:22px;font-weight:800;color:${navy};">${value}</div>
      <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-top:2px;">${label}</div>
      ${sub ? `<div style="font-size:11px;margin-top:4px;">${sub}</div>` : ""}
    </td>`;

  const tableRow = (cells, isHeader) => {
    const tag = isHeader ? "th" : "td";
    const style = isHeader
      ? `style="padding:8px 12px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;text-align:left;border-bottom:2px solid #ede9fe;"`
      : `style="padding:8px 12px;font-size:13px;color:${navy};border-bottom:1px solid #f1f5f9;"`;
    return `<tr>${cells.map(c => `<${tag} ${style}>${c}</${tag}>`).join("")}</tr>`;
  };

  // ── Build sections ──
  let html = "";

  // ━━━ HEADER ━━━
  html += `
    <div style="background-color:#f4f7f6;padding:40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${navy};">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);">
      <div style="background:${purple};padding:24px 40px;text-align:center;">
        <div style="color:#ffffff;font-weight:800;letter-spacing:1.5px;font-size:18px;">KITCHFIX PEOPLE OPS</div>
        <div style="color:#e9d5ff;font-size:13px;margin-top:4px;font-weight:600;">
          ${range.periodType === "weekly" ? "Weekly" : "Monthly"} Report · ${range.label}
        </div>
      </div>
      <div style="padding:32px 40px;">
        <table style="width:100%;border-collapse:collapse;">`;

  // ━━━ 1. HEADCOUNT MOVEMENT ━━━
  html += sectionHeader("👥", "Headcount Movement");
  html += `<tr><td>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:8px 0;">
      <tr>
        ${metricCard("New Hires", m.headcount.newHiresSubmitted, trend(m.trends.newHires.current, m.trends.newHires.prior))}
        ${metricCard("Approved", m.headcount.newHiresApproved, "")}
        ${metricCard("Separations", m.headcount.separationsSubmitted, trend(m.trends.separations.current, m.trends.separations.prior))}
        ${metricCard("Net Change", (m.headcount.netChange >= 0 ? "+" : "") + m.headcount.netChange, "")}
      </tr>
    </table>
  </td></tr>`;

  // Headcount by location
  const locEntries = Object.entries(m.headcount.byLocation);
  if (locEntries.length > 0) {
    html += `<tr><td><table style="width:100%;border-collapse:collapse;margin-top:8px;">`;
    html += tableRow(["Location", "Hires", "Separations", "Net"], true);
    locEntries.forEach(([loc, data]) => {
      const net = data.hires - data.seps;
      html += tableRow([loc, data.hires, data.seps, (net >= 0 ? "+" : "") + net]);
    });
    html += `</table></td></tr>`;
  }

  // ━━━ 2. PAF ACTIVITY ━━━
  html += sectionHeader("📋", "PAF Activity");
  html += `<tr><td>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:8px 0;">
      <tr>
        ${metricCard("Total PAFs", m.pafActivity.total, trend(m.trends.pafs.current, m.trends.pafs.prior))}
        ${metricCard("Action Types", Object.keys(m.pafActivity.byType).length, "")}
      </tr>
    </table>
  </td></tr>`;

  const typeEntries = Object.entries(m.pafActivity.byType).sort((a, b) => b[1] - a[1]);
  if (typeEntries.length > 0) {
    html += `<tr><td><table style="width:100%;border-collapse:collapse;margin-top:8px;">`;
    html += tableRow(["Action Type", "Count"], true);
    typeEntries.forEach(([type, count]) => {
      html += tableRow([actionLabel(type), count]);
    });
    html += `</table></td></tr>`;
  }

  // ━━━ 3. PIPELINE HEALTH ━━━
  html += sectionHeader("🔄", "Pipeline Health");
  const pendingColor = m.pipeline.pendingCount > 5 ? "#dc2626" : m.pipeline.pendingCount > 0 ? "#f59e0b" : "#16a34a";
  html += `<tr><td>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:8px 0;">
      <tr>
        <td style="background:#f8f6ff;border-radius:8px;padding:14px 16px;text-align:center;border:1px solid #ede9fe;">
          <div style="font-size:22px;font-weight:800;color:${pendingColor};">${m.pipeline.pendingCount}</div>
          <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-top:2px;">Pending Now</div>
        </td>
        ${metricCard("Avg Response", formatHours(m.pipeline.avgReactionHours), "")}
        ${metricCard("Stuck (>3d)", m.pipeline.stuckCount, "")}
      </tr>
    </table>
  </td></tr>`;

  if (m.pipeline.oldestPending) {
    html += `<tr><td style="padding:8px 0;">
      <div style="background:#fef3c7;padding:10px 14px;border-radius:6px;font-size:12px;color:#92400e;border:1px solid #fde68a;">
        ⏳ Oldest pending: <strong>${m.pipeline.oldestPending.employee}</strong> — ${m.pipeline.oldestPending.ageDays} day${m.pipeline.oldestPending.ageDays !== 1 ? "s" : ""} old
      </div>
    </td></tr>`;
  }

  // ━━━ 4. REJECTION METRICS ━━━
  html += sectionHeader("🚫", "Rejections");
  html += `<tr><td>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:8px 0;">
      <tr>
        ${metricCard("Rejected", m.rejections.total, trend(m.trends.rejections.current, m.trends.rejections.prior))}
        ${metricCard("Resubmitted", m.rejections.resubmissions, "")}
        ${metricCard("Reject Rate", (m.rejections.rate * 100).toFixed(0) + "%", "")}
      </tr>
    </table>
  </td></tr>`;

  // ━━━ 5. ADMIN PERFORMANCE ━━━
  if (m.adminPerformance.length > 0) {
    html += sectionHeader("⚡", "Admin Performance");
    html += `<tr><td><table style="width:100%;border-collapse:collapse;margin-top:8px;">`;
    html += tableRow(["Admin", "Processed", "Approved", "Rejected", "Avg Response", "Fastest"], true);
    m.adminPerformance.forEach(a => {
      const name = a.email.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, c => c.toUpperCase());
      html += tableRow([
        name,
        a.processed,
        `<span style="color:#16a34a;">${a.approved}</span>`,
        `<span style="color:#dc2626;">${a.rejected}</span>`,
        formatHours(a.avgReactionHours),
        formatHours(a.fastestHours),
      ]);
    });
    html += `</table></td></tr>`;
  }

  // ━━━ 6. USAGE METRICS ━━━
  html += sectionHeader("📊", "Usage");
  html += `<tr><td>
    <table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:8px 0;">
      <tr>
        ${metricCard("Total Submitted", m.usage.moduleNewHire + m.usage.modulePAF, trend(m.trends.submissions.current, m.trends.submissions.prior))}
        ${metricCard("New Hires", m.usage.moduleNewHire, "")}
        ${metricCard("PAFs", m.usage.modulePAF, "")}
      </tr>
    </table>
  </td></tr>`;

  if (m.usage.busiestDay) {
    const bd = new Date(m.usage.busiestDay.date + "T12:00:00");
    html += `<tr><td style="padding:6px 0;">
      <div style="font-size:12px;color:#64748b;">📅 Busiest day: <strong style="color:${navy};">${fmtShort(bd)}</strong> (${m.usage.busiestDay.count} submission${m.usage.busiestDay.count !== 1 ? "s" : ""})</div>
    </td></tr>`;
  }

  // Top submitters
  if (m.usage.byUser.length > 0) {
    html += `<tr><td><table style="width:100%;border-collapse:collapse;margin-top:8px;">`;
    html += tableRow(["Submitter", "Count"], true);
    m.usage.byUser.slice(0, 5).forEach(([email, count]) => {
      const name = email.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, c => c.toUpperCase());
      html += tableRow([name, count]);
    });
    html += `</table></td></tr>`;
  }

  // ━━━ 7. TREND SUMMARY ━━━
  html += sectionHeader("📈", "Period Comparison");
  html += `<tr><td><table style="width:100%;border-collapse:collapse;margin-top:8px;">`;
  html += tableRow(["Metric", "This Period", "Prior Period", "Change"], true);
  const trendRows = [
    ["Submissions", m.trends.submissions],
    ["Processed", m.trends.processed],
    ["New Hires", m.trends.newHires],
    ["Separations", m.trends.separations],
    ["PAFs", m.trends.pafs],
    ["Rejections", m.trends.rejections],
  ];
  trendRows.forEach(([label, data]) => {
    html += tableRow([label, data.current, data.prior, trend(data.current, data.prior)]);
  });
  html += `</table></td></tr>`;

  // ━━━ FOOTER ━━━
  const appUrl = process.env.AUTH_URL || "https://kitchfix-intranet.vercel.app";
  html += `
        </table>
        <div style="margin-top:32px;padding-top:20px;border-top:1px solid #f1f5f9;text-align:center;">
          <a href="${appUrl}/people?view=admin" style="background:${purple};color:#ffffff;padding:12px 28px;text-decoration:none;border-radius:50px;font-size:13px;font-weight:700;display:inline-block;">Open People Portal</a>
        </div>
        <div style="margin-top:24px;text-align:center;">
          <p style="font-size:10px;color:#94a3b8;margin:0;">
            Auto-generated ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} CT
          </p>
        </div>
      </div>
    </div></div>`;

  return html;
}

// ═══════════════════════════════════════
// MAIN: generateReport()
// Called from route.js GET handler
// ═══════════════════════════════════════

/**
 * @param {string} period - "weekly" or "monthly"
 * @param {Function} readSheet - readSheet(spreadsheetId, sheetName) from route.js
 * @param {Function} sendEmail - sendEmail(to, subject, html) from route.js
 * @param {Function} logNotification - logNotification(...) from route.js
 * @param {object} sheetIds - { DB } sheet IDs
 */
export async function generateReport(period, { readSheet, sendEmail, logNotification, sheetIds }) {
  const range = period === "monthly" ? getMonthlyRange() : getWeeklyRange();

  // Read all submissions
  const { rows } = await readSheet(sheetIds.DB, "submissions");
  if (!rows || rows.length === 0) {
    console.log("[Report] No submissions data found");
    return { success: false, error: "No submissions data" };
  }

  const parsed = parseRows(rows);
  const metrics = computeMetrics(parsed, range);
  const html = buildEmailHTML(metrics, range);

  const periodLabel = period === "monthly" ? "Monthly" : "Weekly";
  const subject = `[People Portal] ${periodLabel} Report — ${range.label}`;

  const status = await sendEmail(REPORT_RECIPIENT, subject, html);
  await logNotification(
    REPORT_RECIPIENT,
    "email",
    subject,
    `report_${period}`,
    status,
    range.label
  );

  console.log(`[Report] ${periodLabel} report sent: ${status}`);
  return { success: status === "sent", period, range: range.label };
}
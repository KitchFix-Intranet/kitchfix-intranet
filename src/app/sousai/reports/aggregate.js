// ═══════════════════════════════════════════════════════════════════════════
// /sousai/reports · aggregate.js · pure aggregation functions
// ═══════════════════════════════════════════════════════════════════════════
//
// One 30-day fetch feeds these; every tab derives its numbers from the same
// rows in JS. This is the deliberate no-migration design (R1 binding). A
// materialized-view optimization is a later item if volume ever demands it -
// see fetchReportRows() in ./data.js for the read shape.
//
// Every function is pure: input rows -> output object. Zero DB, zero
// side effects. Unit-tested in scripts/_r1-acceptance.mjs.
//
// Time convention: all timestamps compared as ISO strings using date-only
// prefixes ("YYYY-MM-DD") for day bucketing. Timezone is server-local for
// display purposes; the deliberate simplification suits a first internal
// report where the audience is a handful of SLT users on the same TZ.
// ═══════════════════════════════════════════════════════════════════════════

// ── Small utilities ─────────────────────────────────────────────────────────

// ISO YYYY-MM-DD for a Date or a parseable string.
export function isoDay(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse a "YYYY-MM-DD" ISO-day string as LOCAL midnight. new Date(iso) treats
// the string as UTC midnight - correct for timestamps, wrong for a bare
// day-of-week the server is trying to bucket in local time. We split and
// construct explicitly so downstream .getDate() reflects the intended day.
function parseIsoDayLocal(iso) {
  if (iso instanceof Date) return new Date(iso.getFullYear(), iso.getMonth(), iso.getDate());
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Same clock hour as `d`, N days earlier. Used for the last-7 and last-30
// windows expressed as inclusive day-count.
export function daysAgo(d, n) {
  const dt = d instanceof Date ? new Date(d) : new Date(d);
  dt.setDate(dt.getDate() - n);
  return dt;
}

// Reference "today" (server clock) as a Date at midnight local time.
export function serverToday(now) {
  const dt = now ? new Date(now) : new Date();
  dt.setHours(0, 0, 0, 0);
  return dt;
}

// Cost formula (label "est." in the UI). Same ballpark constants as the R0
// pack; usage jsonb carries the four Anthropic token buckets.
// Rates per 1M tokens.
const COST_PER_MTOK = { input: 3, output: 15, cache_read: 0.3, cache_creation: 3.75 };

export function estCostFromUsage(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const inp = Number(usage.input_tokens) || 0;
  const out = Number(usage.output_tokens) || 0;
  const cr = Number(usage.cache_read_input_tokens) || 0;
  const cw = Number(usage.cache_creation_input_tokens) || 0;
  return (
    (inp * COST_PER_MTOK.input +
      out * COST_PER_MTOK.output +
      cr * COST_PER_MTOK.cache_read +
      cw * COST_PER_MTOK.cache_creation) /
    1e6
  );
}

// Truncate an answer preview to a compact single-line-ish string. Keeps first
// N chars, collapses whitespace, appends "..." on truncation.
export function previewAnswer(answer, chars = 180) {
  if (!answer) return "";
  const flat = String(answer).replace(/\s+/g, " ").trim();
  return flat.length > chars ? flat.slice(0, chars) + "..." : flat;
}

// Normalize a question for repeat-detection: lowercase, collapse whitespace,
// strip trailing punctuation. Same intent as the R0 pack's normalization.
export function normalizeQuestion(q) {
  if (!q) return "";
  return String(q)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?!.,;:]+$/g, "")
    .trim();
}

// Return the effective outcome bucket for scoreboarding. `error` supersedes
// `status` (an error row may still have status="error" from the logger; we
// treat error_kind presence as the truth).
export function bucketOf(row) {
  if (row.error_kind) return "error";
  if (row.status === "grounded") return "grounded";
  if (row.status === "partial") return "partial";
  if (row.status === "declined") return "declined";
  return "error";
}

// ── Scoreboard (day window) ─────────────────────────────────────────────────

export function scoreboard(rows) {
  const counts = { grounded: 0, partial: 0, declined: 0, error: 0 };
  const askers = new Set();
  let latencyMsSum = 0;
  let latencyMsN = 0;
  let cost = 0;
  for (const r of rows) {
    counts[bucketOf(r)] += 1;
    if (r.user_email) askers.add(String(r.user_email).toLowerCase());
    if (Number.isFinite(Number(r.latency_ms))) {
      latencyMsSum += Number(r.latency_ms);
      latencyMsN += 1;
    }
    cost += estCostFromUsage(r.usage);
  }
  return {
    questions: rows.length,
    unique_askers: askers.size,
    grounded: counts.grounded,
    partial: counts.partial,
    declined: counts.declined,
    error: counts.error,
    avg_seconds: latencyMsN ? latencyMsSum / latencyMsN / 1000 : null,
    est_cost: cost,
  };
}

// ── Filter helpers by day window ────────────────────────────────────────────

export function rowsForDay(rows, dayISO) {
  return rows.filter((r) => isoDay(r.created_at) === dayISO);
}

export function rowsInRange(rows, startDate, endDate) {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  return rows.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return t >= startMs && t <= endMs;
  });
}

// ── Daily tab ───────────────────────────────────────────────────────────────

// Transcript rows for a day. Sorted asc by time. Truncated answer preview.
export function transcript(rows) {
  return [...rows]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((r) => ({
      id: r.id,
      time: r.created_at,
      asker: r.user_email,
      status: bucketOf(r),
      question: r.question,
      answer_preview: previewAnswer(r.answer),
      latency_ms: r.latency_ms,
    }));
}

// Declines + errors with reasons + question.
export function declinesAndErrors(rows) {
  return rows
    .filter((r) => bucketOf(r) === "declined" || bucketOf(r) === "error")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((r) => ({
      id: r.id,
      time: r.created_at,
      asker: r.user_email,
      status: bucketOf(r),
      question: r.question,
      reason: bucketOf(r) === "error" ? (r.error_kind || "error") : (r.decline_reason || ""),
    }));
}

// Thumbs-downs with comments. feedback = -1 rows only.
export function thumbsDowns(rows) {
  return rows
    .filter((r) => r.feedback === -1)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((r) => ({
      id: r.id,
      time: r.created_at,
      asker: r.user_email,
      question: r.question,
      comment: r.feedback_comment || "",
    }));
}

// ── Weekly tab ──────────────────────────────────────────────────────────────

// Day-by-day volume for last N days ending at `endDay` (ISO). Returns
// oldest -> newest. Each entry: { day, total, grounded, partial, declined,
// error }. Days with zero rows are included.
export function dayByDay(rows, endDay, days = 7) {
  const end = parseIsoDayLocal(endDay);
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dt = new Date(end);
    dt.setDate(end.getDate() - i);
    const dayISO = isoDay(dt);
    const dayRows = rowsForDay(rows, dayISO);
    const counts = { grounded: 0, partial: 0, declined: 0, error: 0 };
    for (const r of dayRows) counts[bucketOf(r)] += 1;
    out.push({ day: dayISO, total: dayRows.length, ...counts });
  }
  return out;
}

// Repeat questions in the window. Normalized; only questions asked more
// than once. Sorted by count desc, then last-seen desc.
export function repeatQuestions(rows) {
  const byNorm = new Map();
  for (const r of rows) {
    const key = normalizeQuestion(r.question);
    if (!key) continue;
    if (!byNorm.has(key)) {
      byNorm.set(key, { normalized: key, sample: r.question, count: 0, last_seen: null, askers: new Set() });
    }
    const e = byNorm.get(key);
    e.count += 1;
    e.askers.add(String(r.user_email || "").toLowerCase());
    if (!e.last_seen || new Date(r.created_at) > new Date(e.last_seen)) e.last_seen = r.created_at;
  }
  return [...byNorm.values()]
    .filter((e) => e.count > 1)
    .sort((a, b) => b.count - a.count || new Date(b.last_seen) - new Date(a.last_seen))
    .map((e) => ({ normalized: e.normalized, sample: e.sample, count: e.count, last_seen: e.last_seen, distinct_askers: e.askers.size }));
}

// Most-cited documents. Flattens the sources arrays; counts per doc id.
// Sorted by cite count desc.
export function mostCitedDocs(rows) {
  const counts = new Map();
  for (const r of rows) {
    const sources = Array.isArray(r.sources) ? r.sources : [];
    for (const s of sources) {
      const id = String(s).trim();
      if (!id) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([doc_id, count]) => ({ doc_id, count }))
    .sort((a, b) => b.count - a.count);
}

// Declines grouped by normalized question, with asker list.
export function declineGaps(rows) {
  const byNorm = new Map();
  for (const r of rows) {
    if (bucketOf(r) !== "declined") continue;
    const key = normalizeQuestion(r.question);
    if (!key) continue;
    if (!byNorm.has(key)) {
      byNorm.set(key, { normalized: key, sample: r.question, count: 0, askers: new Set(), reasons: new Set() });
    }
    const e = byNorm.get(key);
    e.count += 1;
    e.askers.add(String(r.user_email || "").toLowerCase());
    if (r.decline_reason) e.reasons.add(r.decline_reason);
  }
  return [...byNorm.values()]
    .sort((a, b) => b.count - a.count)
    .map((e) => ({
      normalized: e.normalized,
      sample: e.sample,
      count: e.count,
      askers: [...e.askers],
      reasons: [...e.reasons],
    }));
}

// Feedback summary. counts + %rated (of window questions).
export function feedbackSummary(rows) {
  let up = 0, down = 0, rated = 0;
  for (const r of rows) {
    if (r.feedback === 1) { up += 1; rated += 1; }
    else if (r.feedback === -1) { down += 1; rated += 1; }
  }
  const total = rows.length;
  const pctRated = total ? (rated / total) * 100 : 0;
  return { up, down, rated, total, pct_rated: pctRated };
}

// ── Monthly tab ─────────────────────────────────────────────────────────────

// Adoption by week for the last 4 weeks ending at `endDay`. Each entry:
// { week_start, week_end, questions, distinct_askers, pct_grounded,
//   pct_declined }. Ordered oldest -> newest.
export function adoptionByWeek(rows, endDay) {
  const end = parseIsoDayLocal(endDay);
  const out = [];
  for (let w = 3; w >= 0; w -= 1) {
    const weekEnd = new Date(end);
    weekEnd.setDate(end.getDate() - 7 * w);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 6);
    const startISO = isoDay(weekStart);
    const endISO = isoDay(weekEnd);
    const inWeek = rows.filter((r) => {
      const d = isoDay(r.created_at);
      return d >= startISO && d <= endISO;
    });
    const askers = new Set(inWeek.map((r) => String(r.user_email || "").toLowerCase()));
    const grounded = inWeek.filter((r) => bucketOf(r) === "grounded").length;
    const declined = inWeek.filter((r) => bucketOf(r) === "declined").length;
    const n = inWeek.length;
    out.push({
      week_start: startISO,
      week_end: endISO,
      questions: n,
      distinct_askers: askers.size,
      pct_grounded: n ? (grounded / n) * 100 : 0,
      pct_declined: n ? (declined / n) * 100 : 0,
    });
  }
  return out;
}

// By-person usage. Sorted by question count desc.
export function byPersonUsage(rows) {
  const byPerson = new Map();
  for (const r of rows) {
    const email = String(r.user_email || "").toLowerCase();
    if (!email) continue;
    if (!byPerson.has(email)) {
      byPerson.set(email, { email, questions: 0, grounded: 0, declined: 0, last_seen: null });
    }
    const e = byPerson.get(email);
    e.questions += 1;
    if (bucketOf(r) === "grounded") e.grounded += 1;
    if (bucketOf(r) === "declined") e.declined += 1;
    if (!e.last_seen || new Date(r.created_at) > new Date(e.last_seen)) e.last_seen = r.created_at;
  }
  return [...byPerson.values()].sort((a, b) => b.questions - a.questions);
}

// Month cost + avg speed + worst speed.
export function monthPerf(rows) {
  let cost = 0;
  let latencyMsSum = 0, latencyMsN = 0, latencyMsWorst = 0;
  for (const r of rows) {
    cost += estCostFromUsage(r.usage);
    const l = Number(r.latency_ms);
    if (Number.isFinite(l)) {
      latencyMsSum += l;
      latencyMsN += 1;
      if (l > latencyMsWorst) latencyMsWorst = l;
    }
  }
  return {
    est_cost: cost,
    avg_seconds: latencyMsN ? latencyMsSum / latencyMsN / 1000 : null,
    worst_seconds: latencyMsN ? latencyMsWorst / 1000 : null,
  };
}

// Unanswered demand: every distinct declined question, times asked, first
// and last dates.
export function unansweredDemand(rows) {
  const byNorm = new Map();
  for (const r of rows) {
    if (bucketOf(r) !== "declined") continue;
    const key = normalizeQuestion(r.question);
    if (!key) continue;
    if (!byNorm.has(key)) {
      byNorm.set(key, { normalized: key, sample: r.question, count: 0, first_seen: r.created_at, last_seen: r.created_at });
    }
    const e = byNorm.get(key);
    e.count += 1;
    if (new Date(r.created_at) < new Date(e.first_seen)) e.first_seen = r.created_at;
    if (new Date(r.created_at) > new Date(e.last_seen)) e.last_seen = r.created_at;
  }
  return [...byNorm.values()].sort((a, b) => b.count - a.count);
}

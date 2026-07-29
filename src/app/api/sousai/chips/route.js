// ════════════════════════════════════════════════════════════════════════════
// /api/sousai/chips · Train 3 · digest-fed suggestion chips
// ════════════════════════════════════════════════════════════════════════════
//
// GET /api/sousai/chips
//   -> JSON: { chips: [{ label, question, source }], generated_at, source_rows }
//
// Same auth gate pattern as the Sous Reports page (canViewSousReports
// allowlist). Empty-tolerant: an empty log window returns { chips: [] } with
// 200 - the client falls back to a static trio.
//
// Reuses the reports data + aggregate modules so this route and the Reports
// page never disagree. The R1 data helper reads sousai_questions via the
// service-role client; this route trims to the last 7 days and mixes:
//   - top-asked recurring questions (count >= 2, most recent)
//   - top-declined ("gap") questions (still asked more than once)
// The 3 selected are the mix Chat's digest surfaces, minus any duplicates.
//
// Caching: Cache-Control: private, max-age=3600 (1h). The chip mix is
// window-based and changes at most hourly; the underlying data changes on
// every question.
// ════════════════════════════════════════════════════════════════════════════

import { auth } from "@/lib/auth";
import { canViewSousReports } from "@/lib/opdAcl";
import { fetchReportRows } from "@/app/sousai/reports/data";
import { repeatQuestions, declineGaps, isoDay, daysAgo, serverToday } from "@/app/sousai/reports/aggregate";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// Compresses a normalized question into a chip label (title-case first word,
// trailing punctuation trimmed, capped at ~48 chars for the pill display).
function chipLabel(rawQuestion) {
  const q = String(rawQuestion || "").trim().replace(/[?.!]+$/, "");
  if (!q) return "";
  // Capitalize the first letter only; leave the rest as authored.
  const capped = q.charAt(0).toUpperCase() + q.slice(1);
  if (capped.length <= 48) return capped;
  return capped.slice(0, 45).trimEnd() + "...";
}

// Selects up to `limit` chips from repeatQuestions + declineGaps in a mixed
// order (asked, then declined). Deduplicates by normalized question.
function selectChips(rows, limit = 3) {
  const asked = repeatQuestions(rows).slice(0, 5); // headroom for dedup + label filter
  const declined = declineGaps(rows).slice(0, 5);
  const seen = new Set();
  const out = [];
  const push = (entry, source) => {
    const label = chipLabel(entry.sample);
    if (!label) return;
    if (seen.has(entry.normalized)) return;
    seen.add(entry.normalized);
    out.push({ label, question: entry.sample, source });
  };
  // Alternate one asked, one declined for variety; break early at limit.
  let ai = 0;
  let di = 0;
  while (out.length < limit && (ai < asked.length || di < declined.length)) {
    if (ai < asked.length) push(asked[ai++], "asked");
    if (out.length >= limit) break;
    if (di < declined.length) push(declined[di++], "declined");
  }
  return out.slice(0, limit);
}

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return jsonResponse(401, { error: "unauthorized" });
  if (!canViewSousReports(email)) return jsonResponse(403, { error: "forbidden" });

  try {
    const now = new Date();
    const { rows, error } = await fetchReportRows(now);
    if (error) {
      // Empty-tolerant: return no chips, let the client fall back.
      return jsonResponse(200, {
        chips: [],
        generated_at: now.toISOString(),
        source_rows: 0,
        note: `log read failed: ${error}`,
      });
    }
    // Narrow to last 7 days for a weekly window (Design Scope 12).
    const today = serverToday(now);
    const cutoffISO = isoDay(daysAgo(today, 7));
    const windowRows = (rows || []).filter((r) => {
      const day = isoDay(new Date(r.created_at));
      return day >= cutoffISO;
    });
    const chips = selectChips(windowRows, 3);
    return jsonResponse(
      200,
      {
        chips,
        generated_at: now.toISOString(),
        source_rows: windowRows.length,
      },
      { "Cache-Control": "private, max-age=3600" }
    );
  } catch (e) {
    // Empty-tolerant on unexpected throws too.
    return jsonResponse(200, {
      chips: [],
      generated_at: new Date().toISOString(),
      source_rows: 0,
      note: `chips route threw: ${e?.message || String(e)}`,
    });
  }
}

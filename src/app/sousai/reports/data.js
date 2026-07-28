// ═══════════════════════════════════════════════════════════════════════════
// /sousai/reports · data.js · one server-side fetch, 30 days
// ═══════════════════════════════════════════════════════════════════════════
//
// The R1 binding is zero migrations. One server-side fetch per page load,
// selected columns only, 30-day window - all aggregation runs in JS from
// this single window. A materialized-view optimization is a later item if
// volume ever demands it.
//
// Reads go through the service-role client. sousai_questions has zero grants
// to authenticated; the page is a server component, never a client-side
// query.
//
// trajectory is EXCLUDED from the select (heavy, not needed for R1).
// ═══════════════════════════════════════════════════════════════════════════

import { getServiceClient } from "@/lib/supabase";

const REPORT_COLUMNS = [
  "id",
  "created_at",
  "user_email",
  "status",
  "declined",
  "decline_reason",
  "question",
  "sources",
  "answer",
  "latency_ms",
  "token_burst_ms",
  "usage",
  "feedback",
  "feedback_comment",
  "error_kind",
].join(", ");

const WINDOW_DAYS = 30;

// Returns { rows, error }. On error, rows is null and error is a
// human-readable string safe to render.
export async function fetchReportRows(now = new Date()) {
  try {
    const since = new Date(now);
    since.setDate(since.getDate() - WINDOW_DAYS);

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("sousai_questions")
      .select(REPORT_COLUMNS)
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(10000);

    if (error) {
      return { rows: null, error: `read failed: ${error.code || "?"}: ${error.message || "(no message)"}` };
    }
    return { rows: data || [], error: null };
  } catch (e) {
    return { rows: null, error: `fetch threw: ${e?.message || String(e)}` };
  }
}

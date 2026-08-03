// _probe-cal2-zero-tool-blast.mjs (throwaway, fix/sous-calibration-2 2026-08-04)
//
// Calibration round 2 Part 5 - blast radius. Reads sousai_questions over
// the last 30 days and counts answers that completed with ZERO successful
// tool calls but still carry a citation-shaped claim (a Source line or a
// doc-id shape in the answer). Splits the count by status so the report
// shows both the fabrication-with-citation cases the backstop targets AND
// the honest zero-tool answers (declines and no-citation replies) that
// stay out of scope. Read-only; no historical row changes.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE env missing");
const sb = createClient(url, key, { auth: { persistSession: false } });

const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

const { data: rows, error } = await sb
  .from("sousai_questions")
  .select("id, question, status, answer, trajectory, created_at")
  .gte("created_at", since);
if (error) throw error;

// Successful tool call count for a trajectory row. The stored trajectory
// intentionally drops `rawResult` (see src/app/api/sousai/log.js), so we
// detect success via the presence of `summary` (added on every executed
// tool) and the absence of `tool_error`.
function successfulTools(traj) {
  if (!Array.isArray(traj)) return 0;
  return traj.filter((s) => s && s.tool && !s.tool_error && s.summary != null).length;
}

// Any Source line in the answer body counts as a citation-shaped claim.
// Same detector shape as agent.js hasSourceLine (multi-line, tolerant of
// bullet prefix + markdown bold).
const SOURCE_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?source(?:s)?(?:\*\*)?\s*:/i;
function hasCitation(answer) {
  if (!answer) return false;
  return String(answer).split("\n").some((line) => SOURCE_LINE_RE.test(line));
}

const buckets = {
  zeroToolCited: { grounded: 0, partial: 0, declined: 0, error: 0 },
  zeroToolNoCite: { grounded: 0, partial: 0, declined: 0, error: 0 },
  hadTool: { grounded: 0, partial: 0, declined: 0, error: 0 },
};

const zeroToolCitedSamples = [];

for (const r of rows || []) {
  const tools = successfulTools(r.trajectory);
  const cited = hasCitation(r.answer);
  const st = ["grounded", "partial", "declined", "error"].includes(r.status) ? r.status : "error";
  if (tools === 0 && cited) {
    buckets.zeroToolCited[st] += 1;
    if (zeroToolCitedSamples.length < 8) {
      zeroToolCitedSamples.push({
        id: r.id,
        status: st,
        question: (r.question || "").slice(0, 90),
        answer: (r.answer || "").replace(/\n/g, " ").slice(0, 120),
      });
    }
  } else if (tools === 0) {
    buckets.zeroToolNoCite[st] += 1;
  } else {
    buckets.hadTool[st] += 1;
  }
}

console.log(`=== Calibration r2 Part 5: zero-tool blast radius, last 30 days (since ${since.slice(0, 10)}) ===`);
console.log(`Total rows: ${rows.length}`);
console.log("");

const width = 34;
const numW = 10;
console.log(`${"bucket".padEnd(width)}${"grounded".padStart(numW)}${"partial".padStart(numW)}${"declined".padStart(numW)}${"error".padStart(numW)}${"total".padStart(numW)}`);
console.log("-".repeat(width + numW * 5));
for (const [label, key] of [
  ["zero tools + citation-shaped claim", "zeroToolCited"],
  ["zero tools + NO citation", "zeroToolNoCite"],
  ["had >=1 successful tool call", "hadTool"],
]) {
  const b = buckets[key];
  const total = b.grounded + b.partial + b.declined + b.error;
  console.log(`${label.padEnd(width)}${String(b.grounded).padStart(numW)}${String(b.partial).padStart(numW)}${String(b.declined).padStart(numW)}${String(b.error).padStart(numW)}${String(total).padStart(numW)}`);
}

const zeroToolTotal = Object.values(buckets.zeroToolCited).reduce((a, b) => a + b, 0);
console.log("");
console.log(`Zero-tool + citation total: ${zeroToolTotal} (${((zeroToolTotal / (rows.length || 1)) * 100).toFixed(1)}% of last 30 days)`);
console.log(`Backstop scope: the ${zeroToolTotal} rows above. Answers with tools succeed the backstop; zero-tool declines / no-citation replies are exempt.`);

if (zeroToolCitedSamples.length > 0) {
  console.log("");
  console.log("Sample zero-tool + citation rows (up to 8):");
  for (const s of zeroToolCitedSamples) {
    console.log(`  [${s.status}] id=${s.id} q="${s.question}"`);
    console.log(`             a="${s.answer}${s.answer.length >= 120 ? "..." : ""}"`);
  }
}

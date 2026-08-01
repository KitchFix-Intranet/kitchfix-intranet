// R3-05 blast-radius: read-only PG survey of `sousai_questions` last 30 days.
// Counts partials by flag type (grounded_without_sources / phantom_citation /
// other) crossed with answer kind (data-tool vs doc), plus a separate count
// of budget-maxed asks. No historical rows are modified.
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE env missing");
const sb = createClient(url, key, { auth: { persistSession: false } });

const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

// Pull the rows and classify in JS - trajectory is jsonb, easier to inspect
// per-row than in raw SQL.
const { data: rows, error } = await sb
  .from("sousai_questions")
  .select("id, status, trajectory, answer, created_at")
  .gte("created_at", since);
if (error) throw error;

const partials = rows.filter((r) => r.status === "partial");

function trajHasFlag(traj, flagName) {
  if (!Array.isArray(traj)) return false;
  return traj.some((step) => {
    if (step && step.kind === "downgrade" && Array.isArray(step.flags)) {
      return step.flags.some((f) => f && f[flagName]);
    }
    return false;
  });
}
function trajHasSuccessfulDataTool(traj) {
  if (!Array.isArray(traj)) return false;
  return traj.some((step) => {
    if (!step || !step.tool) return false;
    const t = step.tool;
    const isData =
      t.startsWith("find_") || t.startsWith("list_") || t.startsWith("get_account") ||
      t.startsWith("sc_") || t.startsWith("spend_");
    if (!isData) return false;
    if (step.tool_error) return false;
    return true;
  });
}
function trajBudgetMaxed(traj) {
  if (!Array.isArray(traj)) return false;
  // Historical budget=8; a trajectory with 8+ tool steps is saturation.
  // The "tool budget exhausted" tool_result content isn't consistently
  // preserved in trajectory jsonb, so we count tool steps directly.
  const toolSteps = traj.filter((s) => s && s.tool && !s.kind).length;
  return toolSteps >= 8;
}

const table = { data: {}, doc: {} };
for (const r of partials) {
  const gws = trajHasFlag(r.trajectory, "grounded_without_sources");
  const phantom = trajHasFlag(r.trajectory, "phantom_citation");
  const truncated = trajHasFlag(r.trajectory, "truncated") ||
    (Array.isArray(r.trajectory) && r.trajectory.some((s) => s && s.kind === "truncation"));
  const flag = gws ? "grounded_without_sources" :
               phantom ? "phantom_citation" :
               truncated ? "truncated" : "other";
  const kind = trajHasSuccessfulDataTool(r.trajectory) ? "data" : "doc";
  table[kind][flag] = (table[kind][flag] || 0) + 1;
}

console.log(`=== Blast radius, sousai_questions, last 30 days (since ${since.slice(0, 10)}) ===`);
console.log(`Total rows:      ${rows.length}`);
console.log(`Partial rows:    ${partials.length}`);
console.log("");
console.log(`Partial breakdown by flag (rows) x answer kind (cols):`);
console.log("");
const flags = ["grounded_without_sources", "phantom_citation", "truncated", "other"];
console.log(`  ${"flag".padEnd(30)}${"data".padStart(8)}${"doc".padStart(8)}${"total".padStart(10)}`);
console.log(`  ${"-".repeat(56)}`);
for (const f of flags) {
  const d = table.data[f] || 0;
  const c = table.doc[f] || 0;
  console.log(`  ${f.padEnd(30)}${String(d).padStart(8)}${String(c).padStart(8)}${String(d + c).padStart(10)}`);
}
const gwsTotal = (table.data.grounded_without_sources || 0) + (table.doc.grounded_without_sources || 0);
const phantomTotal = (table.data.phantom_citation || 0) + (table.doc.phantom_citation || 0);
const explained = gwsTotal + phantomTotal;
const pct = partials.length > 0 ? ((explained / partials.length) * 100).toFixed(1) : "0.0";
console.log("");
console.log(`The two R3-05 mechanisms account for ${explained} of ${partials.length} partials (${pct}%).`);

// Phantom-partial split (Kevin extension): of the historical phantom-flagged
// partials, how many had the phantom id on a Source line (rule 3 firing
// legitimately even under the refinement) vs body-only (finding-2 mechanism
// - the FORM template cross-ref case where quoted content triggered phantom).
const SOURCE_LINE_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?source(?:s)?(?:\*\*)?\s*:/i;
const CITE_RE = /\b([A-Z]{2,6})-([0-9]{3})\b/g;
function sourceLineIds(answerText) {
  const ids = new Set();
  for (const line of String(answerText || "").split("\n")) {
    if (SOURCE_LINE_RE.test(line)) {
      for (const m of line.matchAll(CITE_RE)) ids.add(`${m[1]}-${m[2]}`);
    }
  }
  return ids;
}
function trajPhantomIds(traj) {
  const ids = [];
  if (!Array.isArray(traj)) return ids;
  for (const s of traj) {
    if (s && s.kind === "downgrade" && Array.isArray(s.flags)) {
      for (const f of s.flags) {
        if (f && Array.isArray(f.phantom_citation)) ids.push(...f.phantom_citation);
      }
    }
  }
  return ids;
}
const phantomPartials = partials.filter((r) => trajHasFlag(r.trajectory, "phantom_citation"));
let onSourceCount = 0;
let bodyOnlyCount = 0;
for (const r of phantomPartials) {
  const phantomIds = trajPhantomIds(r.trajectory);
  const srcIds = sourceLineIds(r.answer);
  const anyOnSource = phantomIds.some((id) => srcIds.has(id));
  if (anyOnSource) onSourceCount += 1;
  else bodyOnlyCount += 1;
}
console.log("");
console.log(`=== Phantom-partial split (finding-2 mechanism, R3-05b refinement) ===`);
console.log(`Historical phantom_citation partials: ${phantomPartials.length}`);
console.log(`  phantom id on a Source line (still legitimately flags):  ${onSourceCount}`);
console.log(`  phantom id ONLY in body content (finding-2, no longer flags): ${bodyOnlyCount}`);
if (phantomPartials.length > 0) {
  const bodyPct = ((bodyOnlyCount / phantomPartials.length) * 100).toFixed(1);
  console.log(`  finding-2 share of historical phantom partials: ${bodyPct}%`);
}

// Budget-maxed count
const budgetMaxed = rows.filter((r) => trajBudgetMaxed(r.trajectory)).length;
const budgetPct = rows.length > 0 ? ((budgetMaxed / rows.length) * 100).toFixed(1) : "0.0";
console.log("");
console.log(`=== Tool-budget saturation (R3-05 rider) ===`);
console.log(`Asks that hit TOOL_BUDGET=8 in the last 30 days: ${budgetMaxed} of ${rows.length} (${budgetPct}%).`);
console.log(`Budget bumped to 14 in this PR; the real fix is a batch tool (Phase F candidate).`);

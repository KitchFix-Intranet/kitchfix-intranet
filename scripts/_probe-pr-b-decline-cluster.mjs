// PR B Part 6 - decline-rate 30-day cluster. Read-only SQL over
// sousai_questions where status=declined; keyword-bucket by topic; rank
// by ask count. Output = documentation-demand list for content triage.
// No historical rows modified.
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE env missing");
const sb = createClient(url, key, { auth: { persistSession: false } });

const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

const { data: rows, error } = await sb
  .from("sousai_questions")
  .select("id, question, decline_reason, created_at")
  .eq("status", "declined")
  .gte("created_at", since);
if (error) throw error;

// Keyword buckets - shallow-topic clustering. Order matters (first-match
// wins) so more-specific patterns come before broad ones.
const buckets = [
  { name: "food cost / P&L / margin", re: /food cost|p ?& ?l|margin|financials?|profit/i },
  { name: "labor / wages / OT / comp time", re: /labor|wage|hourly|overtime|OT|comp time|salary|pay|payroll/i },
  { name: "inventory / count / stock", re: /inventor|count|stock|par level|reorder/i },
  { name: "HR / PTO / benefits / holiday pay", re: /HR|PTO|vacation|holiday pay|benefit|hiring|onboarding|termination|discipline/i },
  { name: "brand / identity / mission / values", re: /brand promise|identity|mission|values|pillar|history/i },
  { name: "prior season / historical", re: /2024|2023|last year|prior year|last season|last month|prior period|historical/i },
  { name: "vendor management / deactivation", re: /deactivat|new vendor|add vendor|vendor onboard|vendor terminate/i },
  { name: "customer / client / player nutrition", re: /player.*nutrition|client meal|diet.*plan|macro|calorie/i },
  { name: "scheduling / cadence / shifts", re: /schedule|shift|when.*next|cadence|when is|when's/i },
  { name: "training / SOP knowledge / policy detail", re: /training|SOP|policy|protocol|procedure/i },
];

const counts = {};
const misc = [];
for (const r of rows || []) {
  const q = (r.question || "").trim();
  const matched = buckets.find((b) => b.re.test(q));
  const key = matched ? matched.name : null;
  if (key) counts[key] = (counts[key] || 0) + 1;
  else misc.push(q);
}
counts["(other / uncategorized)"] = misc.length;

const ranked = Object.entries(counts)
  .filter(([_k, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]);

console.log(`=== PR B Part 6: decline cluster, sousai_questions last 30 days (since ${since.slice(0, 10)}) ===`);
console.log(`Total declines: ${rows.length}`);
console.log("");
console.log(`Ranked topic buckets (documentation-demand list):`);
console.log("");
console.log(`  ${"bucket".padEnd(50)}${"count".padStart(8)}${"%".padStart(8)}`);
console.log(`  ${"-".repeat(66)}`);
for (const [k, n] of ranked) {
  const pct = rows.length > 0 ? ((n / rows.length) * 100).toFixed(1) : "0.0";
  console.log(`  ${k.padEnd(50)}${String(n).padStart(8)}${pct.padStart(8)}`);
}

if (misc.length > 0 && misc.length <= 20) {
  console.log(`\nUncategorized decline questions (${misc.length}):`);
  for (const q of misc.slice(0, 20)) {
    console.log(`  - ${q.slice(0, 100)}${q.length > 100 ? "..." : ""}`);
  }
}

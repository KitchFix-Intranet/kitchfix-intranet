// ─────────────────────────────────────────────────────────────────────────────
// scripts/apply-pr-7-18-sousai-question-log.mjs
// Project SousAI · PR 7.18 · verify sousai_questions table landed.
//
// THIS DB HAS NO exec_sql RPC. DDL is applied by pasting the .sql into
// Supabase Studio's SQL editor. This script runs after, verifies the shape,
// and round-trips a canary insert + select + delete to prove the table is
// usable end-to-end.
//
// Usage:
//   1. Paste docs/migrations/pr-7-18-sousai-question-log.sql into Supabase
//      Studio's SQL editor and run.
//   2. node --env-file=.env.local scripts/apply-pr-7-18-sousai-question-log.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const TABLE = "sousai_questions";
const REQUIRED_COLUMNS = [
  "id", "created_at",
  "user_email", "resolved_tier", "access_levels",
  "question",
  "status", "declined", "decline_reason", "answer", "sources",
  "trajectory", "model", "latency_ms", "token_burst_ms", "usage",
  "error_kind", "error_message",
  "feedback", "feedback_comment", "feedback_at",
];

async function tableExists() {
  const { error } = await sb.from(TABLE).select("id", { head: true, count: "exact" });
  if (!error) return { ok: true };
  if (/relation .* does not exist/i.test(error.message || "") || error.code === "42P01") {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: `${error.code || "?"}: ${error.message || ""}` };
}

async function columnExists(col) {
  const { error } = await sb.from(TABLE).select(col).limit(1);
  if (!error) return { ok: true };
  if (error.code === "42703" || /column .* does not exist/i.test(error.message || "")) {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: `${error.code || "?"}: ${error.message || ""}` };
}

console.log("apply pr-7-18-sousai-question-log (verify-after-Studio)\n");

const t = await tableExists();
if (!t.ok) {
  console.log(`  MISS  sousai_questions table not present (${t.reason})`);
  console.log("\nPaste docs/migrations/pr-7-18-sousai-question-log.sql into Supabase Studio, then re-run.");
  process.exit(1);
}
console.log("  ok    sousai_questions table exists");

let allPresent = true;
for (const col of REQUIRED_COLUMNS) {
  const r = await columnExists(col);
  if (r.ok) {
    console.log(`  ok    sousai_questions.${col}`);
  } else if (r.reason === "missing") {
    console.log(`  MISS  sousai_questions.${col} does not exist`);
    allPresent = false;
  } else {
    console.error(`  FAIL  sousai_questions.${col} probe failed: ${r.reason}`);
    process.exit(2);
  }
}

if (!allPresent) {
  console.log("\nColumns missing. Re-check the SQL was applied.");
  process.exit(1);
}

// Round-trip test: insert canary row, select it back, delete it. Confirms
// the table is usable end-to-end.
console.log("\nRound-trip test (insert -> select -> delete):");
const canary = {
  user_email: "canary@kitchfix.com",
  resolved_tier: "slt",
  access_levels: ["slt", "restricted", "unrestricted"],
  question: `pr-7-18 canary at ${new Date().toISOString()}`,
  status: "grounded",
  declined: false,
  answer: "canary",
  sources: ["PB-002"],
  trajectory: [{ tool: null, kind: "final" }],
  model: "claude-sonnet-4-6",
  latency_ms: 1234,
  token_burst_ms: 5678,
  usage: { input_tokens: 100, output_tokens: 20 },
};
const { data: inserted, error: insErr } = await sb
  .from(TABLE)
  .insert(canary)
  .select("id")
  .single();
if (insErr) {
  console.error(`  FAIL  insert: ${insErr.code || "?"}: ${insErr.message}`);
  process.exit(3);
}
console.log(`  ok    insert (id=${inserted.id})`);

const { data: fetched, error: fetchErr } = await sb
  .from(TABLE)
  .select("id, user_email, question, status, feedback")
  .eq("id", inserted.id)
  .single();
if (fetchErr) {
  console.error(`  FAIL  select: ${fetchErr.code || "?"}: ${fetchErr.message}`);
  process.exit(4);
}
if (fetched.user_email !== canary.user_email || fetched.status !== "grounded" || fetched.feedback !== null) {
  console.error(`  FAIL  round-trip mismatch: ${JSON.stringify(fetched)}`);
  process.exit(5);
}
console.log(`  ok    select round-trip clean (feedback=${fetched.feedback})`);

const { error: delErr } = await sb.from(TABLE).delete().eq("id", inserted.id);
if (delErr) {
  console.error(`  FAIL  delete: ${delErr.code || "?"}: ${delErr.message}`);
  process.exit(6);
}
console.log("  ok    delete (canary cleaned up)");

console.log("\nPASS - pr-7-18 sousai_questions landed and is round-trip usable.");
process.exit(0);

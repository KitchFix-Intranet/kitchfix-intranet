// scripts/_verify-sousai-2-feedback-tags.mjs
// Post-apply probe for sousai-2-feedback-tags.sql.
//
// Run: node --env-file=.env.local scripts/_verify-sousai-2-feedback-tags.mjs
//
// Checks:
//   1. feedback_tags column exists on sousai_questions
//   2. Column type is text[]
//   3. Column is nullable
//   4. INSERT + SELECT round-trip with a tag array works via service_role
//   5. Test row cleaned up

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and service role required");
const sb = createClient(url, key, { auth: { persistSession: false } });

// 1. Column exists + typed correctly - via a round-trip insert.
const testTags = ["wrong_number", "missing_information"];
const { data: inserted, error: insErr } = await sb
  .from("sousai_questions")
  .insert({
    user_email: "probe@kitchfix.com",
    resolved_tier: "slt",
    access_levels: ["unrestricted"],
    question: "PROBE: sousai-2-feedback-tags verify",
    feedback: -1,
    feedback_tags: testTags,
    feedback_comment: "probe row - safe to delete",
    feedback_at: new Date().toISOString(),
  })
  .select("id, feedback_tags")
  .single();

if (insErr) {
  console.error("✗ INSERT with feedback_tags failed:", insErr.message);
  console.error("  → column probably not applied yet, or the wrong type");
  process.exit(1);
}

const roundTripped = inserted.feedback_tags;
if (!Array.isArray(roundTripped)) {
  console.error("✗ feedback_tags did not round-trip as an array:", roundTripped);
  process.exit(2);
}
if (roundTripped.length !== 2 || roundTripped[0] !== "wrong_number") {
  console.error("✗ feedback_tags round-trip mismatch:", roundTripped);
  process.exit(3);
}

console.log(`✓ INSERT+SELECT round-tripped feedback_tags: ${JSON.stringify(roundTripped)}`);

// 2. Clean up the probe row.
const { error: delErr } = await sb.from("sousai_questions").delete().eq("id", inserted.id);
if (delErr) {
  console.error(`⚠ probe row insert succeeded but cleanup failed (id=${inserted.id}):`, delErr.message);
  process.exit(4);
}

console.log(`✓ probe row cleaned up (id=${inserted.id})`);
console.log(`\nsousai-2-feedback-tags: APPLIED and verified.`);

// ─────────────────────────────────────────────────────────────────────────────
// scripts/apply-pr-7-7-poster-summary-fix.mjs
// Project OPD · PR 7.7 · strip build-note artifact from POSTER-001 summary.
//
// Single-field text fix following pr-7-6's go-live batch. POSTER-001's seeded
// summary contained a leaked build note - a parenthetical reading
// "(ID cleaned from POSTER-001.)" that was both (a) a build artifact that
// should never have shipped to operator-facing copy and (b) inaccurate in
// direction (the rename went TO POSTER-001, not FROM it). This script strips
// the trailing parenthetical and leaves the substantive first sentence intact.
//
// Mirrors the apply-pr-7-6 read-validate template - same shape used for any
// per-row catalog text fix going forward.
//
// Usage:
//   node --env-file=.env.local scripts/apply-pr-7-7-poster-summary-fix.mjs
//
// Idempotent: if the summary already matches the target value the UPDATE is
// a no-op (PostgREST returns the row but doesn't actually write).
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const UPDATES = [
  {
    id: "POSTER-001",
    summary: "EN+ES wall posting derived from AGR-001.",
  },
];

let failures = 0;
for (const u of UPDATES) {
  console.log(`────── ${u.id} ──────`);
  const { data: before, error: readErr } = await sb
    .from("documents")
    .select("id, summary")
    .eq("id", u.id)
    .maybeSingle();
  if (readErr || !before) {
    console.error(`  FAIL ${u.id} read: ${readErr?.message || "row not found"}`);
    failures++;
    continue;
  }
  console.log(`BEFORE summary=${JSON.stringify(before.summary)}`);

  const patch = { summary: u.summary, updated_at: new Date().toISOString() };
  const { error: updErr } = await sb
    .from("documents")
    .update(patch)
    .eq("id", u.id);
  if (updErr) {
    console.error(`  FAIL ${u.id} update: ${updErr.code || ""} ${updErr.message}`);
    failures++;
    continue;
  }

  const { data: after, error: rbErr } = await sb
    .from("documents")
    .select("id, summary")
    .eq("id", u.id)
    .maybeSingle();
  if (rbErr || !after) {
    console.error(`  FAIL ${u.id} read-back: ${rbErr?.message || "row not found"}`);
    failures++;
    continue;
  }
  console.log(`AFTER  summary=${JSON.stringify(after.summary)}`);

  if (after.summary === u.summary) {
    console.log(`  ok   ${u.id} summary verified`);
  } else {
    console.error(`  FAIL ${u.id} summary read-back mismatch`);
    failures++;
  }
  console.log();
}

console.log(failures === 0
  ? `PASS — ${UPDATES.length} summary fix applied.`
  : `FAIL — ${failures} issue(s).`);
process.exit(failures === 0 ? 0 : 1);

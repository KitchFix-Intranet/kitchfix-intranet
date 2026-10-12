// scripts/probes/people-changelog-verify.mjs
//
// Verifies the people-3-changelog migration landed with the correct
// structure, CHECK constraints, and grants. Runs against the live DB
// after Kevin applies the migration in Studio.
//
// Pre-apply (table absent): reports "MIGRATION NOT APPLIED", exits 2.
// Any check failure: exits 1 with the specific failure.
// All green: exits 0.
//
// Usage:
//   node --env-file=.env.local scripts/probes/people-changelog-verify.mjs

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("ABSENT: SUPABASE_URL"); process.exit(3); }
if (!SB_KEY) { console.error("ABSENT: SUPABASE_SERVICE_ROLE_KEY"); process.exit(3); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const PROBE_EMAIL = "probe-test@kitchfix.com";

console.log("PEOPLE CHANGELOG VERIFY");
console.log("========================");

const checks = [];
function row(name, ok, detail = "") {
  const pad = (name + ":").padEnd(32, " ");
  console.log(`${pad}${ok ? "✓" : "✗"}${detail ? "  " + detail : ""}`);
  checks.push({ name, ok, detail });
}

// ─── Table exists ─────────────────────────────────────────────────
{
  const { error } = await supa.from("people_changelog").select("id").limit(1);
  if (error && /does not exist|could not find the table/i.test(error.message)) {
    console.log("");
    console.log("MIGRATION NOT APPLIED - people_changelog table is absent.");
    console.log(`  Supabase error: ${error.message}`);
    console.log("");
    console.log("Expected flow:");
    console.log("  1. Paste docs/migrations/people-3-changelog.sql into Supabase Studio");
    console.log("  2. Re-run this probe");
    console.log("");
    console.log("RESULT: MIGRATION NOT APPLIED YET (exit 2)");
    process.exit(2);
  }
  if (error) {
    console.error(`unexpected error on initial SELECT: ${error.message}`);
    process.exit(3);
  }
  row("Table exists", true);
}

// ─── Column_name CHECK rejects bogus column ──────────────────────
{
  const { error } = await supa.from("people_changelog").insert({
    person_email: PROBE_EMAIL,
    column_name: "bogus_column",
    reason: "probe reject-bogus-column",
    changed_by: "probe",
  });
  // Must fail; CHECK constraint violation
  const isCheckViolation = !!error && /check constraint|violates check/i.test(error.message);
  row("Column CHECK (reject)", isCheckViolation, error ? `(${error.message.slice(0, 60)})` : "(unexpectedly accepted bogus column)");
}

// ─── Reason CHECK rejects empty / whitespace ─────────────────────
{
  const { error } = await supa.from("people_changelog").insert({
    person_email: PROBE_EMAIL,
    column_name: "is_ops_leadership",
    reason: "   ",
    changed_by: "probe",
  });
  const isCheckViolation = !!error && /check constraint|violates check/i.test(error.message);
  row("Reason empty CHECK (reject)", isCheckViolation, error ? `(${error.message.slice(0, 60)})` : "(unexpectedly accepted whitespace-only reason)");
}

// ─── Reason CHECK rejects >280 chars ─────────────────────────────
{
  const tooLong = "x".repeat(281);
  const { error } = await supa.from("people_changelog").insert({
    person_email: PROBE_EMAIL,
    column_name: "is_ops_leadership",
    reason: tooLong,
    changed_by: "probe",
  });
  const isCheckViolation = !!error && /check constraint|violates check/i.test(error.message);
  row("Reason length CHECK (reject)", isCheckViolation, error ? `(${error.message.slice(0, 60)})` : "(unexpectedly accepted 281-char reason)");
}

// ─── Valid INSERT succeeds ───────────────────────────────────────
let probeRowId = null;
{
  const { data, error } = await supa.from("people_changelog").insert({
    person_email: PROBE_EMAIL,
    person_name: "Probe Row",
    column_name: "is_ops_leadership",
    old_value: false,
    new_value: true,
    reason: "probe verification run",
    changed_by: "probe",
  }).select("id").single();
  if (error) {
    row("Valid INSERT", false, `(${error.message.slice(0, 80)})`);
  } else {
    probeRowId = data?.id || null;
    row("Valid INSERT", true, probeRowId ? `(id=${probeRowId.slice(0, 8)}...)` : "");
  }
}

// ─── Read back the row ───────────────────────────────────────────
{
  const { data, error } = await supa
    .from("people_changelog")
    .select("id, person_email, column_name, reason")
    .eq("person_email", PROBE_EMAIL)
    .order("changed_at", { ascending: false })
    .limit(1);
  if (error) {
    row("Read back", false, `(${error.message})`);
  } else if (!data || data.length === 0) {
    row("Read back", false, "(no probe row found)");
  } else {
    row("Read back", true, `(found ${data.length} row)`);
  }
}

// ─── UPDATE denied by grant ──────────────────────────────────────
{
  // Capture the row's current reason, attempt UPDATE, see if it changed.
  // Supabase client may return no error even when the grant denies the
  // op (silent zero-affected). Check for actual mutation.
  const { data: before } = await supa
    .from("people_changelog")
    .select("reason")
    .eq("person_email", PROBE_EMAIL)
    .limit(1);
  const beforeReason = before?.[0]?.reason;

  const { error } = await supa
    .from("people_changelog")
    .update({ reason: "MODIFIED - should not persist" })
    .eq("person_email", PROBE_EMAIL);

  const { data: after } = await supa
    .from("people_changelog")
    .select("reason")
    .eq("person_email", PROBE_EMAIL)
    .limit(1);
  const afterReason = after?.[0]?.reason;

  // Pass if either (a) the client surfaced an error, or (b) nothing changed.
  const deniedByError = !!error && /permission|denied|insufficient/i.test(error.message || "");
  const unchanged = beforeReason === afterReason;
  if (deniedByError || unchanged) {
    row("UPDATE denied", true, deniedByError ? "(error surfaced)" : "(silent no-op; grant held)");
  } else {
    row("UPDATE denied", false, `(reason mutated: ${beforeReason} -> ${afterReason})`);
  }
}

// ─── DELETE denied by grant ──────────────────────────────────────
{
  const { data: before } = await supa
    .from("people_changelog")
    .select("id")
    .eq("person_email", PROBE_EMAIL);
  const beforeCount = (before || []).length;

  const { error } = await supa
    .from("people_changelog")
    .delete()
    .eq("person_email", PROBE_EMAIL);

  const { data: after } = await supa
    .from("people_changelog")
    .select("id")
    .eq("person_email", PROBE_EMAIL);
  const afterCount = (after || []).length;

  const deniedByError = !!error && /permission|denied|insufficient/i.test(error.message || "");
  const unchanged = beforeCount === afterCount;
  if (deniedByError || unchanged) {
    row("DELETE denied", true, deniedByError ? "(error surfaced)" : "(silent no-op; grant held)");
  } else {
    row("DELETE denied", false, `(count went ${beforeCount} -> ${afterCount})`);
  }
}

// ─── Summary ──────────────────────────────────────────────────────
console.log("");
const failed = checks.filter((c) => !c.ok);
if (failed.length === 0) {
  console.log("RESULT: PASS");
  process.exit(0);
}
console.log(`RESULT: FAIL  (${failed.length} check(s) failed)`);
for (const c of failed) console.log(`  - ${c.name}: ${c.detail}`);
process.exit(1);

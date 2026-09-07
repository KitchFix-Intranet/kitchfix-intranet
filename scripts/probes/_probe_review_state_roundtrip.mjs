// _probe_review_state_roundtrip.mjs - PR #1047 mount-verify (DB half).
//
// Exercises the sc-42 columns + scReviewState helpers + the sc-review-
// day insert-or-update code path against the real Supabase DB via the
// service-role client. Complements the Playwright mount-verify which
// exercises the CSS/DOM half.
//
// Run:
//   node --env-file=.env.local scripts/probes/_probe_review_state_roundtrip.mjs
//
// The probe uses a synthetic account_key + service_date that will NOT
// collide with any real account (SYN-QA / 1970-01-02). Row inserts +
// updates + clears + reads all fire; every row created is deleted at
// the end. Exit non-zero on any assertion failure.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!SERVICE_KEY)  { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Constants chosen to be BOTH synthetic and pattern-valid per the
// sc_day_metadata CHECK: account_key ~ '^[A-Z]{3}( - [A-Z]{2,})?...' -
// "SYN" alone matches. Date is far in the past so any collision with
// real data is impossible.
const ACCOUNT = "SYN";
const DATE    = "1970-01-02";
const ACTOR   = "probe@kitchfix.com";

let failed = 0;
function ok(msg)   { console.log(`  OK  ${msg}`); }
function fail(msg) { console.error(`  FAIL ${msg}`); failed++; }
function h(msg)    { console.log(`\n[${msg}]`); }

async function cleanup() {
  const { error } = await supa
    .from("sc_day_metadata")
    .delete()
    .eq("account_key", ACCOUNT)
    .eq("service_date", DATE);
  if (error) console.error(`  cleanup DELETE failed: ${error.message}`);
}

try {
  // Guard: ensure nothing leftover from a previous run.
  await cleanup();

  // ─── STEP 1: sc-review-day INSERT path (no metadata row exists) ───
  h("STEP 1 - INSERT branch (no existing metadata row)");
  const now = new Date().toISOString();
  const ins = await supa
    .from("sc_day_metadata")
    .insert({
      account_key:   ACCOUNT,
      service_date:  DATE,
      review_status: "approved",
      reviewed_by:   ACTOR,
      reviewed_at:   now,
      created_by:    ACTOR,
    })
    .select("account_key, service_date, review_status, reviewed_by, reviewed_at, created_by")
    .single();
  if (ins.error) fail(`INSERT failed: ${ins.error.message}`);
  else {
    if (ins.data.review_status !== "approved") fail(`INSERT review_status != approved: got ${ins.data.review_status}`);
    else ok("INSERT wrote review_status=approved");
    if (ins.data.reviewed_by !== ACTOR) fail(`INSERT reviewed_by mismatch`);
    else ok("INSERT wrote reviewed_by");
    if (!ins.data.reviewed_at) fail("INSERT reviewed_at missing");
    else ok("INSERT wrote reviewed_at");
    if (ins.data.created_by !== ACTOR) fail("INSERT created_by mismatch");
    else ok("INSERT wrote created_by (NOT NULL satisfied)");
  }

  // ─── STEP 2: readReviewStateForDays semantics ───
  h("STEP 2 - readReviewStateForDays");
  const read = await supa
    .from("sc_day_metadata")
    .select("service_date, review_status, reviewed_by, reviewed_at")
    .eq("account_key", ACCOUNT)
    .in("service_date", [DATE])
    .order("service_date", { ascending: true });
  if (read.error) fail(`read failed: ${read.error.message}`);
  else if (read.data.length !== 1) fail(`expected 1 row, got ${read.data.length}`);
  else if (read.data[0].review_status !== "approved") fail(`read status != approved`);
  else ok("read returns the approved row");

  // ─── STEP 3: requireAllDaysApproved predicate shape ───
  h("STEP 3 - requireAllDaysApproved");
  // Predicate: dates in the query that have no row (or non-approved
  // status) end up in missingDates. Simulate the helper's map+filter
  // rather than importing (probe stays a single file).
  const byDate = new Map();
  for (const r of read.data) byDate.set(String(r.service_date).slice(0, 10), r);
  const missing = [];
  for (const d of [DATE, "1970-01-03"]) {
    const row = byDate.get(d);
    if (!row || row.review_status !== "approved") missing.push(d);
  }
  if (missing.length !== 1 || missing[0] !== "1970-01-03") {
    fail(`missingDates shape wrong: ${JSON.stringify(missing)}`);
  } else {
    ok("predicate correctly excludes approved dates, includes unknown");
  }

  // ─── STEP 4: sc-review-day UPDATE branch (flag the already-approved day) ───
  h("STEP 4 - UPDATE branch (existing row)");
  const upd = await supa
    .from("sc_day_metadata")
    .update({
      review_status: "flagged",
      reviewed_by:   "flagger@kitchfix.com",
      reviewed_at:   new Date().toISOString(),
    })
    .eq("account_key", ACCOUNT)
    .eq("service_date", DATE)
    .select("review_status, reviewed_by, created_by")
    .single();
  if (upd.error) fail(`UPDATE failed: ${upd.error.message}`);
  else {
    if (upd.data.review_status !== "flagged") fail(`UPDATE status != flagged`);
    else ok("UPDATE flipped status to flagged");
    if (upd.data.reviewed_by !== "flagger@kitchfix.com") fail(`UPDATE reviewed_by not swapped`);
    else ok("UPDATE swapped reviewed_by");
    if (upd.data.created_by !== ACTOR) fail(`UPDATE clobbered created_by: got ${upd.data.created_by}`);
    else ok("UPDATE preserved created_by (immutable)");
  }

  // ─── STEP 5: CHECK constraints fire on bad shape ───
  h("STEP 5 - CHECK constraints");
  // Bad status.
  const bad1 = await supa
    .from("sc_day_metadata")
    .update({ review_status: "SOMEBOGUSVALUE" })
    .eq("account_key", ACCOUNT)
    .eq("service_date", DATE);
  if (bad1.error && /check/i.test(bad1.error.message)) {
    ok("status enum CHECK refuses bogus value");
  } else {
    fail(`status CHECK did not fire: ${JSON.stringify(bad1)}`);
  }
  // Missing actor (status set, reviewed_by nulled).
  const bad2 = await supa
    .from("sc_day_metadata")
    .update({ reviewed_by: null })
    .eq("account_key", ACCOUNT)
    .eq("service_date", DATE);
  if (bad2.error && /check/i.test(bad2.error.message)) {
    ok("actor-required CHECK refuses NULL reviewed_by when status set");
  } else {
    fail(`actor-required CHECK did not fire: ${JSON.stringify(bad2)}`);
  }

  // ─── STEP 6: clearReviewStateForDays semantics ───
  h("STEP 6 - clearReviewStateForDays");
  const clear = await supa
    .from("sc_day_metadata")
    .update({
      review_status: null,
      reviewed_by:   null,
      reviewed_at:   null,
    })
    .eq("account_key", ACCOUNT)
    .in("service_date", [DATE])
    .not("review_status", "is", null)
    .select("service_date");
  if (clear.error) fail(`clear failed: ${clear.error.message}`);
  else if (clear.data.length !== 1) fail(`clear returned ${clear.data.length}, expected 1`);
  else ok("clear NULLed the three columns (returned 1 cleared row)");

  // Re-read - should now show status null.
  const post = await supa
    .from("sc_day_metadata")
    .select("review_status, reviewed_by, reviewed_at, created_by")
    .eq("account_key", ACCOUNT)
    .eq("service_date", DATE)
    .maybeSingle();
  if (post.error) fail(`post-clear read failed: ${post.error.message}`);
  else if (!post.data) fail("row unexpectedly deleted by clear");
  else {
    if (post.data.review_status !== null) fail(`review_status not cleared: ${post.data.review_status}`);
    else ok("review_status is NULL post-clear");
    if (post.data.reviewed_by !== null) fail(`reviewed_by not cleared`);
    else ok("reviewed_by is NULL post-clear");
    if (post.data.reviewed_at !== null) fail(`reviewed_at not cleared`);
    else ok("reviewed_at is NULL post-clear");
    if (post.data.created_by !== ACTOR) fail("created_by lost during clear");
    else ok("created_by preserved through clear");
  }

  // ─── STEP 7: idempotent clear (no rows to update) ───
  h("STEP 7 - idempotent clear on already-clear row");
  const clearAgain = await supa
    .from("sc_day_metadata")
    .update({ review_status: null, reviewed_by: null, reviewed_at: null })
    .eq("account_key", ACCOUNT)
    .in("service_date", [DATE])
    .not("review_status", "is", null)
    .select("service_date");
  if (clearAgain.error) fail(`re-clear errored: ${clearAgain.error.message}`);
  else if (clearAgain.data.length !== 0) fail(`re-clear should return 0 rows, got ${clearAgain.data.length}`);
  else ok("re-clear is a no-op (0 rows returned)");

  // ─── STEP 8: sc_daily_revenue view reads the new columns' shape? ───
  //     The view does not surface review columns (by design - see
  //     sc-1-service-calendar-schema.sql :340-383). Confirm the columns
  //     are NOT accidentally exposed on the billing surface.
  h("STEP 8 - sc_daily_revenue does not expose review columns");
  const viewProbe = await supa
    .from("sc_daily_revenue")
    .select("service_date, review_status")
    .limit(1);
  if (viewProbe.error && /column .*review_status.*does not exist/i.test(viewProbe.error.message)) {
    ok("sc_daily_revenue does not expose review_status (billing surface stays clean)");
  } else {
    fail(`sc_daily_revenue unexpectedly exposes review_status - view may need audit: ${JSON.stringify(viewProbe)}`);
  }
} finally {
  await cleanup();
}

if (failed > 0) {
  console.error(`\n[probe] ${failed} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\n[probe] all assertions passed");

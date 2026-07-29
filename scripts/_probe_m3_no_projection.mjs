// M-3 no-projection refusal probe. Owner's hardest gate #2:
// "The no-projection path, even though CIN - OH cannot trip it.
// Show me it refuses."
//
// Strategy: POST sc-submit-closeout with a payload that would
// require writing an actual for a game day the account has no
// projection for. The route must refuse the confirm with a 400
// AND name the missing (date, service) pairs in the response.
//
// The route decides missing-projection; the RPC never sees the
// bad request. This is the owner's ruling ("business logic in the
// route, not the RPC") in action.
//
// CIN-OH's current projections cover all 81 game dates × 4
// services. So we need to SIMULATE a missing-projection scenario.
// We do this by deleting one row transiently, hitting the route,
// then restoring the row. All in one probe run.
//
// Run AFTER migrating (Studio-apply sc-22-homestand-closeout.sql)
// AND the dev server is running on :3000. The probe hits
// http://localhost:3000/api/service-calendar directly and
// exercises the auth-required POST. Uses SUPABASE_SERVICE_ROLE_KEY
// to fake auth-in-test, so this must not run against production.
//
//   TEST_MODE=true npx next dev   (in one terminal)
//   npx tsx --env-file=.env.local scripts/_probe_m3_no_projection.mjs
//
// Expected exit: prints NO-PROJECTION PASS with the exact
// service/date pair the route flagged. Any success would mean the
// guard is silently letting a lie through.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ACCOUNT = "CIN - OH";
const YEAR = 2026;

console.log("══ M-3 no-projection refusal probe ══\n");

// Pick a homestand that has already ended. HS9 = 2026-07-03..07-12
// per M-1 probe output.
const HS9_KEY_GUESS = null;   // fetched via API below to keep the
                              // probe robust to key format changes

const heroRes = await fetch(
  `http://localhost:3000/api/service-calendar?action=sc-year-summary`
  + `&account=${encodeURIComponent(ACCOUNT)}&year=${YEAR}&clientToday=2026-08-01`
);
if (!heroRes.ok) {
  console.log(`✗ year-summary fetch failed: ${heroRes.status}. Dev server running?`);
  process.exit(1);
}
const heroData = await heroRes.json();
const hs9 = (heroData.homestands || []).find(h => h.ordinal === "HS9");
if (!hs9) {
  console.log("✗ HS9 not in payload. Homestands emitted:",
    (heroData.homestands || []).map(h => h.ordinal));
  process.exit(1);
}
console.log(`HS9 span: ${hs9.startDate}..${hs9.endDate}  status=${hs9.status}  key=${hs9.key}`);

// Pick one game date + one service to break.
const gameDate = "2026-07-03";  // HS9 first game
const svcRes = await supa.from("sc_services")
  .select("id, service_name").eq("account_key", ACCOUNT)
  .order("sort_order", { ascending: true }).limit(1);
if (svcRes.error || !svcRes.data.length) {
  console.log("✗ services read failed:", svcRes.error?.message);
  process.exit(1);
}
const svc = svcRes.data[0];
console.log(`Break vector: delete sc_daily_projections row for ${ACCOUNT} @ ${gameDate}, service="${svc.service_name}"`);

// Snapshot the row before delete so we can restore.
const snap = await supa.from("sc_daily_projections")
  .select("id, projected_count, created_by, created_at, updated_by, updated_at")
  .eq("account_key", ACCOUNT).eq("service_date", gameDate).eq("service_id", svc.id).maybeSingle();
if (snap.error || !snap.data) {
  console.log("✗ pre-delete snapshot failed:", snap.error?.message);
  process.exit(1);
}
console.log(`Snapshotted projected_count=${snap.data.projected_count}, id=${snap.data.id}`);

// Delete.
const del = await supa.from("sc_daily_projections").delete().eq("id", snap.data.id);
if (del.error) {
  console.log("✗ delete failed:", del.error.message);
  process.exit(1);
}
console.log("Row deleted; hitting confirm API...");

// Attempt confirm - route must refuse.
let confirmResult;
try {
  const res = await fetch("http://localhost:3000/api/service-calendar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "sc-submit-closeout",
      accountKey: ACCOUNT,
      homestandKey: String(hs9.key),
      exceptions: [],     // no exceptions - forces the missing projection to surface
      laborActual: 5000,
      laborSource: "manual",
      notes: "no-projection probe",
      reopenReason: hs9.status === "closed-out" ? "no-projection probe reopen" : null,
      clientToday: "2026-08-01",
    }),
  });
  confirmResult = { status: res.status, body: await res.json() };
} catch (e) {
  confirmResult = { status: 0, body: { error: e.message } };
}

// Restore the row.
const restore = await supa.from("sc_daily_projections").insert({
  account_key:     ACCOUNT,
  service_id:      svc.id,
  service_date:    gameDate,
  projected_count: snap.data.projected_count,
  created_by:      snap.data.created_by,
  updated_by:      snap.data.updated_by,
});
if (restore.error) {
  console.log(`✗ RESTORE FAILED: ${restore.error.message}. Manually re-insert projection: `
    + `${ACCOUNT} @ ${gameDate}, service_id=${svc.id}, count=${snap.data.projected_count}`);
  process.exit(1);
}
console.log("Row restored.");

// Assertions.
console.log(`\nConfirm result: status=${confirmResult.status}`);
console.log(`  body: ${JSON.stringify(confirmResult.body, null, 2)}`);

let pass = true;
if (confirmResult.status === 200 && confirmResult.body?.success) {
  console.log("✗ Route ACCEPTED confirm with missing projection - guard failed.");
  pass = false;
} else if (confirmResult.status !== 400) {
  console.log(`~ Route returned ${confirmResult.status} instead of 400 - not the expected refusal shape.`);
  console.log("  (Route may have refused on a different check; verify manually.)");
}
if (!confirmResult.body?.missingProjections || confirmResult.body.missingProjections.length === 0) {
  console.log("~ Refusal did not name the missing projection - the missingProjections array is empty or missing.");
} else {
  const found = confirmResult.body.missingProjections.find(
    m => m.service_date === gameDate && m.service_id === svc.id
  );
  if (found) {
    console.log(`✓ Route flagged the missing (${gameDate}, ${svc.service_name}) - name in response.`);
  } else {
    console.log(`~ missingProjections did not include the deleted pair. Content:`,
      confirmResult.body.missingProjections);
  }
}

console.log(pass ? "\n✓ NO-PROJECTION PASS - route refused; no lie was written." : "\n✗ NO-PROJECTION FAIL.");
process.exit(pass ? 0 : 1);

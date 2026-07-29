// M-3 no-projection refusal probe. Owner's hardest gate #2:
// "The no-projection path, even though CIN - OH cannot trip it.
// Show me it refuses."
//
// Strategy: transiently DELETE one sc_daily_projections row for
// CIN - OH on an HS9 game day, then POST sc-submit-closeout. The
// route must refuse the confirm with a 400 AND name the missing
// (date, service) pair. Then restore the projection and verify
// zero writes landed on either sc_daily_actuals or
// sc_homestand_closeout.
//
// RUNNING - requires an authenticated bypass. NextAuth guards the
// route at TWO layers:
//   (1) src/middleware.js line 16 - the TEST_MODE/VERCEL bypass releases
//       the redirect-to-login, but only that.
//   (2) src/app/api/service-calendar/route.js line 318-319 does its OWN
//       `await auth()` and returns 401 without a session. TEST_MODE
//       does NOT bypass this; it needs a real session cookie.
//
// The probe therefore mints a NextAuth v5 JWE session token from
// AUTH_SECRET (loaded via --env-file=.env.local) and sends it as the
// `authjs.session-token` cookie. `sc-submit-closeout` has no
// `isScAdmin` guard - it needs only a session with an email - so the
// synthetic session is enough. The signed token is scoped to the
// probe process; the running server accepts it because AUTH_SECRET
// matches.
//
// IDENTITY MATTERS. The token names `probe@kitchfix.com`, NOT a real
// operator. This probe is read-only against the confirm path today,
// but any future run that DOES write would stamp created_by /
// updated_by / superseded_by / reopened_by with whoever this token
// names, and the audit trail is the whole point of the ledger's
// design. Do not change this identity to a real user "to make the
// session look valid." The route accepts any signed session; the
// trail exists to name whoever moved money, and a probe did not.
//
// Two-step recipe:
//
//   npx next build
//   TEST_MODE=true PORT=3100 npx next start &
//   TSX_TSCONFIG_PATH=./jsconfig.json npx --yes tsx \
//     --env-file=.env.local scripts/_probe_m3_no_projection.mjs
//
// The `next start` on :3100 coexists with the owner's :3000 dev
// (`next start` has no dev lockfile).
//
// The probe reads before-state, injects the break, POSTs, reads
// after-state, restores. Prints:
//   - HTTP status and body verbatim
//   - projection row: before-delete count, after-delete count,
//     after-restore count
//   - sc_daily_actuals count for CIN - OH: before and after the POST
//   - sc_homestand_closeout row count for CIN - OH: before and after
//
// Exit code: 0 iff every assertion holds AND state is restored.

import { createClient } from "@supabase/supabase-js";
import { encode as encodeAuthJwt } from "next-auth/jwt";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const BASE_URL = process.env.PROBE_BASE_URL || "http://localhost:3100";
const ACCOUNT = "CIN - OH";
const YEAR = 2026;

// Cookie name: unprefixed on HTTP (per @auth/core cookie rules).
// BASE_URL starts with http:// on :3100, so no __Secure- prefix.
const COOKIE_NAME = BASE_URL.startsWith("https://")
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";

const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
if (!secret) {
  console.log("✗ AUTH_SECRET missing from env - probe must run with --env-file=.env.local");
  process.exit(1);
}
// Salt for JWE is the cookie name (@auth/core convention).
// jwt callback in src/lib/auth.js line 42 short-circuits when
// token.expiresAt is set to a future value - avoids the Google
// refresh path that would fail with a synthetic refreshToken.
const inOneHour = Math.floor(Date.now() / 1000) + 3600;
const sessionCookie = await encodeAuthJwt({
  token: {
    // See header "IDENTITY MATTERS": probe identity, NOT a real operator.
    email:      "probe@kitchfix.com",
    name:       "M-3 Probe",
    sub:        "m3-probe",
    expiresAt:  inOneHour,
  },
  secret,
  salt:   COOKIE_NAME,
  maxAge: 3600,
});
const COOKIE_HEADER = `${COOKIE_NAME}=${sessionCookie}`;

console.log(`══ M-3 no-projection refusal probe (${BASE_URL}) ══\n`);

// ── 1. Load the year summary to find HS9 (the CIN-OH ended block). ──
const heroRes = await fetch(
  `${BASE_URL}/api/service-calendar?action=sc-year-summary`
  + `&account=${encodeURIComponent(ACCOUNT)}&year=${YEAR}&clientToday=2026-08-01`,
  { headers: { cookie: COOKIE_HEADER } },
);
if (!heroRes.ok) {
  console.log(`✗ year-summary fetch failed: ${heroRes.status}`);
  process.exit(1);
}
const heroData = await heroRes.json();
const hs9 = (heroData.homestands || []).find(h => h.ordinal === "HS9");
if (!hs9) {
  console.log("✗ HS9 not in payload. Homestands emitted:",
    (heroData.homestands || []).map(h => h.ordinal));
  process.exit(1);
}
console.log(`HS9: ${hs9.startDate}..${hs9.endDate}  status=${hs9.status}  key=${hs9.key}`);

// ── 2. Pick one game date + one service to break. ──
const gameDate = "2026-07-03";  // HS9 first game
const svcRes = await supa.from("sc_services")
  .select("id, service_name").eq("account_key", ACCOUNT)
  .order("sort_order", { ascending: true }).limit(1);
if (svcRes.error || !svcRes.data.length) {
  console.log("✗ services read failed:", svcRes.error?.message);
  process.exit(1);
}
const svc = svcRes.data[0];
console.log(`Break vector: ${ACCOUNT} @ ${gameDate}, service="${svc.service_name}" (id=${svc.id})`);

// ── 3. Snapshot the row before delete. ──
const snap = await supa.from("sc_daily_projections")
  .select("id, projected_count, created_by, created_at, updated_by, updated_at")
  .eq("account_key", ACCOUNT).eq("service_date", gameDate).eq("service_id", svc.id)
  .maybeSingle();
if (snap.error || !snap.data) {
  console.log("✗ pre-delete snapshot failed:", snap.error?.message);
  process.exit(1);
}
console.log(`Snapshotted projected_count=${snap.data.projected_count}, id=${snap.data.id}`);

// ── 4. Snapshot state before the probe touches anything. ──
async function actualsCountInSpan(startDate, endDate) {
  const r = await supa.from("sc_daily_actuals")
    .select("id", { count: "exact", head: true })
    .eq("account_key", ACCOUNT)
    .gte("service_date", startDate).lte("service_date", endDate);
  return r.count;
}
async function projRowCount() {
  const r = await supa.from("sc_daily_projections")
    .select("id", { count: "exact", head: true })
    .eq("account_key", ACCOUNT)
    .eq("service_date", gameDate).eq("service_id", svc.id);
  return r.count;
}
async function closeoutCount() {
  const r = await supa.from("sc_homestand_closeout")
    .select("id", { count: "exact", head: true })
    .eq("account_key", ACCOUNT)
    .eq("homestand_key", String(hs9.key));
  return r.count;
}

const projBefore = await projRowCount();
const actualsBefore = await actualsCountInSpan(hs9.startDate, hs9.endDate);
const closeoutBefore = await closeoutCount();
console.log(`\n[before]`);
console.log(`  sc_daily_projections rows for target pair : ${projBefore} (expected 1)`);
console.log(`  sc_daily_actuals in HS9 span              : ${actualsBefore}`);
console.log(`  sc_homestand_closeout rows for HS9        : ${closeoutBefore}`);

// ── 5. Delete the row. ──
const del = await supa.from("sc_daily_projections").delete().eq("id", snap.data.id);
if (del.error) {
  console.log("✗ delete failed:", del.error.message);
  process.exit(1);
}
const projAfterDelete = await projRowCount();
console.log(`\n[after-delete]`);
console.log(`  sc_daily_projections rows for target pair : ${projAfterDelete} (expected 0)`);

// ── 6. Hit the confirm API. Must refuse. ──
let confirmResult;
try {
  const res = await fetch(`${BASE_URL}/api/service-calendar`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: COOKIE_HEADER },
    body: JSON.stringify({
      action: "sc-submit-closeout",
      accountKey: ACCOUNT,
      homestandKey: String(hs9.key),
      exceptions: [],              // no exceptions - forces the missing projection to surface
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

console.log(`\n[confirm POST]`);
console.log(`  HTTP status: ${confirmResult.status}`);
console.log(`  Response body:`);
console.log(JSON.stringify(confirmResult.body, null, 2).split("\n").map(l => `    ${l}`).join("\n"));

// ── 7. Read after-state BEFORE restore, so we prove the refused POST
//    wrote nothing (not just "we restored so we can't tell").
const actualsAfterPost = await actualsCountInSpan(hs9.startDate, hs9.endDate);
const closeoutAfterPost = await closeoutCount();
console.log(`\n[after-POST, before-restore]`);
console.log(`  sc_daily_actuals in HS9 span              : ${actualsAfterPost}`);
console.log(`  sc_homestand_closeout rows for HS9        : ${closeoutAfterPost}`);

// ── 8. Restore the projection row and verify. ──
const restore = await supa.from("sc_daily_projections").insert({
  account_key:     ACCOUNT,
  service_id:      svc.id,
  service_date:    gameDate,
  projected_count: snap.data.projected_count,
  created_by:      snap.data.created_by,
  updated_by:      snap.data.updated_by,
});
if (restore.error) {
  console.log(`\n✗ RESTORE FAILED: ${restore.error.message}`);
  console.log(`  Manually re-insert: ${ACCOUNT} @ ${gameDate}, service_id=${svc.id}, count=${snap.data.projected_count}`);
  process.exit(1);
}
const projAfterRestore = await projRowCount();
console.log(`\n[after-restore]`);
console.log(`  sc_daily_projections rows for target pair : ${projAfterRestore} (expected 1)`);

// ── 9. Assertions. ──
console.log(`\n[assertions]`);
let pass = true;
function assert(name, cond) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) pass = false;
}
assert(
  "HTTP 400 refusal",
  confirmResult.status === 400
);
assert(
  "success === false",
  confirmResult.body?.success === false
);
assert(
  "missingProjections array named the deleted pair",
  Array.isArray(confirmResult.body?.missingProjections)
    && confirmResult.body.missingProjections.some(
      m => m.service_date === gameDate && m.service_id === svc.id
    )
);
assert(
  "sc_daily_actuals in HS9 span unchanged",
  actualsAfterPost === actualsBefore
);
assert(
  "sc_homestand_closeout for HS9 unchanged",
  closeoutAfterPost === closeoutBefore
);
assert(
  "projection row restored",
  projAfterRestore === projBefore
);

console.log(pass ? "\n✓ NO-PROJECTION PASS - refused, no writes, projection restored."
                 : "\n✗ NO-PROJECTION FAIL.");
process.exit(pass ? 0 : 1);

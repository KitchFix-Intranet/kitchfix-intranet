#!/usr/bin/env node
// scripts/probes/admin-stage2-auth-verify.mjs
//
// Stage 2 verification. Mirrors the 4a/4b/4c/4d probe shape.
//
// Static checks against src/app/api/people/route.js plus the two
// retained-import sanity checks.
//
// Run:
//   node --env-file=.env.local scripts/probes/admin-stage2-auth-verify.mjs

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) {
    console.error(`\n[STAGE-2] ${k}: ABSENT - restore and re-run.`);
    process.exit(1);
  }
}

const PEOPLE = "src/app/api/people/route.js";
const src = fs.readFileSync(path.join(ROOT, PEOPLE), "utf8");

const results = [];
function record(name, pass, detail) { results.push({ name, pass, detail }); }

// ─── 1. Auth imports present ──────────────────────────────────────
record(
  `${PEOPLE}: imports auth from @/lib/auth`,
  /import\s*\{\s*auth\s*\}\s*from\s*"@\/lib\/auth"/.test(src),
  "static import check"
);
record(
  `${PEOPLE}: imports isOpsLeadershipDb from @/lib/admin`,
  /import\s*\{\s*isOpsLeadershipDb\s*\}\s*from\s*"@\/lib\/admin"/.test(src),
  "static import check"
);

// ─── 2. Session derivation in place ───────────────────────────────
record(
  `${PEOPLE}: GET handler awaits auth()`,
  /await\s+auth\(\)/.test(src),
  "await auth() present"
);
record(
  `${PEOPLE}: session?.user?.email read`,
  /session\?\.user\?\.email/.test(src),
  "optional-chained email read"
);
{
  const hit = src.match(/searchParams\.get\(["']email["']\)/);
  record(
    `${PEOPLE}: searchParams.get("email") NOT present (client-supplied id gone)`,
    !hit,
    hit ? `still present: ${hit[0]}` : "clean"
  );
}

// ─── 3. Sheets admin check removed ────────────────────────────────
record(
  `${PEOPLE}: SHEETS.ADMINS NOT referenced`,
  !/SHEETS\.ADMINS/.test(src),
  !/SHEETS\.ADMINS/.test(src) ? "clean" : "still referenced"
);
record(
  `${PEOPLE}: no readSheetSA(SHEET_IDS.HUB, SHEETS.ADMINS) call`,
  !/readSheetSA\(\s*SHEET_IDS\.HUB\s*,\s*SHEETS\.ADMINS\s*\)/.test(src),
  "clean"
);
// The string "admins" should only appear inside a comment within the
// SHEETS constant (the "ADMINS removed" comment itself), not as a
// value (`ADMINS: "admins"`).
record(
  `${PEOPLE}: 'admins' not a value in SHEETS constant`,
  !/ADMINS:\s*"admins"/.test(src),
  "no ADMINS: 'admins' entry"
);
record(
  `${PEOPLE}: admins.rows NOT referenced`,
  !/\badmins\.rows\b/.test(src),
  "clean"
);

// ─── 4. DB-backed check wired ─────────────────────────────────────
record(
  `${PEOPLE}: isOpsLeadershipDb(userEmail) call-site`,
  /isOpsLeadershipDb\(\s*userEmail\s*\)/.test(src),
  "call-site present"
);
record(
  `${PEOPLE}: isAdmin still returned to the client`,
  /\bisAdmin\b/.test(src),
  "variable preserved"
);

// ─── 5. Promise.all count ─────────────────────────────────────────
// Grab the bootstrap Promise.all block and count destructured names.
{
  const m = src.match(/const\s+\[([^\]]+)\]\s*=\s*await\s+Promise\.all\(/);
  const names = m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
  record(
    `${PEOPLE}: bootstrap Promise.all destructures exactly 5 items`,
    names.length === 5,
    `${names.length} items: [${names.join(", ")}]`
  );
  const expected = ["accounts", "contacts", "submissions", "heroImages", "drafts"];
  record(
    `${PEOPLE}: Promise.all names match expected set`,
    JSON.stringify(names) === JSON.stringify(expected),
    `expected [${expected.join(", ")}], got [${names.join(", ")}]`
  );
}

// ─── 6. No collateral damage ──────────────────────────────────────
record(
  `${PEOPLE}: POST handler still uses submitterEmail`,
  /\bsubmitterEmail\b/.test(src),
  "preserved"
);
record(
  `${PEOPLE}: getSubmissions still in bootstrap`,
  /getSubmissions\(\s*\{\s*module:\s*"people"\s*\}\s*\)/.test(src),
  "preserved"
);
record(
  `${PEOPLE}: no OPS_LEADERSHIP_EMAILS import snuck in`,
  !/OPS_LEADERSHIP_EMAILS/.test(src),
  !/OPS_LEADERSHIP_EMAILS/.test(src) ? "clean" : "symbol appears"
);

// ─── Report ───────────────────────────────────────────────────────
console.log("");
console.log("ADMIN STAGE-2 AUTH VERIFY");
console.log("=========================");
let allPass = true;
for (const r of results) {
  const tag = r.pass ? "PASS ✓" : "FAIL ✗";
  console.log(`${r.name.padEnd(80)} ${tag}  ${r.detail}`);
  if (!r.pass) allPass = false;
}
console.log("");
console.log(`RESULT: ${allPass ? "ALL PASS" : "FAIL - see rows above"}`);
process.exit(allPass ? 0 : 1);

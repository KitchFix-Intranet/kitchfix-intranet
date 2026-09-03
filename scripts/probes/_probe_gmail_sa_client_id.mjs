// ═══════════════════════════════════════════════════════════════════
// _probe_gmail_sa_client_id.mjs
// 2026-09-03
// ═══════════════════════════════════════════════════════════════════
//
// Fetch the numeric OAuth client_id of the Gmail service account
// used by sendEmailSA. This is the value Google Workspace admin
// requires when configuring / verifying domain-wide delegation.
//
// Method: authenticate as the SA via GOOGLE_SERVICE_ACCOUNT_EMAIL +
// GOOGLE_PRIVATE_KEY, then GET the tokeninfo endpoint to have
// Google echo back the SA's own oauth identity attributes. The
// numeric client_id lives at `azp` (authorized party) on the
// tokeninfo response - that IS the DWD lookup key.
//
// This probe does NOT read .env.local directly (per USE-not-SEE
// env rule). Node loads the env via --env-file; the script
// authenticates via process.env, hits Google's API, and prints
// only the API-returned client_id (a public identity attribute,
// not a credential).
//
// Run:
//   cd /Users/kevinfietek/dev/kf-sc-39
//   node --env-file=.env.local scripts/probes/_probe_gmail_sa_client_id.mjs
// ═══════════════════════════════════════════════════════════════════

import { google } from "googleapis";

if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
  console.error("ABSENT: GOOGLE_SERVICE_ACCOUNT_EMAIL");
  process.exit(2);
}
if (!process.env.GOOGLE_PRIVATE_KEY) {
  console.error("ABSENT: GOOGLE_PRIVATE_KEY");
  process.exit(2);
}

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/gmail.send"],
  // no `subject` - we want the SA's own identity, not an impersonated user
});

const { access_token } = await auth.authorize();
if (!access_token) {
  console.error("HALT: JWT authorize returned no access_token");
  process.exit(1);
}

const res = await fetch(
  `https://oauth2.googleapis.com/tokeninfo?access_token=${access_token}`,
);
const info = await res.json();

if (!info.azp) {
  console.error("HALT: tokeninfo response missing `azp` field");
  console.error(JSON.stringify(info, null, 2));
  process.exit(1);
}

console.log(`client_id (azp): ${info.azp}`);
console.log(`email (SA):      ${info.email || "(not returned)"}`);
console.log("");
console.log("Use client_id above in Google Workspace Admin ->");
console.log("  Security -> Access and data control -> API controls ->");
console.log("  Manage Domain Wide Delegation.");
console.log("Confirm the row for this client_id lists");
console.log("  https://www.googleapis.com/auth/gmail.send");
console.log("and is scoped for the workspace domain (kitchfix.com).");

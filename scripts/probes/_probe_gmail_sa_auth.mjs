#!/usr/bin/env node
/**
 * Diagnose which component of the Gmail service-account auth is
 * rejecting the token exchange. Nightly `purchasing-report-ingest`
 * has been failing with `read 401` since 2026-10-26 and the Actions
 * log carries the Google error verbatim:
 *   READ FAILED code=401 msg=unauthorized_client: Client is
 *   unauthorized to retrieve access tokens using this method, or
 *   client not authorized for any of the scopes requested.
 *
 * This probe reproduces the token exchange and nothing else. It
 * NEVER prints, truncates, masks, hashes, or slices a secret - the
 * only outputs are `PRESENT` / `ABSENT` per env key and whatever
 * Google itself returns in the OAuth error body
 * (`error` / `error_description`).
 *
 * Interpretation guide (from the Google OAuth 2.0 service-account
 * docs + Workspace admin console):
 *   - `unauthorized_client` -> the client ID is not configured for
 *                              domain-wide delegation on the
 *                              requested scope. Fix: Workspace admin
 *                              > Security > Access and data control
 *                              > API controls > Domain-wide
 *                              delegation. Add / re-add the client
 *                              with `gmail.readonly`.
 *   - `invalid_grant`       -> the key is no longer accepted (key
 *                              rotated or deleted in GCP, or the
 *                              service account was disabled). Fix:
 *                              GCP console > IAM > Service accounts
 *                              > the SA > Keys. Create a new key and
 *                              rotate the `GOOGLE_PRIVATE_KEY` repo
 *                              secret.
 *   - `invalid_scope`       -> the requested scope is not valid for
 *                              a service account.
 *   - 403 from Gmail        -> auth passed but the mailbox refused
 *                              (suspended account, alias changed,
 *                              etc.). This probe would exit 0 on
 *                              the token exchange and not surface
 *                              that - handled by the follow-up
 *                              messages.list call below.
 *
 * CLI:
 *   node --env-file=/path/to/.env.local scripts/probes/_probe_gmail_sa_auth.mjs
 *
 * Exit codes:
 *   0  token exchange succeeded (and a messages.list probe returned OK)
 *   1  configuration missing or token exchange failed
 */
import { google } from "googleapis";

function pres(name) {
  const v = process.env[name];
  console.log(`env ${name.padEnd(32)}: ${v ? "PRESENT" : "ABSENT"}`);
  return !!v;
}

// --mailbox=<addr> lets the caller inject the mailbox at the CLI
// when it is not in the local .env.local (nightly stores it in GH
// Actions secrets, not in dev envs). The address is NOT echoed; it
// is used only as the JWT `subject` claim, same as production.
let mailboxOverride = null;
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--mailbox=")) mailboxOverride = a.slice("--mailbox=".length);
  else { console.error(`unknown arg: ${a}`); process.exit(1); }
}

console.log(`gmail_sa_auth_probe started=${new Date().toISOString()}`);
const okEmail   = pres("GOOGLE_SERVICE_ACCOUNT_EMAIL");
const okKey     = pres("GOOGLE_PRIVATE_KEY");
const okMailboxEnv = pres("RIPPLING_REPORT_MAILBOX_ADDRESS");
const okMailboxCli = !!mailboxOverride;
if (okMailboxCli) console.log(`arg --mailbox=                   : PRESENT`);
const okMailbox = okMailboxEnv || okMailboxCli;
if (!okEmail || !okKey || !okMailbox) {
  console.error("");
  console.error("STOP: one or more required inputs ABSENT. See above.");
  console.error("      Pass --mailbox=<addr> if RIPPLING_REPORT_MAILBOX_ADDRESS");
  console.error("      is not in the local env (it is a GH Actions secret).");
  process.exit(1);
}

const saEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const saKey   = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
const mailbox = mailboxOverride || process.env.RIPPLING_REPORT_MAILBOX_ADDRESS;

// Mirror the production shape exactly - same client (googleapis),
// same JWT class, same single read-only scope, same subject
// (impersonated mailbox).
const auth = new google.auth.JWT({
  email: saEmail,
  key: saKey,
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  subject: mailbox,
});

// Step 1 - token exchange. This is the only call where
// `unauthorized_client` vs `invalid_grant` can distinguish the
// delegation case from the key-rotated case.
console.log("");
console.log("step 1: token exchange ...");
try {
  await auth.authorize();
  console.log("  OK: authorize() returned without error");
} catch (e) {
  const code = e?.code || e?.response?.status || "n/a";
  const errBody = e?.response?.data || null;
  // Google's token endpoint returns {error, error_description} on
  // failure. Node's wrapper surfaces the HTTP status on e.code and
  // the body on e.response.data. Print both verbatim; neither
  // contains a secret.
  console.error("  FAIL token exchange:");
  console.error(`    http_status      : ${code}`);
  console.error(`    error            : ${errBody?.error ?? e?.message ?? "n/a"}`);
  console.error(`    error_description: ${errBody?.error_description ?? "n/a"}`);
  console.error("");
  if (errBody?.error === "unauthorized_client") {
    console.error("  Likely cause: Workspace domain-wide delegation. The service");
    console.error("  account's client ID is not authorized for gmail.readonly on");
    console.error("  the Workspace domain. Fix in Workspace admin, not in GCP.");
  } else if (errBody?.error === "invalid_grant") {
    console.error("  Likely cause: GOOGLE_PRIVATE_KEY no longer accepted (key");
    console.error("  rotated or deleted in GCP, or the service account was");
    console.error("  disabled). Fix in GCP console, not in Workspace admin.");
  }
  process.exit(1);
}

// Step 2 - make the simplest possible Gmail call, same scope and
// subject. This distinguishes an auth-passed-but-mailbox-rejected
// state (403 on the mailbox) from a plain auth failure. The call
// lists at most one message and ignores the result.
console.log("");
console.log("step 2: messages.list (q=in:anywhere, maxResults=1) ...");
try {
  const gmail = google.gmail({ version: "v1", auth });
  const resp = await gmail.users.messages.list({ userId: "me", q: "in:anywhere", maxResults: 1 });
  const count = resp?.data?.messages?.length ?? 0;
  console.log(`  OK: messages.list returned (messages array length = ${count}; resultSizeEstimate = ${resp?.data?.resultSizeEstimate ?? "n/a"})`);
} catch (e) {
  const code = e?.code || e?.response?.status || "n/a";
  const errBody = e?.response?.data || null;
  console.error("  FAIL messages.list:");
  console.error(`    http_status: ${code}`);
  console.error(`    error      : ${errBody?.error?.message ?? e?.message ?? "n/a"}`);
  process.exit(1);
}

console.log("");
console.log("probe PASS: token exchange + Gmail read both succeeded.");
process.exit(0);

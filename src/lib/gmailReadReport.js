/**
 * gmailReadReport.js - service-account-impersonated read of the
 * scheduled Rippling report email.
 *
 * READ-ONLY BY CONSTRUCTION.  The auth scope is
 * `https://www.googleapis.com/auth/gmail.readonly` - a single string
 * from which the token cannot send, modify, delete, trash, or mark
 * anything.  This file never imports `gmail.users.messages.send`,
 * `.modify`, `.trash`, `.delete`, or `.batchModify`.  If a future edit
 * adds any of those calls it must also broaden the scope, which is a
 * red flag to the reviewer.
 *
 * Config comes from env - `RIPPLING_REPORT_MAILBOX_ADDRESS` for the
 * impersonated inbox and `RIPPLING_REPORT_SUBJECT_FILTER` for the
 * Gmail search query that finds today's report.  Neither is hardcoded.
 *
 * The 26-hour staleness gate is factored out as `checkFresh(...)` so
 * a probe can prove it fires without needing a real Gmail message.
 */
import { google } from "googleapis";
import { promises as fs } from "node:fs";
import path from "node:path";

/** How stale is too stale.  26h absorbs a schedule that drifts by an
 *  hour without false-firing.  Owner ruling INV-P20 scoping. */
const STALENESS_LIMIT_MS = 26 * 60 * 60 * 1000;

/**
 * Pure function - throws `REPORT_STALE` when the newest matching
 * message is older than the staleness window.  Separated so the probe
 * can seed a mock message and prove the throw.
 *
 * @param {number|string} internalDateMs - Gmail `internalDate` (ms since epoch, string or number)
 * @param {number} [nowMs=Date.now()] - injectable clock for tests
 * @returns {number} ageHours (only when fresh)
 * @throws Error with `.code = 'REPORT_STALE'`
 */
export function checkFresh(internalDateMs, nowMs = Date.now()) {
  if (internalDateMs == null) {
    const err = new Error(`REPORT_STALE: internalDate missing or unparseable (got ${JSON.stringify(internalDateMs)})`);
    err.code = "REPORT_STALE";
    throw err;
  }
  const idate = Number(internalDateMs);
  if (!Number.isFinite(idate) || idate <= 0) {
    const err = new Error(`REPORT_STALE: internalDate missing or unparseable (got ${JSON.stringify(internalDateMs)})`);
    err.code = "REPORT_STALE";
    throw err;
  }
  const ageMs = nowMs - idate;
  const ageHours = Math.round(ageMs / 3600000 * 10) / 10;
  if (ageMs > STALENESS_LIMIT_MS) {
    const err = new Error(`REPORT_STALE: newest matching email is ${ageHours}h old (limit 26h)`);
    err.code = "REPORT_STALE";
    err.ageHours = ageHours;
    throw err;
  }
  return ageHours;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error(`CONFIG_MISSING: env ${name} not set`);
    err.code = "CONFIG_MISSING";
    throw err;
  }
  return v;
}

/**
 * Build a Gmail client impersonating `RIPPLING_REPORT_MAILBOX_ADDRESS`
 * with read-only scope.  Fails loudly if any of the SA creds or the
 * mailbox address is missing.
 */
function getGmailClient() {
  const saEmail = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const saKey   = requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const mailbox = requireEnv("RIPPLING_REPORT_MAILBOX_ADDRESS");
  const auth = new google.auth.JWT({
    email: saEmail,
    key: saKey,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],   // READ ONLY
    subject: mailbox,
  });
  return google.gmail({ version: "v1", auth });
}

/**
 * Read the newest matching Rippling report email, verify it is within
 * the 26-hour staleness window, and write its first CSV attachment to
 * `destPath`.
 *
 * @param {Object} args
 * @param {string} args.destPath - absolute path to write the CSV.  Caller owns cleanup.
 * @param {number} [args.nowMs] - injectable clock for tests
 * @returns {Promise<{messageId:string, internalDate:number, ageHours:number, attachmentFilename:string, bytesWritten:number}>}
 * @throws Error with named `.code`:
 *   `CONFIG_MISSING`, `NO_MATCH`, `NO_ATTACHMENT`, `NO_CSV_ATTACHMENT`, `REPORT_STALE`
 */
export async function readScheduledReport({ destPath, nowMs = Date.now() }) {
  if (!destPath) throw new Error("destPath is required");
  const gmail = getGmailClient();
  const subjectFilter = requireEnv("RIPPLING_REPORT_SUBJECT_FILTER");

  // Newest matching message.  `maxResults: 1` + Gmail's default order
  // by internalDate DESC gives us the freshest hit.  Filter includes
  // `has:attachment` so a body-only reply from an operator cannot be
  // read as the report.  `-in:trash -in:spam` guards against a false
  // pick from a deleted or filtered folder.
  const q = `${subjectFilter} has:attachment -in:trash -in:spam`;
  const listResp = await gmail.users.messages.list({
    userId: "me",
    q,
    maxResults: 1,
  });
  const messages = listResp.data.messages || [];
  if (messages.length === 0) {
    const err = new Error(`NO_MATCH: no message matched Gmail query`);
    err.code = "NO_MATCH";
    throw err;
  }

  const msgId = messages[0].id;
  const msgResp = await gmail.users.messages.get({
    userId: "me",
    id: msgId,
    format: "full",
  });
  const msg = msgResp.data;
  const internalDate = Number(msg.internalDate);

  // Staleness gate - this is the whole point of the PR.  Fires
  // BEFORE the attachment is downloaded so a bad-clock run doesn't
  // waste bandwidth.
  const ageHours = checkFresh(internalDate, nowMs);

  // Walk parts to find the first CSV attachment.
  const attachments = [];
  function walk(part) {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        attachmentId: part.body.attachmentId,
        mimeType: part.mimeType || "",
        size: Number(part.body.size || 0),
      });
    }
    if (Array.isArray(part.parts)) for (const p of part.parts) walk(p);
  }
  walk(msg.payload);

  if (attachments.length === 0) {
    const err = new Error(`NO_ATTACHMENT: message ${msgId} carries no attachment`);
    err.code = "NO_ATTACHMENT";
    throw err;
  }
  const csv = attachments.find(a =>
    a.filename.toLowerCase().endsWith(".csv") || a.mimeType.toLowerCase().includes("csv")
  );
  if (!csv) {
    const err = new Error(`NO_CSV_ATTACHMENT: message ${msgId} has ${attachments.length} attachment(s), none CSV`);
    err.code = "NO_CSV_ATTACHMENT";
    throw err;
  }

  const attResp = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId: msgId,
    id: csv.attachmentId,
  });
  // Gmail returns base64url-encoded bytes on `data`.
  const b64 = (attResp.data.data || "").replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(b64, "base64");

  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, buf);

  return {
    messageId: msgId,
    internalDate,
    ageHours,
    attachmentFilename: csv.filename,
    bytesWritten: buf.length,
  };
}

export const _internal = { STALENESS_LIMIT_MS };

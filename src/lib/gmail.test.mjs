// buildSAMime tests. Covers the cc plumbing added 2026-09-09 (was
// silently dropped by the previous sendEmailSA signature) + the
// BCC audit dedup + the always-present headers. Decodes the raw
// base64url MIME and asserts on the header lines.
//
// Would have caught the pre-fix drop: the "cc plumbs through with
// one address" test asserts a `Cc:` line in the decoded MIME.

import test from "node:test";
import assert from "node:assert/strict";
import { buildSAMime, AUDIT_BCC_EMAIL } from "./gmail.js";

const BASE = {
  sender: "kitchfix.admin@kitchfix.com",
  displayName: "KitchFix Ops Hub",
  to: "site.leader@kitchfix.com",
  subject: "Subject line",
  html: "<p>body</p>",
  boundary: "boundary_fixed_for_tests",
};

function decode(res) {
  // Reverse base64url -> utf8. Node's Buffer accepts "base64url" directly.
  return Buffer.from(res.raw, "base64url").toString("utf-8");
}

// ─── cc plumbing ────────────────────────────────────────────────

test("cc absent -> no Cc header emitted", () => {
  const res = buildSAMime({ ...BASE });
  const decoded = decode(res);
  assert.ok(!/^Cc:/m.test(decoded), "no Cc line expected when cc arg omitted");
  assert.deepEqual(res.headers.cc, []);
});

test("cc undefined -> no Cc header", () => {
  const res = buildSAMime({ ...BASE, cc: undefined });
  assert.ok(!/^Cc:/m.test(decode(res)));
});

test("cc empty array -> no Cc header", () => {
  const res = buildSAMime({ ...BASE, cc: [] });
  assert.ok(!/^Cc:/m.test(decode(res)));
  assert.deepEqual(res.headers.cc, []);
});

test("cc single string -> Cc line present", () => {
  const res = buildSAMime({ ...BASE, cc: "chef2@kitchfix.com" });
  const decoded = decode(res);
  assert.match(decoded, /^Cc: chef2@kitchfix.com$/m);
  assert.deepEqual(res.headers.cc, ["chef2@kitchfix.com"]);
});

test("cc single-element array -> Cc line present", () => {
  const res = buildSAMime({ ...BASE, cc: ["chef2@kitchfix.com"] });
  assert.match(decode(res), /^Cc: chef2@kitchfix.com$/m);
});

test("cc multiple addresses -> comma-joined", () => {
  const res = buildSAMime({ ...BASE, cc: ["a@x.com", "b@x.com", "c@x.com"] });
  assert.match(decode(res), /^Cc: a@x.com, b@x.com, c@x.com$/m);
  assert.deepEqual(res.headers.cc, ["a@x.com", "b@x.com", "c@x.com"]);
});

test("cc drops falsy entries (null/empty)", () => {
  const res = buildSAMime({ ...BASE, cc: ["a@x.com", null, "", undefined, "b@x.com"] });
  assert.match(decode(res), /^Cc: a@x.com, b@x.com$/m);
});

// ─── to header ──────────────────────────────────────────────────

test("to single string -> To line present", () => {
  const res = buildSAMime({ ...BASE, to: "one@x.com" });
  assert.match(decode(res), /^To: one@x.com$/m);
});

test("to array -> comma-joined", () => {
  const res = buildSAMime({ ...BASE, to: ["a@x.com", "b@x.com"] });
  assert.match(decode(res), /^To: a@x.com, b@x.com$/m);
});

test("to drops falsy entries", () => {
  const res = buildSAMime({ ...BASE, to: ["a@x.com", null, "b@x.com"] });
  assert.match(decode(res), /^To: a@x.com, b@x.com$/m);
});

// ─── audit BCC ──────────────────────────────────────────────────

test("BCC audit address is always present by default", () => {
  const res = buildSAMime({ ...BASE });
  assert.match(decode(res), new RegExp(`^Bcc: ${AUDIT_BCC_EMAIL}$`, "m"));
  assert.deepEqual(res.headers.bcc, [AUDIT_BCC_EMAIL]);
});

test("BCC suppressed when audit address already in To", () => {
  const res = buildSAMime({ ...BASE, to: [AUDIT_BCC_EMAIL, "other@x.com"] });
  assert.ok(!/^Bcc:/m.test(decode(res)));
  assert.deepEqual(res.headers.bcc, []);
});

test("BCC suppressed when audit address already in Cc", () => {
  const res = buildSAMime({ ...BASE, cc: [AUDIT_BCC_EMAIL] });
  assert.ok(!/^Bcc:/m.test(decode(res)));
});

test("BCC dedup case-insensitive on To", () => {
  const res = buildSAMime({ ...BASE, to: ["KitchFix.Admin@kitchfix.com"] });
  assert.ok(!/^Bcc:/m.test(decode(res)));
});

test("BCC dedup case-insensitive on Cc", () => {
  const res = buildSAMime({ ...BASE, cc: ["KITCHFIX.ADMIN@KITCHFIX.COM"] });
  assert.ok(!/^Bcc:/m.test(decode(res)));
});

test("BCC NOT suppressed when sender == audit (same-domain edge case)", () => {
  // Kevin's directive: if Gmail drops sender==bcc, swap addresses,
  // do not workaround here. Verify no code path silently suppresses.
  const res = buildSAMime({ ...BASE, sender: AUDIT_BCC_EMAIL });
  assert.match(decode(res), new RegExp(`^Bcc: ${AUDIT_BCC_EMAIL}$`, "m"));
});

// ─── replyTo + subject encoding ─────────────────────────────────

test("replyTo present -> Reply-To line included", () => {
  const res = buildSAMime({ ...BASE, replyTo: "ops@kitchfix.com" });
  assert.match(decode(res), /^Reply-To: ops@kitchfix.com$/m);
});

test("replyTo absent -> no Reply-To line", () => {
  const res = buildSAMime({ ...BASE });
  assert.ok(!/^Reply-To:/m.test(decode(res)));
});

test("ASCII subject passes through unchanged", () => {
  const res = buildSAMime({ ...BASE, subject: "Plain ASCII subject" });
  assert.match(decode(res), /^Subject: Plain ASCII subject$/m);
});

test("non-ASCII subject RFC 2047 encoded", () => {
  const res = buildSAMime({ ...BASE, subject: "Sébastien needs entry" });
  const decoded = decode(res);
  assert.match(decoded, /^Subject: =\?UTF-8\?B\?/m,
    "non-ASCII subject should be base64 encoded per RFC 2047");
});

// ─── header ordering (visible-first) ────────────────────────────

test("From/To/Cc/Bcc/Subject present in expected order", () => {
  const res = buildSAMime({
    ...BASE,
    to: "to@x.com",
    cc: "cc@x.com",
  });
  const decoded = decode(res);
  const posFrom = decoded.indexOf("From:");
  const posTo   = decoded.indexOf("To:");
  const posCc   = decoded.indexOf("Cc:");
  const posBcc  = decoded.indexOf("Bcc:");
  const posSub  = decoded.indexOf("Subject:");
  assert.ok(posFrom < posTo, "From before To");
  assert.ok(posTo   < posCc,  "To before Cc");
  assert.ok(posCc   < posBcc, "Cc before Bcc");
  assert.ok(posBcc  < posSub, "Bcc before Subject");
});

// ─── body ───────────────────────────────────────────────────────

test("html body is base64-encoded inside multipart/alternative", () => {
  const res = buildSAMime({ ...BASE, html: "<h1>hello</h1>" });
  const decoded = decode(res);
  const expectedB64 = Buffer.from("<h1>hello</h1>").toString("base64");
  assert.ok(decoded.includes(expectedB64), "html should appear base64-encoded in body");
  assert.match(decoded, /Content-Type: multipart\/alternative; boundary="boundary_fixed_for_tests"/);
});

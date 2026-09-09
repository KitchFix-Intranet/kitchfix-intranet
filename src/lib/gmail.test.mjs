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

// ─── attachments ────────────────────────────────────────────────
//
// buildSAMime accepts `attachments: [{ filename, mimeType, base64 }]`
// (added 2026-09-09 for the N1 record-copy). When present, top-level
// Content-Type switches from multipart/alternative to multipart/mixed
// with the HTML body wrapped in a nested multipart/alternative.
// Audit BCC + cc plumbing must survive this shape switch - these
// tests would fail loudly if a refactor dropped either.

const ATTACHMENT_BASE = {
  ...BASE,
  innerBoundary: "boundary_inner_fixed",
};

test("no attachments -> Content-Type stays multipart/alternative", () => {
  const res = buildSAMime({ ...ATTACHMENT_BASE });
  const decoded = decode(res);
  assert.match(decoded, /^Content-Type: multipart\/alternative;/m);
  assert.ok(!/multipart\/mixed/.test(decoded));
  assert.equal(res.headers.attachmentCount, 0);
});

test("no attachments -> empty attachments array is treated as absent", () => {
  const res = buildSAMime({ ...ATTACHMENT_BASE, attachments: [] });
  assert.match(decode(res), /^Content-Type: multipart\/alternative;/m);
  assert.equal(res.headers.attachmentCount, 0);
});

test("one attachment -> Content-Type switches to multipart/mixed", () => {
  const pdfBase64 = Buffer.from("%PDF-1.4 fake").toString("base64");
  const res = buildSAMime({
    ...ATTACHMENT_BASE,
    attachments: [{ filename: "test.pdf", mimeType: "application/pdf", base64: pdfBase64 }],
  });
  const decoded = decode(res);
  assert.match(decoded, /^Content-Type: multipart\/mixed; boundary="boundary_fixed_for_tests"/m);
  assert.equal(res.headers.attachmentCount, 1);
});

test("attachment: HTML body nested in multipart/alternative under the outer mixed", () => {
  const pdfBase64 = Buffer.from("%PDF-1.4 fake").toString("base64");
  const res = buildSAMime({
    ...ATTACHMENT_BASE,
    attachments: [{ filename: "test.pdf", mimeType: "application/pdf", base64: pdfBase64 }],
  });
  const decoded = decode(res);
  assert.match(decoded, /Content-Type: multipart\/alternative; boundary="boundary_inner_fixed"/);
  const htmlB64 = Buffer.from("<p>body</p>").toString("base64");
  assert.ok(decoded.includes(htmlB64), "HTML body must still be present, base64-encoded");
});

test("attachment: filename + mimeType + Content-Disposition emitted", () => {
  const pdfBase64 = Buffer.from("%PDF-1.4 fake").toString("base64");
  const res = buildSAMime({
    ...ATTACHMENT_BASE,
    attachments: [{ filename: "TBR-FL_record.pdf", mimeType: "application/pdf", base64: pdfBase64 }],
  });
  const decoded = decode(res);
  assert.match(decoded, /Content-Type: application\/pdf; name="TBR-FL_record.pdf"/);
  assert.match(decoded, /Content-Disposition: attachment; filename="TBR-FL_record.pdf"/);
  assert.ok(decoded.includes(pdfBase64), "attachment base64 payload present");
});

test("attachment: audit BCC still present alongside multipart/mixed", () => {
  // This is the critical assertion Kevin flagged: the audit trail
  // must survive the MIME shape change. If a refactor moves the
  // Bcc header emission out of the shared header block, this test
  // catches it before the next real send.
  const pdfBase64 = Buffer.from("%PDF-1.4 fake").toString("base64");
  const res = buildSAMime({
    ...ATTACHMENT_BASE,
    attachments: [{ filename: "test.pdf", mimeType: "application/pdf", base64: pdfBase64 }],
  });
  assert.match(decode(res), new RegExp(`^Bcc: ${AUDIT_BCC_EMAIL}$`, "m"));
  assert.deepEqual(res.headers.bcc, [AUDIT_BCC_EMAIL]);
});

test("attachment: audit BCC still dedups when audit in To (with attachment)", () => {
  const pdfBase64 = Buffer.from("%PDF-1.4 fake").toString("base64");
  const res = buildSAMime({
    ...ATTACHMENT_BASE,
    to: [AUDIT_BCC_EMAIL, "other@x.com"],
    attachments: [{ filename: "test.pdf", mimeType: "application/pdf", base64: pdfBase64 }],
  });
  assert.ok(!/^Bcc:/m.test(decode(res)));
});

test("attachment: cc still plumbs through when attachment present", () => {
  const pdfBase64 = Buffer.from("%PDF-1.4 fake").toString("base64");
  const res = buildSAMime({
    ...ATTACHMENT_BASE,
    cc: ["a@x.com", "b@x.com"],
    attachments: [{ filename: "test.pdf", mimeType: "application/pdf", base64: pdfBase64 }],
  });
  assert.match(decode(res), /^Cc: a@x.com, b@x.com$/m);
});

test("attachment: base64 payload chunked to 76 chars per RFC 2045", () => {
  // Encode a long enough payload to force multiple chunks.
  const payload = "A".repeat(300);
  const b64 = Buffer.from(payload).toString("base64"); // 400 chars, > 76
  const res = buildSAMime({
    ...ATTACHMENT_BASE,
    attachments: [{ filename: "big.pdf", mimeType: "application/pdf", base64: b64 }],
  });
  const decoded = decode(res);
  // Find the attachment section and confirm no line exceeds 76 chars
  // between the attachment header and the next boundary.
  const startMarker = "Content-Disposition: attachment; filename=\"big.pdf\"";
  const startIdx = decoded.indexOf(startMarker);
  assert.ok(startIdx >= 0);
  const endMarker = "--boundary_fixed_for_tests--";
  const endIdx = decoded.indexOf(endMarker, startIdx);
  const attachmentBlock = decoded.slice(startIdx, endIdx);
  const attachmentLines = attachmentBlock.split(/\r\n|\n/).filter((l) => /^[A-Za-z0-9+/=]/.test(l));
  for (const line of attachmentLines) {
    assert.ok(line.length <= 76, `attachment line exceeds 76 chars: ${line.slice(0, 40)}... (${line.length} chars)`);
  }
});

test("attachment: multiple attachments emit multiple parts", () => {
  const pdfA = Buffer.from("A pdf").toString("base64");
  const pdfB = Buffer.from("B pdf").toString("base64");
  const res = buildSAMime({
    ...ATTACHMENT_BASE,
    attachments: [
      { filename: "a.pdf", mimeType: "application/pdf", base64: pdfA },
      { filename: "b.pdf", mimeType: "application/pdf", base64: pdfB },
    ],
  });
  const decoded = decode(res);
  assert.match(decoded, /filename="a.pdf"/);
  assert.match(decoded, /filename="b.pdf"/);
  assert.ok(decoded.includes(pdfA));
  assert.ok(decoded.includes(pdfB));
  assert.equal(res.headers.attachmentCount, 2);
});

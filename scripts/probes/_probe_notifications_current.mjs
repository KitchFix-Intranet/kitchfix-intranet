// ═══════════════════════════════════════════════════════════════════
// _probe_notifications_current.mjs
// 2026-09-03 (Wave 2 pre-migration probe)
// ═══════════════════════════════════════════════════════════════════
//
// Read the HUB / notifications Sheets tab and print the current
// recipient config per action type. Kevin wants to see this before
// authoring the backfill migration - the config has not been looked
// at in a while and this is the moment to confirm it is still right.
//
// Sheet format per people/route.js:87 comment:
//   [actionKey, enabled1, email1, enabled2, email2, enabled3, email3, enabled4, email4]
// Up to 4 (enabled, emails-csv) pairs per row. `enabled` is TRUE/1
// to activate the slot; `emails` splits on , or ; and each entry
// containing @ becomes a recipient.
//
// Run:
//   cd /Users/kevinfietek/dev/kf-sc-39
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/probes/_probe_notifications_current.mjs
// ═══════════════════════════════════════════════════════════════════

import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

console.log("\n─── Reading HUB / notifications ───\n");

let rows;
try {
  const res = await readSheetSA(SHEET_IDS.HUB, "notifications");
  rows = res.rows;
} catch (e) {
  console.error(`Notifications sheet read FAILED: ${e?.message || e}`);
  console.error("If this is the Sheets read-quota again, wait a minute and retry.");
  process.exit(1);
}

console.log(`raw row count: ${rows.length}\n`);

// Parse per-row: same logic as people/route.js:88-116 getNotificationRecipients
// but for EVERY row instead of one action_key lookup.
console.log("action_key                       | recipients");
console.log("─".repeat(80));

const parsed = [];
for (const row of rows) {
  const rawKey = String(row[0] || "").trim();
  if (!rawKey) continue; // skip blanks + section headers
  const normalizedKey = rawKey.toLowerCase().replace(/\s+/g, "_");
  const recipients = [];
  for (let i = 0; i < 4; i++) {
    const enabled = String(row[1 + i * 2] || "").trim().toUpperCase();
    const emails = String(row[2 + i * 2] || "");
    if (enabled === "TRUE" || enabled === "1") {
      emails.split(/[,;]+/).forEach((e) => {
        const trimmed = e.trim();
        if (trimmed.includes("@")) recipients.push(trimmed);
      });
    }
  }
  parsed.push({ rawKey, normalizedKey, recipients });
}

for (const { normalizedKey, recipients } of parsed) {
  const paddedKey = normalizedKey.padEnd(32);
  const list = recipients.length > 0 ? recipients.join(", ") : "(none)";
  console.log(`${paddedKey} | ${list}`);
}

console.log(`\ntotal action_key rows with any recipient: ${parsed.filter(p => p.recipients.length > 0).length}`);
console.log(`total action_key rows with zero recipients: ${parsed.filter(p => p.recipients.length === 0).length}`);

// Emit the parsed shape as JSON at the bottom for easy paste into
// the migration seed section.
console.log("\n─── JSON for backfill seed ───");
console.log(JSON.stringify(parsed, null, 2));

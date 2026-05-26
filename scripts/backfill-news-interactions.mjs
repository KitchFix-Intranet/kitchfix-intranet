// ════════════════════════════════════════════════════════════════════════════
// One-time backfill: copy the news_interactions Sheets tab into Postgres.
//
// PURPOSE
//   The Postgres news_interactions table is empty at Stage 1 PR 1 merge time.
//   This script seeds it with the existing Sheets history so that when the
//   cutover flips reads to Postgres, every user keeps their read/save/ack
//   state. The dual-write path (live writes since DUAL_WRITE_TABLES is set)
//   handles new and changed rows; this script handles the historical baseline.
//
// USAGE
//   Dry run (default):
//     node --env-file=.env.local scripts/backfill-news-interactions.mjs
//   Live (does the actual upsert):
//     node --env-file=.env.local scripts/backfill-news-interactions.mjs --execute
//
// SAFETY
//   - Default mode is dry-run. Live mode requires --execute.
//   - Live mode uses upsert with ON CONFLICT (post_id, user_email) DO UPDATE,
//     so the script is idempotent. Re-running after dual-write has populated
//     some rows reconciles instead of erroring; re-running after a successful
//     backfill is a no-op for unchanged rows and a refresh for changed rows.
//   - This script does NOT touch the Sheets tab. Sheets remains source of
//     truth until the READ_FROM_POSTGRES flag flips post-backfill.
//   - This script does NOT flip any cutover flags. Flag flips happen
//     manually in the Vercel env, separately from this script.
//
// COERCION
//   Mirrors src/lib/dataStore.js exactly:
//     "TRUE" / "FALSE" / "" strings -> JS booleans (anything else -> false)
//     empty readAt string -> NULL timestamptz (else the ISO string passes
//       through; Postgres accepts ISO strings as timestamptz)
//     user_email -> lowercase + trimmed
//   So a row backfilled by this script is byte-identical to a row that
//   dual-write would have written for the same Sheets row.
// ════════════════════════════════════════════════════════════════════════════

import { readSheetSA, SHEET_IDS } from "../src/lib/sheets.js";
import { createClient } from "@supabase/supabase-js";

const TAB = "news_interactions";
const TABLE = "news_interactions";

// ── flag parse ──
const EXECUTE = process.argv.includes("--execute");
const DRY_RUN = !EXECUTE;
const MODE = DRY_RUN ? "DRY-RUN" : "LIVE";

// ── coercion (mirrors dataStore.js) ──
function strToBool(s) {
  return String(s || "").toUpperCase() === "TRUE";
}
function canonicalTimestampToPg(s) {
  return s ? s : null;
}
function normalizeEmail(e) {
  return String(e || "").toLowerCase().trim();
}

function transformRow(r) {
  return {
    post_id: String(r[0] || ""),
    user_email: normalizeEmail(r[1]),
    read: strToBool(r[2]),
    read_at: canonicalTimestampToPg(r[3]),
    saved: strToBool(r[4]),
    acknowledged: strToBool(r[5]),
  };
}

function isLikelyIso(s) {
  if (!s) return true;
  return /^\d{4}-\d{2}-\d{2}T/.test(s);
}

async function main() {
  console.log("=".repeat(70));
  console.log(`news_interactions backfill - ${MODE}`);
  console.log("=".repeat(70));
  console.log();

  // ── 1. Read Sheets ──
  const { headers, rows } = await readSheetSA(SHEET_IDS.COLLECTION, TAB);

  if (headers[0] !== "postId") {
    console.error(
      `FATAL: header A1 is "${headers[0]}", expected "postId". ` +
      `The column mapping in this script assumes columns A-F are ` +
      `[postId, userEmail, read, readAt, saved, acknowledged]. ` +
      `If the header shifted, the backfill would corrupt data. STOP.`
    );
    process.exit(1);
  }

  console.log(`Read ${rows.length} rows from Sheets (${TAB} tab).`);
  console.log(`Header: ${JSON.stringify(headers)}`);
  console.log();

  // ── 2. Filter + transform ──
  // Skip blank rows (no postId AND no email) silently; they exist in the
  // recon as 0 today, but defensive against future blanks.
  const skipped = [];
  const malformed = [];
  const transformed = [];

  rows.forEach((r, i) => {
    const [postId, email, , readAt] = r;
    if (!postId && !email) {
      skipped.push({ index: i, reason: "blank row" });
      return;
    }
    if (!postId) {
      malformed.push({ index: i, reason: "missing post_id", row: r });
      return;
    }
    if (!email) {
      malformed.push({ index: i, reason: "missing user_email", row: r });
      return;
    }
    if (readAt && !isLikelyIso(readAt)) {
      malformed.push({ index: i, reason: `malformed read_at: "${readAt}"`, row: r });
      return;
    }
    transformed.push(transformRow(r));
  });

  if (malformed.length > 0) {
    console.error("MALFORMED ROWS (would skip these in live mode - review first):");
    malformed.forEach((m) => console.error(`  row ${m.index}: ${m.reason}`, JSON.stringify(m.row)));
    console.error();
  }
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} blank row(s).`);
  }

  // ── 3. Duplicate PK detection (last occurrence wins under ON CONFLICT) ──
  const pkSeen = new Map();
  transformed.forEach((row, i) => {
    const key = `${row.post_id}|${row.user_email}`;
    if (!pkSeen.has(key)) pkSeen.set(key, []);
    pkSeen.get(key).push(i);
  });
  const dupes = [...pkSeen.entries()].filter(([, idxs]) => idxs.length > 1);
  if (dupes.length > 0) {
    console.warn(`WARNING: ${dupes.length} duplicate (post_id, user_email) pair(s) found.`);
    console.warn("ON CONFLICT semantics mean the LAST occurrence wins (Sheets row order).");
    dupes.slice(0, 5).forEach(([key, idxs]) => {
      console.warn(`  ${key}: indices ${idxs.join(", ")}`);
    });
    console.warn();
  }

  // ── 4. Report what we would write ──
  console.log(`Transformed: ${transformed.length} rows ready to upsert.`);
  console.log();
  console.log("Sample of transformed rows (first 5):");
  transformed.slice(0, 5).forEach((row, i) => {
    console.log(`  [${i}]`, JSON.stringify(row));
  });
  console.log();

  if (DRY_RUN) {
    console.log("DRY-RUN: not connecting to Postgres. Nothing written.");
    console.log(`To execute for real: node --env-file=.env.local scripts/backfill-news-interactions.mjs --execute`);
    return;
  }

  // ── 5. LIVE: upsert ──
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("LIVE: upserting to Postgres...");
  const { error } = await supabase
    .from(TABLE)
    .upsert(transformed, { onConflict: "post_id,user_email", ignoreDuplicates: false });
  if (error) {
    console.error("Upsert failed:", error);
    process.exit(1);
  }
  console.log(`Upsert OK: ${transformed.length} rows reconciled.`);

  // ── 6. Verify by counting rows in PG ──
  const { count, error: countErr } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true });
  if (countErr) {
    console.warn("Post-upsert count check failed:", countErr);
  } else {
    console.log(`Postgres ${TABLE} now has ${count} total rows.`);
    if (count < transformed.length) {
      console.warn(`WARNING: expected at least ${transformed.length}, got ${count}. Investigate.`);
    }
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

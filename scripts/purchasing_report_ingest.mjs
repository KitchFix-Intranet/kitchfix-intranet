#!/usr/bin/env node
/**
 * scripts/purchasing_report_ingest.mjs
 *
 * Nightly report-ingest orchestrator.  Called by the
 * `purchasing-report-ingest.yml` GitHub Actions workflow at 06:00 UTC,
 * 90 minutes before the existing purchasing derive at 07:30 UTC.
 *
 * Ordering:
 *   1. Read the mailbox (SA-impersonated, `gmail.readonly` only).
 *      Fails loudly if the newest matching message is > 26h old,
 *      absent, or has no CSV attachment.
 *   2. Write the CSV to `/tmp/rippling_report.csv` (or `--dest=<path>`).
 *   3. Spawn `purchasing_report_load.mjs --csv=<path>`.  That script is
 *      unchanged and already idempotent on `parent_txn_id`.
 *   4. Write a `purchasing_derive_runs` row - `source='rippling_report'`,
 *      status, row count, error message on failure.  This is what the
 *      board's freshness pill reads.
 *   5. Delete the downloaded CSV.  It carries people; must not persist.
 *
 * ALL FAILURES exit non-zero AND write a `status='failed'`
 * derive-runs row before exiting, so the board sees the failure
 * whether or not the workflow is visible.
 *
 * CLI:
 *   node --env-file=/path/to/.env.local scripts/purchasing_report_ingest.mjs
 *     [--dest=/tmp/rippling_report.csv]
 *     [--dry-run]
 *
 * Required env:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY
 *   RIPPLING_REPORT_MAILBOX_ADDRESS, RIPPLING_REPORT_SUBJECT_FILTER
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { readScheduledReport } from "../src/lib/gmailReadReport.js";
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = { dest: "/tmp/rippling_report.csv", dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--dest=")) args.dest = a.slice("--dest=".length);
    else if (a === "--dry-run") args.dryRun = true;
    else { console.error(`unknown arg: ${a}`); process.exit(1); }
  }
  return args;
}

function envOrDie(name) {
  const v = process.env[name];
  if (!v) { console.error(`env ${name} ABSENT`); process.exit(1); }
  return v;
}

const args = parseArgs(process.argv);
const SB_URL = envOrDie("SUPABASE_URL");
const SB_KEY = envOrDie("SUPABASE_SERVICE_ROLE_KEY");
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const t0 = Date.now();
const startedAt = new Date();
console.log(`purchasing_report_ingest started=${startedAt.toISOString()} dest=${args.dest} dryRun=${args.dryRun}`);

// Presence probes.  USE not SEE.
console.log(`env RIPPLING_REPORT_MAILBOX_ADDRESS: ${process.env.RIPPLING_REPORT_MAILBOX_ADDRESS ? "PRESENT" : "ABSENT"}`);
console.log(`env RIPPLING_REPORT_SUBJECT_FILTER : ${process.env.RIPPLING_REPORT_SUBJECT_FILTER ? "PRESENT" : "ABSENT"}`);
console.log(`env GOOGLE_SERVICE_ACCOUNT_EMAIL   : ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? "PRESENT" : "ABSENT"}`);
console.log(`env GOOGLE_PRIVATE_KEY             : ${process.env.GOOGLE_PRIVATE_KEY ? "PRESENT" : "ABSENT"}`);

async function writeDeriveRun({ status, linesWritten, errorMessage }) {
  const { error } = await supa.from("purchasing_derive_runs").insert({
    source: "rippling_report",
    fetch_source: "email_ingest",
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    status,
    lines_written: linesWritten ?? null,
    error_message: errorMessage ?? null,
  });
  if (error) {
    console.error(`derive_runs write FAILED: ${error.message}`);
    return false;
  }
  return true;
}

async function seedCountBefore() {
  const { count, error } = await supa.from("rippling_report_seen_txns").select("*", { count: "exact", head: true });
  if (error) { console.error(`seen_txns count read failed: ${error.message}`); process.exit(2); }
  return count;
}

async function safeDelete(p) {
  try { await fs.unlink(p); return true; } catch (e) { return false; }
}

function runLoader(csvPath) {
  return new Promise((resolve) => {
    // Loader script sits at scripts/purchasing_report_load.mjs;
    // resolve against this script's own directory so the workflow
    // does not need to cd anywhere first.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const loaderPath = path.join(here, "purchasing_report_load.mjs");
    const child = spawn(process.execPath, [loaderPath, `--csv=${csvPath}`], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });
    child.on("close", (code) => resolve(code));
    child.on("error", (err) => { console.error(`spawn failed: ${err.message}`); resolve(255); });
  });
}

async function main() {
  let csvOnDisk = false;
  const cleanup = async () => {
    if (csvOnDisk) {
      const ok = await safeDelete(args.dest);
      console.log(`cleanup: ${ok ? "deleted" : "delete failed"} ${args.dest}`);
      csvOnDisk = false;
    }
  };

  const countBefore = await seedCountBefore();
  console.log(`rippling_report_seen_txns row count BEFORE: ${countBefore}`);

  let readResult;
  try {
    readResult = await readScheduledReport({ destPath: args.dest });
    csvOnDisk = true;
  } catch (err) {
    // Every named error path lands here.  Write the failed
    // derive-run row before exiting so the board is aware.  Do not
    // log the error object verbatim - `err.message` shape is safe
    // (named codes above emit no worker/cardholder data), but a
    // Google client error can carry an email address in a stack
    // trace.  We log the code and a scrubbed short message.
    const safeMsg = String(err.message || err.code || "unknown");
    console.error(`READ FAILED code=${err.code || "unknown"} msg=${safeMsg.slice(0, 200)}`);
    await writeDeriveRun({ status: "failed", linesWritten: null, errorMessage: `read ${err.code || "unknown"}` });
    await cleanup();
    process.exit(2);
  }
  console.log(`READ OK: message_age_hours=${readResult.ageHours} attachment=${readResult.attachmentFilename} bytes=${readResult.bytesWritten}`);

  if (args.dryRun) {
    console.log(`--dry-run set; skipping loader + derive_runs write`);
    await cleanup();
    process.exit(0);
  }

  const loaderCode = await runLoader(args.dest);
  if (loaderCode !== 0) {
    console.error(`LOADER exited ${loaderCode}`);
    await writeDeriveRun({ status: "failed", linesWritten: null, errorMessage: `loader exit ${loaderCode}` });
    await cleanup();
    process.exit(3);
  }

  const countAfter = await seedCountBefore();
  const inserted = countAfter - countBefore;
  console.log(`rippling_report_seen_txns row count AFTER: ${countAfter}   inserted this run: ${inserted}`);

  const wroteRow = await writeDeriveRun({ status: "success", linesWritten: countAfter, errorMessage: null });
  if (!wroteRow) {
    // A loader that succeeded but a derive-runs write that failed
    // is a state Kevin cares about - the board would not see the
    // successful ingest.  Fail loud but don't retry.
    await cleanup();
    process.exit(4);
  }

  await cleanup();
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`DONE: ${countAfter} rows in seen_txns (+${inserted} this run) duration=${dur}s`);
}

main().catch(async (e) => {
  console.error(`UNHANDLED: ${String(e?.message || e).slice(0, 200)}`);
  await writeDeriveRun({ status: "failed", linesWritten: null, errorMessage: "unhandled" }).catch(() => {});
  await safeDelete(args.dest).catch(() => {});
  process.exit(5);
});

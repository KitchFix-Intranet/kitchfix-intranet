// ═══════════════════════════════════════════════════════════════════════════
// Single-call heartbeat lifecycle for Node CLI crons.
// ═══════════════════════════════════════════════════════════════════════════
//
// Scheduled scripts (scripts/*_sync.mjs, scripts/*_ingest.mjs) exit via
// several `process.exit(N)` branches with distinct codes. To make every
// exit path write a `cron_runs` close event without sprinkling finish
// calls at every call site, this module installs ONE lifecycle on the
// host process:
//
//   - monkey-patches process.exit so an explicit exit closes the row
//     first, then invokes the real exit;
//   - installs uncaughtException + unhandledRejection handlers to close
//     before re-exiting at code 1;
//   - installs a beforeExit handler for natural event-loop drain.
//
// Usage (inside a .mjs script, right after the supabase client exists):
//
//   import { installCronHeartbeat } from "../src/lib/cronRunHeartbeat.js";
//   const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false }});
//   const hb = await installCronHeartbeat(supa, "rippling-raw-sync");
//   // ... normal script body with its usual process.exit(N) calls ...
//   hb.setSummary({ examined: 10000, inserted: 123 }); // optional
//
// ─── Hard contract (do not break) ───────────────────────────────────
//
// 1. Never crash the host. All DB writes go through startCronRun /
//    finishCronRun which already catch internally. The patched exit
//    wraps the close call in `.catch(() => {})` as a second belt.
//
// 2. Never change the host's exit code. The patch calls the ORIGINAL
//    exit with the ORIGINAL code; the only side effect is a brief
//    (<~200ms) delay for the heartbeat update.
//
// 3. Scripts rely on `process.exit(N)` being terminal. The patch
//    preserves that: after the close is queued, it throws an
//    `ExitSentinel` so the current call stack unwinds immediately.
//    The uncaughtException / unhandledRejection handlers below see
//    the sentinel and suppress it (the real exit is already queued
//    via the close chain). Code after a `process.exit(N)` call does
//    not run, same as pre-install behavior.
//
// 4. staleRunMs on the watchdog side is the backstop. A heartbeat
//    that fails to close (e.g. SIGKILL, OOM) stays `in_progress`
//    and the watchdog alerts after staleRunMs. This install is the
//    happy-path convenience; the backstop is the real guarantee.

import { startCronRun, finishCronRun } from "./cronRuns.js";

// Thrown by the patched process.exit so the current call stack
// unwinds instead of continuing past a line that was intended to
// terminate the process. The uncaughtException + unhandledRejection
// handlers below recognise and suppress it.
class ExitSentinel extends Error {
  constructor(code) {
    super(`__cron_heartbeat_exit_sentinel__code=${code}`);
    this.isExitSentinel = true;
    this.exitCode = code;
  }
}

export async function installCronHeartbeat(supa, laneName) {
  const id = await startCronRun(supa, laneName);
  let summary = null;
  let errorMessage = null;
  let closed = false;

  async function close(code) {
    if (closed) return;
    closed = true;
    if (id == null) return; // helper returned null; nothing to close
    const status = (code === 0 || code === undefined) ? "success" : "failed";
    const errMsg = status === "failed"
      ? (errorMessage || `exited with code ${code}`)
      : undefined;
    try {
      await finishCronRun(supa, id, {
        status,
        summary: summary ?? undefined,
        errorMessage: errMsg,
      });
    } catch {
      // helper already catches internally; this is belt-and-suspenders
    }
  }

  // Patch process.exit. Queue the close + real-exit, then throw a
  // sentinel so the current call stack unwinds (preserving the
  // pre-patch invariant that process.exit is terminal). The sentinel
  // bubbles up to the uncaughtException / unhandledRejection handlers
  // below, which suppress it - origExit is already queued by close.
  const origExit = process.exit.bind(process);
  process.exit = function heartbeatExit(code = 0) {
    close(code)
      .catch(() => {})
      .finally(() => origExit(code));
    throw new ExitSentinel(code);
  };

  // Unhandled error paths. These re-exit at 1 after close. The
  // sentinel branch is a no-op because the patched exit already
  // queued its own origExit; firing a second close would double-
  // write a cron_runs row.
  function onFatal(err) {
    if (err?.isExitSentinel) return;
    errorMessage = String(err?.message || err);
    close(1).catch(() => {}).finally(() => origExit(1));
  }
  process.on("uncaughtException", onFatal);
  process.on("unhandledRejection", (reason) =>
    onFatal(reason instanceof Error ? reason : new Error(String(reason))));

  // Natural fall-through: event loop drains, no explicit exit was
  // called. beforeExit allows async; the close keeps the `closed`
  // flag so a subsequent origExit cannot double-fire.
  process.on("beforeExit", async (code) => {
    if (!closed) await close(code);
  });

  return {
    id,
    laneName,
    setSummary(obj) { summary = obj; },
    setError(msg) { errorMessage = String(msg || ""); },
  };
}

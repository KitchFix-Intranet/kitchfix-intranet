"use client";

// SC save queue - localStorage-backed replay pipe for sc-submit-day
// failures (F3, N1 render). Scope is intentionally tight:
//
//   - Enqueues ONLY sc-submit-day (single-day + bulk per-day) saves.
//     handleAddNote stays out (notes fail loudly; counts are the critical
//     data - see the sc-submit-day / sc-add-note discriminator in
//     ServiceCalendar.js).
//   - Enqueues ONLY on NETWORK-CLASS failure (fetch itself rejects; no
//     response was received). A server response with result.success=false
//     is a REAL rejection and must NOT queue - retrying a rejected payload
//     forever is a bug, not resilience. See isNetworkError() below.
//   - Replay is last-write-wins ABSOLUTE counts per the R-D ruling
//     2026-07-09: a queued save that lands minutes/hours later overwrites
//     any intervening edits by another operator, the SAME semantic two
//     concurrent saves have today. sc_daily_actuals_history (F1) records
//     both changes, so nothing is invisible.
//
// This module is pure IO + timers math. The React driver lives beside it
// in ServiceCalendar as a useEffect (no separate hook - the driver needs
// access to the same monthCache/reloadKey callbacks the save handlers
// already own).

// Storage key. Bump the "v1" if the entry shape changes so a stale
// pre-migration entry doesn't crash the driver on first load.
const QUEUE_STORAGE_KEY = "kf_sc_save_queue_v1";

// Backoff schedule (ms). 5s -> 15s -> 45s -> 2m -> capped 5m.
// Deliberately short at the head so a quick network blip doesn't feel
// like the queue has stalled. The 5m cap keeps a truly-broken tab from
// pounding the endpoint after hours.
const BACKOFF_MS = [5_000, 15_000, 45_000, 120_000, 300_000];

// Multi-tab lock TTL. A tab that acquires the lock and then crashes /
// closes without releasing lets another tab pick up the entry after this
// window. 60s is long enough to swallow one network round-trip + retry
// jitter, short enough that a dead-tab-held lock doesn't strand the save.
// Single-operator-per-account is the realistic case; this is defence
// against the two-tabs-open edge.
export const LOCK_TTL_MS = 60_000;

// ── SSR-safe localStorage IO ─────────────────────────────────────────
// Every touch guards on `typeof window` + a try/catch for Safari's
// private-browsing SecurityError. Parse failures fall back to an empty
// queue (defensively - a corrupted key should not brick the surface).

function canUseStorage() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function readRaw() {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeRaw(map) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded / SecurityError: swallow. The in-memory driver
    // still has the entry it just tried to write; next tick will retry
    // the persist. Not catastrophic - we degrade to session-only queue.
  }
}

// ── Keys + entries ───────────────────────────────────────────────────
// Entry shape:
//   {
//     accountKey, date, entries, auditNote?, rideNote?,
//     queuedAt: ISO8601, attempts: number,
//     lockedAt?: ISO8601   // multi-tab in-flight guard
//   }
// Key = `${accountKey}|${date}`. Re-save of the same day REPLACES the
// existing entry (last-write-wins inside the queue).
// P2 (item 2, 2026-07-10): rideNote joins the persisted payload so a
// queued replay carries the operator's ride-along note through to the
// server without losing it - DayDetail can clean-close on a queued
// save instead of routing the draft through discard-confirm.

export function queueKey(accountKey, date) {
  return `${accountKey}|${date}`;
}

export function getAll() {
  const map = readRaw();
  return Object.values(map);
}

export function getSyncingKeys() {
  return new Set(Object.keys(readRaw()));
}

export function getEntry(key) {
  const map = readRaw();
  return map[key] || null;
}

export function enqueue({ accountKey, date, entries, auditNote, rideNote }) {
  if (!accountKey || !date || !Array.isArray(entries)) return;
  const map = readRaw();
  const key = queueKey(accountKey, date);
  map[key] = {
    accountKey,
    date,
    entries,
    auditNote: auditNote || null,
    rideNote:  rideNote  || null,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    lockedAt: null,
  };
  writeRaw(map);
}

export function dequeue(key) {
  const map = readRaw();
  if (!(key in map)) return;
  delete map[key];
  writeRaw(map);
}

export function bumpAttempts(key) {
  const map = readRaw();
  if (!(key in map)) return;
  map[key].attempts = (map[key].attempts || 0) + 1;
  writeRaw(map);
}

// Multi-tab lock. acquireLock returns true when this tab has taken the
// slot; false if another tab holds it and the lock is still fresh. A
// stale lock (older than LOCK_TTL_MS) is treated as abandoned - the
// current tab takes ownership.
export function acquireLock(key) {
  const map = readRaw();
  const entry = map[key];
  if (!entry) return false;
  const now = Date.now();
  if (entry.lockedAt) {
    const lockedAtMs = new Date(entry.lockedAt).getTime();
    if (!Number.isNaN(lockedAtMs) && (now - lockedAtMs) < LOCK_TTL_MS) {
      return false;
    }
  }
  entry.lockedAt = new Date(now).toISOString();
  map[key] = entry;
  writeRaw(map);
  return true;
}

export function releaseLock(key) {
  const map = readRaw();
  const entry = map[key];
  if (!entry) return;
  entry.lockedAt = null;
  map[key] = entry;
  writeRaw(map);
}

// ── Timers + failure discrimination ──────────────────────────────────

// Delay for the Nth retry. Attempts starts at 0 for the first retry
// after the initial failure. Values beyond the schedule length clamp to
// the last (5m) value.
export function nextDelayMs(attempts) {
  const i = Math.max(0, Math.min(BACKOFF_MS.length - 1, attempts));
  return BACKOFF_MS[i];
}

// Is this thrown value a network-class failure worth queuing?
//   fetch itself rejected (offline / DNS / CORS / TLS / connection reset)
//     - err.name is typically "TypeError" in browsers
//     - err.message contains "Failed to fetch" / "NetworkError" / etc.
// NOT worth queuing:
//   - AbortError (unmount / user navigation - the user did not intend to
//     save; retrying later would be surprising)
//   - anything after a res.json() where the server actually responded
//     (server rejections handled in-line by the save handler)
export function isNetworkError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return false;
  // Everything else that made fetch throw is treated as network-class.
  // Browsers use TypeError; older Node/edge runtimes may use different
  // names. Broadening the accept-set is safer than narrowing - the
  // downstream handler already discriminates "server responded" (falls
  // out of this catch branch entirely).
  return true;
}

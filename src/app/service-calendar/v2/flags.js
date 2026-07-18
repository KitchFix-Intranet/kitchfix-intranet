"use client";

// SC Redesign Program - v2 theme flag + Entry v2 sub-flag + cutover.
//
// Owns the on/off signals for the .scv2 theme layer and Entry v2.
//
// Semantics (revised W7 PR 3/3 Phase 6):
//   default             OFF
//   env preview         NEXT_PUBLIC_SC_V2=1 flips the default to ON
//   ?<param>=1          persists STORAGE_ON to localStorage (durable on)
//   ?<param>=0          persists STORAGE_OFF to localStorage (durable off,
//                       the operator kill switch - previously this cleared
//                       to default, but the dead "" read-branch is now
//                       load-bearing for account-cutover precedence)
//   ?<param>=clear      removes the stored value entirely; the flag
//                       falls back to env default. No state is unreachable.
//   localStorage        wins over env when set (either ON or OFF)
//
// Hydration model: default OFF on the first paint so server-rendered
// HTML matches client-rendered HTML with zero drift, then upgrade
// after mount if the resolved value is ON. Kevin + one admin are the
// only audience during coexistence per program scope section 8, so a
// one-tick FOUC on flag ON is acceptable and cheaper than an SSR round
// trip on the theme.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// ─── Generic flag helpers ───────────────────────────────────
// Same shape reused for every SC v2 sub-flag. Extracted so
// useScEntryV2 (W7) sits next to useScV2 without copy-paste divergence.

function makeStorageKey(name) { return `sc-${name}`; }
const STORAGE_ON = "1";
const STORAGE_OFF = "";

function envDefault(envName) {
  return process.env[envName] === "1";
}

function readStored(name) {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(makeStorageKey(name));
    if (v === STORAGE_ON) return true;
    if (v === STORAGE_OFF && v !== null) return false;
    return null;
  } catch {
    return null;
  }
}

function writeStored(name, value) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(makeStorageKey(name));
    } else {
      window.localStorage.setItem(makeStorageKey(name), value ? STORAGE_ON : STORAGE_OFF);
    }
  } catch {
    /* localStorage unavailable (Safari private, etc.) - flag falls back to env default */
  }
}

// Internal state hook - returns { resolved, stored, envDefault: envDef }.
// The tri-state is what enables Phase 6 account cutover: the mount site
// composes stored-off (kill) vs stored-on (durable on) vs absent
// (fall through to env default OR account-cutover-list membership).
function useFlagState(name, qsParam, envName) {
  const [state, setState] = useState({ resolved: false, stored: null, envDef: false });
  const searchParams = useSearchParams();
  const qsRaw = searchParams?.get(qsParam);

  useEffect(() => {
    if (qsRaw === "1") writeStored(name, true);
    else if (qsRaw === "0") writeStored(name, false);   // persist force-off (Phase 6 kill switch)
    else if (qsRaw === "clear") writeStored(name, null); // remove stored, fall back to env

    const stored = readStored(name);
    const envDef = envDefault(envName);
    const resolved = stored !== null ? stored : envDef;
    setState({ resolved, stored, envDef });
  }, [qsRaw]);

  return state;
}

// Back-compat: returns the boolean the callers used before Phase 6.
function useFlag(name, qsParam, envName) {
  return useFlagState(name, qsParam, envName).resolved;
}

export function useScV2() {
  return useFlag("v2", "v2", "NEXT_PUBLIC_SC_V2");
}

// ─── Entry v2 sub-flag (W7) ───────────────────────────────────
// AND-gated at the call site with useScV2 - Entry v2 never exists
// outside the v2 theme layer. Same semantics family as useScV2:
//   default OFF; NEXT_PUBLIC_SC_ENTRY_V2=1 default-on for previews;
//   ?entry2=1 persists STORAGE_ON; ?entry2=0 persists STORAGE_OFF
//   (kill switch); ?entry2=clear removes the stored value.
// Also gated by isFeeAccount at the mount site - the live bill is
// meaningless without per-meal $ so fee accounts (all five flat_fee
// incl. STL-FL) stay on v1 DayDetail (locked in scope §7).
export function useScEntryV2() {
  return useFlag("entry-v2", "entry2", "NEXT_PUBLIC_SC_ENTRY_V2");
}

// ─── Phase 6 cutover: per-account entry v2 list ────────────────
// Zero DB changes; the set is code-owned so cutover is a one-line PR.
// Adding an account key here makes DayEntryV2 the default for that
// account when the operator has NOT set a stored preference. Removing
// a key reverts that account to v1 as the default.
//
// SEEDED with "CIN - AZ" (2026-07-18 - Kevin's home account; his real
// daily entry is the shakedown). Kevin can empty the list at merge if
// he prefers a beat later before flipping his own account.
//
// Key format: canonical account key with spaces around the hyphen -
// proven by `ServiceCalendar.js:463` which falls back to `"CIN - AZ"`
// as the hydration default, by every `?account=CIN+-+AZ` URL, and by
// every `loadMonthData("CIN - AZ", ...)` call site. `selectedAccount`
// holds exactly this string, so the Set.has() check at the mount is
// a same-shape compare - no normalization at either end.
export const ENTRY_V2_ACCOUNTS = new Set([
  "CIN - AZ",
]);

// ─── Effective entry-v2 gate for a specific account ───────────
// Precedence (stored-off wins over everything - operator kill switch):
//
//   scV2 must be true.
//   isFeeAccount cuts hard (fee accounts never render DayEntryV2 -
//     scope §7, live bill meaningless without per-meal $).
//   Then:
//     entry-v2 stored OFF   -> false (kill switch beats cutover list)
//     entry-v2 stored ON    -> true
//     entry-v2 absent       -> envDefault OR ENTRY_V2_ACCOUNTS.has(key)
//
// Kept pure of the mount site's business logic (no data.account probe
// here - accountKey is the only account signal it needs). Structure
// call: exposed as its own hook so the mount site doesn't have to
// double-read localStorage OR duplicate the precedence table.
export function useScEntryV2Effective(accountKey, isFeeAccount) {
  const scV2 = useScV2();
  const { stored, envDef } = useFlagState("entry-v2", "entry2", "NEXT_PUBLIC_SC_ENTRY_V2");

  if (!scV2) return false;
  if (isFeeAccount) return false;
  if (stored === false) return false;   // kill switch
  if (stored === true) return true;     // durable on
  // stored === null (absent): env default OR account is in the cutover set
  return envDef || (accountKey ? ENTRY_V2_ACCOUNTS.has(accountKey) : false);
}

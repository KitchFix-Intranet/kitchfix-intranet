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

// MLB homestand-surface set. Re-exported from the non-hook pilots.js
// so both the client render layer and the server payload builder can
// import from the same source without pulling React into a server
// module. Renamed from M2_HOMESTAND_ACCOUNTS at M-4a - "M2" was a
// phase name that outlived the phase.
export { MLB_HOMESTAND_SURFACE_ACCOUNTS } from "./pilots";

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
//
// `defaultOn` (W9 PR 1/2 - the defaults flip): when both storage AND
// env are absent, `defaultOn=true` resolves to true. Used by scV2 to
// flip its default from OFF to ON pre-soak; entry-v2 keeps
// `defaultOn=false` because the cutover list is what governs the
// per-account default (see ENTRY_V2_ACCOUNTS + useScEntryV2Effective).
function useFlagState(name, qsParam, envName, defaultOn = false) {
  const [state, setState] = useState({ resolved: false, stored: null, envDef: false });
  const searchParams = useSearchParams();
  const qsRaw = searchParams?.get(qsParam);

  useEffect(() => {
    if (qsRaw === "1") writeStored(name, true);
    else if (qsRaw === "0") writeStored(name, false);   // persist force-off (Phase 6 kill switch)
    else if (qsRaw === "clear") writeStored(name, null); // remove stored, fall back to env

    const stored = readStored(name);
    const envDef = envDefault(envName);
    // When storage is absent, resolve to env-on OR the flag's own
    // baked-in default. Storage still wins (both stored=true and
    // stored=false override this fallback - kill switch stays intact).
    const resolved = stored !== null ? stored : (envDef || defaultOn);
    setState({ resolved, stored, envDef });
  }, [qsRaw]);

  return state;
}

// Back-compat: returns the boolean the callers used before Phase 6.
function useFlag(name, qsParam, envName, defaultOn = false) {
  return useFlagState(name, qsParam, envName, defaultOn).resolved;
}

// W9 PR 1/2 - scV2 default flips ON. Effective for the admin
// audience (page.js SC_ADMINS gate stays put; §9 W9's audience
// scoping is enforced there, not here). `?v2=0` remains the durable
// kill switch during soak - it persists STORAGE_OFF and beats the
// new default via the `stored !== null ? stored : (envDef ||
// defaultOn)` order above. Kill switch sunsets in W9 PR 2/2 when the
// flag-off world is removed.
export function useScV2() {
  return useFlag("v2", "v2", "NEXT_PUBLIC_SC_V2", /* defaultOn = */ true);
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
// W9 PR 1/2 - EXPANDED to every per-meal account (2026-07-18).
// Kevin's home account (CIN - AZ) shipped as the first cutover in
// PR #468 and has soaked through W8. W9 PR 1/2 seeds every per-meal
// key so that on pure defaults (no URL params, empty storage) every
// per-meal account opens DayEntryV2 by default. Fee accounts remain
// outside the list AND cut hard by the isFeeAccount fence in
// useScEntryV2Effective (belt-and-braces preserved). `?entry2=0` on
// any account is the durable operator kill switch during soak -
// load-bearing as the per-account rollback path.
//
// Every seeded key is grepped from a canonical source, never typed.
// The CIN - AZ lesson is institutional. Citations below:
//
//   "CIN - AZ"    ServiceCalendar.js:478 - URL hydration fallback
//                 default ([urlAccount, d.defaultAccount, "CIN - AZ"])
//   "TXR - AZ"    season/phaseCalendar.js:118 - PER_ACCOUNT_2026 key
//   "TBR - FL"    season/phaseCalendar.js:134 - PER_ACCOUNT_2026 key
//   "TBJ - FL"    season/phaseCalendar.js:158 - PER_ACCOUNT_2026 key
//   "CIN - KY"    lib/scheduleDrift.js:41 - MLB Stats API account map
//   "TBJ - NY"    lib/scheduleDrift.js:42 - MLB Stats API account map
//
// Cross-check: docs/modules/SERVICE_CALENDAR.md lists exactly these
// six as `billing_model IN ('per_meal', 'actuals_drive_invoice')`
// (per-meal + MLB-adjacent AAA). Fee accounts (CIN - OH, STL - FL,
// STL - MO, TXR - TX - H, TXR - TX - V) intentionally omitted per
// scope §7 fence.
//
// Key format: canonical account key with spaces around the hyphen -
// `selectedAccount` holds exactly this string, so the Set.has()
// check at the mount is a same-shape compare.
// Phase 2B (2026-07-25): the set now carries a SECOND meaning -
// per-meal cutover keys (six original) PLUS fee-account opt-in
// (STL - FL). STL-FL is flat_fee but has no homestand data (the
// classifier at serviceCalendar.js:249-251 confirms this), so it
// renders on DayEntryV2's fee-no-dollar variant (BillRailFee +
// vocab.js "served"/"confirm"). MLB fee accounts stay OUT of the
// set - they render v1 until Phase 4 (MLB SC v2.1).
//
// MLB keys deliberately EXCLUDED from this set (Phase 4 target):
//   "CIN - OH"      MLB Reds - fee + homestand
//   "STL - MO"      MLB Cardinals - fee + homestand
//   "TXR - TX - H"  MLB Rangers home - fee + homestand
//   "TXR - TX - V"  MLB Rangers visitors - fee + homestand
// Adding any of these before Phase 4 breaks the MLB v1 fence.
export const ENTRY_V2_ACCOUNTS = new Set([
  "CIN - AZ",
  "TXR - AZ",
  "TBR - FL",
  "TBJ - FL",
  "CIN - KY",
  "TBJ - NY",
  "STL - FL",   // fee-no-dollar; opts in via cutover-set override in useScEntryV2Effective
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

  // Phase 2B (2026-07-25): fee-account gate is now account-level, not
  // shape-level. Fee accounts default OFF, but the ENTRY_V2_ACCOUNTS
  // cutover set can override - STL-FL opts in this way. MLB fee
  // accounts (CIN-OH, STL-MO, TXR-TX-H, TXR-TX-V) are DELIBERATELY
  // NOT in the set until Phase 4 (MLB SC v2.1).
  //
  // Do NOT "simplify" this back to `if (isFeeAccount) return false`.
  // That was the shape-level shortcircuit; removing the cutover-set
  // clause re-shadows the account-level opt-in and unfences the four
  // MLB accounts by shape membership. See ENTRY_V2_ACCOUNTS above
  // for the MLB key list and the Phase 4 marker.
  //
  // Ordering rationale: this fee gate MUST stay ahead of the stored-
  // flag returns. Otherwise `?entry2=1` on an MLB account would force
  // it into v2 (kill switch inversion). MLB binary is protected by
  // the set-membership check being consulted BEFORE stored is honored
  // for fee accounts.
  if (isFeeAccount && !(accountKey && ENTRY_V2_ACCOUNTS.has(accountKey))) return false;

  if (stored === false) return false;   // kill switch (per-meal only reaches here)
  if (stored === true) return true;     // durable on
  // stored === null (absent): env default OR account is in the cutover set
  return envDef || (accountKey ? ENTRY_V2_ACCOUNTS.has(accountKey) : false);
}

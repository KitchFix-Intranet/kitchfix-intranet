"use client";

// SC Redesign Program - v2 theme flag.
//
// Owns the on/off signal for the .scv2 theme layer. Semantics:
//   default        OFF
//   env preview    NEXT_PUBLIC_SC_V2=1 flips the default to ON
//   ?v2=1          persists an ON override to localStorage
//   ?v2=0          clears the override (falls back to env default)
//   localStorage   wins over env when set
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

function useFlag(name, qsParam, envName) {
  // First paint: OFF (matches SSR). Upgrade after mount when the
  // resolved value is ON. Never render a class before hydration.
  const [enabled, setEnabled] = useState(false);
  const searchParams = useSearchParams();
  const qsRaw = searchParams?.get(qsParam);

  useEffect(() => {
    if (qsRaw === "1") writeStored(name, true);
    else if (qsRaw === "0") writeStored(name, null);

    const stored = readStored(name);
    const resolved = stored !== null ? stored : envDefault(envName);
    setEnabled(resolved);
  }, [qsRaw]);

  return enabled;
}

export function useScV2() {
  return useFlag("v2", "v2", "NEXT_PUBLIC_SC_V2");
}

// ─── Entry v2 sub-flag (W7) ───────────────────────────────────
// AND-gated at the call site with useScV2 - Entry v2 never exists
// outside the v2 theme layer. Same semantics family as useScV2:
//   default OFF; NEXT_PUBLIC_SC_ENTRY_V2=1 default-on for previews;
//   ?entry2=1 persists localStorage; ?entry2=0 clears.
// Also gated by isFeeAccount at the mount site - the live bill is
// meaningless without per-meal $ so fee accounts (all five flat_fee
// incl. STL-FL) stay on v1 DayDetail (locked in scope §7).
export function useScEntryV2() {
  return useFlag("entry-v2", "entry2", "NEXT_PUBLIC_SC_ENTRY_V2");
}

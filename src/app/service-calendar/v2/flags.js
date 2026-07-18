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

const STORAGE_KEY = "sc-v2";
const STORAGE_ON = "1";
const STORAGE_OFF = "";

function envDefault() {
  return process.env.NEXT_PUBLIC_SC_V2 === "1";
}

function readStored() {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === STORAGE_ON) return true;
    if (v === STORAGE_OFF && v !== null) return false;
    return null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, value ? STORAGE_ON : STORAGE_OFF);
    }
  } catch {
    /* localStorage unavailable (Safari private, etc.) - flag falls back to env default */
  }
}

export function useScV2() {
  // First paint: OFF (matches SSR). Upgrade after mount when the
  // resolved value is ON. Never render a class before hydration.
  const [enabled, setEnabled] = useState(false);
  const searchParams = useSearchParams();
  const qsRaw = searchParams?.get("v2");

  useEffect(() => {
    // ?v2=1 persists ON; ?v2=0 clears any stored override.
    if (qsRaw === "1") writeStored(true);
    else if (qsRaw === "0") writeStored(null);

    const stored = readStored();
    const resolved = stored !== null ? stored : envDefault();
    setEnabled(resolved);
  }, [qsRaw]);

  return enabled;
}

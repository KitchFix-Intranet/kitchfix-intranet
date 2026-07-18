"use client";

// SC v2 density toggle - Comfortable / Compact.
//
// Applies as `data-sc2-density="compact"` on the `.scv2` root when
// compact is active (the token layer's compact override remaps
// --sc2-scale + spacing). Comfortable is the base .scv2 state.
//
// IMPORTANT: this attribute is `data-sc2-density`, NOT `data-density`.
// The site-wide `[data-density]` selector in globals.css owns generic
// `--type-*` / `--space-*` tokens for every v1 module; writing v2's
// density value there would silently swing v1 components sharing the
// sc-root. See tokens.css comment for the split's history.
//
// Persists per user in localStorage under a distinct key from the flag
// itself so a user's density preference survives independent of the
// v2 flag state.
//
// First paint: comfortable (base tokens). Upgrade after mount when a
// stored preference is compact. Matches the flag's SSR discipline -
// no hydration mismatch.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sc-v2-density";
const VALUES = ["comfortable", "compact"];
const DEFAULT_DENSITY = "comfortable";

function readStored() {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return VALUES.includes(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  if (typeof window === "undefined") return;
  try {
    if (VALUES.includes(value)) {
      window.localStorage.setItem(STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* localStorage unavailable - preference resets to comfortable next session */
  }
}

export function useDensity() {
  const [density, setDensityState] = useState(DEFAULT_DENSITY);

  useEffect(() => {
    const stored = readStored();
    if (stored) setDensityState(stored);
  }, []);

  const setDensity = useCallback((next) => {
    if (!VALUES.includes(next)) return;
    setDensityState(next);
    writeStored(next);
  }, []);

  return [density, setDensity];
}

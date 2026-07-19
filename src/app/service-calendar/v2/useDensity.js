"use client";

// SC v2 density toggle - V3 §S4 Standard | Comfortable.
//
// V3 refresh (spec §S4.1): the legacy Compact branch is recalibrated
// INTO Standard (no third mode). The toggle now offers:
//   Standard      = the new default; tighter enterprise density; the
//                   80-percent feel at 100 percent zoom (spec §0.4).
//   Comfortable   = larger option (the "less-dense" preference).
//
// Applied as `data-sc2-density="comfortable"` on the `.scv2` root when
// the user opts up. `data-sc2-density="standard"` is the default and
// requires no attribute value; it's set explicitly so runtime probes
// can still read it.
//
// Backward compat: any stored "compact" value from before V3 is read
// as "standard" (the recalibration). Old bookmarks / test setups
// continue to work.
//
// IMPORTANT: this attribute is `data-sc2-density`, NOT `data-density`.
// The site-wide `[data-density]` selector in globals.css owns generic
// `--type-*` / `--space-*` tokens for every v1 module; writing v2's
// density value there would silently swing v1 components sharing the
// sc-root.
//
// Persists per user in localStorage under a distinct key from the flag
// itself so a user's density preference survives independent of the
// v2 flag state.

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sc-v2-density";
const VALUES = ["standard", "comfortable"];
const DEFAULT_DENSITY = "standard";

/* Migrate the legacy compact preference to standard per V3 §S4.1. */
function normalize(v) {
  if (v === "compact") return "standard";
  return VALUES.includes(v) ? v : null;
}

function readStored() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalize(raw);
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
    /* localStorage unavailable - preference resets to standard next session */
  }
}

export function useDensity() {
  const [density, setDensityState] = useState(DEFAULT_DENSITY);

  useEffect(() => {
    const stored = readStored();
    if (stored) setDensityState(stored);
  }, []);

  const setDensity = useCallback((next) => {
    const norm = normalize(next);
    if (!norm) return;
    setDensityState(norm);
    writeStored(norm);
  }, []);

  return [density, setDensity];
}

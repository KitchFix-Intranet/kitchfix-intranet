"use client";

// ════════════════════════════════════════════════════════════════════════════
// ldugFetch — wrapper around fetch that injects impersonation header
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 7)
//
// Reads localStorage.kf_ldug_impersonate. If present, forwards as
// x-impersonate-email header. Server validates: requires test mode ON and
// caller as system viewer. Otherwise silently ignored.
// ════════════════════════════════════════════════════════════════════════════

export function ldugFetch(url, options = {}) {
  const impersonate = typeof window !== "undefined"
    ? localStorage.getItem("kf_ldug_impersonate") || ""
    : "";

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    ...(impersonate ? { "x-impersonate-email": impersonate } : {}),
  };

  return fetch(url, { ...options, headers });
}
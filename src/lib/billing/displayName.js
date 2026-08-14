// ═══════════════════════════════════════════════════════════════════
// displayName - resolve email addresses to person display names for
// N1 + N2 copy. PR-F1 2026-08-14.
// ═══════════════════════════════════════════════════════════════════
//
// Owner ruling 2026-08-14: N1 lead sentence must read
//   "Kevin Fietek finalized the week..."
// not
//   "k.fietek@kitchfix.com finalized the week..."
// Also: no visible email addresses in the rendered body, so Gmail
// does not auto-link them.
//
// Authoritative source (recon 2026-08-14): the `contacts` table in
// Postgres (`src/lib/dataStore/directory.js:733` readContactsPostgres).
// Shape: { id, team_key, role, name, email, ... }. Keyed by
// case-folded email. Directory is the intranet's canonical
// person-per-account roster and every email in the notification
// matrix (Kevin, Joe, Josh, Sebastian, salaried managers, submitter)
// is representable there.
//
// Fallback ladder if the DB lookup misses:
//   1. contacts.name for the row where lower(email) matches
//   2. local-part titlecase heuristic (k.fietek -> "K Fietek")
//   3. raw email, but ONLY as an internal debug fallback - never
//      rendered into the body by the notification path; the copy
//      degrades to "the site leader" if the resolver returned an
//      address-shaped string.

import { getServiceClient } from "@/lib/supabase";

// Titlecase the local-part of an email: k.fietek -> "K Fietek",
// jordan.rogers -> "Jordan Rogers", ochoa -> "Ochoa".
export function titlecaseLocalPart(email) {
  if (typeof email !== "string") return "";
  const local = String(email).trim().toLowerCase().split("@")[0] || "";
  if (!local) return "";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

// Given an array of email addresses, resolve each to a display name
// via a single Postgres round trip. Returns a Map<lowerEmail, name>
// where every input email has an entry (name may be the titlecase
// fallback if no contacts row matches).
//
// Injectable for tests via deps.supa. Non-array + empty inputs
// return an empty Map without hitting the DB.
export async function resolveDisplayNames(emails, deps = {}) {
  const out = new Map();
  if (!Array.isArray(emails) || emails.length === 0) return out;

  const norm = emails
    .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
    .filter(Boolean);
  const unique = [...new Set(norm)];
  if (unique.length === 0) return out;

  // Seed the fallback for every input first, so the returned Map is
  // total. Any DB hit overwrites the fallback.
  for (const email of unique) {
    out.set(email, titlecaseLocalPart(email) || email);
  }

  try {
    const supa = deps.supa || getServiceClient();
    const { data, error } = await supa
      .from("contacts")
      .select("name, email")
      .in("email", unique);
    if (error) throw new Error(error.message);
    for (const row of (data || [])) {
      const key = String(row.email || "").trim().toLowerCase();
      if (!key) continue;
      const name = String(row.name || "").trim();
      if (name) out.set(key, name);
    }
  } catch (e) {
    // Log-and-continue: notification content should not be blocked
    // by a directory read failure. The seeded titlecase fallback is
    // already in the map.
    console.warn("[displayName] contacts lookup failed:", e?.message || e);
  }

  return out;
}

/**
 * Convenience wrapper: resolve a single email to its display name,
 * with the same fallback ladder as resolveDisplayNames.
 */
export async function resolveOneDisplayName(email, deps = {}) {
  if (!email) return "";
  const map = await resolveDisplayNames([email], deps);
  return map.get(String(email).trim().toLowerCase()) || email;
}

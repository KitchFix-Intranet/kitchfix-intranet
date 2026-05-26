// ═══════════════════════════════════════════════════════════════
// SUPABASE SERVICE CLIENT (Stage 1 dual-write infrastructure)
// ═══════════════════════════════════════════════════════════════
//
// Mirrors getServiceAccountSheetsClient() in src/lib/sheets.js:
// one constructor, fresh client per call, no singleton.
//
// LAZY CONSTRUCTION: this module exports the constructor but does NOT
// call it at module-load time. The Supabase client is only built when
// a cutover flag (DUAL_WRITE_TABLES / READ_FROM_POSTGRES) routes an
// actual call here. With both flags off (the default state on merge),
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY may be ABSENT and the app
// runs cleanly because nothing ever calls getServiceClient().
//
// CRITICAL: SUPABASE_SERVICE_ROLE_KEY bypasses Row-Level Security.
// This key is SERVER-SIDE ONLY. NEVER prefix with NEXT_PUBLIC_ (Next.js
// would inline it into client bundles). The env var name stays unprefixed
// so Next.js leaves it server-side automatically. Do not import this
// module into any client component. Do not log the key. Do not pass it
// to anything outside this file.

import { createClient } from "@supabase/supabase-js";

/**
 * Construct a Supabase service-role client for server-side use.
 *
 * Disables auth-session persistence and token refresh: this client
 * is a fire-and-forget server actor, not a user-session client.
 *
 * Called only by src/lib/dataStore.js when a cutover flag activates
 * the Postgres path for a given table. If you find yourself calling
 * this from a handler directly, route through dataStore instead.
 *
 * @returns SupabaseClient configured for service-role access.
 * @throws if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.
 *   This is intentional: if a cutover flag activates this path and
 *   the env vars are absent, we want to fail loudly (not silently
 *   fall through to Sheets-only). A missing env here means the
 *   deployment was misconfigured.
 */
export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env missing: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set for any cutover-active table. " +
      "If you see this error with cutover flags off, something is calling getServiceClient() unconditionally - check the dataStore."
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

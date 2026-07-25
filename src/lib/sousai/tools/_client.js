// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/_client.js
// Shared service-role Supabase client for the SousAI tools.
//
// The three tool functions (searchDocuments, getDocument, listDocuments) each
// hit PG multiple times per call. Instantiating a fresh client per call would
// re-parse the env vars and re-instantiate an HTTP client for every call - a
// module-level singleton keeps that cost off the hot path. The auth options
// disable session persistence (tools run in a stateless request context) and
// disable auto-refresh (service-role tokens do not need refresh).
//
// This is a Phase A helper. Phase B may accept a caller-injected client to
// support test doubles; for now the tools take no supabase parameter and use
// this module.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

let _client = null;

export function getSupabase() {
  if (_client) return _client;
  _client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return _client;
}

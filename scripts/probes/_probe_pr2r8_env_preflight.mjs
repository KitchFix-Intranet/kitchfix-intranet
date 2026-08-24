// PR2 R8 env preflight - report presence only, never values.
// Run: node --env-file=.env.local scripts/probes/_probe_pr2r8_env_preflight.mjs
const KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_URL",
  "AUTH_SECRET",
];
let allSet = true;
for (const k of KEYS) {
  const present = typeof process.env[k] === "string" && process.env[k].length > 0;
  if (!present) allSet = false;
  console.log(`${k.padEnd(35)} ${present ? "SET" : "MISSING"}`);
}
process.exit(allSet ? 0 : 1);

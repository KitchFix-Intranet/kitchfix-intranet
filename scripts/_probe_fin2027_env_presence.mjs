// Throwaway PRESENT/ABSENT probe. No values, no echo.
// run: node --env-file=.env.local scripts/_probe_fin2027_env_presence.mjs

const url = !!process.env.SUPABASE_URL;
const key = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`SUPABASE_URL:              ${url ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${key ? "PRESENT" : "ABSENT"}`);
if (!url || !key) process.exit(2);
process.exit(0);

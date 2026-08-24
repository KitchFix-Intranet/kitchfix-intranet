// PR2 R2 env preflight - name which credentials process.env sees.
// Never reads .env files; env vars come from the runner's shell only.
const need = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const present = [];
const missing = [];
for (const k of need) {
  if (process.env[k] !== undefined && process.env[k] !== "") present.push(k);
  else missing.push(k);
}
console.log("PRESENT:", present.join(", ") || "(none)");
console.log("MISSING:", missing.join(", ") || "(none)");
process.exit(missing.length ? 2 : 0);

// env preflight via process.env inside script (never open .env*)
const keys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "NEXTAUTH_URL",
  "NEXTAUTH_SECRET",
  "GOOGLE_ID",
  "GOOGLE_SECRET",
  "TEST_MODE",
  "VERCEL",
  "PORT",
];
const out = {};
for (const k of keys) {
  const v = process.env[k];
  out[k] = v == null ? "MISSING" : (v.length > 0 ? "SET" : "EMPTY");
}
console.log(JSON.stringify(out, null, 2));

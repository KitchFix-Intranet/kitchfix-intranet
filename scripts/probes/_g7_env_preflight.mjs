// Env preflight - reports PRESENT/ABSENT only. Never prints values.
import 'dotenv/config';
const wanted = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RIPPLING_API_KEY', 'BILLCOM_PROXY_BASE', 'BILLCOM_PROXY_KEY'];
for (const w of wanted) {
  const v = process.env[w];
  const present = typeof v === 'string' && v.trim().length > 0;
  console.log(w + ': ' + (present ? 'PRESENT' : 'ABSENT'));
}

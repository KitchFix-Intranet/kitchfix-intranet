// Lock table pre-run check. Expect empty.
import { createClient } from '@supabase/supabase-js';
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await supa.from('purchasing_sync_locks').select('*');
if (error) { console.error('LOCK CHECK ERROR:', error.message); process.exit(1); }
console.log('purchasing_sync_locks rows:', data.length);
if (data.length > 0) {
  console.log('LOCK ROWS PRESENT - STOP:');
  for (const r of data) console.log(JSON.stringify(r));
} else {
  console.log('EMPTY - safe to proceed');
}

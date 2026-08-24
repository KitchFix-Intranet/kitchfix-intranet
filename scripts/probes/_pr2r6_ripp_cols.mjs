import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supa = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function main() {
  // Get one row and print keys.
  const { data, error } = await supa.from('rippling_raw_spend_lines_latest').select('*').limit(1);
  if (error) { console.error(error); return; }
  console.log(Object.keys(data[0] || {}));
  // Second: check what "category" is called - print sample values
  const { data: d2 } = await supa.from('rippling_raw_spend_lines_latest')
    .select('rippling_id, merchant_name, category_name, subcategory_name, custom_expense_type_name')
    .limit(3);
  console.log(d2);
}
main().catch(console.error);

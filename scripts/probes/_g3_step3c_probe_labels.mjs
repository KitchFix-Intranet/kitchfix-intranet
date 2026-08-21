#!/usr/bin/env node
/* G3 3c: category labels are "null" in spend_category_map. Look at
   the raw Rippling spend lines to find the actual category name per
   category_id, and cross-ref against the CSV. */

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// grab a raw spend line for a specific category_id and look at raw fields
async function probeRaw(catId) {
  const { data, error } = await supa
    .from("rippling_raw_spend_lines_latest")
    .select("category_id, raw, merchant_name")
    .eq("category_id", catId)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

const scm = [];
{ let from = 0; const step = 1000;
  while (true) {
    const { data, error } = await supa.from("spend_category_map").select("category_id, category_label, merchant_sample").order("category_id").range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    scm.push(...data);
    if (data.length < step) break;
    from += step;
  }
}
console.log(`scm rows: ${scm.length}`);

// probe first row's raw JSON
const first = await probeRaw(scm[0].category_id);
console.log("\nraw sample:");
console.log(JSON.stringify(first, null, 2).slice(0, 1500));

// look for category name field in raw
console.log("\n\nkeys in raw:");
console.log(Object.keys(first.raw || {}));

// probe second, third rows too
for (const scmRow of scm.slice(1, 4)) {
  const raw = await probeRaw(scmRow.category_id);
  console.log(`\ncat_id=${scmRow.category_id}:`);
  console.log(`  merchant=${raw.merchant_name}`);
  console.log(`  raw keys=${Object.keys(raw.raw || {}).join(",")}`);
  if (raw.raw) {
    for (const k of Object.keys(raw.raw)) {
      if (String(k).toLowerCase().includes("categ")) {
        console.log(`  ${k}=${JSON.stringify(raw.raw[k])}`);
      }
    }
  }
}

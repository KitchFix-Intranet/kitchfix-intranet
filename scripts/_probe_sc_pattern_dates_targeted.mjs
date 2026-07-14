// READ-ONLY targeted probe: for Kevin's exact "blank" pattern dates, dump every
// field that would flow into the render.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TARGETS = [
  { acct: "TXR - TX - H", date: "2026-08-02", desc: "getaway @HOU into home 8/3" },
  { acct: "TXR - TX - H", date: "2026-08-30", desc: "getaway @MIL into home 8/31" },
  { acct: "CIN - OH",     date: "2026-08-13", desc: "getaway @CWS into home 8/14" },
  { acct: "CIN - OH",     date: "2026-08-30", desc: "getaway @CHC into home 8/31" },
  // controls: AWAY final followed by off-day (Kevin says these render OK)
  { acct: "TXR - TX - H", date: "2026-08-16", desc: "control: away final + off-day next" },
  { acct: "TXR - TX - H", date: "2026-08-26", desc: "control: away final + off-day next" },
  { acct: "CIN - OH",     date: "2026-08-09", desc: "control: away final + off-day next" },
  // reverse-side mismatches from the earlier probe
  { acct: "CIN - OH",     date: "2026-05-29", desc: "mismatch: hs=GAME api=HOME meta=AWAY" },
  { acct: "CIN - OH",     date: "2026-08-20", desc: "mismatch: hs=GAME api=HOME meta=AWAY" },
];

async function probeDate(acct, date, desc) {
  const [{ data: hs }, { data: meta }, { data: rev }] = await Promise.all([
    supa.from("sc_homestand_schedule").select("*").eq("account_key", acct).eq("service_date", date).maybeSingle(),
    supa.from("sc_day_metadata").select("*").eq("account_key", acct).eq("service_date", date).maybeSingle(),
    supa.from("sc_daily_revenue").select("*").eq("account_key", acct).eq("service_date", date).order("service_id", { ascending: true }),
  ]);
  console.log(`\n${acct} :: ${date} (${desc})`);
  console.log(`  sc_homestand_schedule:`);
  if (hs) {
    console.log(`    day_type=${hs.day_type} opponent=${hs.opponent} game_pk=${hs.game_pk}`);
    console.log(`    game_time=${hs.game_time} day_night=${hs.day_night} is_doubleheader=${hs.is_doubleheader}`);
    console.log(`    homestand_id=${hs.homestand_id} created_at=${hs.created_at}`);
  } else {
    console.log(`    (NO ROW)`);
  }
  console.log(`  sc_day_metadata:`);
  if (meta) {
    console.log(`    game_type=${meta.game_type} game_time=${meta.game_time}`);
    console.log(`    period=${meta.period} week_label=${meta.week_label} event_label=${meta.event_label}`);
    console.log(`    created_at=${meta.created_at} updated_at=${meta.updated_at} updated_by=${meta.updated_by}`);
  } else {
    console.log(`    (NO ROW)`);
  }
  console.log(`  sc_daily_revenue rows: ${rev?.length || 0}`);
  if (rev && rev.length > 0) {
    const gtSet = new Set(rev.map(r => r.game_type));
    console.log(`    game_type set: ${JSON.stringify([...gtSet])}`);
    const projSum = rev.reduce((a,r)=>a+(Number(r.projected_count)||0),0);
    const actSum  = rev.reduce((a,r)=>a+(Number(r.actual_count)||0),0);
    console.log(`    projected_count sum: ${projSum}, actual_count sum: ${actSum}`);
  }
}

async function main() {
  console.log("READ-ONLY :: field-level probe for Kevin's exact pattern-hit dates");
  console.log("             + controls (away+off next day, render OK per Kevin)");
  console.log("             + reverse-side hs/meta mismatches from Step 2");
  for (const t of TARGETS) {
    await probeDate(t.acct, t.date, t.desc);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// Reports the most recent cron_runs rows for the five nightly lanes
// added in the watchdog PR. Read-only; USE-not-SEE on .env.local.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const LANES = [
  "rippling-raw-sync",
  "purchasing-billcom",
  "purchasing-billcom-credits",
  "purchasing-rippling-spend",
  "purchasing-report-ingest",
];

for (const lane of LANES) {
  const q = await supa.from("cron_runs")
    .select("id, status, started_at, completed_at, summary, error_message")
    .eq("job_name", lane)
    .order("started_at", { ascending: false })
    .limit(3);
  if (q.error) { console.log(`[${lane}] FAIL ${q.error.message}`); continue; }
  const rows = q.data || [];
  if (rows.length === 0) { console.log(`[${lane}] no rows yet`); continue; }
  console.log(`[${lane}] ${rows.length} recent row(s):`);
  for (const r of rows) {
    const sumStr = r.summary == null ? "null" : JSON.stringify(r.summary).slice(0, 200);
    const errStr = r.error_message ?? "null";
    console.log(`  id=${r.id}  status=${r.status.padEnd(11)}  started=${r.started_at}  completed=${r.completed_at ?? "null"}`);
    console.log(`     summary: ${sumStr}`);
    console.log(`     error  : ${errStr}`);
  }
}

import { buildScExport } from "../../src/lib/export/scExport.js";
import { getServiceClient } from "../../src/lib/supabase.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

console.log("Building TBJ - FL year 2026...");
const t0 = Date.now();
const res = await buildScExport({ accountKey: "TBJ - FL", scope: "year", year: 2026, generatedBy: "smoke" });
const t1 = Date.now();
console.log(`  Built in ${t1 - t0}ms`);
const buf = Buffer.from(await res.workbook.xlsx.writeBuffer());
const t2 = Date.now();
console.log(`  Serialized in ${t2 - t1}ms, ${(buf.length / 1024).toFixed(1)} KB`);
console.log(`  filename: ${res.filename}`);
console.log(`  meta: services=${res.meta.serviceCount} days=${res.meta.dayCount} window=${res.meta.firstDay}..${res.meta.lastDay}`);
console.log(`  tieToSourceCents: ${res.tieToSourceCents} ($${(res.tieToSourceCents / 100).toFixed(2)})`);

// Debug: dump service list expected vs actual (paginated)
console.log("\n  raw service inclusion check:");
const supa = getServiceClient();
const { data: svcs } = await supa.from("sc_services").select("id, service_name, group_id, is_non_revenue").eq("account_key", "TBJ - FL").eq("active", true).range(0, 999);
for (const s of svcs) {
  const { data: proj } = await supa.from("sc_daily_projections").select("projected_count").eq("service_id", s.id).gte("service_date", "2026-01-01").lte("service_date", "2026-09-11").range(0, 9999);
  const { data: act } = await supa.from("sc_daily_actuals").select("actual_count").eq("service_id", s.id).gte("service_date", "2026-01-01").lte("service_date", "2026-09-11").range(0, 9999);
  const pt = proj.reduce((s, r) => s + (r.projected_count || 0), 0);
  const at = act.reduce((s, r) => s + (r.actual_count || 0), 0);
  console.log(`    ${s.service_name.padEnd(30)} proj=${String(pt).padStart(6)} act=${String(at).padStart(6)} include=${pt > 0 || at > 0}`);
}

const out = path.join(os.homedir(), "Downloads", "sc_export_smoke_" + res.filename);
await fs.writeFile(out, buf);
console.log(`\n  wrote ${out}`);

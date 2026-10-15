// /kpi/labor - RETIRED 2026-10-15 (Kevin ruling).
//
// The standalone Labor section is retired. The P&L Overview is the only
// KPI section; its LaborLedger fold carries the labor drill-down and
// still reads /api/kpi/labor, which is unchanged.
//
// This stub stays instead of deleting the route so saved bookmarks and
// any stale link land on the Overview rather than a 404. Everything
// else under src/app/kpi/labor/ (components/, lib/) is SHARED code the
// Overview imports - see lib/accounts.js and components/Shell.js. Do
// not remove that folder.
import { redirect } from "next/navigation";

export default function RetiredLaborSection() {
  redirect("/kpi/overview");
}

// /kpi/purchasing - RETIRED 2026-10-15 (Kevin ruling).
//
// The standalone Purchasing section is retired. The P&L Overview is the
// only KPI section; its PurchasingFold carries the purchasing
// drill-down and still reads /api/kpi/purchasing, which is unchanged.
//
// This stub stays instead of deleting the route so saved bookmarks and
// any stale link land on the Overview rather than a 404. Everything
// else under src/app/kpi/purchasing/ (components/, lib/) is SHARED -
// the Overview resolver imports buildPurchasingBoard from lib/
// resolver.js. Do not remove that folder.
import { redirect } from "next/navigation";

export default function RetiredPurchasingSection() {
  redirect("/kpi/overview");
}

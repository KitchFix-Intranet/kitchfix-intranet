// ════════════════════════════════════════════════════════════════════════════
// /service-calendar/admin · Service Calendar - corporate admin dashboard
// ════════════════════════════════════════════════════════════════════════════
//
// Server-component gate. Middleware already enforces "logged in"; this page
// enforces "corporate". A logged-in non-corporate user gets redirected back
// to the calendar surface, not shown a stub - the link in the SC header is
// hidden for them too, so any GET to this URL is a deliberate poke.
//
// The check is server-side via auth() + isScAdmin(); hiding the header link
// is NOT the gate. Every admin API action this page eventually calls must
// re-check isScAdmin() server-side too.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isScAdmin } from "@/lib/admin";
import AdminClient from "./AdminClient";

export const metadata = {
  title: "Service Calendar admin · KitchFix",
  description: "Corporate control panel for Service Calendar pricing, fees, and services.",
};

export default async function ServiceCalendarAdminPage() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase().trim();
  if (!isScAdmin(email)) {
    redirect("/service-calendar");
  }
  return <AdminClient email={email} />;
}

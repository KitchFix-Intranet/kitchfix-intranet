// ════════════════════════════════════════════════════════════════════════════
// /service-calendar/admin · thin redirect.
// ════════════════════════════════════════════════════════════════════════════
//
// SC admin became an in-page view mode on /service-calendar?view=admin
// (segmented Year/Month/Today/Admin button on the calendar's control row).
// This route used to render a dedicated AdminClient; that was retired in
// favor of the in-page mount so the hero + account rail + chrome stay
// constant when crossing into admin.
//
// This file preserves old bookmarks pointing at /service-calendar/admin
// by redirecting to the in-page deep link. The destination route
// /service-calendar enforces its own Coming Soon gate for non-SC_ADMINS;
// the in-page admin view + toggle are isScAdmin-gated client-side; and
// every admin POST action is isScAdmin-gated server-side in
// src/app/api/service-calendar/route.js. Triple coverage of the gate.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from "next/navigation";

export const metadata = {
  title: "Service Calendar admin · KitchFix",
};

export default function ServiceCalendarAdminRedirect() {
  redirect("/service-calendar?view=admin");
}

// ════════════════════════════════════════════════════════════════════════════
// /playbook/admin · Project OPD · Build Dashboard (owner-only)
// ════════════════════════════════════════════════════════════════════════════
//
// Read-only catalog health dashboard. Middleware (src/middleware.js) gates
// auth at the edge. The PAGE GATE (owner-only) is enforced inside the
// AdminClient via /api/playbook?action=bootstrap — non-owner sees the same
// coming-soon stub the /playbook gate gives, NOT the dashboard. No writes.
// ════════════════════════════════════════════════════════════════════════════

import AdminClient from "./AdminClient";

export const metadata = {
  title: "Build Dashboard · The Playbook · KitchFix",
  description: "Owner-only catalog health snapshot.",
};

export default function PlaybookAdminPage() {
  return <AdminClient />;
}

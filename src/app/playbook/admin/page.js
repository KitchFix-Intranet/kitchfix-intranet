// ════════════════════════════════════════════════════════════════════════════
// /playbook/admin · Project OPD · OPD Command (owner-only)
// ════════════════════════════════════════════════════════════════════════════
//
// Operator cockpit for the OPD corpus. Owner-only gate enforced inside
// AdminClient via /api/playbook?action=bootstrap - non-owner sees the same
// coming-soon stub the /playbook gate gives, NOT the cockpit.
// ════════════════════════════════════════════════════════════════════════════

import AdminClient from "./AdminClient";

export const metadata = {
  title: "OPD Command · The Playbook · KitchFix",
  description: "Owner-only operations cockpit for the OPD corpus.",
};

export default function PlaybookAdminPage() {
  return <AdminClient />;
}

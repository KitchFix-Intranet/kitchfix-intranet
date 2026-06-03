// ════════════════════════════════════════════════════════════════════════════
// /playbook · Project OPD · The Playbook
// ════════════════════════════════════════════════════════════════════════════
//
// Server-component entry. Middleware (src/middleware.js) gates auth at the
// edge — any unauthenticated request is redirected to /login before reaching
// here. The PAGE GATE (owner-only for v1, opdAcl.canViewPlaybook) is
// enforced by the API bootstrap action: non-owners get a payload with
// isOwner=false and the client renders the coming-soon stub.
//
// One-round-trip pattern — the client calls /api/playbook?action=bootstrap
// on mount and the response carries email + isOwner + shelves + documents.
// ════════════════════════════════════════════════════════════════════════════

import PlaybookClient from "./PlaybookClient";

export const metadata = {
  title: "The Playbook · KitchFix",
  description: "The operational document library.",
};

export default function PlaybookPage() {
  return <PlaybookClient />;
}

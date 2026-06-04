// ════════════════════════════════════════════════════════════════════════════
// /playbook/sous-demo - SousAI chat demo surface (owner-only)
// ════════════════════════════════════════════════════════════════════════════
//
// Demo page for SousAI L5 (generation). Middleware gates auth at the edge;
// the page-level owner check happens inside the client via the existing
// /api/playbook?action=bootstrap pattern (same as /playbook/admin).
//
// This is a feat/sousai-demo surface only - not wired into nav, not in v1,
// not on main. Accessed via the "Ask SousAI (Demo)" button in /playbook/admin.
// ════════════════════════════════════════════════════════════════════════════

import SousDemoClient from "./SousDemoClient";

export const metadata = {
  title: "Sous · Demo · KitchFix",
  description: "SousAI generation demo - owner-only preview.",
};

export default function SousDemoPage() {
  return <SousDemoClient />;
}

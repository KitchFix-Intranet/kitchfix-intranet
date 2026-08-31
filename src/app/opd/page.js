// /opd - the Academy shell. Parallel route to /playbook (which is
// production and untouched). Fenced by ACADEMY_PREVIEW_ONLY: outside
// the fence, this route behaves exactly like an unknown route -
// notFound() renders the standard 404, no dead door, no teaser,
// no "coming soon."
//
// Layered strictly:
//   /opd            server-side gate, hands off to OpdShell client.
//   /opd OpdShell   client, holds tab state and renders four tabs;
//                   only Library resolves. Inert tabs display the
//                   correct product shape without a fake screen.
//   /opd LibraryRoom  client, fetches /api/academy/library on mount.
//
// Zero writes. Zero PII on the wire (see /api/academy/library).

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  ACADEMY_PREVIEW_ONLY,
  ACADEMY_PREVIEW_ALLOWLIST,
} from "@/lib/academy/resolveIdentity";
import OpdShell from "./OpdShell";
import "./opd.css";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "OPD - KitchFix",
  description: "Operational Playbook + Academy",
};

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

export default async function OpdPage() {
  // TEST_MODE bypass mirrors src/middleware.js so Playwright + local
  // dev batteries can drive the shell without an OAuth login step.
  // Double-gated: TEST_MODE=true AND VERCEL !== "1". Vercel always
  // sets VERCEL=1, so a stray env there still routes through the
  // real fence. When bypassed, we use the fence's own allowlist
  // member as the test identity so the resolver has a real email
  // to work with.
  const testModeBypass =
    process.env.TEST_MODE === "true" && process.env.VERCEL !== "1";
  const session = await auth();
  const email = testModeBypass
    ? (ACADEMY_PREVIEW_ALLOWLIST[0] || "test@example.invalid")
    : normEmail(session?.user?.email);
  // No session or fenced-out: behave as if the route does not exist.
  // notFound() renders the standard 404 chrome; the fence-out case is
  // indistinguishable from an unknown path, which is the point.
  if (!email) notFound();
  if (!testModeBypass && ACADEMY_PREVIEW_ONLY && !ACADEMY_PREVIEW_ALLOWLIST.includes(email)) {
    notFound();
  }
  return <OpdShell viewerEmail={email} />;
}

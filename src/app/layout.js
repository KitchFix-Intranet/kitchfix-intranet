import "./tokens.css";
import "./globals.css";
import Providers from "./providers";
import TopNav from "@/components/TopNav";
import { auth } from "@/lib/auth";
import { canViewSousReports, canUseSous } from "@/lib/opdAcl";
export const metadata = {
  title: "KitchFix Intranet",
  description: "Command Center for KitchFix Operations",
};

// The layout is server-side, so we can resolve session-derived permissions
// here and pass them to the client TopNav as props. This is the ONLY place
// canViewSousReports() and canUseSous() run for nav-link visibility; TopNav
// itself never inspects the session for gating - it renders whatever the
// server resolved. Same helpers gate the /sousai/reports page and the /sous
// page + /api/sousai (single source of truth per src/lib/opdAcl.js).
//
// canUseSous is async because non-SLT users require a PG lookup on the
// contacts table. It short-circuits synchronously for SLT viewers so the
// six-person SLT team pays zero DB round trips per render; a non-SLT
// authenticated user pays one ilike-with-LIMIT-1 lookup (single-index,
// milliseconds in Supabase). The layout was already awaiting auth() on
// every render - that decrypt is materially heavier than this lookup, so
// the added cost is small compared to the ambient render cost.
export default async function RootLayout({ children }) {
  const session = await auth();
  const email = session?.user?.email;
  const sousReportsAllowed = canViewSousReports(email);
  const sousAllowed = await canUseSous(email);
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <TopNav canViewSousReports={sousReportsAllowed} canUseSous={sousAllowed} />
          {children}
        </Providers>
      </body>
    </html>
  );
}
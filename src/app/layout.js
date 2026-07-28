import "./tokens.css";
import "./globals.css";
import Providers from "./providers";
import TopNav from "@/components/TopNav";
import { auth } from "@/lib/auth";
import { canViewSousReports } from "@/lib/opdAcl";
export const metadata = {
  title: "KitchFix Intranet",
  description: "Command Center for KitchFix Operations",
};

// The layout is server-side, so we can resolve session-derived permissions
// here and pass them to the client TopNav as props. This is the ONLY place
// canViewSousReports() runs for the nav-link visibility; TopNav itself
// never inspects the session for gating - it renders whatever the server
// resolved. Same helper gates the /sousai/reports page (single source of
// truth per src/lib/opdAcl.js).
export default async function RootLayout({ children }) {
  const session = await auth();
  const sousReportsAllowed = canViewSousReports(session?.user?.email);
  return (
    <html lang="en">
      <body className="font-mulish antialiased">
        <Providers>
          <TopNav canViewSousReports={sousReportsAllowed} />
          {children}
        </Providers>
      </body>
    </html>
  );
}
import "./tokens.css";
import "./globals.css";
import Providers from "./providers";
import TopNav from "@/components/TopNav";
import HelpFAB from "@/components/HelpFAB";
export const metadata = {
  title: "KitchFix Intranet",
  description: "Command Center for KitchFix Operations",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-mulish antialiased">
        <Providers>
          <TopNav />
          {children}
          <HelpFAB />
        </Providers>
      </body>
    </html>
  );
}
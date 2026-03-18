import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "KitchFix Intranet",
  description: "Command Center for KitchFix Operations",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="font-mulish antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
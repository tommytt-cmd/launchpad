import "./globals.css";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { Footer } from "@/components/Footer";

export const metadata = { title: "Launchpad" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

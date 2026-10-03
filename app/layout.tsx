import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "4CS Admin", template: "%s · 4CS Admin" },
  // Private tool. next.config.ts also sends X-Robots-Tag on every response.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = { themeColor: "#141414" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}

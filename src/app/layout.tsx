import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Mukta, Poppins } from "next/font/google";
import "./globals.css";

// Poppins for headings and Mukta for text: the pairing most Nepali apps and
// news sites use. Mukta was drawn for Devanagari and Latin together.
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
const mukta = Mukta({ variable: "--font-mukta", subsets: ["latin"], weight: ["400", "500", "600", "700"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "AgentGuard", template: "%s · AgentGuard" },
  description: "The control layer for AI agents: see, control and approve what every agent does.",
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${poppins.variable} ${mukta.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

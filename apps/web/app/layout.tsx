import "./globals.css";
import "@/lib/zod-error-map";
import { AppProviders } from "./providers";
import React from "react";
import { Inter } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { WebVitalsReporter } from "./WebVitalsReporter";
import { CookieConsentBanner } from "@/components/legal/CookieConsentBanner";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "Alusa",
    template: "%s | Alusa",
  },
  description: "Gestão escolar, matrículas, cobranças e financeiro em uma operação integrada.",
  manifest: "/site.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Alusa",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} min-h-full bg-white`}
      suppressHydrationWarning
    >
      <head />
      <body className="bg-white text-gray-900 antialiased">
        <AppProviders>
          {children}
        </AppProviders>
        <CookieConsentBanner />
        <WebVitalsReporter />
      </body>
    </html>
  );
}

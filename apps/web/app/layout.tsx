import "./globals.css";
import "@/lib/zod-error-map";
import { AppProviders } from "./providers";
import React from "react";
import { Inter } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { WebVitalsReporter } from "./WebVitalsReporter";
import { CookieConsentBanner } from "@/components/legal/CookieConsentBanner";
import {
  AUTH_LIGHT_THEME_PATH_PREFIXES,
  AUTH_LIGHT_THEME_ROOT_PATHS,
} from "@/lib/auth-light-theme-paths";

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
  const themeInitPrefixes = JSON.stringify([...AUTH_LIGHT_THEME_PATH_PREFIXES]);
  const themeInitRoots = JSON.stringify([...AUTH_LIGHT_THEME_ROOT_PATHS]);
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} min-h-full bg-white`}
      suppressHydrationWarning
    >
      <head />
      <body className="bg-white text-gray-900 antialiased">
        {/* Scripts globais ficam no body para o App Router tratar o conteúdo inline sem o interpretar como HTML bruto. */}
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: `(function(){try{var d=document.documentElement;var path=typeof location!=="undefined"?location.pathname||"":"";var prefixes=${themeInitPrefixes};var roots=${themeInitRoots};function forceLight(p){for(var i=0;i<prefixes.length;i++){var pr=prefixes[i];if(p===pr||p.indexOf(pr+"/")===0)return true;}for(var j=0;j<roots.length;j++){var r=roots[j];if(p===r||p.indexOf(r+"/")===0)return true;}return false;}if(forceLight(path)){d.setAttribute("data-theme","light");return;}if(d.hasAttribute("data-theme"))return;var t=null;try{t=localStorage.getItem("alusa.theme");}catch(e){}if(!t){try{var m=document.cookie.match(/(?:^|; )alusa[.]theme=(light|dark)(?:;|$)/);if(m)t=m[1];}catch(e){}}if(!t){t=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light";}d.setAttribute("data-theme",t);}catch(e){}})();` }} />
        <AppProviders>
          {children}
        </AppProviders>
        <CookieConsentBanner />
        <WebVitalsReporter />
      </body>
    </html>
  );
}

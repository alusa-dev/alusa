import "./globals.css";
import "@/lib/zod-error-map";
import { AppProviders } from "./providers";
import React from "react";
import Script from "next/script";
import { cookies } from "next/headers";
import type { Metadata, Viewport } from "next";
import { WebVitalsReporter } from "./WebVitalsReporter";

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
  const cookieStore = cookies();
  const themeCookie = (cookieStore.get('alusa.theme')?.value as 'light' | 'dark' | undefined) ?? undefined;
  return (
    <html lang="pt-BR" className="min-h-full bg-white" data-theme={themeCookie}>
      <head>
        {/* Renderiza já com o tema certo quando houver cookie (zero flash ao recarregar) */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var d=document.documentElement;if(d.hasAttribute('data-theme'))return;var t=localStorage.getItem('alusa.theme');if(!t){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}d.setAttribute('data-theme',t);}catch(e){}})();`}
        </Script>
        {/* Após interatividade, habilita transições já com o tema aplicado */}
        <Script id="theme-ready" strategy="afterInteractive">
          {`(function(){try{document.documentElement.classList.add('theme-ready');document.body.classList.add('theme-ready');}catch(e){}})();`}
        </Script>
      </head>
      <body className="bg-white text-gray-900 antialiased">
        <AppProviders>
          {children}
        </AppProviders>
        <WebVitalsReporter />
      </body>
    </html>
  );
}

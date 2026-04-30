import "./globals.css";
import "@/lib/zod-error-map";
import { AppProviders } from "./providers";
import React from "react";
import Script from "next/script";
import { cookies } from "next/headers";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const themeCookie = (cookieStore.get('alusa.theme')?.value as 'light' | 'dark' | undefined) ?? undefined;
  return (
    <html lang="pt-BR" className="h-full" data-theme={themeCookie}>
      <head>
        <meta name="color-scheme" content="dark light" />
        {/* Renderiza já com o tema certo quando houver cookie (zero flash ao recarregar) */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`(function(){try{var d=document.documentElement;if(d.hasAttribute('data-theme'))return;var t=localStorage.getItem('alusa.theme');if(!t){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';}d.setAttribute('data-theme',t);}catch(e){}})();`}
        </Script>
        {/* Após interatividade, habilita transições já com o tema aplicado */}
        <Script id="theme-ready" strategy="afterInteractive">
          {`(function(){try{document.documentElement.classList.add('theme-ready');document.body.classList.add('theme-ready');}catch(e){}})();`}
        </Script>
      </head>
      <body className="min-h-screen text-gray-900 antialiased app-surface-bg">
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}

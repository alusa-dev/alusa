'use client';

import Link from 'next/link';
import { SiteSectionLink } from '@/features/site/components/navigation/SiteSectionLink';
import { footerGroups } from '@/features/site/content/navigation';
import { Logo } from '@/features/site/components/ui/Logo';
import { isSiteSectionNavItem, siteNavItemKey } from '@/features/site/lib/nav-items';
import type { SiteNavItem } from '@/features/site/lib/site-dtos';
import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';
import { AsaasSeal } from '@/components/shared/AsaasSeal';

function FooterLink({ link }: { link: SiteNavItem }) {
  if (isSiteSectionNavItem(link)) {
    return (
      <SiteSectionLink
        sectionId={link.sectionId}
        analyticsLabel={link.label}
        className="text-sm font-medium text-white/68 transition-colors hover:text-white"
      >
        {link.label}
      </SiteSectionLink>
    );
  }

  return (
    <Link href={link.href} className="text-sm font-medium text-white/68 transition-colors hover:text-white">
      {link.label}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-[#5c2f91]/40 bg-[#140528] text-white">
      <VerticalGridLines tone="dark" />
      <div className="relative z-10 mx-auto grid max-w-7xl gap-12 px-6 py-16 sm:px-8 lg:grid-cols-[1.15fr_2fr] lg:gap-16 lg:py-20">
        <div>
          <div className="flex items-center gap-3 font-display text-xl font-bold tracking-tight">
            <Logo className="h-8 w-auto text-white" />
          </div>
        </div>
        <div className="grid gap-10 sm:grid-cols-4">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-purple-300">{group.title}</h2>
              <ul className="mt-6 space-y-3.5">
                {group.links.map((link) => (
                  <li key={`${group.title}-${link.label}-${siteNavItemKey(link)}`}>
                    <FooterLink link={link} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="relative z-10 border-t border-white/10 py-8">
        <div className="mx-auto max-w-7xl px-6 sm:px-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-4 max-w-3xl">
              <p className="text-xs leading-relaxed text-white/55">
                © Copyright {new Date().getFullYear()} Alusa Tecnologia da Informação Ltda.
                <br />
                CNPJ: 00.000.000/0001-91 | Todos os direitos reservados.
              </p>
              <p className="text-[11px] leading-relaxed text-white/45">
                Av. Paulista, 1000, Bela Vista - São Paulo - SP, 01310-100.
                <br />
                Caixa Postal: 1234 - CEP: 01310-900
              </p>
              
              {/* Redes Sociais */}
              <div className="flex items-center gap-3 mt-1">
                <a href="#" className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#140528] hover:bg-white/80 transition-colors" aria-label="Facebook">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22 12c0-5.52-4.48-10-10-10S2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c4.56-.93 8-4.96 8-9.75z" />
                  </svg>
                </a>
                <a href="#" className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#140528] hover:bg-white/80 transition-colors" aria-label="Instagram">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                  </svg>
                </a>
                <a href="#" className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#140528] hover:bg-white/80 transition-colors" aria-label="YouTube">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.108C19.52 3.5 12 3.5 12 3.5s-7.52 0-9.388.555A3.002 3.002 0 0 0 .502 6.163C0 8.07 0 12 0 12s0 3.93.502 5.837a3.003 3.003 0 0 0 2.11 2.108C4.48 20.5 12 20.5 12 20.5s7.52 0 9.388-.555a3.002 3.002 0 0 0 2.11-2.108C24 15.93 24 12 24 12s0-3.93-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                </a>
                <a href="#" className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#140528] hover:bg-white/80 transition-colors" aria-label="LinkedIn">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
                  </svg>
                </a>
                <a href="#" className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#140528] hover:bg-white/80 transition-colors" aria-label="TikTok">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.06-2.89-.52-4.06-1.4-1.01-.76-1.74-1.88-2.03-3.12-.03 2.53.01 5.06-.02 7.59-.06 2.05-.72 4.14-2.14 5.62-1.57 1.67-3.95 2.53-6.19 2.29-2.61-.26-5.07-2.1-5.74-4.71-.85-3.25.75-7.02 3.86-8.19 1.25-.49 2.65-.58 3.94-.28.01 1.43-.01 2.87 0 4.3-.88-.34-1.9-.31-2.73.23-.97.6-1.44 1.83-1.15 2.92.3 1.16 1.49 1.95 2.68 1.82 1.34-.11 2.45-1.28 2.47-2.63.02-3.83-.01-7.66.01-11.49-.01-.32-.01-.65-.01-.97z" />
                  </svg>
                </a>
              </div>
            </div>
            
            <div className="flex items-center shrink-0">
              <AsaasSeal variant="negativo-branco" className="opacity-80 hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

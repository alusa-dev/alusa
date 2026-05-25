'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from '@/features/site/components/icons/icons';
import { appLoginUrl, primaryNavigation } from '@/features/site/content/navigation';
import { trackSiteEvent } from '@/features/site/lib/analytics';
import { ButtonLink } from '@/features/site/components/ui/ButtonLink';
import { Logo } from '@/features/site/components/ui/Logo';
import { cn } from '@/features/site/lib/cn';

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#430D88]">
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between gap-6 px-6 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 font-display text-xl font-bold tracking-tight text-white hover:opacity-90 transition-opacity"
          aria-label="Alusa"
        >
          <Logo className="h-7 w-auto text-white" />
        </Link>

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Principal">
          {primaryNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => trackSiteEvent('nav_item_clicked', { href: item.href, label: item.label })}
              className="text-sm font-medium text-white transition-opacity hover:opacity-70"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <ButtonLink href={appLoginUrl} variant="ghost" tone="dark" className="h-10 px-4 text-white">
            Entrar
          </ButtonLink>
          <ButtonLink
            href="mailto:contato@alusa.app"
            variant="primary"
            tone="dark"
            event="sales_cta_clicked"
            className="h-10 bg-white text-[#430D88] shadow-sm"
          >
            Fale com vendas
          </ButtonLink>
        </div>

        <button
          type="button"
          className="grid h-10 w-10 place-items-center rounded-lg border border-white/20 text-white lg:hidden"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      <div className={cn('border-t border-white/10 bg-[#430D88] lg:hidden', open ? 'block' : 'hidden')}>
        <nav className="mx-auto grid max-w-7xl gap-1 px-6 py-4" aria-label="Principal mobile">
          {primaryNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                setOpen(false);
                trackSiteEvent('nav_item_clicked', { href: item.href, label: item.label });
              }}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-white/70 hover:bg-white/10 hover:text-white"
            >
              {item.label}
            </Link>
          ))}
          <div className="grid gap-2 pt-3 sm:grid-cols-2">
            <ButtonLink href={appLoginUrl} variant="secondary" tone="dark">
              Entrar
            </ButtonLink>
            <ButtonLink href="mailto:contato@alusa.app" variant="primary" tone="dark" event="sales_cta_clicked">
              Fale com vendas
            </ButtonLink>
          </div>
        </nav>
      </div>
    </header>
  );
}

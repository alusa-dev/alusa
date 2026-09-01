'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from '@/features/site/components/icons/icons';
import { SiteSectionLink } from '@/features/site/components/navigation/SiteSectionLink';
import { appLoginUrl, primaryNavigation } from '@/features/site/content/navigation';
import { isSiteSectionNavItem, siteNavItemKey } from '@/features/site/lib/nav-items';
import { scrollToSiteTop } from '@/features/site/lib/scroll-to-section';
import { ButtonLink } from '@/features/site/components/ui/ButtonLink';
import { Logo } from '@/features/site/components/ui/Logo';
import { cn } from '@/features/site/lib/cn';

function PrimaryNavItem({
  item,
  className,
  onNavigate,
}: {
  item: (typeof primaryNavigation)[number];
  className: string;
  onNavigate?: () => void;
}) {
  if (isSiteSectionNavItem(item)) {
    return (
      <SiteSectionLink
        sectionId={item.sectionId}
        analyticsLabel={item.label}
        className={className}
        onNavigate={onNavigate}
      >
        {item.label}
      </SiteSectionLink>
    );
  }

  const fallbackItem = item as any;
  return (
    <Link href={fallbackItem.href} onClick={onNavigate} className={className}>
      {fallbackItem.label}
    </Link>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [floatingVisible, setFloatingVisible] = useState(false);
  const originalHeaderRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    const originalHeader = originalHeaderRef.current;
    if (!originalHeader) return;

    const observer = new IntersectionObserver(([entry]) => {
      setFloatingVisible(!entry.isIntersecting);
    });

    observer.observe(originalHeader);
    return () => observer.disconnect();
  }, []);

  const isLegalPage =
    pathname === '/legal' ||
    [
      '/privacidade',
      '/termos',
      '/cookies',
      '/preferencias-de-cookies',
      '/seguranca',
      '/dpa',
      '/suboperadores',
      '/direitos-lgpd',
      '/direitos-lgpd/solicitar',
    ].includes(pathname || '');

  const headerContent = (
    <>
      <div className="site-site-header-inner">
        <Link
          href="/"
          onClick={(event) => {
            if (window.location.pathname === '/') {
              event.preventDefault();
              scrollToSiteTop();
            }
          }}
          className="site-site-logo flex items-center gap-3 font-display text-xl font-bold tracking-tight text-white hover:opacity-90 transition-opacity"
          aria-label="Alusa"
        >
          <Logo className="h-7 w-auto text-white" />
        </Link>

        {!isLegalPage && (
            <nav className="site-site-nav hidden items-center gap-8 lg:flex" aria-label="Principal">
            {primaryNavigation.map((item) => (
              <PrimaryNavItem
                key={`${item.label}-${siteNavItemKey(item)}`}
                item={item}
                className="site-nav-link text-sm font-medium text-white transition-opacity hover:opacity-70"
              />
            ))}
          </nav>
        )}

        {!isLegalPage && (
          <div className="site-site-actions hidden items-center gap-2 lg:flex">
            <ButtonLink href={appLoginUrl} variant="ghost" tone="dark" showArrow={false} className="site-header-login text-white">
              Entrar
            </ButtonLink>
            <ButtonLink
              href="/register"
              variant="primary"
              tone="dark"
              event="hero_cta_clicked"
              showArrow={false}
              className="site-header-signup bg-white text-[var(--alusa-purple-dark)] shadow-sm"
            >
              Teste grátis por 14 dias
            </ButtonLink>
          </div>
        )}

        {!isLegalPage && (
          <button
            type="button"
            className="site-menu-button grid h-10 w-10 place-items-center rounded-lg border border-white/20 text-white lg:hidden"
            aria-label={open ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        )}
      </div>

      {!isLegalPage && (
        <div className={cn('border-t border-white/10 bg-[var(--alusa-purple-dark)] lg:hidden', open ? 'block' : 'hidden')}>
          <nav className="mx-auto grid max-w-7xl gap-1 px-6 py-4" aria-label="Principal mobile">
            {primaryNavigation.map((item) => (
              <PrimaryNavItem
                key={`mobile-${item.label}-${siteNavItemKey(item)}`}
                item={item}
                onNavigate={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-left text-base font-medium text-white/70 hover:bg-white/10 hover:text-white"
              />
            ))}
            <div className="grid gap-2 pt-3 sm:grid-cols-2">
              <ButtonLink href={appLoginUrl} variant="secondary" tone="dark">
                Entrar
              </ButtonLink>
              <ButtonLink href="/register" variant="primary" tone="dark" event="hero_cta_clicked">
                Criar conta grátis
              </ButtonLink>
            </div>
          </nav>
        </div>
      )}
    </>
  );

  return (
    <>
      <header ref={originalHeaderRef} className="site-site-header site-original-header">
        {headerContent}
      </header>
      <header
        aria-hidden={!floatingVisible}
        className={cn(
          'site-site-header site-floating-header',
          floatingVisible && 'site-floating-header--visible',
        )}
      >
        {headerContent}
      </header>
    </>
  );
}

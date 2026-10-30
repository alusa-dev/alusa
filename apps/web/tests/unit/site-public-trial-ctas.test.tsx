import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SiteLanding } from '@/features/site/components/SiteLanding';
import { SiteHeader } from '@/features/site/components/layout/SiteHeader';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/feature-flags/external-asaas-onboarding', () => ({
  isExternalAsaasOnboardingRolloutEnabled: () => true,
}));

vi.mock('@/features/site/components/ModalityCarousel', () => ({
  ModalityCarousel: () => null,
}));

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];

  constructor(private readonly _callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    this._callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
  }

  disconnect() {}
  unobserve() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
});

afterEach(cleanup);

describe('public trial CTAs', () => {
  it('routes the home hero trial CTA to public pricing', () => {
    render(<SiteLanding />);

    expect(screen.getByRole('link', { name: 'Teste grátis por 14 dias' })).toHaveAttribute(
      'href',
      '/precos',
    );
  });

  it('routes desktop and mobile header trial CTAs to public pricing', () => {
    const { container } = render(<SiteHeader />);

    const desktopCtas = container.querySelectorAll('.site-site-actions .site-header-signup');
    expect(desktopCtas).toHaveLength(2); // Original and floating headers.
    desktopCtas.forEach((cta) => expect(cta).toHaveAttribute('href', '/precos'));

    fireEvent.click(screen.getAllByRole('button', { name: 'Abrir menu' })[0]);
    const mobileNav = screen.getByRole('navigation', { name: 'Principal mobile' });
    expect(within(mobileNav).getByRole('link', { name: 'Teste grátis por 14 dias' })).toHaveAttribute(
      'href',
      '/precos',
    );
  });
});

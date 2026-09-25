import type { ReactNode } from 'react';
import { inter } from '@/app/fonts';
import { SiteFooter } from '@/features/site/components/layout/SiteFooter';
import { SiteHeader } from '@/features/site/components/layout/SiteHeader';
import { SiteScrollRestoration } from '@/features/site/components/layout/SiteScrollRestoration';

type SiteShellProps = {
  readonly children: ReactNode;
};

export function SiteShell({ children }: SiteShellProps) {
  return (
    <div
      data-area="public"
      className={`${inter.variable} font-sans antialiased text-alusa-purple-deeper`}
    >
      <SiteScrollRestoration />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}

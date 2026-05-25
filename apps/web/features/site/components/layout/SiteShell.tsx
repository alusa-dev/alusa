import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SiteFooter } from '@/features/site/components/layout/SiteFooter';
import { SiteHeader } from '@/features/site/components/layout/SiteHeader';
import { SiteScrollRestoration } from '@/features/site/components/layout/SiteScrollRestoration';

const fontSans = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const fontDisplay = Inter({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['600', '700', '800'],
  display: 'swap',
});

type SiteShellProps = {
  readonly children: ReactNode;
};

export function SiteShell({ children }: SiteShellProps) {
  return (
    <div
      data-area="public"
      className={`${fontSans.variable} ${fontDisplay.variable} font-sans antialiased text-alusa-purple-deeper`}
    >
      <SiteScrollRestoration />
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <Analytics />
    </div>
  );
}

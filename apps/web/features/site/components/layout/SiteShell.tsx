import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { SiteFooter } from '@/features/site/components/layout/SiteFooter';
import { SiteHeader } from '@/features/site/components/layout/SiteHeader';

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
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
      <Analytics />
      <SpeedInsights />
    </div>
  );
}

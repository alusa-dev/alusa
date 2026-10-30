import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { inter } from '@/app/fonts';
import { SiteFooter } from '@/features/site/components/layout/SiteFooter';
import { SiteHeader } from '@/features/site/components/layout/SiteHeader';
import { SiteScrollRestoration } from '@/features/site/components/layout/SiteScrollRestoration';
import { isExternalAsaasOnboardingRolloutEnabled } from '@/lib/feature-flags/external-asaas-onboarding';

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
      <Suspense fallback={null}><SiteHeader selfServiceEnabled={isExternalAsaasOnboardingRolloutEnabled()} /></Suspense>
      <main>{children}</main>
      <Suspense fallback={null}><SiteFooter /></Suspense>
    </div>
  );
}

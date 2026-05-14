'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { AsaasSeal } from '@/components/shared/AsaasSeal';

export default function OnboardingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFinanceWizard = pathname === '/finance/wizard';
  const cardClassName =
    'mx-auto w-full max-w-4xl rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 outline-none focus-visible:outline-none focus-within:ring-1 focus-within:ring-black/5 sm:p-8';

  if (isFinanceWizard) {
    return (
      <>
        {children}
        <div className="flex justify-center pt-4 pb-2">
          <AsaasSeal variant="positivo" />
        </div>
      </>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full items-center px-4 py-10 sm:py-12">
      <div className={`${cardClassName} space-y-8`}>
        {children}
      </div>
    </main>
  );
}

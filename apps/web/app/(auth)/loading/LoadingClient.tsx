'use client';

import React, { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import AuthShell from '@/components/auth/AuthShell';
import { nextParamToRedirect } from '@/lib/safe-redirect';

export default function LoadingClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rawCb = sp.get('callbackUrl') || sp.get('next');
  const callbackUrl = nextParamToRedirect(rawCb);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      router.replace(callbackUrl);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [callbackUrl, router]);

  return (
    <AuthShell>
      <div
        className="flex w-full max-w-[min(100%,21.5rem)] min-[400px]:max-w-[min(100%,24rem)] flex-col items-center justify-center gap-4 py-10 text-center min-[400px]:gap-5 min-[400px]:py-12 lg:max-w-[320px] lg:gap-4 lg:py-12"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-10 w-10 min-[400px]:h-11 min-[400px]:w-11 animate-spin rounded-full border-[3px] border-[#3e1f63]/20 border-t-[#3e1f63] lg:h-10 lg:w-10"
        />
        <p className="text-[0.9375rem] font-medium text-brand-muted min-[400px]:text-base lg:text-sm">Carregando...</p>
      </div>
    </AuthShell>
  );
}
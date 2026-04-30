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
        className="flex w-full max-w-[320px] flex-col items-center justify-center gap-4 py-12 text-center"
        role="status"
        aria-live="polite"
      >
        <span
          aria-hidden="true"
          className="inline-flex h-10 w-10 animate-spin rounded-full border-[3px] border-[#3e1f63]/20 border-t-[#3e1f63]"
        />
        <p className="text-sm font-medium text-brand-muted">Carregando...</p>
      </div>
    </AuthShell>
  );
}
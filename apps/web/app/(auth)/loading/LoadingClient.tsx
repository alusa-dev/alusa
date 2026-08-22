'use client';

import React, { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AlusaLogoLoader } from '@/components/feedback/AlusaLogoLoader';
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

  return React.createElement(AlusaLogoLoader, { fullScreen: true });
}

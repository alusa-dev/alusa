'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type RevealState = 'visible' | 'pending';

export function PricingReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [state, setState] = useState<RevealState>('visible');
  const reveal = useCallback(() => {
    setState('visible');
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

    if (!element || motionPreference.matches || !('IntersectionObserver' in window)) {
      setState('visible');
      return;
    }

    setState('pending');
    const onMotionPreferenceChange = () => {
      if (motionPreference.matches) reveal();
    };

    motionPreference.addEventListener('change', onMotionPreferenceChange);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) reveal();
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    observerRef.current = observer;
    observer.observe(element);

    return () => {
      observer?.disconnect();
      observerRef.current = null;
      motionPreference.removeEventListener('change', onMotionPreferenceChange);
    };
  }, [reveal]);

  return (
    <div ref={ref} data-pricing-reveal={state} onFocusCapture={reveal}>
      {children}
    </div>
  );
}

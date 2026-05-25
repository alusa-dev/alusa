'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { scheduleReveal, SITE_REVEAL_EVENT } from '@/features/site/lib/motion';

type UseSiteRevealOptions = {
  onMount?: boolean;
};

export function useSiteReveal({ onMount = false }: UseSiteRevealOptions = {}) {
  const ref = useRef<HTMLDivElement>(null);
  // onMount: começa oculto no SSR/hidratação para a entrada ser visível ao abrir/recarregar.
  const [armed, setArmed] = useState(onMount);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const reveal = useCallback(() => {
    scheduleReveal(() => {
      setVisible(true);
    }, onMount ? 3 : 2);
  }, [onMount]);

  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');

    const syncMotionPreference = () => {
      const shouldReduce = media.matches;
      setReduceMotion(shouldReduce);
      if (shouldReduce) {
        setArmed(true);
        setVisible(true);
      }
    };

    syncMotionPreference();
    media.addEventListener('change', syncMotionPreference);

    if (media.matches) {
      return () => media.removeEventListener('change', syncMotionPreference);
    }

    if (!onMount) {
      setArmed(true);
    }

    const element = ref.current;
    if (!element) {
      return () => media.removeEventListener('change', syncMotionPreference);
    }

    const onForceReveal = () => {
      reveal();
    };

    element.addEventListener(SITE_REVEAL_EVENT, onForceReveal);

    if (onMount) {
      reveal();
      return () => {
        element.removeEventListener(SITE_REVEAL_EVENT, onForceReveal);
        media.removeEventListener('change', syncMotionPreference);
      };
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          reveal();
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      element.removeEventListener(SITE_REVEAL_EVENT, onForceReveal);
      media.removeEventListener('change', syncMotionPreference);
    };
  }, [onMount, reveal]);

  const hidden = armed && !visible && !reduceMotion;

  return {
    ref,
    hidden,
    reduceMotion,
  };
}

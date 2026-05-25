'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/features/site/lib/cn';

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Anima ao montar (ex.: hero), sem esperar scroll. */
  onMount?: boolean;
};

function scheduleReveal(onReveal: () => void): () => void {
  let outer = 0;
  let inner = 0;

  outer = window.requestAnimationFrame(() => {
    inner = window.requestAnimationFrame(onReveal);
  });

  return () => {
    window.cancelAnimationFrame(outer);
    window.cancelAnimationFrame(inner);
  };
}

export function ScrollReveal({ children, className, delay = 0, onMount = false }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMotionPreference = () => {
      setReduceMotion(media.matches);
      if (media.matches) {
        setVisible(true);
      }
    };

    handleMotionPreference();
    media.addEventListener('change', handleMotionPreference);

    if (media.matches) {
      return () => media.removeEventListener('change', handleMotionPreference);
    }

    if (onMount) {
      const cancel = scheduleReveal(() => setVisible(true));
      return () => {
        cancel();
        media.removeEventListener('change', handleMotionPreference);
      };
    }

    const element = ref.current;
    if (!element) {
      return () => media.removeEventListener('change', handleMotionPreference);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -4% 0px' },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', handleMotionPreference);
    };
  }, [onMount]);

  return (
    <div
      ref={ref}
      className={cn(
        !reduceMotion && 'transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity]',
        visible || reduceMotion ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        className,
      )}
      style={reduceMotion ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

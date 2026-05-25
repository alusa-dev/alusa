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

export function ScrollReveal({ children, className, delay = 0, onMount = false }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(media.matches);

    if (media.matches) {
      setVisible(true);
      return;
    }

    if (onMount) {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [onMount]);

  return (
    <div
      ref={ref}
      className={cn(
        !reduceMotion && 'transition-[transform,opacity] duration-700 ease-out will-change-[transform,opacity]',
        visible || reduceMotion ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0',
        className
      )}
      style={reduceMotion ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

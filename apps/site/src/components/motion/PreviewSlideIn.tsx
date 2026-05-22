'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

type PreviewSlideInProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

/** Entrada suave deslizando da direita para a esquerda (previews visuais). */
export function PreviewSlideIn({ children, className, delay = 140 }: PreviewSlideInProps) {
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

    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -4% 0px' }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        !reduceMotion && 'transition-[transform,opacity] duration-[850ms] ease-out will-change-[transform,opacity]',
        visible || reduceMotion ? 'translate-x-0 opacity-100' : 'translate-x-10 opacity-0',
        className
      )}
      style={reduceMotion ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

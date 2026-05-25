'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/features/site/lib/cn';

type PreviewSlideInProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
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

/** Entrada suave deslizando da direita para a esquerda (previews visuais). */
export function PreviewSlideIn({ children, className, delay = 140 }: PreviewSlideInProps) {
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

    const element = ref.current;
    if (!element) {
      return () => media.removeEventListener('change', handleMotionPreference);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          scheduleReveal(() => setVisible(true));
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -2% 0px' },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', handleMotionPreference);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        !reduceMotion &&
          'transition-[transform,opacity] duration-[850ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity]',
        visible || reduceMotion ? 'translate-x-0 opacity-100' : 'translate-x-10 opacity-0',
        className,
      )}
      style={reduceMotion ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

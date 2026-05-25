'use client';

import type { ReactNode } from 'react';

import { useSiteReveal } from '@/features/site/hooks/useSiteReveal';
import { cn } from '@/features/site/lib/cn';

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  /** Anima ao montar (ex.: hero), sem esperar scroll. */
  onMount?: boolean;
};

export function ScrollReveal({ children, className, delay = 0, onMount = false }: ScrollRevealProps) {
  const { ref, hidden, reduceMotion } = useSiteReveal({ onMount });

  return (
    <div
      ref={ref}
      data-site-reveal
      className={cn(
        !reduceMotion &&
          'transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity]',
        hidden ? 'translate-y-8 opacity-0' : 'translate-y-0 opacity-100',
        className,
      )}
      style={reduceMotion ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';

import { useSiteReveal } from '@/features/site/hooks/useSiteReveal';
import { cn } from '@/features/site/lib/cn';

type PreviewSlideInProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

/** Entrada suave deslizando da direita para a esquerda (previews visuais). */
export function PreviewSlideIn({ children, className, delay = 140 }: PreviewSlideInProps) {
  const { ref, hidden, reduceMotion } = useSiteReveal();

  return (
    <div
      ref={ref}
      data-site-reveal
      className={cn(
        !reduceMotion &&
          'transition-[transform,opacity] duration-[850ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity]',
        hidden ? 'translate-x-10 opacity-0' : 'translate-x-0 opacity-100',
        className,
      )}
      style={reduceMotion ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

'use client';

import type { ReactNode } from 'react';

import { useSiteReveal } from '@/features/site/hooks/useSiteReveal';
import { cn } from '@/features/site/lib/cn';
import { SITE_REVEAL_PRESETS, type SiteRevealVariant } from '@/features/site/lib/motion';

type SiteRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: SiteRevealVariant;
  /** Anima ao montar (ex.: hero), sem esperar scroll. */
  onMount?: boolean;
};

export function SiteReveal({
  children,
  className,
  delay = 0,
  variant = 'fade-up',
  onMount = false,
}: SiteRevealProps) {
  const preset = SITE_REVEAL_PRESETS[variant];
  const { ref, hidden, reduceMotion } = useSiteReveal({ onMount });

  return (
    <div
      ref={ref}
      data-site-reveal
      className={cn(
        !reduceMotion && preset.transition,
        hidden ? preset.hidden : preset.visible,
        className,
      )}
      style={reduceMotion ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

'use client';

import type { ComponentProps } from 'react';

import { SiteReveal } from '@/features/site/components/motion/SiteReveal';

type ScrollRevealProps = Omit<ComponentProps<typeof SiteReveal>, 'variant'> & {
  /** Entrada suave do hero ao recarregar a página. */
  hero?: boolean;
};

export function ScrollReveal({ hero = false, ...props }: ScrollRevealProps) {
  return <SiteReveal variant={hero ? 'fade-up-hero' : 'fade-up'} {...props} />;
}

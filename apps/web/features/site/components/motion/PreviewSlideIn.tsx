'use client';

import type { ComponentProps } from 'react';

import { SiteReveal } from '@/features/site/components/motion/SiteReveal';

type PreviewSlideInProps = Omit<ComponentProps<typeof SiteReveal>, 'variant'>;

/** Entrada suave deslizando da direita para a esquerda (previews visuais). */
export function PreviewSlideIn(props: PreviewSlideInProps) {
  return <SiteReveal variant="slide-in-right" {...props} />;
}

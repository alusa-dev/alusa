import React from 'react';
import type { ImgHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

/** Proporção do wordmark exportado (1734.07 × 527.81). */
export const BRAND_WORDMARK_ASPECT = 1734.07 / 527.81;

export type BrandWordmarkVariant = 'purple' | 'white';

const WORDMARK_SRC: Record<BrandWordmarkVariant, string> = {
  purple: '/brand/logo-dark.svg',
  white: '/brand/logo-light.svg',
};

type BrandWordmarkProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'> & {
  variant?: BrandWordmarkVariant;
};

export function BrandWordmark({
  variant = 'purple',
  className,
  draggable = false,
  ...props
}: BrandWordmarkProps): React.ReactElement {
  return (
    <img
      src={WORDMARK_SRC[variant]}
      alt="Alusa"
      draggable={draggable}
      className={cn('w-auto max-w-full shrink-0 object-contain object-left select-none', className)}
      {...props}
    />
  );
}

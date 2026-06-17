'use client';

import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import { BrandWordmark } from '@/components/brand/BrandWordmark';

const MASK_STYLE: CSSProperties = {
  WebkitMaskImage: 'url(/brand/logo-sidebar-mask.svg)',
  maskImage: 'url(/brand/logo-sidebar-mask.svg)',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
};

export type SidebarLogoMarkProps = {
  isDark: boolean;
  /** Desktop sidebar (h-10) vs header/drawer compact (h-8). */
  size?: 'desktop' | 'compact';
  className?: string;
  /** Collapse animation (desktop sidebar only). */
  collapsed?: boolean;
  fetchPriority?: 'high' | 'low' | 'auto';
};

/**
 * Escuro: máscara sobre `logo-sidebar-mask.svg` + `var(--sidebar-active-bg)`.
 * Claro: wordmark roxo (`logo-dark.svg`).
 */
export function SidebarLogoMark({
  isDark: isDarkProp,
  size = 'desktop',
  className = '',
  collapsed = false,
  fetchPriority,
}: SidebarLogoMarkProps) {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);
  const isDark = isMounted ? isDarkProp : false;
  const heightClass = size === 'desktop' ? 'h-10' : 'h-8';
  const boxClass = size === 'desktop' ? 'h-10 w-[131px]' : 'h-8 w-[105px]';
  const motion: CSSProperties = {
    opacity: collapsed ? 0 : 1,
    transform: collapsed ? 'scale(0.98)' : 'scale(1)',
  };

  if (isDark) {
    return (
      <span
        aria-hidden
        className={`pointer-events-none block shrink-0 bg-[color:var(--sidebar-active-bg)] transition-all duration-300 ${boxClass} ${className}`}
        style={{ ...motion, ...MASK_STYLE }}
      />
    );
  }

  return (
    <BrandWordmark
      variant="purple"
      fetchPriority={fetchPriority}
      className={`pointer-events-none transition-all duration-300 ${heightClass} ${className}`}
      style={motion}
    />
  );
}

'use client';

import type { CSSProperties } from 'react';

const MASK_STYLE: CSSProperties = {
  WebkitMaskImage: 'url(/brand/logo-sidebar-dark.svg)',
  maskImage: 'url(/brand/logo-sidebar-dark.svg)',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
};

export type SidebarLogoMarkProps = {
  isDark: boolean;
  /** Desktop sidebar (132×40) vs header/drawer compact (108×32). */
  size?: 'desktop' | 'compact';
  className?: string;
  /** Collapse animation (desktop sidebar only). */
  collapsed?: boolean;
  fetchPriority?: 'high' | 'low' | 'auto';
};

/**
 * Escuro: máscara sobre `logo-sidebar-dark.svg` + `var(--sidebar-active-bg)`.
 * Claro: `alusa-logo-dark.svg` com fill inline `#3e1f63` (compatível com `<img>`).
 */
export function SidebarLogoMark({
  isDark,
  size = 'desktop',
  className = '',
  collapsed = false,
  fetchPriority,
}: SidebarLogoMarkProps) {
  const w = size === 'desktop' ? 132 : 108;
  const h = size === 'desktop' ? 40 : 32;
  const boxClass = size === 'desktop' ? 'h-10 w-[132px]' : 'h-8 w-[108px]';
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
    <img
      src="/brand/alusa-logo-dark.svg"
      alt="Alusa"
      width={w}
      height={h}
      fetchPriority={fetchPriority}
      className={`pointer-events-none block max-w-full shrink-0 object-contain object-center select-none transition-all duration-300 ${boxClass} ${className}`}
      style={motion}
      draggable={false}
    />
  );
}

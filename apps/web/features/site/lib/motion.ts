import type { SiteSectionId } from '@/features/site/lib/sections';

export const SITE_REVEAL_EVENT = 'alusa:site-reveal';

export type SiteRevealVariant = 'fade-up' | 'fade-up-hero' | 'slide-in-right';

export const SITE_REVEAL_PRESETS: Record<
  SiteRevealVariant,
  {
    hidden: string;
    visible: string;
    transition: string;
  }
> = {
  'fade-up': {
    hidden: 'translate-y-8 opacity-0',
    visible: 'translate-y-0 opacity-100',
    transition:
      'transition-[transform,opacity] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity]',
  },
  'fade-up-hero': {
    hidden: 'translate-y-5 opacity-0',
    visible: 'translate-y-0 opacity-100',
    transition:
      'transition-[transform,opacity] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[transform,opacity]',
  },
  'slide-in-right': {
    hidden: 'translate-x-10 opacity-0 sm:translate-x-14 lg:translate-x-20',
    visible: 'translate-x-0 opacity-100',
    transition:
      'transition-[transform,opacity] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[transform,opacity]',
  },
};

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Garante um frame pintado no estado inicial antes do reveal. */
export function scheduleReveal(onReveal: () => void, frames = 2): () => void {
  let cancelled = false;
  let frame = 0;
  let pending = onReveal;

  const tick = (remaining: number) => {
    if (cancelled) return;
    if (remaining <= 0) {
      pending();
      return;
    }
    frame = window.requestAnimationFrame(() => tick(remaining - 1));
  };

  frame = window.requestAnimationFrame(() => tick(frames - 1));

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
}

export function afterScrollEnd(callback: () => void): void {
  if (prefersReducedMotion()) {
    callback();
    return;
  }

  let settled = false;
  let fallbackId = 0;

  const finish = () => {
    if (settled) return;
    settled = true;
    window.removeEventListener('scrollend', finish);
    window.clearTimeout(fallbackId);
    callback();
  };

  window.addEventListener('scrollend', finish, { once: true });
  fallbackId = window.setTimeout(finish, 900);
}

export function revealSectionContent(sectionId: SiteSectionId): void {
  if (typeof document === 'undefined') return;

  const section = document.getElementById(sectionId);
  if (!section) return;

  section.querySelectorAll('[data-site-reveal]').forEach((node) => {
    node.dispatchEvent(new CustomEvent(SITE_REVEAL_EVENT, { bubbles: false }));
  });
}

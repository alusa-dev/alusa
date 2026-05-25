import type { SiteSectionId } from '@/features/site/lib/sections';

export const SITE_REVEAL_EVENT = 'alusa:site-reveal';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Garante um frame pintado no estado inicial antes do reveal. */
export function scheduleReveal(onReveal: () => void): () => void {
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

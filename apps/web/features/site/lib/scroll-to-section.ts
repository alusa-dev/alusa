import { isSiteSectionId, type SiteSectionId } from '@/features/site/lib/sections';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function cleanSiteUrlPath(): void {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname || '/';
  if (window.location.hash) {
    history.replaceState(null, '', path);
  }
}

export function scrollToSiteSection(sectionId: SiteSectionId): boolean {
  if (typeof window === 'undefined') return false;

  const target = document.getElementById(sectionId);
  if (!target) return false;

  target.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  });

  cleanSiteUrlPath();
  return true;
}

export function scrollToSiteTop(): void {
  if (typeof window === 'undefined') return;

  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });

  cleanSiteUrlPath();
}

/** Links legados (#modulos) abrem a seção e limpam a barra de endereço. */
export function resolveLegacySiteHash(): void {
  if (typeof window === 'undefined') return;

  const raw = window.location.hash.replace(/^#/, '');
  if (!raw || !isSiteSectionId(raw)) return;

  window.requestAnimationFrame(() => {
    scrollToSiteSection(raw);
  });
}

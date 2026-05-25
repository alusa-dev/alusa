export const SITE_SECTION_IDS = ['modulos', 'financeiro', 'contato'] as const;

export type SiteSectionId = (typeof SITE_SECTION_IDS)[number];

/** Compensa header sticky ao rolar até uma seção. */
export const SITE_SECTION_SCROLL_MARGIN_CLASS = 'scroll-mt-[4.5rem]';

export function isSiteSectionId(value: string): value is SiteSectionId {
  return (SITE_SECTION_IDS as readonly string[]).includes(value);
}

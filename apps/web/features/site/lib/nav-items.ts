import type { SiteNavItem } from '@/features/site/lib/site-dtos';

export function isSiteSectionNavItem(item: SiteNavItem): item is Extract<SiteNavItem, { sectionId: string }> {
  return 'sectionId' in item;
}

export function siteNavItemKey(item: SiteNavItem): string {
  return isSiteSectionNavItem(item) ? item.sectionId : item.href;
}

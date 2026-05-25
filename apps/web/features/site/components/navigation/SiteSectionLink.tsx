'use client';

import type { ReactNode } from 'react';

import { trackSiteEvent } from '@/features/site/lib/analytics';
import { scrollToSiteSection } from '@/features/site/lib/scroll-to-section';
import type { SiteSectionId } from '@/features/site/lib/sections';
import { cn } from '@/features/site/lib/cn';

type SiteSectionLinkProps = {
  readonly sectionId: SiteSectionId;
  readonly children: ReactNode;
  readonly className?: string;
  readonly analyticsLabel?: string;
  readonly onNavigate?: () => void;
};

export function SiteSectionLink({
  sectionId,
  children,
  className,
  analyticsLabel,
  onNavigate,
}: SiteSectionLinkProps) {
  return (
    <button
      type="button"
      onClick={() => {
        scrollToSiteSection(sectionId);
        trackSiteEvent('nav_item_clicked', {
          href: sectionId,
          label: analyticsLabel ?? sectionId,
        });
        onNavigate?.();
      }}
      className={cn(className)}
    >
      {children}
    </button>
  );
}

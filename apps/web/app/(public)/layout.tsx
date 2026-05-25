import type { ReactNode } from 'react';
import { SiteShell } from '@/features/site/components/layout/SiteShell';
import { buildMetadata } from '@/features/site/lib/metadata';

export const metadata = buildMetadata();

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}

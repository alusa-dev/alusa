import type { ReactNode } from 'react';
import { SiteShell } from '@/features/site/components/layout/SiteShell';
import { buildMetadata } from '@/features/site/lib/metadata';

// O grupo contém somente conteúdo público sem sessão ou dados por tenant.
// Mantemos tokens/checkout fora deste grupo para não permitir cache acidental.
export const dynamic = 'force-static';

export const metadata = buildMetadata();

export default function PublicLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}

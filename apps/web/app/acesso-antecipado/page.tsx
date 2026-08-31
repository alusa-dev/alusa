import type { Metadata } from 'next';
import { EarlyAccessExperience } from './EarlyAccessExperience';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Acesso antecipado',
  description: 'Entre para a lista de acesso antecipado da Alusa.',
  robots: { index: true, follow: true },
};

export default function EarlyAccessPage() {
  return <EarlyAccessExperience />;
}

import type { Metadata } from 'next';
import { EarlyAccessExperience } from './EarlyAccessExperience';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Lista de espera',
  description: 'Entre para a lista de espera da Alusa.',
  robots: { index: true, follow: true },
};

export default function EarlyAccessPage() {
  return <EarlyAccessExperience />;
}

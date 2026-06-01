import type { Metadata } from 'next';
import { LegalHubPage } from '@/features/site/components/legal/LegalHubPage';

export const metadata: Metadata = {
  title: 'Legal',
  description: 'Central de documentos jurídicos, políticas e páginas institucionais da Alusa.',
  alternates: {
    canonical: '/legal',
  },
};

export default function LegalIndexPage() {
  return <LegalHubPage />;
}
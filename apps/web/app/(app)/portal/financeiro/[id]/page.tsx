import type { Metadata } from 'next';
import { CobrancaDetalhesFeature } from '@/features/portal/financeiro/CobrancaDetalhesFeature';

export const metadata: Metadata = {
  title: 'Detalhes da Cobrança | Portal do Aluno',
  description: 'Visualize os detalhes completos da sua cobrança',
};

export default async function CobrancaDetalhesPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <CobrancaDetalhesFeature cobrancaId={resolvedParams.id} />;
}







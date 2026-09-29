import type { Metadata } from 'next';
import { ChargeDetailsFeature } from '@/features/portal/finance/ChargeDetailsFeature';

export const metadata: Metadata = {
  title: 'Detalhes da Cobrança | Portal do Aluno',
  description: 'Visualize os detalhes completos da sua cobrança',
};

export default async function CobrancaDetalhesPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <ChargeDetailsFeature cobrancaId={resolvedParams.id} />;
}







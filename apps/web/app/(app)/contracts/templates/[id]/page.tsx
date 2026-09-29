import { ContractTemplateDetailsFeature } from '@/features/contracts/ContractTemplateDetailsFeature';

interface ModeloPageProps {
  params: Promise<{ id: string }>;
}

export default async function ModeloDetalhesPage({ params }: ModeloPageProps) {
  const { id } = await params;
  return <ContractTemplateDetailsFeature modeloId={id} />;
}

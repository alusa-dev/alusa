import { ModeloDetalhesFeature } from '@/features/contratos/ModeloDetalhesFeature';

interface ModeloPageProps {
  params: Promise<{ id: string }>;
}

export default async function ModeloDetalhesPage({ params }: ModeloPageProps) {
  const { id } = await params;
  return <ModeloDetalhesFeature modeloId={id} />;
}

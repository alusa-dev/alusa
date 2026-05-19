
import { ContratoDetalhesFeature } from '@/features/contratos/ContratoDetalhesFeature';

export default async function ContratoDetalhesPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <ContratoDetalhesFeature contratoId={resolvedParams.id} />;
}


import { ContratoDetalhesFeature } from '@/features/contratos/ContratoDetalhesFeature';

export default function ContratoDetalhesPage({ params }: { params: { id: string } }) {
  return <ContratoDetalhesFeature contratoId={params.id} />;
}

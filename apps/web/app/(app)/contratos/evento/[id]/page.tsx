import { ContratoDetalhesFeature } from '@/features/contratos/ContratoDetalhesFeature';

export default async function EventoContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContratoDetalhesFeature contratoId={id} origem="EVENTO" />;
}

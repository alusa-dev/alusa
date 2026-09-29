import { ContratoDetalhesFeature } from '@/features/contracts/ContractDetailsFeature';

export default async function EventoContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContratoDetalhesFeature contratoId={id} origem="EVENTO" />;
}

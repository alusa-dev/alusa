import { EventoContratoDetalhesFeature } from '@/features/contratos/EventoContratoDetalhesFeature';

export default async function EventoContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventoContratoDetalhesFeature contratoId={id} />;
}

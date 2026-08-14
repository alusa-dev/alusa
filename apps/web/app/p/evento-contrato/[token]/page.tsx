import { ContratoPublicoFeature } from '@/features/contratos/public/ContratoPublicoFeature';

export default async function EventoContratoPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ContratoPublicoFeature token={token} kind="event" />;
}

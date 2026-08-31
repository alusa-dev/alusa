import { ContratoPublicoFeature } from '@/features/contratos/public/ContratoPublicoFeature';

// O token é um segredo de acesso ao contrato e a API correspondente é no-store.
export const dynamic = 'force-dynamic';

export default async function EventoContratoPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ContratoPublicoFeature token={token} kind="event" />;
}

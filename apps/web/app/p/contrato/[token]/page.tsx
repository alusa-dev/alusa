
import { ContratoPublicoFeature } from '@/features/contratos/public/ContratoPublicoFeature';

// O token é um segredo de acesso ao contrato e a API correspondente é no-store.
export const dynamic = 'force-dynamic';

export default async function PublicoContratoPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = await params;
  return <ContratoPublicoFeature token={resolvedParams.token} />;
}

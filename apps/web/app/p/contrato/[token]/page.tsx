
import { ContratoPublicoFeature } from '@/features/contratos/public/ContratoPublicoFeature';

export default async function PublicoContratoPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = await params;
  return <ContratoPublicoFeature token={resolvedParams.token} />;
}

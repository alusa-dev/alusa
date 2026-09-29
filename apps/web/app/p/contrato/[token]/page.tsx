
import { PublicContractFeature } from '@/features/contracts/public/PublicContractFeature';

// O token é um segredo de acesso ao contrato e a API correspondente é no-store.
export const dynamic = 'force-dynamic';

export default async function PublicoContratoPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = await params;
  return <PublicContractFeature token={resolvedParams.token} />;
}

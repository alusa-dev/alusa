import { PublicContractFeature } from '@/features/contracts/public/PublicContractFeature';

// O token é um segredo de acesso ao contrato e a API correspondente é no-store.
export const dynamic = 'force-dynamic';

export default async function EventoContratoPublicPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicContractFeature token={token} kind="event" />;
}

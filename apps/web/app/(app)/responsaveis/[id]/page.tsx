import { ResponsavelDetalhesFeature } from '@/features/cadastro/responsaveis/ResponsavelDetalhesFeature';

export default async function ResponsavelDetalhesPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <ResponsavelDetalhesFeature responsavelId={resolvedParams.id} />;
}

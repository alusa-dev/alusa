import { ResponsavelDetalhesFeature } from '@/features/responsibles/ResponsibleDetailsFeature';

export default async function ResponsavelDetalhesPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <ResponsavelDetalhesFeature responsavelId={resolvedParams.id} />;
}

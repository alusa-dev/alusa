import { ResponsavelDetalhesFeature } from '@/features/cadastro/responsaveis/ResponsavelDetalhesFeature';

export default function ResponsavelDetalhesPage({ params }: { params: { id: string } }) {
  return <ResponsavelDetalhesFeature responsavelId={params.id} />;
}

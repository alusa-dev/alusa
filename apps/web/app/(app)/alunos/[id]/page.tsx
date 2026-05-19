import { AlunoDetalhesFeature } from '@/features/cadastro/alunos/AlunoDetalhesFeature';

export default async function AlunoDetalhesPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <AlunoDetalhesFeature alunoId={resolvedParams.id} />;
}

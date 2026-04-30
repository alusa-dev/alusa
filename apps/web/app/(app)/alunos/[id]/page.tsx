import { AlunoDetalhesFeature } from '@/features/cadastro/alunos/AlunoDetalhesFeature';

export default function AlunoDetalhesPage({ params }: { params: { id: string } }) {
  return <AlunoDetalhesFeature alunoId={params.id} />;
}

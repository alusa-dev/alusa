import { AlunoDetalhesFeature } from '@/features/students/StudentDetailsFeature';

export default async function AlunoDetalhesPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <AlunoDetalhesFeature alunoId={resolvedParams.id} />;
}

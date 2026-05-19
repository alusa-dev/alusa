import { ContratosDoAlunoFeature } from '@/features/contratos/ContratosDoAlunoFeature';

export default async function ContratosDoAlunoPage({ params }: { params: Promise<{ alunoId: string }> }) {
  const resolvedParams = await params;
  return <ContratosDoAlunoFeature alunoId={resolvedParams.alunoId} />;
}

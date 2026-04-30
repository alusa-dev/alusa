import { ContratosDoAlunoFeature } from '@/features/contratos/ContratosDoAlunoFeature';

export default function ContratosDoAlunoPage({ params }: { params: { alunoId: string } }) {
  return <ContratosDoAlunoFeature alunoId={params.alunoId} />;
}

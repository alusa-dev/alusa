import { StudentContractsFeature } from '@/features/contracts/StudentContractsFeature';

export default async function ContratosDoAlunoPage({ params }: { params: Promise<{ studentId: string }> }) {
  const resolvedParams = await params;
  return <StudentContractsFeature alunoId={resolvedParams.studentId} />;
}

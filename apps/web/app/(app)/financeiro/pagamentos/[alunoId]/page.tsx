import { PagamentoAlunoDetalhesClient } from '@/features/financeiro/pagamentos/PagamentoAlunoDetalhesClient';

export default async function Page({ params }: { params: Promise<{ alunoId: string }> }) {
  const { alunoId } = await params;
  return <PagamentoAlunoDetalhesClient alunoId={alunoId} />;
}

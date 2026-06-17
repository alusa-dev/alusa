import { PagamentoAlunoDetalhesClient } from '@/features/financeiro/pagamentos/PagamentoAlunoDetalhesClient';

export default async function Page({ params }: { params: Promise<{ responsavelId: string }> }) {
  const { responsavelId } = await params;
  return <PagamentoAlunoDetalhesClient alunoId={responsavelId} personType="RESPONSAVEL" />;
}

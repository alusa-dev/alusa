import { NotaFiscalPessoaDetalheClient } from '@/features/financeiro/notafiscal/NotaFiscalPessoaDetalheClient';

export default async function Page({ params }: { params: Promise<{ alunoId: string }> }) {
  const { alunoId } = await params;
  return <NotaFiscalPessoaDetalheClient personType="ALUNO" personId={alunoId} />;
}

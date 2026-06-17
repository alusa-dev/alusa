import { NotaFiscalPessoaDetalheClient } from '@/features/financeiro/notafiscal/NotaFiscalPessoaDetalheClient';

export default async function Page({ params }: { params: Promise<{ responsavelId: string }> }) {
  const { responsavelId } = await params;
  return <NotaFiscalPessoaDetalheClient personType="RESPONSAVEL" personId={responsavelId} />;
}

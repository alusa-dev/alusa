import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { getFinanceiroKpisFromAsaas } from '@alusa/finance';
import { authOptions } from '@/lib/auth-options';
import { financeiroIndicadoresResultDTOSchema } from '@/features/financeiro/dtos';
import { mapFinanceiroIndicadoresResultToDTO } from '@/features/financeiro/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const agora = new Date();
    const mesAtual = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const proximoMes = new Date(mesAtual.getFullYear(), mesAtual.getMonth() + 1, 1);
    const startOfToday = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const endOfNext30Days = new Date(startOfToday);
    endOfNext30Days.setDate(endOfNext30Days.getDate() + 30);
    endOfNext30Days.setHours(23, 59, 59, 999);

    const officialSnapshot = await getFinanceiroKpisFromAsaas({
      contaId: user.contaId,
      mesAtual,
      proximoMes,
      startOfToday,
      endOfNext30Days,
    });

    const totalPendentes = officialSnapshot.data.aguardandoPagamento.quantidadeDeCobrancas;
    const totalAtrasados = officialSnapshot.data.vencidas.quantidadeDeCobrancas;
    const totalPagos =
      officialSnapshot.data.recebidas.quantidadeDeCobrancas +
      officialSnapshot.data.recebidasEmDinheiro.quantidadeDeCobrancas +
      officialSnapshot.data.confirmadas.quantidadeDeCobrancas;
    const somaPendentes = officialSnapshot.data.aguardandoPagamento.valorBruto;
    const somaPagos =
      officialSnapshot.data.recebidas.valorBruto +
      officialSnapshot.data.recebidasEmDinheiro.valorBruto +
      officialSnapshot.data.confirmadas.valorBruto;

    return NextResponse.json(
      financeiroIndicadoresResultDTOSchema.parse(mapFinanceiroIndicadoresResultToDTO({
        data: {
          cobrancas: {
            pendentes: totalPendentes,
            pagas: totalPagos,
            atrasadas: totalAtrasados,
            valorPendentes: somaPendentes,
            valorPagos: somaPagos,
          },
        },
      })),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Financeiro Indicadores] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}

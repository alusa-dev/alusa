import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import {
  getFinanceiroKpisFromAsaas,
  syncPaymentStateFromAsaas,
} from '@alusa/finance';
import {
  financeiroKpisResultDTOSchema,
} from '@/features/financeiro/dtos';
import { mapFinanceiroKpisResultToDTO } from '@/features/financeiro/mappers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);
const KPI_RECONCILIATION_LIMIT = 25;

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

async function reconcileFinanceiroKpisSnapshot(params: {
  contaId: string;
  paymentIds: string[];
}): Promise<void> {
  const asaasPaymentIds = params.paymentIds.slice(0, KPI_RECONCILIATION_LIMIT);
  if (asaasPaymentIds.length === 0) return;

  const syncResults = await Promise.allSettled(
    asaasPaymentIds.map((asaasPaymentId) =>
      syncPaymentStateFromAsaas({
        contaId: params.contaId,
        asaasPaymentId,
      }),
    ),
  );

  const failed = syncResults.filter((result) => result.status === 'rejected').length;
  if (failed > 0) {
    console.warn('[API Financeiro KPIs] Parte da reconciliação com Asaas falhou', {
      contaId: params.contaId,
      attempted: asaasPaymentIds.length,
      failed,
    });
  }
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const { searchParams } = new URL(request.url);
    const mesParam = searchParams.get('mes'); // formato: YYYY-MM
    
    const agora = new Date();
    // Definir início do dia atual para cálculo correto de vencimento (venceu se < início de hoje? ou < agora?)
    // Regra geral: venceu se data de vencimento < hoje (ignora hora).
    // Se vencimento é hoje, ainda não venceu (o cliente tem até o fim do dia).
    const startOfToday = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const endOfNext30Days = new Date(startOfToday);
    endOfNext30Days.setDate(endOfNext30Days.getDate() + 30);
    endOfNext30Days.setHours(23, 59, 59, 999);

    const mesAtual = mesParam 
      ? new Date(`${mesParam}-01T00:00:00Z`) 
      : new Date(agora.getFullYear(), agora.getMonth(), 1);
    const proximoMes = new Date(mesAtual.getFullYear(), mesAtual.getMonth() + 1, 1);
    const officialSnapshot = await getFinanceiroKpisFromAsaas({
      contaId: user.contaId,
      mesAtual,
      proximoMes,
      startOfToday,
      endOfNext30Days,
    });

    await reconcileFinanceiroKpisSnapshot({
      contaId: user.contaId,
      paymentIds: officialSnapshot.paymentIdsForReconcile,
    });

    return NextResponse.json(
      financeiroKpisResultDTOSchema.parse(mapFinanceiroKpisResultToDTO({ data: officialSnapshot.data })),
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    console.error('[API Financeiro KPIs] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}

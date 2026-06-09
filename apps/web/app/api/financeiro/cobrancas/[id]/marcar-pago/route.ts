import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { AsaasEnvError, KycNotApprovedError, markChargeAsPaid } from '@alusa/finance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function statusFromResultCode(code: string) {
  const statusMap: Record<string, number> = {
    NOT_FOUND: 404,
    ALREADY_PAID: 400,
    STATUS_NOT_PAYABLE: 400,
    ASAAS_STATUS_NOT_RECEIVABLE: 409,
    ASAAS_ALREADY_PAID_SYNC_FAILED: 409,
    INVALID_PAYMENT_DATE: 400,
  };
  return statusMap[code] ?? 400;
}

interface MarcarPagoBody {
  dataPagamento?: string;
  formaPagamentoManual?: 'DINHEIRO' | 'PIX' | 'TRANSFERENCIA';
  observacao?: string;
  notifyCustomer?: boolean;
}

/**
 * POST /api/financeiro/cobrancas/[id]/marcar-pago
 *
 * Marca uma cobrança como paga manualmente.
 *
 * FASE 5: Se tiver asaasPaymentId, usa confirmCashPayment (receber em dinheiro).
 * Status final vem via webhook. Se não tiver Asaas, marca local.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as MarcarPagoBody;

    const result = await markChargeAsPaid({
      chargeId: id,
      contaId: user.contaId,
      userId: user.id,
      dataPagamento: body.dataPagamento,
      formaPagamentoManual: body.formaPagamentoManual,
      observacao: body.observacao,
      notifyCustomer: body.notifyCustomer,
    });

    if (!result.success) {
      return err(statusFromResultCode(result.code), result.code, result.error);
    }

    const message = result.data.isOffline
      ? 'Cobrança marcada como paga (offline)'
      : 'Recebimento em dinheiro registrado no Asaas. Status será atualizado via webhook.';

    return NextResponse.json(
      { success: true, message, data: result.data },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof KycNotApprovedError) {
      return err(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
    }
    if (e instanceof AsaasEnvError) {
      return err(503, 'ASAAS_INDISPONIVEL', 'Credenciais Asaas não configuradas');
    }
    console.error('[API Marcar Pago] Erro', e);
    return err(500, 'ERRO_INTERNO', (e as Error).message);
  }
}

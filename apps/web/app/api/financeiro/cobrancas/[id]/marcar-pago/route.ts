import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getRequestId, logApiError, logApiResponse } from '@/lib/observability/api-logger';
import {
  AsaasEnvError,
  AsaasHttpError,
  KycNotApprovedError,
  markChargeAsPaid,
} from '@alusa/finance';

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

const marcarPagoBodySchema = z.object({
  dataPagamento: z.string().trim().min(1).optional(),
  formaPagamentoManual: z.enum(['DINHEIRO', 'PIX', 'TRANSFERENCIA']).optional(),
  observacao: z.string().trim().max(2000).optional(),
  notifyCustomer: z.boolean().optional(),
});

/**
 * POST /api/financeiro/cobrancas/[id]/marcar-pago
 *
 * Marca uma cobrança como paga manualmente.
 *
 * FASE 5: Se tiver asaasPaymentId, usa confirmCashPayment (receber em dinheiro).
 * Status final vem via webhook. Se não tiver Asaas, marca local.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const route = '/api/financeiro/cobrancas/[id]/marcar-pago';
  const requestId = getRequestId(req);
  const startedAt = Date.now();
  let chargeId: string | undefined;
  let tenantId: string | undefined;
  const complete = (response: Response, errorCode?: string, fields?: Record<string, unknown>) => {
    logApiResponse({
      route,
      requestId,
      method: 'POST',
      startedAt,
      status: response.status,
      errorCode,
      tenantId,
      resourceId: chargeId,
      ...fields,
    });
    return response;
  };

  try {
    const session = await getServerSession(authOptions).catch(() => null);
    type SessUser = { id?: string; contaId?: string; role?: string };
    const user = (session as { user?: SessUser } | null)?.user;
    if (!user?.id || !user?.contaId) return complete(err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado'), 'NAO_AUTENTICADO');
    if (!user.role || !allowedRoles.has(user.role.toUpperCase()))
      return complete(err(403, 'SEM_PERMISSAO', 'Acesso negado'), 'SEM_PERMISSAO');

    const { id } = await params;
    chargeId = id;
    tenantId = user.contaId;
    const parsedBody = marcarPagoBodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsedBody.success) {
      return complete(err(422, 'ERRO_VALIDACAO', 'Dados de baixa manual inválidos.'), 'ERRO_VALIDACAO');
    }
    const body: MarcarPagoBody = parsedBody.data;

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
      return complete(err(statusFromResultCode(result.code), result.code, result.error), result.code);
    }

    const message = result.data.isOffline
      ? 'Cobrança marcada como paga (offline)'
      : 'Recebimento em dinheiro registrado no Asaas. Status será atualizado via webhook.';

    return complete(NextResponse.json(
      { success: true, message, data: result.data },
      { headers: { 'cache-control': 'no-store' } },
    ));
  } catch (e) {
    if (e instanceof KycNotApprovedError) {
      return complete(err(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras'), 'KYC_NAO_APROVADO');
    }
    if (e instanceof AsaasEnvError) {
      return complete(err(503, 'ASAAS_INDISPONIVEL', 'Credenciais Asaas não configuradas'), 'ASAAS_INDISPONIVEL');
    }
    if (e instanceof AsaasHttpError) {
      if (e.status === 429) {
        return complete(err(
          503,
          'ASAAS_TEMPORARIAMENTE_INDISPONIVEL',
          'A plataforma financeira está temporariamente indisponível. Tente novamente em alguns instantes.',
        ), 'ASAAS_TEMPORARIAMENTE_INDISPONIVEL', { providerStatus: e.status });
      }

      if (e.status >= 500) {
        return complete(err(
          502,
          'ASAAS_FALHA_PROCESSAMENTO',
          'A plataforma financeira não conseguiu processar o recebimento. Nenhuma baixa foi registrada. Tente novamente ou contate o suporte.',
        ), 'ASAAS_FALHA_PROCESSAMENTO', { providerStatus: e.status });
      }

      return complete(err(
        422,
        'ASAAS_OPERACAO_REJEITADA',
        e.message || 'A plataforma financeira rejeitou a operação.',
      ), 'ASAAS_OPERACAO_REJEITADA', { providerStatus: e.status });
    }
    logApiError({ route, requestId, method: 'POST', startedAt, status: 500, errorCode: 'ERRO_INTERNO', tenantId, resourceId: chargeId, error: e });
    return err(500, 'ERRO_INTERNO', 'Não foi possível concluir a baixa manual.');
  }
}

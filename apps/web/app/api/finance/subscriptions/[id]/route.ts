import { NextRequest, NextResponse } from 'next/server';
import { financeSubscriptionRouteParamsDTOSchema } from '@/features/finance/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { apiErrorResponse } from '@/lib/api/report-api-error';
import {
  getSubscriptionWithCharges,
  KycNotApprovedError,
} from '@alusa/finance';
import { deleteSubscriptionForTenant } from '@/src/server/finance/subscription-cancellation.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const allowedRoles = new Set(['ADMIN', 'FINANCEIRO']);

function err(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/**
 * GET /api/finance/subscriptions/[id]
 * Retorna detalhes de uma assinatura com cobranças vinculadas.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rawParams = await params;
    const parsedParams = financeSubscriptionRouteParamsDTOSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return err(400, 'PARAMETROS_INVALIDOS', 'Assinatura inválida');
    }
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const result = await getSubscriptionWithCharges({
      contaId: auth.contaId,
      subscriptionId: parsedParams.data.id,
    });

    if (!result.success) {
      return err(404, 'NAO_ENCONTRADO', result.error);
    }

    return NextResponse.json(
      { data: result.data },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return apiErrorResponse(e, {
      route: 'GET /api/finance/subscriptions/[id]',
      fallbackMessage: 'Não foi possível carregar a assinatura.',
    });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const rawParams = await params;
    const parsedParams = financeSubscriptionRouteParamsDTOSchema.safeParse(rawParams);
    if (!parsedParams.success) {
      return err(400, 'PARAMETROS_INVALIDOS', 'Assinatura inválida');
    }
    const auth = await resolveTenantSession();
    if (!auth.ok) {
      return err(401, 'NAO_AUTENTICADO', 'Usuário não autenticado');
    }
    if (!auth.role || !allowedRoles.has(auth.role.toUpperCase())) {
      return err(403, 'SEM_PERMISSAO', 'Acesso negado');
    }

    const result = await deleteSubscriptionForTenant({
      contaId: auth.contaId,
      subscriptionId: parsedParams.data.id,
    });
    if (result.status === 'NOT_FOUND') return err(404, 'NAO_ENCONTRADO', 'Assinatura não encontrada');
    if (result.status === 'ACADEMIC_SUBSCRIPTION') {
      return err(
        409,
        'ASSINATURA_ORIGINADA_MATRICULA',
        'Esta assinatura deve ser encerrada ou cancelada pela página da matrícula.',
      );
    }
    if (result.status === 'WITHOUT_ASAAS_LINK') {
      return err(400, 'SEM_VINCULO_ASAAS', 'Assinatura sem vínculo com a plataforma financeira');
    }
    if (result.status === 'SHARED_SUBSCRIPTION') {
      return err(
        409,
        'ASSINATURA_COMPARTILHADA',
        'Esta assinatura é compartilhada. Remova ou encerre as matrículas individualmente antes de excluir a assinatura.',
      );
    }
    if (result.status === 'UNAUTHORIZED_PROVIDER') {
      return err(502, 'FINANCEIRO_AUTENTICACAO_INVALIDA', result.message);
    }

    return NextResponse.json(
      {
        success: true,
        message: result.status === 'ALREADY_DELETED'
          ? result.message
          : 'Assinatura excluída com sucesso.',
        ...(result.data ? { data: result.data } : {}),
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof KycNotApprovedError) {
      return err(409, 'KYC_NAO_APROVADO', 'Conta não aprovada para operações financeiras');
    }

    return apiErrorResponse(e, {
      route: 'DELETE /api/finance/subscriptions/[id]',
      fallbackMessage: 'Não foi possível excluir a assinatura.',
    });
  }
}
